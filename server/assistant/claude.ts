/**
 * Running Claude Code headless for the in-app assistant: one long-lived
 * `claude -p` process per chat, fed user messages as stream-json on stdin,
 * whose stream-json output `TurnTranslator` turns into `ChatEvent`s.
 *
 * It only gets the editor's MCP tools (no shell, no files): `--tools ""`
 * turns every built-in tool off, `--strict-mcp-config` ignores the user's
 * other MCP servers, and it runs in an empty directory of the data dir so no
 * project's CLAUDE.md or settings apply.
 */
import type { ChatEvent } from "../../shared/assistant.ts";
import { MCP_SERVER_NAME, bareToolName } from "../../shared/assistant-tools.ts";
import { type Agent, type AgentOptions, JsonLinesProcess, type TurnResult, isObject } from "./agent.ts";

export interface ClaudeArgsOptions {
  mcpUrl: string;
  systemPrompt: string;
  model: string;
  effort?: string | null;
  /** Session to continue. */
  resume: string | null;
}

/** Command line arguments for a chat's Claude Code process. */
export function claudeArgs({ mcpUrl, systemPrompt, model, effort, resume }: ClaudeArgsOptions): string[] {
  const mcpConfig = { mcpServers: { [MCP_SERVER_NAME]: { type: "http", url: mcpUrl } } };
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--mcp-config", JSON.stringify(mcpConfig),
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", `mcp__${MCP_SERVER_NAME}`,
    "--disable-slash-commands",
    "--setting-sources", "project",
    "--system-prompt", systemPrompt,
    "--model", model,
    ...(effort ? ["--effort", effort] : []),
    ...(resume ? ["--resume", resume] : []),
  ];
}

/** The text of a tool result's content (a string, or blocks). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((c) => (isObject(c) && c.type === "text" && typeof c.text === "string" && !c.text.startsWith("[Image: source:") ? [c.text] : []))
    .join("\n");
}

/**
 * Turns one turn's stream-json output into chat events for the assistant
 * message `messageId`. Text streams in as deltas; tools are announced as they
 * start and again with their full input.
 */
export class TurnTranslator {
  /** The API message being streamed. */
  private apiMessage = "";
  /** Stream block index -> kind, for the API message being streamed. */
  private blocks = new Map<number, string>();
  /** API messages whose text arrived as deltas (their complete copies are skipped). */
  private streamed = new Set<string>();
  private rateLimited: string | null = null;
  sessionId: string | null = null;
  initialized = false;

  constructor(readonly messageId: string) {}

