/**
 * What the main process and the server's process (server-process.ts, started by server-host.ts) say to each
 * other over the utility process's port. Plain JSON-able objects: they're structured-cloned across.
 */
import type { EngineWindowEvent } from "../server/app.ts";
import type { HostWindow } from "../shared/music/engine.ts";

/** How the server is started: its options and the environment the main process worked out (server/config.ts reads it). */
export interface ServerStart {
  type: "start";
  options: { dataDir: string; clientDir?: string; ports: number[]; console: boolean };
  env: Record<string, string>;
}

/** What the main process asks of the server. */
export type ServerCall =
  | { method: "setHostWindow"; host: HostWindow }
  | { method: "raiseEngineWindow"; owner: "channel" | "effect"; id: string }
  | { method: "closeEngineWindows" };

/** What the server asks of the main process: what only Electron's main process can do. */
export type HostCall =
  | { method: "trash"; dir: string }
  | { method: "reveal"; dir: string }
  /** The export's drawing page, in a hidden window: an id to evaluate in it and close it by. */
  | { method: "glOpen"; url: string }
  | { method: "glEvaluate"; pageId: number; source: string; arg: unknown }
  | { method: "glClose"; pageId: number };

export type ServerMessage =
  | ServerStart
  | { type: "ready"; port: number }
  | { type: "failed"; error: string }
  | { type: "call"; id: number; call: ServerCall | HostCall }
  | { type: "reply"; id: number; ok: true; value: unknown }
  | { type: "reply"; id: number; ok: false; error: string }
  | { type: "engineWindow"; event: EngineWindowEvent }
  | { type: "log"; text: string }
  | { type: "close" }
  | { type: "closed" };

export const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));
