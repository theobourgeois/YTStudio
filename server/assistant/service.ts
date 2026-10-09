/**
 * The in-app assistant: one chat per project (of any suite), answered by the user's own Claude
 * Code or Codex (their install and subscription; the chat picks which, and
 * can switch) using the editor's MCP tools, which run in an editor tab
 * (`bridge.ts`). Chats are saved in the data dir (`assistant/chats/<projectId>.json`,
 * pictures the assistant looked at in `assistant/images/<projectId>/`) and
 * continue the same conversation after a restart.
 *
 * Chats of different videos run at the same time: a chat's tools act on its
 * own video, even while the tab shows another. Every tab is told which chats
 * are working (`ChatActivity`), for the sidebar.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AssistantProvider,
  CLAUDE_MODELS,
  CODEX_MODELS,
  type ChatActivity,
  type ChatEvent,
  type ChatSnapshot,
  type ChatState,
  type UserMessage,
  applyChatEvent,
  chatModel,
  describeToolCall,
  emptyChat,
  isAssistantProvider,
  isEffort,
  isModelId,
  providerInfo,
  transcript,
} from "../../shared/assistant.ts";
import { DEFAULT_SUITE, type SuiteId, isSuiteId, suiteNoun } from "../../shared/suites.ts";
import { suiteToolSpec, toolSuite } from "../../shared/suite-tools.ts";
import { type ToolResult, bareToolName, errorResult } from "../../shared/tool-spec.ts";
import { errorMessage } from "../../shared/errors.ts";
import type { AssistantProviderStatus, AssistantStatus, SendChatMessageRequest } from "../../shared/types.ts";
import { createId } from "../../shared/ids.ts";
import { CLAUDE, CODEX } from "../config.ts";
import { log } from "../log.ts";
import { firstThatRuns, run } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId, readJson, writeJson } from "../storage.ts";
import type { Agent, AgentHandlers } from "./agent.ts";
import type { Bridge } from "./bridge.ts";
import { ClaudeAgent } from "./claude.ts";
import { CodexAgent, type CodexInfo, codexInfo, userMcpServers } from "./codex.ts";
import type { McpCall } from "./mcp.ts";
import { suiteBackend } from "../suites/index.ts";
import { systemPrompt } from "./prompt.ts";

/** A chat's agent quits after this long without a message (the conversation carries on). */
const IDLE_MS = 15 * 60_000;
/** After asking a turn to stop, how long before the agent is killed instead. */
const STOP_GRACE_MS = 5000;
const MAX_MESSAGE = 20_000;
const MAX_CONTEXT = 20_000;
const STATUS_TTL_MS = 30_000;
/** Codex's model list changes rarely (and asking starts a process). */
const MODELS_TTL_MS = 10 * 60_000;
const DEFAULT_TIMEOUT_S = 120;
const logger = log("assistant");

interface Turn {
  messageId: string;
  provider: AssistantProvider;
  model: string;
  effort: string | null;
  /** The user's message (with the editor context), before any catching up (see `prompt`). */
  text: string;
  /** How many of the chat's messages came before this turn's. */
  before: number;
  stopping: boolean;
  stopTimer?: ReturnType<typeof setTimeout>;
  /** It continues a saved conversation (which may fail to start, see `onExit`). */
  resumed: boolean;
}

/** A provider's conversation, and how many of the chat's messages it has been part of. */
interface Session {
  id: string;
  seen: number;
}

