/** Building blocks shared by the video effect library files. */
import type { EffectDefinition, EffectShader } from "../effects.ts";
import type { ChoiceSpec, NumberSpec, ParamSpec, Vec2Spec } from "../params.ts";

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

/** How a generator's picture meets the clip's (AE's Blending Mode), in the order of `blendGenerated`'s indices. */
const BLEND_OPTIONS = [
  { value: "replace", label: "Replace" },
  { value: "over", label: "Over" },
  { value: "screen", label: "Screen" },
  { value: "add", label: "Add" },
  { value: "multiply", label: "Multiply" },
  { value: "overlay", label: "Overlay" },
  { value: "stencil", label: "Stencil Alpha" },
];

export const blendMode = (fallback: string): ChoiceSpec => ({
  kind: "choice",
  key: "blendMode",
  label: "Blend Mode",
  default: fallback,
  options: BLEND_OPTIONS,
});

/** Blend Mode and Opacity, last in every generator. */
export const blending = (fallback: string): ParamSpec[] => [blendMode(fallback), percent("opacity", "Opacity", 1)];

/** A point on the clip's frame. */
export const point = (key: string, label: string, value: [number, number]): Vec2Spec => ({
  kind: "vec2",
  key,
  label,
  default: value,
  space: "media",
  min: -10,
  max: 10,
  step: 1,
  decimals: 1,
});

/**
 * Puts a generated picture `g` (premultiplied) on the clip's `base` by `blendMode`,
 * at `amount`: Replace is `g` alone (on a transparent solid, just the pattern),
 * Stencil Alpha is `g` cut to the clip's alpha (fills a text), and the others are
 * the W3C separable blend modes, so they also work over transparent parts.
 */
export const BLEND_GLSL = `
vec3 blendChannels(int m, vec3 b, vec3 s) {
  if (m == 2) return b + s - b * s;
  if (m == 3) return min(b + s, 1.0);
  if (m == 4) return b * s;
  if (m == 5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  return s;
}
vec4 blendGenerated(vec4 g, vec4 base, float amount) {
  g *= clamp(amount, 0.0, 1.0);
  if (blendMode == 0) return g;
  if (blendMode == 6) return g * base.a;
  vec3 cs = g.a > 0.0 ? g.rgb / g.a : vec3(0.0);
  vec3 mixed = blendChannels(blendMode, unpremultiply(base), cs);
  return vec4(g.rgb * (1.0 - base.a) + base.rgb * (1.0 - g.a) + g.a * base.a * mixed, g.a + base.a * (1.0 - g.a));
}
/** A point parameter in square units around the frame's centre, like aspect(uv). */
vec2 pointAt(vec2 p) { return (toUv(p) - 0.5) * vec2(ratio, 1.0); }
`;
