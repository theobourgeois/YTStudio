/**
 * Draw an export's video (`planRender`) with the headless compositor page:
 * each clip's ffmpeg decodes its pictures as raw frames, the page composites
 * every output frame from them, and the encoder (fed raw frames on stdin)
 * writes the final file. The three run side by side: decoders start a little
 * ahead of their first frame and keep a couple of frames ready, and a few
 * finished frames can queue up for the encoder.
 */
import { once } from "node:events";
import type { Readable } from "node:stream";
import { type CompositeJob, type FramePacket, GlSession } from "./gl-browser.ts";
import { compileProblems, problemText } from "../shared/shader-code.ts";
import { spawnStreaming } from "./process.ts";
import { type FrameLayer, type RenderPlan, type RenderSource, frameBytes, sourceFrameBytes } from "./render.ts";

type Spawned = ReturnType<typeof spawnStreaming>;

/** Finished frames that may wait for the encoder before drawing pauses. */
const ENCODER_QUEUE = 3;

/** Reads fixed-size frames from a stream, pausing it while two are waiting. */
class FrameReader {
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

/** A running source: its ffmpeg and the next output frame its stream is at (or a drawn text's PNG). */
class Decoder {
  private readonly reader: FrameReader | null;
  private next: number;
  /** A still's one frame, once read. */
  private still: Buffer | null;
  /** A still has been sent to the page (which keeps it until it's released). */
  sent = false;
  /** A time-interpolated source's frames read so far (the last two), and which were last sent. */
  private native: { read: number; frames: [Buffer | null, Buffer | null]; sentIndex: number } = {
    read: 0,
    frames: [null, null],
    sentIndex: -1,
  };

  constructor(
    readonly source: RenderSource,
    readonly process: Spawned | null,
  ) {
    this.reader = process ? new FrameReader(process.child.stdout!, sourceFrameBytes(source)) : null;
    this.still = null;
    this.next = source.first;
  }

  /** The picture for output frame `f` (frames before it are skipped). */
  async frameAt(f: number): Promise<Buffer> {
    if (this.source.still) {
      this.still ??= await this.read();
      return this.still;
    }
    while (this.next < f) {
      await this.read();
      this.next++;
    }
    this.next = f + 1;
    return this.read();
  }

  /**
   * A time-interpolated source's frames `index` and `index + 1` (read in order as they're
   * needed; the media's last frame stands in past its end), or null when they were sent already.
   */
  async nativePair(index: number): Promise<{ a: Buffer; b: Buffer } | null> {
    const n = this.native;
    if (index === n.sentIndex) return null;
    // Read on to the frame after `index` (or the end of the media); output frames only move forwards.
    while (n.read < index + 2) {
      const frame = (await this.reader?.read()) ?? null;
      if (!frame) break;
      n.frames = [n.frames[1], frame];
      n.read++;
    }
    const last = n.read - 1;
    if (last < 0 || !n.frames[1]) {
      await this.process?.done;
      throw new Error("A clip's media ended before its last frame.");
    }
    const frame = (i: number) => (i >= last ? n.frames[1]! : (n.frames[0] ?? n.frames[1]!));
    n.sentIndex = index;
    return { a: frame(index), b: frame(index + 1) };
  }

  close() {
    this.reader?.discard();
  }

