/**
 * Where a passage's energy is in frequency and how that moves over time: band levels per half second,
 * the long-term balance against a pink-noise reference (equal energy per octave), and the moments its
 * loudness or tonal balance changes. These are measurements with named methods, not opinions: "less
 * energy above 4 kHz from 9.5 s" is reported, never "it got worse".
 */
import { CHUNK_SECONDS, loudnessChunks, lufs } from "./loudness.ts";

export const SPECTRUM_METHOD = { name: "hann-fft-octave-bands", version: "1" } as const;
export const CHANGE_METHOD = { name: "two-second-means-either-side", version: "1" } as const;

/** Bands as mixing engineers name them (edges in Hz). */
export const BANDS = [
  { id: "sub", label: "sub (20–60 Hz)", low: 20, high: 60 },
  { id: "bass", label: "bass (60–250 Hz)", low: 60, high: 250 },
  { id: "lowMid", label: "low mids (250–500 Hz)", low: 250, high: 500 },
  { id: "mid", label: "mids (500 Hz–2 kHz)", low: 500, high: 2000 },
  { id: "upperMid", label: "upper mids (2–4 kHz)", low: 2000, high: 4000 },
  { id: "presence", label: "presence (4–6 kHz)", low: 4000, high: 6000 },
  { id: "air", label: "air (6–20 kHz)", low: 6000, high: 20000 },
] as const;
export type BandId = typeof BANDS[number]["id"];

/** In-place iterative radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = -2 * Math.PI / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k), wi = Math.sin(step * k);
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** The channels averaged into one. */
export function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / channels.length;
  return out;
}

export interface BandFrames {
  /** Seconds at each frame's centre. */
  times: number[];
  /** Power per band per frame (linear, arbitrary but shared units), `[frame][band]`, in `BANDS` order. */
  power: number[][];
  /** The FFT's bin width, Hz. */
  binHz: number;
  /** Power per bin per frame, for finer questions (where in a band the energy is). */
  bins: Float64Array[];
}

/** Hann-windowed frames of about 85 ms (a power of two), every half frame. */
export function bandFrames(signal: Float32Array, sampleRate: number): BandFrames {
  let size = 1;
  while (size < sampleRate * 0.085) size <<= 1;
  const hop = size >> 1, binHz = sampleRate / size, window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
  const edges = BANDS.map(b => [Math.max(1, Math.round(b.low / binHz)), Math.min(size / 2, Math.round(b.high / binHz))]);
  const times: number[] = [], power: number[][] = [], bins: Float64Array[] = [];
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let start = 0; start + size <= signal.length; start += hop) {
    for (let i = 0; i < size; i++) { re[i] = signal[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    const p = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++) p[k] = (re[k] * re[k] + im[k] * im[k]) / size;
    bins.push(p);
    power.push(edges.map(([lo, hi]) => { let s = 0; for (let k = lo; k < hi; k++) s += p[k]; return s; }));
    times.push((start + size / 2) / sampleRate);
  }
  return { times, power, binHz, bins };
}

const db = (power: number) => power > 0 ? 10 * Math.log10(power) : -Infinity;

/** How many octaves of a band are below the Nyquist frequency (what a pink reference puts in it). */
function octaves(band: typeof BANDS[number], sampleRate: number) {
  const high = Math.min(band.high, sampleRate / 2);
  return high > band.low ? Math.log2(high / band.low) : 0;
}

export interface BandBalance {
  band: BandId;
  /** The band's share of the passage's energy, dB. */
  shareDb: number;
  /** Its share against pink noise's (equal energy per octave): + is more than pink would have, dB. */
  relativeToPinkDb: number;
}

/** The long-term balance of frames (all of them, or those `active`). */
export function bandBalance(frames: BandFrames, sampleRate: number, active?: boolean[]): BandBalance[] {
  const sums = BANDS.map(() => 0);
  frames.power.forEach((row, f) => { if (!active || active[f]) row.forEach((p, b) => { sums[b] += p; }); });
  const total = sums.reduce((a, b) => a + b, 0), totalOctaves = BANDS.reduce((a, b) => a + octaves(b, sampleRate), 0);
  return BANDS.map((band, b) => {
    const share = total > 0 ? db(sums[b] / total) : -Infinity, pink = db(octaves(band, sampleRate) / totalOctaves);
    return { band: band.id, shareDb: share, relativeToPinkDb: share - pink };
  });
}

