/**
 * A song's media file's tempo, as heard (FL's TIME menu's Autodetect): decoded to mono by ffmpeg and run
 * through the beat tracker the video editor's beat sync uses (`server/beats.ts`). Remembered per file and
 * its modification time, since a file's tempo doesn't change.
 */
import fs from "node:fs/promises";
import type { DetectedTempo } from "../../shared/music/engine.ts";
import { SAMPLE_RATE, analyseRhythm } from "../beats.ts";
import { FFMPEG, FFPROBE } from "../config.ts";
import { run } from "../process.ts";

/** The longest stretch of a file listened to: a tempo is heard well before then. */
const MAX_SECONDS = 120;

const known = new Map<string, DetectedTempo>();

export async function detectTempo(file: string): Promise<DetectedTempo> {
  const key = `${file}|${(await fs.stat(file)).mtimeMs}`;
  const cached = known.get(key);
  if (cached) return cached;
  const chunks: Buffer[] = [];
  // prettier-ignore
  await run(FFMPEG, ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", file, "-t", String(MAX_SECONDS), "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], {
    onStdout: (chunk) => chunks.push(chunk),
  });
  const bytes = Buffer.concat(chunks);
  // Copied so the samples are aligned for a Float32Array.
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 4)));
  const rhythm = analyseRhythm(samples);
  const seconds = await duration(file, samples.length / SAMPLE_RATE);
  const result: DetectedTempo = { bpm: rhythm.bpm, confidence: rhythm.confidence, seconds };
  known.set(key, result);
  return result;
}

/** The file's whole length (it may be longer than what was listened to), from ffprobe. */
async function duration(file: string, heard: number): Promise<number> {
  if (heard < MAX_SECONDS - 0.01) return Math.round(heard * 1e6) / 1e6;
  try {
    const seconds = Number((await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : heard;
  } catch {
    return heard;
  }
}
