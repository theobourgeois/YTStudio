/**
 * Loudness as broadcasters and streaming services measure it: ITU-R BS.1770-4 (K-weighting, gated
 * integrated loudness), EBU Tech 3341 (momentary 400 ms, short-term 3 s) and Tech 3342 (loudness range),
 * and a 4× oversampled true peak (BS.1770 Annex 2's method, with our own interpolation filter).
 * Pure: plain sample arrays in, numbers out. Every value says its method so reports can be compared.
 */

export const LOUDNESS_METHOD = { name: "bs1770-4", version: "1" } as const;
export const TRUE_PEAK_METHOD = { name: "4x-windowed-sinc-true-peak", version: "1" } as const;

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** BS.1770's two stages at any sample rate (designed from their analog prototypes, as libebur128 does). */
export function kWeighting(sampleRate: number): Biquad[] {
  let f0 = 1681.974450955533, q = 0.7071752369554196;
  const gain = 3.999843853973347;
  let k = Math.tan(Math.PI * f0 / sampleRate);
  const vh = 10 ** (gain / 20), vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf = { b0: (vh + vb * k / q + k * k) / a0, b1: 2 * (k * k - vh) / a0, b2: (vh - vb * k / q + k * k) / a0, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
  f0 = 38.13547087602444; q = 0.5003270373238773;
  k = Math.tan(Math.PI * f0 / sampleRate);
  a0 = 1 + k / q + k * k;
  const highPass = { b0: 1, b1: -2, b2: 1, a1: 2 * (k * k - 1) / a0, a2: (1 - k / q + k * k) / a0 };
  return [shelf, highPass];
}

/** 100 ms of K-weighted energy at a time, per channel: every BS.1770 window is a whole number of them. */
export const CHUNK_SECONDS = 0.1;

/**
 * Each channel's K-weighted mean square over consecutive 100 ms chunks (a last partial chunk is left out),
 * summed over channels with BS.1770's weights (1 for left, right and centre; surround isn't used here).
 */
export function loudnessChunks(channels: Float32Array[], sampleRate: number): Float64Array {
  const size = Math.round(sampleRate * CHUNK_SECONDS), count = Math.floor((channels[0]?.length ?? 0) / size);
  const out = new Float64Array(count);
  for (const samples of channels) {
    const [s, h] = kWeighting(sampleRate);
    let sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0, hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
    for (let c = 0; c < count; c++) {
      let sum = 0;
      for (let i = c * size, end = i + size; i < end; i++) {
        const x = samples[i];
        const y = s.b0 * x + s.b1 * sx1 + s.b2 * sx2 - s.a1 * sy1 - s.a2 * sy2;
        sx2 = sx1; sx1 = x; sy2 = sy1; sy1 = y;
        const z = h.b0 * y + h.b1 * hx1 + h.b2 * hx2 - h.a1 * hy1 - h.a2 * hy2;
        hx2 = hx1; hx1 = y; hy2 = hy1; hy1 = z;
        sum += z * z;
      }
      out[c] += sum / size;
    }
  }
  return out;
}

/** LUFS from a channel-summed mean square. */
export const lufs = (meanSquare: number) => meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;

/** The mean of `chunks[from, from + length)` (a window made of whole chunks). */
function windowMean(chunks: Float64Array, from: number, length: number) {
  let sum = 0;
  for (let i = from; i < from + length; i++) sum += chunks[i];
  return sum / length;
}

/** Windows of `seconds`, every `hop` seconds, as channel-summed mean squares (EBU's momentary is 0.4, short-term 3). */
export function windowEnergies(chunks: Float64Array, seconds: number, hop: number): Float64Array {
  const length = Math.round(seconds / CHUNK_SECONDS), step = Math.max(1, Math.round(hop / CHUNK_SECONDS));
  const count = chunks.length >= length ? Math.floor((chunks.length - length) / step) + 1 : 0;
  const out = new Float64Array(count);
  for (let w = 0; w < count; w++) out[w] = windowMean(chunks, w * step, length);
  return out;
}

/** BS.1770-4 integrated loudness: 400 ms blocks overlapping by 75%, gated at -70 LUFS and then 10 LU under their mean. */
export function integratedLoudness(chunks: Float64Array): number | null {
  const blocks = [...windowEnergies(chunks, 0.4, 0.1)].filter(e => lufs(e) > -70);
  if (!blocks.length) return null;
  const relative = lufs(blocks.reduce((a, b) => a + b, 0) / blocks.length) - 10;
  const gated = blocks.filter(e => lufs(e) > relative);
  return gated.length ? lufs(gated.reduce((a, b) => a + b, 0) / gated.length) : null;
}

/** EBU Tech 3342 loudness range: short-term values every 100 ms, gated at -70 LUFS and 20 LU under their mean, P95 − P10. */
export function loudnessRange(chunks: Float64Array): number | null {
  const shortTerm = [...windowEnergies(chunks, 3, 0.1)].filter(e => lufs(e) > -70);
  if (shortTerm.length < 2) return null;
  const relative = lufs(shortTerm.reduce((a, b) => a + b, 0) / shortTerm.length) - 20;
  const values = shortTerm.map(lufs).filter(l => l > relative).sort((a, b) => a - b);
  if (values.length < 2) return null;
  const at = (p: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(p * (values.length - 1))))];
  return at(0.95) - at(0.1);
}

