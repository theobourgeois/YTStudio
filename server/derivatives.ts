/** Poster, filmstrip and waveform generation for media assets. */
import fs from "node:fs/promises";
import path from "node:path";
import type { WaveformData } from "../shared/types.ts";
import { FFMPEG } from "./config.ts";
import { FFMPEG_QUIET } from "./ffmpeg.ts";
import { pcmPeaks, readPcmHeader } from "./pcm.ts";
import { run } from "./process.ts";
import { createLimiter } from "./queue.ts";
import { writeJson } from "./storage.ts";

const POSTER_WIDTH = 320;
const FRAME_HEIGHT = 90;
const MAX_FRAMES = 120;
/** ffmpeg processes per filmstrip; each seeks straight to its frame. */
const FRAME_CONCURRENCY = 3;
const PEAKS_PER_SECOND = 50;
const WAVEFORM_SAMPLE_RATE = 16_000;

const BASE_ARGS = [...FFMPEG_QUIET, "-y"];
const seconds = (t: number) => Math.max(0, t).toFixed(3);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then((s) => s.size > 0, () => false);
}

/**
 * Grab one frame (JPEG or PNG, by `out`'s extension) at `time` using input seeking (jumps to the nearest
 * keyframe, then decodes only up to `time`), so it's fast even for long 4K files.
 * `time` null reads the first frame without seeking (stills: seeking an image
 * can skip its only frame). Resolves `false` if no frame could be decoded
 * there; rejects only on abort.
 */
