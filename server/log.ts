/**
 * The app's log: what the server, the audio engine, the desktop app and the tab did that's worth knowing later,
 * above all what went wrong. A line of JSON each in `<data>/logs/ytstudio.log` (moved aside to `ytstudio.1.log`… as
 * it grows, a few kept), and the console in development.
 *
 * Logging never waits on the disk: lines are gathered and appended in the background a few times a second, and
 * written at once only as the process goes down. A line below the level costs a comparison; a scope that floods
 * (a failure every frame) is held to a burst, the rest counted.
 *
 * Before `startLogging` (tests, scripts) nothing is written and only warnings and errors are printed.
 */
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { type LogLevel, type PageLogEntry, logs } from "../shared/log.ts";

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
  /** Whether a line at `level` would go anywhere (to skip work that only builds one). */
  enabled(level: LogLevel): boolean;
}

export interface LoggerOptions {
  /** Kept in the file, never printed: another program's chatter (the engine's stderr), the tab's own lines. */
  quiet?: boolean;
}

export interface LoggingOptions {
  /** The folder the files go in (`<data>/logs`). */
  dir: string;
  level?: LogLevel;
  /** Print what's written to the console too (development; a packaged app has none). */
  console?: boolean;
  /** Said in the first line: the app's version, what runs it. */
  about?: Record<string, unknown>;
  /**
   * Hand each batch of lines to another process to write (the desktop app's server runs in a process of its
   * own; its lines go in the main process's file, `writeLogLines`): `dir` is then only the file's name.
   */
  forward?: (text: string) => void;
}

const FILE_NAME = "ytstudio.log";
/** A file is moved aside past this, and `KEEP` files are kept in all: at most about 15 MB. */
const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;
const FLUSH_MS = 250;
/** Lines waiting past this (a disk that's stuck) are counted rather than kept. */
const MAX_QUEUED_BYTES = 1024 * 1024;
/** A scope writes at most `BURST_LINES` lines in `BURST_MS`; the rest are counted and said with its next line. */
const BURST_LINES = 100;
const BURST_MS = 10_000;

let fileLevel: LogLevel | null = null;
let consoleLevel: LogLevel | null = "warn";
let sink: LogFile | ForwardedLog | null = null;
const loggers = new Map<string, Logger>();
const bursts = new Map<string, { start: number; count: number; dropped: number }>();

/** Write the log into `dir` from now on (the server's entry points: server/index.ts, the desktop app). */
export function startLogging({ dir, level = "info", console: print = true, about, forward }: LoggingOptions): void {
  const first = sink === null;
  sink?.flushSync();
  sink = forward ? new ForwardedLog(path.join(dir, FILE_NAME), forward) : new LogFile(dir);
  fileLevel = level;
  consoleLevel = print ? level : null;
  if (first) watchProcess();
  log("app").info("started", {
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    ...(process.versions.electron && { electron: process.versions.electron }),
    ...about,
  });
}

/** The file being written, or null before `startLogging`. */
export const logFile = (): string | null => sink?.file ?? null;

/** Everything waiting written, after what's being written now (tests; the process going down writes it itself). */
export const settleLog = async () => sink?.settle();

/** A scope's logger ("engine", "export", "projects"): the same one for every call with the same scope and options. */
export function log(scope: string, options: LoggerOptions = {}): Logger {
  const key = options.quiet ? `${scope}\0quiet` : scope;
  let logger = loggers.get(key);
  if (!logger) {
    const quiet = options.quiet ?? false;
    logger = {
      debug: (message, detail) => write("debug", scope, message, detail, quiet),
      info: (message, detail) => write("info", scope, message, detail, quiet),
      warn: (message, detail) => write("warn", scope, message, detail, quiet),
      error: (message, detail) => write("error", scope, message, detail, quiet),
      enabled: (level) => goesToFile(level) || (!quiet && goesToConsole(level)),
    };
    loggers.set(key, logger);
  }
  return logger;
}

