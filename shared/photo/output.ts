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

/** Unpremultiplied, highlights and negatives clipped (SDR sRGB output), sRGB-encoded, in [0, 1]. */
export function encodePixel(r: number, g: number, b: number, a: number): [number, number, number, number] {
  const alpha = Math.min(1, Math.max(0, a));
  const un = (c: number) => (alpha > 0 ? c / alpha : 0);
  const enc = (c: number) => linearToSrgb(Math.min(1, Math.max(0, un(c))));
  return [enc(r), enc(g), enc(b), alpha];
}

/** One premultiplied linear pixel at document pixel (x, y) as 8-bit RGBA, dithered (alpha isn't). */
export function quantize8(r: number, g: number, b: number, a: number, x: number, y: number, amplitude = DITHER_8BIT): [number, number, number, number] {
  const [er, eg, eb, ea] = encodePixel(r, g, b, a);
  const d = amplitude > 0 ? ditherAt(x, y, amplitude) : 0;
  const q = (v: number) => Math.min(255, Math.max(0, Math.floor(v * 255 + d + 0.5)));
  return [q(er), q(eg), q(eb), Math.floor(ea * 255 + 0.5)];
}