/** Frames averaged into windows of `seconds` (by their centres): `[window][band]` power, and each window's start. */
export function bandWindows(frames: BandFrames, seconds: number, duration: number): { starts: number[]; power: number[][] } {
  const count = Math.floor(duration / seconds + 1e-9), power = Array.from({ length: count }, () => BANDS.map(() => 0)), n = new Array(count).fill(0);
  frames.times.forEach((t, f) => { const w = Math.floor(t / seconds); if (w < count) { n[w]++; frames.power[f].forEach((p, b) => { power[w][b] += p; }); } });
  return { starts: power.map((_, w) => w * seconds), power: power.map((row, w) => row.map(p => n[w] ? p / n[w] : 0)) };
}

export interface Change {
  /** Seconds into the passage where it happens (the middle of the window it's measured across). */
  at: number;
  /** "loudness": the K-weighted loudness moves; "tone": a band's share of the energy moves. */
  kind: "loudness" | "tone";
  /** dB: loudness after minus before, or for tone the largest band move. */
  deltaDb: number;
  before: number;
  after: number;
  /** For tone: each band's share move, dB. */
  bands?: { band: BandId; deltaDb: number }[];
  /** True when the move is spread over more than a second rather than a step. */
  gradual: boolean;
}

/**
 * Moments a series (dB, one value per `step` seconds) moves by at least `threshold`: at each boundary,
 * the energy mean of `span` seconds after against `span` before; the largest such move within `span`
 * of another is kept. A step is found within a step; a ramp at its middle.
 */
export function changePoints(series: number[], step: number, threshold: number, span = 2): { at: number; before: number; after: number; delta: number; gradual: boolean }[] {
  const n = Math.round(span / step), found: { at: number; before: number; after: number; delta: number; gradual: boolean }[] = [];
  const mean = (from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += 10 ** (series[i] / 10); return 10 * Math.log10(s / (to - from)); };
  const deltas = series.map((_, i) => i < n || i + n > series.length ? 0 : mean(i, i + n) - mean(i - n, i));
  for (let i = n; i + n <= series.length; i++) {
    const d = deltas[i];
    if (!Number.isFinite(d) || Math.abs(d) < threshold) continue;
    // A local extreme of the move, the earliest of equals.
    let peak = true;
    for (let j = Math.max(n, i - n); j <= Math.min(series.length - n, i + n); j++) {
      const a = Math.abs(deltas[j]), b = Math.abs(d);
      if (j !== i && (a > b + 1e-9 || (j < i && a >= b - 1e-9))) { peak = false; break; }
    }
    if (!peak) continue;
    // A step's single-window jump carries most of it; a ramp spreads it.
    const jump = Math.abs(series[i] - series[i - 1]);
    found.push({ at: i * step, before: mean(i - n, i), after: mean(i, i + n), delta: d, gradual: Number.isFinite(jump) && jump < Math.abs(d) * 0.5 });
  }
  return found;
}

export interface PassageListening {
  duration: number;
  balance: BandBalance[];
  /** Half-second windows: loudness (LUFS, K-weighted, 0.5 s) and each band's share (dB). */
  windows: { start: number; lufs: number; shares: number[] }[];
  changes: Change[];
}

/** The median of absolute values (a series' usual move, robust to its few big ones). */
function medianAbs(values: number[]) {
  const sorted = values.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * Half-second windows' loudness and band shares, the passage's balance, and where loudness or tone moves.
 * A tonal change compares each band's share of the energy over `toneSpan` seconds either side (power summed,
 * not averaged in dB) and must exceed both `toneThreshold` and four times that band's usual move in this
 * passage: music's balance swings with every hit and chord, a mix's change of balance stays.
 */
