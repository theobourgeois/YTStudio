/**
 * The output transform (docs/photo/rendering.md, "The output transform"): how a premultiplied linear pixel leaves
 * as an sRGB-encoded sample. This is the CPU reference; the GPU's `quantize` and the view run the same steps,
 * with the same dither hash, so their outputs can be compared sample for sample.
 */
import { linearToSrgb } from "./colour.ts";

/**
 * 8-bit dither: ± this much of a step, uniform. A round trip through f16 tiles moves an 8-bit sample by at most
 * 0.037 of a step (opaque) or 0.092 (premultiplied by any 8-bit alpha): worked out exhaustively and measured on
 * the GPU in F0. ½ − 0.092 − 0.375 leaves 0.033, so a sample that was exactly an 8-bit level stays that level.
 */
export const DITHER_8BIT = 0.375;

/** A 32-bit hash of a pixel's coordinates (the same u32 arithmetic as the WGSL `hash2`). */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x >>> 0, 0x8da6b343) ^ Math.imul(y >>> 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** The dither offset at a document pixel, in steps: uniform in [-amplitude, amplitude). */
export const ditherAt = (x: number, y: number, amplitude = DITHER_8BIT) => ((hash2(x, y) >>> 8) / 16777216) * 2 * amplitude - amplitude;

/** How light above white leaves (the document's `output.highlights`). */
export type Highlights = "film" | "clip";

/**
 * `film`'s shoulder (docs/photo/f4-light.md, D3): how fast light above white turns white. One stop over white is
 * halfway there at 1.
 */
export const FILM_STRENGTH = 1;

/**
 * `film` (rendering.md, "The output transform"): identity while every channel is within [0, 1]; above, the
 * largest channel stays at 1 and the colour mixes towards white by `1 − m^(−s)`, so the hue is kept and brighter
 * light is whiter. Continuous and monotonic in the light's intensity. Unpremultiplied colour in, out.
 */
export function filmHighlights(r: number, g: number, b: number, s = FILM_STRENGTH): [number, number, number] {
  const m = Math.max(r, g, b);
  if (!(m > 1)) return [r, g, b];
  const w = 1 - m ** -s;
  const k = (1 - w) / m;
  return [r * k + w, g * k + w, b * k + w];
}

/** Unpremultiplied, highlights rolled off (`film`) or clipped, negatives clipped (SDR sRGB output), sRGB-encoded, in [0, 1]. */
export function encodePixel(r: number, g: number, b: number, a: number, highlights: Highlights = "clip"): [number, number, number, number] {
  const alpha = Math.min(1, Math.max(0, a));
  const un = (c: number) => (alpha > 0 ? c / alpha : 0);
  let rgb: [number, number, number] = [un(r), un(g), un(b)];
  if (highlights === "film") rgb = filmHighlights(...rgb);
  const enc = (c: number) => linearToSrgb(Math.min(1, Math.max(0, c)));
  return [enc(rgb[0]), enc(rgb[1]), enc(rgb[2]), alpha];
}

/** One premultiplied linear pixel at document pixel (x, y) as 8-bit RGBA, dithered (alpha isn't). */
export function quantize8(r: number, g: number, b: number, a: number, x: number, y: number, amplitude = DITHER_8BIT, highlights: Highlights = "clip"): [number, number, number, number] {
  const [er, eg, eb, ea] = encodePixel(r, g, b, a, highlights);
  const d = amplitude > 0 ? ditherAt(x, y, amplitude) : 0;
  const q = (v: number) => Math.min(255, Math.max(0, Math.floor(v * 255 + d + 0.5)));
  return [q(er), q(eg), q(eb), Math.floor(ea * 255 + 0.5)];
}
