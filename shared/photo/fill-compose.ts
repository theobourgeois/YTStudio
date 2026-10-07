/**
 * What the Paint Bucket and the Magic Eraser do to the pixels they reach (docs/photo/tools/paint-bucket.md,
 * magic-eraser.md), a tile at a time: a pixel layer's tile is premultiplied linear RGBA, a mask's one value a pixel;
 * `cover` is how much each pixel is reached (the flood's coverage times the selection's), or one number for all.
 * A fill goes through its mode as a layer would (the blend reference's `compositePixel`, held to Photoshop's own
 * renders), plus the painting modes Behind and Clear; erasing takes coverage away and, with Defringe, unmixes what's
 * left from the colour clicked. Each works in place and says whether anything changed. Pure.
 */
import { BLEND_MODES } from "./blending.ts";
import { linearToSrgb, srgbToLinear } from "./colour.ts";
import { type Rgb, type Rgba, blendColour, compositePixel } from "./reference/blend.ts";
import type { BlendMode, Compositing } from "./types.ts";

/** A painting tool's modes: the layer modes, and Behind and Clear (Photoshop's, after Dissolve). */
export type FillMode = BlendMode | "behind" | "clear";

export interface FillModeInfo {
  id: FillMode;
  label: string;
  /** The menu's group (separated by lines). */
  group: number;
}

/** The Paint Bucket's Mode menu, in Photoshop's order. */
export const FILL_MODES: readonly FillModeInfo[] = [
  ...BLEND_MODES.slice(0, 2),
  { id: "behind", label: "Behind", group: 0 },
  { id: "clear", label: "Clear", group: 0 },
  ...BLEND_MODES.slice(2),
];

export const isFillMode = (v: unknown): v is FillMode => FILL_MODES.some((m) => m.id === v);

export interface FillParams {
  mode: FillMode;
  /** 0..1. */
  opacity: number;
  /** How the document mixes (a "photoshop" one blends encoded values). */
  compositing: Compositing;
  /** Dissolve's speckle (the layer's `blendSeed`). */
  seed: number;
}

/** What's filled at a pixel of the tile (premultiplied linear RGBA): one colour, or a pattern by pixel. */
export type FillSource = Rgba | ((x: number, y: number) => Rgba);

const NO_CHANNELS_OFF = { r: true, g: true, b: true };

/**
 * Fills a pixel tile (`width × height`, its top-left pixel at `origin` of the surface) with `source` where `cover`
 * says, through the mode, at Opacity. In place; true when something changed.
 */
export function fillPixels(tile: Float32Array, width: number, height: number, origin: { x: number; y: number }, cover: Float32Array | number, source: FillSource, p: FillParams): boolean {
  const opacity = Math.max(0, Math.min(1, p.opacity));
  if (opacity <= 0) return false;
  const constant = typeof source === "function" ? null : source;
  const params = { mode: p.mode === "behind" || p.mode === "clear" ? "normal" : p.mode, opacity, fill: 1, channels: NO_CHANNELS_OFF, blendIf: {}, compositing: p.compositing } as const;
  let changed = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = typeof cover === "number" ? cover : cover[y * width + x];
      if (k <= 0) continue;
      const i = (y * width + x) * 4;
      const base: Rgba = [tile[i], tile[i + 1], tile[i + 2], tile[i + 3]];
      let out: Rgba;
      if (p.mode === "clear") {
        const keep = 1 - k * opacity;
        out = [base[0] * keep, base[1] * keep, base[2] * keep, base[3] * keep];
      } else {
        const s = constant ?? (source as (x: number, y: number) => Rgba)(origin.x + x, origin.y + y);
        const layer: Rgba = [s[0] * k, s[1] * k, s[2] * k, s[3] * k];
        if (p.mode === "normal" && k * opacity >= 1 && s[3] >= 1) out = s;
        else if (p.mode === "behind") {
          // What's there over the paint: the paint shows only where the layer is transparent.
          out = compositePixel([layer[0] * opacity, layer[1] * opacity, layer[2] * opacity, layer[3] * opacity], base, { ...params, opacity: 1 });
        } else out = compositePixel(base, layer, { ...params, dissolveAt: { x: origin.x + x, y: origin.y + y, seed: p.seed } });
      }
      for (let c = 0; c < 4; c++) {
        if (tile[i + c] !== out[c]) changed = true;
        tile[i + c] = out[c];
      }
    }
  }
  return changed;
}

/**
 * Fills a mask tile (one value a pixel: 1 shows, 0 hides) with a grey (`value`, or a pattern's by pixel) where
 * `cover` says: the mode acts on the grey (a mask has no transparency, so Behind, Clear and Dissolve are Normal).
 */
export function fillMask(tile: Float32Array, width: number, height: number, origin: { x: number; y: number }, cover: Float32Array | number, value: number | ((x: number, y: number) => number), mode: FillMode, opacity: number): boolean {
  const o = Math.max(0, Math.min(1, opacity));
  if (o <= 0) return false;
  const plain = mode === "normal" || mode === "dissolve" || mode === "behind" || mode === "clear";
  let changed = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = (typeof cover === "number" ? cover : cover[y * width + x]) * o;
      if (k <= 0) continue;
      const i = y * width + x;
      const m = tile[i];
      const g = typeof value === "number" ? value : value(origin.x + x, origin.y + y);
      const target = plain ? g : blendColour(mode as BlendMode, [m, m, m], [g, g, g])[0];
      const next = m + (target - m) * Math.min(1, k);
      if (next !== m) {
        tile[i] = next;
        changed = true;
      }
    }
  }
  return changed;
}

const encode = (v: number) => linearToSrgb(Math.max(0, Math.min(1, v)));

/**
 * Erases a pixel tile where `cover` says, by Opacity: each pixel keeps 1 − coverage of its alpha. With `matte` (the
 * colour clicked, straight sRGB 0..1: Defringe), what's left of a partly erased pixel is unmixed from it, as if the
 * share erased had been the matte over the subject's own colour (Photoshop's Remove White Matte, for any colour):
 * no rim of the old background is left.
 */
export function erasePixels(tile: Float32Array, width: number, height: number, cover: Float32Array | number, opacity: number, matte: Rgb | null): boolean {
  const o = Math.max(0, Math.min(1, opacity));
  let changed = false;
  for (let i = 0; i < width * height; i++) {
    const e = Math.min(1, (typeof cover === "number" ? cover : cover[i]) * o);
    const p = i * 4;
    const a = tile[p + 3];
    if (e <= 0 || a <= 0) continue;
    const keep = 1 - e;
    changed = true;
    if (!matte || keep <= 0) {
      for (let c = 0; c < 4; c++) tile[p + c] *= keep;
      continue;
    }
    const left = a * keep;
    for (let c = 0; c < 3; c++) {
      const straight = encode(tile[p + c] / a);
      const own = Math.max(0, Math.min(1, (straight - e * matte[c]) / keep));
      tile[p + c] = srgbToLinear(own) * left;
    }
    tile[p + 3] = left;
  }
  return changed;
}

/** Erases a mask tile: what's reached is hidden, by coverage × Opacity. */
export function eraseMask(tile: Float32Array, width: number, height: number, cover: Float32Array | number, opacity: number): boolean {
  const o = Math.max(0, Math.min(1, opacity));
  let changed = false;
  for (let i = 0; i < width * height; i++) {
    const e = Math.min(1, (typeof cover === "number" ? cover : cover[i]) * o);
    if (e <= 0 || tile[i] <= 0) continue;
    tile[i] *= 1 - e;
    changed = true;
  }
  return changed;
}
