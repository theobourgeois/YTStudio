/**
 * Finding the rhythm and shape of music, from mono samples (pure, no I/O; see
 * `analyseMusic` in media-analysis.ts for decoding): the tempo, the beats and
 * bars, how loud each part is, and the drops (where the energy jumps up).
 *
 * Beats follow Ellis's dynamic-programming tracker ("Beat Tracking by Dynamic
 * Programming", 2007): an onset envelope from the spectral flux, the tempo
 * from its autocorrelation (weighted towards ~120 BPM), then the beat times
 * that best line up with the onsets while keeping that tempo.
 */
import type { MusicAnalysis, MusicSection } from "../shared/types.ts";

/** Analysis frame rate: hop of 256 samples at 22050 Hz (about 11.6 ms). */
export const SAMPLE_RATE = 22050;
const FFT_SIZE = 1024;
const HOP = 256;
const FPS = SAMPLE_RATE / HOP;
/**
 * A frame's onset is measured as the sound enters its window, so it shows about a window before the hit;
 * this (measured on synthetic kicks) puts beats on the attack.
 */
const ONSET_DELAY = 0.037;
/** Onsets weaker than this on average (dB summed over the bands, per frame) are no rhythm at all. */
const MIN_ACTIVITY = 1;
/** Tempos considered, and the one assumed most likely (BPM). */
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_BPM = 120;
/** Below this many hertz counts as the bass (kicks mark the bars). */
const BASS_HZ = 150;
/** How strongly beats keep to the tempo rather than follow onsets. */
const TIGHTNESS = 100;
/** Less regular than this, there's no beat to speak of. */
const MIN_CONFIDENCE = 0.15;
/** A faster tempo wins when its beats land on the bass this share as often as the best candidate's. */
const OCTAVE_SHARE = 0.65;
/** How many multiples of a beat the tempo's score looks at: two bars of 4/4. */
const COMB = 8;


// ---------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------

/** In-place radix-2 FFT of `re` + i·`im` (length a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    const half = size >> 1;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(step * k);
        const sin = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const tr = re[b] * cos - im[b] * sin;
        const ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

interface Envelopes {
  /** Onset strength per frame (spectral flux, locally normalised). */
  onset: Float64Array;
  /** The same, of the bass only. */
  bass: Float64Array;
  /** Loudness per frame, dBFS. */
  db: Float64Array;
  /** Mean raw onset strength: near zero for a steady tone or silence. */
  activity: number;
}

/** Log-spaced bands (like a mel scale) the spectrum is summed into, so low and high sounds weigh alike. */
const BANDS = 36;
const LOW_HZ = 30;
/** Bands this far (dB) below the recent loudest band are treated as silent. */
const BAND_RANGE_DB = 30;
/** How fast that reference falls after a loud moment (dB per frame: about 20 dB a second). */
const FLOOR_RELEASE_DB = 20 / FPS;
const HIGH_HZ = 9000;

function bandEdges(): number[] {
  const bins = FFT_SIZE / 2;
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) {
    const hz = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (b / BANDS);
    edges.push(Math.min(bins, Math.max(1, Math.round((hz * FFT_SIZE) / SAMPLE_RATE))));
  }
  // At least one bin per band.
  for (let b = 1; b <= BANDS; b++) edges[b] = Math.max(edges[b], edges[b - 1] + 1);
  return edges;
}

