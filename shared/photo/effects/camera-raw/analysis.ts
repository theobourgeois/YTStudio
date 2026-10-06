/**
 * Camera Raw's analysis (docs/photo/camera-raw.md, "CR2"): what its local sliders and Contrast's pivot read about the
 * whole picture they develop, worked out once per picture from a coarse render of it (the layer as it is before this
 * Camera Raw, or everything below an adjustment layer) and independent of the sliders, so a drag never redoes it.
 *
 * - Edge-aware bases of the log luminance, as fast guided filters (He and Sun, 2015; Camera Raw has one): their
 *   coefficients `a`, `b` on the coarse grid, so a pixel's base at full resolution is `a·L + b` with its own `L`.
 *   Edges stay in the base, so moving the base (Highlights, Shadows) or the detail over it (Clarity, Texture)
 *   leaves no halo, at any zoom, in any tile.
 * - Dehaze's haze, by the dark-channel prior (He, Sun and Tang, 2009; Camera Raw's): the airlight, and each place's
 *   dark channel over it, refined by a guided filter on the luminance.
 * - Statistics: the tone base's range (Highlights and Shadows act within the picture's own range: a flat picture has
 *   none and doesn't change, as Camera Raw's doesn't) and the mean tone Contrast pivots around.
 */
import { linearToSrgb } from "../../colour.ts";
import { V_BRIGHTEN } from "./measured.ts";

/** The coarse grid's longest side, in cells. */
export const ANALYSIS_SIDE = 256;
/**
 * Floats per grid cell: the tone base's a, b; Clarity's; Texture's; Dehaze's dark channel; the soft mean (Clarity −);
 * the fine base's a, b (edges and mid-sized detail kept, a picture's grain smoothed: Clarity's band starts there).
 */
export const GRID_FLOATS = 11;

/** Radii as fractions of the picture's long side, and how much variance (stops²) counts as an edge. */
const TONE = { radius: 0.05, eps: 0.5 };
const CLARITY = { radius: 0.025, eps: 0.2 };
const TEXTURE = { radius: 0.008, eps: 0.3 };
const FINE = { radius: 0.004, eps: 0.01 };
const HAZE = { radius: 0.015, eps: 0.01, top: 0.001 };

export interface CameraRawAnalysis {
  /** Says what it was made from (the input's key), for caches. */
  id: string;
  /** The grid: `width` × `height` cells of `spacing` document pixels each, from the canvas's top left. */
  width: number;
  height: number;
  spacing: number;
  /** `GRID_FLOATS` per cell, row by row. */
  grid: Float32Array;
  /** The tone base's 2nd and 98th percentiles (log2 luminance): the picture's range. */
  low: number;
  high: number;
  /** The mean tone, in Camera Raw's tone coordinate (Contrast pivots around it). */
  meanTone: number;
  /** Dehaze's airlight, straight linear sRGB. */
  airlight: [number, number, number];
}

/** The grid's spacing for a canvas: the smallest power of two putting its long side within `ANALYSIS_SIDE` cells. */
export function analysisSpacing(canvas: { width: number; height: number }): number {
  const long = Math.max(canvas.width, canvas.height);
  return 2 ** Math.max(0, Math.ceil(Math.log2(long / ANALYSIS_SIDE)));
}

/** The coarse picture: premultiplied linear sRGB, `width` × `height` cells of `spacing` document pixels. */
export interface CoarseImage {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/** Log2 of a luminance, held off −∞. */
export const logLuminance = (r: number, g: number, b: number) => Math.log2(Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 2 ** -20));

/** Camera Raw's tone coordinate at an encoded value 0..1 (its brightening fit). */
function toneAt(e: number): number {
  const code = Math.max(0, Math.min(255, e * 255));
  const i = Math.min(254, Math.floor(code));
  return V_BRIGHTEN[i] + (V_BRIGHTEN[i + 1] - V_BRIGHTEN[i]) * (code - i);
}

/** A mean over a (2r+1)² window, weighted (`w`), clamped at the edges: running sums, separable. */
function boxMean(values: Float64Array, weights: Float64Array, width: number, height: number, r: number): Float64Array {
  const pass = (src: Float64Array, w: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(src.length);
    const outW = new Float64Array(src.length);
    const n = horizontal ? width : height;
    const lines = horizontal ? height : width;
    for (let line = 0; line < lines; line++) {
      const at = (i: number) => (horizontal ? line * width + i : i * width + line);
      let s = 0;
      let sw = 0;
      for (let i = 0; i <= Math.min(r, n - 1); i++) {
        s += src[at(i)];
        sw += w[at(i)];
      }
      for (let i = 0; i < n; i++) {
        out[at(i)] = s;
        outW[at(i)] = sw;
        const add = i + r + 1;
        const drop = i - r;
        if (add < n) {
          s += src[at(add)];
          sw += w[at(add)];
        }
        if (drop >= 0) {
          s -= src[at(drop)];
          sw -= w[at(drop)];
        }
      }
    }
    return [out, outW] as const;
  };
  const weighted = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) weighted[i] = values[i] * weights[i];
  const [h, hw] = pass(weighted, weights, true);
  const [v, vw] = pass(h, hw, false);
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = vw[i] > 1e-9 ? v[i] / vw[i] : 0;
  return out;
}

