/**
 * EQ Match (Pro-Q's): the sound going in, and a reference (another Pro-Q's, after it), each averaged over
 * time; the difference between them, smoothed and evened out (tone, not loudness); then bands fitted to
 * it, the biggest difference first, and refined together. Also collisions: where this sound and the
 * reference both stand out in the same place, crowding each other. Pure, so it's tested.
 */
import { clamp } from "@shared/math";
import { bandCurve } from "@shared/music/pro-q-filters";
import { DEFAULT_BAND, EQ_SPECTRUM_POINTS, spectrumFrequency } from "@shared/music/pro-q-presets";
import type { EqBand } from "@shared/music/types";

/** The spectrum's points in an octave. */
const PER_OCTAVE = (EQ_SPECTRUM_POINTS - 1) / Math.log2(30_000 / 10);
const FREQUENCIES = Float64Array.from({ length: EQ_SPECTRUM_POINTS }, (_, i) => spectrumFrequency(i));
/** Where matching looks: 20 Hz to 20 kHz. */
const LOW = Math.ceil(Math.log2(20 / 10) * PER_OCTAVE);
const HIGH = Math.floor(Math.log2(20_000 / 10) * PER_OCTAVE);

/** A spectrum averaged over time (power, not dB), frame by frame. */
export class Average {
  readonly power = new Float64Array(EQ_SPECTRUM_POINTS);
  frames = 0;
  /** Add a frame (dB at the spectrum's points); a frame that's silent (all under -80 dB) doesn't count. */
  add(levels: readonly number[] | null) {
    if (!levels) return;
    let loud = false;
    for (let i = LOW; i <= HIGH; i++) if (levels[i] > -80) loud = true;
    if (!loud) return;
    for (let i = 0; i < this.power.length; i++) this.power[i] += 10 ** ((levels[i] ?? -200) / 10);
    this.frames++;
  }
  /** Its levels in dB. */
  levels(): Float64Array {
    return Float64Array.from(this.power, (p) => (this.frames ? 10 * Math.log10(p / this.frames + 1e-30) : -200));
  }
}

/** A moving average over `octaves` (centred), in dB. */
export function smooth(values: ArrayLike<number>, octaves: number): Float64Array {
  const reach = Math.max(1, Math.round((octaves * PER_OCTAVE) / 2));
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - reach); k <= Math.min(values.length - 1, i + reach); k++) {
      sum += values[k];
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

/**
 * The difference the reference asks for (dB at the spectrum's points): both smoothed by a sixth of an
 * octave, each set level by its average from 100 Hz to 10 kHz, their difference held within ±24 dB and
 * smoothed by a third of an octave, faded out under 30 Hz and over 18 kHz.
 */
export function matchDifference(input: ArrayLike<number>, reference: ArrayLike<number>): Float64Array {
  const a = smooth(input, 1 / 6);
  const b = smooth(reference, 1 / 6);
  const mean = (x: Float64Array) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < x.length; i++)
      if (FREQUENCIES[i] >= 100 && FREQUENCIES[i] <= 10_000) {
        sum += x[i];
        n++;
      }
    return n ? sum / n : 0;
  };
  const ma = mean(a);
  const mb = mean(b);
  const raw = Float64Array.from(a, (v, i) => clamp(b[i] - mb - (v - ma), -24, 24));
  const d = smooth(raw, 1 / 3);
  for (let i = 0; i < d.length; i++) {
    const hz = FREQUENCIES[i];
    const fade = hz < 30 ? clamp(Math.log2(hz / 15), 0, 1) : hz > 18_000 ? clamp(1 - Math.log2(hz / 18_000) / 0.5, 0, 1) : 1;
    d[i] *= fade;
  }
  return d;
}

const rms = (r: Float64Array) => {
  let sum = 0;
  for (let i = LOW; i <= HIGH; i++) sum += r[i] * r[i];
  return Math.sqrt(sum / (HIGH - LOW + 1));
};

type Spec = Pick<EqBand, "shape" | "frequency" | "gain" | "q" | "slope">;

/** The bands' curve at the spectrum's points. */
function curveOf(specs: readonly Spec[]): Float64Array {
  const total = new Float64Array(EQ_SPECTRUM_POINTS);
  for (const s of specs) {
    const c = bandCurve(s, FREQUENCIES);
    for (let i = 0; i < total.length; i++) total[i] += c[i];
  }
  return total;
}

