/**
 * The Background Eraser (docs/photo/tools/background-eraser.md): which pixels under a dab are erased, and how much.
 * The colour under the hotspot (or the first one, or the background swatch) is compared with each pixel by the Magic
 * Wand's measure on 8-bit encoded straight colour; Limits keep what's joined to the hotspot (a scanline flood over
 * the dab's window) or stop at edges. A stroke accumulates, per pixel, how much is erased and the background colour
 * taken out (`accumulate`); the GPU then extracts it (`reference/background-erase.ts`). Pure: the tab reads the
 * layer's tiles and hands them here.
 */
import { dabCoverage } from "./brush.ts";
import { srgbToLinear } from "./colour.ts";

export type EraseSampling = "continuous" | "once" | "swatch";
export type EraseLimits = "contiguous" | "discontiguous" | "edges";

export interface BackgroundEraserOptions {
  sampling: EraseSampling;
  limits: EraseLimits;
  /** 0..100% (Photoshop's default 50). */
  tolerance: number;
  /** Spare colours near the foreground colour. */
  protectForeground: boolean;
}

export const ERASER_DEFAULTS: BackgroundEraserOptions = { sampling: "continuous", limits: "contiguous", tolerance: 50, protectForeground: false };

/** Dabs every quarter of the diameter (Photoshop's spacing for this brush). */
export const ERASER_SPACING = 0.25;

/** Encoded straight colour, 0..255 a channel. */
export type Colour8 = readonly [number, number, number];

/**
 * A window of a layer's pixels as matching reads them: 8-bit sRGB-encoded straight RGBA, `width` × `height` from
 * (`x`, `y`) of the layer's own pixels.
 */
export interface PixelWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Tolerance (0..100%) as 8-bit levels. */
export const toleranceLevels = (percent: number) => (Math.max(0, Math.min(100, percent)) / 100) * 255;

/**
 * How much of a pixel `difference` levels from the sample is erased (0..1): wholly up to half the tolerance, then
 * less to nothing at it (a soft band: edge pixels, a mix, go in part); `hard`: wholly up to the tolerance, else
 * nothing. Tolerance 0 erases the exact colour.
 */
export function matchAmount(difference: number, tolerance: number, hard = false): number {
  if (tolerance <= 0) return difference < 0.5 ? 1 : 0;
  if (hard) return difference <= tolerance ? 1 : 0;
  const half = tolerance / 2;
  if (difference <= half) return 1;
  return difference >= tolerance ? 0 : (tolerance - difference) / half;
}

/** The largest of the red, green and blue differences between pixel `i` of `data` and a colour (the Magic Wand's). */
export function difference(data: Uint8ClampedArray, i: number, colour: Colour8): number {
  const p = i * 4;
  return Math.max(Math.abs(data[p] - colour[0]), Math.abs(data[p + 1] - colour[1]), Math.abs(data[p + 2] - colour[2]));
}

/** A window's pixel at layer pixel (x, y) as a sample (null where it's transparent or outside: nothing to sample). */
export function sampleAt(win: PixelWindow, x: number, y: number): Colour8 | null {
  const px = Math.floor(x) - win.x;
  const py = Math.floor(y) - win.y;
  if (px < 0 || py < 0 || px >= win.width || py >= win.height) return null;
  const p = (py * win.width + px) * 4;
  if (win.data[p + 3] < 2) return null;
  return [win.data[p], win.data[p + 1], win.data[p + 2]];
}

export interface EraseMatch {
  sample: Colour8;
  /** 8-bit levels (`toleranceLevels`). */
  tolerance: number;
  limits: EraseLimits;
  /** The foreground colour Protect Foreground Color spares, or null. */
  protect: Colour8 | null;
  /** Where Contiguous and Find Edges flood from (window pixels), or null: everywhere matching is kept. */
  seed: { x: number; y: number } | null;
}

/**
 * How much of each window pixel is erased (0..1), given `reach`: where the dab reaches (its coverage, > 0 to count;
 * null: everywhere). Transparent pixels are left out (nothing to erase).
 */
export function eraseAmounts(win: PixelWindow, match: EraseMatch, reach: Float32Array | null = null): Float32Array {
  const { width, height, data } = win;
  const n = width * height;
  const hard = match.limits === "edges";
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if ((reach && !(reach[i] > 0)) || data[i * 4 + 3] === 0) continue;
    let m = matchAmount(difference(data, i, match.sample), match.tolerance, hard);
    if (m > 0 && match.protect) m *= 1 - matchAmount(difference(data, i, match.protect), match.tolerance);
    out[i] = m;
  }
  if (match.limits === "discontiguous" || !match.seed) return out;
  const sx = Math.floor(match.seed.x);
  const sy = Math.floor(match.seed.y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return new Float32Array(n);
  const blocks = hard ? edgePixels(win, match.tolerance / 2) : null;
  const kept = flood(out, width, height, sy * width + sx, blocks);
  for (let i = 0; i < n; i++) if (!kept[i]) out[i] = 0;
  return out;
}

/** Pixels on a strong edge: a 4-neighbour more than `threshold` levels away (Find Edges' flood doesn't go on from them). */
export function edgePixels(win: PixelWindow, threshold: number): Uint8Array {
  const { width, height, data } = win;
  const out = new Uint8Array(width * height);
  const far = (i: number, j: number) => {
    const p = i * 4;
    const q = j * 4;
    return Math.max(Math.abs(data[p] - data[q]), Math.abs(data[p + 1] - data[q + 1]), Math.abs(data[p + 2] - data[q + 2])) > threshold;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((x > 0 && far(i, i - 1)) || (x < width - 1 && far(i, i + 1)) || (y > 0 && far(i, i - width)) || (y < height - 1 && far(i, i + width))) out[i] = 1;
    }
  }
  return out;
}

