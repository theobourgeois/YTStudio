/**
 * Looking into media files with ffmpeg, for the assistant (and anything else
 * that needs it): a frame as a JPEG, the quiet stretches and loudness of the
 * sound, the music's beats and shape (`beats.ts`), and where the picture cuts
 * to a new shot. Times are source seconds.
 */
import type { MusicAnalysis, Silence, SoundAnalysis } from "../shared/types.ts";
import { SAMPLE_RATE as RHYTHM_RATE, analyseRhythm } from "./beats.ts";
import { FFMPEG } from "./config.ts";
import { run } from "./process.ts";

const LOUD = ["-hide_banner", "-nostdin", "-loglevel", "info"] as const;
const round = (t: number) => Math.round(t * 1000) / 1000;

/** One frame at source time `t`, `width` px wide, as a JPEG. Stills ignore `t`. */
export async function extractFrame(file: string, opts: { t: number; width: number; still: boolean }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await run(
    FFMPEG,
    [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      ...(opts.still ? [] : ["-ss", String(Math.max(0, opts.t))]),
      "-i", file,
      "-frames:v", "1",
      "-an",
      "-vf", `scale=${Math.round(opts.width)}:-2:flags=bicubic`,
      "-pix_fmt", "yuvj420p",
      "-c:v", "mjpeg",
      "-q:v", "5",
      "-f", "image2pipe",
      "-",
    ],
    { onStdout: (chunk) => chunks.push(chunk) },
  );
  const jpeg = Buffer.concat(chunks);
  if (jpeg.length === 0) throw new Error("There's no picture at that time.");
  return jpeg;
}

/** Silences and loudness of the sound between `from` and `to`. */
export async function analyseSound(
  file: string,
  opts: { from: number; to: number; threshold: number; minSilence: number },
): Promise<SoundAnalysis> {
  let log = "";
  await run(
    FFMPEG,
    [
      ...LOUD,
      "-ss", String(opts.from),
      "-t", String(Math.max(0.05, opts.to - opts.from)),
      "-i", file,
      "-vn",
      "-af", `silencedetect=noise=${opts.threshold}dB:d=${opts.minSilence},volumedetect`,
      "-f", "null",
      "-",
    ],
    { onStderr: (chunk) => (log += chunk.toString("utf8")) },
  );
  return parseSoundLog(log, opts.from, opts.to);
}

/** Reads silencedetect and volumedetect output; times are shifted by `offset` (where decoding started). */
export function parseSoundLog(log: string, offset: number, end: number): SoundAnalysis {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const stop = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (stop && open !== null) {
      silences.push({ start: round(open + offset), end: round(Math.min(end, Number(stop[1]) + offset)) });
      open = null;
    }
  }
  // Still quiet at the end.
  if (open !== null && open + offset < end) silences.push({ start: round(open + offset), end: round(end) });
  const db = (name: string) => {
    const m = new RegExp(`${name}:\\s*(-?[\\d.]+|-inf) dB`).exec(log);
    if (!m) return null;
    return m[1] === "-inf" ? -Infinity : Number(m[1]);
  };
  const finite = (v: number | null) => (v === null || !Number.isFinite(v) ? null : v);
  return { silences, meanVolume: finite(db("mean_volume")), maxVolume: finite(db("max_volume")) };
}

/** Source times where the picture cuts to a new shot. */
export async function detectScenes(file: string, threshold: number): Promise<number[]> {
  let log = "";
  await run(
    FFMPEG,
    [...LOUD, "-i", file, "-an", "-vf", `scale=320:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
    { onStderr: (chunk) => (log += chunk.toString("utf8")) },
  );
  return parseSceneLog(log);
}

/** Reads showinfo output: the time of each frame that got through. */
export function parseSceneLog(log: string): number[] {
  const cuts: number[] = [];
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes("showinfo")) continue;
    const m = /pts_time:\s*([\d.]+)/.exec(line);
    if (m) cuts.push(round(Number(m[1])));
  }
  return cuts;
}

/** Longest stretch of music analysed at once (seconds). */
const MAX_MUSIC = 20 * 60;

/** The sound between `from` and `to` as mono samples at the rhythm analysis's rate. */
async function decodeMono(file: string, from: number, to: number): Promise<Float32Array> {
  const chunks: Buffer[] = [];
  await run(
    FFMPEG,
    [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-ss", String(from),
      "-t", String(Math.max(0.05, Math.min(MAX_MUSIC, to - from))),
      "-i", file,
      "-vn", "-ac", "1", "-ar", String(RHYTHM_RATE),
      "-f", "f32le", "-",
    ],
    { onStdout: (chunk) => chunks.push(chunk) },
  );
  const bytes = Buffer.concat(chunks);
  // Copied so the samples are aligned for a Float32Array.
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 4)));
}

/** Tempo, beats, bars, loud and quiet parts and drops of the music between `from` and `to` (source seconds). */
export async function analyseMusic(file: string, from: number, to: number): Promise<MusicAnalysis> {
  const rhythm = analyseRhythm(await decodeMono(file, from, to));
  const shift = (t: number) => round(t + from);
  return {
    bpm: rhythm.bpm,
    confidence: rhythm.confidence,
    beats: rhythm.beats.map(shift),
    downbeats: rhythm.downbeats.map(shift),
    sections: rhythm.sections.map((s) => ({ ...s, start: shift(s.start), end: shift(s.end) })),
    drops: rhythm.drops.map((d) => ({ ...d, time: shift(d.time) })),
  };
}
