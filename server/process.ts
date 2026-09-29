/**
 * Running external programs (ffmpeg, ffprobe, yt-dlp, osascript...): always an
 * argv array, never a shell. Failures become one-line errors built from the
 * tail of stderr.
 */
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const STDERR_TAIL_BYTES = 8 * 1024;

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
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: env && { ...process.env, ...env } });
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
export function spawnStreaming(argv: string[], stdin: "pipe" | "ignore", stdout: "pipe" | "ignore") {
  const child = spawn(argv[0], argv.slice(1), { stdio: [stdin, stdout, "pipe"] }) as StreamingChild;
  const stderr = keepStderrTail(child.stderr);
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) => reject(spawnError(argv[0], err)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(summarizeStderr(stderr()) || `${argv[0]} exited with ${code}`));
    });
  });
  done.catch(() => {});
  return { child, done };
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
