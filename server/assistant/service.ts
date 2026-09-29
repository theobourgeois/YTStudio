/**
 * The in-app assistant: one chat per video, answered by Claude Code (the
 * user's own install and subscription) using the editor's MCP tools, which
 * run in the editor tab (`bridge.ts`). Chats are saved in the data dir
 * (`assistant/chats/<projectId>.json`, pictures the assistant looked at in
 * `assistant/images/<projectId>/`) and continue the same Claude Code session
 * after a restart.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AssistantModel,
  type ChatEvent,
  type ChatSnapshot,
  type ChatState,
  type UserMessage,
  applyChatEvent,
  emptyChat,
  isAssistantModel,
} from "../../shared/assistant.ts";
import { type ToolResult, bareToolName, errorResult, toolSpec } from "../../shared/assistant-tools.ts";
import { errorMessage } from "../../shared/errors.ts";
import type { AssistantStatus, SendChatMessageRequest } from "../../shared/types.ts";
import { createId } from "../../shared/timeline.ts";
import { CLAUDE } from "../config.ts";
import { firstThatRuns, run } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId, readJson, writeJson } from "../storage.ts";
import type { Bridge } from "./bridge.ts";
import { ClaudeProcess, TurnTranslator, claudeArgs } from "./claude.ts";
import type { McpCall } from "./mcp.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

/** A chat's Claude Code process quits after this long without a message (the session carries on). */
const IDLE_MS = 15 * 60_000;
/** After asking a turn to stop, how long before the process is killed instead. */
const STOP_GRACE_MS = 5000;
const MAX_MESSAGE = 20_000;
const MAX_CONTEXT = 20_000;
const STATUS_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_S = 120;


interface Turn {
  messageId: string;
  translator: TurnTranslator;
  /** The text sent, to send again if a resumed session couldn't start. */
  prompt: string;
  stopping: boolean;
  stopTimer?: ReturnType<typeof setTimeout>;
  resumed: boolean;
}

interface Chat {
  projectId: string;
  state: ChatState;
  /** Events so far (numbered for the tabs, see `ChatSnapshot`). */
  seq: number;
  /**
   * Results that came back before Claude Code's own output announced the tool (the two
   * arrive by different routes), applied once it does.
   */
  earlyResults: Map<string, ChatEvent>;
  sessionId: string | null;
  process: ClaudeProcess | null;
  /** The model the process was started with. */
  processModel: AssistantModel | null;
  tabId: string | null;
  turn: Turn | null;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface SavedChat {
  state: ChatState;
  sessionId: string | null;
}

export interface AssistantOptions {
  /** The command that runs Claude Code (default: found on this computer). */
  command?: string;
  /** Where the server is reached, for the MCP URL given to Claude Code. */
  port: () => number;
}

export class AssistantService {
  private chats = new Map<string, Chat>();
  private loading = new Map<string, Promise<Chat>>();
  private statusCache: { at: number; value: Promise<AssistantStatus> } | null = null;
  private command: Promise<string | null> | null = null;

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
  /** Where Claude Code runs: an empty folder, so no project settings or CLAUDE.md apply. */
  private get workDir() {
    return path.join(this.dir, "workspace");
  }

  async init(): Promise<void> {
    await Promise.all(
      [path.join(this.dir, "chats"), path.join(this.dir, "images"), this.workDir].map((d) => fs.mkdir(d, { recursive: true })),
    );
  }

  // -------------------------------------------------------------------------
  // Claude Code on this computer
  // -------------------------------------------------------------------------

