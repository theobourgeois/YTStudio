/**
 * Measuring a reverb's impulse response (`docs/reverb/reverb.md` 9.7), for the Reverb's offline tests:
 * octave-band filters run forwards and backwards (they don't smear the decay), Schroeder's backward
 * integral and T30 by least squares, how straight the decay is, Abel and Huang's normalised echo
 * density, the spectral peaks a metallic tail shows, the correlation of two sides, loudness. Pure,
 * tested on synthetic signals of known decay (`reverb-measure.test.ts`).
 */

/** A biquad's coefficients (RBJ), normalised: b0, b1, b2, a1, a2. */
type Coefficients = [number, number, number, number, number];

function biquad(kind: "lowpass" | "highpass" | "bandpass", rate: number, hz: number, q: number): Coefficients {
  const w = (2 * Math.PI * Math.min(hz, rate * 0.49)) / rate;
  const c = Math.cos(w),
    alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  if (kind === "lowpass") return [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0];
  if (kind === "highpass") return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0];
  return [alpha / a0, 0, -alpha / a0, (-2 * c) / a0, (1 - alpha) / a0];
}

function run(x: Float64Array, [b0, b1, b2, a1, a2]: Coefficients): Float64Array {
  const y = new Float64Array(x.length);
  let z1 = 0,
    z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = b0 * x[i] + z1;
    z1 = b1 * x[i] - a1 * out + z2;
    z2 = b2 * x[i] - a2 * out;
    y[i] = out;
  }
  return y;
}

/** Forwards then backwards: zero phase, the response squared. */
function filtfilt(x: Float64Array, sections: Coefficients[]): Float64Array {
  let y = x;
  for (const s of sections) y = run(y, s);
  y.reverse();
  for (const s of sections) y = run(y, s);
  return y.reverse();
}

/** An octave band around `centre` (Butterworth, 4th order each side, run both ways). */
export function octaveBand(x: ArrayLike<number>, rate: number, centre: number): Float64Array {
  const lo = centre / Math.SQRT2,
    hi = Math.min(centre * Math.SQRT2, rate * 0.45);
  const sections: Coefficients[] = [biquad("highpass", rate, lo, 0.5412), biquad("highpass", rate, lo, 1.3066)];
  if (hi < rate * 0.449) sections.push(biquad("lowpass", rate, hi, 0.5412), biquad("lowpass", rate, hi, 1.3066));
  return filtfilt(Float64Array.from(x), sections);
}

/** A band-pass of any width (Butterworth, 4th order each side, both ways). */
export function bandPass(x: ArrayLike<number>, rate: number, lo: number, hi: number): Float64Array {
  return filtfilt(Float64Array.from(x), [biquad("highpass", rate, lo, 0.5412), biquad("highpass", rate, lo, 1.3066), biquad("lowpass", rate, hi, 0.5412), biquad("lowpass", rate, hi, 1.3066)]);
}

/**
 * Schroeder's energy decay curve (dB, 0 at `from`), integrated backwards from where the signal falls
 * into its floor (the energy after `until`, or the end, is left out).
 */
export function energyDecay(x: ArrayLike<number>, from = 0, until = x.length): Float64Array {
  const n = until - from;
  const edc = new Float64Array(n);
  let sum = 0;
  for (let i = until - 1; i >= from; i--) {
    sum += x[i] * x[i];
    edc[i - from] = sum;
  }
  const total = edc[0] || 1e-300;
  for (let i = 0; i < n; i++) edc[i] = 10 * Math.log10(Math.max(edc[i] / total, 1e-30));
  return edc;
}

/** Where the signal is loudest (its first such sample). */
export function peakIndex(x: ArrayLike<number>): number {
  let best = 0,
    at = 0;
  for (let i = 0; i < x.length; i++)
    if (Math.abs(x[i]) > best) {
      best = Math.abs(x[i]);
      at = i;
    }
  return at;
}

/**
 * Where a decaying signal reaches its floor: the end of the last 10 ms window whose energy is still
 * `drop` dB under the loudest window's or louder (the integral stops there, so the floor doesn't bend it).
 */
