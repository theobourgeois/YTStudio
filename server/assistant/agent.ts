/**
 * What the assistant's service needs from an agent (Claude Code, Codex): one
 * long-lived process per chat that answers messages with the editor's MCP
 * tools and reports what it does as `ChatEvent`s. Each provider's file turns
 * its CLI's own protocol into this (`claude.ts`, `codex.ts`).
 */
import path from "node:path";
import type { Writable } from "node:stream";
import type { ChatEvent } from "../../shared/assistant.ts";
import { log } from "../log.ts";
import { spawnStreaming } from "../process.ts";

/** How a turn ended. */
export interface TurnResult {
  isError: boolean;
  /** What went wrong, when it did. */
  error?: string;
}

export interface AgentHandlers {
  /** Chat events from the turn being answered. */
  onEvents: (events: ChatEvent[]) => void;
  /** The provider's id for the conversation, to continue it after a restart. */
  onSession: (id: string) => void;
  onTurnEnd: (result: TurnResult) => void;
  /**
   * It exited (on its own or stopped), with the tail of its stderr when it failed. `started`: whether
   * the conversation got going (a saved one that can't be continued doesn't).
   */
  onExit: (error: string | null, started: boolean) => void;
}

export interface AgentOptions {
  command: string;
  /** An empty folder to run in, so no project's instructions or settings apply. */
  cwd: string;
  /** The editor's MCP server for this chat. */
  mcpUrl: string;
  systemPrompt: string;
  model: string;
  /** How hard it thinks, or null for its default. */
  effort: string | null;
  /** The conversation to continue. */
  resume: string | null;
  handlers: AgentHandlers;
}

export interface Agent {
  /** Answer a message as the chat's assistant message `messageId`. */
  send(messageId: string, prompt: string): void;
  /** Stop the turn in progress (it then ends, usually as an error or "interrupted"). */
  interrupt(): void;
  /** Quit the process. */
  stop(): void;
}

export interface JsonLinesOptions {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  onLine: (line: unknown) => void;
  onExit: (error: string | null) => void;
}

/** A child process that speaks newline-delimited JSON on stdin/stdout. */
export class JsonLinesProcess {
  private stdin: Writable;
  private kill: () => void;
  private exited = false;
  private stopping = false;

  constructor(opts: JsonLinesOptions) {
    const { child, done } = spawnStreaming(opts.argv, "pipe", "pipe", { cwd: opts.cwd, env: opts.env });
    this.stdin = child.stdin!;
    this.stdin.on("error", () => {}); // it died; `done` reports why
    this.kill = () => child.kill("SIGTERM");
    let buffer = "";
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        opts.onLine(parsed);
      }
    });
    const finish = (error: string | null) => {
      if (this.exited) return;
      this.exited = true;
      if (error && !this.stopping) log("assistant").warn(`${path.basename(opts.argv[0])} stopped: ${error}`);
      opts.onExit(error);
    };
    done.then(
      () => finish(null),
      (err: Error) => finish(err.message),
    );
  }

  get alive(): boolean {
    return !this.exited;
  }

  write(message: unknown): void {
    if (!this.exited) this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  stop(): void {
    this.stopping = true;
    if (!this.exited) this.kill();
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
