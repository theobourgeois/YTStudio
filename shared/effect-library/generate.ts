/** Generators (After Effects' Generate category): noise, gradients, shapes and particles, drawn over (or instead of) the picture. Put them on a solid. */
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, ParamSpec, Vec2Spec } from "../params.ts";
import { degrees, percent, videoEffect } from "./common.ts";

/** How a generator's picture meets the clip's (AE's Blending Mode), in the order of `blendGenerated`'s indices. */
const BLEND_OPTIONS = [
  { value: "replace", label: "Replace" },
  { value: "over", label: "Over" },
  { value: "screen", label: "Screen" },
  { value: "add", label: "Add" },
  { value: "multiply", label: "Multiply" },
  { value: "overlay", label: "Overlay" },
  { value: "stencil", label: "Stencil Alpha" },
];

const blendMode = (fallback: string): ChoiceSpec => ({
  kind: "choice",
  key: "blendMode",
  label: "Blend Mode",
  default: fallback,
  options: BLEND_OPTIONS,
});

/** Blend Mode and Opacity, last in every generator. */
const blending = (fallback: string): ParamSpec[] => [blendMode(fallback), percent("opacity", "Opacity", 1)];

/** A point on the clip's frame. */
const point = (key: string, label: string, value: [number, number]): Vec2Spec => ({
  kind: "vec2",
  key,
  label,
  default: value,
  space: "media",
  min: -10,
  max: 10,
  step: 1,
  decimals: 1,
});

/**
 * Puts a generated picture `g` (premultiplied) on the clip's `base` by `blendMode`,
 * at `amount`: Replace is `g` alone (on a transparent solid, just the pattern),
 * Stencil Alpha is `g` cut to the clip's alpha (fills a text), and the others are
 * the W3C separable blend modes, so they also work over transparent parts.
 */
const BLEND_GLSL = `
vec3 blendChannels(int m, vec3 b, vec3 s) {
  if (m == 2) return b + s - b * s;
  if (m == 3) return min(b + s, 1.0);
  if (m == 4) return b * s;
  if (m == 5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  return s;
}
vec4 blendGenerated(vec4 g, vec4 base, float amount) {
  g *= clamp(amount, 0.0, 1.0);
  if (blendMode == 0) return g;
  if (blendMode == 6) return g * base.a;
  vec3 cs = g.a > 0.0 ? g.rgb / g.a : vec3(0.0);
  vec3 mixed = blendChannels(blendMode, unpremultiply(base), cs);
  return vec4(g.rgb * (1.0 - base.a) + base.rgb * (1.0 - g.a) + g.a * base.a * mixed, g.a + base.a * (1.0 - g.a));
}
/** A point parameter in square units around the frame's centre, like aspect(uv). */
vec2 pointAt(vec2 p) { return (toUv(p) - 0.5) * vec2(ratio, 1.0); }
`;

