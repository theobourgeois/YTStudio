/** Poster, filmstrip and waveform generation for media assets. */
import fs from "node:fs/promises";
import path from "node:path";
import type { WaveformData } from "../shared/types.ts";
import { FFMPEG } from "./config.ts";
import { run } from "./ffmpeg.ts";
import { createLimiter } from "./queue.ts";
import { writeJson } from "./storage.ts";

const POSTER_WIDTH = 320;
const FRAME_HEIGHT = 90;
const MAX_FRAMES = 120;
/** ffmpeg processes per filmstrip; each seeks straight to its frame. */
const FRAME_CONCURRENCY = 3;
const PEAKS_PER_SECOND = 50;
const WAVEFORM_SAMPLE_RATE = 16_000;

const BASE_ARGS = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"];
const seconds = (t: number) => Math.max(0, t).toFixed(3);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then((s) => s.size > 0, () => false);
}

/**
 * Grab one JPEG frame at `time` using input seeking (jumps to the nearest
 * keyframe, then decodes only up to `time`), so it's fast even for long 4K files.
 * Resolves `false` if no frame could be decoded there; rejects only on abort.
 */
async function extractFrame(
  src: string,
  out: string,
  time: number,
  scale: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await run(
      FFMPEG,
      [...BASE_ARGS, "-ss", seconds(time), "-i", src, "-map", "0:v:0", "-an", "-sn", "-dn",
        "-frames:v", "1", "-vf", `${scale},setsar=1`, "-q:v", "4", out],
      { signal },
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
  return exists(out);
}

/** Poster frame ~10% in (at most 1s), scaled to ~320px wide. */
export async function makePoster(src: string, out: string, duration: number): Promise<void> {
  const scale = `scale=${POSTER_WIDTH}:-2`;
  const ok =
    (await extractFrame(src, out, Math.min(1, duration * 0.1), scale)) ||
    (await extractFrame(src, out, 0, scale));
  if (!ok) throw new Error("No video frame could be decoded");
}

export interface FilmstripResult {
  count: number;
  width: number;
  height: number;
}

/**
 * Write `dir/001.jpg…` where frame i (0-based) shows source time
 * `i * duration / count`. Frames that fail to decode (e.g. past the end of a
 * short video stream) reuse the nearest good frame so the mapping stays exact.
 */
export async function makeFilmstrip(
  src: string,
  dir: string,
  media: { duration: number; width: number; height: number },
  signal?: AbortSignal,
): Promise<FilmstripResult> {
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.round(media.duration)));
  const height = FRAME_HEIGHT;
  const width = even((FRAME_HEIGHT * media.width) / media.height);
  const frameFile = (i: number) => path.join(dir, `${String(i + 1).padStart(3, "0")}.jpg`);

  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  const limit = createLimiter(FRAME_CONCURRENCY);
  const ok = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      limit(() =>
        extractFrame(src, frameFile(i), (i * media.duration) / count, `scale=${width}:${height}`, signal),
      ),
    ),
  );

  const firstGood = ok.indexOf(true);
  if (firstGood === -1) throw new Error("No frames could be decoded");
  let source = firstGood;
  for (let i = 0; i < count; i++) {
    if (ok[i]) source = i;
    else await fs.copyFile(frameFile(source), frameFile(i));
  }
  return { count, width, height };
}

/** Decode the first audio stream to mono PCM and write normalised peak buckets. */
export async function makeWaveform(src: string, out: string, signal?: AbortSignal): Promise<void> {
  const bucketSize = WAVEFORM_SAMPLE_RATE / PEAKS_PER_SECOND;
  const peaks: number[] = [];
  let peak = 0;
  let inBucket = 0;
  let leftover: Buffer = Buffer.alloc(0);

  const onStdout = (chunk: Buffer) => {
    const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
    const usable = buf.length - (buf.length % 4);
    for (let o = 0; o < usable; o += 4) {
      const v = Math.abs(buf.readFloatLE(o));
      if (v > peak) peak = v;
      if (++inBucket === bucketSize) {
        peaks.push(peak);
        peak = 0;
        inBucket = 0;
      }
    }
    leftover = buf.subarray(usable);
  };

  await run(
    FFMPEG,
    [...BASE_ARGS, "-i", src, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(WAVEFORM_SAMPLE_RATE),
      "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"],
    { signal, onStdout },
  );
  if (inBucket > 0) peaks.push(peak);

  const max = peaks.reduce((m, p) => Math.max(m, p), 0);
  const data: WaveformData = {
    peaksPerSecond: PEAKS_PER_SECOND,
    peaks: peaks.map((p) => (max > 0 ? Math.round((p / max) * 1000) / 1000 : 0)),
  };
  await writeJson(out, data);
}
