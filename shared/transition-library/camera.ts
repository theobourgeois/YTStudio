/** Camera moves: zooms, spins and whips. */
import type { TransitionDefinition } from "../transitions.ts";

/**
 * Shared by the zooms: a radial zoom blur, using the prelude's `mirrored`
 * so a picture pulled back past its edges shows its reflection rather than a
 * gap, like CapCut. `z` is the magnification around the centre; the blur smears it
 * over z..z·(1 + blur). The per-pixel jitter turns banding into fine grain.
 */
const ZOOM_HELPERS = `
vec4 zoomed(vec2 uv, float z, float blur, bool incoming) {
  float j = hash(uv * resolution);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 22; i++) {
    float f = (float(i) + j) / 22.0 - 0.5;
    vec2 p = mirrored(0.5 + (uv - 0.5) / (z * exp(blur * f)));
    sum += incoming ? getToColor(p) : getFromColor(p);
  }
  return sum / 22.0;
}
// Rises from 0 to 1 over the cut, shortly enough to hide in the blur.
float cutMix() { return smoothstep(0.44, 0.56, progress); }
`;

const STRENGTH = {
  kind: "number",
  key: "strength",
  label: "Strength",
  default: 1,
  min: 0.2,
  max: 3,
  scale: 100,
  unit: "%",
  step: 1,
  decimals: 0,
  slider: true,
} as const;