/** Onset strength and loudness per analysis frame. */
export function envelopes(samples: Float32Array): Envelopes {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const window = new Float64Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE));
  const edges = bandEdges();
  const bassBands = edges.findIndex((e) => (e * SAMPLE_RATE) / FFT_SIZE >= BASS_HZ);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  let prev = new Float64Array(BANDS);
  let next = new Float64Array(BANDS);
  const flux = new Float64Array(frames);
  const bassFlux = new Float64Array(frames);
  const db = new Float64Array(frames);
  let reference = -Infinity;
  for (let f = 0; f < frames; f++) {
    let power = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = samples[f * HOP + i];
      power += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    db[f] = 10 * Math.log10(power / FFT_SIZE + 1e-10);
    fft(re, im);
    let sum = 0;
    let bass = 0;
    let loudest = -Infinity;
    for (let b = 0; b < BANDS; b++) {
      let energy = 0;
      for (let k = edges[b]; k < edges[b + 1]; k++) energy += re[k] * re[k] + im[k] * im[k];
      // Log energy (as in dB), so quiet and loud passages count alike.
      next[b] = 10 * Math.log10(energy / (edges[b + 1] - edges[b]) + 1e-6);
      loudest = Math.max(loudest, next[b]);
    }
    // The recent peak, falling slowly: a floor that doesn't jump from one frame to the next.
    reference = Math.max(loudest, reference - FLOOR_RELEASE_DB);
    for (let b = 0; b < BANDS; b++) {
      // Bands far below the recent peak are leakage, which flickers with the window's phase: not onsets.
      const level = Math.max(next[b], reference - BAND_RANGE_DB);
      next[b] = level;
      const rise = f > 0 ? level - prev[b] : 0;
      if (rise > 0) {
        sum += rise;
        if (b < bassBands) bass += rise;
      }
    }
    flux[f] = sum;
    bassFlux[f] = bass;
    [prev, next] = [next, prev];
  }
  let activity = 0;
  for (const v of flux) activity += v;
  activity /= frames || 1;
  const bassOnset = normalise(highPass(bassFlux));
  // Kicks mark the beat in most music: the bass counts again on top of every band.
  const onset = normalise(highPass(flux)).map((v, i) => v + bassOnset[i]);
  return { onset, bass: bassOnset, db, activity };
}

/** Minus a moving average (about 1 s) and clipped at zero: onsets stand out from a steady level. */
function highPass(x: Float64Array): Float64Array {
  const radius = Math.round(FPS / 2);
  const out = new Float64Array(x.length);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < x.length; i++) {
    while (hi < Math.min(x.length - 1, i + radius)) sum += x[++hi];
    while (lo < i - radius) sum -= x[lo++];
    out[i] = Math.max(0, x[i] - sum / (hi - lo + 1));
  }
  return out;
}

/** Scaled to unit standard deviation. */
function normalise(x: Float64Array): Float64Array {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length || 1;
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const sd = Math.sqrt(variance / (x.length || 1)) || 1;
  return x.map((v) => v / sd);
}

// ---------------------------------------------------------------------------
// Tempo and beats
// ---------------------------------------------------------------------------

/** The beat period in frames (fractional) and how periodic the onsets are (0..1), or null without a pulse. */
export function estimatePeriod(onset: Float64Array): { period: number; periodicity: number } | null {
  const minLag = Math.floor((60 * FPS) / MAX_BPM);
  const maxLag = Math.ceil((60 * FPS) / MIN_BPM);
  if (onset.length < maxLag * 4) return null;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= onset.length;
  const centred = onset.map((v) => v - mean);
  const top = maxLag * COMB + COMB + 2;
  const corr = new Float64Array(top + 1);
  for (let lag = 0; lag <= top; lag++) {
    let s = 0;
    for (let i = lag; i < centred.length; i++) s += centred[i] * centred[i - lag];
    corr[lag] = s / (centred.length - lag);
  }
  if (corr[0] <= 0) return null;
  /** The strongest correlation within `reach` frames of `lag` (a beat's multiples drift off whole frames). */
  const near = (lag: number, reach: number) => {
    let most = 0;
    for (let l = Math.max(0, Math.floor(lag - reach)); l <= Math.min(top, Math.ceil(lag + reach)); l++) most = Math.max(most, corr[l]);
    return most;
  };
  // A beat repeats at every multiple of itself, up to two bars, where syncopation doesn't: drum & bass's
  // kick 1.5 beats after the first, or hip-hop's at ¾ of one, repeats once and then falls off the grid,
  // though it can be the strongest single lag. So a lag scores for all its multiples (a comb), which the
  // true beat wins.
  const comb = (lag: number) => {
    let sum = 0;
    for (let k = 1; k <= COMB; k++) sum += near(k * lag, 1 + k / 2);
    return sum;
  };
  // Tempos near 120 BPM are likelier (a log-Gaussian over the period, one octave wide);
  // `chooseOctave` then settles between half and double.
  const priorLag = (60 * FPS) / PRIOR_BPM;
  const score = (lag: number) => comb(lag) * Math.exp(-0.5 * Math.log2(lag / priorLag) ** 2);
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
  // How regular: the beat's multiples on average (the beat alone can be faint when the bar is strong).
  const periodicity = comb(best) / COMB / corr[0];
  if (periodicity <= 0) return null;
  // Between frames: the peak of the parabola through the best lag and its neighbours.
  const [a, b, c] = [corr[best - 1], corr[best], corr[best + 1]];
  const shift = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return { period: best + Math.max(-0.5, Math.min(0.5, shift)), periodicity };
}