interface Chat {
  projectId: string;
  state: ChatState;
  /** Events so far (numbered for the tabs, see `ChatSnapshot`). */
  seq: number;
  /**
   * Results that came back before the agent's own output announced the tool (the two
   * arrive by different routes), applied once it does.
   */
  earlyResults: Map<string, ChatEvent>;
  sessions: Partial<Record<AssistantProvider, Session>>;
  agent: Agent | null;
  /** The provider, model and thinking level the agent was started with. */
  agentKey: string | null;
  tabId: string | null;
  turn: Turn | null;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface SavedChat {
  state: ChatState;
  sessions?: Partial<Record<AssistantProvider, Session>>;
  /** Before Codex: the Claude Code session. */
  sessionId?: string | null;
}

export interface AssistantOptions {
  /** Project-bound tools whose work is owned by the server, independent of a tab. */
  serverTool?: (suite: SuiteId, projectId: string, name: string, input: Record<string, unknown>) => Promise<ToolResult | null>;
  /** The commands that run each provider's CLI (default: found on this computer). */
  commands?: Partial<Record<AssistantProvider, string>>;
  /** Where the server is reached, for the MCP URL given to the agents. */
  port: () => number;
  /** The suite of a project (null if there's none), which decides its chat's prompt and tools. */
  suiteOf: (projectId: string) => SuiteId | null;
}

const agentKey = (turn: Pick<Turn, "provider" | "model" | "effort">) => `${turn.provider}:${turn.model}:${turn.effort ?? ""}`;

export class AssistantService {
  private chats = new Map<string, Chat>();
  private loading = new Map<string, Promise<Chat>>();
  private statusCache: { at: number; value: Promise<AssistantStatus> } | null = null;
  private commands = new Map<AssistantProvider, Promise<string | null>>();
  private codexInfoCache: { at: number; value: Promise<CodexInfo> } | null = null;
  /** What each chat is doing (or last did), for every tab's sidebar. */
  private activity = new Map<string, ChatActivity>();

  constructor(
    private paths: DataPaths,
    private bridge: Bridge,
    private opts: AssistantOptions,
  ) {}

  private get dir() {
    return path.join(this.paths.root, "assistant");
  }
  private chatFile(projectId: string) {
    return path.join(this.dir, "chats", `${projectId}.json`);
  }
  private imageDir(projectId: string) {
    return path.join(this.dir, "images", projectId);
  }
  /** Where the agents run: an empty folder, so no project settings or instructions apply. */
  private get workDir() {
    return path.join(this.dir, "workspace");
  }

  async init(): Promise<void> {
    await Promise.all(
      [path.join(this.dir, "chats"), path.join(this.dir, "images"), this.workDir].map((d) => fs.mkdir(d, { recursive: true })),
    );
  }

  // -------------------------------------------------------------------------
  // Claude Code and Codex on this computer
  // -------------------------------------------------------------------------

