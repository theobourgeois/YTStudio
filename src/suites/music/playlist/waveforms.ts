/**
 * Audio clips' waveforms, as FL Studio draws them: the file's own samples, decoded in the tab (in a
 * moment for a sample, so a clip shows its waveform as soon as it's dropped), and kept as lowest and
 * highest values over buckets of samples at every power of two (`WavePeaks`), so a column of the
 * Playlist at any zoom reads a handful of values: sharp when zoomed in, cheap when zoomed out.
 */
import type { Precomputed } from "@shared/music/types";
import { loadSamples, precomputeSamples } from "../waveform";

/** `loadSamples` decodes at this rate. */
export const WAVE_RATE = 44_100;
/** The finest level's bucket, in samples; finer than that, the samples themselves are read. */
const FIRST_BUCKET = 16;

export interface WavePeaks {
  /** Samples per second. */
  rate: number;
  /** Its channels mixed, -1..1. */
  samples: Float32Array;
  /** Level `i`: the lowest and highest sample in each bucket of `FIRST_BUCKET * 2^i` samples. */
  levels: { min: Float32Array; max: Float32Array }[];
}

/** A file's peaks at every level, from its samples. */
export function buildPeaks(samples: Float32Array, rate = WAVE_RATE): WavePeaks {
  const levels: WavePeaks["levels"] = [];
  let count = Math.ceil(samples.length / FIRST_BUCKET);
  let min = new Float32Array(count);
  let max = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let low = Infinity;
    let high = -Infinity;
    const end = Math.min(samples.length, (b + 1) * FIRST_BUCKET);
    for (let i = b * FIRST_BUCKET; i < end; i++) {
      const v = samples[i];
      if (v < low) low = v;
      if (v > high) high = v;
    }
    min[b] = low;
    max[b] = high;
  }
  levels.push({ min, max });
  while (count > 1) {
    const next = Math.ceil(count / 2);
    const nmin = new Float32Array(next);
    const nmax = new Float32Array(next);
    for (let b = 0; b < next; b++) {
      const j = b * 2;
      nmin[b] = j + 1 < count ? Math.min(min[j], min[j + 1]) : min[j];
      nmax[b] = j + 1 < count ? Math.max(max[j], max[j + 1]) : max[j];
    }
    levels.push({ min: nmin, max: nmax });
    count = next;
    min = nmin;
    max = nmax;
  }
  return { rate, samples, levels };
}

/**
 * The lowest and highest sample in `[from, to)` (sample indices, clamped to the file), from the coarsest
 * level whose buckets still fit in the range: `[0, 0]` for none.
 */
export function peakRange(peaks: WavePeaks, from: number, to: number): [number, number] {
  const length = peaks.samples.length;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(length, Math.ceil(to));
  if (b <= a) return [0, 0];
  let low = Infinity;
  let high = -Infinity;
  const span = b - a;
  if (span < FIRST_BUCKET * 4) {
    for (let i = a; i < b; i++) {
      const v = peaks.samples[i];
      if (v < low) low = v;
      if (v > high) high = v;
    }
    return [low, high];
  }
  // Buckets of this level are no wider than a quarter of the range, so the ends' part-buckets are a small error.
  const level = Math.min(peaks.levels.length - 1, Math.max(0, Math.floor(Math.log2(span / FIRST_BUCKET)) - 2));
  const size = FIRST_BUCKET * 2 ** level;
  const { min, max } = peaks.levels[level];
  const first = Math.floor(a / size);
  const last = Math.min(min.length, Math.ceil(b / size));
  for (let i = first; i < last; i++) {
    if (min[i] < low) low = min[i];
    if (max[i] > high) high = max[i];
  }
  return [low, high];
}

/** Each file's samples, once decoded (or while they are, or if they couldn't be). */
const decoded = new Map<string, Float32Array | "loading" | "failed">();
/** Peaks made, by file and precomputed effects; the least recently used go first. */
const prepared = new Map<string, WavePeaks>();
const KEPT = 64;
/** The last peaks given for each file, shown while others are made (so a knob turned never blanks it). */
const latest = new Map<string, WavePeaks>();
const listeners = new Set<() => void>();

/**
 * The peaks of the audio file at `url`, after its channel's `precomputed` effects (as the engine plays it).
 * Once the file's decoded, they're made at once, so a knob turned redraws without a flash; until then it's
 * null (or the file's last peaks), and `onWaveform` listeners hear when it's ready.
 */
export function clipPeaks(url: string, precomputed?: Precomputed): WavePeaks | null {
  const key = precomputed ? `${url}|${JSON.stringify(precomputed)}` : url;
  const known = prepared.get(key);
  if (known) {
    // Most recently used: to the end.
    prepared.delete(key);
    prepared.set(key, known);
    latest.set(url, known);
    return known;
  }
  const samples = decoded.get(url);
  if (samples instanceof Float32Array) {
    const peaks = buildPeaks(precomputed ? precomputeSamples(samples, precomputed) : samples);
    prepared.set(key, peaks);
    while (prepared.size > KEPT) prepared.delete(prepared.keys().next().value!);
    latest.set(url, peaks);
    return peaks;
  }
  if (!samples) {
    decoded.set(url, "loading");
    loadSamples(url)
      .then(
        (data) => decoded.set(url, data),
        () => decoded.set(url, "failed"),
      )
      .finally(() => {
        for (const listener of listeners) listener();
      });
  }
  return latest.get(url) ?? null;
}

/** Be told when a waveform has loaded (to draw again). Returns how to stop. */
export function onWaveform(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