async function extractFrame(
  src: string,
  out: string,
  time: number | null,
  scale: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await run(
      FFMPEG,
      [...BASE_ARGS, ...(time === null ? [] : ["-ss", seconds(time)]), "-i", src, "-map", "0:v:0", "-an", "-sn", "-dn",
        "-frames:v", "1", "-vf", `${scale},setsar=1`, ...(out.endsWith(".jpg") ? ["-q:v", "4"] : []), out],
      { signal },
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
  return exists(out);
}

/** Thumbnail of a still image, scaled to ~320px wide. Write a PNG to keep its transparency. */
export async function makeStillPoster(src: string, out: string): Promise<void> {
  if (!(await extractFrame(src, out, null, `scale=${POSTER_WIDTH}:-2`))) {
    throw new Error("The image couldn't be decoded");
  }
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

/**
 * Write normalised peak buckets of the first audio stream, mono. WAV and AIFF are read here (no ffmpeg to
 * start: half a second on Windows); everything else is decoded by ffmpeg.
 */
export async function makeWaveform(src: string, out: string, signal?: AbortSignal): Promise<void> {
  const pcm = await readPcmHeader(src);
  const peaks = pcm ? await pcmPeaks(src, pcm, PEAKS_PER_SECOND, signal) : await ffmpegPeaks(src, signal);
  await writeJson(out, waveformData(peaks));
}

/** Peak buckets as the client reads them: scaled so the loudest is 1, to three decimals. */
function waveformData(peaks: number[]): WaveformData {
  const max = peaks.reduce((m, p) => Math.max(m, p), 0);
  return {
    peaksPerSecond: PEAKS_PER_SECOND,
    peaks: peaks.map((p) => (max > 0 ? Math.round((p / max) * 1000) / 1000 : 0)),
  };
}

/** Decode to mono PCM with ffmpeg, and take each bucket's peak (any format; `makeWaveform` reads PCM itself). */
export async function ffmpegPeaks(src: string, signal?: AbortSignal): Promise<number[]> {
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
  return peaks;
}

/** Most memory (bytes) one piece's frames may take while ffmpeg reverses them. */
const REVERSE_PIECE_BYTES = 300e6;
const REVERSE_SAMPLE_RATE = 48_000;
/** Pieces reversed at once. */
const REVERSE_CONCURRENCY = 2;

/**
 * Write the media played backwards to `out` (MP4: H.264 + AAC, or just AAC
 * for a sound), exactly as long as the media, so source time `s` is at
 * `duration - s` in it (see `fileTime`). ffmpeg reverses by holding every
 * frame in memory, so the media is cut into pieces of a few frames, each one
 * reversed on its own (video and sound separately), and then joined last
 * piece first. Pieces are cut on the media's own frames (at its frame rate,
 * made constant) and samples, so the joins are seamless.
 */
export async function makeReversed(
  src: string,
  out: string,
  media: { duration: number; hasVideo: boolean; hasAudio: boolean; width: number | null; height: number | null; fps: number | null },
  work: string,
  signal?: AbortSignal,
): Promise<void> {
  const fps = media.fps && media.fps > 0 ? media.fps : 30;
  const pixels = (media.width ?? 1920) * (media.height ?? 1080);
  const frames = Math.max(1, Math.round(media.duration * fps));
  const perPiece = Math.max(8, Math.min(Math.round(2 * fps), Math.floor(REVERSE_PIECE_BYTES / (pixels * 1.5))));
  const pieces = Math.ceil(frames / perPiece);
  const samples = Math.max(1, Math.round(media.duration * REVERSE_SAMPLE_RATE));
  const file = (kind: "v" | "a", i: number) => path.join(work, `${kind}${String(i).padStart(5, "0")}.${kind === "v" ? "mp4" : "wav"}`);

  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  try {
    const limit = createLimiter(REVERSE_CONCURRENCY);
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < pieces; i++) {
      const firstFrame = i * perPiece;
      const count = Math.min(perPiece, frames - firstFrame);
      // Seek a quarter frame early so the piece's first frame is never lost to rounding.
      const from = Math.max(0, firstFrame / fps - 0.25 / fps);
      if (media.hasVideo) {
        jobs.push(limit(() => run(FFMPEG, [
          ...BASE_ARGS, "-ss", from.toFixed(6), "-t", ((count + 1) / fps).toFixed(6), "-i", src,
          "-map", "0:v:0", "-an", "-sn", "-dn",
          "-vf", `fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop=${count},trim=end_frame=${count},reverse`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-bf", "0", "-g", String(Math.round(fps)),
          "-pix_fmt", "yuv420p", "-r", String(fps), file("v", i),
        ], { signal })));
      }
      if (media.hasAudio) {
        // The same stretch of time, in samples.
        const first = Math.round((firstFrame / frames) * samples);
        const length = Math.round(((firstFrame + count) / frames) * samples) - first;
        jobs.push(limit(() => run(FFMPEG, [
          ...BASE_ARGS, "-ss", (first / REVERSE_SAMPLE_RATE).toFixed(6), "-t", ((length + 1024) / REVERSE_SAMPLE_RATE).toFixed(6),
          "-i", src, "-map", "0:a:0", "-vn", "-sn", "-dn",
          "-af", `aresample=${REVERSE_SAMPLE_RATE},apad=whole_len=${length},atrim=end_sample=${length},areverse`,
          "-ac", "2", "-c:a", "pcm_s16le", file("a", i),
        ], { signal })));
      }
    }
    await Promise.all(jobs);

    // Join them last piece first.
    const list = async (kind: "v" | "a") => {
      const listFile = path.join(work, `${kind}.txt`);
      const lines = Array.from({ length: pieces }, (_, i) => `file '${file(kind, pieces - 1 - i)}'`);
      await fs.writeFile(listFile, `${lines.join("\n")}\n`);
      return ["-f", "concat", "-safe", "0", "-i", listFile];
    };
    const inputs = [...(media.hasVideo ? await list("v") : []), ...(media.hasAudio ? await list("a") : [])];
    const tmp = `${out}.part${path.extname(out)}`;
    await run(FFMPEG, [
      ...BASE_ARGS, ...inputs,
      ...(media.hasVideo ? ["-map", "0:v", "-c:v", "copy"] : []),
      ...(media.hasAudio ? ["-map", `${media.hasVideo ? 1 : 0}:a`, "-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart", tmp,
    ], { signal });
    await fs.rename(tmp, out);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
