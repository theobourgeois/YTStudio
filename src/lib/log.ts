/**
 * The tab's side of the app's log (server/log.ts): a line is printed in the console and, from info up, sent to
 * the server's file (`POST /api/log`), so what went wrong in the page is still there after it's closed. The
 * page's own uncaught errors go too (`watchPageErrors`).
 *
 * Sending never gets in the way: lines wait a couple of seconds and go together, a line that comes again while
 * it waits is counted rather than sent twice (a failure every frame is one line), a flood is cut to a burst, and
 * what's waiting as the page goes is sent with `sendBeacon`.
 */
import { type LogLevel, PAGE_LOG_LIMITS, type PageLogEntry, logs } from "@shared/log";

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

const SEND_MS = 2000;
/** At most this many lines a minute go to the server; the rest are counted, and said with the next. */
const BURST_LINES = 100;
const BURST_MS = 60_000;
/** Errors the browser raises that aren't faults (ResizeObserver's, a request let go of). */
const NOT_FAULTS = /ResizeObserver loop|AbortError/;

/** Lines waiting to go, by what they say (so a repeat is counted on the one waiting). */
const waiting = new Map<string, PageLogEntry>();
let timer: ReturnType<typeof setTimeout> | null = null;
let burst = { start: 0, count: 0, dropped: 0 };
const loggers = new Map<string, Logger>();
/** Only a page served by the app has a server to send to (not unit tests). */
const sends = typeof window !== "undefined" && /^https?:$/.test(window.location.protocol);

/** A scope's logger ("autosave", "photo"): printed as `[scope] message`, and kept in the app's log. */
export function log(scope: string): Logger {
  let logger = loggers.get(scope);
  if (!logger) {
    logger = {
      debug: (message, detail) => write("debug", scope, message, detail),
      info: (message, detail) => write("info", scope, message, detail),
      warn: (message, detail) => write("warn", scope, message, detail),
      error: (message, detail) => write("error", scope, message, detail),
    };
    loggers.set(scope, logger);
  }
  return logger;
}

/** The page's uncaught errors and unhandled rejections into the log (the browser prints them itself). */
export function watchPageErrors(): void {
  if (!sends) return;
  window.addEventListener("error", (event) => {
    if (NOT_FAULTS.test(event.message)) return;
    const where = event.filename ? ` (${event.filename.replace(window.location.origin, "")}:${event.lineno}:${event.colno})` : "";
    keep("error", "page", `${event.message}${where}`, event.error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    if (NOT_FAULTS.test(errorName(reason))) return;
    keep("error", "page", "an unhandled rejection", reason);
  });
  // The last lines go as the page does (closing, reloading); a fetch then may never leave.
  window.addEventListener("pagehide", () => send(true));
}

function write(level: LogLevel, scope: string, message: string, detail: unknown) {
  const out = level === "error" ? console.error : level === "warn" ? console.warn : level === "info" ? console.info : console.debug;
  if (detail === undefined) out(`[${scope}] ${message}`);
  else out(`[${scope}] ${message}`, detail);
  if (logs(level, "info")) keep(level, scope, message, detail);
}

/** Queue a line for the server. */
function keep(level: LogLevel, scope: string, message: string, detail: unknown) {
  if (!sends) return;
  const entry: PageLogEntry = { level, scope, message: message.slice(0, PAGE_LOG_LIMITS.message), time: Date.now(), ...described(detail) };
  const key = `${level}\0${scope}\0${entry.message}\0${entry.error ?? ""}`;
  const same = waiting.get(key);
  if (same) return void (same.repeats = (same.repeats ?? 1) + 1);
  if (entry.time - burst.start >= BURST_MS) {
    const { dropped } = burst;
    burst = { start: entry.time, count: 0, dropped: 0 };
    if (dropped) waiting.set(`dropped\0${entry.time}`, { level: "warn", scope: "log", message: `${dropped} more lines left out (over ${BURST_LINES} a minute)`, time: entry.time });
  }
  if (burst.count >= BURST_LINES) return void burst.dropped++;
  burst.count++;
  waiting.set(key, entry);
  timer ??= setTimeout(() => send(false), SEND_MS);
}

/** Everything waiting, in batches the server takes; `leaving`: by beacon, as the page goes. */
function send(leaving: boolean) {
  if (timer) clearTimeout(timer);
  timer = null;
  const entries = [...waiting.values()];
  waiting.clear();
  for (let i = 0; i < entries.length; i += PAGE_LOG_LIMITS.entries) {
    const body = JSON.stringify({ entries: entries.slice(i, i + PAGE_LOG_LIMITS.entries) });
    if (leaving) navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" }));
    // Nothing to say if this fails: the server is the log.
    else void fetch("/api/log", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: body.length < 60_000 }).catch(() => {});
  }
}

/** A detail as a line carries it: an error's message and stack (from any window: no `instanceof`), else as text. */
function described(detail: unknown): Pick<PageLogEntry, "error" | "stack"> {
  if (detail === undefined) return {};
  if (typeof detail === "object" && detail !== null && "message" in detail) {
    const { message, stack } = detail as { message: unknown; stack?: unknown };
    return {
      error: String(message).slice(0, PAGE_LOG_LIMITS.message),
      ...(typeof stack === "string" && { stack: stack.slice(0, PAGE_LOG_LIMITS.stack) }),
    };
  }
  let text: string;
  try {
    text = typeof detail === "string" ? detail : JSON.stringify(detail) ?? String(detail);
  } catch {
    text = String(detail);
  }
  return { error: text.slice(0, PAGE_LOG_LIMITS.message) };
}

const errorName = (reason: unknown) => (typeof reason === "object" && reason !== null && "name" in reason ? String(reason.name) : "");
