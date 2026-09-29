/** Blur and sharpen. Blur sizes are fractions of the frame's height. */
import type { EffectDefinition } from "../effects.ts";
import { degrees, percent, videoEffect } from "./common.ts";

export const BLUR_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "gaussian-blur",
    label: "Gaussian Blur",
    tags: ["blur"],
    params: [
      percent("blurriness", "Blurriness", 0.02, { max: 0.25, decimals: 1 }),
      {
        kind: "choice",
        key: "dimensions",
        label: "Dimensions",
        default: "both",
        options: [
          { value: "both", label: "Both" },
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    demo: { blurriness: 0.08 },
    // Separable: across, then down.
    passes: 2,
    glsl: `
vec4 effect(vec2 uv) {
  bool across = pass == 0;
  if (blurriness <= 0.0 || (across && dimensions == 2) || (!across && dimensions == 1)) return getColor(uv);
  // Blurriness is the reach (3 sigma), as a fraction of the height.
  vec2 reach = across ? vec2(blurriness / ratio, 0.0) : vec2(0.0, blurriness);
  const int N = 32;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -N; i <= N; i++) {
    float x = float(i) / float(N);
    float w = exp(-4.5 * x * x);
    sum += getColor(uv + reach * x) * w;
    total += w;
  }
  return sum / total;
}`,
  }),
  videoEffect({
    type: "directional-blur",
    label: "Directional Blur",
    tags: ["blur"],
    params: [degrees("direction", "Direction", 0), percent("reach", "Blur Length", 0.06, { max: 0.5, decimals: 1 })],
    demo: { reach: 0.25 },
    glsl: `
vec4 effect(vec2 uv) {
  // 0° blurs across, 90° up and down.
  vec2 d = vec2(cos(radians(direction)), sin(radians(direction))) * reach * 0.5;
  d.x /= ratio;
  const int N = 40;
  vec4 sum = vec4(0.0);
  for (int i = -N; i <= N; i++) sum += getColor(uv + d * float(i) / float(N));
  return sum / float(2 * N + 1);
}`,
  }),
  videoEffect({
    type: "zoom-blur",
    label: "Zoom Blur",
    tags: ["blur"],
    params: [
      percent("amount", "Amount", 0.25),
      { kind: "vec2", key: "centre", label: "Center", default: [0.5, 0.5], space: "media", min: -10, max: 10, step: 1, decimals: 1 },
    ],
    demo: { amount: 0.4 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 c = toUv(centre);
  const int N = 40;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i <= N; i++) {
    float t = float(i) / float(N);
    float w = 1.0 - 0.5 * t;
    sum += getColor(c + (uv - c) * (1.0 - amount * 0.5 * t)) * w;
    total += w;
  }
  return sum / total;
}`,
  }),
  videoEffect({
    type: "sharpen",
    label: "Sharpen",
    tags: ["blur"],
    params: [percent("amount", "Amount", 0.8, { max: 3 })],
    demo: { amount: 2.5 },
    glsl: `
vec4 effect(vec2 uv) {
  // An unsharp mask a pixel or so wide: the detail at the size it's shown.
  vec2 px = 1.25 / resolution;
  vec4 c = getColor(uv);
  vec4 around = 0.25 * (
    getColor(uv + vec2(px.x, 0.0)) + getColor(uv - vec2(px.x, 0.0)) +
    getColor(uv + vec2(0.0, px.y)) + getColor(uv - vec2(0.0, px.y)));
  return c + (c - around) * amount * 1.5;
}`,
  }),
];
