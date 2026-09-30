/**
 * The rows `GlSession.layers` draws for presets (the sheet script and the shader test
 * share them): a transition's adjustment layer over the cut from sample scene "a" to
 * "b", or an effect preset on the plain sample picture, at moments across its length.
 */
import { IDENTITY, type Placed } from "../shared/compositor.ts";
import { canvasAffine, clipLayer } from "../shared/layers.ts";
import { type PresetDefinition, presetClip } from "../shared/presets.ts";
import type { DrawOp } from "./gl-browser.ts";

/** Fractions of a preset's length each row shows (either side of a transition's cut too). */
export const PRESET_MOMENTS = [0, 0.15, 0.3, 0.42, 0.49, 0.5, 0.58, 0.7, 0.85, 1];

export function presetRows(defs: readonly PresetDefinition[], cell: { width: number; height: number }) {
  const whole = (key: string): Placed => ({ key, affine: IDENTITY, opacity: 1 });
  return defs.map((def) => {
    const clip = presetClip(def);
    const affine = canvasAffine(clip, cell);
    const options = { canvas: cell, fps: 30, maxSamples: 24 };
    const frameAt = (f: number): DrawOp[] => {
      const t = Math.min(def.duration - 1e-4, f * def.duration);
      const layer = clipLayer(clip, t, affine, options);
      if (def.kind === "transition") {
        const below: DrawOp = { kind: "picture", picture: whole(f < 0.5 ? "a" : "b") };
        return layer ? [below, { kind: "adjustment", adjustment: layer }] : [below];
      }
      return layer ? [{ kind: "picture", picture: { ...layer, key: "plain" } }] : [];
    };
    const transition = def.kind === "transition";
    return {
      label: def.label,
      frames: PRESET_MOMENTS.map(frameAt),
      ...(transition && {
        first: [{ kind: "picture", picture: whole("a") }] as DrawOp[],
        last: [{ kind: "picture", picture: whole("b") }] as DrawOp[],
      }),
    };
  });
}
