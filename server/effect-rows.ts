/** The rows `GlSession.effects` draws for a list of video effects (the sheet script and the shader test share them). */
import { type Affine, type EffectPass, IDENTITY } from "../shared/compositor.ts";
import { effectPass } from "../shared/effect-gl.ts";
import type { EffectDefinition } from "../shared/effects.ts";
import { defaultParams } from "../shared/params.ts";
import type { DrawOp, LayersJob } from "./gl-browser.ts";

/** Moments (source seconds) each effect is drawn at with its card's values, so moving ones show a few states. */
const MOMENTS = [0.37, 1.13, 2.05];

/** Per effect: its defaults, then its card's values at a few moments. Time effects need `timeEffectRows`. */
export function effectRows(defs: readonly EffectDefinition[]): { label: string; passes: EffectPass[] }[] {
  return defs
    .filter((def) => !def.shader?.history)
    .map((def) => {
      const defaults = defaultParams(def.params);
      const demo = { ...defaults, ...def.shader?.demo };
      const passes = [effectPass(def, defaults, 0.5), ...MOMENTS.map((t) => effectPass(def, demo, t))];
      return { label: def.label, passes: passes.filter((p): p is EffectPass => !!p) };
    });
}

/** Frames a time effect's row plays, at 30 fps. */
const TIME_FRAMES = 12;

/**
 * Rows for time effects (`EffectShader.history`), which need earlier frames of a moving
 * picture: sample scene "a" sliding across, frame after frame, under an adjustment layer
 * with the effect (at its card's values). Each row's last frame is compared with the same
 * frame without the effect.
 */
export function timeEffectRows(defs: readonly EffectDefinition[]): LayersJob["rows"] {
  return defs
    .filter((def) => def.shader?.history)
    .map((def) => {
      const values = { ...defaultParams(def.params), ...def.shader?.demo };
      const picture = (f: number): DrawOp => {
        const shift = (f / TIME_FRAMES) * 0.5 - 0.25;
        return { kind: "picture", picture: { key: "a", affine: [1, 0, 0, 1, shift, 0] as Affine, opacity: 1 } };
      };
      const frames = Array.from({ length: TIME_FRAMES }, (_, f): DrawOp[] => {
        const pass = effectPass(def, values, f / 30, 30, `sheet/${def.type}`);
        return [picture(f), { kind: "adjustment", adjustment: { affine: IDENTITY, opacity: 1, effects: pass ? [pass] : [] } }];
      });
      return { label: def.label, frames, last: [picture(TIME_FRAMES - 1)] };
    });
}
