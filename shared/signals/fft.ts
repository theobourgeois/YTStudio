/**
 * The FFT every analysis of sound uses (signals, beats, the music suite's spectrum): in place, radix 2,
 * with each size's bit-reversal order and twiddles worked out once.
 */

interface Plan {
  /** Pairs to swap for the bit-reversed order: i, j, i, j... */
  swaps: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, Plan>();

function plan(n: number): Plan {
  let p = plans.get(n);
  if (p) return p;
  const swaps: number[] = [];
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) swaps.push(i, j);
  }
  // Twiddles for the largest stage; a stage of `size` takes every (n / size)th.
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((-2 * Math.PI * k) / n);
    sin[k] = Math.sin((-2 * Math.PI * k) / n);
  }
  p = { swaps: Uint32Array.from(swaps), cos, sin };
  plans.set(n, p);
  return p;
}

/** In-place FFT of `re` + i·`im` (the same length, a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n < 2) return;
  if ((n & (n - 1)) !== 0) throw new Error(`An FFT's length must be a power of two, not ${n}`);
  const { swaps, cos, sin } = plan(n);
  for (let s = 0; s < swaps.length; s += 2) {
    const i = swaps[s];
    const j = swaps[s + 1];
    const r = re[i];
    re[i] = re[j];
    re[j] = r;
    const m = im[i];
    im[i] = im[j];
    im[j] = m;
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += stride) {
        const wr = cos[t];
        const wi = sin[t];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** A Hann window of `n` points (periodic: it tiles at half overlap). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
