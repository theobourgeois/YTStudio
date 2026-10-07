/**
 * The Gradient tool's CPU reference (docs/photo/tools/gradient.md): a Gradient Fill's pixel at a document point
 * (`../effects/gradient.ts`), and a Classic gradient painted onto a pixel or a mask's value. `render/gradient.ts`'s
 * WGSL is the same arithmetic and is tested against this: the gradient is read from the same table (the gradient
 * sampled at `GRADIENT_FILL_TABLE` points, mixed linearly between them), so the GPU and the CPU agree to f16's
 * rounding whatever the method.
 */
import { srgbToLinear } from "../colour.ts";
import { type GradientFillShape, gradientDither, gradientT } from "../effects/gradient.ts";
import { gradientTable } from "../style/gradients.ts";
import type { BlendMode, Compositing } from "../types.ts";
import { type BlendParams, type Rgba, compositePixel } from "./blend.ts";

/** Entries in a Gradient Fill's table: at 4096 px a stripe's edge is a pixel wide. */
export const GRADIENT_FILL_TABLE = 4096;

/** The table a shape reads: straight encoded RGB and opacity, RGBA, Reverse applied. */
export const fillTable = (shape: GradientFillShape, size = GRADIENT_FILL_TABLE): Float32Array => gradientTable(shape.gradient, shape.reverse, size);

/** The table at `t` in [0, 1], mixed linearly between its two nearest entries. */
export function tableAt(table: Float32Array, t: number): Rgba {
  const n = table.length / 4;
  const f = Math.max(0, Math.min(1, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  const out = [0, 0, 0, 0] as Rgba;
  for (let c = 0; c < 4; c++) out[c] = table[i * 4 + c] * (1 - k) + table[(i + 1) * 4 + c] * k;
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The gradient at document point (x, y) (a pixel's centre): straight encoded colour and opacity, held to [0, 1],
 * with Dither's offset of the pixel it's in on its colour (never its opacity: an opaque gradient stays opaque).
 */
export function gradientColourAt(shape: GradientFillShape, table: Float32Array, x: number, y: number): Rgba {
  const c = tableAt(table, gradientT(shape.style, shape.start, shape.end, x, y));
  const d = shape.dither ? gradientDither(Math.floor(x), Math.floor(y)) / 255 : 0;
  return [clamp01(c[0] + d), clamp01(c[1] + d), clamp01(c[2] + d), clamp01(c[3])];
}

/** A Gradient Fill's pixel at document point (x, y): premultiplied linear light, its opacity its coverage. */
export function gradientFillPixel(shape: GradientFillShape, table: Float32Array, x: number, y: number): Rgba {
  const [r, g, b, a] = gradientColourAt(shape, table, x, y);
  return [srgbToLinear(r) * a, srgbToLinear(g) * a, srgbToLinear(b) * a, a];
}

/**
 * How a Classic gradient goes onto what's there (its options bar's Mode): a layer blend mode, or one of Photoshop's
 * two painting modes: Behind (only where the layer is transparent: under what's there) and Clear (takes the layer
 * away by the gradient's opacity).
 */
export type GradientPaintMode = BlendMode | "behind" | "clear";

export interface GradientPaint {
  mode: GradientPaintMode;
  /** 0..1, the options bar's Opacity. */
  opacity: number;
  /** How the photo mixes (a layer's pixels are mixed as its layers are). */
  compositing: Compositing;
}

/** A mask's grey from a straight encoded colour: Rec. 601's luma on encoded values, as the brush's (`strokeColour`). */
export const maskGrey = (c: Rgba) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

const blendParams = (paint: GradientPaint, compositing: Compositing, at: { x: number; y: number }): BlendParams => ({
  mode: paint.mode === "behind" || paint.mode === "clear" ? "normal" : paint.mode,
  opacity: paint.opacity,
  fill: 1,
  channels: { r: true, g: true, b: true },
  blendIf: {},
  compositing,
  dissolveAt: { x: Math.floor(at.x), y: Math.floor(at.y), seed: 0 },
});

/**
 * A Classic gradient's colour (`gradientColourAt`) painted onto a layer's pixel (premultiplied linear), mixed as the
 * photo mixes its layers: the result, premultiplied linear. At (x, y) in the document (Dissolve's speckle).
 */
export function paintPixel(base: Rgba, colour: Rgba, paint: GradientPaint, x: number, y: number): Rgba {
  const a = colour[3];
  const layer: Rgba = [srgbToLinear(colour[0]) * a, srgbToLinear(colour[1]) * a, srgbToLinear(colour[2]) * a, a];
  if (paint.mode === "clear") {
    const k = 1 - a * paint.opacity;
    return [base[0] * k, base[1] * k, base[2] * k, base[3] * k];
  }
  // Behind: what's there over the gradient.
  if (paint.mode === "behind") return compositePixel([layer[0] * paint.opacity, layer[1] * paint.opacity, layer[2] * paint.opacity, a * paint.opacity], base, blendParams({ ...paint, opacity: 1 }, paint.compositing, { x, y }));
  return compositePixel(base, layer, blendParams(paint, paint.compositing, { x, y }));
}

/**
 * A Classic gradient painted onto a mask's value (coverage, 0..1): its grey (`maskGrey`), mixed by its opacity and
 * the mode on the mask's own values, as Photoshop paints a mask in greys. Behind changes nothing (a mask is opaque);
 * Clear goes towards black, hiding.
 */
export function paintMask(value: number, colour: Rgba, paint: GradientPaint, x: number, y: number): number {
  const a = colour[3];
  if (paint.mode === "behind") return value;
  if (paint.mode === "clear") return value * (1 - a * paint.opacity);
  const g = maskGrey(colour);
  return compositePixel([value, value, value, 1], [g * a, g * a, g * a, a], blendParams(paint, "linear", { x, y }))[0];
}
