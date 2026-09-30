/**
 * Codex as the assistant's agent: one `codex app-server` process per chat
 * (JSON-RPC over stdio, the protocol Codex's own apps use), which runs a
 * thread with only the editor's MCP tools. `CodexTranslator` turns its
 * notifications into `ChatEvent`s.
 *
 * Its built-in tools are turned off (shell, patches, web search, apps,
 * plugins...), the user's other MCP servers are disabled for it, it runs in
 * an empty folder of the data dir with a read-only sandbox, and the editor's
 * system prompt replaces Codex's own. The user's login and config are theirs:
 * nothing here writes to `~/.codex`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type AssistantModelInfo, type ChatEvent, isEffort } from "../../shared/assistant.ts";
import { MCP_SERVER_NAME } from "../../shared/tool-spec.ts";
import { type Agent, type AgentOptions, JsonLinesProcess, type TurnResult, isObject } from "./agent.ts";

/** Codex features that would give it tools other than the editor's (unknown ones are ignored). */
const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "multi_agent",
  "view_image",
  "sleep_tool",
  "goals",
  "tool_suggest",
  "in_app_browser",
  "skill_search",
  "memories",
];

/** The longest a tool may take (captions and exports of long videos are slow; the bridge has its own limits). */
const TOOL_TIMEOUT_S = 3600;

/** The names of the MCP servers in a Codex `config.toml` (`[mcp_servers.<name>]` tables). */
export function configuredMcpServers(toml: string): string[] {
  const names = new Set<string>();
  for (const m of toml.matchAll(/^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*[\].]/gm)) {
    names.add(m[1] ?? m[2] ?? m[3]);
  }
  return [...names];
}

/** The user's own MCP servers, to turn off for the assistant (like Claude Code's `--strict-mcp-config`). */
export async function userMcpServers(): Promise<string[]> {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const toml = await fs.readFile(path.join(home, "config.toml"), "utf8").catch(() => "");
  return configuredMcpServers(toml).filter((n) => n !== MCP_SERVER_NAME);
}

const toml = (v: string) => JSON.stringify(v);

/** Command line arguments for a chat's `codex app-server`. */
export function codexArgs({ mcpUrl, disabledServers }: { mcpUrl: string; disabledServers: string[] }): string[] {
  const set = (key: string, value: string | number | boolean) => ["-c", `${key}=${typeof value === "string" ? toml(value) : value}`];
  const server = `mcp_servers.${MCP_SERVER_NAME}`;
  return [
    "app-server",
    ...set(`${server}.url`, mcpUrl),
    // The editor's tools run without asking: its edits are undoable, and the ones that aren't ask in the editor.
    ...set(`${server}.default_tools_approval_mode`, "approve"),
    ...set(`${server}.tool_timeout_sec`, TOOL_TIMEOUT_S),
    ...set(`${server}.startup_timeout_sec`, 30),
    ...disabledServers.flatMap((name) => set(`mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : toml(name)}.enabled`, false)),
    ...set("web_search", "disabled"),
    ...DISABLED_FEATURES.flatMap((f) => set(`features.${f}`, false)),
  ];
}

/** The text of an MCP tool result's content blocks. */
function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.flatMap((c) => (isObject(c) && c.type === "text" && typeof c.text === "string" ? [c.text] : [])).join("\n");
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Turns one turn's app-server notifications into chat events for the assistant message `messageId`.
 * Text streams in as deltas (then its whole text); the editor's tool calls are announced as they start.
 */
export class CodexTranslator {
  private lastError: string | null = null;
  private limited: string | null = null;

  constructor(readonly messageId: string) {}