/** How long since `since` (a `performance.now()`), as a line says it: "12.3 s". */
export const elapsed = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

/** The tab's lines (`POST /api/log`), into the file alone: the tab printed them in its own console. */
export function writePageLog(entries: readonly PageLogEntry[]): void {
  for (const entry of entries) {
    if (!goesToFile(entry.level) || !admit(`tab:${entry.scope}`, Date.now())) continue;
    sink!.push(line({
      time: new Date(entry.time).toISOString(),
      level: entry.level,
      scope: entry.scope,
      from: "tab",
      message: entry.message,
      ...(entry.error !== undefined && { error: entry.error }),
      ...(entry.stack !== undefined && { stack: entry.stack }),
      ...(entry.repeats && { repeats: entry.repeats }),
    }));
  }
}

/**
 * A program's output (its stderr) a line at a time into `logger` at `level`, for `onStderr`. Nothing is split
 * while the level isn't written.
 */
export function lineLogger(logger: Logger, level: LogLevel = "info"): (chunk: Buffer | string) => void {
  let rest = "";
  return (chunk) => {
    if (!logger.enabled(level)) return void (rest = "");
    const lines = (rest + chunk.toString()).split(/\r?\n/);
    rest = lines.pop()!.slice(-4096);
    for (const text of lines) if (text.trim()) logger[level](text.trimEnd());
  };
}

const goesToFile = (level: LogLevel) => sink !== null && fileLevel !== null && logs(level, fileLevel);
const goesToConsole = (level: LogLevel) => consoleLevel !== null && logs(level, consoleLevel);

function write(level: LogLevel, scope: string, message: string, detail: unknown, quiet: boolean) {
  const toFile = goesToFile(level);
  const toConsole = !quiet && goesToConsole(level);
  if ((!toFile && !toConsole) || !admit(scope, Date.now())) return;
  if (toConsole) print(level, scope, message, detail);
  if (toFile) sink!.push(line({ time: new Date().toISOString(), level, scope, message, ...details(detail) }));
}

/** Whether a scope may write another line now; one that's been held back says how many lines it lost first. */
function admit(scope: string, now: number): boolean {
  let burst = bursts.get(scope);
  if (!burst || now - burst.start >= BURST_MS) {
    const dropped = burst?.dropped ?? 0;
    burst = { start: now, count: 0, dropped: 0 };
    bursts.set(scope, burst);
    if (dropped) {
      burst.count++;
      const message = `${dropped} more line${dropped === 1 ? "" : "s"} left out (over ${BURST_LINES} in ${BURST_MS / 1000} s)`;
      if (goesToConsole("warn")) print("warn", scope, message, undefined);
      if (goesToFile("warn")) sink!.push(line({ time: new Date(now).toISOString(), level: "warn", scope, message }));
    }
  }
  if (burst.count >= BURST_LINES) {
    burst.dropped++;
    return false;
  }
  burst.count++;
  return true;
}

function print(level: LogLevel, scope: string, message: string, detail: unknown) {
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  // The detail as it is: the console shows an error's stack and an object's fields itself.
  if (detail === undefined) out(`[${scope}] ${message}`);
  else out(`[${scope}] ${message}`, detail);
}

/** What a line says about its detail: an error's message, code and stack, or the fields given. */
function details(detail: unknown): Record<string, unknown> {
  if (detail === undefined) return {};
  if (detail instanceof Error) {
    const code = (detail as NodeJS.ErrnoException).code;
    return { error: detail.message, ...(code !== undefined && { code }), ...(detail.stack && { stack: detail.stack }) };
  }
  if (typeof detail === "object" && detail !== null) return { fields: detail };
  return { detail: String(detail) };
}

/** One line of JSON; fields that can't be written (a cycle, a BigInt) are written as text. */
function line(entry: Record<string, unknown>): string {
  try {
    return `${JSON.stringify(entry)}\n`;
  } catch {
    return `${JSON.stringify({ ...entry, fields: String(entry.fields) })}\n`;
  }
}

