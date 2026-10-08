/**
 * The app's log, as both sides see it: its levels, and what the tab sends the server (`POST /api/log`).
 * The server writes it (server/log.ts); the tab's own lines come through src/lib/log.ts.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Quietest first: a logger set to a level writes it and everything after it. */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export const isLogLevel = (value: unknown): value is LogLevel => LOG_LEVELS.includes(value as LogLevel);

/** Whether a line at `level` is written by a logger set to `threshold`. */
export const logs = (level: LogLevel, threshold: LogLevel) => LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);

/** A line of the tab's, as it's sent. */
export interface PageLogEntry {
  level: LogLevel;
  /** What it's about ("autosave", "photo"): short, a word or two. */
  scope: string;
  message: string;
  /** When it happened in the tab (ms since the epoch). */
  time: number;
  /** An error's message and stack, when the line came with one. */
  error?: string;
  stack?: string;
  /** How many times in a row the same line came, folded into this one. */
  repeats?: number;
}

/** What one `POST /api/log` may carry (a page closing sends its last lines with `sendBeacon`, which takes 64 KiB). */
export const PAGE_LOG_LIMITS = { entries: 50, scope: 40, message: 2000, stack: 8000 } as const;

/**
 * The entries of a `POST /api/log` body (`{ entries }`), or null when it isn't one. Text past the limits is cut
 * short rather than refused: a long stack still says where it started.
 */
export function pageLogEntries(body: unknown): PageLogEntry[] | null {
  const list = (body as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(list) || list.length > PAGE_LOG_LIMITS.entries) return null;
  const entries: PageLogEntry[] = [];
  for (const item of list) {
    const e = item as Partial<Record<keyof PageLogEntry, unknown>> | null;
    if (!e || !isLogLevel(e.level) || typeof e.scope !== "string" || typeof e.message !== "string") return null;
    // A moment a Date can say (±8.64e15 ms).
    if (typeof e.time !== "number" || !(Math.abs(e.time) <= 8.64e15)) return null;
    const scope = e.scope.slice(0, PAGE_LOG_LIMITS.scope).replace(/[^\w./:-]/g, "_");
    entries.push({
      level: e.level,
      scope: scope || "page",
      message: e.message.slice(0, PAGE_LOG_LIMITS.message),
      time: e.time,
      ...(typeof e.error === "string" && { error: e.error.slice(0, PAGE_LOG_LIMITS.message) }),
      ...(typeof e.stack === "string" && { stack: e.stack.slice(0, PAGE_LOG_LIMITS.stack) }),
      ...(typeof e.repeats === "number" && Number.isInteger(e.repeats) && e.repeats > 1 && { repeats: e.repeats }),
    });
  }
  return entries;
}