export function decayEnd(x: ArrayLike<number>, rate: number, drop = 100): number {
  const w = Math.max(1, Math.round(rate * 0.01));
  let loudest = 0;
  const energies: number[] = [];
  for (let i = 0; i + w <= x.length; i += w) {
    let e = 0;
    for (let k = i; k < i + w; k++) e += x[k] * x[k];
    energies.push(e);
    loudest = Math.max(loudest, e);
  }
  const floor = loudest * 10 ** (-drop / 10);
  for (let j = energies.length - 1; j >= 0; j--) if (energies[j] > floor) return Math.min(x.length, (j + 1) * w);
  return x.length;
}

/** A least-squares line through (t, y) where y lies in [lo, hi]: its slope (y per second). */
function slopeBetween(edc: Float64Array, rate: number, hi: number, lo: number): number {
  let n = 0,
    st = 0,
    sy = 0,
    stt = 0,
    sty = 0;
  for (let i = 0; i < edc.length; i++) {
    const y = edc[i];
    if (y > hi) continue;
    if (y < lo) break;
    const t = i / rate;
    n++;
    st += t;
    sy += y;
    stt += t * t;
    sty += t * y;
  }
  if (n < 2) return NaN;
  return (n * sty - st * sy) / (n * stt - st * st);
}

/** T60 (s) from the T30 (or T20 where `range` is 20) of an impulse response measured from its loudest sample (or from `after`, the late part alone). */
export function reverbTime(x: ArrayLike<number>, rate: number, range: 20 | 30 = 30, after = 0): number {
  const from = Math.max(peakIndex(x), after);
  const edc = energyDecay(x, from, Math.max(from + 2, decayEnd(x, rate)));
  const slope = slopeBetween(edc, rate, -5, -5 - range);
  return -60 / slope;
}

/** The decay's deviation from a straight line between -5 and -45 dB (the largest, dB). */
export function decayCurvature(x: ArrayLike<number>, rate: number, lo = -45): number {
  const from = peakIndex(x);
  const edc = energyDecay(x, from, Math.max(from + 2, decayEnd(x, rate)));
  const slope = slopeBetween(edc, rate, -5, lo);
  let start = 0;
  while (start < edc.length && edc[start] > -5) start++;
  let end = start;
  while (end < edc.length && edc[end] > lo) end++;
  // The line through the fit's own points (least squares intercept).
  let sy = 0,
    st = 0;
  for (let i = start; i < end; i++) {
    sy += edc[i];
    st += i / rate;
  }
  const n = Math.max(1, end - start);
  const intercept = sy / n - (slope * st) / n;
  let worst = 0;
  for (let i = start; i < end; i++) worst = Math.max(worst, Math.abs(edc[i] - (intercept + (slope * i) / rate)));
  return worst;
}

/** erfc(1/√2): the fraction of a Gaussian's samples more than one deviation out. */
const GAUSSIAN_OUTSIDE = 0.3173105078629141;

/**
 * Abel and Huang's normalised echo density profile: in a Hann window of `window` samples around each
 * point, the weighted fraction of samples beyond the window's standard deviation, over a Gaussian's
 * (1 for Gaussian noise; well under 1 for sparse echoes). Every `hop` samples.
 */
export function echoDensity(x: ArrayLike<number>, window = 1024, hop = 64): { at: number; density: number }[] {
  const out: { at: number; density: number }[] = [];
  const w = Float64Array.from({ length: window }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / window));
  const wsum = w.reduce((a, b) => a + b, 0);
  for (let i = 0; i + window <= x.length; i += hop) {
    let power = 0;
    for (let k = 0; k < window; k++) power += w[k] * x[i + k] * x[i + k];
    const sigma = Math.sqrt(power / wsum);
    let outside = 0;
    for (let k = 0; k < window; k++) if (Math.abs(x[i + k]) > sigma) outside += w[k];
    out.push({ at: i + window / 2, density: outside / wsum / GAUSSIAN_OUTSIDE });
  }
  return out;
}

