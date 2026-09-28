import { spawn } from "node:child_process";
import { FFMPEG } from "./config.ts";

const STDERR_TAIL_BYTES = 8 * 1024;

export interface RunOptions {
  signal?: AbortSignal;
  /** Receives stdout as it arrives; when set, stdout is not buffered. */
  onStdout?: (chunk: Buffer) => void;
}

/**
 * Run a command (argv array, never a shell). Resolves with stdout (unless
 * streamed via `onStdout`); rejects with the tail of stderr on failure, or with
 * the signal's reason when aborted (the process is killed).
 */
export function run(command: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const { signal, onStdout } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";

    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => (onStdout ? onStdout(chunk) : out.push(chunk)));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL_BYTES);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err.code === "ENOENT" ? new Error(`${command} not found — is it installed?`) : err);
    });
    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(signal.reason);
      if (code === 0) return resolve(Buffer.concat(out).toString("utf8"));
      reject(new Error(summarizeStderr(stderr) || `${command} exited with ${code ?? sig}`));
    });
  });
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

export const isAbortError = (err: unknown) => (err as { name?: unknown })?.name === "AbortError";

let versionPromise: Promise<string | null> | undefined;

/** ffmpeg's version string (e.g. "8.1.2"), or null when it can't be run. Cached. */
export function ffmpegVersion(): Promise<string | null> {
  versionPromise ??= run(FFMPEG, ["-hide_banner", "-version"]).then(
    (out) => /ffmpeg version (\S+)/.exec(out)?.[1] ?? "unknown",
    () => null,
  );
  return versionPromise;
}
