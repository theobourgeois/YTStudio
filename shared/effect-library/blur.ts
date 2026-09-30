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
  videoEffect({
    type: "radial-blur",
    label: "Radial Blur",
    tags: ["blur"],
    params: [
      {
        kind: "choice",
        key: "blurType",
        label: "Type",
        default: "spin",
        options: [
          { value: "spin", label: "Spin" },
          { value: "zoom", label: "Zoom" },
        ],
      },
      { ...degrees("angle", "Angle", 10, 0, 360), disabledFor: (v) => v.blurType === "zoom" },
      { ...percent("zoom", "Amount", 0.3, { max: 2 }), disabledFor: (v) => v.blurType !== "zoom" },
      { kind: "vec2", key: "centre", label: "Center", default: [0.5, 0.5], space: "media", min: -10, max: 10, step: 1, decimals: 1 },
    ],
    demo: { angle: 25 },
    // An even blur along the whole turn (or zoom) in two passes: 32 short steps, then 32 steps
    // each as long as the first pass's, which add up to 1024 without gaps even far from the centre.
    passes: 2,
    glsl: `
vec2 moved(vec2 uv, vec2 c, float u) {
  if (blurType == 1) return c + (uv - c) * exp(zoom * u);
  // Turned in square units, so it's a circle on any frame.
  vec2 q = (uv - c) * vec2(ratio, 1.0);
  return c + (rot(radians(angle) * u) * q) / vec2(ratio, 1.0);
}
vec4 effect(vec2 uv) {
  const int N = 32;
  vec2 c = toUv(centre);
  float span = pass == 0 ? 1.0 / float(N) : 1.0;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < N; i++) sum += getColor(moved(uv, c, ((float(i) + 0.5) / float(N) - 0.5) * span));
  return sum / float(N);
}`,
  }),
  videoEffect({
    type: "lens-blur",
    label: "Camera Lens Blur",
    tags: ["blur"],
    params: [
      percent("blurRadius", "Blur Radius", 0.03, { max: 0.2, decimals: 1 }),
      {
        kind: "choice",
        key: "iris",
        label: "Iris Shape",
        default: "disc",
        options: [
          { value: "disc", label: "Disc" },
          { value: "hexagon", label: "Hexagon" },
        ],
      },
      degrees("irisRotation", "Iris Rotation", 0),
      percent("specularThreshold", "Specular Threshold", 0.85),
      percent("specularBrightness", "Specular Brightness", 1, { max: 5 }),
    ],
    demo: { blurRadius: 0.06, iris: "hexagon", specularThreshold: 0.9, specularBrightness: 1 },
    // Defocus happens in linear light, with highlights pushed past white first, so small lights open
    // into bright discs (or hexagons) instead of greying out. Pass 1 blurs a little to fill the
    // gaps between pass 2's 64 samples of the iris. Between them the light (up to 32x white) is
    // kept cube-rooted, so the 8-bit layer doesn't band.
    passes: 2,
    glsl: `
const float CAP = 32.0;
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
float dither() { return (hash(gl_FragCoord.xy) - 0.5) / 255.0; }
vec3 boosted(vec3 s) {
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  // Grown in over the first few pixels of blur, so a blur keyframed down to nothing ends on the picture itself.
  float open = smoothstep(0.0, 6.0, blurRadius * resolution.y);
  return toLinear(s) * (1.0 + open * specularBrightness * 20.0 * smoothstep(min(specularThreshold, 0.999), 1.0, l));
}
// The iris's radius towards angle a, as a fraction of its circle's.
float irisReach(float a) {
  if (iris == 0) return 1.0;
  return 0.866025 / cos(mod(a - radians(irisRotation), PI / 3.0) - PI / 6.0);
}
vec4 effect(vec2 uv) {
  if (blurRadius <= 0.0) return getColor(uv);
  vec3 light = vec3(0.0);
  float alpha = 0.0;
  float total = 0.0;
  if (pass == 0) {
    for (int i = 0; i < 16; i++) {
      float r = sqrt((float(i) + 0.5) / 16.0) * blurRadius * 0.25;
      float a = float(i) * 2.39996;
      vec4 s = getColor(uv + vec2(cos(a) / ratio, sin(a)) * r);
      light += boosted(unpremultiply(s)) * s.a;
      alpha += s.a;
    }
    light /= 16.0;
    alpha /= 16.0;
    vec3 straight = alpha > 0.0 ? light / alpha : vec3(0.0);
    return vec4((pow(clamp(straight / CAP, 0.0, 1.0), vec3(1.0 / 3.0)) + dither()) * alpha, alpha);
  }
  for (int i = 0; i < 64; i++) {
    float a = float(i) * 2.39996;
    float f = irisReach(a);
    float r = sqrt((float(i) + 0.5) / 64.0) * blurRadius * 0.9 * f;
    vec4 s = getColor(uv + vec2(cos(a) / ratio, sin(a)) * r);
    // Stretching the samples out to a hexagon's corners spreads them thinner there: weigh them up.
    float w = f * f;
    vec3 e = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
    light += e * e * e * CAP * s.a * w;
    alpha += s.a * w;
    total += w;
  }
  light /= total;
  alpha /= total;
  vec3 straight = alpha > 0.0 ? light / alpha : vec3(0.0);
  // Past white burns towards white rather than clipping each channel.
  float over = max(max(straight.r, max(straight.g, straight.b)) - 1.0, 0.0);
  straight = min(straight + over * 0.3, vec3(1.0));
  return vec4((pow(straight, vec3(1.0 / 2.2)) + dither()) * alpha, alpha);
}`,
  }),
  videoEffect({
    type: "channel-blur",
    label: "Channel Blur",
    tags: ["blur"],
    params: [
      percent("redBlur", "Red Blurriness", 0.03, { max: 0.25, decimals: 1 }),
      percent("greenBlur", "Green Blurriness", 0, { max: 0.25, decimals: 1 }),
      percent("blueBlur", "Blue Blurriness", 0.01, { max: 0.25, decimals: 1 }),
      percent("alphaBlur", "Alpha Blurriness", 0, { max: 0.25, decimals: 1 }),
      {
        kind: "choice",
        key: "dimensions",
        label: "Blur Dimensions",
        default: "both",
        options: [
          { value: "both", label: "Both" },
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    demo: { redBlur: 0.15, greenBlur: 0, blueBlur: 0.05 },
    // Each channel its own Gaussian, across then down. Each direction is two passes: a short box
    // as wide as the gap between the second pass's 15 samples, so they join up smoothly.
    passes: 4,
    glsl: `
vec4 effect(vec2 uv) {
  bool across = pass < 2;
  bool coarse = pass % 2 == 1;
  vec4 c = getColor(uv);
  if ((across && dimensions == 2) || (!across && dimensions == 1)) return c;
  vec4 reach = vec4(redBlur, greenBlur, blueBlur, alphaBlur);
  vec2 axis = across ? vec2(1.0 / ratio, 0.0) : vec2(0.0, 1.0);
  const int K = 7;
  for (int ch = 0; ch < 4; ch++) {
    // Blurriness is the reach (3 sigma), as a fraction of the height.
    float sigma = reach[ch] / 3.0;
    if (sigma <= 0.0) continue;
    float gap = reach[ch] / float(K);
    float sum = 0.0;
    float total = 0.0;
    for (int i = -K; i <= K; i++) {
      float x = float(i) * (coarse ? gap : gap / float(2 * K + 1));
      float w = coarse ? exp(-0.5 * x * x / (sigma * sigma)) : 1.0;
      sum += getColor(uv + axis * x)[ch] * w;
      total += w;
    }
    c[ch] = sum / total;
  }
  return c;
}`,
  }),
  videoEffect({
    type: "smart-blur",
    label: "Smart Blur",
    tags: ["blur"],
    params: [
      percent("reach", "Radius", 0.01, { max: 0.1, decimals: 1 }),
      percent("threshold", "Threshold", 0.1, { min: 0.01, max: 1 }),
    ],
    demo: { reach: 0.06, threshold: 0.1 },
    // A bilateral blur: neighbours count less the more their colour differs, so flat areas (skin)
    // smooth out and edges stay sharp. Twice, which smooths more evenly than once as wide.
    passes: 2,
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  if (reach <= 0.0) return c;
  vec3 s0 = unpremultiply(c);
  float sigma = reach * 0.4 * 0.7071;
  float k = 0.5 / (threshold * threshold);
  vec4 sum = c;
  float total = 1.0;
  for (int i = 0; i < 48; i++) {
    float u = (float(i) + 0.5) / 48.0;
    float r = sigma * sqrt(-2.0 * log(1.0 - u));
    float a = float(i) * 2.39996 + float(pass) * 1.3;
    vec4 s = getColor(uv + vec2(cos(a) / ratio, sin(a)) * r);
    vec3 d = unpremultiply(s) - s0;
    float da = s.a - c.a;
    float w = exp(-(dot(d, d) + da * da) * k);
    sum += s * w;
    total += w;
  }
  return sum / total;
}`,
  }),
];
