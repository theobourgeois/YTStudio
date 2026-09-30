/** Building blocks for preset definitions: keyframe shapes that edits use again and again. */
import type { Easing, ParamValue } from "../types.ts";
import type { PresetKey } from "../presets.ts";

export const key = (at: number, value: ParamValue, easing: Easing = "linear", influence?: number): PresetKey => ({
  at,
  value,
  easing,
  ...(influence !== undefined && { influence }),
});

/** How snappy a move is by default: it hangs near its ends and whips through the middle (After Effects' 85% influence). */
export const SNAP = 0.85;

/**
 * A move from `from` to `to` that starts slowly, is fastest at the cut (halfway) and
 * settles slowly: one continuous motion across both clips (a spin, a whip pan).
 */
export const across = (from: ParamValue, to: ParamValue, influence = SNAP): PresetKey[] => [
  key(0, from, "ease-out", influence),
  key(1, to, "ease-in", influence),
];

/**
 * A move that speeds up into the cut (`start` → `beforeCut`), jumps there and slows down
 * out of it (`afterCut` → `end`): the outgoing clip rushes away and the incoming one lands.
 */
export const throughCut = (start: ParamValue, beforeCut: ParamValue, afterCut: ParamValue, end: ParamValue, influence = SNAP): PresetKey[] => [
  key(0, start, "ease-out", influence),
  // A hair before the cut, so the frame before it has arrived and the cut's own frame has jumped.
  { at: 0.5, value: beforeCut, easing: "hold", nudge: -0.004 },
  key(0.5, afterCut, "linear"),
  key(1, end, "ease-in", influence),
];

/** An amount that builds to `peak` at the cut and falls away again (a flash, a blur, a glitch burst). */
export const spike = (peak: ParamValue, rest: ParamValue = 0, influence = 0.6): PresetKey[] => [
  key(0, rest, "ease-out", influence),
  key(0.5, peak, "linear"),
  key(1, rest, "ease-in", influence),
];

/** Motion settings for a moving adjustment layer: blurred, and the picture mirrored past its edges so no black shows. */
export const MOVING = { motionBlur: true, shutterAngle: 180, edges: "mirror" } as const;
