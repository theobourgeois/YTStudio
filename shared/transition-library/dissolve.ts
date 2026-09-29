/** Fades and dissolves: the everyday transitions (Premiere's "Dissolve" folder). */
import type { TransitionDefinition } from "../transitions.ts";

export const DISSOLVES: TransitionDefinition[] = [
  {
    type: "cross-dissolve",
    label: "Cross Dissolve",
    tags: ["dissolve"],
    duration: 0.5,
    params: [],
    glsl: `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`,
  },
  {
    type: "dip-to-black",
    label: "Dip to Black",
    tags: ["dissolve"],
    duration: 0.8,
    params: [
      { kind: "number", key: "hold", label: "Hold", default: 0, min: 0, max: 0.8, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
  // Out to black, stay there for "hold" of the time, then in from black.
  float half_ = (1.0 - hold) * 0.5;
  if (progress < half_) return mix(getFromColor(uv), black, smoothstep(0.0, 1.0, progress / half_));
  if (progress > 1.0 - half_) return mix(black, getToColor(uv), smoothstep(0.0, 1.0, (progress - 1.0 + half_) / half_));
  return black;
}`,
  },
  {
    type: "dip-to-white",
    label: "Dip to White",
    tags: ["dissolve", "light"],
    duration: 0.8,
    params: [],
    glsl: `
// Overexpose towards white rather than just fading, like a camera blowing out.
vec4 blowOut(vec4 c, float k) {
  vec4 bright = vec4(min(c.rgb * (1.0 + 2.5 * k) + 0.15 * k * c.a, vec3(c.a)), c.a);
  return mix(bright, vec4(1.0), smoothstep(0.25, 1.0, k));
}
vec4 transition(vec2 uv) {
  float k = 1.0 - abs(progress * 2.0 - 1.0);
  return progress < 0.5 ? blowOut(getFromColor(uv), k) : blowOut(getToColor(uv), k);
}`,
  },
  {
    type: "additive-dissolve",
    label: "Additive Dissolve",
    tags: ["dissolve", "light"],
    duration: 0.6,
    params: [],
    glsl: `
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv) * min(1.0, 2.0 * (1.0 - progress));
  vec4 b = getToColor(uv) * min(1.0, 2.0 * progress);
  return a + b;
}`,
  },
  {
    type: "film-dissolve",
    label: "Film Dissolve",
    tags: ["dissolve"],
    duration: 0.6,
    params: [],
    glsl: `
// Mixed in linear light, the way film stock blends: brighter and more natural midway.
vec4 transition(vec2 uv) {
  vec4 a = getFromColor(uv);
  vec4 b = getToColor(uv);
  vec3 lin = mix(pow(a.rgb, vec3(2.2)), pow(b.rgb, vec3(2.2)), progress);
  return vec4(pow(lin, vec3(1.0 / 2.2)), mix(a.a, b.a, progress));
}`,
  },
  {
    type: "luma-dissolve",
    label: "Luma Dissolve",
    tags: ["dissolve", "stylize"],
    duration: 1,
    params: [
      { kind: "number", key: "softness", label: "Softness", default: 0.2, min: 0.01, max: 1, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
      { kind: "boolean", key: "invert", label: "Darks First", default: false },
    ],
    glsl: `
// The incoming clip appears through its brightest parts first (or its darkest).
vec4 transition(vec2 uv) {
  vec4 b = getToColor(uv);
  float l = b.a > 0.0 ? luma(b) / b.a : 0.0;
  if (invert > 0.5) l = 1.0 - l;
  float edge = progress * (1.0 + softness) - softness;
  float t = smoothstep(1.0 - edge - softness, 1.0 - edge, l);
  return mix(getFromColor(uv), b, t);
}`,
  },
  {
    type: "noise-dissolve",
    label: "Noise Dissolve",
    tags: ["dissolve", "stylize"],
    duration: 0.8,
    params: [
      { kind: "number", key: "grain", label: "Scale", default: 6, min: 1, max: 60, step: 0.1, decimals: 1 },
      { kind: "number", key: "softness", label: "Softness", default: 0.1, min: 0, max: 0.5, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    ],
    glsl: `
vec4 transition(vec2 uv) {
  float n = clamp((fbm(aspect(uv) * grain) - 0.15) / 0.7, 0.0, 1.0);
  float p = progress * (1.0 + 2.0 * softness) - softness;
  float t = softness > 0.0 ? smoothstep(n - softness, n + softness, p) : step(n, p);
  return mix(getFromColor(uv), getToColor(uv), t);
}`,
  },
  {
    type: "blur-dissolve",
    label: "Blur Dissolve",
    tags: ["dissolve", "blur"],
    duration: 0.8,
    params: [
      { kind: "number", key: "amount", label: "Blur", default: 1, min: 0, max: 3, scale: 100, unit: "%", step: 1, decimals: 0 },
    ],
    glsl: `
// Blur out of the first clip, cross over while it's soft, and sharpen into the second.
vec4 blurred(vec2 uv, float radius, bool incoming) {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float f = float(i);
    float r = sqrt((f + 0.5) / 32.0) * radius;
    vec2 o = vec2(cos(f * 2.39996), sin(f * 2.39996)) * r * vec2(1.0 / ratio, 1.0);
    sum += incoming ? getToColor(uv + o) : getFromColor(uv + o);
    total += 1.0;
  }
  return sum / total;
}
vec4 transition(vec2 uv) {
  float radius = amount * 0.04 * sin(progress * PI);
  float t = smoothstep(0.25, 0.75, progress);
  return mix(blurred(uv, radius, false), blurred(uv, radius, true), t);
}`,
  },
];