  /** Events for one notification, and the result when the turn is over. */
  handle(method: string, params: Record<string, unknown>): { events: ChatEvent[]; result?: TurnResult } {
    const messageId = this.messageId;
    const events: ChatEvent[] = [];
    const item = isObject(params.item) ? params.item : null;
    switch (method) {
      case "item/agentMessage/delta":
        if (str(params.delta)) events.push({ type: "text_delta", messageId, key: str(params.itemId), text: str(params.delta) });
        break;
      case "item/started":
      case "item/completed": {
        if (!item || typeof item.id !== "string") break;
        const done = method === "item/completed";
        if (item.type === "agentMessage" && done && str(item.text)) {
          events.push({ type: "text", messageId, key: item.id, text: str(item.text) });
        } else if (item.type === "reasoning") {
          events.push({ type: "thinking", messageId, key: item.id, done });
        } else if (item.type === "mcpToolCall" && item.server === MCP_SERVER_NAME && typeof item.tool === "string") {
          if (!done) {
            events.push({ type: "tool_start", messageId, id: item.id, name: item.tool, input: item.arguments ?? {} });
          } else {
            const failed = item.status === "failed" || !!item.error;
            const error = isObject(item.error) ? str(item.error.message) : "";
            const output = isObject(item.result) ? resultText(item.result.content) : "";
            events.push({ type: "tool_end", id: item.id, status: failed ? "error" : "done", output: output || error });
          }
        }
        break;
      }
      case "error": {
        const error = isObject(params.error) ? str(params.error.message) : "";
        if (error && params.willRetry !== true) this.lastError = error;
        break;
      }
      case "account/rateLimits/updated": {
        const limits = isObject(params.rateLimits) ? params.rateLimits : {};
        if (!limits.rateLimitReachedType) break;
        const windows = [limits.primary, limits.secondary].filter(isObject);
        const resets = windows.map((w) => w.resetsAt).find((t): t is number => typeof t === "number");
        const until = resets ? ` until ${new Date(resets * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
        this.limited = `You've reached your Codex usage limit${until}.`;
        break;
      }
      case "turn/completed": {
        const turn = isObject(params.turn) ? params.turn : {};
        if (turn.status === "completed") return { events, result: { isError: false } };
        if (turn.status === "interrupted") return { events, result: { isError: true, error: "Stopped." } };
        const error = isObject(turn.error) ? str(turn.error.message) : "";
        return { events, result: { isError: true, error: this.limited ?? (error || this.lastError || "Codex stopped with an error.") } };
      }
    }
    return { events };
  }
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

/** A `codex app-server` answering one chat. */
export class CodexAgent implements Agent {
  private proc: JsonLinesProcess;
  private rpcId = 0;
  private pending = new Map<number, Pending>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private translator: CodexTranslator | null = null;
  /** A message sent before the thread was ready. */
  private queued: { messageId: string; prompt: string } | null = null;
  private started = false;
  private exitError: string | null = null;

  constructor(private opts: AgentOptions & { disabledServers: string[] }) {
    this.proc = new JsonLinesProcess({
      argv: [opts.command, ...codexArgs({ mcpUrl: opts.mcpUrl, disabledServers: opts.disabledServers })],
      cwd: opts.cwd,
      env: {},
      onLine: (line) => this.onLine(line),
      onExit: (error) => {
        for (const p of this.pending.values()) p.reject(new Error("Codex stopped."));
        this.pending.clear();
        opts.handlers.onExit(this.exitError ?? error, this.started);
      },
    });
    void this.open();
  }

  private async open() {
    const { opts } = this;
    try {
      await this.request("initialize", { clientInfo: { name: "video-editor", title: "Video editor", version: "0.1.0" }, capabilities: null });
      this.proc.write({ jsonrpc: "2.0", method: "initialized" });
      const settings = {
        model: opts.model,
        cwd: opts.cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: opts.systemPrompt,
      };
      const res = opts.resume
        ? await this.request("thread/resume", { threadId: opts.resume, ...settings, excludeTurns: true })
        : await this.request("thread/start", settings);
      const thread = isObject(res) && isObject(res.thread) ? res.thread : {};
      if (typeof thread.id !== "string") throw new Error("Codex didn't start a conversation.");
      this.threadId = thread.id;
      this.started = true;
      opts.handlers.onSession(thread.id);
      const queued = this.queued;
      this.queued = null;
      if (queued) this.send(queued.messageId, queued.prompt);
    } catch (err) {
      // Reported as it exits (a saved conversation that can't be continued is then started afresh).
      this.exitError = err instanceof Error ? err.message : String(err);
      this.proc.stop();
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.rpcId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private onLine(line: unknown) {
    if (!isObject(line)) return;
    const method = typeof line.method === "string" ? line.method : null;
    const id = typeof line.id === "number" || typeof line.id === "string" ? line.id : null;
    // A response to one of ours.
    if (!method && typeof id === "number") {
      const p = this.pending.get(id);
      this.pending.delete(id);
      if (!p) return;
      if (isObject(line.error)) p.reject(new Error(str(line.error.message) || "Codex refused."));
      else p.resolve(line.result);
      return;
    }
    if (!method) return;
    // A request from Codex: nothing is ever approved beyond the editor's tools.
    if (id !== null) {
      this.proc.write({ jsonrpc: "2.0", id, ...answerRequest(method) });
      return;
    }
    const params = isObject(line.params) ? line.params : {};
    if (typeof params.threadId === "string" && params.threadId !== this.threadId) return;
    if (method === "turn/started" && isObject(params.turn) && typeof params.turn.id === "string") this.turnId = params.turn.id;
    const translator = this.translator;
    if (!translator) return;
    const { events, result } = translator.handle(method, params);
    if (events.length) this.opts.handlers.onEvents(events);
    if (result) this.endTurn(result);
  }

  private endTurn(result: TurnResult) {
    if (!this.translator) return;
    this.translator = null;
    this.turnId = null;
    this.opts.handlers.onTurnEnd(result);
  }

  send(messageId: string, prompt: string): void {
    if (!this.threadId) {
      this.queued = { messageId, prompt };
      return;
    }
    this.translator = new CodexTranslator(messageId);
    this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
      model: this.opts.model,
      ...(this.opts.effort && { effort: this.opts.effort }),
    }).then(
      (res) => {
        const turn = isObject(res) && isObject(res.turn) ? res.turn : {};
        if (typeof turn.id === "string") this.turnId ??= turn.id;
      },
      (err: Error) => this.endTurn({ isError: true, error: err.message }),
    );
  }