// True peak: the signal between samples, 4× oversampled with a windowed sinc (12 taps a phase, Hann).
const TAPS = 12, PHASES = 4;
const phaseFilters = (() => {
  const filters: Float64Array[] = [];
  for (let p = 1; p < PHASES; p++) {
    const t = p / PHASES, h = new Float64Array(TAPS);
    for (let k = 0; k < TAPS; k++) {
      const x = k - (TAPS / 2 - 1) - t; // taps from -5 to +6 around the point between samples
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const window = 0.5 + 0.5 * Math.cos(Math.PI * x / (TAPS / 2));
      h[k] = sinc * window;
    }
    filters.push(h);
  }
  return filters;
})();

/** The highest absolute value between and on the samples of every channel (linear; 0 for silence). */
export function truePeak(channels: Float32Array[], sampleRate: number): number {
  let peak = 0;
  for (const x of channels) {
    for (let i = 0; i < x.length; i++) {
      const v = Math.abs(x[i]);
      if (v > peak) peak = v;
      // Above 176.4 kHz the samples are close enough already.
      if (sampleRate >= 176400) continue;
      for (const h of phaseFilters) {
        let y = 0;
        for (let k = 0; k < TAPS; k++) {
          const j = i - (TAPS / 2 - 1) + k;
          if (j >= 0 && j < x.length) y += x[j] * h[k];
        }
        const a = Math.abs(y);
        if (a > peak) peak = a;
      }
    }
  }
  return peak;
}

export interface LoudnessSummary {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDbtp: number | null;
  maxMomentaryLufs: number | null;
  maxShortTermLufs: number | null;
  /** Short-term loudness (3 s) each `step` seconds, centred on `times`; -Infinity where silent. */
  shortTerm: { times: number[]; lufs: number[] };
}
const finiteOrNull = (v: number) => Number.isFinite(v) ? v : null;
export function loudnessSummary(channels: Float32Array[], sampleRate: number, step = 1): LoudnessSummary {
  const chunks = loudnessChunks(channels, sampleRate);
  const momentary = windowEnergies(chunks, 0.4, 0.1), shortTerm = windowEnergies(chunks, 3, 0.1);
  const series = windowEnergies(chunks, 3, step);
  const peak = truePeak(channels, sampleRate);
  return {
    integratedLufs: integratedLoudness(chunks),
    loudnessRangeLu: loudnessRange(chunks),
    truePeakDbtp: peak > 0 ? 20 * Math.log10(peak) : null,
    maxMomentaryLufs: finiteOrNull(lufs(Math.max(0, ...momentary))),
    maxShortTermLufs: finiteOrNull(lufs(Math.max(0, ...shortTerm))),
    shortTerm: { times: [...series].map((_, i) => i * step + 1.5), lufs: [...series].map(lufs) },
  };
}
