/**
 * Video effect shaders: the GLSL prelude every video effect is written
 * against, and turning a clip's effects into the passes the compositor
 * (`compositor.ts`) runs. The compositor draws the clip's own picture into a
 * layer of its size as shown (never bigger than the media), runs each enabled
 * effect over it in order, then places the result where Motion puts it, like
 * Premiere draws standard effects before Motion and Opacity.
 */
import type { EffectPass, Shader } from "./compositor.ts";
import { type EffectDefinition, effectDefinition, storedValuesAt } from "./effects.ts";
import type { ParamSpec } from "./params.ts";
import { GLSL_HELPERS, type UniformSpec, type UniformValue, paramUniforms, uniformDeclarations } from "./transition-gl.ts";
import type { Clip, ParamValues } from "./types.ts";

/**
 * Everything a video effect's GLSL can use:
 *
 * - `ratio` (the clip's frame width / height as shown), `resolution` (px of the
 *   picture being worked on: about its size on the output), `time` (the
 *   clip's source time in seconds, for effects that move), `pass` (which run
 *   of a multi-pass effect this is, from 0).
 * - `getColor(uv)`: the clip's picture (after the effects before this one),
 *   premultiplied RGBA; past the edges it repeats the edge pixels.
 *   `getColorOrClear(uv)` is transparent there instead. `uv` (0, 0) is bottom left.
 * - `unpremultiply(c)` (its straight RGB) and `withRgb(c, rgb)` (straight RGB
 *   back with `c`'s alpha, clamped), for colour maths.
 * - Helpers shared with transitions: `PI`, `ease`, `hash`/`hash2`, `noise`,
 *   `fbm`, `rot`, `luma`, `inside(uv)`, `toUv` (a point parameter to uv),
 *   `aspect(uv)` (uv around the centre in square units), `mirrored(uv)`.
 *
 * The result must be premultiplied (rgb never above alpha); it's clamped.
 * Distances are best given as fractions of the frame's height, so an effect
 * looks the same in the preview and the (bigger) export.
 */
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform float ratio;
uniform vec2 resolution;
uniform float time;
uniform int pass;
${GLSL_HELPERS}
vec4 getColor(vec2 uv) { return texture(uSrc, uv); }
vec4 getColorOrClear(vec2 uv) { return inside(uv) ? texture(uSrc, uv) : vec4(0.0); }
vec3 unpremultiply(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
vec4 withRgb(vec4 c, vec3 rgb) { return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a); }
`;

const MAIN = `
void main() {
  vec4 c = clamp(effect(vUv), 0.0, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  fragColor = c;
}
`;

/** Names the prelude uses, which parameters can't have. */
export const RESERVED_EFFECT_UNIFORMS = ["uSrc", "ratio", "resolution", "time", "pass", "vUv", "fragColor"];

const isUniformSpec = (spec: ParamSpec): spec is UniformSpec =>
  spec.kind === "number" || spec.kind === "boolean" || spec.kind === "choice" || spec.kind === "vec2" || spec.kind === "color";

/** The complete fragment shader of a video effect. */
export function effectFragmentSource(def: { params: readonly ParamSpec[]; glsl: string }): string {
  return `${PRELUDE}\n${uniformDeclarations(def.params.filter(isUniformSpec))}\n${def.glsl}\n${MAIN}`;
}

const shaders = new Map<string, Shader>();

/** A video effect's shader, built once (null for effects that aren't drawn by a shader). */
export function effectShader(def: EffectDefinition): Shader | null {
  if (!def.shader) return null;
  let shader = shaders.get(def.type);
  if (!shader) {
    // Keyed apart from transitions, which share the compositor's program cache.
    shader = { key: `fx:${def.type}`, source: effectFragmentSource({ params: def.params, glsl: def.shader.glsl }) };
    shaders.set(def.type, shader);
  }
  return shader;
}

/** A video effect's values (and the time) as uniforms. */
export function effectUniforms(def: EffectDefinition, values: ParamValues, time: number): UniformValue[] {
  return [...paramUniforms(def.params.filter(isUniformSpec), values), { name: "time", type: "float", value: time }];
}

/** The pass of one effect with these values, at source time `time`. */
export function effectPass(def: EffectDefinition, values: ParamValues, time: number): EffectPass | null {
  const shader = effectShader(def);
  return shader && { shader, uniforms: effectUniforms(def, values, time), passes: def.shader?.passes ?? 1 };
}

/** What a clip's enabled video effects draw at source time `time`, in order. */
export function effectPasses(clip: Clip, time: number): EffectPass[] {
  const passes: EffectPass[] = [];
  for (const effect of clip.effects) {
    const def = effect.enabled ? effectDefinition(effect.type) : undefined;
    const pass = def?.shader ? effectPass(def, storedValuesAt(def, effect, time), time) : null;
    if (pass) passes.push(pass);
  }
  return passes;
}
