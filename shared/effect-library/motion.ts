/** Distortions (waves, bulge, twirl) and camera moves (shake, pulse) inside the clip's frame. */
import type { EffectDefinition } from "../effects.ts";
import type { Vec2Spec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

const centre: Vec2Spec = {
  kind: "vec2",
  key: "centre",
  label: "Center",
  default: [0.5, 0.5],
  space: "media",
  min: -10,
  max: 10,
  step: 1,
  decimals: 1,
};

export const MOTION_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "wave-warp",
    label: "Wave Warp",
    tags: ["distort"],
    params: [
      percent("amplitude", "Height", 0.015, { max: 0.2, decimals: 1 }),
      percent("wavelength", "Width", 0.25, { min: 0.02, max: 2 }),
      { kind: "number", key: "speed", label: "Speed", default: 1, min: 0, max: 10, unit: " /s", step: 0.1, decimals: 1 },
      {
        kind: "choice",
        key: "axis",
        label: "Direction",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    demo: { amplitude: 0.03 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // Sideways ripples travelling up (or up-and-down ones travelling across), in square units.
  vec2 p = uv;
  if (axis == 0) p.x += amplitude / ratio * sin((uv.y / wavelength - time * speed) * 2.0 * PI);
  else p.y += amplitude * sin((uv.x * ratio / wavelength - time * speed) * 2.0 * PI);
  return getColor(mirrored(p));
}`,
  }),
  videoEffect({
    type: "bulge",
    label: "Bulge",
    tags: ["distort"],
    params: [
      // Negative pinches.
      percent("amount", "Amount", 0.6, { min: -0.9, max: 1.5 }),
      percent("reach", "Radius", 0.4, { min: 0.05, max: 1.5 }),
      centre,
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float r = length(d) / reach;
  if (r >= 1.0 || r <= 0.0) return getColor(uv);
  // Samples nearer the middle (magnifying it), meeting the picture again at the edge of the circle.
  float s = pow(r, 1.0 + amount);
  return getColor(c + d * (s / r) / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "twirl",
    label: "Twirl",
    tags: ["distort"],
    params: [degrees("angle", "Angle", 120, -720, 720), percent("reach", "Radius", 0.45, { min: 0.05, max: 1.5 }), centre],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  vec2 d = (uv - c) * vec2(ratio, 1.0);
  float r = length(d) / reach;
  if (r >= 1.0) return getColor(uv);
  // Turned most in the middle, not at all at the edge of the circle.
  float f = 1.0 - r;
  return getColor(c + rot(radians(angle) * f * f) * d / vec2(ratio, 1.0));
}`,
  }),
  videoEffect({
    type: "camera-shake",
    label: "Camera Shake",
    tags: ["camera"],
    params: [percent("strength", "Strength", 0.35), percent("speed", "Speed", 1, { min: 0.1, max: 4 })],
    demo: { strength: 0.6 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  float t = time * speed * 5.0;
  // A handheld wobble: smooth random drift and roll, zoomed in so the edges never show.
  vec2 drift = vec2(fbm(vec2(t, 1.3)), fbm(vec2(t, 7.9))) - 0.5;
  float roll = (fbm(vec2(t, 4.2)) - 0.5) * 0.12 * strength;
  float zoom = 1.0 + 0.25 * strength;
  vec2 p = rot(roll) * aspect(uv) / zoom + drift * 0.16 * strength;
  return getColor(mirrored(p / vec2(ratio, 1.0) + 0.5));
}`,
  }),
  videoEffect({
    type: "pulse",
    label: "Pulse",
    tags: ["camera"],
    params: [
      percent("amount", "Zoom", 0.12, { max: 1 }),
      { kind: "number", key: "bpm", label: "Tempo", default: 120, min: 20, max: 300, unit: " bpm", step: 1, decimals: 0 },
    ],
    demo: { amount: 0.2 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // A punch in on every beat, easing back out before the next.
  float beat = fract(time * bpm / 60.0);
  float zoom = 1.0 + amount * pow(1.0 - beat, 3.0);
  return getColor((uv - 0.5) / zoom + 0.5);
}`,
  }),
];
