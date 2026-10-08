/**
 * Running external programs (ffmpeg, ffprobe, yt-dlp, osascript...): always an
 * argv array, never a shell. Failures become one-line errors built from the
 * tail of stderr.
 */
import { type ChildProcessByStdio, spawn } from "node:child_process";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { log } from "./log.ts";

const STDERR_TAIL_BYTES = 8 * 1024;
/** Every program's end, at debug (a failure that matters is its caller's to say, which knows whether it does). */
const logger = log("process");

/** JavaScript stand-ins and CLIs must run through Node on Windows (no shebang execution). */
function processCommand(command: string, args: string[], env?: Record<string, string>) {
  const script = /\.(mjs|cjs|js)$/i.test(command);
  return {
    command: script ? process.execPath : command,
    args: script ? [command, ...args] : args,
    env: { ...process.env, ...env, ...(script && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
  };
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Receives stdout as it arrives; when set, stdout is not buffered. */
  onStdout?: (chunk: Buffer) => void;
  /** Receives stderr as it arrives (e.g. progress lines); the tail is still kept for errors. */
  onStderr?: (chunk: Buffer) => void;
  /** Extra environment variables. */
  env?: Record<string, string>;
}

/**
 * Run a command to completion. Resolves with stdout (unless streamed via
 * `onStdout`); rejects with the tail of stderr on failure, or with the
 * signal's reason when aborted (the process is killed).
 */
export function run(command: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const { signal, onStdout, onStderr, env } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const launch = processCommand(command, args, env);
    const child = spawn(launch.command, launch.args, { stdio: ["ignore", "pipe", "pipe"], env: launch.env, windowsHide: true });
    const ended = endLogger(command);
    const out: Buffer[] = [];
    const stderr = keepStderrTail(child.stderr);
    if (onStderr) child.stderr.on("data", onStderr);

    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => (onStdout ? onStdout(chunk) : out.push(chunk)));
    child.on("error", (err: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
      reject(spawnError(command, err));
    });
    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      ended(signal?.aborted ? "cancelled" : code ?? sig);
      if (signal?.aborted) return reject(signal.reason);
      if (code === 0) return resolve(Buffer.concat(out).toString("utf8"));
      reject(new Error(summarizeStderr(stderr()) || `${command} exited with ${code ?? sig}`));
    });
  });
}

type StreamingChild = ChildProcessByStdio<Writable | null, Readable | null, Readable>;

/**
 * Start a command whose stdin/stdout are streamed by the caller. `done`
 * settles when it exits (rejecting with its stderr tail); an unawaited
 * rejection is not reported as unhandled, since cancelled work never awaits it.
 */
export function spawnStreaming(
  argv: string[],
  stdin: "pipe" | "ignore",
  stdout: "pipe" | "ignore",
  opts: { cwd?: string; env?: Record<string, string>; onStderr?: (chunk: Buffer) => void } = {},
) {
  const launch = processCommand(argv[0], argv.slice(1), opts.env);
  const child = spawn(launch.command, launch.args, {
    stdio: [stdin, stdout, "pipe"],
    cwd: opts.cwd,
    env: launch.env,
    windowsHide: true,
  }) as StreamingChild;
  const stderr = keepStderrTail(child.stderr);
  if (opts.onStderr) child.stderr.on("data", opts.onStderr);
  const ended = endLogger(argv[0]);
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) => reject(spawnError(argv[0], err)));
    child.on("close", (code, sig) => {
      ended(code ?? sig);
      if (code === 0) resolve();
      else reject(new Error(summarizeStderr(stderr()) || `${argv[0]} exited with ${code ?? sig}`));
    });
  });
  done.catch(() => {});
  return { child, done };
}

/** Says how long a program ran and how it ended, at debug: only its name, never its arguments (they name the user's files). */
function endLogger(command: string): (end: number | string | null) => void {
  if (!logger.enabled("debug")) return () => {};
  const started = performance.now();
  const name = path.basename(command);
  return (end) => logger.debug(`${name} ${typeof end === "number" ? `exited ${end}` : end ?? "ended"} after ${Math.round(performance.now() - started)} ms`);
}

/** Show a file or folder in Finder, selected (macOS; elsewhere nothing: the desktop app passes the system's own). */
export async function revealInFinder(target: string): Promise<void> {
  if (process.platform === "darwin") await run("open", ["-R", target]);
}

export const isAbortError = (err: unknown) => (err as { name?: unknown })?.name === "AbortError";

function keepStderrTail(stream: Readable): () => string {
  let tail = "";
  stream.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
  });
  return () => tail;
}

function spawnError(command: string, err: NodeJS.ErrnoException): Error {
  return err.code === "ENOENT" ? new Error(`${command} not found — is it installed?`) : err;
}

/** The last few meaningful stderr lines, as a one-line error message. */
function summarizeStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" · ")
    .slice(0, 500);
}

/** The first of `candidates` (commands or paths) that runs with `args`, or null when none does. */
export async function firstThatRuns(candidates: string[], args: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      await run(c, args);
      return c;
    } catch {
      // not there
    }
  }
  return null;
}
