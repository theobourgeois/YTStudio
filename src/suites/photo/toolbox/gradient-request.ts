/**
 * The assistant's `paint_gradient` (docs/photo/tools/gradient.md, "The assistant"), checked against the photo, pure so
 * it's tested: which layer's pixels or mask, the gradient's shape, and how it's painted. `gradient-actions.ts` paints it.
 */
import { BLEND_MODES, compositingOf } from "@shared/photo/blending";
import { GRADIENT_TYPES, type GradientFillShape, gradientInput } from "@shared/photo/effects/gradient";
import type { GradientPaint, GradientPaintMode } from "@shared/photo/reference/gradient";
import type { DocPoint, Gradient, PhotoProject } from "@shared/photo/types";
import type { Colours } from "../colours";
import type { SurfacePart } from "../paint-target";
import { findLayerRef } from "../tool-edits";
import { type SwatchPreset, swatchGradient } from "./gradient-options";

/** What `paint_gradient` asks for, checked against the photo: where it paints, the gradient's shape and its paint. */
export interface GradientPaintRequest {
  layerId: string;
  name: string;
  part: SurfacePart;
  shape: GradientFillShape;
  paint: GradientPaint;
}

const point = (v: unknown, name: string): DocPoint => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error(`${name} must be [x, y] in canvas pixels; got ${JSON.stringify(v)}.`);
  return [v[0], v[1]];
};

const METHODS: readonly Gradient["method"][] = ["perceptual", "linear", "classic", "smooth", "stripes"];
const PAINT_MODES: readonly GradientPaintMode[] = [...BLEND_MODES.map((m) => m.id), "behind", "clear"];

/** `paint_gradient`'s input checked against `doc`: what to paint where, or a message saying what's wrong. */
export function gradientPaintRequest(doc: PhotoProject, input: Record<string, unknown>, colours: Colours): GradientPaintRequest {
  const layer = findLayerRef(doc, input.layer);
  if (input.target !== undefined && input.target !== "mask" && input.target !== "content") throw new Error('target must be "content" or "mask".');
  const part: SurfacePart = input.target === "mask" ? "mask" : "content";
  if (!layer.visible) throw new Error(`"${layer.name}" is hidden: show it first (set_layer).`);
  if (part === "mask" && !layer.mask) throw new Error(`"${layer.name}" has no mask: add one with add_mask, then paint the gradient on it.`);
  if (part === "content" && layer.kind !== "pixel")
    throw new Error(
      layer.kind === "image"
        ? `"${layer.name}" is a placed image, kept whole: paint its mask (target: mask), or a pixel layer above it (add_pixel_layer).`
        : layer.kind === "adjustment"
          ? `"${layer.name}" is an adjustment layer, with no pixels: paint its mask (target: mask).`
          : `"${layer.name}" is a generator layer: change it with set_effect_params, or paint its mask (target: mask).`,
    );
  const style = input.style ?? "linear";
  if (!(GRADIENT_TYPES as readonly unknown[]).includes(style)) throw new Error(`style must be one of ${GRADIENT_TYPES.join(", ")}.`);
  let gradient: Gradient;
  if (input.gradient === undefined || input.gradient === "foreground-background" || input.gradient === "foreground-transparent") gradient = swatchGradient((input.gradient ?? "foreground-background") as SwatchPreset, colours);
  else gradient = gradientInput(input.gradient);
  if (input.method !== undefined) {
    if (!METHODS.includes(input.method as Gradient["method"])) throw new Error(`method must be one of ${METHODS.join(", ")}.`);
    gradient = { ...gradient, method: input.method as Gradient["method"] };
  } else if (typeof input.gradient !== "object") gradient = { ...gradient, method: "perceptual" };
  if (input.transparency === false)
    gradient = {
      ...gradient,
      opacities: [
        { at: 0, opacity: 1 },
        { at: 1, opacity: 1 },
      ],
    };
  const mode = (input.mode ?? "normal") as GradientPaintMode;
  if (!PAINT_MODES.includes(mode)) throw new Error(`mode must be a blend mode (${BLEND_MODES.map((m) => m.id).join(", ")}), behind or clear.`);
  const opacity = input.opacity ?? 100;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 100) throw new Error("opacity must be a number from 0 to 100.");
  return {
    layerId: layer.id,
    name: layer.name,
    part,
    shape: { style: style as GradientFillShape["style"], start: point(input.start, "start"), end: point(input.end, "end"), gradient, reverse: input.reverse === true, dither: input.dither !== false },
    paint: { mode, opacity: opacity / 100, compositing: compositingOf(doc) },
  };
}