  interrupt(): void {
    if (this.queued) {
      this.queued = null;
      return;
    }
    if (!this.threadId || !this.turnId) return;
    this.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }).catch(() => {});
  }

  stop(): void {
    this.proc.stop();
  }
}

/** The answer to a request from Codex (an approval, a question): always no. */
function answerRequest(method: string): Record<string, unknown> {
  switch (method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { result: { decision: "decline" } };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { result: { decision: "denied" } };
    case "mcpServer/elicitation/request":
      return { result: { action: "decline", content: null, _meta: null } };
    default:
      return { error: { code: -32601, message: `The video editor doesn't handle ${method}.` } };
  }
}

export interface CodexInfo {
  /** As the picker shows them (null when Codex can't say). */
  models: AssistantModelInfo[] | null;
  /** "ChatGPT Plus", "API key"... */
  account: string | null;
}

/** Codex's models and account, asked of Codex itself. */
export async function codexInfo(command: string): Promise<CodexInfo> {
  return new Promise((resolve) => {
    let settled = false;
    let account: string | null = null;
    const finish = (models: AssistantModelInfo[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stop();
      resolve({ models, account });
    };
    const proc = new JsonLinesProcess({
      argv: [command, "app-server"],
      cwd: os.tmpdir(),
      env: {},
      onLine: (line) => {
        if (!isObject(line) || line.method) return;
        if (line.id === 1) {
          proc.write({ jsonrpc: "2.0", method: "initialized" });
          proc.write({ jsonrpc: "2.0", id: 2, method: "account/read", params: {} });
        } else if (line.id === 2) {
          account = isObject(line.result) ? accountLabel(line.result.account) : null;
          proc.write({ jsonrpc: "2.0", id: 3, method: "model/list", params: {} });
        } else if (line.id === 3) {
          finish(isObject(line.result) ? parseModelList(line.result.data) : null);
        }
      },
      onExit: () => finish(null),
    });
    const timer = setTimeout(() => finish(null), 15_000);
    proc.write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "video-editor", title: "Video editor", version: "0.1.0" }, capabilities: null } });
  });
}

/** How `account/read`'s account is shown: "ChatGPT Plus", "API key". */
export function accountLabel(account: unknown): string | null {
  if (!isObject(account)) return null;
  if (account.type === "apiKey") return "API key";
  if (account.type !== "chatgpt") return null;
  const plan = str(account.planType);
  const names: Record<string, string> = { plus: "Plus", pro: "Pro", prolite: "Pro Lite", promax: "Pro Max", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu", go: "Go", free: "Free" };
  const name = names[plan];
  return name ? `ChatGPT ${name}` : "ChatGPT";
}

/** `model/list`'s answer as picker entries: the ones it lists, default first, older ones as legacy. */
export function parseModelList(data: unknown): AssistantModelInfo[] | null {
  if (!Array.isArray(data)) return null;
  const models = data.filter(isObject).filter((m) => m.hidden !== true);
  const listed = models.flatMap((m): (AssistantModelInfo & { isDefault: boolean })[] => {
    const id = str(m.model) || str(m.id);
    if (!id) return [];
    const hint = str(m.description);
    const efforts = (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : [])
      .map((e) => (isObject(e) ? e.reasoningEffort : e))
      .filter(isEffort);
    const defaultEffort = isEffort(m.defaultReasoningEffort) ? m.defaultReasoningEffort : null;
    return [
      {
        id,
        label: str(m.displayName) || id,
        ...(hint && { hint }),
        ...(/^(older|legacy)\b/i.test(hint) && { legacy: true }),
        ...(efforts.length && { efforts }),
        ...(defaultEffort && { defaultEffort }),
        isDefault: m.isDefault === true,
      },
    ];
  });
  if (listed.length === 0) return null;
  listed.sort((a, b) => Number(!!a.legacy) - Number(!!b.legacy) || Number(b.isDefault) - Number(a.isDefault));
  return listed.map(({ isDefault: _, ...m }) => m);
}
