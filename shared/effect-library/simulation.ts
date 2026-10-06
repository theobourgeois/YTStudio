/**
 * Simulations (V8, see `EffectShader.simulation`): effects that carry their picture from frame to frame,
 * vaudio's feedback stage and its camera modes. Their rates are per second (a frame's step is
 * `rate * simStep`), so they look the same at any frame rate, and what they show at a frame is the same
 * however it's reached: the export draws every frame in order, the preview replays from a checkpoint.
 * Fed by video they're exact while playing and in the export, and close just after a seek.
 */
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, ParamSpec } from "../params.ts";
import type { AudioRequest } from "../compositor.ts";
import type { ParamValues } from "../types.ts";
import { degrees, percent, videoEffect } from "./common.ts";

const num = (v: ParamValues, key: string, fallback = 0) => {
  const n = Number(v[key]);
  return Number.isFinite(n) ? n : fallback;
};

/** Seconds for a trail to fall to 10%: how long anything it remembers lasts (to 1/255: log10(255) times as long). */
const trailMemory = (length: number) => Math.max(0.05, length) * Math.log10(255) + 0.05;

const seconds = (key: string, label: string, value: number, max: number): ParamSpec => ({
  kind: "number",
  key,
  label,
  default: value,
  min: 0.02,
  max,
  unit: " s",
  step: 0.01,
  decimals: 2,
  slider: true,
});

const HUE_GLSL = `
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float co = cos(a);
  float si = sin(a);
  return c * co + cross(k, c) * si + k * dot(k, c) * (1.0 - co);
}
`;

const HITS: ChoiceSpec = {
  kind: "choice",
  key: "hits",
  label: "Hits",
  default: "kicks",
  options: [
    { value: "any", label: "Any" },
    { value: "kicks", label: "Kicks" },
    { value: "snares", label: "Snares and notes" },
    { value: "hats", label: "Hats" },
  ],
};
const ONSETS = { any: "onset", kicks: "onsetLow", snares: "onsetMid", hats: "onsetHigh" } as const;
const hitsRequest = (v: ParamValues): AudioRequest => ({
  rows: 1,
  span: 0,
  fall: 0,
  window: 0,
  hits: ONSETS[(v.hits as keyof typeof ONSETS) ?? "kicks"] ?? "onsetLow",
});

