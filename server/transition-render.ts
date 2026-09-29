/**
 * Draw the transitions a render needs (`planTransitions`) with the headless
 * GL page: for each one, ffmpeg decodes both sides as raw canvas-sized frames,
 * the page mixes them frame by frame with the transition's shader, and
 * another ffmpeg keeps the result as a lossless file with transparency
 * (FFV1), which the main render then uses in place of that stretch.
 */
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable, Writable } from "node:stream";
import { transitionShader, transitionUniforms } from "../shared/transition-gl.ts";
import { FFMPEG } from "./config.ts";
import { GlSession } from "./gl-browser.ts";
import type { TransitionJob } from "./render.ts";

const STDERR_TAIL = 4 * 1024;

type Child = ChildProcessByStdio<Writable | null, Readable | null, Readable>;

/** A child process whose exit becomes a promise (rejecting with its stderr tail). */
function start(argv: string[], stdin: "pipe" | "ignore", stdout: "pipe" | "ignore") {
  const child = spawn(argv[0], argv.slice(1), { stdio: [stdin, stdout, "pipe"] }) as Child;
  let stderr = "";
  child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString("utf8")).slice(-STDERR_TAIL)));
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error(`${argv[0]} not found — is it installed?`) : err),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").slice(-2).join(" · ") || `${argv[0]} exited with ${code}`));
    });
  });
  // Rejections are awaited later (or not at all when cancelled).
  done.catch(() => {});
  return { child, done };
}

/** Reads fixed-size frames from a stream, pausing it while two are waiting. */
export class FrameReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private ended = false;
  private wake: (() => void) | null = null;
  private discarding = false;

  constructor(
    private readonly stream: Readable,
    private readonly frameSize: number,
  ) {
    stream.on("data", (chunk: Buffer) => {
      if (this.discarding) return;
      this.chunks.push(chunk);
      this.size += chunk.length;
      if (this.size >= frameSize * 2) stream.pause();
      this.wake?.();
    });
    const end = () => {
      this.ended = true;
      this.wake?.();
    };
    stream.on("end", end);
    stream.on("close", end);
    stream.on("error", end);
  }

  /** Throw away anything else the stream sends (so its writer can finish). */
  discard() {
    this.discarding = true;
    this.chunks = [];
    this.size = 0;
    this.stream.resume();
  }

  /** The next frame, or null once the stream ends without a whole one. */
  async read(): Promise<Buffer | null> {
    while (this.size < this.frameSize && !this.ended) {
      this.stream.resume();
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
    if (this.size < this.frameSize) return null;
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
    const frame = all.subarray(0, this.frameSize);
    const rest = all.subarray(this.frameSize);
    this.chunks = rest.length ? [rest] : [];
    this.size = rest.length;
    if (this.size < this.frameSize * 2) this.stream.resume();
    return frame;
  }
}

/**
 * Render every job to a file from `tmpFile` (the caller deletes them).
 * Returns the files by job id; `onFrame` is called after each frame.
 */
export async function renderTransitions(
  jobs: TransitionJob[],
  tmpFile: (ext: string) => string,
  signal: AbortSignal,
  onFrame: () => void,
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  if (jobs.length === 0) return files;
  const session = await GlSession.open();
  const children: Child[] = [];
  const kill = () => children.forEach((c) => c.kill("SIGKILL"));
  signal.addEventListener("abort", kill, { once: true });
  try {
    for (const job of jobs) {
      signal.throwIfAborted();
      const { width: W, height: H, fps: F } = job;
      await session.setup(W, H);
      const file = tmpFile(".mkv");
      files[job.id] = file;

      const sides = job.sides.map((argv) => (argv ? start(argv, "ignore", "pipe") : null));
      const readers = sides.map((s) => (s ? new FrameReader(s.child.stdout!, W * H * 4) : null));
      const encoder = start(
        [
          FFMPEG, "-hide_banner", "-nostdin", "-loglevel", "error",
          "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(F), "-i", "pipe:0",
          "-c:v", "ffv1", "-pix_fmt", "bgra", "-y", file,
        ],
        "pipe",
        "ignore",
      );
      for (const s of [...sides, encoder]) if (s) children.push(s.child);

      const { def, transition } = job.window;
      const shader = transitionShader(def);
      const uniforms = transitionUniforms(def, transition.params);
      const stdin = encoder.child.stdin!;
      for (const progress of job.progress) {
        signal.throwIfAborted();
        const [from, to] = await Promise.all(readers.map((r) => r?.read() ?? null));
        if (readers.some((r, i) => r && ![from, to][i])) break; // a decoder failed; its error is reported below
        const frame = await session.frame(shader, uniforms, progress, from, to);
        if (!stdin.write(frame)) await once(stdin, "drain");
        onFrame();
      }
      stdin.end();
      for (const r of readers) r?.discard();
      await Promise.all([...sides.map((s) => s?.done), encoder.done]);
      children.length = 0;
    }
    return files;
  } finally {
    signal.removeEventListener("abort", kill);
    kill();
    await session.close();
  }
}
