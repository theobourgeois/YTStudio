/**
 * Camera Raw (docs/photo/camera-raw.md): Photoshop's Camera Raw Filter as one effect with sections, a filter on a
 * layer (⇧⌘A) or an adjustment layer. Pointwise but for what reads its analysis (the local sliders, Contrast, Glow).
 */
import type { EffectParamValue } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { isIdentityCurveSet } from "../curve-math.ts";
import type { CurveSet } from "../../types.ts";
import { CAMERA_RAW_PARAMS, CAMERA_RAW_SECTIONS, type CameraRawSection, GRADING_WHEELS, MIXER_COLOURS } from "./params.ts";
import { CAMERA_RAW_PRESETS } from "./presets.ts";

export { CAMERA_RAW_PARAMS, CAMERA_RAW_SECTIONS, type CameraRawSection, GRADING_WHEELS, type GradingWheel, MIXER_COLOURS, sectionParams } from "./params.ts";

/** Whether a parameter is at its default. */
const atDefault = (key: string, value: EffectParamValue | undefined) => {
  const spec = CAMERA_RAW_PARAMS.find((p) => p.key === key)!;
  if (spec.kind === "curves") return isIdentityCurveSet(value as CurveSet);
  // The vignette's shape and the grain's look change nothing while their amount is 0; the splits while the regions are.
  return value === undefined || value === spec.default;
};

/** The sections whose settings change the picture. */
export function changedSections(params: Record<string, EffectParamValue>): CameraRawSection[] {
  const live = (key: string) => !atDefault(key, params[key]);
  const shows: Record<CameraRawSection, boolean> = {
    light: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"].some(live),
    color: ["temperature", "tint", "vibrance", "saturation", "treatment"].some(live),
    effects: ["texture", "clarity", "dehaze", "vignette", "grain", "glow"].some(live),
    curve: ["curveHighlights", "curveLights", "curveDarks", "curveShadows", "pointCurve"].some(live),
    mixer: MIXER_COLOURS.some((c) => live(`hue${c}`) || live(`saturation${c}`) || live(`luminance${c}`)),
    grading: GRADING_WHEELS.some((w) => live(`${w}Saturation`) || live(`${w}Luminance`)),
  };
  return CAMERA_RAW_SECTIONS.map((s) => s.id).filter((id) => shows[id]);
}

export { ANALYSIS_PARAM, needsAnalysis } from "./develop.ts";
export { CAMERA_RAW_PRESETS } from "./presets.ts";

export const CAMERA_RAW: EffectDefinition = {
  type: "camera-raw",
  version: 1,
  kind: "filter",
  kinds: ["filter", "adjustment"],
  kernel: true,
  label: "Camera Raw",
  description:
    "Photoshop's Camera Raw Filter, one effect with sections, its sliders on Adobe's names and ranges (and measured to behave like Camera Raw 18.7's): Light (exposure in stops, contrast, highlights, shadows, whites, blacks), Color (temperature, tint, vibrance, saturation, treatment color or bw), Effects (texture, clarity, dehaze; glow with glowRange, glowSpread, glowWarmth and glowStyle diffusion, bloom or halation; vignette with midpoint, roundness, feather, highlights and style; grain with size and roughness), Curve (the parametric curve's highlights, lights, darks, shadows and its three splits; pointCurve, a set of point curves), Color Mixer (hue<Colour>, saturation<Colour>, luminance<Colour> for Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta), Color Grading (shadows, midtones, highlights and global: <wheel>Hue in degrees 0 red, 120 green, 240 blue; <wheel>Saturation 0–100; <wheel>Luminance; gradingBlending, gradingBalance). A filter on a layer, or a Camera Raw adjustment layer over everything below.",
  params: CAMERA_RAW_PARAMS,
  presets: CAMERA_RAW_PRESETS,
  region: "pointwise",
  reach: () => 0,
  isIdentity: (p) => changedSections(p).length === 0,
  commutesWithReduction: () => false,
  summary: (p) => {
    const changed = changedSections(p);
    return changed.length ? CAMERA_RAW_SECTIONS.filter((s) => changed.includes(s.id)).map((s) => s.label).join(", ") : "no change";
  },
};