export function listen(channels: Float32Array[], sampleRate: number, options: { loudnessThreshold?: number; toneThreshold?: number; toneSpan?: number } = {}): PassageListening {
  const step = 0.5, duration = channels[0].length / sampleRate;
  const chunks = loudnessChunks(channels, sampleRate), per = Math.round(step / CHUNK_SECONDS);
  const frames = bandFrames(mono(channels), sampleRate), grid = bandWindows(frames, step, duration);
  const windows = grid.starts.map((start, w) => {
    let e = 0, n = 0;
    for (let c = w * per; c < (w + 1) * per && c < chunks.length; c++) { e += chunks[c]; n++; }
    const total = grid.power[w].reduce((a, b) => a + b, 0);
    return { start, lufs: n ? lufs(e / n) : -Infinity, shares: grid.power[w].map(p => total > 0 && p > 0 ? db(p / total) : -Infinity) };
  });
  const changes: Change[] = [];
  for (const c of changePoints(windows.map(w => Math.max(-70, w.lufs)), step, options.loudnessThreshold ?? 3)) {
    // A slow move is wider than two seconds either side: measured again over four, it shows its whole size.
    const wide = changePoints(windows.map(w => Math.max(-70, w.lufs)), step, 0, 4).filter(x => Math.abs(x.at - c.at) <= 2 && Math.sign(x.delta) === Math.sign(c.delta)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    const use = wide && Math.abs(wide.delta) > Math.abs(c.delta) * 1.25 ? wide : c;
    changes.push({ at: c.at, kind: "loudness", deltaDb: use.delta, before: use.before, after: use.after, gradual: c.gradual });
  }
  // Tone: band shares from summed power over the span either side, where there's sound.
  const span = Math.round((options.toneSpan ?? 3) / step), threshold = options.toneThreshold ?? 3;
  const sounding = windows.map(w => w.lufs > -60);
  const shareAround = (from: number, to: number) => {
    const sums = BANDS.map(() => 0);
    for (let w = from; w < to; w++) if (sounding[w]) grid.power[w].forEach((p, b) => { sums[b] += p; });
    const total = sums.reduce((a, b) => a + b, 0);
    return sums.map(p => total > 0 && p > 0 ? db(p / total) : NaN);
  };
  const moves = windows.map((_, i) => i < span || i + span > windows.length ? null : (() => {
    const before = shareAround(i - span, i), after = shareAround(i, i + span);
    return BANDS.map((_, b) => after[b] - before[b]);
  })());
  const usual = BANDS.map((_, b) => medianAbs(moves.filter(m => m).map(m => m![b])));
  const strength = moves.map(m => m ? Math.max(0, ...BANDS.map((_, b) => Number.isFinite(m[b]) && Math.abs(m[b]) >= Math.max(threshold, 4 * usual[b]) ? Math.abs(m[b]) : 0)) : 0);
  for (let i = 0; i < windows.length; i++) {
    if (!strength[i]) continue;
    let peak = true;
    for (let j = Math.max(0, i - span); j <= Math.min(windows.length - 1, i + span); j++) if (j !== i && (strength[j] > strength[i] + 1e-9 || (j < i && strength[j] >= strength[i] - 1e-9))) { peak = false; break; }
    if (!peak) continue;
    const m = moves[i]!, bands = BANDS.map((band, b) => ({ band: band.id, deltaDb: Number.isFinite(m[b]) ? m[b] : 0 })).filter(x => Math.abs(x.deltaDb) >= threshold);
    const strongest = bands.reduce((a, b) => Math.abs(b.deltaDb) > Math.abs(a.deltaDb) ? b : a, bands[0]), b = BANDS.findIndex(x => x.id === strongest.band);
    // A ramp: the move builds over more than a second (a second either side carries less than half of it).
    const near = (k: number) => shareAround(Math.max(0, k - 2), Math.min(windows.length, k + 2))[b];
    const gradual = Math.abs(near(i + 2) - near(i - 2)) < Math.abs(strongest.deltaDb) * 0.5;
    const before = shareAround(i - span, i)[b], after = shareAround(i, i + span)[b];
    changes.push({ at: i * step, kind: "tone", deltaDb: strongest.deltaDb, before, after, bands, gradual });
  }
  changes.sort((a, b) => a.at - b.at);
  return { duration, balance: bandBalance(frames, sampleRate), windows, changes };
}

/** A tonal change in plain words, from its band moves: what moved where, never a judgement. */
export function describeTone(change: Change): string {
  const moves = (change.bands ?? []).filter(b => Math.abs(b.deltaDb) >= 3).sort((a, b) => Math.abs(b.deltaDb) - Math.abs(a.deltaDb)).slice(0, 3);
  const label = (id: BandId) => BANDS.find(b => b.id === id)!.label;
  return moves.map(m => `${label(m.band)} ${m.deltaDb > 0 ? "+" : ""}${m.deltaDb.toFixed(1)} dB`).join(", ");
}