/**
 * At most `count` bands that make the difference: each the biggest difference left (a Bell, or a shelf
 * at the ends), its Q from how wide it is, then all of them nudged (frequency, gain, Q) to fit better.
 */
export function matchBands(difference: Float64Array, count: number): Spec[] {
  const specs: Spec[] = [];
  let residual = Float64Array.from(difference);
  for (let k = 0; k < count; k++) {
    let at = -1;
    let most = 0.5;
    for (let i = LOW; i <= HIGH; i++)
      if (Math.abs(residual[i]) > most) {
        most = Math.abs(residual[i]);
        at = i;
      }
    if (at < 0) break;
    const gain = residual[at];
    const hz = FREQUENCIES[at];
    // Its width where it's fallen to half.
    let a = at;
    while (a > LOW && Math.sign(residual[a]) === Math.sign(gain) && Math.abs(residual[a]) > Math.abs(gain) / 2) a--;
    let b = at;
    while (b < HIGH && Math.sign(residual[b]) === Math.sign(gain) && Math.abs(residual[b]) > Math.abs(gain) / 2) b++;
    const shelf = a <= LOW + 2 ? "lowShelf" : b >= HIGH - 2 ? "highShelf" : null;
    const octaves = Math.max(1 / 6, (b - a) / PER_OCTAVE);
    const q = clamp(1 / (Math.SQRT2 * Math.sinh((Math.LN2 * octaves) / 2)), 0.3, 12);
    const spec: Spec = shelf
      ? { shape: shelf, frequency: shelf === "lowShelf" ? FREQUENCIES[b] : FREQUENCIES[a], gain: clamp(gain, -24, 24), q: 1, slope: 12 }
      : { shape: "bell", frequency: hz, gain: clamp(gain, -24, 24), q, slope: 12 };
    specs.push(spec);
    residual = Float64Array.from(difference, (v, i) => v - curveOf(specs)[i]);
  }
  // Refined together: each band's frequency, gain and Q moved a little at a time while it helps.
  const error = () => {
    const total = curveOf(specs);
    return rms(Float64Array.from(difference, (v, i) => v - total[i]));
  };
  let best = error();
  for (let pass = 0; pass < 4; pass++) {
    const step = 0.5 ** pass;
    for (const spec of specs) {
      for (const [key, by] of [
        ["frequency", 2 ** (step / 6)],
        ["frequency", 2 ** (-step / 6)],
        ["q", 2 ** (step / 3)],
        ["q", 2 ** (-step / 3)],
        ["gain", step],
        ["gain", -step],
      ] as const) {
        const was = spec[key] as number;
        const next = key === "gain" ? clamp(was + by, -24, 24) : clamp(was * by, key === "q" ? 0.3 : 20, key === "q" ? 12 : 20_000);
        (spec as Record<string, unknown>)[key] = next;
        const e = error();
        if (e < best - 1e-4) best = e;
        else (spec as Record<string, unknown>)[key] = was;
      }
    }
  }
  return specs.map((s) => ({ ...DEFAULT_BAND, ...s, frequency: Math.round(s.frequency * 100) / 100, gain: Math.round(s.gain * 100) / 100, q: Math.round(s.q * 1000) / 1000 }));
}

/** How far the bands leave the difference unmatched (dB, RMS from 20 Hz to 20 kHz). */
export const matchError = (difference: Float64Array, specs: readonly Spec[]) => {
  const total = curveOf(specs);
  return rms(Float64Array.from(difference, (v, i) => v - total[i]));
};

/**
 * Collisions (Pro-Q's "merely an indication"): at each point, how much (0..1) this sound and the other
 * both stand out (over the louder one's average), at levels near each other (within 9 dB).
 */
export function collisions(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const sa = smooth(a, 1 / 6);
  const sb = smooth(b, 1 / 6);
  const average = (x: Float64Array) => {
    let sum = 0;
    let n = 0;
    for (let i = LOW; i <= HIGH; i++)
      if (x[i] > -150) {
        sum += x[i];
        n++;
      }
    return n ? sum / n : -200;
  };
  // Both over the louder one's average (a floor both sit on isn't a collision).
  const floor = Math.max(average(sa), average(sb)) + 3;
  return Float64Array.from(sa, (v, i) => (Math.abs(v - sb[i]) < 9 ? clamp((Math.min(v, sb[i]) - floor) / 12, 0, 1) : 0));
}