  /** Events for one output line (already parsed), and the result when the turn is over. */
  handle(line: unknown): { events: ChatEvent[]; result?: TurnResult } {
    if (!isObject(line)) return { events: [] };
    const events: ChatEvent[] = [];
    const messageId = this.messageId;
    switch (line.type) {
      case "system":
        if (line.subtype === "init") {
          this.initialized = true;
          if (typeof line.session_id === "string") this.sessionId = line.session_id;
        }
        break;
      case "rate_limit_event": {
        const info = isObject(line.rate_limit_info) ? line.rate_limit_info : {};
        if (info.status === "rejected") {
          const resets = typeof info.resetsAt === "number" ? new Date(info.resetsAt * 1000) : null;
          this.rateLimited = `You've reached your Claude usage limit${resets ? ` until ${resets.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.`;
        }
        break;
      }
      case "stream_event": {
        const e = isObject(line.event) ? line.event : {};
        // Subagent output is left out.
        if (line.parent_tool_use_id) break;
        if (e.type === "message_start" && isObject(e.message) && typeof e.message.id === "string") {
          this.apiMessage = e.message.id;
          this.blocks.clear();
        } else if (e.type === "content_block_start" && typeof e.index === "number" && isObject(e.content_block)) {
          const block = e.content_block;
          this.blocks.set(e.index, String(block.type));
          const key = `${this.apiMessage}:${e.index}`;
          if (block.type === "thinking" || block.type === "redacted_thinking") events.push({ type: "thinking", messageId, key, done: false });
          if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
            events.push({ type: "tool_start", messageId, id: block.id, name: bareToolName(block.name), input: {} });
          }
        } else if (e.type === "content_block_delta" && typeof e.index === "number" && isObject(e.delta)) {
          if (e.delta.type === "text_delta" && typeof e.delta.text === "string" && e.delta.text) {
            this.streamed.add(this.apiMessage);
            events.push({ type: "text_delta", messageId, key: `${this.apiMessage}:${e.index}`, text: e.delta.text });
          }
        } else if (e.type === "content_block_stop" && typeof e.index === "number") {
          const kind = this.blocks.get(e.index);
          if (kind === "thinking" || kind === "redacted_thinking") {
            events.push({ type: "thinking", messageId, key: `${this.apiMessage}:${e.index}`, done: true });
          }
        }
        break;
      }
      case "assistant": {
        if (line.parent_tool_use_id) break;
        const message = isObject(line.message) ? line.message : {};
        const apiId = typeof message.id === "string" ? message.id : "";
        const content = Array.isArray(message.content) ? message.content : [];
        content.forEach((block, i) => {
          if (!isObject(block)) return;
          if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
            events.push({ type: "tool_start", messageId, id: block.id, name: bareToolName(block.name), input: block.input ?? {} });
          } else if (block.type === "text" && typeof block.text === "string" && block.text && !this.streamed.has(apiId)) {
            // Only when it didn't stream (no partial messages).
            events.push({ type: "text", messageId, key: `${apiId}:full${i}`, text: block.text });
          }
        });
        break;
      }
      case "user": {
        if (line.parent_tool_use_id) break;
        const message = isObject(line.message) ? line.message : {};
        for (const block of Array.isArray(message.content) ? message.content : []) {
          if (!isObject(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
          events.push({
            type: "tool_end",
            id: block.tool_use_id,
            status: block.is_error ? "error" : "done",
            output: resultText(block.content),
          });
        }
        break;
      }
      case "result": {
        const isError = line.is_error === true || (typeof line.subtype === "string" && line.subtype !== "success");
        if (!isError) return { events, result: { isError: false } };
        const errors = Array.isArray(line.errors) ? line.errors.filter((x): x is string => typeof x === "string") : [];
        const text = typeof line.result === "string" ? line.result : "";
        const error = this.rateLimited ?? (text || errors.join(" ") || "Claude stopped with an error.");
        return { events, result: { isError: true, error } };
      }
    }
    return { events };
  }
}

/** Claude Code as the assistant's agent: one `claude -p` process speaking stream-json. */
export class ClaudeAgent implements Agent {
  private proc: JsonLinesProcess;
  private translator: TurnTranslator | null = null;
  private started = false;

  constructor(opts: AgentOptions) {
    const { handlers } = opts;
    const args = claudeArgs({ mcpUrl: opts.mcpUrl, systemPrompt: opts.systemPrompt, model: opts.model, effort: opts.effort, resume: opts.resume });
    this.proc = new JsonLinesProcess({
      argv: [opts.command, ...args],
      cwd: opts.cwd,
      env: {
        // Every tool is always listed (there's no tool search without built-in tools).
        ENABLE_TOOL_SEARCH: "false",
        // Transcripts of long videos are big.
        MAX_MCP_OUTPUT_TOKENS: "60000",
      },
      onLine: (line) => {
        const translator = this.translator;
        if (!translator) return;
        const { events, result } = translator.handle(line);
        if (translator.initialized) this.started = true;
        if (translator.sessionId) handlers.onSession(translator.sessionId);
        if (events.length) handlers.onEvents(events);
        if (result) {
          this.translator = null;
          handlers.onTurnEnd(result);
        }
      },
      onExit: (error) => handlers.onExit(error, this.started),
    });
  }

  send(messageId: string, prompt: string): void {
    this.translator = new TurnTranslator(messageId);
    this.proc.write({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
  }

  interrupt(): void {
    this.proc.write({ type: "control_request", request_id: `interrupt-${Date.now()}`, request: { subtype: "interrupt" } });
  }

  stop(): void {
    this.proc.stop();
  }
}