  private findCommand(): Promise<string | null> {
    if (this.opts.command) return Promise.resolve(this.opts.command);
    const home = os.homedir();
    const candidates = CLAUDE
      ? [CLAUDE]
      : ["claude", path.join(home, ".local/bin/claude"), path.join(home, ".claude/local/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
    this.command ??= firstThatRuns(candidates, ["--version"]).then((found) => {
      // Not found yet: look again next time (it may be installed meanwhile).
      if (!found) this.command = null;
      return found;
    });
    return this.command;
  }

  status(): Promise<AssistantStatus> {
    if (this.statusCache && Date.now() - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const value = this.checkStatus();
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  private async checkStatus(): Promise<AssistantStatus> {
    const command = await this.findCommand();
    if (!command) {
      return {
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
      return { available: true, version, loggedIn: true, account: null, problem: null };
    }
    const loggedIn = auth.loggedIn === true;
    const plan = typeof auth.subscriptionType === "string" ? auth.subscriptionType : null;
    const account =
      auth.authMethod === "claude.ai" && plan ? `Claude ${plan[0].toUpperCase()}${plan.slice(1)}` : loggedIn ? String(auth.authMethod ?? "") || null : null;
    return {
      available: true,
      version,
      loggedIn,
      account,
      problem: loggedIn ? null : "Claude Code isn't logged in. Run `claude` in a terminal and log in, then try again.",
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
    let state = saved && isObject(saved.state) && Array.isArray(saved.state.messages) ? saved.state : emptyChat();
    if (!isAssistantModel(state.model)) state = { ...state, model: "default" };
    // Saved mid-turn (the server stopped): that turn is over.
    for (const m of state.messages) {
      if (m.role === "assistant" && m.status === "working") {
        state = applyChatEvent(state, { type: "assistant_end", messageId: m.id, status: "error", error: "The editor's server restarted." });
      }
    }
    const chat: Chat = {
      projectId,
      state: { ...state, status: "idle" },
      seq: 0,
      earlyResults: new Map(),
      sessionId: typeof saved?.sessionId === "string" ? saved.sessionId : null,
      process: null,
      processModel: null,
      tabId: null,
      turn: null,
    };
    this.chats.set(projectId, chat);
    return chat;
  }

  async get(projectId: string): Promise<ChatSnapshot> {
    return snapshot(await this.chat(projectId));
  }

  private emit(chat: Chat, event: ChatEvent) {
    chat.state = applyChatEvent(chat.state, event);
    this.bridge.broadcast(chat.projectId, ++chat.seq, event);
    if (event.type === "tool_start") {
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
    const saved: SavedChat = { state: chat.state, sessionId: chat.sessionId };
    return writeJson(this.chatFile(chat.projectId), saved).catch((err) => console.error("[assistant] saving the chat failed", err));
  }

  async setModel(projectId: string, body: unknown): Promise<ChatSnapshot> {
    const chat = await this.chat(projectId);
    const model = isObject(body) ? body.model : undefined;
    if (!isAssistantModel(model)) throw new HttpError(400, "Unknown model.");
    this.emit(chat, { type: "model", model });
    await this.save(chat);
    return snapshot(chat);
  }

  async send(projectId: string, body: unknown): Promise<void> {
    const chat = await this.chat(projectId);
    const req = parseSend(body);
    if (chat.turn) throw new HttpError(409, "Claude is still working on the last message.");
    const status = await this.status();
    if (status.problem) throw new HttpError(503, status.problem);
    const command = await this.findCommand();
    if (!command) throw new HttpError(503, "Claude Code isn't installed.");

    chat.tabId = req.tab;
    const user: UserMessage = { id: createId("msg"), role: "user", text: req.text, at: Date.now(), ...(req.contextLabel && { context: req.contextLabel }) };
    this.emit(chat, { type: "user", message: user });
    const messageId = createId("msg");
    this.emit(chat, { type: "assistant_start", id: messageId, at: Date.now() });
    const prompt = req.context ? `<editor-context>\n${req.context}\n</editor-context>\n\n${req.text}` : req.text;
    this.startTurn(chat, command, messageId, prompt);
    void this.save(chat);
  }

  private startTurn(chat: Chat, command: string, messageId: string, prompt: string) {
    clearTimeout(chat.idleTimer);
    // Another model was picked: start over on it (the conversation continues).
    if (chat.process && chat.processModel !== chat.state.model) {
      chat.process.stop();
      chat.process = null;
    }
    const resumed = !chat.process && !!chat.sessionId;
    chat.turn = { messageId, translator: new TurnTranslator(messageId), prompt, stopping: false, resumed };
    if (!chat.process) this.spawn(chat, command);
    chat.process!.send(prompt);
  }

  private spawn(chat: Chat, command: string) {
    const url = `http://127.0.0.1:${this.opts.port()}/mcp?chat=${chat.projectId}`;
    const args = claudeArgs({ mcpUrl: url, systemPrompt: SYSTEM_PROMPT, model: chat.state.model, resume: chat.sessionId });
    const proc: ClaudeProcess = new ClaudeProcess({
      command,
      args,
      cwd: this.workDir,
      env: {
        // Every tool is always listed (there's no tool search without built-in tools).
        ENABLE_TOOL_SEARCH: "false",
        // Transcripts of long videos are big.
        MAX_MCP_OUTPUT_TOKENS: "60000",
      },
      onLine: (line) => this.onLine(chat, proc, line),
      onExit: (error) => this.onExit(chat, proc, command, error),
    });
    chat.process = proc;
    chat.processModel = chat.state.model;
  }

  private onLine(chat: Chat, proc: ClaudeProcess, line: unknown) {
    const turn = chat.turn;
    if (chat.process !== proc || !turn) return;
    const { events, result } = turn.translator.handle(line);
    if (turn.translator.sessionId && turn.translator.sessionId !== chat.sessionId) chat.sessionId = turn.translator.sessionId;
    for (const event of events) this.emit(chat, event);
    if (result) {
      const status = turn.stopping ? "stopped" : result.isError ? "error" : "done";
      this.endTurn(chat, status, status === "error" ? result.error : undefined);
    }
  }

  private onExit(chat: Chat, proc: ClaudeProcess, command: string, error: string | null) {
    if (chat.process !== proc) return;
    chat.process = null;
    const turn = chat.turn;
    if (!turn) return;
    // A saved session that can't be continued (e.g. Claude Code's history was cleared): start a new one.
    if (turn.resumed && !turn.translator.initialized && !turn.stopping) {
      chat.sessionId = null;
      this.startTurn(chat, command, turn.messageId, turn.prompt);
      return;
    }
    if (turn.stopping) this.endTurn(chat, "stopped");
    else this.endTurn(chat, "error", error ? `Claude Code stopped: ${error}` : "Claude Code stopped unexpectedly.");
  }

  private endTurn(chat: Chat, status: "done" | "error" | "stopped", error?: string) {
    const turn = chat.turn;
    if (!turn) return;
    clearTimeout(turn.stopTimer);
    chat.turn = null;
    this.bridge.cancelChat(chat.projectId);
    this.emit(chat, { type: "assistant_end", messageId: turn.messageId, status, ...(error && { error }) });
    void this.save(chat);
    clearTimeout(chat.idleTimer);
    chat.idleTimer = setTimeout(() => {
      if (chat.turn) return;
      chat.process?.stop();
      chat.process = null;
    }, IDLE_MS);
  }

  async stop(projectId: string): Promise<void> {
    const chat = await this.chat(projectId);
    const turn = chat.turn;
    if (!turn || turn.stopping) return;
    turn.stopping = true;
    this.bridge.cancelChat(projectId);
    chat.process?.interrupt();
    turn.stopTimer = setTimeout(() => {
      if (chat.turn !== turn) return;
      chat.process?.stop();
      chat.process = null;
      this.endTurn(chat, "stopped");
    }, STOP_GRACE_MS);
  }

  /** Start a new chat (forgetting the conversation). */
  async reset(projectId: string): Promise<ChatSnapshot> {
    const chat = await this.chat(projectId);
    if (chat.turn) await this.stop(projectId);
    chat.process?.stop();
    chat.process = null;
    chat.turn = null;
    chat.sessionId = null;
    chat.earlyResults.clear();
    this.emit(chat, { type: "reset", state: emptyChat(chat.state.model) });
    await fs.rm(this.imageDir(projectId), { recursive: true, force: true });
    await this.save(chat);
    return snapshot(chat);
  }

  /** Forget a deleted video's chat. */
  async remove(projectId: string): Promise<void> {
    const chat = this.chats.get(projectId);
    chat?.process?.stop();
    this.chats.delete(projectId);
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

  async callTool(call: McpCall, query: Record<string, string>): Promise<ToolResult> {
    const spec = toolSpec(call.name);
    if (!spec) return errorResult(`Unknown tool: ${call.name}`);
    const chatId = query.chat && isValidId(query.chat) ? query.chat : null;
    const chat = chatId ? await this.chat(chatId) : null;
    const tab = this.bridge.tabFor(chatId, chat?.tabId);
    if (!tab) {
      return errorResult(
        chatId
          ? "This video isn't open in the editor any more, so its tools can't run. Ask the user to open it."
          : "No video is open in the editor. Ask the user to open the editor in their browser and open a video.",
      );
    }
    const partId = chat && call.toolUseId ? call.toolUseId : null;
    const onProgress = chat && partId ? (fraction: number | null, label?: string) => this.emit(chat, { type: "tool_progress", id: partId, fraction, ...(label && { label }) }) : undefined;
    let result: ToolResult;
    try {
      result = await this.bridge.call(tab, bareToolName(call.name), call.input, {
        timeoutMs: (spec.timeout ?? DEFAULT_TIMEOUT_S) * 1000,
        chat: chatId,
        onProgress,
      });
    } catch (err) {
      result = errorResult(errorMessage(err));
    }
    if (chat && partId) {
      const images = await this.saveImages(chat.projectId, result);
      const output = result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
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
        console.error("[assistant] couldn't keep a picture", err);
      }
    }
    return urls;
  }

  shutdown(): void {
    for (const chat of this.chats.values()) {
      clearTimeout(chat.idleTimer);
      chat.process?.stop();
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