/** A radix-2 FFT's power spectrum of `x` (its length a power of two), bins 0 .. n/2. */
export function powerSpectrum(x: Float64Array): Float64Array {
  const n = x.length;
  const re = Float64Array.from(x),
    im = new Float64Array(n);
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
    for (let start = 0; start < n; start += size)
      for (let k = 0; k < size / 2; k++) {
        const c = Math.cos(step * k),
          s = Math.sin(step * k);
        const a = start + k,
          b = a + size / 2;
        const tr = re[b] * c - im[b] * s,
          ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
  const p = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

/** Welch's average power spectrum: Hann windows of `size`, 75% overlap. */
export function welch(x: ArrayLike<number>, size = 8192): Float64Array {
  const hann = Float64Array.from({ length: size }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / size));
  const sum = new Float64Array(size / 2 + 1);
  let count = 0;
  for (let i = 0; i + size <= x.length; i += size / 4) {
    const frame = Float64Array.from({ length: size }, (_, k) => x[i + k] * hann[k]);
    const p = powerSpectrum(frame);
    for (let k = 0; k < p.length; k++) sum[k] += p[k];
    count++;
  }
  for (let k = 0; k < sum.length; k++) sum[k] /= Math.max(1, count);
  return sum;
}

/** A tail divided by its own 10 ms RMS envelope: what's left is its fine structure, level aside. */
export function whitened(x: ArrayLike<number>, rate: number): Float64Array {
  const half = Math.max(1, Math.round(rate * 0.005));
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + x[i] * x[i];
  return Float64Array.from({ length: x.length }, (_, i) => {
    const lo = Math.max(0, i - half),
      hi = Math.min(x.length, i + half);
    return x[i] / Math.sqrt(Math.max((prefix[hi] - prefix[lo]) / (hi - lo), 1e-30));
  });
}

/**
 * How peaky a spectrum is: the given percentile (0..1) of each bin over the median of its third-octave
 * neighbourhood, in dB, between `lo` and `hi` Hz. A metallic tail's resonances stand up.
 */
export function peakiness(spectrum: Float64Array, rate: number, size: number, lo: number, hi: number, percentile = 0.999): number {
  const ratios: number[] = [];
  const bin = (f: number) => Math.round((f * size) / rate);
  for (let k = bin(lo); k <= Math.min(spectrum.length - 1, bin(hi)); k++) {
    const f = (k * rate) / size;
    const a = Math.max(1, bin(f / 2 ** (1 / 6))),
      b = Math.min(spectrum.length - 1, bin(f * 2 ** (1 / 6)));
    const around = Array.from(spectrum.subarray(a, b + 1)).sort((x, y) => x - y);
    const median = around[around.length >> 1] || 1e-30;
    ratios.push(10 * Math.log10(Math.max(spectrum[k], 1e-30) / median));
  }
  ratios.sort((x, y) => x - y);
  return ratios[Math.min(ratios.length - 1, Math.floor(percentile * ratios.length))];
}

/** The correlation of two signals (−1 .. 1). */
export function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(Math.max(aa * bb, 1e-300));
}

/** Mean square. */
export function energy(x: ArrayLike<number>, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i] * x[i];
  return e / Math.max(1, to - from);
}

export const dB = (power: number) => 10 * Math.log10(Math.max(power, 1e-30));

/** EBU R128's K-weighting (its two filters at 48 kHz) and an integrated loudness without gating (a steady signal's). */
export function loudness(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const shelf: Coefficients = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const rlb: Coefficients = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
  const k = (x: ArrayLike<number>) => run(run(Float64Array.from(x), shelf), rlb);
  return -0.691 + dB(energy(k(left)) + energy(k(right)));
}

/** A mulberry32 generator (repeatable noise). */
export function noise(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian noise (Box–Muller) from a generator. */
export function gaussian(next: () => number) {
  return () => Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) * Math.cos(2 * Math.PI * next());
}

/** Pink noise (Paul Kellet's filter on white), about unit variance. */
export function pink(length: number, seed: number): Float32Array {
  const next = noise(seed);
  const out = new Float32Array(length);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < length; i++) {
    const w = next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/**
 * The reference a perfectly smooth tail would give: Gaussian noise decaying at each octave band's T60
 * (bands of noise, each with its own exponential, summed). `t60` at `bands` (Hz).
 */
export function smoothTail(rate: number, seconds: number, bands: readonly number[], t60: readonly number[], seed = 7): Float64Array {
  const n = Math.round(rate * seconds);
  const out = new Float64Array(n);
  bands.forEach((f, b) => {
    if (f * Math.SQRT2 > rate * 0.45) return;
    const g = gaussian(noise(seed + b * 101));
    const raw = Float64Array.from({ length: n }, (_, i) => g() * 10 ** ((-3 * i) / rate / t60[b]));
    const band = octaveBand(raw, rate, f);
    for (let i = 0; i < n; i++) out[i] += band[i];
  });
  return out;
}
