/**
 * The Magic Wand (docs/photo/selections.md): a click selects the pixels whose colour is within Tolerance of the
 * colour clicked (each of red, green, blue and alpha, 0..255: the largest difference decides), only those joined to
 * it (Contiguous, four ways) or everywhere. Anti-alias covers pixels a little past the tolerance partly (GIMP's
 * falloff: whole up to the tolerance, nothing past 1.5×), so the edge isn't stair-stepped. Sample Size averages the
 * colour clicked over a square of document pixels. Pure.
 */
import type { Size } from "./geometry.ts";
import { type PixelSample, coverageToSelection } from "./pixel-sample.ts";
import type { MaskSelection } from "./types.ts";

export interface WandOptions {
  /** 0..255 (Photoshop's default 32). */
  tolerance: number;
  contiguous: boolean;
  antiAlias: boolean;
  /** The side of the square averaged at the click, in document pixels (1: the pixel alone). */
  sampleSize: number;
}

export const WAND_DEFAULTS: WandOptions = { tolerance: 32, contiguous: true, antiAlias: true, sampleSize: 1 };

/** Photoshop's Sample Size choices. */
export const SAMPLE_SIZES = [1, 3, 5, 11, 31, 51, 101] as const;

/** The colour clicked: the sample's pixels over the square, averaged. */
export function wandColour(sample: PixelSample, at: { x: number; y: number }, sampleSize: number): [number, number, number, number] {
  const cx = Math.min(sample.width - 1, Math.max(0, Math.floor(at.x * sample.scale)));
  const cy = Math.min(sample.height - 1, Math.max(0, Math.floor(at.y * sample.scale)));
  const half = Math.max(0, Math.floor((Math.max(1, Math.round(sampleSize * sample.scale)) - 1) / 2));
  const sum = [0, 0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, cy - half); y <= Math.min(sample.height - 1, cy + half); y++) {
    for (let x = Math.max(0, cx - half); x <= Math.min(sample.width - 1, cx + half); x++) {
      const i = (y * sample.width + x) * 4;
      for (let c = 0; c < 4; c++) sum[c] += sample.data[i + c];
      n++;
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n, sum[3] / n];
}

/** How much a pixel `difference` (0..255) from the colour is selected, 0..1. */
export function wandAmount(difference: number, tolerance: number, antiAlias: boolean): number {
  if (!antiAlias || tolerance <= 0) return difference <= tolerance ? 1 : 0;
  const aa = 1.5 - difference / tolerance;
  return aa <= 0 ? 0 : aa < 0.5 ? aa * 2 : 1;
}

/** The wand clicked at document point `at`: the selection it makes, or null (it can't miss its own pixel, but off the canvas). */
export function magicWand(sample: PixelSample, at: { x: number; y: number }, options: WandOptions, canvas: Size): MaskSelection | null {
  if (at.x < 0 || at.y < 0 || at.x >= canvas.width || at.y >= canvas.height) return null;
  const { width, height, data } = sample;
  const [r, g, b, a] = wandColour(sample, at, options.sampleSize);
  const tolerance = Math.max(0, Math.min(255, options.tolerance));
  const amount = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const d = Math.max(Math.abs(data[p] - r), Math.abs(data[p + 1] - g), Math.abs(data[p + 2] - b), Math.abs(data[p + 3] - a));
    amount[i] = Math.round(wandAmount(d, tolerance, options.antiAlias) * 255);
  }
  const seed = Math.min(height - 1, Math.floor(at.y * sample.scale)) * width + Math.min(width - 1, Math.floor(at.x * sample.scale));
  // The clicked pixel is always the colour (an averaged one may stray past a tolerance of 0).
  amount[seed] = 255;
  const values = options.contiguous ? joined(amount, width, height, seed) : amount;
  return coverageToSelection(values, width, height, sample.scale, canvas);
}

/** Only what's joined to `seed` through selected pixels (four ways), by scanlines. */
function joined(amount: Uint8Array, width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(amount.length);
  const stack = [seed];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] || !amount[i]) continue;
    const y = Math.floor(i / width);
    let x0 = i - y * width;
    let x1 = x0;
    const row = y * width;
    while (x0 > 0 && amount[row + x0 - 1] && !out[row + x0 - 1]) x0--;
    while (x1 < width - 1 && amount[row + x1 + 1] && !out[row + x1 + 1]) x1++;
    for (let x = x0; x <= x1; x++) out[row + x] = amount[row + x];
    // Rows above and below: one seed per run that touches this one.
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let inRun = false;
      for (let x = x0; x <= x1; x++) {
        const open = amount[nrow + x] > 0 && !out[nrow + x];
        if (open && !inRun) stack.push(nrow + x);
        inRun = open;
      }
    }
  }
  return out;
}
