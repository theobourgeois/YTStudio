/**
 * A curve's shape (docs/photo/research/adjustments.md, "Curves"): a natural cubic spline through its points, flat
 * before the first and after the last, its output held to [0, 1]. Inputs and outputs here are fractions of the
 * encoded range (the points' 0..255 divided by 255). The CPU reference evaluates it exactly; the GPU reads a table
 * of it (`curveTable`).
 */
import type { CurvePoints, CurveSet } from "../types.ts";
import { CURVE_CHANNELS } from "./params.ts";

/** The curve as a function of a fraction in [0, 1]. */
export function curveFunction(points: CurvePoints): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0] / 255);
  const ys = points.map((p) => p[1] / 255);
  if (n < 2) return (x) => x;
  // Second derivatives with natural ends (zero at both), by the tridiagonal (Thomas) solve.
  const m = new Float64Array(n);
  if (n > 2) {
    const c = new Float64Array(n);
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      const h0 = xs[i] - xs[i - 1];
      const h1 = xs[i + 1] - xs[i];
      const a = h0 / 6;
      const b = (h0 + h1) / 3;
      const cc = h1 / 6;
      const r = (ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0;
      const denom = b - a * c[i - 1];
      c[i] = cc / denom;
      d[i] = (r - a * d[i - 1]) / denom;
    }
    for (let i = n - 2; i >= 1; i--) m[i] = d[i] - c[i] * m[i + 1];
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const a = (xs[hi] - x) / h;
    const b = (x - xs[lo]) / h;
    const y = a * ys[lo] + b * ys[hi] + ((a * a * a - a) * m[lo] + (b * b * b - b) * m[hi]) * ((h * h) / 6);
    return Math.max(0, Math.min(1, y));
  };
}

/** Whether a curve changes nothing: from (0, 0) to (255, 255), every point on the diagonal (a straight spline). */
export const isIdentityCurve = (points: CurvePoints) =>
  points.length >= 2 && points[0][0] === 0 && points.at(-1)![0] === 255 && points.every(([x, y]) => x === y);

/** What a channel's encoded value becomes: its own curve, then the composite's. */
export function channelFunctions(set: CurveSet): [(x: number) => number, (x: number) => number, (x: number) => number] {
  const rgb = curveFunction(set.rgb);
  const one = (points: CurvePoints) => {
    const own = curveFunction(points);
    return (x: number) => rgb(own(x));
  };
  return [one(set.red), one(set.green), one(set.blue)];
}

/** Per channel, whether it's left alone (its own curve and the composite are both the identity). */
export const identityChannels = (set: CurveSet): [boolean, boolean, boolean] => {
  const rgb = isIdentityCurve(set.rgb);
  return [rgb && isIdentityCurve(set.red), rgb && isIdentityCurve(set.green), rgb && isIdentityCurve(set.blue)];
};

export const isIdentityCurveSet = (set: CurveSet) => CURVE_CHANNELS.every((c) => isIdentityCurve(set[c]));

/** Entries per channel in the GPU's table: linear interpolation between them is within 1e-5 of the spline. */
export const CURVE_TABLE_SIZE = 4096;

/** Each channel's whole curve sampled at i / (size − 1): red, then green, then blue. */
export function curveTable(set: CurveSet, size = CURVE_TABLE_SIZE): Float32Array {
  const table = new Float32Array(3 * size);
  channelFunctions(set).forEach((f, c) => {
    for (let i = 0; i < size; i++) table[c * size + i] = f(i / (size - 1));
  });
  return table;
}
