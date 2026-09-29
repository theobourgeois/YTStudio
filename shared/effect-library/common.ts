/** Building blocks shared by the video effect library files. */
import type { EffectDefinition, EffectShader } from "../effects.ts";
import type { NumberSpec, ParamSpec } from "../params.ts";

/** A video effect: drawn on anything on a video track, added and removed by the user. */
export function videoEffect(def: { type: string; label: string; params: ParamSpec[] } & EffectShader): EffectDefinition {
  const { type, label, params, ...shader } = def;
  return { type, label, builtIn: false, appliesTo: (c) => c.visual, params, shader };
}

/** A fraction shown as a percentage, with a slider. */
export function percent(
  key: string,
  label: string,
  value: number,
  { min = 0, max = 1, decimals = 0 }: { min?: number; max?: number; decimals?: number } = {},
): NumberSpec {
  return { kind: "number", key, label, default: value, min, max, scale: 100, unit: "%", step: 1, decimals, slider: true };
}

/** An angle in degrees. */
export function degrees(key: string, label: string, value: number, min = -180, max = 180): NumberSpec {
  return { kind: "number", key, label, default: value, min, max, unit: "°", step: 1, decimals: 1, slider: max - min <= 360 };
}
