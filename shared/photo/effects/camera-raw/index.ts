/**
 * Camera Raw (docs/photo/camera-raw.md): Photoshop's Camera Raw Filter as one effect with sections, a filter on a
 * layer (⇧⌘A) or an adjustment layer. Pointwise so far (CR1): its local sections come with CR2.
 */
import type { EffectParamValue } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { isIdentityCurveSet } from "../curve-math.ts";
import type { CurveSet } from "../../types.ts";
import { CAMERA_RAW_PARAMS, CAMERA_RAW_SECTIONS, type CameraRawSection } from "./params.ts";

export { CAMERA_RAW_PARAMS, CAMERA_RAW_SECTIONS, type CameraRawSection, sectionParams } from "./params.ts";

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
    effects: ["texture", "clarity", "dehaze", "vignette", "grain"].some(live),
    curve: ["curveHighlights", "curveLights", "curveDarks", "curveShadows", "pointCurve"].some(live),
  };
  return CAMERA_RAW_SECTIONS.map((s) => s.id).filter((id) => shows[id]);
}

export { ANALYSIS_PARAM, needsAnalysis } from "./develop.ts";

export const CAMERA_RAW: EffectDefinition = {
  type: "camera-raw",
  version: 1,
  kind: "filter",
  kinds: ["filter", "adjustment"],
  kernel: true,
  label: "Camera Raw",
  description:
    "Photoshop's Camera Raw Filter, one effect with sections, its sliders on Adobe's names and ranges (and measured to behave like Camera Raw 18.7's): Light (exposure in stops, contrast, highlights, shadows, whites, blacks), Color (temperature, tint, vibrance, saturation, treatment color or bw), Effects (texture, clarity, dehaze, vignette with midpoint, roundness, feather, highlights and style; grain with size and roughness), Curve (the parametric curve's highlights, lights, darks, shadows and its three splits; pointCurve, a set of point curves). A filter on a layer, or a Camera Raw adjustment layer over everything below.",
  params: CAMERA_RAW_PARAMS,
  region: "pointwise",
  reach: () => 0,
  isIdentity: (p) => changedSections(p).length === 0,
  commutesWithReduction: () => false,
  summary: (p) => {
    const changed = changedSections(p);
    return changed.length ? CAMERA_RAW_SECTIONS.filter((s) => changed.includes(s.id)).map((s) => s.label).join(", ") : "no change";
  },
};