/** A crash is written before the process goes, with what led up to it; Node's warnings are kept too. */
function watchProcess() {
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    log("crash").error(origin === "unhandledRejection" ? "an unhandled rejection" : "an uncaught exception", error);
    sink?.flushSync();
  });
  process.on("warning", (warning) => log("node").warn(warning.message, warning));
  process.on("exit", (code) => {
    log("app").info(`exiting (${code})`);
    sink?.flushSync();
  });
}

/** Lines written for another process (`LoggingOptions.forward`), handed on in batches as `LogFile` writes them. */
class ForwardedLog {
  private queue: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly file: string,
    private readonly forward: (text: string) => void,
  ) {}

  push(text: string) {
    this.queue.push(text);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flushSync(), FLUSH_MS);
    this.timer.unref();
  }

  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    const text = this.queue.join("");
    this.queue = [];
    try {
      this.forward(text);
    } catch {
      // nowhere to say so
    }
  }

  async settle() {
    this.flushSync();
  }
}

/** Lines another process wrote (`LoggingOptions.forward`), into this one's file. */
export function writeLogLines(text: string): void {
  if (text) sink?.push(text);
}

/** The file, appended to in the background a batch at a time, moved aside when it's grown too big. */
class LogFile {
  readonly file: string;
  private size = 0;
  private queue: string[] = [];
  private queued = 0;
  private dropped = 0;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;

  constructor(readonly dir: string) {
    this.file = path.join(dir, FILE_NAME);
    try {
      mkdirSync(dir, { recursive: true });
      this.size = statSync(this.file).size;
    } catch {
      // not there yet
    }
  }

  push(text: string) {
    if (this.queued > MAX_QUEUED_BYTES) return void this.dropped++;
    this.queue.push(text);
    this.queued += text.length;
    this.schedule();
  }

  /** Everything waiting, now (the process is going down). */
  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = this.take();
    if (!text) return;
    try {
      appendFileSync(this.file, text);
      this.size += Buffer.byteLength(text);
    } catch {
      // nowhere to say so
    }
  }

  async settle() {
    for (;;) {
      if (this.writing) await this.writing;
      else if (this.queue.length || this.dropped) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        await this.write();
      } else return;
    }
  }

  private schedule() {
    if (this.timer || this.writing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.write();
    }, FLUSH_MS);
    this.timer.unref();
  }

  /** One batch at a time, so lines land in order. */
  private write(): Promise<void> {
    this.writing = this.drain().finally(() => {
      this.writing = null;
      if (this.queue.length || this.dropped) this.schedule();
    });
    return this.writing;
  }

  private take(): string {
    let text = this.queue.join("");
    if (this.dropped) {
      const message = `${this.dropped} lines left out: the disk wasn't keeping up`;
      text += line({ time: new Date().toISOString(), level: "warn", scope: "log", message });
    }
    this.queue = [];
    this.queued = 0;
    this.dropped = 0;
    return text;
  }

  private async drain() {
    const text = this.take();
    if (!text) return;
    const bytes = Buffer.byteLength(text);
    try {
      if (this.size > 0 && this.size + bytes > MAX_BYTES) await this.rotate();
      await fs.appendFile(this.file, text);
      this.size += bytes;
    } catch {
      // nowhere to say so
    }
  }

  /** `ytstudio.log` becomes `ytstudio.1.log`, that `ytstudio.2.log`…; the oldest is written over. */
  private async rotate() {
    const name = (n: number) => path.join(this.dir, n === 0 ? FILE_NAME : FILE_NAME.replace(/\.log$/, `.${n}.log`));
    for (let n = KEEP - 1; n >= 1; n--) await fs.rename(name(n - 1), name(n)).catch(() => {});
    this.size = 0;
  }
}
