/**
 * Stylize: mosaic, posterize, edges, glow, grain, mirror, grid, halftone, CRT, emboss, cartoon, pixel sort,
 * dither, ASCII, neon edges, strobe.
 */
import type { EffectDefinition } from "../effects.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/** ASCII's characters from sparse to dense (" .:-=+*#%@"), 5 x 7 pixels, top row first. */
const ASCII_GLYPHS = [
  [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  [".....", "#.#.#", ".###.", "#####", ".###.", "#.#.#", "....."],
  [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
  [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".####"],
];

/** The glyphs as GLSL ints, one per row (the high bit is the left column). */
const ASCII_ROWS = ASCII_GLYPHS.flat().map((row) => parseInt(row.replace(/#/g, "1").replace(/\./g, "0"), 2));

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
  videoEffect({
    type: "halftone",
    label: "Halftone",
    tags: ["stylize"],
    params: [
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "mono",
        options: [
          { value: "mono", label: "Mono" },
          { value: "cmyk", label: "CMYK" },
        ],
      },
      percent("dotSize", "Dot Size", 0.012, { min: 0.003, max: 0.1, decimals: 1 }),
      degrees("angle", "Angle", 45),
      percent("softness", "Softness", 0.1),
    ],
    demo: { mode: "cmyk", dotSize: 0.05 },
    glsl: `
// How much of the pixel one screen's dots cover. The screen is a grid of cells (square units, a dot's size),
// turned by \`a\`; each dot's area follows the ink at its cell's centre (\`ch\`: 0-2 = C, M, Y; 3 = K; 4 = mono).
float ink(vec3 rgb, int ch) {
  if (ch == 4) return 1.0 - dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  if (ch == 3) return k;
  return clamp((1.0 - rgb[ch] - k) / max(1.0 - k, 1e-4), 0.0, 1.0);
}
float screen(vec2 uv, float a, int ch) {
  float size = max(dotSize, 3.0 / resolution.y);
  mat2 turn = rot(a);
  vec2 g = turn * aspect(uv) / size;
  vec2 cell = floor(g);
  vec2 f = g - cell - 0.5;
  // The four nearest dots, so a big dot isn't cut off at its cell's edge.
  vec2 dir = sign(f + 1e-6);
  float aa = 0.75 / (resolution.y * size) + softness * 0.35;
  float cover = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i % 2), float(i / 2)) * dir;
    vec2 centre = cell + 0.5 + o;
    vec2 p = transpose(turn) * (centre * size);
    vec4 s = getColor(vec2(p.x / ratio, p.y) + 0.5);
    // The dot's area is the ink, growing a little faster near full so fully inked dots just cover the cell.
    float k = ink(unpremultiply(s), ch) * s.a;
    float r = sqrt(k / PI) * mix(1.0, 1.277, k * k);
    cover = max(cover, 1.0 - smoothstep(r - aa, r + aa, length(f - o)));
  }
  return cover;
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float a = radians(angle);
  if (mode == 0) return withRgb(c, vec3(1.0 - screen(uv, a, 4)));
  // The printer's screen angles, relative to Angle (which is K's).
  vec3 rgb = vec3(1.0);
  rgb *= 1.0 - screen(uv, a - radians(30.0), 0) * vec3(1.0, 0.0, 0.0);
  rgb *= 1.0 - screen(uv, a + radians(30.0), 1) * vec3(0.0, 1.0, 0.0);
  rgb *= 1.0 - screen(uv, a - radians(45.0), 2) * vec3(0.0, 0.0, 1.0);
  rgb *= 1.0 - screen(uv, a, 3);
  return withRgb(c, rgb);
}`,
  }),
  videoEffect({
    type: "crt",
    label: "CRT",
    tags: ["stylize"],
    params: [
      percent("scanlines", "Scanlines", 0.6),
      percent("curvature", "Curvature", 0.35),
      percent("mask", "Mask", 0.4),
      percent("glow", "Glow", 0.4),
      percent("flicker", "Flicker", 0.3),
    ],
    demo: { scanlines: 1, curvature: 0.6, mask: 0.7, glow: 0.6 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  // The tube's glass bulges: the further out, the more it bends; the corners fall off the screen.
  vec2 q = uv * 2.0 - 1.0;
  q *= 1.0 + curvature * 0.22 * q.yx * q.yx;
  vec2 p = q * 0.5 + 0.5;
  vec2 px = 1.0 / resolution;
  vec2 edge = smoothstep(vec2(0.0), 3.0 * px, 0.5 - abs(p - 0.5));
  float onScreen = edge.x * edge.y;

  // A slightly soft beam.
  vec4 s = 0.5 * getColor(p) + 0.25 * getColor(p + vec2(0.7 * px.x, 0.0)) + 0.25 * getColor(p - vec2(0.7 * px.x, 0.0));
  vec3 rgb = unpremultiply(s);

  // Light bleeding around bright parts.
  vec3 halo = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 2.39996;
    float r = 0.004 + 0.012 * fract(float(i) * 0.618);
    halo += unpremultiply(getColor(p + vec2(cos(a) / ratio, sin(a)) * r));
  }
  halo /= 12.0;
  rgb += glow * 0.7 * halo * smoothstep(0.25, 1.0, dot(halo, vec3(0.2126, 0.7152, 0.0722)));

  // 240 lines (fewer on small previews, where they'd alias); bright lines swell like a real beam.
  float lines = min(240.0, resolution.y / 2.5);
  float beam = 0.5 - 0.5 * cos(2.0 * PI * p.y * lines);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  beam = pow(beam, mix(1.4, 0.45, clamp(y, 0.0, 1.0)));
  rgb *= mix(1.0, 0.2 + 1.05 * beam, scanlines);

  // Aperture grille: red, green and blue stripes, a triad per line; faded out where too fine to draw.
  float triads = p.x * ratio * lines;
  vec3 m = 0.5 + 0.5 * cos(2.0 * PI * (triads - vec3(0.0, 1.0, 2.0) / 3.0));
  float fine = smoothstep(2.5, 4.0, resolution.y / lines);
  rgb *= mix(vec3(1.0), 0.4 + 1.2 * m, mask * fine);

  // Darker towards the edges, and a flicker with a faint bar rolling up the screen.
  float v = pow(max(16.0 * p.x * p.y * (1.0 - p.x) * (1.0 - p.y), 0.0), 0.25);
  rgb *= mix(1.0, v, 0.3 + 0.5 * curvature);
  float bar = 0.5 + 0.5 * sin((p.y - time * 0.35) * 2.0 * PI);
  rgb *= 1.0 - flicker * (0.1 * hash(vec2(floor(time * 60.0), 1.7)) + 0.06 * bar);

  // Past the glass: black, where the picture was.
  float a = mix(getColor(uv).a, s.a, onScreen);
  return vec4(clamp(rgb, 0.0, 1.0) * s.a * onScreen, a);
}`,
  }),
  videoEffect({
    type: "emboss",
    label: "Emboss",
    tags: ["stylize"],
    params: [
      degrees("direction", "Direction", 135),
      percent("relief", "Relief", 0.003, { min: 0, max: 0.03, decimals: 1 }),
      percent("contrast", "Contrast", 1, { max: 5 }),
      percent("blend", "Blend With Original", 0),
    ],
    demo: { relief: 0.008, contrast: 2 },
    glsl: `
float lumaAt(vec2 uv) { vec4 c = getColor(uv); return luma(c) + 0.25 * c.a; }
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // Lit from Direction: slopes facing it are lighter. Two distances, so a wide relief looks carved rather than doubled.
  vec2 d = vec2(cos(radians(direction)) / ratio, sin(radians(direction))) * max(relief, 1.0 / resolution.y);
  float g = (lumaAt(uv + d) - lumaAt(uv - d)) + 0.5 * (lumaAt(uv + 0.5 * d) - lumaAt(uv - 0.5 * d));
  float v = 0.5 + g * contrast * 1.4;
  return withRgb(c, mix(vec3(v), unpremultiply(c), blend));
}`,
  }),
  videoEffect({
    type: "toon",
    label: "Cartoon",
    tags: ["stylize"],
    params: [
      percent("detailRadius", "Detail Radius", 0.006, { max: 0.03, decimals: 1 }),
      { kind: "number", key: "shadingSteps", label: "Shading Steps", default: 6, min: 2, max: 16, step: 1, decimals: 0, slider: true },
      percent("edgeThreshold", "Edge Threshold", 0.1),
      percent("edgeWidth", "Edge Width", 0.0015, { min: 0, max: 0.01, decimals: 2 }),
      percent("edgeOpacity", "Edge Opacity", 1),
    ],
    demo: { detailRadius: 0.012, shadingSteps: 4, edgeThreshold: 0.06, edgeWidth: 0.006 },
    passes: 2,
    glsl: `
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Pass 0: smooths away detail but keeps edges (samples unlike the centre count less).
vec4 smoothed(vec2 uv) {
  vec4 c = getColor(uv);
  if (detailRadius * resolution.y < 1.0) return c;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float r = sqrt((float(i) + 0.5) / 32.0);
    float a = float(i) * 2.39996;
    vec4 s = getColor(uv + vec2(cos(a) / ratio, sin(a)) * r * detailRadius);
    vec4 d = s - c;
    float w = exp(-2.0 * r * r - 30.0 * dot(d, d));
    sum += s * w;
    total += w;
  }
  return sum / total;
}
float lumaAt(vec2 uv) { return lumaOf(getColor(uv).rgb); }
vec4 effect(vec2 uv) {
  if (pass == 0) return smoothed(uv);
  vec4 c = getColor(uv);
  vec3 rgb = unpremultiply(c);
  // Flat bands of brightness (with a pixel-soft step between them), keeping each colour.
  float y = lumaOf(rgb);
  float n = max(1.0, floor(shadingSteps) - 1.0);
  float yn = y * n;
  float base = floor(yn);
  float soft = clamp(fwidth(yn) * 1.5, 0.02, 1.0);
  float q = (base + smoothstep(0.5 - soft, 0.5 + soft, yn - base)) / n;
  rgb += q - y;
  // Ink lines where the smoothed picture changes fast.
  vec2 px = vec2(max(edgeWidth, 1.0 / resolution.y));
  px.x /= ratio;
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
  float e = smoothstep(edgeThreshold, edgeThreshold + 0.06, length(vec2(gx, gy)) * 0.25);
  rgb *= 1.0 - e * edgeOpacity;
  vec4 original = getInput(uv);
  return vec4(clamp(rgb, 0.0, 1.0) * original.a, original.a);
}`,
  }),
  videoEffect({
    type: "pixel-sort",
    label: "Pixel Sort",
    tags: ["stylize"],
    params: [
      degrees("direction", "Direction", -90),
      percent("reach", "Length", 0.3, { min: 0, max: 1 }),
      percent("thresholdLow", "Threshold Low", 0.35),
      percent("thresholdHigh", "Threshold High", 1),
      { kind: "boolean", key: "reverse", label: "Reverse", default: false },
    ],
    demo: { direction: 90, reach: 0.5, thresholdLow: 0.3 },
    glsl: `
// Sorting isn't possible per pixel, but within a run of pixels the result is known: its own colours, brightest
// first. So each pixel finds its run (the pixels in the threshold band along Direction, up to Length each way),
// takes 16 samples of it, and shows the one whose rank matches how far along the run it is.
vec2 toUV(vec2 s) { return vec2(s.x / ratio, s.y); }
float jitter;
bool banded(vec2 s) {
  vec2 q = toUV(s);
  if (!inside(q)) return false;
  vec4 c = getColor(q);
  float y = luma(c) / max(c.a, 1e-4) + jitter;
  return c.a > 0.01 && y >= thresholdLow && y <= thresholdHigh;
}
// How far the run goes from s along dir: coarse steps, then halving to the boundary.
float runLength(vec2 s, vec2 dir) {
  const int STEPS = 16;
  float stride = reach / float(STEPS);
  float lo = 0.0;
  float hi = -1.0;
  for (int i = 1; i <= STEPS; i++) {
    float d = float(i) * stride;
    if (!banded(s + dir * d)) { hi = d; break; }
    lo = d;
  }
  if (hi < 0.0) return reach;
  for (int i = 0; i < 5; i++) {
    float mid = 0.5 * (lo + hi);
    if (banded(s + dir * mid)) lo = mid; else hi = mid;
  }
  return lo;
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  vec2 dir = vec2(cos(radians(direction)), sin(radians(direction)));
  vec2 s = vec2(uv.x * ratio, uv.y);
  // Each line (across Direction) gets a slightly different threshold, so runs end raggedly, like real sorts.
  float line = floor(dot(s, vec2(-dir.y, dir.x)) * resolution.y);
  jitter = (hash(vec2(line, 7.3)) - 0.5) * 0.06;
  if (reach <= 0.0 || !banded(s)) return c;
  float back = runLength(s, -dir);
  float ahead = runLength(s, dir);
  float span = back + ahead;
  if (span * resolution.y < 1.5) return c;
  vec2 start = s - dir * back;
  const int N = 16;
  vec4 col[N];
  float key[N];
  for (int i = 0; i < N; i++) {
    col[i] = getColor(toUV(start + dir * span * (float(i) + 0.5) / float(N)));
    key[i] = (reverse > 0.5 ? -1.0 : 1.0) * luma(col[i]);
  }
  // Where this pixel falls among the ranks, between two of them.
  float f = clamp(back / span * float(N) - 0.5, 0.0, float(N - 1));
  int k = int(floor(f));
  int k2 = min(k + 1, N - 1);
  vec4 a = c;
  vec4 b = c;
  for (int i = 0; i < N; i++) {
    int rank = 0;
    for (int j = 0; j < N; j++) rank += (key[j] > key[i] || (key[j] == key[i] && j < i)) ? 1 : 0;
    if (rank == k) a = col[i];
    if (rank == k2) b = col[i];
  }
  return mix(a, b, f - float(k));
}`,
  }),
  videoEffect({
    type: "dither",
    label: "Dither",
    tags: ["stylize"],
    params: [
      { kind: "number", key: "levels", label: "Levels", default: 2, min: 2, max: 16, step: 1, decimals: 0, slider: true },
      percent("pixelSize", "Pixel Size", 0.003, { min: 0.001, max: 0.05, decimals: 1 }),
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "mono",
        options: [
          { value: "mono", label: "Mono" },
          { value: "color", label: "Color" },
        ],
      },
      {
        kind: "choice",
        key: "pattern",
        label: "Pattern",
        default: "bayer8",
        options: [
          { value: "bayer4", label: "Bayer 4×4" },
          { value: "bayer8", label: "Bayer 8×8" },
          { value: "noise", label: "Noise" },
        ],
      },
    ],
    demo: { pixelSize: 0.015, mode: "color" },
    glsl: `
// Ordered dither thresholds, 0..1 (recursive Bayer matrices).
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec4 effect(vec2 uv) {
  // Dither pixels a fraction of the height (at least a real pixel), each the average of its area.
  float size = max(pixelSize, 1.0 / resolution.y);
  vec2 cell = floor(vec2(uv.x * ratio, uv.y) / size);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (cell + 0.25 + 0.5 * vec2(i % 2, i / 2)) * size;
    sum += getColor(vec2(o.x / ratio, o.y));
  }
  vec4 c = sum / 4.0;
  float t = pattern == 0 ? bayer4(cell) + 0.5 / 16.0 : pattern == 1 ? bayer8(cell) + 0.5 / 64.0 : hash(cell);
  float n = max(1.0, floor(levels) - 1.0);
  vec3 rgb = unpremultiply(c);
  if (mode == 0) rgb = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));
  return withRgb(c, floor(rgb * n + t) / n);
}`,
  }),
  videoEffect({
    type: "ascii",
    label: "ASCII",
    tags: ["stylize"],
    params: [
      percent("cellSize", "Cell Size", 0.018, { min: 0.005, max: 0.1, decimals: 1 }),
      {
        kind: "choice",
        key: "palette",
        label: "Color",
        default: "original",
        options: [
          { value: "original", label: "Original Colors" },
          { value: "green", label: "Mono Green" },
          { value: "white", label: "White" },
        ],
      },
      percent("background", "Background", 0),
    ],
    demo: { cellSize: 0.075 },
    glsl: `