export const SIMULATION_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "feedback",
    label: "Feedback",
    tags: ["time", "stylize"],
    params: [
      percent("amount", "Amount", 1),
      // vaudio's Trails: how long the echo takes to fall to a tenth.
      seconds("trailLength", "Trail Length", 0.5, 5),
      { kind: "number", key: "zoom", label: "Zoom", default: 1.4, min: 0.25, max: 4, scale: 100, unit: "%/s", step: 1, decimals: 0 },
      { kind: "number", key: "rotation", label: "Rotation", default: 20, min: -360, max: 360, unit: "°/s", step: 1, decimals: 0 },
      { kind: "number", key: "hueShift", label: "Hue Shift", default: 0, min: -720, max: 720, unit: "°/s", step: 1, decimals: 0 },
      { kind: "vec2", key: "drift", label: "Drift", default: [0, 0], space: "media", min: -2, max: 2, step: 1, decimals: 1 },
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        // vaudio's: bright things leave ghosts.
        default: "lighten",
        options: [
          { value: "lighten", label: "Lighten" },
          { value: "screen", label: "Screen" },
          { value: "add", label: "Add" },
        ],
      },
    ],
    demo: { trailLength: 1.2, zoom: 1.6, rotation: 40, hueShift: 120 },
    animated: true,
    simulation: { memory: (v) => trailMemory(num(v, "trailLength", 0.5)) },
    glsl: `${HUE_GLSL}
vec4 effect(vec2 uv) {
  vec4 now = getColor(uv);
  if (!hasState || amount <= 0.0) return now;
  // Last frame's picture, zoomed, turned and moved by this frame's share of a second.
  vec2 p = aspect(uv - drift * vec2(1.0, -1.0) * simStep);
  p = rot(radians(rotation) * simStep) * p / pow(max(zoom, 1e-3), simStep);
  vec4 prev = getState(p / vec2(ratio, 1.0) + 0.5);
  prev.rgb = clamp(hueRotate(prev.rgb, radians(hueShift) * simStep), 0.0, prev.a);
  vec4 echo = prev * pow(0.1, simStep / max(trailLength, 1e-3));
  // What's faded below a level's step is gone, so a trail ends (and a seek replays only so far back).
  echo *= step(vec4(1.0 / 255.0), echo);
  vec4 fed = mode == 0 ? max(now, echo) : mode == 1 ? now + echo - now * echo : min(now + echo, vec4(1.0));
  return mix(now, fed, amount);
}`,
  }),
  videoEffect({
    type: "motion-trace",
    label: "Motion Trace",
    tags: ["time", "stylize"],
    params: [
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "difference",
        options: [
          { value: "difference", label: "Difference" },
          { value: "silhouette", label: "Silhouette" },
          { value: "edges", label: "Edges" },
        ],
      },
      percent("threshold", "Threshold", 0.08),
      { kind: "number", key: "gain", label: "Gain", default: 4, min: 0.5, max: 12, step: 0.1, decimals: 1, slider: true },
      seconds("trailLength", "Trail Length", 0.4, 4),
      { kind: "color", key: "color", label: "Color", default: "#4cf2ff" },
    ],
    demo: { threshold: 0.03, gain: 6 },
    // What moved since the last frame, held as a trail that fades.
    history: { reach: (_v, fps) => 1 / fps },
    simulation: { memory: (v) => trailMemory(num(v, "trailLength", 0.4)) },
    glsl: `
float diffAt(vec2 uv) {
  vec4 a = getColor(uv);
  vec4 b = getFrameAgo(1.0 / fps, uv);
  return (abs(a.r - b.r) + abs(a.g - b.g) + abs(a.b - b.b)) / 3.0;
}
float traceAt(vec2 uv, float decay) {
  float moved = max(0.0, diffAt(uv) - threshold) * gain;
  return min(1.0, max(moved, getState(uv).a * decay));
}
vec4 effect(vec2 uv) {
  float decay = pow(0.1, simStep / max(trailLength, 1e-3));
  float v = traceAt(uv, decay);
  if (v < 1.0 / 255.0) v = 0.0;
  if (mode == 1) v = v > 0.1 ? 1.0 : 0.0;
  if (mode == 2) {
    vec2 px = 1.0 / resolution;
    v = min(1.0, abs(v - traceAt(uv - vec2(px.x, 0.0), decay)) * 2.0 + abs(v - traceAt(uv + vec2(0.0, px.y), decay)) * 2.0 + v * 0.15);
  }
  // The trace in its colour on nothing (its alpha is the trace, which the next frame reads back): put the
  // clip under it again, or blend it, to see both.
  return vec4(color * v, v);
}`,
  }),
  videoEffect({
    type: "freeze",
    label: "Freeze",
    tags: ["time", "glitch"],
    params: [
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "hits",
        options: [
          { value: "hold", label: "Hold" },
          { value: "hits", label: "Update on hits" },
          { value: "blocks", label: "Blocks on hits" },
        ],
      },
      // Hold: keyframe it on to freeze what's showing then.
      { kind: "boolean", key: "hold", label: "Hold", default: false },
      { kind: "source", key: "source", label: "Listens To", default: "master" },
      HITS,
      percent("blockSize", "Block Size", 0.08, { min: 0.01, max: 0.5, decimals: 1 }),
      percent("chance", "Chance", 0.35),
    ],
    audio: { request: hitsRequest },
    simulation: {},
    glsl: `
vec4 effect(vec2 uv) {
  vec4 now = getColor(uv);
  if (!hasState) return now;
  // A hit during this frame.
  bool hit = hitAge[0] < simStep;
  if (mode == 0) return hold > 0.5 ? getState(uv) : now;
  if (mode == 1) return hit ? now : getState(uv);
  // Blocks: on each hit, some blocks take the new picture and the rest stay as they were.
  vec2 cell = vec2(blockSize / ratio, blockSize);
  vec2 block = floor(uv / cell);
  bool fresh = hit && hash(block + vec2(beatCount * 7.31, float(simFrame) * 0.013)) < chance;
  return fresh ? now : getState(uv);
}`,
  }),
  videoEffect({
    type: "slit-scan",
    label: "Slit-Scan",
    tags: ["time", "distort"],
    params: [
      { kind: "number", key: "span", label: "Span", default: 0.6, min: 0.05, max: 1.5, unit: " s", step: 0.01, decimals: 2, slider: true },
      { kind: "number", key: "ribbons", label: "Ribbons", default: 10, min: 2, max: 24, step: 1, decimals: 0, slider: true },
      { kind: "number", key: "bend", label: "Bend", default: 1.2, min: 0, max: 3, step: 0.05, decimals: 2, slider: true },
      percent("split", "Color Split", 0.15),
      degrees("angle", "Angle", 0, -180, 180),
    ],
    // vaudio's: wavy ribbons, each a moment further back, red and blue a step either side.
    history: { reach: (v) => num(v, "span", 0.6) * 1.2 },
    glsl: `
float ageAt(vec2 uv) {
  vec2 p = rot(radians(angle)) * (uv - 0.5) + 0.5;
  float wave = sin(p.y * PI * (2.0 + ribbons * 0.32) + p.x * 5.0) * bend;
  float ribbon = floor((1.0 - p.x) * ribbons + wave);
  return clamp(ribbon / max(1.0, ribbons - 1.0), 0.0, 1.0) * span;
}
vec4 effect(vec2 uv) {
  float age = ageAt(uv);
  float reach = historyReach() + 0.5 / fps;
  float gap = split * span * 0.2;
  vec4 g = getFrameAgo(min(age, reach), uv);
  vec4 r = getFrameAgo(min(age + gap, reach), uv);
  vec4 b = getFrameAgo(min(max(age - gap, 0.0), reach), uv);
  return vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
}`,
  }),
  videoEffect({
    type: "echo-grid",
    label: "Echo Grid",
    tags: ["time", "stylize"],
    params: [
      { kind: "number", key: "columns", label: "Columns", default: 3, min: 2, max: 6, step: 1, decimals: 0, slider: true },
      { kind: "number", key: "span", label: "Span", default: 0.8, min: 0.05, max: 1.5, unit: " s", step: 0.01, decimals: 2, slider: true },
      percent("border", "Border", 0.02, { max: 0.1, decimals: 1 }),
      { kind: "boolean", key: "flip", label: "Mirror Alternate Tiles", default: true },
      percent("tint", "Age Tint", 0.5),
    ],
    // vaudio's: a grid of the picture, each tile further back, in a snake from the top left.
    history: { reach: (v) => num(v, "span", 0.8) },
    glsl: `
vec4 effect(vec2 uv) {
  float cols = floor(columns + 0.5);
  float rows = max(2.0, floor(cols / ratio + 0.5));
  vec2 cell = vec2(uv.x * cols, (1.0 - uv.y) * rows);
  vec2 at = floor(cell);
  vec2 inCell = fract(cell);
  // Borders: the newest frame, darkened.
  vec2 edge = min(inCell, 1.0 - inCell) / vec2(1.0 / cols, 1.0 / rows);
  if (min(edge.x * ratio, edge.y) < border) return getColor(uv) * vec4(0.1, 0.1, 0.14, 1.0);
  float row = at.y;
  float col = mod(row, 2.0) < 0.5 ? at.x : cols - 1.0 - at.x;
  float tile = row * cols + col;
  float n = cols * rows;
  float a = tile / max(1.0, n - 1.0);
  float age = min(a * span, historyReach() + 0.5 / fps);
  vec2 p = vec2(inCell.x, 1.0 - inCell.y);
  if (flip > 0.5 && mod(at.x + at.y, 2.0) > 0.5) p.x = 1.0 - p.x;
  vec4 c = getFrameAgo(age, p);
  c.rgb *= mix(vec3(1.0), vec3(1.0 - 0.16 * a, 1.0 - 0.08 * a, 1.0 + 0.14 * a), tint);
  return vec4(min(c.rgb, vec3(c.a)), c.a);
}`,
  }),
];