export const GENERATE_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "fractal-noise",
    label: "Fractal Noise",
    tags: ["generate"],
    params: [
      {
        kind: "choice",
        key: "fractalType",
        label: "Fractal Type",
        default: "basic",
        options: [
          { value: "basic", label: "Basic" },
          { value: "turbulent-smooth", label: "Turbulent Smooth" },
          { value: "turbulent-sharp", label: "Turbulent Sharp" },
          { value: "rocky", label: "Rocky" },
        ],
      },
      {
        kind: "choice",
        key: "noiseType",
        label: "Noise Type",
        default: "soft-linear",
        options: [
          { value: "block", label: "Block" },
          { value: "linear", label: "Linear" },
          { value: "soft-linear", label: "Soft Linear" },
          { value: "spline", label: "Spline" },
        ],
      },
      { kind: "boolean", key: "invert", label: "Invert", default: false },
      percent("contrast", "Contrast", 1, { max: 10 }),
      percent("brightness", "Brightness", 0, { min: -2, max: 2 }),
      percent("scale", "Scale", 1, { min: 0.1, max: 10 }),
      percent("stretch", "Stretch Width", 1, { min: 0.1, max: 10 }),
      degrees("rotation", "Rotation", 0),
      point("offset", "Offset Turbulence", [0.5, 0.5]),
      { kind: "number", key: "complexity", label: "Complexity", default: 6, min: 1, max: 10, step: 0.1, decimals: 1, slider: true },
      percent("subInfluence", "Sub Influence", 0.7),
      percent("subScaling", "Sub Scaling", 0.56, { min: 0.25, max: 0.9 }),
      degrees("evolution", "Evolution", 0, -36000, 36000),
      { kind: "number", key: "evolveSpeed", label: "Evolution Speed", default: 0, min: -3600, max: 3600, unit: "°/s", step: 1, decimals: 0 },
      {
        kind: "choice",
        key: "colorMode",
        label: "Color",
        default: "grayscale",
        options: [
          { value: "grayscale", label: "Grayscale" },
          { value: "gradient", label: "Two Colors" },
        ],
      },
      { kind: "color", key: "colorA", label: "Dark Color", default: "#10092e", disabledFor: (v) => v.colorMode !== "gradient" },
      { kind: "color", key: "colorB", label: "Light Color", default: "#ffb46b", disabledFor: (v) => v.colorMode !== "gradient" },
      ...blending("replace"),
    ],
    demo: { evolveSpeed: 120, colorMode: "gradient", contrast: 1.3 },
    animated: true,
    glsl: `${BLEND_GLSL}
float fnHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 fnHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// Evolution walks through 4 lattice cells per revolution and wraps round, so 360° comes back to the same noise
// and a keyframed or constantly turning Evolution loops smoothly.
const float LOOP = 4.0;
vec3 wrapped(vec3 i) { return vec3(i.xy, mod(i.z, LOOP)); }

// One octave, -1..1, interpolated between random lattice values as the Noise Type says (Spline is gradient noise).
float lattice(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  if (noiseType == 0) return fnHash(wrapped(i)) * 2.0 - 1.0;
  vec3 u = noiseType == 1 ? f : noiseType == 2 ? f * f * (3.0 - 2.0 * f) : f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  for (int c = 0; c < 8; c++) {
    vec3 o = vec3(c & 1, (c >> 1) & 1, (c >> 2) & 1);
    vec3 w = mix(1.0 - u, u, o);
    float v = noiseType == 3 ? dot(normalize(fnHash3(wrapped(i + o)) * 2.0 - 1.0 + 1e-4), f - o) * 2.2 : fnHash(wrapped(i + o)) * 2.0 - 1.0;
    n += v * w.x * w.y * w.z;
  }
  return clamp(n, -1.0, 1.0);
}

vec4 effect(vec2 uv) {
  vec2 p = aspect(uv) - pointAt(offset);
  p = rot(radians(rotation)) * p;
  p.x /= max(stretch, 0.01);
  // At 100% a lattice cell of the first octave is a fifth of the height.
  float cellSize = 0.2 * max(scale, 0.01);
  p /= cellSize;
  // Lattice cells per pixel, to fade out octaves too fine to show (they'd only shimmer).
  float fineness = 1.0 / (resolution.y * cellSize * min(stretch, 1.0));
  float z = (evolution + evolveSpeed * time) / 360.0 * LOOP;
  float octaves = clamp(complexity, 1.0, 10.0);
  float weight = 1.0;
  float sum = 0.0;
  float total = 0.0;
  float ridge = 1.0;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    // A fractional Complexity fades the last octave in.
    float w = weight * clamp(octaves - fi, 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.6, fineness));
    if (w <= 0.0) break;
    float n = lattice(vec3(p + fi * vec2(31.7, 17.3), z));
    float v;
    if (fractalType == 0) v = 0.5 + 0.5 * n;
    else if (fractalType == 1) v = n * n;
    else if (fractalType == 2) v = abs(n);
    else {
      // Ridged: bright crests where the noise crosses zero, each octave only where the last one was high.
      float r = 1.0 - abs(n);
      r *= r;
      v = r * ridge;
      ridge = clamp(r * 1.6, 0.0, 1.0);
    }
    sum += v * w;
    total += w;
    weight *= subInfluence;
    // Each octave finer, turned and shifted so their lattices never line up.
    p = rot(0.61) * p / subScaling + vec2(5.3, -9.1);
    fineness /= subScaling;
  }
  float mean = sum / max(total, 1e-4);
  // Spread each type's typical range over 0..1 (averaged octaves bunch up round their mean).
  float value;
  if (fractalType == 0) value = 0.5 + (mean - 0.5) * 2.2;
  else if (fractalType == 1) value = mean * 2.2;
  else if (fractalType == 2) value = mean * 1.5;
  else value = 0.5 + (mean - 0.45) * 1.5;
  if (invert > 0.5) value = 1.0 - value;
  float g = clamp((value - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0);
  vec3 rgb = colorMode == 1 ? mix(colorA, colorB, g) : vec3(g);
  return blendGenerated(vec4(rgb, 1.0), getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "gradient-ramp",
    label: "Gradient Ramp",
    tags: ["generate"],
    params: [
      point("rampStart", "Start of Ramp", [0.5, 0]),
      { kind: "color", key: "startColor", label: "Start Color", default: "#000000" },
      point("rampEnd", "End of Ramp", [0.5, 1]),
      { kind: "color", key: "endColor", label: "End Color", default: "#ffffff" },
      {
        kind: "choice",
        key: "rampShape",
        label: "Ramp Shape",
        default: "linear",
        options: [
          { value: "linear", label: "Linear Ramp" },
          { value: "radial", label: "Radial Ramp" },
        ],
      },
      percent("scatter", "Ramp Scatter", 0),
      percent("blendOriginal", "Blend With Original", 0),
      blendMode("replace"),
    ],
    demo: { startColor: "#27d3ff", endColor: "#ff2e88", rampStart: [0, 0], rampEnd: [1, 1] },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  vec2 a = pointAt(rampStart);
  vec2 ab = pointAt(rampEnd) - a;
  float len2 = max(dot(ab, ab), 1e-8);
  float t = rampShape == 1 ? length(p - a) / sqrt(len2) : dot(p - a, ab) / len2;
  // Scatter jitters where each pixel falls on the ramp (against banding, like AE's Ramp Scatter).
  float n = hash(floor(uv * resolution)) - 0.5;
  t = clamp(t + n * scatter * 0.2, 0.0, 1.0);
  // Half a level of dither always, so long ramps don't band.
  vec3 rgb = mix(startColor, endColor, t) + n / 255.0;
  return blendGenerated(vec4(clamp(rgb, 0.0, 1.0), 1.0), getColor(uv), 1.0 - blendOriginal);
}`,
  }),
  videoEffect({
    type: "four-color-gradient",
    label: "4-Color Gradient",
    tags: ["generate"],
    params: [
      point("point1", "Point 1", [0.1, 0.1]),
      { kind: "color", key: "color1", label: "Color 1", default: "#ffff00" },
      point("point2", "Point 2", [0.9, 0.1]),
      { kind: "color", key: "color2", label: "Color 2", default: "#00ffff" },
      point("point3", "Point 3", [0.1, 0.9]),
      { kind: "color", key: "color3", label: "Color 3", default: "#ff00ff" },
      point("point4", "Point 4", [0.9, 0.9]),
      { kind: "color", key: "color4", label: "Color 4", default: "#0000ff" },
      percent("softness", "Blend", 0.6),
      percent("jitter", "Jitter", 0),
      ...blending("replace"),
    ],
    demo: { blendMode: "overlay", opacity: 0.85 },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  // Inverse distance weighting: each colour pulls by 1 / distance^k, softer (a lower k) with more Blend.
  float k = mix(9.0, 1.2, clamp(softness, 0.0, 1.0));
  vec2 pts[4] = vec2[4](pointAt(point1), pointAt(point2), pointAt(point3), pointAt(point4));
  vec3 cols[4] = vec3[4](color1, color2, color3, color4);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = pow(max(length(p - pts[i]), 1e-4), -k);
    sum += cols[i] * w;
    total += w;
  }
  vec3 rgb = sum / total;
  float n = hash(floor(uv * resolution)) - 0.5;
  rgb += n * (jitter * 0.25 + 1.0 / 255.0);
  return blendGenerated(vec4(clamp(rgb, 0.0, 1.0), 1.0), getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "shape",
    label: "Shape",
    tags: ["generate"],
    params: [
      {
        kind: "choice",
        key: "shapeType",
        label: "Shape",
        default: "rectangle",
        options: [
          { value: "rectangle", label: "Rectangle" },
          { value: "ellipse", label: "Ellipse" },
          { value: "polygon", label: "Polygon" },
          { value: "star", label: "Star" },
        ],
      },
      point("centre", "Center", [0.5, 0.5]),
      percent("shapeWidth", "Width", 0.5, { max: 4 }),
      percent("shapeHeight", "Height", 0.5, { max: 4 }),
      percent("roundness", "Roundness", 0),
      {
        kind: "number",
        key: "sides",
        label: "Sides",
        default: 5,
        min: 3,
        max: 12,
        step: 1,
        decimals: 0,
        slider: true,
        labelFor: (v) => (v.shapeType === "star" ? "Points" : "Sides"),
        disabledFor: (v) => v.shapeType !== "polygon" && v.shapeType !== "star",
      },
      { ...percent("innerRadius", "Inner Radius", 0.45, { min: 0.05 }), disabledFor: (v) => v.shapeType !== "star" },
      degrees("rotation", "Rotation", 0),
      { kind: "color", key: "fillColor", label: "Fill Color", default: "#ffffff" },
      percent("fillOpacity", "Fill Opacity", 1),
      percent("strokeWidth", "Stroke Width", 0, { max: 0.2, decimals: 1 }),
      { kind: "color", key: "strokeColor", label: "Stroke Color", default: "#000000", disabledFor: (v) => !((v.strokeWidth as number) > 0) },
      percent("feather", "Feather", 0, { max: 0.5, decimals: 1 }),
      ...blending("over"),
    ],
    demo: { shapeType: "star", fillColor: "#ffd84a", strokeWidth: 0.04, strokeColor: "#1b1033", roundness: 0.15, shapeWidth: 0.8, shapeHeight: 0.8, rotation: 12 },
    glsl: `${BLEND_GLSL}
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// Near enough to the true distance at the edge, which is all the antialiasing and strokes need.
float sdEllipse(vec2 p, vec2 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(r.x, r.y);
}
// A star of outer radius 1 with n points (one straight up) and inner radius m; a polygon when m = cos(pi / n).
float sdStar(vec2 p, float n, float m) {
  float sector = 2.0 * PI / n;
  float a = abs(mod(atan(p.x, p.y) + sector * 0.5, sector) - sector * 0.5);
  vec2 q = length(p) * vec2(sin(a), cos(a));
  vec2 tip = vec2(0.0, 1.0);
  vec2 e = m * vec2(sin(sector * 0.5), cos(sector * 0.5)) - tip;
  vec2 w = q - tip;
  float d = length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
  return e.x * w.y - e.y * w.x < 0.0 ? -d : d;
}
float shapeDistance(vec2 p) {
  vec2 half_ = max(vec2(shapeWidth, shapeHeight) * 0.5, vec2(1e-4));
  float small = min(half_.x, half_.y);
  if (shapeType == 0) return sdRoundRect(p, half_, roundness * small);
  if (shapeType == 1) return sdEllipse(p, half_);
  float n = floor(sides + 0.5);
  float m = shapeType == 2 ? cos(PI / n) : innerRadius;
  // Rounded by drawing it smaller, then growing it by the roundness.
  float r = roundness * (shapeType == 2 ? 0.5 : 0.3) * m;
  return (sdStar(p / half_ / (1.0 - r), n, m) * (1.0 - r) - r) * small;
}
vec4 effect(vec2 uv) {
  // Positive Rotation turns it clockwise, like AE.
  vec2 p = rot(radians(rotation)) * (aspect(uv) - pointAt(centre));
  float d = shapeDistance(p);
  float px = 1.0 / resolution.y;
  float edge = 0.75 * px + feather * 0.25;
  float fillA = (1.0 - smoothstep(-edge, edge, d)) * fillOpacity;
  float sw = strokeWidth * 0.5;
  float strokeA = strokeWidth > 0.0 ? 1.0 - smoothstep(sw - edge, sw + edge, abs(d)) : 0.0;
  // The stroke is centred on the outline, over the fill.
  vec4 g = vec4(strokeColor, 1.0) * strokeA + vec4(fillColor, 1.0) * fillA * (1.0 - strokeA);
  return blendGenerated(g, getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "checkerboard",
    label: "Checkerboard",
    tags: ["generate"],
    params: [
      point("anchor", "Anchor", [0.5, 0.5]),
      percent("checkSize", "Size", 0.1, { min: 0.005, max: 1, decimals: 1 }),
      { kind: "color", key: "colorA", label: "Color", default: "#ffffff" },
      { kind: "color", key: "colorB", label: "Other Color", default: "#000000" },
      percent("feather", "Feather", 0),
      ...blending("replace"),
    ],
    demo: { checkSize: 0.2, blendMode: "overlay", opacity: 0.8 },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv) - pointAt(anchor);
  float size = max(checkSize, 1e-4);
  vec2 q = p / size;
  // Each axis's sign (+1 / -1 for alternate columns and rows), ramped to 0 over the edge so the corners blend.
  float edge = 0.75 / resolution.y + feather * size * 0.5;
  vec2 lineDistance = abs(fract(q + 0.5) - 0.5) * size;
  vec2 s = (1.0 - 2.0 * mod(floor(q), 2.0)) * clamp(lineDistance / edge, 0.0, 1.0);
  float t = 0.5 + 0.5 * s.x * s.y;
  return blendGenerated(vec4(mix(colorB, colorA, t), 1.0), getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "particles",
    label: "Particles",
    tags: ["generate"],
    params: [
      {
        kind: "choice",
        key: "particleType",
        label: "Type",
        default: "dust",
        options: [
          { value: "dust", label: "Dust" },
          { value: "snow", label: "Snow" },
          { value: "rain", label: "Rain" },
          { value: "sparks", label: "Sparks" },
          { value: "stars", label: "Stars" },
        ],
      },
      percent("density", "Density", 0.5),
      percent("particleSize", "Size", 1, { min: 0.1, max: 5 }),
      percent("speed", "Speed", 1, { max: 5 }),
      // Turns the way they go: snow and rain fall, sparks rise, dust and stars drift.
      degrees("direction", "Direction", 0),
      percent("spread", "Spread", 0.3),
      { kind: "color", key: "color", label: "Color", default: "#fff4e0" },
      percent("glow", "Glow", 0.4),
      { kind: "number", key: "seed", label: "Random Seed", default: 0, min: 0, max: 1000, step: 1, decimals: 0 },
      ...blending("over"),
    ],
    demo: { particleType: "sparks", density: 0.4, particleSize: 3, glow: 0.8 },
    animated: true,
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 p = aspect(uv);
  float px = 1.0 / resolution.y;
  // Per type: cell size (one particle at most per cell), speed (heights per second),
  // way (0 = up, clockwise), radius, and how much they flicker.
  float cell = 0.13;
  float vel = 0.03;
  float way = 1.2;
  float radius = 0.004;
  if (particleType == 1) { cell = 0.11; vel = 0.12; way = PI; radius = 0.006; }
  if (particleType == 2) { cell = 0.07; vel = 1.4; way = PI + 0.12; radius = 0.0012; }
  if (particleType == 3) { cell = 0.12; vel = 0.3; way = 0.0; radius = 0.0045; }
  if (particleType == 4) { cell = 0.06; vel = 0.006; way = 1.6; radius = 0.0022; }
  cell /= sqrt(0.2 + 1.6 * density);
  float presence = 0.35 + 0.65 * density;
  float a = way + radians(direction);
  vec2 dir = vec2(sin(a), cos(a));
  vec2 side = vec2(dir.y, -dir.x);
  vec3 light = vec3(0.0);
  float alpha = 0.0;
  // Four layers, nearest first: farther ones are smaller, dimmer and slower (parallax).
  for (int layer = 0; layer < 4; layer++) {
    float fl = float(layer);
    float depth = 1.0 - fl * 0.2;
    float c = cell * depth;
    // Particles sit still in a frame sliding along their way, so any time can be drawn directly.
    vec2 q = p - dir * vel * speed * depth * time + vec2(fl * 7.31 + seed * 0.713, fl * 3.17 - seed * 0.291);
    vec2 base = floor(q / c);
    for (int j = 0; j < 9; j++) {
      vec2 id = base + vec2(j % 3 - 1, j / 3 - 1);
      vec2 key = id + vec2(fl * 101.0, seed * 1.37);
      float h0 = hash(key);
      // Sparks live and die: every life is in a new place.
      float life = 0.0;
      float cycle = 0.0;
      if (particleType == 3) {
        float lived = time * speed * mix(0.5, 0.9, h0) + h0 * 7.0;
        life = fract(lived);
        cycle = floor(lived);
      }
      vec2 h = hash2(key + cycle * 17.17);
      if (hash(key + cycle * 5.3 + 9.7) > presence) continue;
      float h1 = hash(key * 1.31 + 4.1 + cycle);
      // Sideways sway, up to a third of a cell.
      float sway = spread * 0.3 * c * sin(time * mix(0.6, 1.7, h1) * (particleType == 1 ? 2.0 : 1.0) + h0 * 6.2832);
      vec2 centre = (id + 0.2 + 0.6 * h) * c + side * sway;
      vec2 d = q - centre;
      float r = radius * particleSize * depth * mix(0.55, 1.35, h1);
      float bright = mix(0.35, 1.0, depth) * mix(0.55, 1.0, h.x);
      float dist;
      if (particleType == 2 || particleType == 3) {
        // Streaks along the way they go (motion blur), their heads brightest.
        float len = particleType == 2 ? 0.07 * depth * sqrt(max(speed, 0.05)) : 0.022 * depth * (0.5 + speed);
        vec2 tilt = normalize(dir + side * (h0 - 0.5) * spread);
        float t = clamp(dot(d, tilt) / len + 1.0, 0.0, 1.0);
        dist = length(d - tilt * (t - 1.0) * len);
        bright *= mix(0.15, 1.0, t);
        if (particleType == 2) bright *= 0.55;
        else bright *= 1.6 * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life)) * (0.75 + 0.25 * sin(time * 40.0 + h0 * 60.0));
      } else {
        dist = length(d);
      }
      if (particleType == 0 || particleType == 4) bright *= 0.55 + 0.45 * sin(time * mix(1.2, 4.0, h.y) + h1 * 6.2832);
      // At least a pixel wide; smaller ones dim instead of vanishing.
      float re = max(r, 0.7 * px);
      bright *= min(1.0, (r * r) / (re * re));
      float soft = particleType == 1 ? re * 0.6 * depth : 0.0;
      float core = 1.0 - smoothstep(re - 0.75 * px - soft, re + 0.75 * px, dist);
      float halo = glow * 0.35 * exp(-dist / (re * 3.0 + px));
      float shine = core + halo;
      if (particleType == 4 && h1 > 0.75) {
        // The brightest stars glint in a cross.
        vec2 g = abs(d) / px;
        shine += glow * (exp(-g.x) * exp(-g.y * px / (re * 5.0)) + exp(-g.y) * exp(-g.x * px / (re * 5.0)));
      }
      vec3 tint = color;
      // Sparks cool from white hot to an ember of their colour.
      if (particleType == 3) tint = mix(color * vec3(1.0, 0.45, 0.15), vec3(1.0, 0.95, 0.85), 1.0 - life);
      light += tint * shine * bright;
      alpha += shine * bright;
    }
  }
  return blendGenerated(vec4(min(light, 1.0), min(alpha, 1.0)), getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "cell-pattern",
    label: "Cell Pattern",
    tags: ["generate"],
    params: [
      {
        kind: "choice",
        key: "cellType",
        label: "Cell Pattern",
        default: "bubbles",
        options: [
          { value: "bubbles", label: "Bubbles" },
          { value: "crystals", label: "Crystals" },
          { value: "plates", label: "Plates" },
        ],
      },
      { kind: "boolean", key: "invert", label: "Invert", default: false },
      percent("contrast", "Contrast", 1, { max: 5 }),
      percent("cellSize", "Size", 0.12, { min: 0.01, max: 1, decimals: 1 }),
      point("offset", "Offset", [0.5, 0.5]),
      degrees("evolution", "Evolution", 0, -36000, 36000),
      ...blending("replace"),
    ],
    demo: { cellType: "plates", cellSize: 0.22, blendMode: "multiply", evolution: 40 },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 p = (aspect(uv) - pointAt(offset)) / max(cellSize, 1e-4);
  float evo = radians(evolution);
  vec2 cellOf = floor(p);
  float f1 = 9.0;
  float f2 = 9.0;
  float v1 = 0.0;
  float v2 = 0.0;
  for (int j = 0; j < 9; j++) {
    vec2 id = cellOf + vec2(j % 3 - 1, j / 3 - 1);
    vec2 h = hash2(id);
    // Each cell's point circles its cell, once per revolution of Evolution (either way round).
    float turn = evo * (h.y > 0.5 ? 1.0 : -1.0) + h.x * 6.2832;
    vec2 pt = id + 0.5 + 0.35 * vec2(cos(turn), sin(turn));
    float d = length(p - pt);
    float v = hash(id + 13.7);
    if (d < f1) { f2 = f1; v2 = v1; f1 = d; v1 = v; }
    else if (d < f2) { f2 = d; v2 = v; }
  }
  // f2 - f1 is about twice the distance to the nearest border.
  float border = (f2 - f1) * 0.5 * cellSize;
  float px = 1.0 / resolution.y;
  float value;
  if (cellType == 0) value = 1.0 - smoothstep(0.0, 1.0, f1 * 1.15);
  else if (cellType == 1) value = mix((v1 + v2) * 0.5, v1, smoothstep(0.0, 1.5 * px, border));
  else value = smoothstep(0.035 * cellSize, 0.035 * cellSize + 1.5 * px, border) * mix(0.75, 1.0, v1);
  if (invert > 0.5) value = 1.0 - value;
  float g = clamp((value - 0.5) * contrast + 0.5, 0.0, 1.0);
  return blendGenerated(vec4(vec3(g), 1.0), getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "radio-waves",
    label: "Radio Waves",
    tags: ["generate"],
    params: [
      point("producer", "Producer Point", [0.5, 0.5]),
      {
        kind: "choice",
        key: "waveShape",
        label: "Shape",
        default: "circle",
        options: [
          { value: "circle", label: "Circle" },
          { value: "square", label: "Square" },
          { value: "diamond", label: "Diamond" },
        ],
      },
      { kind: "number", key: "frequency", label: "Frequency", default: 1, min: 0.05, max: 20, unit: "/s", step: 0.1, decimals: 1 },
      percent("expansion", "Expansion", 0.3, { min: 0.01, max: 5 }),
      { kind: "number", key: "lifespan", label: "Lifespan", default: 2, min: 0.1, max: 30, unit: "s", step: 0.1, decimals: 1 },
      percent("strokeWidth", "Stroke Width", 0.012, { min: 0.001, max: 0.2, decimals: 1 }),
      percent("softness", "Softness", 0.2),
      { kind: "color", key: "color", label: "Color", default: "#ffffff" },
      ...blending("over"),
    ],
    demo: { frequency: 2, expansion: 0.5, strokeWidth: 0.03, producer: [0.3, 0.35] },
    animated: true,
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  vec2 d = aspect(uv) - pointAt(producer);
  float r = waveShape == 0 ? length(d) : waveShape == 1 ? max(abs(d.x), abs(d.y)) : (abs(d.x) + abs(d.y)) * 0.7071;
  float f = max(frequency, 0.01);
  float grow = max(expansion, 1e-4);
  // A wave leaves every 1 / Frequency seconds (and always has, so the first frame already has waves);
  // the ones that can be near this pixel left about r / Expansion seconds ago.
  float k0 = floor((time - r / grow) * f);
  float w = strokeWidth * 0.5;
  float edge = 0.75 / resolution.y + softness * w;
  float a = 0.0;
  for (int i = -1; i <= 2; i++) {
    float age = time - (k0 + float(i)) / f;
    if (age < 0.0 || age > lifespan) continue;
    float ring = 1.0 - smoothstep(w - edge, w + edge, abs(r - age * grow));
    float fade = 1.0 - smoothstep(0.3, 1.0, age / lifespan);
    a = a + ring * fade * (1.0 - a);
  }
  return blendGenerated(vec4(color, 1.0) * a, getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "venetian-lines",
    label: "Lines",
    tags: ["generate"],
    params: [
      degrees("angle", "Angle", 0),
      percent("spacing", "Spacing", 0.08, { min: 0.005, max: 1, decimals: 1 }),
      percent("lineWidth", "Width", 0.5),
      percent("softness", "Softness", 0),
      { kind: "number", key: "lineOffset", label: "Offset", default: 0, min: -1000, max: 1000, scale: 100, unit: "%", step: 1, decimals: 0 },
      { kind: "number", key: "scrollSpeed", label: "Scroll Speed", default: 0, min: -50, max: 50, unit: "/s", step: 0.1, decimals: 1 },
      { kind: "color", key: "color", label: "Color", default: "#ffffff" },
      ...blending("over"),
    ],
    demo: { angle: 30, spacing: 0.15, lineWidth: 0.35, scrollSpeed: 0.8, softness: 0.3, opacity: 0.7 },
    animated: true,
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  float a = radians(angle);
  // Across the lines: 0° draws them level, and turning them is clockwise.
  float across = dot(aspect(uv), vec2(sin(a), cos(a)));
  float period = max(spacing, 1e-4);
  // Offset and Scroll Speed are in lines (spacings), so a whole number lines up again.
  float phase = across / period + lineOffset + scrollSpeed * time;
  float fromMiddle = abs(fract(phase) - 0.5) * period;
  float halfWidth = lineWidth * period * 0.5;
  float edge = 0.75 / resolution.y + softness * period * 0.25;
  float cover = lineWidth >= 1.0 ? 1.0 : lineWidth <= 0.0 ? 0.0 : 1.0 - smoothstep(halfWidth - edge, halfWidth + edge, fromMiddle);
  return blendGenerated(vec4(color, 1.0) * cover, getColor(uv), opacity);
}`,
  }),
  videoEffect({
    type: "beam",
    label: "Beam",
    tags: ["generate"],
    params: [
      point("startPoint", "Starting Point", [0.15, 0.7]),
      point("endPoint", "Ending Point", [0.85, 0.3]),
      // The drawn part, sliding from the start to the end as Time goes from 0 to 100% (keyframe it for laser shots).
      percent("beamLength", "Length", 0.25),
      percent("beamTime", "Time", 0),
      percent("startThickness", "Starting Thickness", 0.01, { max: 0.3, decimals: 1 }),
      percent("endThickness", "Ending Thickness", 0.01, { max: 0.3, decimals: 1 }),
      percent("softness", "Softness", 0.6),
      { kind: "color", key: "insideColor", label: "Inside Color", default: "#ffffff" },
      { kind: "color", key: "outsideColor", label: "Outside Color", default: "#3f8cff" },
      percent("glow", "Glow", 0.5, { max: 2 }),
      ...blending("over"),
    ],
    demo: { beamLength: 0.8, beamTime: 0.4, startThickness: 0.03, endThickness: 0.09, outsideColor: "#29e0ff", glow: 1.5 },
    glsl: `${BLEND_GLSL}
vec4 effect(vec2 uv) {
  float len = clamp(beamLength, 0.0, 1.0);
  if (len <= 0.0) return blendGenerated(vec4(0.0), getColor(uv), opacity);
  vec2 p = aspect(uv);
  vec2 from = pointAt(startPoint);
  vec2 to = pointAt(endPoint);
  float tail = clamp(beamTime, 0.0, 1.0) * (1.0 - len);
  vec2 a = mix(from, to, tail);
  vec2 ab = mix(from, to, tail + len) - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
  float dist = length(p - a - ab * h);
  float px = 1.0 / resolution.y;
  // Half the thickness where this pixel is along the whole beam.
  float th = max(mix(startThickness, endThickness, tail + len * h) * 0.5, 0.5 * px);
  float body = 1.0 - smoothstep(th * (1.0 - softness) - 0.75 * px, th + 0.75 * px, dist);
  vec3 col = mix(insideColor, outsideColor, smoothstep(0.15, 0.9, dist / th));
  float halo = glow * 0.6 * exp(-2.5 * dist / th) * (1.0 - body);
  vec4 g = vec4(col * body + outsideColor * halo, body + halo);
  return blendGenerated(g, getColor(uv), opacity);
}`,
  }),
];
