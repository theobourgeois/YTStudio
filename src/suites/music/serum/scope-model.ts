/**
 * The Serum player's display, its maths (pure, tested): the engine's spectrum as the heights of a ridge, how the
 * ridge follows the sound (quick up, slow down), the waveform held still on its cycle, and the stereo picture.
 * `scope-view.tsx` draws them.
 */

/** The engine's spectrum: 480 points, log-spaced from 10 Hz to 30 kHz (`eq::SpectrumGrid`, `EQ_SPECTRUM_POINTS`). */
const POINTS = 480;
const LOWEST = 10;
const HIGHEST = 30_000;
/** What the ridge shows: 30 Hz to 16 kHz, in this many steps. */
export const RIDGE_LOW = 30;
export const RIDGE_HIGH = 16_000;
export const RIDGE_BINS = 96;
/** dB under full scale that reads as flat. */
const FLOOR = 72;
/** Music falls about this much an octave: tilted level about 1 kHz, a pad's lows don't dwarf its air. */
const TILT_PER_OCTAVE = 4.5;

const pointOf = (hz: number) => (Math.log(hz / LOWEST) / Math.log(HIGHEST / LOWEST)) * (POINTS - 1);
/** Where `hz` is across the ridge, 0 to 1. */
export const ridgeX = (hz: number) => Math.log(hz / RIDGE_LOW) / Math.log(RIDGE_HIGH / RIDGE_LOW);

/** The spectrum at a fractional point (between two of the engine's). */
function at(db: readonly number[], point: number): number {
  const i = Math.max(0, Math.min(db.length - 1, Math.floor(point)));
  const j = Math.min(db.length - 1, i + 1);
  const f = point - i;
  return db[i] * (1 - f) + db[j] * f;
}

/**
 * The engine's spectrum (dB, a full-scale sine reading 0) as `bins` heights from 0 (flat) to 1: each the loudest
 * of the points it spans (or between two, where it spans less than one), tilted level, `FLOOR` dB of range, eased
 * so the peaks stand out of the hum.
 */
export function ridgeHeights(db: readonly number[], bins = RIDGE_BINS): Float32Array {
  const out = new Float32Array(bins);
  if (!db.length) return out;
  for (let b = 0; b < bins; b++) {
    const from = RIDGE_LOW * (RIDGE_HIGH / RIDGE_LOW) ** (b / bins);
    const to = RIDGE_LOW * (RIDGE_HIGH / RIDGE_LOW) ** ((b + 1) / bins);
    const p0 = pointOf(from);
    const p1 = pointOf(to);
    let level = at(db, (p0 + p1) / 2);
    for (let p = Math.ceil(p0); p <= Math.floor(p1) && p < db.length; p++) level = Math.max(level, db[p]);
    const centre = Math.sqrt(from * to);
    const tilted = level + TILT_PER_OCTAVE * Math.log2(centre / 1000);
    const h = Math.max(0, Math.min(1, (tilted + FLOOR) / FLOOR));
    out[b] = h ** 1.6;
  }
  return out;
}

/** How fast the ridge rises to a louder sound and falls back from it (seconds: time constants). */
const RISE = 0.03;
const FALL = 0.35;

/** `current` moved toward `target` over `dt` seconds: quick up, slow down (as a meter). In place. */
export function follow(current: Float32Array, target: Float32Array, dt: number): Float32Array {
  const up = 1 - Math.exp(-dt / RISE);
  const down = 1 - Math.exp(-dt / FALL);
  for (let i = 0; i < current.length; i++) {
    const t = target[i] ?? 0;
    current[i] += (t - current[i]) * (t > current[i] ? up : down);
  }
  return current;
}

/**
 * `length` samples of `wave` starting on a rising zero crossing (the first in its first half, else the start), so a
 * steady note's waveform stands still from one frame to the next, as an oscilloscope's trigger holds it.
 */
export function triggered(wave: readonly number[], length = 512): number[] {
  const last = Math.max(0, wave.length - length);
  let start = 0;
  for (let i = 1; i <= last; i++)
    if (wave[i - 1] < 0 && wave[i] >= 0) {
      start = i;
      break;
    }
  return wave.slice(start, start + length);
}

/**
 * The stereo picture: each pair as a point, mid up and side across (a vectorscope's 45°), both -1 to 1. A mono
 * sound is a vertical line, a wide one a cloud.
 */
export function stereoPoints(left: readonly number[], right: readonly number[]): [number, number][] {
  const n = Math.min(left.length, right.length);
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) points.push([(left[i] - right[i]) * Math.SQRT1_2, (left[i] + right[i]) * Math.SQRT1_2]);
  return points;
}

/** Where the energy sits across the ridge, 0 (lows) to 1 (highs): the glow's colour and place. 0.5 when silent. */
export function centroid(heights: Float32Array): number {
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < heights.length; i++) {
    sum += heights[i];
    weighted += heights[i] * (i / Math.max(1, heights.length - 1));
  }
  return sum > 1e-4 ? weighted / sum : 0.5;
}

/** How much is sounding, 0 to 1, from the ridge (its loudest stretch, not its average: a thin lead still glows). */
export function energy(heights: Float32Array): number {
  let top = 0;
  let mean = 0;
  for (const h of heights) {
    top = Math.max(top, h);
    mean += h;
  }
  mean /= Math.max(1, heights.length);
  return Math.min(1, 0.65 * top + 0.35 * Math.sqrt(mean));
}