const int GLYPHS[${ASCII_ROWS.length}] = int[${ASCII_ROWS.length}](${ASCII_ROWS.join(", ")});
// Whether glyph pixel (col, row) of the character for brightness index g is lit; row 0 is the top.
float glyphBit(int g, vec2 at) {
  int col = int(at.x);
  int row = int(at.y);
  if (col < 0 || col > 4 || row < 0 || row > 6) return 0.0;
  return float((GLYPHS[g * 7 + row] >> (4 - col)) & 1);
}
vec4 effect(vec2 uv) {
  // Cells 6 x 8 glyph pixels (a 5 x 7 character and a gap), at least a pixel each.
  float h = max(cellSize, 8.0 / resolution.y);
  vec2 cellDim = vec2(h * 0.75, h);
  vec2 g = vec2(uv.x * ratio, 1.0 - uv.y) / cellDim;
  vec2 cell = floor(g);
  // The cell's colour: the average of four samples in it.
  vec4 avg = vec4(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (cell + 0.25 + 0.5 * vec2(i % 2, i / 2)) * cellDim;
    avg += getColor(vec2(o.x / ratio, 1.0 - o.y));
  }
  avg /= 4.0;
  vec3 rgb = unpremultiply(avg);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  int glyph = clamp(int(pow(clamp(y, 0.0, 1.0), 0.85) * ${ASCII_GLYPHS.length}.0), 0, ${ASCII_GLYPHS.length - 1});
  // 2 x 2 samples per pixel, so small characters stay smooth.
  float lit = 0.0;
  vec2 texel = 1.0 / (resolution.y * cellDim);
  for (int i = 0; i < 4; i++) {
    vec2 at = fract(g + (vec2(i % 2, i / 2) - 0.5) * 0.5 * texel);
    lit += glyphBit(glyph, floor(at * vec2(6.0, 8.0)));
  }
  lit /= 4.0;
  float hi = max(rgb.r, max(rgb.g, rgb.b));
  vec3 ink = palette == 0 ? rgb / max(hi, 0.35) : palette == 1 ? vec3(0.25, 1.0, 0.4) : vec3(1.0);
  vec4 c = getColor(uv);
  vec3 bg = unpremultiply(c) * background * 0.6;
  return withRgb(c, mix(bg, ink, lit));
}`,
  }),
  videoEffect({
    type: "glow-edges",
    label: "Neon Edges",
    tags: ["stylize"],
    params: [
      percent("edgeWidth", "Edge Width", 0.002, { min: 0, max: 0.01, decimals: 2 }),
      percent("glow", "Glow", 1, { max: 3 }),
      { kind: "color", key: "edgeColor", label: "Color", default: "#2ee6ff" },
      { kind: "boolean", key: "pictureColor", label: "Use Picture's Colors", default: false },
      percent("darken", "Darken Background", 0.75),
    ],
    demo: { edgeWidth: 0.006, glow: 1.6 },
    passes: 2,
    glsl: `
