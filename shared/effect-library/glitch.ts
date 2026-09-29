/** Glitches: RGB split, digital breakup, VHS. */
import type { EffectDefinition } from "../effects.ts";
import { degrees, percent, videoEffect } from "./common.ts";

export const GLITCH_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "rgb-split",
    label: "RGB Split",
    tags: ["glitch"],
    params: [percent("amount", "Amount", 0.012, { max: 0.15, decimals: 1 }), degrees("direction", "Direction", 0)],
    demo: { amount: 0.04 },
    glsl: `
vec4 effect(vec2 uv) {
  vec2 off = vec2(cos(radians(direction)) / ratio, sin(radians(direction))) * amount;
  vec4 r = getColor(uv + off);
  vec4 g = getColor(uv);
  vec4 b = getColor(uv - off);
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  }),
  videoEffect({
    type: "glitch",
    label: "Glitch",
    tags: ["glitch"],
    params: [
      percent("intensity", "Intensity", 0.8, { max: 2 }),
      // How often it breaks up.
      percent("frequency", "Frequency", 0.5),
    ],
    // Always breaking up on its card.
    demo: { frequency: 1 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // Random in steps of 1/15 s; some steps are clean, some break up hard.
  float seed = floor(time * 15.0);
  float on = step(1.0 - frequency, hash(vec2(seed, 0.7)));
  float k = intensity * on * mix(0.4, 1.0, hash(vec2(seed, 5.3)));
  if (k <= 0.0) return getColor(uv);

  // Horizontal slices shoved sideways.
  float rows = mix(8.0, 30.0, hash(vec2(seed, 1.7)));
  float band = floor(uv.y * rows);
  float shoved = step(1.0 - 0.5 * min(k, 1.2), hash(vec2(band + 31.0, seed)));
  vec2 p = uv;
  p.x += shoved * (hash(vec2(band, seed)) - 0.5) * 0.25 * k;
  p.x += (hash(vec2(floor(uv.y * 400.0), seed + 9.0)) - 0.5) * 0.008 * k;

  // Blocks copied from elsewhere.
  float n = mix(7.0, 16.0, hash(vec2(seed, 2.1)));
  vec2 grid = vec2(ratio * n * 0.5, n);
  vec2 cell = floor(uv * grid);
  float blockOn = step(1.0 - 0.12 * min(k, 1.5), hash(cell + seed * 7.13));
  p += blockOn * floor((hash2(cell + seed * 3.7) - 0.5) * 6.0) / grid;
  p = vec2(fract(p.x), clamp(p.y, 0.0, 1.0));

  // Channels split, more in the shoved slices.
  float side = hash(vec2(seed, 8.1)) > 0.5 ? 1.0 : -1.0;
  vec2 off = vec2(side * (0.01 + 0.025 * shoved) * k, 0.0);
  vec4 r = getColor(vec2(fract(p.x + off.x), p.y));
  vec4 g = getColor(p);
  vec4 b = getColor(vec2(fract(p.x - off.x), p.y));
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));

  // A few corrupted, posterised blocks.
  float corrupt = hash(cell + 17.0 + seed);
  if (blockOn > 0.5 && corrupt > 0.55) {
    vec3 q = floor(c.rgb * 6.0 + 0.5) / 6.0;
    c.rgb = corrupt > 0.88 ? q.gbr : q;
  }
  return c;
}`,
  }),
  videoEffect({
    type: "vhs",
    label: "VHS",
    tags: ["glitch"],
    params: [percent("intensity", "Intensity", 0.7), percent("scanlines", "Scanlines", 0.5)],
    demo: { intensity: 1 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  float k = intensity;
  // Lines wobble sideways, more in a tracking band that rolls down the picture.
  float band = fract(0.25 * time);
  float inBand = smoothstep(0.08, 0.0, abs(uv.y - (1.0 - band)));
  float line = floor(uv.y * 240.0);
  float wobble = (noise(vec2(line * 0.05, time * 6.0)) - 0.5) * 0.004 + (hash(vec2(line, floor(time * 30.0))) - 0.5) * 0.03 * inBand;
  vec2 p = vec2(uv.x + wobble * k, uv.y);
  // Colour bleeds to the right of the brightness.
  vec2 bleed = vec2(0.006 * k / ratio, 0.0);
  vec4 c = getColor(p);
  vec3 rgb = unpremultiply(c);
  vec3 r = unpremultiply(getColor(p - bleed));
  vec3 b = unpremultiply(getColor(p + bleed));
  rgb = vec3(mix(rgb.r, r.r, k), rgb.g, mix(rgb.b, b.b, k));
  // Washed out and a little warm.
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(y), 0.25 * k) * vec3(1.04, 1.0, 0.94);
  // Scanlines, snow and the band's noise.
  rgb *= 1.0 - scanlines * 0.35 * (0.5 + 0.5 * sin(uv.y * resolution.y * PI));
  float snow = hash(uv * resolution + fract(time * 13.7) * 100.0);
  rgb += (snow - 0.5) * 0.12 * k + inBand * k * 0.2 * step(0.7, snow);
  return withRgb(c, rgb);
}`,
  }),
];