  private async read(): Promise<Buffer> {
    const frame = await this.reader?.read();
    if (frame) return frame;
    await this.process?.done; // rejects with ffmpeg's error
    throw new Error("A clip's media ended before its last frame.");
  }
}

/** Refuse to start when a user's shader (the Shader effect) doesn't compile, naming where it's used. */
async function checkShaders(session: GlSession, plan: RenderPlan): Promise<void> {
  const user = Object.fromEntries(Object.entries(plan.shaders).filter(([key]) => key.startsWith("fx:shader:")));
  if (!Object.keys(user).length) return;
  const failed = await session.compile(user);
  const [key, log] = Object.entries(failed)[0] ?? [];
  if (!key) return;
  const first = compileProblems(log)[0];
  throw new Error(
    `The shader ${plan.shaderUses[key] ?? ""} doesn't compile${first ? ` (${problemText(first)})` : ""}. Fix its code or turn it off, then export again.`,
  );
}

/**
 * Draw every frame of `plan` and encode them with `encoderArgv` (see
 * `encoderArgs`). `onFrame` is called after each frame is handed to the
 * encoder; resolves once the encoder has finished the file.
 */
export async function renderVideo(
  plan: RenderPlan,
  encoderArgv: string[],
  signal: AbortSignal,
  onFrame: () => void,
  output: Pick<CompositeJob, "readback" | "transparent"> = {},
): Promise<void> {
  signal.throwIfAborted();
  const encoder = spawnStreaming(encoderArgv, "pipe", "ignore");
  const kill = () => encoder.child.kill("SIGKILL");
  signal.addEventListener("abort", kill, { once: true });
  try {
    const stdin = encoder.child.stdin!;
    stdin.on("error", () => {}); // a failing encoder reports through `done`
    const frameSize = frameBytes(plan, output.readback);
    await drawFrames(plan, { from: 0, to: plan.frames }, signal, output, async (_frame, data) => {
      stdin.write(data);
      onFrame();
      if (stdin.writableLength > frameSize * ENCODER_QUEUE) await Promise.race([once(stdin, "drain"), encoder.done]);
    });
    stdin.end();
    await encoder.done;
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", kill);
    kill();
  }
}

/**
 * Draw output frames [from, to) of `plan` with the headless compositor page, handing each to `write` in order
 * (awaited, so a slow consumer holds drawing back). The export writes every frame to its encoder; a preview
 * render writes each segment's to its own (`server/render-files.ts`).
 */
export async function drawFrames(
  plan: RenderPlan,
  range: { from: number; to: number },
  signal: AbortSignal,
  output: Pick<CompositeJob, "readback" | "transparent">,
  write: (frame: number, data: Buffer) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();
  const session = await GlSession.open();
  const processes: Spawned[] = [];
  try {
    await checkShaders(session, plan);
  } catch (err) {
    await session.close();
    throw err;
  }
  const kill = () => processes.forEach((p) => p.child.kill("SIGKILL"));
  signal.addEventListener("abort", kill, { once: true });
  try {
    const frameSize = frameBytes(plan, output.readback);

    // Finished frames can come back out of order, and while one is being written: they're written in order,
    // one at a time (a preview render finishes a file between two).
    const finished = new Map<number, Buffer>();
    let written = range.from;
    let writing = Promise.resolve();
    const encode = (frame: number, data: Buffer) => {
      if (data.length !== frameSize) throw new Error("The compositor returned a frame of the wrong size.");
      finished.set(frame, data);
      writing = writing.then(async () => {
        for (let next = finished.get(written); next; next = finished.get(written)) {
          finished.delete(written);
          await write(written++, next);
        }
      });
      return writing;
    };

    // Decoders start this many frames before they're first needed.
    const lookahead = Math.ceil(plan.fps / 2);
    // (Sources wholly outside the range aren't needed; a plan made for the range has none.)
    const pending = plan.sources.filter((s) => s.end > range.from && s.first < range.to).sort((a, b) => a.first - b.first);
    const running = new Map<string, Decoder>();
    let lastGroups = new Set<string>();
    let shaders: Record<string, string> | null = plan.shaders;

    /** Frame f's packet; called for every frame in order (decoders are read in order). */
    const prepare = async (f: number): Promise<FramePacket> => {
      while (pending.length && pending[0].first <= f + lookahead) {
        const source = pending.shift()!;
        const process = spawnStreaming(source.argv, "ignore", "pipe");
        processes.push(process);
        running.set(source.key, new Decoder(source, process));
      }
      const release: string[] = [];
      for (const [key, decoder] of running) {
        if (decoder.source.end > f) continue;
        decoder.close();
        running.delete(key);
        release.push(key);
        if (decoder.source.native) release.push(`${key}+`);
      }

      const layers = plan.frame(f);
      const pictures: FramePacket["pictures"] = [];
      const send = async (key: string | undefined, interpolate?: { key: string; index?: number }) => {
        const decoder = key === undefined ? undefined : running.get(key);
        if (!decoder || pictures.some((p) => p.key === key)) return;
        if (decoder.source.native) {
          // A time-interpolated clip: the two frames either side of this moment, when they change.
          const pair = await decoder.nativePair(interpolate?.index ?? 0);
          if (!pair) return;
          const { width, height, luma } = decoder.source;
          pictures.push({ key: key!, width, height, luma, data: pair.a });
          if (interpolate) pictures.push({ key: interpolate.key, width, height, luma, data: pair.b });
          return;
        }
        // The page keeps a still until it's released.
        if (decoder.source.still && decoder.sent) return;
        decoder.sent = true;
        const { width, height, luma } = decoder.source;
        pictures.push({ key: key!, width, height, luma, data: await decoder.frameAt(f) });
      };
      const groups = new Set<string>();
      const sendAll = async (list: FrameLayer[]) => {
        for (const layer of list) {
          if (layer.kind === "picture") {
            await send(layer.picture.key, layer.picture.interpolate);
            await send(layer.picture.matte?.layer.key, layer.picture.matte?.layer.interpolate);
          } else if (layer.kind === "adjustment") {
            await send(layer.adjustment.matte?.layer.key, layer.adjustment.matte?.layer.interpolate);
          } else if (layer.kind === "transition") {
            await send(layer.from?.key, layer.from?.interpolate);
            await send(layer.to?.key, layer.to?.interpolate);
          } else if (layer.kind === "advance") {
            await send(layer.picture.key, layer.picture.interpolate);
          } else {
            groups.add(layer.key);
            await sendAll(layer.layers);
          }
        }
      };
      await sendAll(layers);
      // A nested sequence's picture is let go once no frame draws it.
      for (const key of lastGroups) if (!groups.has(key)) release.push(key);
      lastGroups = groups;
      const packet = { frame: f, pictures, release, shaders: shaders ?? {}, layers };
      shaders = null;
      return packet;
    };

    let assigned = range.from;
    let prepared: Promise<unknown> = Promise.resolve();
    await session.composite({ width: plan.width, height: plan.height, ...output, first: range.from }, async (done) => {
      signal.throwIfAborted();
      if (done) await encode(done.frame, done.data);
      if (assigned >= range.to) return null;
      const f = assigned++;
      const packet = prepared.then(() => prepare(f));
      prepared = packet.catch(() => {});
      return packet;
    }, plan.fonts);
    if (written !== range.to) throw new Error("Some frames weren't drawn.");
    for (const decoder of running.values()) decoder.close();
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", kill);
    kill();
    await session.close();
  }
}
