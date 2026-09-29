/** The rows `GlSession.effects` draws for a list of video effects (the sheet script and the shader test share them). */
import type { EffectPass } from "../shared/compositor.ts";
import { effectPass } from "../shared/effect-gl.ts";
import type { EffectDefinition } from "../shared/effects.ts";
import { defaultParams } from "../shared/params.ts";

/** Moments (source seconds) each effect is drawn at with its card's values, so moving ones show a few states. */
const MOMENTS = [0.37, 1.13, 2.05];

/** Per effect: its defaults, then its card's values at a few moments. */
export function effectRows(defs: readonly EffectDefinition[]): { label: string; passes: EffectPass[] }[] {
  return defs.map((def) => {
    const defaults = defaultParams(def.params);
    const demo = { ...defaults, ...def.shader?.demo };
    const passes = [effectPass(def, defaults, 0.5), ...MOMENTS.map((t) => effectPass(def, demo, t))];
    return { label: def.label, passes: passes.filter((p): p is EffectPass => !!p) };
  });
}