/** A guided filter's coefficients (smoothed): `p ≈ a·I + b` locally, edges of `I` kept. */
function guided(I: Float64Array, p: Float64Array, w: Float64Array, width: number, height: number, r: number, eps: number) {
  const n = I.length;
  const Ip = new Float64Array(n);
  const II = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxMean(I, w, width, height, r);
  const mp = boxMean(p, w, width, height, r);
  const mIp = boxMean(Ip, w, width, height, r);
  const mII = boxMean(II, w, width, height, r);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const variance = Math.max(0, mII[i] - mI[i] * mI[i]);
    a[i] = (mIp[i] - mI[i] * mp[i]) / (variance + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ones = new Float64Array(n).fill(1);
  return { a: boxMean(a, ones, width, height, r), b: boxMean(b, ones, width, height, r) };
}

/** A weighted percentile, from a fine histogram (exact to 1/4096 of the values' range). */
function percentile(values: Float64Array, weights: Float64Array, q: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!(weights[i] > 0)) continue;
    lo = Math.min(lo, values[i]);
    hi = Math.max(hi, values[i]);
    total += weights[i];
  }
  if (!(total > 0)) return 0;
  if (hi - lo < 1e-12) return lo;
  const bins = 4096;
  const counts = new Float64Array(bins);
  for (let i = 0; i < values.length; i++) if (weights[i] > 0) counts[Math.min(bins - 1, Math.floor(((values[i] - lo) / (hi - lo)) * bins))] += weights[i];
  let acc = 0;
  for (let k = 0; k < bins; k++) {
    acc += counts[k];
    if (acc >= q * total) return lo + ((k + 0.5) / bins) * (hi - lo);
  }
  return hi;
}

/** The analysis of a coarse picture of a canvas (`id`: what it was made from). */
export function analyse(image: CoarseImage, canvas: { width: number; height: number }, spacing: number, id: string): CameraRawAnalysis {
  const { width, height } = image;
  const n = width * height;
  const L = new Float64Array(n);
  const w = new Float64Array(n);
  const rgb = new Float64Array(n * 3);
  let toneSum = 0;
  let weightSum = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, Math.min(1, image.data[i * 4 + 3]));
    w[i] = a;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = a > 0 ? Math.max(0, image.data[i * 4 + c] / a) : 0;
    L[i] = logLuminance(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    const Y = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    toneSum += a * toneAt(linearToSrgb(Math.min(1, Y)));
    weightSum += a;
  }
  const long = Math.max(canvas.width, canvas.height) / spacing;
  const cells = (fraction: number) => Math.max(1, Math.round(fraction * long));
  const tone = guided(L, L, w, width, height, cells(TONE.radius), TONE.eps);
  const clarity = guided(L, L, w, width, height, cells(CLARITY.radius), CLARITY.eps);
  const texture = guided(L, L, w, width, height, cells(TEXTURE.radius), TEXTURE.eps);
  const fine = guided(L, L, w, width, height, cells(FINE.radius), FINE.eps);
  // Negative Clarity softens across edges (Camera Raw's dreamy glow): towards the plain mean at its scale.
  const soft = boxMean(L, w, width, height, cells(CLARITY.radius));

  // Dehaze: the airlight from the haziest places (the top of the dark channel), their colour averaged.
  const dark = new Float64Array(n);
  for (let i = 0; i < n; i++) dark[i] = w[i] > 0 ? Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) : 0;
  // No minimum over a patch (He's): it spreads a dark object's estimate into the haze beside it (a bright rim); the
  // guided filter keeps each side of an edge to its own.
  const threshold = percentile(dark, w, 1 - HAZE.top);
  const top: number[] = [];
  for (let i = 0; i < n; i++) if (w[i] > 0 && dark[i] >= threshold) top.push(i);
  if (!top.length) top.push(0);
  const airlight: [number, number, number] = [0, 0, 0];
  for (const i of top) for (let c = 0; c < 3; c++) airlight[c] += rgb[i * 3 + c] / top.length;
  for (let c = 0; c < 3; c++) airlight[c] = Math.max(airlight[c], 1e-3);
  const ratio = new Float64Array(n);
  for (let i = 0; i < n; i++) ratio[i] = w[i] > 0 ? Math.min(rgb[i * 3] / airlight[0], rgb[i * 3 + 1] / airlight[1], rgb[i * 3 + 2] / airlight[2], 1) : 0;
  const haze = guided(L, ratio, w, width, height, cells(HAZE.radius), HAZE.eps);

  const grid = new Float32Array(n * GRID_FLOATS);
  const base = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    grid.set([tone.a[i], tone.b[i], clarity.a[i], clarity.b[i], texture.a[i], texture.b[i], haze.a[i], haze.b[i], soft[i], fine.a[i], fine.b[i]], i * GRID_FLOATS);
    base[i] = tone.a[i] * L[i] + tone.b[i];
  }
  return {
    id,
    width,
    height,
    spacing,
    grid,
    low: percentile(base, w, 0.02),
    high: percentile(base, w, 0.98),
    meanTone: weightSum > 0 ? toneSum / weightSum : 0,
    airlight,
  };
}

/** The grid's `GRID_FLOATS` values at a document point: bilinear between cell centres, held at the edges. */
export function gridAt(an: CameraRawAnalysis, x: number, y: number): number[] {
  const gx = Math.max(0, Math.min(an.width - 1, x / an.spacing - 0.5));
  const gy = Math.max(0, Math.min(an.height - 1, y / an.spacing - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, an.width - 1);
  const y1 = Math.min(y0 + 1, an.height - 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (cx: number, cy: number, k: number) => an.grid[(cy * an.width + cx) * GRID_FLOATS + k];
  const out: number[] = [];
  for (let k = 0; k < GRID_FLOATS; k++) {
    const top = at(x0, y0, k) + (at(x1, y0, k) - at(x0, y0, k)) * fx;
    const bottom = at(x0, y1, k) + (at(x1, y1, k) - at(x0, y1, k)) * fx;
    out.push(top + (bottom - top) * fy);
  }
  return out;
}
