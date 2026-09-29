/**
 * Getting speech ready for a transcription engine: decode a stretch of a
 * media file to 16 kHz mono PCM, find where someone is talking, and squeeze
 * the long silences out, keeping a map back to the original times.
 *
 * Squeezing matters for the word timings: speech-to-text models time a word
 * that follows a long silence badly (it "starts" seconds early), and some drop
 * into lowercase without punctuation after one. Doing it here, rather than in
 * an engine, means every engine gets the same, shorter audio (cheaper for the
 * cloud ones) and the times always map back correctly.
 */
import { FFMPEG } from "../config.ts";
import { FFMPEG_QUIET } from "../ffmpeg.ts";
import { run } from "../process.ts";

export const SAMPLE_RATE = 16_000;

/** Decode `[from, to)` of a media file's sound to 16 kHz mono 16-bit PCM. */
export async function decodeSpeech(file: string, from: number, to: number, signal?: AbortSignal): Promise<Int16Array> {
  const chunks: Buffer[] = [];
  await run(
    FFMPEG,
    [
      ...FFMPEG_QUIET,
      "-ss", String(Math.max(0, from)),
      "-t", String(Math.max(0.01, to - from)),
      "-i", file,
      "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1",
    ],
    { signal, onStdout: (chunk) => chunks.push(chunk) },
  );
  const bytes = Buffer.concat(chunks);
  // A copy, so the samples are aligned whatever offset Node's buffer pool gave the bytes.
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)));
}

const FRAME = 0.02;
/** Pauses shorter than this are left alone (they're part of speaking). */
const MIN_SILENCE = 0.8;
/** Kept either side of speech, so quiet word starts and ends aren't cut. */
const PAD = 0.25;
/** Silence put between the stretches of speech that are kept. */
const GAP = 0.2;

export interface Region {
  start: number;
  end: number;
}

export interface SpeechAnalysis {
  /** What to transcribe: the sound, padded, with long silences left out. */
  regions: Region[];
  /** Exactly where there's sound (short gaps within words closed), to line word timings up with. */
  voiced: Region[];
}

/** Voiced stretches this close together are one (the gaps inside and between words). */
const VOICED_JOIN = 0.15;

/**
 * Where there's sound worth transcribing (seconds). Frames count as silent
 * only when they're quiet in absolute terms and near the recording's noise
 * floor, so speech over music is never cut; long silences are what's left out.
 */
export function analyseSpeech(pcm: Int16Array): SpeechAnalysis {
  const frame = Math.round(FRAME * SAMPLE_RATE);
  const count = Math.floor(pcm.length / frame);
  if (count === 0) return { regions: [], voiced: [] };
  const db = new Float64Array(count);
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += pcm[i] * pcm[i];
    db[f] = 10 * Math.log10(sum / frame / (32768 * 32768) + 1e-12);
  }
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(count * 0.1)];
  const threshold = Math.min(-38, Math.max(floor + 6, -55));

  // Loud frames, joined across the given gaps.
  const join = (maxGap: number) => {
    const out: Region[] = [];
    for (let f = 0; f < count; f++) {
      if (db[f] <= threshold) continue;
      const start = f * FRAME;
      const last = out.at(-1);
      if (last && start - last.end < maxGap) last.end = start + FRAME;
      else out.push({ start, end: start + FRAME });
    }
    return out;
  };
  const duration = pcm.length / SAMPLE_RATE;
  const regions: Region[] = [];
  for (const r of join(MIN_SILENCE)) {
    const start = Math.max(0, r.start - PAD);
    const end = Math.min(duration, r.end + PAD);
    const last = regions.at(-1);
    if (last && start <= last.end) last.end = end;
    else regions.push({ start, end });
  }
  return { regions, voiced: join(VOICED_JOIN) };
}

/** Just the regions to transcribe (see `analyseSpeech`). */
export const speechRegions = (pcm: Int16Array) => analyseSpeech(pcm).regions;