/** Beat frames: the path through the onsets that best keeps to `period` (dynamic programming). */
export function trackBeats(onset: Float64Array, period: number): number[] {
  const n = onset.length;
  const score = new Float64Array(n);
  const from = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bestScore = 0;
    let bestPrev = -1;
    for (let prev = t - hi; prev <= t - lo; prev++) {
      if (prev < 0) continue;
      const s = score[prev] - TIGHTNESS * Math.log((t - prev) / period) ** 2;
      if (bestPrev === -1 || s > bestScore) {
        bestScore = s;
        bestPrev = prev;
      }
    }
    score[t] = onset[t] + Math.max(0, bestScore);
    from[t] = bestScore > 0 ? bestPrev : -1;
  }
  // End on the best-scoring frame of the last period, then walk back.
  let end = Math.max(0, n - Math.round(period));
  for (let t = end; t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = from[t]) beats.push(t);
  beats.reverse();
  // Before the first onset the path has nothing to follow: continue the grid back to the start.
  while (beats.length && beats[0] - period >= 0) beats.unshift(Math.round(beats[0] - period));
  return beats;
}

/** The strongest value within a frame of `f`. */
const peak = (x: Float64Array, f: number) => Math.max(x[f - 1] ?? 0, x[f] ?? 0, x[f + 1] ?? 0);

/**
 * Half, the same or double `period`: the fastest whose beats fall on a bass hit (a kick) nearly as often as the
 * best one's do. Hi-hats between the beats make half a beat look periodic, and a kick on every other beat makes
 * two beats look like one; bass-less intros and outros lower every candidate alike, hence "as often as the best".
 */
export function chooseOctave(onset: Float64Array, bass: Float64Array, period: number): number {
  const minLag = (60 * FPS) / MAX_BPM;
  const maxLag = (60 * FPS) / MIN_BPM;
  const candidates = [period / 2, period, period * 2].filter((p) => p >= minLag && p <= maxLag);
  const onBass = candidates.map((p) => {
    const beats = trackBeats(onset, p);
    return beats.filter((f) => peak(bass, f) >= 1).length / Math.max(1, beats.length);
  });
  const best = Math.max(...onBass);
  if (best <= 0) return period;
  return candidates[onBass.findIndex((share) => share >= OCTAVE_SHARE * best)];
}

/** Beats either side each beat is lined up with (see `regularise`). */
const GRID_RADIUS = 6;

/**
 * Beat times (seconds) evened out: each moved onto the straight line through it and its neighbours (least
 * squares over ±`GRID_RADIUS` beats). Music keeps a steady tempo over a few bars, so this takes out the frame-sized
 * jitter of individual onsets while still following a tempo that drifts.
 */
export function regularise(beats: readonly number[]): number[] {
  if (beats.length < 4) return [...beats];
  return beats.map((_, i) => {
    const lo = Math.max(0, i - GRID_RADIUS);
    const hi = Math.min(beats.length - 1, i + GRID_RADIUS);
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = lo; j <= hi; j++) {
      n++;
      sx += j;
      sy += beats[j];
      sxx += j * j;
      sxy += j * beats[j];
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return (sy - slope * sx) / n + slope * i;
  });
}

