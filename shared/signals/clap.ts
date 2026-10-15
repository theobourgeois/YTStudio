/**
 * A sound as CLAP's audio model takes it (docs/now-playing.md, "The vibe"): ten seconds at 48 kHz, mono, as LAION's
 * log-mel spectrogram (Hugging Face's `ClapFeatureExtractor` without fusion: 1024-sample periodic Hann frames 480
 * apart, centred and reflect-padded, their power in 64 Slaney mel bands from 50 Hz to 14 kHz, in dB). Shorter sound is
 * repeated to fill the ten seconds, longer is cut to its last ten. Pure, and tested against transformers.js's.
 */

export const CLAP_RATE = 48_000;
/** Ten seconds. */
export const CLAP_SAMPLES = 480_000;
const FFT = 1024;
const HOP = 480;
export const CLAP_MELS = 64;
/** Frames in ten seconds (centred: one more than the hops). */
export const CLAP_FRAMES = 1 + CLAP_SAMPLES / HOP;
const BINS = FFT / 2 + 1;
const F_MIN = 50;
const F_MAX = 14_000;

/** Hertz to Slaney's mel scale (linear under 1 kHz, logarithmic over), and back. */
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = 15;
const LOG_STEP = 27 / Math.log(6.4);
const toMel = (hz: number) => (hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) * LOG_STEP : (3 * hz) / 200);
const toHz = (mel: number) => (mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp((mel - MIN_LOG_MEL) / LOG_STEP) : (200 * mel) / 3);

/** The mel bands' weights for each FFT bin, Slaney-normalised: `[bin * MELS + mel]`. */
function melFilters(): Float64Array {
  const lo = toMel(F_MIN);
  const hi = toMel(F_MAX);
  const edges = Array.from({ length: CLAP_MELS + 2 }, (_, i) => toHz(lo + ((hi - lo) * i) / (CLAP_MELS + 1)));
  const filters = new Float64Array(BINS * CLAP_MELS);
  for (let b = 0; b < BINS; b++) {
    const hz = (b * (CLAP_RATE / 2)) / (BINS - 1);
    for (let m = 0; m < CLAP_MELS; m++) {
      const down = (hz - edges[m]) / (edges[m + 1] - edges[m]);
      const up = (edges[m + 2] - hz) / (edges[m + 2] - edges[m + 1]);
      const weight = Math.max(0, Math.min(down, up));
      filters[b * CLAP_MELS + m] = weight * (2 / (edges[m + 2] - edges[m]));
    }
  }
  return filters;
}

/** An in-place radix-2 FFT of `re` and `im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
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
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

let tables: { filters: Float64Array; window: Float64Array; cos: Float64Array; sin: Float64Array } | null = null;

/** Ten seconds as CLAP hears them: the log-mel spectrogram, `[frame * CLAP_MELS + mel]` (`CLAP_FRAMES` frames). */
export function clapFeatures(sound: Float32Array): Float32Array {
  tables ??= {
    filters: melFilters(),
    window: Float64Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT)),
    cos: Float64Array.from({ length: FFT / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / FFT)),
    sin: Float64Array.from({ length: FFT / 2 }, (_, k) => Math.sin((2 * Math.PI * k) / FFT)),
  };
  const { filters, window, cos, sin } = tables;
  // Exactly ten seconds: the last ten, or what there is repeated (then silence).
  let wave = sound.length > CLAP_SAMPLES ? sound.subarray(sound.length - CLAP_SAMPLES) : sound;
  if (wave.length < CLAP_SAMPLES) {
    const filled = new Float32Array(CLAP_SAMPLES);
    const repeats = wave.length ? Math.floor(CLAP_SAMPLES / wave.length) : 0;
    for (let r = 0; r < repeats; r++) filled.set(wave, r * wave.length);
    wave = filled;
  }
  // Centred frames: the sound reflected at both ends by half a frame.
  const pad = FFT / 2;
  const at = (i: number) => wave[i < 0 ? -i : i >= CLAP_SAMPLES ? 2 * (CLAP_SAMPLES - 1) - i : i];
  const out = new Float32Array(CLAP_FRAMES * CLAP_MELS);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const power = new Float64Array(BINS);
  for (let f = 0; f < CLAP_FRAMES; f++) {
    const first = f * HOP - pad;
    for (let i = 0; i < FFT; i++) {
      re[i] = at(first + i) * window[i];
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    for (let b = 0; b < BINS; b++) power[b] = re[b] * re[b] + im[b] * im[b];
    for (let m = 0; m < CLAP_MELS; m++) {
      let sum = 0;
      for (let b = 0; b < BINS; b++) sum += filters[b * CLAP_MELS + m] * power[b];
      out[f * CLAP_MELS + m] = 10 * Math.log10(Math.max(1e-10, sum));
    }
  }
  return out;
}