/** How far ahead a word said in silence may be moved to the sound it belongs to. */
const SNAP_AHEAD = 4;

/**
 * Line word timings up with the sound. Models time the word after a pause
 * early (it "starts" in the silence), so a word with its start in silence
 * starts where the sound does, and a word entirely in silence moves ahead to
 * the next sound, if that comes before the words after it. Words stay in order.
 */
export function snapToSpeech<W extends { start: number; end: number }>(words: readonly W[], voiced: readonly Region[]): W[] {
  if (voiced.length === 0) return [...words];
  const out: W[] = [];
  words.forEach((w, i) => {
    let { start, end } = w;
    const inside = voiced.filter((v) => v.end > start && v.start < end);
    if (inside.length) {
      start = Math.max(start, inside[0].start);
      end = Math.min(end, inside.at(-1)!.end);
    } else {
      const next = words[i + 1];
      const ahead = voiced.find((v) => v.start >= start && v.start - start <= SNAP_AHEAD);
      if (ahead && (!next || ahead.start < next.end)) {
        const length = Math.max(0.1, end - start);
        start = ahead.start;
        end = Math.min(ahead.end, start + length, next ? Math.max(start, next.end) : Infinity);
      }
    }
    const prev = out.at(-1);
    if (prev && start < prev.start) start = prev.start;
    out.push({ ...w, start, end: Math.max(start, end) });
  });
  return out;
}

/** A stretch of the original audio and where it sits in the squeezed audio (seconds). */
export interface Segment {
  original: number;
  squeezed: number;
  length: number;
}

/** The regions joined by short silences, and where each one came from. */
export function squeeze(pcm: Int16Array, regions: readonly Region[]): { pcm: Int16Array; segments: Segment[] } {
  const gap = Math.round(GAP * SAMPLE_RATE);
  const spans = regions.map((r) => [Math.round(r.start * SAMPLE_RATE), Math.min(pcm.length, Math.round(r.end * SAMPLE_RATE))]);
  const total = spans.reduce((n, [a, b]) => n + (b - a), 0) + gap * Math.max(0, spans.length - 1);
  const out = new Int16Array(total);
  const segments: Segment[] = [];
  let at = 0;
  spans.forEach(([a, b], i) => {
    if (i > 0) at += gap;
    out.set(pcm.subarray(a, b), at);
    segments.push({ original: a / SAMPLE_RATE, squeezed: at / SAMPLE_RATE, length: (b - a) / SAMPLE_RATE });
    at += b - a;
  });
  return { pcm: out, segments };
}

/** A time in the squeezed audio, back in the original (times in a gap go to the nearer side). */
export function originalTime(segments: readonly Segment[], t: number): number {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (t < s.squeezed) {
      const prev = segments[i - 1];
      if (!prev) return s.original;
      const prevEnd = prev.squeezed + prev.length;
      return t - prevEnd < s.squeezed - t ? prev.original + prev.length : s.original;
    }
    if (t <= s.squeezed + s.length) return s.original + (t - s.squeezed);
  }
  const last = segments.at(-1);
  return last ? last.original + last.length : t;
}

/**
 * A word's times in the squeezed audio, back in the original. A word across
 * a squeezed-out silence stays on the side its middle is on, rather than
 * spanning the whole silence.
 */
export function originalSpan(segments: readonly Segment[], start: number, end: number): Region {
  const mid = (start + end) / 2;
  const seg = segments.find((s) => mid <= s.squeezed + s.length + GAP / 2) ?? segments.at(-1);
  const a = originalTime(segments, start);
  const b = Math.max(a, originalTime(segments, end));
  if (!seg) return { start: a, end: b };
  const lo = seg.original;
  const hi = seg.original + seg.length;
  const clampTo = (t: number) => Math.min(hi, Math.max(lo, t));
  return { start: clampTo(a), end: Math.max(clampTo(a), clampTo(b)) };
}

/** A 16-bit mono WAV file of `pcm`. */
export function wavFile(pcm: Int16Array): Buffer {
  const data = pcm.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, data)]);
}
