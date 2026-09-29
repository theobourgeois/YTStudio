/** Wipes and shapes: a moving edge reveals the next clip. */
import type { NumberSpec } from "../params.ts";
import type { TransitionDefinition } from "../transitions.ts";

const softness = (value: number): NumberSpec => ({
  kind: "number",
  key: "softness",
  label: "Softness",
  default: value,
  min: 0,
  max: 0.5,
  scale: 100,
  unit: "%",
  step: 1,
  decimals: 0,
  slider: true,
});

const count = (key: string, label: string, value: number, max: number): NumberSpec => ({
  kind: "number",
  key,
  label,
  default: value,
  min: 2,
  max,
  step: 1,
  decimals: 0,
});

/*
 * Most of these build a mask the same way: every pixel gets a value `f`
 * (0 where the wipe starts, 1 where it ends) and the incoming clip shows
 * where `f` is below an edge that runs from 0 to 1 + softness, so the soft
 * band starts fully before the picture and ends fully past it.
 */

export const WIPES: TransitionDefinition[] = [
  {
    type: "wipe",
    label: "Wipe",
    tags: ["wipe"],
    duration: 0.6,
    params: [
      { kind: "number", key: "angle", label: "Angle", default: 0, min: 0, max: 360, unit: "°", step: 1, decimals: 0 },
      softness(0.05),
    ],
    glsl: `
// A straight edge crossing the canvas. Angle 0 goes left to right, 90 top to bottom.
vec4 transition(vec2 uv) {
  float a = radians(angle);
  vec2 v = vec2(cos(a), -sin(a));
  float e = 0.5 * (ratio * abs(v.x) + abs(v.y));
  float f = (dot(aspect(uv), v) + e) / (2.0 * e);
  float s = max(softness, 1e-4);
  float edge = ease(progress) * (1.0 + s);
  float m = 1.0 - smoothstep(edge - s, edge, f);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "clock-wipe",
    label: "Clock Wipe",
    tags: ["wipe"],
    duration: 0.8,
    params: [softness(0.02)],
    glsl: `
// A hand sweeping clockwise from 12 o'clock.
vec4 transition(vec2 uv) {
  vec2 q = aspect(uv);
  float f = length(q) < 1e-6 ? 0.0 : fract(atan(q.x, q.y) / (2.0 * PI));
  float s = max(softness, 1e-4);
  float edge = ease(progress) * (1.0 + s);
  float m = 1.0 - smoothstep(edge - s, edge, f);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "iris",
    label: "Iris",
    tags: ["wipe", "shape"],
    duration: 0.7,
    params: [
      {
        kind: "choice",
        key: "shape",
        label: "Shape",
        default: "round",
        options: [
          { value: "round", label: "Round" },
          { value: "diamond", label: "Diamond" },
          { value: "box", label: "Box" },
          { value: "star", label: "Star" },
          { value: "heart", label: "Heart" },
        ],
      },
      softness(0.03),
      { kind: "vec2", key: "center", label: "Center", default: [0.5, 0.5], space: "canvas", min: 0, max: 1, step: 1, decimals: 0 },
    ],
    glsl: `
// Each shape is a "gauge": the size the shape needs to be to reach a point
// (1 on the outline of the unit shape). The shape grows until it reaches
// every point of the canvas's outline, which covers the whole canvas.

// Outline radius of a 5-point star, tip up, at angle th from 12 o'clock.
float starRadius(float th) {
  float seg = 2.0 * PI / 5.0;
  float a = mod(th, seg);
  a = min(a, seg - a);
  vec2 p0 = vec2(1.0, 0.0);
  vec2 p1 = 0.5 * vec2(cos(seg * 0.5), sin(seg * 0.5));
  vec2 e = p1 - p0;
  vec2 u = vec2(cos(a), sin(a));
  return (p0.x * e.y - p0.y * e.x) / (u.x * e.y - u.y * e.x);
}
// Outline radius of the heart (x² + y² - 1)³ = x²y³ along the unit direction u.
float heartRadius(vec2 u) {
  float c = u.x * u.x * u.y * u.y * u.y;
  float lo = 0.0;
  float hi = 1.6;
  for (int i = 0; i < 14; i++) {
    float r = 0.5 * (lo + hi);
    float k = r * r - 1.0;
    if (k * k * k < c * r * r * r * r * r) lo = r; else hi = r;
  }
  return 0.5 * (lo + hi);
}
float gauge(vec2 q) {
  if (shape == 0) return length(q);
  if (shape == 1) return abs(q.x) + abs(q.y);
  if (shape == 2) return max(abs(q.x), abs(q.y));
  float l = length(q);
  if (l < 1e-6) return 0.0;
  vec2 u = q / l;
  if (shape == 3) return l / starRadius(atan(u.x, u.y));
  return l / heartRadius(u);
}
vec4 transition(vec2 uv) {
  vec2 c = toUv(center);
  vec2 k = vec2(ratio, 1.0);
  float cover = 0.0;
  for (int i = 0; i < 24; i++) {
    int side = i / 6;
    float f = float(i - side * 6) / 6.0;
    vec2 p = side == 0 ? vec2(f, 0.0) : side == 1 ? vec2(1.0, f) : side == 2 ? vec2(1.0 - f, 1.0) : vec2(0.0, 1.0 - f);
    cover = max(cover, gauge((p - c) * k));
  }
  float s = max(softness, 1e-4);
  float size = ease(progress) * (cover * 1.02 + s);
  float m = 1.0 - smoothstep(size - s, size, gauge((uv - c) * k));
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "blinds",
    label: "Blinds",
    tags: ["wipe"],
    duration: 0.7,
    params: [
      count("count", "Count", 8, 40),
      {
        kind: "choice",
        key: "orientation",
        label: "Orientation",
        default: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ],
      },
    ],
    glsl: `
// Venetian blinds: each slat opens out from its middle, one slightly after the other.
vec4 transition(vec2 uv) {
  float n = max(1.0, floor(count + 0.5));
  float x = (orientation == 0 ? 1.0 - uv.y : uv.x) * n;
  float i = min(floor(x), n - 1.0);
  float f = abs(x - i - 0.5) * 2.0;
  float lag = 0.5;
  float t = ease(progress * (1.0 + lag) - lag * i / max(n - 1.0, 1.0));
  float s = 0.06;
  float edge = t * (1.0 + s);
  float m = 1.0 - smoothstep(edge - s, edge, f);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "checker",
    label: "Checker Wipe",
    tags: ["wipe", "shape"],
    duration: 0.8,
    params: [count("count", "Rows", 8, 30)],
    glsl: `
// Square cells grow out of their centres: first one colour of the
// checkerboard, then the other, each pass sweeping from the top left.
vec4 transition(vec2 uv) {
  float n = max(1.0, floor(count + 0.5));
  vec2 q = aspect(uv) * n;
  vec2 cell = floor(q);
  vec2 c = q - cell - 0.5;
  vec2 cu = (cell + 0.5) / n / vec2(ratio, 1.0) + 0.5;
  float d = clamp((cu.x + 1.0 - cu.y) * 0.5, 0.0, 1.0);
  float start = mod(cell.x + cell.y, 2.0) * 0.5 + d * 0.18;
  float t = ease((progress - start) / 0.3);
  float aa = 0.04;
  float size = t * (0.5 + aa);
  float m = 1.0 - smoothstep(size - aa, size, max(abs(c.x), abs(c.y)));
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "dots",
    label: "Dots",
    tags: ["wipe", "shape", "stylize"],
    duration: 0.8,
    params: [count("count", "Rows", 10, 40)],
    glsl: `
// A grid of circles growing in a diagonal wave from the top left; each
// circle can grow past its own cell, so the neighbours are checked too.
vec4 transition(vec2 uv) {
  float n = max(1.0, floor(count + 0.5));
  vec2 q = aspect(uv) * n;
  vec2 base = floor(q);
  float aa = 0.04;
  float m = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      vec2 cu = (cell + 0.5) / n / vec2(ratio, 1.0) + 0.5;
      float d = clamp((cu.x + 1.0 - cu.y) * 0.5, 0.0, 1.0);
      float t = ease((progress - d * 0.5) / 0.45);
      float r = t * (0.7072 + aa);
      m = max(m, 1.0 - smoothstep(r - aa, r, length(q - cell - 0.5)));
    }
  }
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
  {
    type: "diagonal-stripes",
    label: "Diagonal Stripes",
    tags: ["wipe"],
    duration: 0.8,
    params: [count("count", "Stripes", 8, 30)],
    glsl: `
// Diagonal stripes wipe in along their length, alternately from each end,
// one after another.
vec4 transition(vec2 uv) {
  float n = max(1.0, floor(count + 0.5));
  vec2 q = aspect(uv);
  float e = 0.5 * (ratio + 1.0) * 0.70710678;
  float along = (dot(q, vec2(0.70710678, -0.70710678)) + e) / (2.0 * e);
  float across = (dot(q, vec2(0.70710678, 0.70710678)) + e) / (2.0 * e);
  float i = clamp(floor(across * n), 0.0, n - 1.0);
  float f = mod(i, 2.0) < 0.5 ? along : 1.0 - along;
  float t = ease((progress - 0.35 * i / max(n - 1.0, 1.0)) / 0.6);
  float s = 0.04;
  float edge = t * (1.0 + s);
  float m = 1.0 - smoothstep(edge - s, edge, f);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
  },
];
