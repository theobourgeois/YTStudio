/**
 * The Paint Bucket's and the Magic Eraser's flood (docs/photo/tools/paint-bucket.md, magic-eraser.md): which pixels
 * a click reaches, as the Magic Wand decides (`magic-wand.ts`: the largest of the red, green, blue and alpha
 * differences against the pixel clicked, its anti-aliased falloff, its four-way scanline flood), and the Magic
 * Eraser's Defringe: the edge of what's erased unmixed from the colour clicked. All at a sample's size; the way back
 * to document pixels is `coverageToSelection`. Pure.
 */
import type { Size } from "./geometry.ts";
import { joined, wandAmount, wandColour } from "./magic-wand.ts";
import { type PixelSample, coverageToSelection } from "./pixel-sample.ts";
import type { MaskSelection } from "./types.ts";

export interface FloodOptions {
  /** 0..255 (Photoshop's default 32). */
  tolerance: number;
  /** Only what's joined to the point (else that colour everywhere). */
  contiguous: boolean;
  /** Pixels a little past the tolerance are reached partly. */
  antiAlias: boolean;
}

export interface Flood {
  /** How much each sample pixel is reached, 0..255, row by row. */
  amounts: Uint8Array;
  /** The colour clicked, straight RGBA 0..255 (the sample's: sRGB). */
  colour: [number, number, number, number];
}

/** The flood from document point `at` over a sample, or null when the point is off the canvas. */
export function flood(sample: PixelSample, at: { x: number; y: number }, options: FloodOptions, canvas: Size): Flood | null {
  if (!(at.x >= 0 && at.y >= 0 && at.x < canvas.width && at.y < canvas.height)) return null;
  const { width, height, data } = sample;
  const colour = wandColour(sample, at, 1);
  const [r, g, b, a] = colour;
  const tolerance = Math.max(0, Math.min(255, options.tolerance));
  const amounts = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const d = Math.max(Math.abs(data[p] - r), Math.abs(data[p + 1] - g), Math.abs(data[p + 2] - b), Math.abs(data[p + 3] - a));
    amounts[i] = Math.round(wandAmount(d, tolerance, options.antiAlias) * 255);
  }
  const seed = Math.min(height - 1, Math.floor(at.y * sample.scale)) * width + Math.min(width - 1, Math.floor(at.x * sample.scale));
  amounts[seed] = 255;
  return { amounts: options.contiguous ? joined(amounts, width, height, seed) : amounts, colour };
}

/**
 * How much of a colour is the matte (both straight, 0..1 a channel): GIMP's Color to Alpha, the least share of the
 * matte that leaves the rest a colour inside 0..1. A pixel half white and half red is half white; the matte itself
 * is all matte; a colour as far from it as can be is none.
 */
export function matteShare(c: readonly number[], matte: readonly number[]): number {
  let alpha = 0;
  for (let i = 0; i < 3; i++) {
    const m = matte[i];
    const d = c[i] - m;
    const need = d > 0 ? (m < 1 ? d / (1 - m) : 1) : d < 0 ? (m > 0 ? -d / m : 1) : 0;
    if (need > alpha) alpha = need;
  }
  return 1 - Math.min(1, alpha);
}

/** How many rings in from the erased area Defringe looks (a soft edge is rarely wider). */
export const DEFRINGE_RINGS = 3;

const NEIGHBOURS = [-1, 0, 1];

/** How much the share must fall from one ring to the next to go on (an 8-bit step: noise in a flat colour is not an edge). */
const FALL = 1 / 255;

/**
 * The Magic Eraser's Defringe: the flood's edge reached further by how much of each pixel is the colour clicked
 * (`matteShare`). The first ring is every pixel touching (eight ways) one wholly reached; each ring after grows only
 * where the share keeps falling (a soft edge fades into the subject; a flat colour, even a light one, doesn't), up
 * to `rings`. Transparent pixels say nothing. Returns new amounts (the flood's where Defringe adds nothing).
 */
export function defringe(sample: PixelSample, amounts: Uint8Array, colour: readonly number[], rings = DEFRINGE_RINGS): Uint8Array {
  const { width, height, data } = sample;
  const out = amounts.slice();
  const matte = [colour[0] / 255, colour[1] / 255, colour[2] / 255];
  const share = (i: number) => (data[i * 4 + 3] === 0 ? 0 : matteShare([data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255], matte));
  const level = new Float64Array(width * height);
  const seen = new Uint8Array(width * height);
  let ring: number[] = [];
  const touches = (i: number, test: (j: number) => boolean) => {
    const x = i % width;
    const y = (i - x) / width;
    for (const dy of NEIGHBOURS)
      for (const dx of NEIGHBOURS) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && test(ny * width + nx)) return true;
      }
    return false;
  };
  const take = (i: number, s: number) => {
    level[i] = s;
    out[i] = Math.max(out[i], Math.round(s * 255));
    ring.push(i);
  };
  for (let i = 0; i < out.length; i++) {
    if (amounts[i] === 255 || !touches(i, (j) => amounts[j] === 255)) continue;
    seen[i] = 1;
    const s = share(i);
    if (s > 0) take(i, s);
  }
  for (let r = 1; r < rings && ring.length; r++) {
    const from = ring;
    ring = [];
    for (const i of from) {
      const x = i % width;
      const y = (i - x) / width;
      for (const dy of NEIGHBOURS)
        for (const dx of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (seen[j] || amounts[j] === 255) continue;
          const s = share(j);
          if (s > 0 && s < level[i] - FALL) {
            seen[j] = 1;
            take(j, s);
          }
        }
    }
  }
  return out;
}

/** A flood's amounts as a selection of the document's pixels (null: nothing reached). */
export const floodSelection = (sample: PixelSample, amounts: Uint8Array, canvas: Size): MaskSelection | null => coverageToSelection(amounts, sample.width, sample.height, sample.scale, canvas);
