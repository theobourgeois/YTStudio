/**
 * Transition shaders: the GLSL prelude every transition is written against,
 * and turning a transition's definition and values into a shader and its
 * uniforms. The compositor (`compositor.ts`) runs them: it draws each side's
 * picture (the outgoing and incoming clip) where its Motion puts it into a
 * canvas-sized layer, faded by its Opacity, with premultiplied alpha
 * (uncovered canvas stays transparent), then mixes the two layers with the
 * transition's shader.
 */
import type { Shader } from "./compositor.ts";
import type { ParamValue, Vec2 } from "./types.ts";
import type { TransitionDefinition } from "./transitions.ts";

/**
 * Everything a transition's GLSL can use:
 *
 * - `progress` (0..1), `ratio` (canvas width / height), `resolution` (px).
 * - `getFromColor(uv)` / `getToColor(uv)`: the outgoing / incoming picture,
 *   premultiplied RGBA, transparent outside 0..1. `uv` (0, 0) is bottom left.
 * - Helpers: `PI`, `ease` (smooth in and out) plus `easeIn`/`easeOut`,
 *   `hash`/`hash2` (random 0..1), `noise` (smooth value noise), `fbm`
 *   (layered noise), `rot` (2D rotation), `luma`, `inside(uv)`,
 *   `dirVec(direction)` (0 left, 1 right, 2 up, 3 down), `toUv` (a point
 *   parameter to uv), `aspect(uv)` (uv around the centre in square units),
 *   `mirrored(uv)` (repeats the picture as reflections past its edges).
 *
 * The result must be premultiplied (rgb never above alpha); it's clamped.
 */
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform bool uStraight;
uniform float progress;
uniform float ratio;
uniform vec2 resolution;

#define PI 3.141592653589793

bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
vec4 getFromColor(vec2 uv) { return inside(uv) ? texture(uFrom, uv) : vec4(0.0); }
vec4 getToColor(vec2 uv) { return inside(uv) ? texture(uTo, uv) : vec4(0.0); }

float ease(float t) { t = clamp(t, 0.0, 1.0); return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
float easeIn(float t) { t = clamp(t, 0.0, 1.0); return t * t * t; }
float easeOut(float t) { t = clamp(t, 0.0, 1.0); return 1.0 - pow(1.0 - t, 3.0); }

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, s, -s, c); }
float luma(vec4 c) { return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); }
vec2 dirVec(int d) { return d == 0 ? vec2(-1.0, 0.0) : d == 1 ? vec2(1.0, 0.0) : d == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0); }
vec2 toUv(vec2 p) { return vec2(p.x, 1.0 - p.y); }
vec2 aspect(vec2 uv) { return (uv - 0.5) * vec2(ratio, 1.0); }
vec2 mirrored(vec2 p) { return 1.0 - abs(1.0 - mod(p, 2.0)); }
`;

const MAIN = `
void main() {
  vec4 c = clamp(transition(vUv), 0.0, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  if (uStraight) c.rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  fragColor = c;
}
`;

/** Names the prelude uses, which parameters can't have. */
export const RESERVED_UNIFORMS = ["progress", "ratio", "resolution", "uFrom", "uTo", "uStraight", "vUv", "fragColor"];

/** The complete fragment shader of a transition. */
export function fragmentSource(def: Pick<TransitionDefinition, "params" | "glsl">): string {
  const uniforms = def.params
    .map((p) => `uniform ${p.kind === "choice" ? "int" : p.kind === "vec2" ? "vec2" : "float"} ${p.key};`)
    .join("\n");
  return `${PRELUDE}\n${uniforms}\n${def.glsl}\n${MAIN}`;
}

const shaders = new Map<string, Shader>();

/** A transition's shader, built once. */
export function transitionShader(def: TransitionDefinition): Shader {
  let shader = shaders.get(def.type);
  if (!shader) {
    shader = { key: def.type, source: fragmentSource(def) };
    shaders.set(def.type, shader);
  }
  return shader;
}

export interface UniformValue {
  name: string;
  type: "float" | "int" | "vec2";
  value: number | Vec2;
}

/** A transition's parameter values as uniforms (see `TransitionDefinition.params`). */
export function transitionUniforms(def: TransitionDefinition, params: Record<string, ParamValue>): UniformValue[] {
  return def.params.map((spec) => {
    const v = params[spec.key] ?? spec.default;
    switch (spec.kind) {
      case "number":
        return { name: spec.key, type: "float", value: v as number };
      case "boolean":
        return { name: spec.key, type: "float", value: v ? 1 : 0 };
      case "choice":
        return { name: spec.key, type: "int", value: Math.max(0, spec.options.findIndex((o) => o.value === v)) };
      case "vec2":
        return { name: spec.key, type: "vec2", value: v as Vec2 };
    }
  });
}