float edgeLuma(vec2 uv) { vec4 c = getColor(uv); return luma(c) + 0.3 * c.a; }
// Pass 0: the edges alone, coloured (premultiplied, so the glow can spread past a text's letters).
vec4 edges(vec2 uv) {
  vec2 px = vec2(max(edgeWidth, 1.0 / resolution.y));
  px.x /= ratio;
  float tl = edgeLuma(uv + px * vec2(-1.0, 1.0));
  float t = edgeLuma(uv + px * vec2(0.0, 1.0));
  float tr = edgeLuma(uv + px * vec2(1.0, 1.0));
  float l = edgeLuma(uv + px * vec2(-1.0, 0.0));
  float r = edgeLuma(uv + px * vec2(1.0, 0.0));
  float bl = edgeLuma(uv + px * vec2(-1.0, -1.0));
  float b = edgeLuma(uv + px * vec2(0.0, -1.0));
  float br = edgeLuma(uv + px * vec2(1.0, -1.0));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  float e = smoothstep(0.03, 0.15, length(vec2(gx, gy)) * 0.25);
  vec3 col = edgeColor;
  if (pictureColor > 0.5) {
    // The picture's colour at full brightness, a little more saturated.
    vec3 s = unpremultiply(getColor(uv));
    s /= max(max(s.r, max(s.g, s.b)), 0.05);
    col = clamp(mix(vec3(dot(s, vec3(0.2126, 0.7152, 0.0722))), s, 1.4), 0.0, 1.0);
  }
  return vec4(col * e, e);
}
vec4 effect(vec2 uv) {
  if (pass == 0) return edges(uv);
  vec4 e = getColor(uv);
  // Pass 1: a halo around the edges (a disc of samples), added over the darkened picture.
  vec4 halo = vec4(0.0);
  float total = 0.0;
  float reach = 0.01 + 3.0 * edgeWidth;
  for (int i = 0; i < 40; i++) {
    float r = sqrt((float(i) + 0.5) / 40.0);
    float a = float(i) * 2.39996;
    float w = exp(-3.0 * r * r);
    halo += getColor(uv + vec2(cos(a) / ratio, sin(a)) * r * reach) * w;
    total += w;
  }
  halo /= total;
  vec4 lit = clamp(e + halo * glow * 2.5, 0.0, 1.0);
  vec4 src = getInput(uv);
  vec3 base = src.rgb * (1.0 - darken);
  return vec4(base + lit.rgb - base * lit.rgb, src.a + lit.a - src.a * lit.a);
}`,
  }),
  videoEffect({
    type: "strobe",
    label: "Strobe Light",
    tags: ["stylize"],
    params: [
      { kind: "color", key: "strobeColor", label: "Strobe Color", default: "#ffffff" },
      percent("blend", "Blend With Original", 0),
      { kind: "number", key: "duration", label: "Strobe Duration", default: 0.05, min: 0.01, max: 5, unit: "s", step: 0.01, decimals: 2 },
      { kind: "number", key: "period", label: "Strobe Period", default: 0.5, min: 0.02, max: 10, unit: "s", step: 0.01, decimals: 2 },
      percent("probability", "Random Strobe Probability", 0),
      {
        kind: "choice",
        key: "strobeMode",
        label: "Strobe",
        default: "color",
        options: [
          { value: "color", label: "Operates on Color Only" },
          { value: "transparent", label: "Makes Layer Transparent" },
        ],
      },
    ],
    // Flashing at two of its card's three moments.
    demo: { duration: 0.2, blend: 0.15 },
    animated: true,
    glsl: `
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  // Every Period, for Duration; and at random other moments (a Duration long) with the Probability.
  float t = max(time, 0.0);
  bool on = mod(t, period) < min(duration, period);
  on = on || hash(vec2(floor(t / duration), 4.7)) < probability;
  if (!on) return c;
  if (strobeMode == 1) return c * blend;
  return withRgb(c, mix(strobeColor, unpremultiply(c), blend));
}`,
  }),
];