export const BLURS_AND_ZOOMS: TransitionDefinition[] = [
  {
    type: "pop",
    label: "Pop",
    tags: ["zoom"],
    duration: 0.25,
    params: [
      { kind: "number", key: "size", label: "Start Size", default: 0.5, min: 0, max: 1, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
      { kind: "number", key: "bounce", label: "Bounce", default: 1, min: 0, max: 3, step: 0.05, decimals: 2 },
    ],
    glsl: `
// B grows in around its own middle (a caption pops up where it is), overshooting a little; A fades away.
vec4 transition(vec2 uv) {
  float t = clamp(progress, 0.0, 1.0);
  float k = 1.70158 * bounce;
  float u = t - 1.0;
  float grow = 1.0 + (k + 1.0) * u * u * u + k * u * u;
  float s = max(1e-3, mix(size, 1.0, grow));
  vec4 b = getToColor(toCentre + (uv - toCentre) / s) * smoothstep(0.0, 0.4, t);
  vec4 a = getFromColor(uv) * (1.0 - smoothstep(0.0, 0.3, t));
  return b + a * (1.0 - b.a);
}`,
  },
  {
    type: "cross-zoom",
    label: "Cross Zoom",
    tags: ["zoom", "blur"],
    duration: 0.6,
    params: [STRENGTH],
    glsl: `${ZOOM_HELPERS}
// Push into A, faster and blurrier up to the cut; B starts as far in and settles back.
vec4 transition(vec2 uv) {
  float range = log(1.0 + 2.5 * strength);  // log of the peak magnification
  float a = clamp(progress * 2.0, 0.0, 1.0);
  float b = clamp(progress * 2.0 - 1.0, 0.0, 1.0);
  float w = cutMix();
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  // Blur follows the speed of the zoom (the easing's slope).
  if (w < 1.0) from = zoomed(uv, exp(range * easeIn(a)), 0.3 * range * a * a, false);
  if (w > 0.0) to = zoomed(uv, exp(range * (1.0 - easeOut(b))), 0.3 * range * (1.0 - b) * (1.0 - b), true);
  return mix(from, to, w);
}`,
  },
  {
    type: "zoom-out",
    label: "Zoom Out",
    tags: ["zoom", "blur"],
    duration: 0.6,
    params: [STRENGTH],
    glsl: `${ZOOM_HELPERS}
// Pull back from A (its mirrored copies fill in around it), then from a close-up of B down to normal.
vec4 transition(vec2 uv) {
  float range = log(1.0 + 2.5 * strength);
  float a = clamp(progress * 2.0, 0.0, 1.0);
  float b = clamp(progress * 2.0 - 1.0, 0.0, 1.0);
  float w = cutMix();
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  if (w < 1.0) from = zoomed(uv, exp(-range * easeIn(a)), 0.3 * range * a * a, false);
  if (w > 0.0) to = zoomed(uv, exp(range * (1.0 - easeOut(b))), 0.3 * range * (1.0 - b) * (1.0 - b), true);
  return mix(from, to, w);
}`,
  },
  {
    type: "pull-in",
    label: "Pull In",
    tags: ["zoom", "blur"],
    duration: 0.6,
    params: [STRENGTH],
    glsl: `${ZOOM_HELPERS}
// One continuous push forward: into A, then B rushes up from afar (among its reflections) to fill the frame.
vec4 transition(vec2 uv) {
  float range = log(1.0 + 2.5 * strength);
  float a = clamp(progress * 2.0, 0.0, 1.0);
  float b = clamp(progress * 2.0 - 1.0, 0.0, 1.0);
  float w = cutMix();
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  if (w < 1.0) from = zoomed(uv, exp(range * easeIn(a)), 0.3 * range * a * a, false);
  if (w > 0.0) to = zoomed(uv, exp(-range * (1.0 - easeOut(b))), 0.3 * range * (1.0 - b) * (1.0 - b), true);
  return mix(from, to, w);
}`,
  },
  {
    type: "spin",
    label: "Spin",
    tags: ["zoom", "blur"],
    duration: 0.6,
    params: [
      { kind: "boolean", key: "clockwise", label: "Clockwise", default: true },
      { kind: "number", key: "turns", label: "Turns", default: 1, min: 0.25, max: 4, step: 0.05, decimals: 2 },
    ],
    glsl: `
// The picture turned by "angle" and pushed in by "z", smeared over "spread" radians.
vec4 spun(vec2 uv, float angle, float spread, float z, bool incoming) {
  vec2 q = aspect(uv) / z;
  float j = hash(uv * resolution);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 22; i++) {
    float f = (float(i) + j) / 22.0 - 0.5;
    vec2 p = mirrored((rot(angle + spread * f) * q) / vec2(ratio, 1.0) + 0.5);
    sum += incoming ? getToColor(p) : getFromColor(p);
  }
  return sum / 22.0;
}
vec4 transition(vec2 uv) {
  float total = (clockwise > 0.5 ? 1.0 : -1.0) * turns * 2.0 * PI;
  float e = ease(progress);
  // The easing's slope (peaks at 3 on the cut): how fast it turns, so how much it blurs.
  float speed = progress < 0.5 ? 12.0 * progress * progress : 12.0 * (1.0 - progress) * (1.0 - progress);
  float spread = total * speed * 0.055;
  float z = 1.0 + 0.3 * sin(PI * progress);
  float w = smoothstep(0.44, 0.56, progress);
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  if (w < 1.0) from = spun(uv, total * e, spread, z, false);
  if (w > 0.0) to = spun(uv, total * (e - 1.0), spread, z, true);
  return mix(from, to, w);
}`,
  },
  {
    type: "shake",
    label: "Shake",
    tags: ["zoom", "glitch"],
    duration: 0.6,
    params: [STRENGTH],
    glsl: `
// The camera's offset (square units) and roll at time t: jitter building up to the hit on the cut, then settling.
vec3 jolt(float t) {
  float settle = clamp(2.0 - 2.0 * t, 0.0, 1.0);
  float env = t < 0.5 ? easeIn(t * 2.0) : settle * settle;
  vec3 n = vec3(noise(vec2(t * 22.0, 3.7)), noise(vec2(t * 22.0, 11.3)), noise(vec2(t * 16.0, 23.9))) * 2.0 - 1.0;
  return n * env * strength * vec3(0.14, 0.14, 0.08);
}
vec4 shaken(vec2 uv, float t, bool incoming) {
  vec3 now = jolt(t);
  // Motion blur along the way the camera moves right now.
  vec3 motion = (jolt(t + 0.012) - jolt(t - 0.012)) * 1.6;
  float z = 1.0 + 0.8 * length(jolt(t).xy) + 0.1 * strength * sin(PI * t) * sin(PI * t);
  float j = hash(uv * resolution);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 20; i++) {
    float f = (float(i) + j) / 20.0 - 0.5;
    vec3 c = now + motion * f;
    vec2 q = rot(c.z) * (aspect(uv) / z) + c.xy;
    vec2 p = mirrored(q / vec2(ratio, 1.0) + 0.5);
    sum += incoming ? getToColor(p) : getFromColor(p);
  }
  return sum / 20.0;
}
vec4 transition(vec2 uv) {
  float w = smoothstep(0.47, 0.53, progress);
  vec4 from = vec4(0.0);
  vec4 to = vec4(0.0);
  if (w < 1.0) from = shaken(uv, progress, false);
  if (w > 0.0) to = shaken(uv, progress, true);
  return mix(from, to, w);
}`,
  },
];