/**
 * The pixels joined (four ways) to `seed` through pixels with any amount. A pixel in `blocks` is reached but the
 * flood doesn't go on from it (an edge: a dead end).
 */
export function flood(amount: Float32Array, width: number, height: number, seed: number, blocks: Uint8Array | null = null): Uint8Array {
  const out = new Uint8Array(amount.length);
  if (!(amount[seed] > 0)) return out;
  const queue = new Int32Array(amount.length);
  let head = 0;
  let tail = 0;
  out[seed] = 1;
  queue[tail++] = seed;
  const visit = (j: number) => {
    if (out[j] || !(amount[j] > 0)) return;
    out[j] = 1;
    queue[tail++] = j;
  };
  while (head < tail) {
    const i = queue[head++];
    if (blocks?.[i] && i !== seed) continue;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < (height - 1) * width) visit(i + width);
  }
  return out;
}

/** A dab in a layer's own pixels. */
export interface EraseDab {
  x: number;
  y: number;
  radius: number;
  hardness: number;
}

/** The window a dab reaches (whole pixels around its disc). */
export function dabWindow(dab: EraseDab): { x: number; y: number; width: number; height: number } {
  const x0 = Math.floor(dab.x - dab.radius);
  const y0 = Math.floor(dab.y - dab.radius);
  const x1 = Math.ceil(dab.x + dab.radius);
  const y1 = Math.ceil(dab.y + dab.radius);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** The brush's coverage of each pixel of a window (its centre's distance from the dab's). */
export function dabReach(win: { x: number; y: number; width: number; height: number }, dab: EraseDab): Float32Array {
  const out = new Float32Array(win.width * win.height);
  for (let y = 0; y < win.height; y++) {
    for (let x = 0; x < win.width; x++) {
      const d = Math.hypot(win.x + x + 0.5 - dab.x, win.y + y + 0.5 - dab.y);
      out[y * win.width + x] = dabCoverage({ radius: dab.radius, hardness: dab.hardness, strength: 1 }, d);
    }
  }
  return out;
}

/**
 * What one dab erases of its window (`win` is the dab's window: `dabWindow`): the brush's coverage times the match,
 * flooded from the hotspot for Contiguous and Find Edges.
 */
export function dabErase(win: PixelWindow, dab: EraseDab, sample: Colour8, options: { tolerance: number; limits: EraseLimits; protect: Colour8 | null }): Float32Array {
  const reach = dabReach(win, dab);
  const seed = { x: dab.x - win.x, y: dab.y - win.y };
  const amounts = eraseAmounts(win, { sample, tolerance: toleranceLevels(options.tolerance), limits: options.limits, protect: options.protect, seed }, reach);
  for (let i = 0; i < amounts.length; i++) amounts[i] *= reach[i];
  return amounts;
}

/** A sample as linear light (the background colour a stroke takes out). */
export const sampleLight = (c: Colour8): [number, number, number] => [srgbToLinear(c[0] / 255), srgbToLinear(c[1] / 255), srgbToLinear(c[2] / 255)];

/**
 * Adds a dab's erasure `w` (0..1 a pixel) of background `light` into a stroke's accumulation `acc` (RGBA a pixel:
 * the background taken out, weighted, and how much is erased), the Brush's source-over: `acc ← (B, 1)·w + acc·(1 − w)`.
 * `w` covers a window at (`wx`, `wy`) of `acc`'s `accWidth`-wide grid; only its overlap is touched.
 */
export function accumulate(acc: Float32Array, accWidth: number, accHeight: number, w: Float32Array, wx: number, wy: number, ww: number, wh: number, light: readonly [number, number, number]) {
  const x0 = Math.max(0, wx);
  const y0 = Math.max(0, wy);
  const x1 = Math.min(accWidth, wx + ww);
  const y1 = Math.min(accHeight, wy + wh);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const k = w[(y - wy) * ww + (x - wx)];
      if (!(k > 0)) continue;
      const p = (y * accWidth + x) * 4;
      const keep = 1 - k;
      acc[p] = light[0] * k + acc[p] * keep;
      acc[p + 1] = light[1] * k + acc[p + 1] * keep;
      acc[p + 2] = light[2] * k + acc[p + 2] * keep;
      acc[p + 3] = k + acc[p + 3] * keep;
    }
  }
}

/** sRGB encoding to 8 bits, by table (65 536 steps of linear light: under a twentieth of a level near black). */
const ENCODE = (() => {
  const table = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) {
    const l = i / 65535;
    const v = l <= 0.0031308049535603713 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
    table[i] = Math.round(v * 255);
  }
  return table;
})();

/** Premultiplied linear RGBA floats (a tile read back) as 8-bit encoded straight RGBA: what matching reads. */
export function encodePixels(premultiplied: ArrayLike<number>, out = new Uint8ClampedArray(premultiplied.length)): Uint8ClampedArray {
  for (let p = 0; p < premultiplied.length; p += 4) {
    const a = premultiplied[p + 3];
    if (!(a > 1e-6)) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const l = premultiplied[p + c] / a;
      out[p + c] = l <= 0 ? 0 : l >= 1 ? 255 : ENCODE[Math.round(l * 65535)];
    }
    out[p + 3] = Math.round(Math.min(1, a) * 255);
  }
  return out;
}

/** "#rrggbb" as an 8-bit colour. */
export const hexColour8 = (hex: string): Colour8 => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as unknown as Colour8;
