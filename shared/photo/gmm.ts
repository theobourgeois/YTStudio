/**
 * Colour models for Quick Selection (docs/photo/selections.md): a Gaussian mixture over RGB, fitted as GrabCut
 * fits its (k-means, then each cluster's weight, mean and full covariance). Paint Selection uses four components
 * for what's painted and eight for the rest. Pure and seeded, so a fit repeats.
 */

export interface Gaussian {
  weight: number;
  mean: [number, number, number];
  /** The covariance's inverse, row by row. */
  inverse: number[];
  /** log(weight) − ½·log((2π)³·det Σ): the component's log density at its mean. */
  logScale: number;
}

export interface Mixture {
  components: Gaussian[];
}

/** Added to each covariance's diagonal (in 0..255 units): a flat patch's model isn't a spike. */
const REGULARISE = 4;

/** A small seeded generator. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

/** Fits up to `k` components to colours `points` (r, g, b, … flat), k-means++ seeded by `seed`. */
export function fitMixture(points: Float32Array | number[], k: number, seed = 1): Mixture {
  const n = Math.floor(points.length / 3);
  if (n === 0) return { components: [] };
  const random = seeded(seed);
  const count = Math.max(1, Math.min(k, n));
  // k-means++ centres.
  const centres: number[][] = [];
  const first = Math.floor(random() * n);
  centres.push([points[first * 3], points[first * 3 + 1], points[first * 3 + 2]]);
  const nearest = new Float64Array(n).fill(Infinity);
  while (centres.length < count) {
    const c = centres[centres.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = sq(points[i * 3] - c[0]) + sq(points[i * 3 + 1] - c[1]) + sq(points[i * 3 + 2] - c[2]);
      if (d < nearest[i]) nearest[i] = d;
      total += nearest[i];
    }
    if (total === 0) break;
    let pick = random() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) {
      pick -= nearest[i];
      if (pick <= 0) {
        chosen = i;
        break;
      }
    }
    centres.push([points[chosen * 3], points[chosen * 3 + 1], points[chosen * 3 + 2]]);
  }
  const label = new Int32Array(n);
  for (let iteration = 0; iteration < 8; iteration++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centres.length; c++) {
        const d = sq(points[i * 3] - centres[c][0]) + sq(points[i * 3 + 1] - centres[c][1]) + sq(points[i * 3 + 2] - centres[c][2]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (label[i] !== best) moved = true;
      label[i] = best;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[label[i]];
      s[0] += points[i * 3];
      s[1] += points[i * 3 + 1];
      s[2] += points[i * 3 + 2];
      s[3]++;
    }
    sums.forEach((s, c) => {
      if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
    if (!moved && iteration > 0) break;
  }
  const components: Gaussian[] = [];
  for (let c = 0; c < centres.length; c++) {
    let m = 0;
    const mean: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (label[i] !== c) continue;
      m++;
      for (let j = 0; j < 3; j++) mean[j] += points[i * 3 + j];
    }
    if (!m) continue;
    for (let j = 0; j < 3; j++) mean[j] /= m;
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (label[i] !== c) continue;
      const d = [points[i * 3] - mean[0], points[i * 3 + 1] - mean[1], points[i * 3 + 2] - mean[2]];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cov[r * 3 + q] += d[r] * d[q];
    }
    for (let j = 0; j < 9; j++) cov[j] /= m;
    cov[0] += REGULARISE;
    cov[4] += REGULARISE;
    cov[8] += REGULARISE;
    const det = determinant(cov);
    components.push({ weight: m / n, mean, inverse: inverse3(cov, det), logScale: Math.log(m / n) - 0.5 * Math.log((2 * Math.PI) ** 3 * det) });
  }
  return { components };
}

/** −log of the mixture's density at a colour (large where the model doesn't expect it). */
export function negLogLikelihood(model: Mixture, r: number, g: number, b: number): number {
  let total = 0;
  for (const c of model.components) {
    const x = r - c.mean[0];
    const y = g - c.mean[1];
    const z = b - c.mean[2];
    const v = c.inverse;
    const q = x * (v[0] * x + v[1] * y + v[2] * z) + y * (v[3] * x + v[4] * y + v[5] * z) + z * (v[6] * x + v[7] * y + v[8] * z);
    total += Math.exp(c.logScale - 0.5 * q);
  }
  // A colour no component explains costs as much as a very unlikely one, never infinity.
  return -Math.log(Math.max(total, 1e-30));
}

const sq = (v: number) => v * v;

function determinant(m: number[]) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function inverse3(m: number[], det: number): number[] {
  const k = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * k,
    (m[2] * m[7] - m[1] * m[8]) * k,
    (m[1] * m[5] - m[2] * m[4]) * k,
    (m[5] * m[6] - m[3] * m[8]) * k,
    (m[0] * m[8] - m[2] * m[6]) * k,
    (m[2] * m[3] - m[0] * m[5]) * k,
    (m[3] * m[7] - m[4] * m[6]) * k,
    (m[1] * m[6] - m[0] * m[7]) * k,
    (m[0] * m[4] - m[1] * m[3]) * k,
  ];
}
