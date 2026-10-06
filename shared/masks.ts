/**
 * Masks on clips (the Mask effect, `effect-library/mask.ts`): what the compositor draws
 * for them at a moment, and the edits that add one. A mask's path is in fractions of the
 * clip's own frame; its feather and expansion are px of that frame as if it were 1080 px
 * high, so they scale with the clip.
 */
import { type MaskShape, maskModeIndex } from "./compositor.ts";
import { MASK, addEffect, effectValuesAt, isComputed, maskEffects } from "./effects.ts";
import { type BezierPath, ellipsePath, rectPath, toSvgPathData } from "./path.ts";
import type { Clip, ParamValues, Project } from "./types.ts";

/** The frame height mask feather and expansion are given for. */
export const MASK_REFERENCE_HEIGHT = 1080;

/** A clip's enabled masks at source time `time`, as the compositor draws them (in order). */
export function masksAt(clip: Pick<Clip, "id" | "effects">, time: number): MaskShape[] {
  const out: MaskShape[] = [];
  for (const effect of maskEffects(clip)) {
    if (!effect.enabled) continue;
    const v = effectValuesAt(MASK, effect, time, clip);
    const path = v.path as BezierPath;
    // A line has no inside.
    if (path.vertices.length < 3 && !path.vertices.some((p) => p.in[0] || p.in[1] || p.out[0] || p.out[1])) continue;
    out.push({
      d: toSvgPathData({ ...path, closed: true }),
      mode: maskModeIndex(v.mode as string),
      ...(v.inverted === true && { inverted: true }),
      opacity: v.opacity as number,
      feather: (v.feather as number) / MASK_REFERENCE_HEIGHT,
      expansion: (v.expansion as number) / MASK_REFERENCE_HEIGHT,
    });
  }
  return out;
}

/** Whether a clip's masks draw differently at source times `a` and `b` (any of them is animated between the two). */
export function masksChange(clip: Pick<Clip, "id" | "effects">, a: number, b: number): boolean {
  if (a === b) return false;
  return maskEffects(clip).some(
    (e) => e.enabled && (!!e.keyframes || isComputed(e)) && JSON.stringify(effectValuesAt(MASK, e, a, clip)) !== JSON.stringify(effectValuesAt(MASK, e, b, clip)),
  );
}

/** The shapes a new mask can start as (the pen tool draws any other). */
export type MaskPreset = "rectangle" | "ellipse";

export function maskPresetPath(preset: MaskPreset): BezierPath {
  return preset === "ellipse" ? ellipsePath(0.5, 0.5, 0.4, 0.4) : rectPath(0.1, 0.1, 0.8, 0.8);
}

/** Add a mask to a clip (with `params` over the defaults). Returns its effect id, or null when the clip can't have one. */
export function addMask(project: Project, clipId: string, params?: ParamValues): { project: Project; effectId: string | null } {
  const { project: next, added } = addEffect(project, [clipId], MASK.type, params);
  return { project: next, effectId: added.get(clipId) ?? null };
}