/** Where bars start: the phase (of 4) whose beats carry the most bass onset. */
function downbeatPhase(beats: number[], bass: Float64Array, onset: Float64Array): number {
  let best = 0;
  let bestSum = -1;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    for (let i = phase; i < beats.length; i += 4) {
      const f = beats[i];
      // The strongest bass (then overall) onset within a frame either side.
      let local = 0;
      for (let d = -1; d <= 1; d++) local = Math.max(local, (bass[f + d] ?? 0) * 2 + (onset[f + d] ?? 0));
      sum += local;
    }
    if (sum > bestSum) {
      bestSum = sum;
      best = phase;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Loudness: sections and drops
// ---------------------------------------------------------------------------

/** Loudness averaged over `seconds`-long blocks (dB of the mean power). */
function blocks(db: Float64Array, seconds: number): number[] {
  const size = Math.max(1, Math.round(seconds * FPS));
  const out: number[] = [];
  for (let i = 0; i < db.length; i += size) {
    let power = 0;
    const end = Math.min(db.length, i + size);
    for (let j = i; j < end; j++) power += 10 ** (db[j] / 10);
    out.push(10 * Math.log10(power / (end - i) + 1e-10));
  }
  return out;
}

const BLOCK = 0.5;
/** A change in loudness this big (dB) between the seconds before and after makes a new section. */
const SECTION_DB = 2;
const SECTION_WINDOW = 4;
const MIN_SECTION = 4;

/** Stretches of similar loudness, and the points where it rises most. */
function loudness(db: Float64Array, duration: number): { sections: MusicSection[]; rises: { time: number; rise: number }[] } {
  const levels = blocks(db, BLOCK);
  const w = Math.round(SECTION_WINDOW / BLOCK);
  const mean = (a: number, b: number) => {
    let power = 0;
    for (let i = a; i < b; i++) power += 10 ** (levels[i] / 10);
    return 10 * Math.log10(power / Math.max(1, b - a) + 1e-10);
  };
  // How much louder the next few seconds are than the last few, at each block edge.
  const change = levels.map((_, i) => (i < 1 || i >= levels.length - 1 ? 0 : mean(i, Math.min(levels.length, i + w)) - mean(Math.max(0, i - w), i)));
  const boundaries: number[] = [];
  const minGap = Math.round(MIN_SECTION / BLOCK);
  // Biggest changes first; each must be clear of the ones already taken.
  const order = change.map((c, i) => [Math.abs(c), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [size, i] of order) {
    if (size < SECTION_DB) break;
    if (i < minGap / 2 || levels.length - i < minGap / 2) continue;
    if (boundaries.every((b) => Math.abs(b - i) >= minGap)) boundaries.push(i);
  }
  boundaries.sort((a, b) => a - b);
  const loudest = Math.max(-100, ...levels);
  const edges = [0, ...boundaries, levels.length];
  const sections: MusicSection[] = [];
  for (let s = 0; s < edges.length - 1; s++) {
    const d = mean(edges[s], edges[s + 1]);
    sections.push({
      start: round(edges[s] * BLOCK),
      end: round(Math.min(duration, edges[s + 1] * BLOCK)),
      db: Math.round(d * 10) / 10,
      level: Math.round(Math.max(0, Math.min(1, 1 - (loudest - d) / 30)) * 100) / 100,
    });
  }
  const rises = boundaries.filter((i) => change[i] > 0).map((i) => ({ time: i * BLOCK, rise: Math.round(change[i] * 10) / 10 }));
  return { sections, rises };
}

const round = (t: number) => Math.round(t * 1000) / 1000;

/** The time in `grid` nearest to `t`, if it's within `reach`; else `t`. */
function snap(t: number, grid: readonly number[], reach: number): number {
  let best: number | null = null;
  for (const g of grid) if (best === null || Math.abs(g - t) < Math.abs(best - t)) best = g;
  return best !== null && Math.abs(best - t) <= reach ? best : t;
}

/** Everything about the music in `samples` (mono, `SAMPLE_RATE` Hz); times from their start. */
export function analyseRhythm(samples: Float32Array): MusicAnalysis {
  const duration = samples.length / SAMPLE_RATE;
  const { onset, bass, db, activity } = envelopes(samples);
  const { sections, rises } = loudness(db, duration);
  const pulse = estimatePeriod(onset);
  const period = pulse?.period ?? null;
  // How regular the onsets are: a clear beat repeats (drums ~0.3+), speech and pads don't.
  const confidence = pulse ? Math.round(Math.max(0, Math.min(1, pulse.periodicity * 2)) * 100) / 100 : 0;
  const steady = period !== null && confidence >= MIN_CONFIDENCE && activity >= MIN_ACTIVITY;
  const beatPeriod = steady ? chooseOctave(onset, bass, period) : 0;
  const beats = steady ? trackBeats(onset, beatPeriod) : [];
  const phase = steady && beats.length >= 4 ? downbeatPhase(beats, bass, onset) : 0;
  const times = steady
    ? regularise(beats.map((f) => f / FPS + ONSET_DELAY)).map((t) => round(Math.max(0, Math.min(duration, t))))
    : [];
  const downbeats = times.filter((_, i) => i % 4 === phase);
  const beatLength = steady ? beatPeriod / FPS : 0;
  const drops = rises
    .map((r) => ({ time: round(snap(r.time, downbeats.length ? downbeats : times, beatLength * 2)), rise: r.rise }))
    .sort((a, b) => b.rise - a.rise);
  return {
    bpm: steady ? Math.round(((60 * FPS) / beatPeriod) * 10) / 10 : null,
    confidence: steady ? confidence : 0,
    beats: times,
    downbeats,
    sections,
    drops,
  };
}