  private findCommand(provider: AssistantProvider): Promise<string | null> {
    const given = this.opts.commands?.[provider];
    if (given) return Promise.resolve(given);
    const home = os.homedir();
    const candidates =
      provider === "claude"
        ? CLAUDE
          ? [CLAUDE]
          : process.platform === "win32"
            ? ["claude.exe", path.join(home, ".local", "bin", "claude.exe"), path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")]
            : ["claude", path.join(home, ".local/bin/claude"), path.join(home, ".claude/local/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
        : CODEX
          ? [CODEX]
          : process.platform === "win32"
            ? ["codex.exe", path.join(home, ".local", "bin", "codex.exe"), path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "node_modules", "@openai", "codex", "bin", "codex.js")]
            : ["codex", path.join(home, ".local/bin/codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
    let found = this.commands.get(provider);
    if (!found) {
      found = firstThatRuns(candidates, ["--version"]).then((command) => {
        // Not found yet: look again next time (it may be installed meanwhile).
        if (!command) this.commands.delete(provider);
        return command;
      });
      this.commands.set(provider, found);
    }
    return found;
  }

  status(): Promise<AssistantStatus> {
    if (this.statusCache && Date.now() - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const value = Promise.all([this.claudeStatus(), this.codexStatus()]).then((providers) => ({ providers }));
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  private async providerStatus(provider: AssistantProvider): Promise<AssistantProviderStatus> {
    return (await this.status()).providers.find((p) => p.provider === provider)!;
  }

  private async claudeStatus(): Promise<AssistantProviderStatus> {
    const base = { provider: "claude" as const, models: [...CLAUDE_MODELS] };
    const command = await this.findCommand("claude");
    if (!command) {
      return {
        ...base,
        available: false,
        version: null,
        loggedIn: false,
        account: null,
        problem: "Claude Code isn't installed. Install it from claude.com/claude-code, then log in with `claude`.",
      };
    }
    const version = (await run(command, ["--version"]).catch(() => "")).trim().split(/\s/)[0] || null;
    let auth: Record<string, unknown> = {};
    try {
      auth = JSON.parse(await run(command, ["auth", "status", "--json"])) as Record<string, unknown>;
    } catch {
      // Older versions: assume it's set up; a failing turn says otherwise.
      return { ...base, available: true, version, loggedIn: true, account: null, problem: null };
    }
    const loggedIn = auth.loggedIn === true;
    const plan = typeof auth.subscriptionType === "string" ? auth.subscriptionType : null;
    const account =
      auth.authMethod === "claude.ai" && plan ? `Claude ${plan[0].toUpperCase()}${plan.slice(1)}` : loggedIn ? String(auth.authMethod ?? "") || null : null;
    return {
      ...base,
      available: true,
      version,
      loggedIn,
      account,
      problem: loggedIn ? null : "Claude Code isn't logged in. Run `claude` in a terminal and log in, then try again.",
    };
  }

  private async codexStatus(): Promise<AssistantProviderStatus> {
    const command = await this.findCommand("codex");
    if (!command) {
      return {
        provider: "codex",
        models: [...CODEX_MODELS],
        available: false,
        version: null,
        loggedIn: false,
        account: null,
        problem: "Codex isn't installed. Install it with `npm install -g @openai/codex`, then log in with `codex login`.",
      };
    }
    const version = (await run(command, ["--version"]).catch(() => "")).trim().split(/\s/).pop() || null;
    // It says so on stderr, and exits with an error when logged out.
    let said = "";
    const login = await run(command, ["login", "status"], { onStderr: (chunk) => (said += chunk.toString()) }).then(
      (out) => `${out}${said}`.trim(),
      () => null,
    );
    const loggedIn = login !== null && !/not logged in/i.test(login);
    if (!this.codexInfoCache || Date.now() - this.codexInfoCache.at > MODELS_TTL_MS) {
      const value = loggedIn ? codexInfo(command) : Promise.resolve({ models: null, account: null });
      this.codexInfoCache = { at: Date.now(), value };
      // Couldn't tell: ask again next time.
      void value.then(({ models }) => {
        if (!models && this.codexInfoCache?.value === value) this.codexInfoCache = null;
      });
    }
    const info = await this.codexInfoCache?.value;
    const account = !loggedIn ? null : (info?.account ?? (/chatgpt/i.test(login) ? "ChatGPT" : /api key/i.test(login) ? "API key" : null));
    const models = info?.models ?? [...CODEX_MODELS];
    return {
      provider: "codex",
      models,
      available: true,
      version,
      loggedIn,
      account,
      problem: loggedIn ? null : "Codex isn't logged in. Run `codex login` in a terminal, then try again.",
    };
  }

  // -------------------------------------------------------------------------
  // Chats
  // -------------------------------------------------------------------------

  private chat(projectId: string): Promise<Chat> {
    if (!isValidId(projectId)) throw new HttpError(400, "Invalid project id");
    const known = this.chats.get(projectId);
    if (known) return Promise.resolve(known);
    let pending = this.loading.get(projectId);
    if (!pending) {
      pending = this.loadChat(projectId).finally(() => this.loading.delete(projectId));
      this.loading.set(projectId, pending);
    }
    return pending;
  }

  private async loadChat(projectId: string): Promise<Chat> {
    const saved = await readJson<SavedChat>(this.chatFile(projectId));
    let state: ChatState =
      saved && isObject(saved.state) && Array.isArray(saved.state.messages) ? { ...saved.state, ...chatModel(saved.state) } : emptyChat();
    // Saved mid-turn (the server stopped): that turn is over.
    for (const m of state.messages) {
      if (m.role === "assistant" && m.status === "working") {
        state = applyChatEvent(state, { type: "assistant_end", messageId: m.id, status: "error", error: "The editor's server restarted." });
      }
    }
    const sessions: Partial<Record<AssistantProvider, Session>> = {};
    for (const [provider, session] of Object.entries(isObject(saved?.sessions) ? saved.sessions : {})) {
      if (isAssistantProvider(provider) && isObject(session) && typeof session.id === "string" && typeof session.seen === "number") {
        sessions[provider] = { id: session.id, seen: session.seen };
      }
    }
    if (!sessions.claude && typeof saved?.sessionId === "string") sessions.claude = { id: saved.sessionId, seen: state.messages.length };
    const chat: Chat = {
      projectId,
      state: { ...state, status: "idle" },
      seq: 0,
      earlyResults: new Map(),
      sessions,
      agent: null,
      agentKey: null,
      tabId: null,
      turn: null,
    };
    this.chats.set(projectId, chat);
    return chat;
  }

  async get(projectId: string): Promise<ChatSnapshot> {
    return snapshot(await this.chat(projectId));
  }

  /** Every chat that's working or has answered since the server started. */
  chatActivity(): ChatActivity[] {
    return [...this.activity.values()];
  }

  private setActivity(chat: Chat, status: ChatActivity["status"] | null) {
    if (status) this.activity.set(chat.projectId, { projectId: chat.projectId, status, since: Date.now(), provider: chat.turn?.provider ?? chat.state.provider });
    else if (!this.activity.delete(chat.projectId)) return;
    this.bridge.setActivity(this.chatActivity());
  }

  private emit(chat: Chat, event: ChatEvent) {
    chat.state = applyChatEvent(chat.state, event);
    this.bridge.broadcast(chat.projectId, ++chat.seq, event);
    if (event.type === "tool_start") {
      // The sidebar shows the step a working chat is on.
      const activity = this.activity.get(chat.projectId);
      const step = describeToolCall(event.name, event.input);
      if (activity?.status === "working" && activity.step !== step) {
        this.activity.set(chat.projectId, { ...activity, step });
        this.bridge.setActivity(this.chatActivity());
      }
      const early = chat.earlyResults.get(event.id);
      chat.earlyResults.delete(event.id);
      if (early) this.emit(chat, early);
    }
  }

  /** A tool's result: applied now, or once its tool is announced. */
  private emitResult(chat: Chat, event: Extract<ChatEvent, { type: "tool_end" }>) {
    const known = chat.state.messages.some((m) => m.role === "assistant" && m.parts.some((p) => p.kind === "tool" && p.id === event.id));
    if (known) this.emit(chat, event);
    else chat.earlyResults.set(event.id, event);
  }

  private save(chat: Chat): Promise<void> {
    const saved: SavedChat = { state: chat.state, sessions: chat.sessions };
    return writeJson(this.chatFile(chat.projectId), saved).catch((err) => logger.error("saving the chat failed", err));
  }

  async setModel(projectId: string, body: unknown): Promise<ChatSnapshot> {
    const chat = await this.chat(projectId);
    const b = isObject(body) ? body : {};
    const provider = b.provider ?? chat.state.provider;
    if (!isAssistantProvider(provider)) throw new HttpError(400, "Unknown provider: use claude or codex.");
    if (!isModelId(b.model)) throw new HttpError(400, "Unknown model.");
    const effort = b.effort ?? null;
    if (effort !== null && !isEffort(effort)) throw new HttpError(400, "Unknown thinking level: use low, medium, high... or null for the default.");
    this.emit(chat, { type: "model", provider, model: b.model, effort });
    await this.save(chat);
    return snapshot(chat);
  }

  async send(projectId: string, body: unknown): Promise<void> {
    const chat = await this.chat(projectId);
    const req = parseSend(body);
    if (chat.turn) throw new HttpError(409, `${providerInfo(chat.turn.provider).label} is still working on the last message.`);
    const { provider, model, effort } = chat.state;
    const status = await this.providerStatus(provider);
    if (status.problem) throw new HttpError(503, status.problem);
    if (chat.turn) throw new HttpError(409, "Still working on the last message.");

    chat.tabId = req.tab;
    const user: UserMessage = { id: createId("msg"), role: "user", text: req.text, at: Date.now(), ...(req.contextLabel && { context: req.contextLabel }) };
    const before = chat.state.messages.length;
    this.emit(chat, { type: "user", message: user });
    const messageId = createId("msg");
    const text = req.context ? `<editor-context>\n${req.context}\n</editor-context>\n\n${req.text}` : req.text;
    chat.turn = { messageId, provider, model, effort, text, before, stopping: false, resumed: false };
    this.emit(chat, { type: "assistant_start", id: messageId, at: Date.now() });
    this.setActivity(chat, "working");
    void this.save(chat);
    try {
      await this.startTurn(chat, chat.turn);
    } catch (err) {
      this.endTurn(chat, "error", errorMessage(err));
    }
  }

  /**
   * What the agent is sent: the user's message, after whatever it missed of the chat (it was
   * answered by the other provider, or this provider's conversation was lost).
   */
  private prompt(chat: Chat, turn: Turn): string {
    const missed = transcript(chat.state.messages.slice(0, turn.before), chat.sessions[turn.provider]?.seen ?? 0);
    if (!missed) return turn.text;
    return `<earlier-conversation>\nEarlier in this chat (answered by another assistant, whose tools were the same as yours):\n\n${missed}\n</earlier-conversation>\n\n${turn.text}`;
  }

  private async startTurn(chat: Chat, turn: Turn) {
    clearTimeout(chat.idleTimer);
    const key = agentKey(turn);
    // Another provider, model or thinking level was picked: start over on it (the conversation continues).
    if (chat.agent && chat.agentKey !== key) {
      chat.agent.stop();
      chat.agent = null;
      chat.agentKey = null;
    }
    if (!chat.agent) {
      const command = await this.findCommand(turn.provider);
      if (!command) throw new Error(`${providerInfo(turn.provider).app} isn't installed.`);
      const disabledServers = turn.provider === "codex" ? await userMcpServers() : [];
      if (chat.turn !== turn || turn.stopping) return;
      turn.resumed = !!chat.sessions[turn.provider];
      this.spawn(chat, turn, command, disabledServers);
    }
    chat.agent!.send(turn.messageId, this.prompt(chat, turn));
  }

  private spawn(chat: Chat, turn: Turn, command: string, disabledServers: string[]) {
    const { provider, model, effort } = turn;
    let agent: Agent | null = null;
    const mine = () => agent !== null && chat.agent === agent;
    const handlers: AgentHandlers = {
      onEvents: (events) => {
        if (!mine() || !chat.turn) return;
        for (const event of events) {
          if (event.type === "tool_end") this.emitResult(chat, event);
          else this.emit(chat, event);
        }
      },
      onSession: (id) => {
        if (!mine()) return;
        const known = chat.sessions[provider];
        if (known?.id !== id) chat.sessions[provider] = { id, seen: 0 };
      },
      onTurnEnd: (result) => {
        const current = chat.turn;
        if (!mine() || !current) return;
        const status = current.stopping ? "stopped" : result.isError ? "error" : "done";
        this.endTurn(chat, status, status === "error" ? result.error : undefined);
      },
      onExit: (error, started) => {
        if (!mine()) return;
        chat.agent = null;
        chat.agentKey = null;
        const current = chat.turn;
        if (!current) return;
        // A saved conversation that can't be continued (e.g. its history was cleared): start a new one.
        if (current.resumed && !started && !current.stopping) {
          delete chat.sessions[current.provider];
          current.resumed = false;
          this.startTurn(chat, current).catch((err) => this.endTurn(chat, "error", errorMessage(err)));
          return;
        }
        const app = providerInfo(current.provider).app;
        if (current.stopping) this.endTurn(chat, "stopped");
        else this.endTurn(chat, "error", error ? `${app} stopped: ${error}` : `${app} stopped unexpectedly.`);
      },
    };
    const opts = {
      command,
      cwd: this.workDir,
      mcpUrl: `http://127.0.0.1:${this.opts.port()}/mcp?chat=${chat.projectId}`,
      systemPrompt: this.promptFor(chat.projectId),
      model,
      effort,
      resume: chat.sessions[provider]?.id ?? null,
      handlers,
    };
    agent = provider === "codex" ? new CodexAgent({ ...opts, disabledServers }) : new ClaudeAgent(opts);
    chat.agent = agent;
    chat.agentKey = agentKey(turn);
  }

  private endTurn(chat: Chat, status: "done" | "error" | "stopped", error?: string) {
    const turn = chat.turn;
    if (!turn) return;
    clearTimeout(turn.stopTimer);
    chat.turn = null;
    this.bridge.cancelChat(chat.projectId);
    this.emit(chat, { type: "assistant_end", messageId: turn.messageId, status, ...(error && { error }) });
    // The agent has now been part of everything so far.
    const session = chat.sessions[turn.provider];
    if (session) session.seen = chat.state.messages.length;
    this.setActivity(chat, status);
    void this.save(chat);
    clearTimeout(chat.idleTimer);
    chat.idleTimer = setTimeout(() => {
      if (chat.turn) return;
      chat.agent?.stop();
      chat.agent = null;
      chat.agentKey = null;
    }, IDLE_MS);
  }

  async stop(projectId: string): Promise<void> {
    const chat = await this.chat(projectId);
    const turn = chat.turn;
    if (!turn || turn.stopping) return;
    turn.stopping = true;
    this.bridge.cancelChat(projectId);
    if (!chat.agent) {
      this.endTurn(chat, "stopped");
      return;
    }
    chat.agent.interrupt();
    turn.stopTimer = setTimeout(() => {
      if (chat.turn !== turn) return;
      chat.agent?.stop();
      chat.agent = null;
      chat.agentKey = null;
      this.endTurn(chat, "stopped");
    }, STOP_GRACE_MS);
  }

  /** Start a new chat (forgetting the conversation), on the same provider and model. */
  async reset(projectId: string): Promise<ChatSnapshot> {
    const chat = await this.chat(projectId);
    if (chat.turn) await this.stop(projectId);
    chat.agent?.stop();
    chat.agent = null;
    chat.agentKey = null;
    chat.turn = null;
    chat.sessions = {};
    chat.earlyResults.clear();
    this.emit(chat, { type: "reset", state: emptyChat(chat.state.provider, chat.state.model, chat.state.effort) });
    this.setActivity(chat, null);
    await fs.rm(this.imageDir(projectId), { recursive: true, force: true });
    await this.save(chat);
    return snapshot(chat);
  }

  /** Whether anything was said in a project's chat (a project made and left untouched is kept for it). */
  async hasMessages(projectId: string): Promise<boolean> {
    if (!isValidId(projectId)) return false;
    const known = this.chats.get(projectId);
    if (known) return known.state.messages.length > 0;
    const saved = await readJson<SavedChat>(this.chatFile(projectId));
    return !!saved && isObject(saved.state) && Array.isArray(saved.state.messages) && saved.state.messages.length > 0;
  }

  /** Forget a deleted video's chat. */
  async remove(projectId: string): Promise<void> {
    const chat = this.chats.get(projectId);
    chat?.agent?.stop();
    if (chat) clearTimeout(chat.idleTimer);
    this.chats.delete(projectId);
    if (this.activity.delete(projectId)) this.bridge.setActivity(this.chatActivity());
    await fs.rm(this.chatFile(projectId), { force: true });
    await fs.rm(this.imageDir(projectId), { recursive: true, force: true });
  }

  /** Path of a picture the assistant looked at. */
  imagePath(projectId: string, name: string): string {
    if (!isValidId(projectId) || !/^[a-z]{2,8}_[0-9a-f]{12}\.(jpg|png|webp)$/.test(name)) throw new HttpError(404, "Not found");
    return path.join(this.imageDir(projectId), name);
  }

  // -------------------------------------------------------------------------
  // Tool calls (from the MCP server)
  // -------------------------------------------------------------------------

  /** The suite an MCP request is for: its chat's project's, else the one asked for (`?suite=`), else video. */
  suiteFor(query: Record<string, string>): SuiteId {
    const chatSuite = query.chat ? this.opts.suiteOf(query.chat) : null;
    return chatSuite ?? (isSuiteId(query.suite) ? query.suite : DEFAULT_SUITE);
  }

  private promptFor(projectId: string): string {
    const suite = this.opts.suiteOf(projectId) ?? DEFAULT_SUITE;
    return systemPrompt(suite, suiteBackend(suite).assistant);
  }

  async callTool(call: McpCall, query: Record<string, string>): Promise<ToolResult> {
    const suite = this.suiteFor(query);
    const spec = suiteToolSpec(suite, call.name);
    if (!spec) {
      const other = toolSuite(call.name);
      return errorResult(other ? `${call.name} is a tool for ${suiteNoun(other, 2)}, and this is a ${suiteNoun(suite)}.` : `Unknown tool: ${call.name}`);
    }
    const chatId = query.chat && isValidId(query.chat) ? query.chat : null;
    const chat = chatId ? await this.chat(chatId) : null;
    const tab = this.bridge.tabFor(chatId, chat?.tabId);
    const serverResult = chat && this.opts.serverTool ? await this.opts.serverTool(suite, chat.projectId, bareToolName(call.name), call.input).catch(err => errorResult(errorMessage(err))) : null;
    if (!tab && !serverResult) {
      return errorResult(
        chatId
          ? "The editor isn't open in the browser any more, so its tools can't run. Ask the user to open it again."
          : "Nothing is open in the editor. Ask the user to open the editor in their browser and open a project.",
      );
    }
    const partId = chat && call.toolUseId ? call.toolUseId : null;
    const onProgress = chat && partId ? (fraction: number | null, label?: string) => this.emit(chat, { type: "tool_progress", id: partId, fraction, ...(label && { label }) }) : undefined;
    const started = performance.now();
    let result: ToolResult;
    try {
      result = serverResult ?? await this.bridge.call(tab!, bareToolName(call.name), call.input, {
        timeoutMs: (spec.timeout ?? DEFAULT_TIMEOUT_S) * 1000,
        chat: chatId,
        ...(chat?.turn && { turn: chat.turn.messageId }),
        onProgress,
      });
    } catch (err) {
      result = errorResult(errorMessage(err));
    }
    // A tool's error is usually the model's mistake, told back to it: news, not a fault.
    const output = result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
    const took = `${call.name} in ${Math.round(performance.now() - started)} ms`;
    if (result.isError) logger.info(`${took} answered an error: ${output.slice(0, 300)}`);
    else logger.info(took);
    if (chat && partId) {
      const images = await this.saveImages(chat.projectId, result);
      this.emitResult(chat, {
        type: "tool_end",
        id: partId,
        status: result.isError ? "error" : "done",
        output,
        ...(images.length && { images }),
        ...(result.changes && { changes: result.changes }),
      });
    }
    return result;
  }

  private async saveImages(projectId: string, result: ToolResult): Promise<string[]> {
    const urls: string[] = [];
    const dir = this.imageDir(projectId);
    for (const c of result.content) {
      if (c.type !== "image") continue;
      const ext = c.mimeType === "image/png" ? "png" : c.mimeType === "image/webp" ? "webp" : "jpg";
      const name = `${createId("img")}.${ext}`;
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, name), Buffer.from(c.data, "base64"));
        urls.push(`/api/assistant/images/${projectId}/${name}`);
      } catch (err) {
        logger.error("couldn't keep a picture", err);
      }
    }
    return urls;
  }

  shutdown(): void {
    for (const chat of this.chats.values()) {
      clearTimeout(chat.idleTimer);
      chat.agent?.stop();
    }
  }
}

const snapshot = (chat: Chat): ChatSnapshot => ({ state: chat.state, seq: chat.seq });

function parseSend(body: unknown): SendChatMessageRequest {
  if (!isObject(body)) throw new HttpError(400, "Expected { text, tab }.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw new HttpError(400, "The message is empty.");
  if (text.length > MAX_MESSAGE) throw new HttpError(400, "That message is too long.");
  if (typeof body.tab !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.tab)) throw new HttpError(400, "Invalid tab.");
  const context = typeof body.context === "string" ? body.context.slice(0, MAX_CONTEXT) : undefined;
  const contextLabel = typeof body.contextLabel === "string" ? body.contextLabel.slice(0, 120) : undefined;
  return { text, tab: body.tab, context, contextLabel };
}
