/** Stylize: mosaic, posterize, edges, glow, grain, mirror, grid. */
import type { EffectDefinition } from "../effects.ts";
import { percent, videoEffect } from "./common.ts";

export const STYLIZE_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "mosaic",
    label: "Mosaic",
    tags: ["stylize"],
    params: [percent("blockSize", "Block Size", 0.04, { min: 0.005, max: 0.25, decimals: 1 })],
    demo: { blockSize: 0.08 },
    glsl: `
vec4 effect(vec2 uv) {
  // Square blocks, a fraction of the height tall, each the average of 4x4 samples of itself.
  vec2 cell = vec2(blockSize / ratio, blockSize);
  vec2 corner = floor(uv / cell) * cell;
  vec4 sum = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) sum += getColor(corner + (vec2(x, y) + 0.5) / 4.0 * cell);
  }
  return sum / 16.0;
}`,
  }),
  videoEffect({
    type: "posterize",
    label: "Posterize",
    tags: ["stylize"],
    params: [{ kind: "number", key: "levels", label: "Levels", default: 5, min: 2, max: 32, step: 1, decimals: 0, slider: true }],
    demo: { levels: 4 },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float n = max(1.0, floor(levels) - 1.0);
  return withRgb(c, floor(unpremultiply(c) * n + 0.5) / n);
}`,
  }),
  videoEffect({
    type: "find-edges",
    label: "Find Edges",
    tags: ["stylize"],
    params: [
      { kind: "boolean", key: "invert", label: "Invert", default: true },
      percent("strength", "Strength", 1.5, { max: 5 }),
      percent("blend", "Blend With Original", 0),
    ],
    glsl: `
float lumaAt(vec2 uv) { return luma(getColor(uv)); }
vec4 effect(vec2 uv) {
  vec2 px = 1.0 / resolution;
  // Sobel.
  float tl = lumaAt(uv + px * vec2(-1.0, 1.0));
  float t = lumaAt(uv + px * vec2(0.0, 1.0));
  float tr = lumaAt(uv + px * vec2(1.0, 1.0));
  float l = lumaAt(uv + px * vec2(-1.0, 0.0));
  float r = lumaAt(uv + px * vec2(1.0, 0.0));
  float bl = lumaAt(uv + px * vec2(-1.0, -1.0));
  float b = lumaAt(uv + px * vec2(0.0, -1.0));
  float br = lumaAt(uv + px * vec2(1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float e = clamp(length(vec2(gx, gy)) * strength, 0.0, 1.0);
  vec4 c = getColor(uv);
  vec3 edges = vec3(invert > 0.5 ? 1.0 - e : e);
  return withRgb(c, mix(edges, unpremultiply(c), blend));
}`,
  }),
  videoEffect({
    type: "glow",
    label: "Glow",
    tags: ["stylize"],
    params: [
      percent("threshold", "Threshold", 0.55),
      percent("reach", "Radius", 0.05, { max: 0.3, decimals: 1 }),
      percent("intensity", "Intensity", 1.2, { max: 4 }),
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // The bright parts, gathered from a disc (a sunflower spiral of samples) around the pixel.
  const int N = 64;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N));
    float a = float(i) * 2.39996;
    vec2 o = vec2(cos(a), sin(a)) * r * reach;
    o.x /= ratio;
    vec4 s = getColorOrClear(uv + o);
    float w = exp(-3.0 * r * r);
    sum += s.rgb * smoothstep(threshold, threshold + 0.25, luma(s)) * w;
    total += w;
  }
  vec3 g = clamp(sum / total * intensity, 0.0, 1.0);
  float ga = max(g.r, max(g.g, g.b));
  // Screen, which also lets the glow spill past a text's letters.
  return vec4(c.rgb + g - c.rgb * g, c.a + ga - c.a * ga);
}`,
  }),
  videoEffect({
    type: "film-grain",
    label: "Film Grain",
    tags: ["stylize"],
    params: [percent("amount", "Amount", 0.35), percent("grainSize", "Grain Size", 1, { min: 0.5, max: 4 })],
    demo: { amount: 0.5 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // New grain every film frame (24 per second), about a 1080p pixel across at 100%.
  float seed = floor(time * 24.0);
  vec2 p = aspect(uv) * 900.0 / grainSize + hash2(vec2(seed, 3.1)) * 1000.0;
  float n = noise(p) + noise(p * 1.9 + 7.0) - 1.0;
  vec3 rgb = unpremultiply(c);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  // Strongest in the midtones, like film.
  return withRgb(c, rgb + n * amount * 0.35 * (0.35 + 4.0 * y * (1.0 - y)));
}`,
  }),
  videoEffect({
    type: "mirror",
    label: "Mirror",
    tags: ["stylize"],
    params: [
      {
        kind: "choice",
        key: "side",
        label: "Keep",
        default: "left",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
          { value: "top", label: "Top" },
          { value: "bottom", label: "Bottom" },
          { value: "corner", label: "Top Left" },
        ],
      },
    ],
    glsl: `
vec4 effect(vec2 uv) {
  vec2 p = uv;
  // Reflects one half (or quarter) onto the rest.
  if (side == 0 || side == 4) p.x = p.x > 0.5 ? 1.0 - p.x : p.x;
  if (side == 1) p.x = p.x < 0.5 ? 1.0 - p.x : p.x;
  if (side == 2 || side == 4) p.y = p.y < 0.5 ? 1.0 - p.y : p.y;
  if (side == 3) p.y = p.y > 0.5 ? 1.0 - p.y : p.y;
  return getColor(p);
}`,
  }),
  videoEffect({
    type: "grid",
    label: "Grid",
    tags: ["stylize"],
    params: [{ kind: "number", key: "tiles", label: "Tiles", default: 2, min: 1, max: 8, step: 1, decimals: 0, slider: true }],
    demo: { tiles: 3 },
    glsl: `
vec4 effect(vec2 uv) {
  float n = max(1.0, floor(tiles));
  // The whole picture in every tile, 2x2 samples per pixel so it doesn't shimmer.
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(i % 2, i / 2) - 0.5) * 0.5 / resolution;
    sum += getColor(fract((uv + o) * n));
  }
  return sum / 4.0;
}`,
  }),
];
