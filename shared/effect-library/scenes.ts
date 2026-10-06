/**
 * 3D scenes (docs/visualizer/scenes.md): raymarched worlds as effects, each a scene of `shared/scenes/`. Its
 * state (the camera, events the hits set off) is stepped in TypeScript and reaches its GLSL as uniforms
 * (`EffectShader.scene`); `SCENE_GLSL` gives every scene the camera's rays, noise and the tonemap, and puts
 * what it sees on the clip by its Blend Mode, like a generator.
 */
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, ParamSpec } from "../params.ts";
import type { SceneSpec } from "../scenes/index.ts";
import { SCENES } from "../scenes/list.ts";
import { BLEND_GLSL, blending, percent, videoEffect } from "./common.ts";

const HITS: ChoiceSpec = {
  kind: "choice",
  key: "hits",
  label: "Hits",
  default: "kicks",
  options: [
    { value: "any", label: "Any" },
    { value: "kicks", label: "Kicks" },
    { value: "snares", label: "Snares and notes" },
    { value: "hats", label: "Hats" },
  ],
};

/** What every scene has first: what it hears and how hard it reacts, and its pace. */
const HEARING: ParamSpec[] = [
  { kind: "source", key: "source", label: "Listens To", default: "master" },
  HITS,
  { kind: "number", key: "reactivity", label: "Reactivity", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  { kind: "number", key: "speed", label: "Speed", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
];

/**
 * Everything a scene's GLSL can use besides the effect prelude:
 *
 * - The camera (`cameraUniforms` in `shared/scenes/kit.ts`): `cameraRay(uv)` is the direction through `uv`, the
 *   lens set for the frame's shorter side; `camPos` where it is.
 * - The sound, followed and smoothed in TypeScript: `sLevel`, `sBass`, `sMid`, `sHigh`, `sPunch` (the low end's
 *   punch), `sBeat` (an impulse on each hit, falling over a quarter-second).
 * - `quality` (0.25..1): scale march budgets by it.
 * - Hashes and noise that don't fall apart far from the origin (no `sin` hashes): `hash12`, `hash13`, `hash22`,
 *   `hash33`, `vnoise2d` (value noise and its derivatives), `vnoise3`, `fbm3`.
 * - `scene(uv)` returns linear light; it's tonemapped (ACES), turned to sRGB and dithered here.
 */
const SCENE_GLSL = `${BLEND_GLSL}
uniform vec3 camPos;
uniform vec3 camFwd;
uniform vec3 camRight;
uniform vec3 camUp;
uniform float camLens;
uniform float sLevel;
uniform float sBass;
uniform float sMid;
uniform float sHigh;
uniform float sPunch;
uniform float sBeat;
vec3 cameraRay(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0 * vec2(ratio, 1.0) / min(ratio, 1.0);
  return normalize(camFwd + camLens * (p.x * camRight + p.y * camUp));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
// Value noise (0..1) and its derivatives (quintic, so the derivatives are smooth).
vec3 vnoise2d(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}
float vnoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p, int octaves) {
  float a = 0.0;
  float b = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    a += b * vnoise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    b *= 0.5;
  }
  return a;
}
// ACES (Narkowicz's fit), then sRGB.
vec3 tonemap(vec3 c) {
  c = max(c, 0.0);
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  return pow(c, vec3(1.0 / 2.2));
}
vec3 scene(vec2 uv);
vec4 effect(vec2 uv) {
  vec3 c = tonemap(scene(uv));
  // A step of dither, so dark gradients (skies, haze) don't band.
  c += (hash12(uv * resolution + fract(time) * 91.7) - 0.5) / 255.0;
  return blendGenerated(vec4(clamp(c, 0.0, 1.0), 1.0), getColor(uv), opacity);
}
`;

function sceneEffect(spec: SceneSpec): EffectDefinition {
  return videoEffect({
    type: spec.type,
    label: spec.label,
    tags: ["scene", "audio", "generate"],
    animated: true,
    params: [...HEARING, ...spec.params, percent("quality", "Quality", 1, { min: 0.25 }), ...blending("replace")],
    ...(spec.demo && { demo: spec.demo }),
    ...(spec.audio && { audio: { request: spec.audio } }),
    scene: spec.type,
    glsl: `${SCENE_GLSL}\n${spec.glsl}`,
  });
}

export const SCENE_EFFECTS: EffectDefinition[] = SCENES.map(sceneEffect);
