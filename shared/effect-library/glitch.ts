/** Glitches: RGB split, digital breakup, VHS, blocks, tearing, static, RGB waves, slices. */
import type { EffectDefinition } from "../effects.ts";
import type { NumberSpec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/** Which random pattern a glitch draws: another seed, another look with the same settings. */
const seedParam = (): NumberSpec => ({ kind: "number", key: "seed", label: "Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 });

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
  videoEffect({
    type: "block-glitch",
    label: "Block Glitch",
    tags: ["glitch"],
    params: [
      percent("amount", "Amount", 0.5),
      percent("blockSize", "Block Size", 0.06, { min: 0.01, max: 0.3, decimals: 1 }),
      { kind: "number", key: "speed", label: "Speed", default: 8, min: 0, max: 30, unit: "/s", step: 0.1, decimals: 1, slider: true },
      seedParam(),
      percent("rgbOffset", "RGB Offset", 0.015, { max: 0.1, decimals: 1 }),
    ],
    demo: { amount: 0.8 },
    animated: true,
    glsl: `
// The block of a grid of rows \`h\` tall, each row cut into blocks 1 to 4 times as wide as tall and staggered:
// its id, and its rectangle (x, y, width, height in uv).
vec4 blockAt(vec2 uv, float h, float s, out vec2 id) {
  float row = floor(uv.y / h);
  float w = h * (1.0 + floor(hash(vec2(row, s + 3.1)) * 4.0)) / ratio;
  float shift = hash(vec2(row, s + 8.7)) * w;
  float col = floor((uv.x + shift) / w);
  id = vec2(col, row);
  return vec4(col * w - shift, row * h, w, h);
}
vec4 effect(vec2 uv) {
  // New blocks Speed times a second (the same ones at the same time, always); Speed 0 holds them.
  float s = floor(seed) * 7.31 + floor(time * speed) * 1.37;
  vec2 id;
  vec4 big = blockAt(uv, blockSize, s, id);
  float hit = step(1.0 - amount * 0.35, hash(id + s * 3.3));
  vec2 id2;
  blockAt(uv, blockSize * 0.3, s + 5.0, id2);
  float hit2 = step(1.0 - amount * 0.25, hash(id2 + s * 1.9));
  if (hit + hit2 == 0.0) return getColor(uv);

  vec2 p = uv;
  float kind = hash(id + s * 7.1);
  if (hit2 > 0.5) {
    // Small blocks copied from somewhere nearby.
    p += (hash2(id2 + s) - 0.5) * vec2(0.3 / ratio, 0.15);
  } else if (kind < 0.45) {
    // The block shows another part of the picture.
    p += floor((hash2(id + s * 2.3) - 0.5) * 8.0) * big.zw * 0.5;
  } else if (kind < 0.75) {
    // Datamosh drag: the block repeats one line of itself.
    p.y = big.y + big.w * hash(id + s * 4.9);
  }
  p = vec2(fract(p.x), clamp(p.y, 0.0, 1.0));
  vec2 off = vec2(rgbOffset * (hash(id + s * 6.1) > 0.5 ? 1.0 : -1.0) / ratio, 0.0);
  vec4 r = getColor(vec2(fract(p.x + off.x), p.y));
  vec4 g = getColor(p);
  vec4 b = getColor(vec2(fract(p.x - off.x), p.y));
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  // Some blocks lose their colour: channels swapped or crushed to a few levels.
  if (hit > 0.5 && kind > 0.75) {
    vec3 q = floor(c.rgb * 5.0 + 0.5) / 5.0;
    c.rgb = kind > 0.88 ? c.brg : q;
  }
  return c;
}`,
  }),
  videoEffect({
    type: "scan-tear",
    label: "Scan Tear",
    tags: ["glitch"],
    params: [
      percent("amount", "Amount", 0.5),
      percent("bandHeight", "Band Height", 0.08, { min: 0.01, max: 0.5, decimals: 1 }),
      { kind: "number", key: "speed", label: "Speed", default: 1, min: 0, max: 10, step: 0.05, decimals: 2, slider: true },
    ],
    demo: { amount: 0.8, bandHeight: 0.14 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  float t = time * speed;
  float frame = floor(t * 12.0);
  vec2 p = uv;
  float torn = 0.0;
  // Three bands rolling down the picture at their own pace; each shoves its lines sideways, more towards its top.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float h = bandHeight * mix(0.5, 1.4, hash(vec2(fi, 2.0)));
    float centre = 1.0 - fract(hash(vec2(fi, 1.0)) + t * mix(0.12, 0.4, hash(vec2(fi, 3.0))));
    float k = (uv.y - centre) / h + 0.5;
    if (k < 0.0 || k > 1.0) continue;
    float shove = (hash(vec2(fi, frame + 10.0)) - 0.5) * 0.5 * amount;
    float jag = (hash(vec2(floor(uv.y * 400.0), frame + fi)) - 0.5) * 0.012 * amount;
    p.x += shove * (0.3 + 0.7 * k) + jag;
    torn = 1.0;
  }
  p.x = fract(p.x);
  vec2 off = vec2(torn * 0.006 * amount / ratio, 0.0);
  vec4 r = getColor(vec2(fract(p.x + off.x), p.y));
  vec4 g = getColor(p);
  vec4 b = getColor(vec2(fract(p.x - off.x), p.y));
  vec4 c = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
  // Thin noisy lines, part of the way across.
  float line = floor(uv.y * 300.0);
  if (hash(vec2(line, frame)) > 1.0 - 0.05 * amount) {
    float from = hash(vec2(line, frame + 1.0));
    float to = from + 0.2 + 0.6 * hash(vec2(line, frame + 2.0));
    if (uv.x > from && uv.x < to) {
      float n = hash(vec2(floor(uv.x * 500.0), line + frame));
      c.rgb = mix(c.rgb, vec3(n) * c.a, 0.7);
    }
  }
  return c;
}`,
  }),
  videoEffect({
    type: "digital-noise",
    label: "Digital Noise",
    tags: ["glitch"],
    params: [
      percent("amount", "Amount", 0.5),
      percent("noiseSize", "Size", 0.002, { min: 0.0005, max: 0.05, decimals: 2 }),
      { kind: "boolean", key: "colorNoise", label: "Color Noise", default: false },
    ],
    demo: { amount: 0.6, noiseSize: 0.01 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // New static 30 times a second, in dots Size tall (at least a pixel).
  float size = max(noiseSize, 1.0 / resolution.y);
  vec2 cell = floor(vec2(uv.x * ratio, uv.y) / size);
  float frame = mod(floor(time * 30.0), 997.0);
  vec2 seed = cell + frame * vec2(37.1, 11.3);
  // Lines run together a little, like a tuner's static.
  float line = hash(vec2(cell.y, frame + 0.5));
  vec3 n = vec3(mix(hash(seed), line, 0.3));
  if (colorNoise > 0.5) n = mix(n, vec3(hash(seed + 0.31), hash(seed + 0.67), hash(seed + 0.93)), 0.7);
  // A brighter bar drifting up, as the signal comes and goes.
  float bar = smoothstep(0.25, 0.0, abs(fract(uv.y - time * 0.3) - 0.5));
  vec3 rgb = mix(unpremultiply(c), n, amount) + amount * 0.08 * bar;
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "wave-rgb",
    label: "RGB Wave",
    tags: ["glitch"],
    params: [
      percent("amount", "Amount", 0.02, { max: 0.2, decimals: 1 }),
      { kind: "number", key: "frequency", label: "Frequency", default: 3, min: 0.5, max: 30, step: 0.1, decimals: 1, slider: true },
      { kind: "number", key: "speed", label: "Speed", default: 1.5, min: 0, max: 10, step: 0.05, decimals: 2, slider: true },
    ],
    demo: { amount: 0.08, frequency: 2 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // Each channel rides its own wave (Frequency waves up the picture, Speed cycles a second) plus a shake.
  float phase = time * speed * 2.0 * PI;
  float y = uv.y * frequency * 2.0 * PI;
  vec3 off;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float wave = sin(y * (1.0 + 0.15 * fi) + phase + fi * 2.1);
    float shake = noise(vec2(time * speed * 3.0, fi * 7.3)) - 0.5;
    off[i] = amount * (0.7 * wave + 0.8 * shake);
  }
  vec4 r = getColor(uv + vec2(off.r / ratio, 0.2 * off.g));
  vec4 g = getColor(uv + vec2(off.g / ratio * 0.5, 0.0));
  vec4 b = getColor(uv + vec2(off.b / ratio, -0.2 * off.r));
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  }),
  videoEffect({
    type: "displacement-glitch",
    label: "Glitch Slice",
    tags: ["glitch"],
    params: [
      percent("amount", "Amount", 0.1, { max: 0.5 }),
      { kind: "number", key: "slices", label: "Slices", default: 16, min: 2, max: 100, step: 1, decimals: 0, slider: true },
      seedParam(),
      { kind: "number", key: "speed", label: "Speed", default: 0, min: 0, max: 30, unit: "/s", step: 0.1, decimals: 1, slider: true },
    ],
    demo: { amount: 0.2, speed: 4 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // Speed 0: the same slices throughout (animate Amount instead); otherwise new ones Speed times a second.
  float s = floor(seed) + floor(time * speed) * 17.0;
  float coarse = floor(uv.y * slices);
  // Some slices split in two or three, so they aren't all the same height.
  float parts = 1.0 + floor(hash(vec2(coarse, s + 1.3)) * 3.0);
  float id = coarse * 3.0 + floor(fract(uv.y * slices) * parts);
  float moved = step(0.3, hash(vec2(id, s + 4.1)));
  float shift = (hash(vec2(id, s + 9.7)) - 0.5) * 2.0 * amount * moved;
  vec2 p = vec2(fract(uv.x - shift), uv.y);
  // The further a slice moves, the more its channels part.
  float split = shift * 0.1;
  vec4 r = getColor(vec2(fract(p.x + split), p.y));
  vec4 g = getColor(p);
  vec4 b = getColor(vec2(fract(p.x - split), p.y));
  return vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`,
  }),
];
