/**
 * Time effects, like After Effects' Time category and the plugins edits lean on
 * (ReelSmart Motion Blur, datamosh): they read the clip's picture at earlier
 * moments (`getFrameAgo`), their own output a frame ago (`getFeedback`) and how
 * the picture moved since the last frame (`getFlow`, optical flow). Earlier
 * frames exist while the video plays and in the export (which draws every
 * frame in order); paused, the preview shows the frame as it is.
 */
import type { EffectDefinition } from "../effects.ts";
import type { ParamValues } from "../types.ts";
import { degrees, percent, videoEffect } from "./common.ts";

const num = (v: ParamValues, key: string) => Number(v[key] ?? 0);

export const TIME_EFFECTS: EffectDefinition[] = [
  videoEffect({
    type: "echo",
    label: "Echo",
    tags: ["time"],
    params: [
      // After Effects' sign: negative looks back.
      { kind: "number", key: "echoTime", label: "Echo Time", default: -0.033, min: -1, max: 1, unit: " s", step: 0.001, decimals: 3 },
      { kind: "number", key: "echoes", label: "Number of Echoes", default: 4, min: 1, max: 24, step: 1, decimals: 0, slider: true },
      percent("startingIntensity", "Starting Intensity", 0.6),
      percent("decay", "Decay", 0.5),
      {
        kind: "choice",
        key: "operator",
        label: "Echo Operator",
        // After Effects' default; Composite in Back suits a layer with transparency (a cut-out, text).
        default: "add",
        options: [
          { value: "add", label: "Add" },
          { value: "maximum", label: "Maximum" },
          { value: "minimum", label: "Minimum" },
          { value: "screen", label: "Screen" },
          { value: "composite-back", label: "Composite in Back" },
          { value: "composite-front", label: "Composite in Front" },
          { value: "blend", label: "Blend" },
        ],
      },
    ],
    demo: { echoTime: -0.066, echoes: 5, startingIntensity: 1, decay: 0.6, operator: "maximum" },
    history: { reach: (v) => Math.abs(num(v, "echoTime")) * num(v, "echoes") },
    glsl: `
vec4 combine(vec4 acc, vec4 e, float n) {
  if (operator == 0) return min(acc + e, vec4(1.0));
  if (operator == 1) return max(acc, e);
  if (operator == 2) return min(acc, e);
  if (operator == 3) return acc + e - acc * e;
  if (operator == 4) return acc + e * (1.0 - acc.a);
  if (operator == 5) return e + acc * (1.0 - e.a);
  return acc + (e - acc) / n;
}
vec4 effect(vec2 uv) {
  vec4 now = getColor(uv);
  float step = abs(echoTime);
  float reach = historyReach();
  if (step <= 0.0 || reach <= 0.0) return now;
  vec4 acc = now * startingIntensity;
  for (int i = 1; i <= 24; i++) {
    if (float(i) > echoes) break;
    float ago = step * float(i);
    // Only echoes of moments that were drawn (paused, there are none).
    if (ago > reach + 0.5 / fps) break;
    vec4 e = getFrameAgo(ago, uv) * startingIntensity * pow(decay, float(i));
    acc = combine(acc, e, float(i) + 1.0);
  }
  return acc;
}`,
  }),
  videoEffect({
    type: "posterize-time",
    label: "Posterize Time",
    tags: ["time"],
    params: [{ kind: "number", key: "frameRate", label: "Frame Rate", default: 12, min: 1, max: 60, unit: " fps", step: 1, decimals: 0, slider: true }],
    history: { reach: (v) => 1 / Math.max(1, num(v, "frameRate")) },
    glsl: `
vec4 effect(vec2 uv) {
  // Holds each frame until the next tick of the slower rate: a choppy, stop-motion look.
  float ago = time - floor(time * frameRate + 1e-4) / frameRate;
  return ago <= historyReach() + 0.5 / fps ? getFrameAgo(ago, uv) : getColor(uv);
}`,
  }),
  videoEffect({
    type: "time-displacement",
    label: "Time Displacement",
    tags: ["time", "distort"],
    params: [
      { kind: "number", key: "maxDisplacement", label: "Max Displacement Time", default: 0.4, min: 0, max: 1.5, unit: " s", step: 0.01, decimals: 2 },
      {
        kind: "choice",
        key: "map",
        label: "Displacement Map",
        default: "horizontal",
        options: [
          { value: "luma", label: "Luminance" },
          { value: "horizontal", label: "Horizontal (Slit-Scan)" },
          { value: "vertical", label: "Vertical" },
          { value: "radial", label: "Radial" },
        ],
      },
      { kind: "boolean", key: "invert", label: "Invert", default: false },
    ],
    history: { reach: (v) => num(v, "maxDisplacement") },
    glsl: `
vec4 effect(vec2 uv) {
  // Each part of the picture from its own moment: bright parts (or one side, or the middle) lag behind.
  float m = map == 0 ? luma(getColor(uv)) : map == 1 ? uv.x : map == 2 ? 1.0 - uv.y : clamp(length(aspect(uv)) * 1.6, 0.0, 1.0);
  if (invert > 0.5) m = 1.0 - m;
  float ago = m * maxDisplacement;
  return ago <= historyReach() + 0.5 / fps ? getFrameAgo(ago, uv) : getColor(uv);
}`,
  }),
  videoEffect({
    type: "frame-blend",
    label: "Frame Blend",
    tags: ["time", "blur"],
    params: [
      { kind: "number", key: "frames", label: "Frames", default: 3, min: 2, max: 12, step: 1, decimals: 0, slider: true },
      percent("amount", "Amount", 1),
    ],
    history: { reach: (v, fps) => (num(v, "frames") - 1) / fps },
    glsl: `
vec4 effect(vec2 uv) {
  // CC Force Motion Blur's cheap cousin: an average of the last few frames (a ghostly smear).
  vec4 now = getColor(uv);
  vec4 sum = now;
  float n = 1.0;
  for (int i = 1; i < 12; i++) {
    if (float(i) >= frames) break;
    float ago = float(i) / fps;
    if (ago > historyReach() + 0.5 / fps) break;
    sum += getFrameAgo(ago, uv);
    n += 1.0;
  }
  return mix(now, sum / n, amount);
}`,
  }),
  videoEffect({
    type: "trails",
    label: "Trails",
    tags: ["time", "stylize"],
    params: [
      percent("decay", "Trail Length", 0.85, { max: 0.99 }),
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "lighten",
        options: [
          { value: "lighten", label: "Lighten" },
          { value: "screen", label: "Screen" },
          { value: "add", label: "Add" },
          { value: "behind", label: "Behind" },
        ],
      },
      // Each frame's trail is scaled, turned and moved a little: tunnels and spirals.
      percent("zoom", "Zoom Per Frame", 1, { min: 0.8, max: 1.2, decimals: 1 }),
      degrees("spin", "Spin Per Frame", 0, -20, 20),
      { kind: "vec2", key: "drift", label: "Drift Per Frame", default: [0, 0], space: "media", min: -0.2, max: 0.2, step: 1, decimals: 1 },
      { kind: "color", key: "tint", label: "Tint", default: "#ffffff" },
    ],
    demo: { decay: 0.9, zoom: 1.03, spin: 3 },
    history: { reach: (_v, fps) => 1 / fps, feedback: true },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 now = getColor(uv);
  // Last frame's output, pushed along by this frame's zoom, spin and drift.
  vec2 p = aspect(uv - drift * vec2(1.0, -1.0));
  p = rot(radians(spin)) * p / max(zoom, 1e-3);
  vec4 trail = getFeedback(p / vec2(ratio, 1.0) + 0.5) * decay;
  trail.rgb *= tint;
  if (mode == 0) return max(now, trail);
  if (mode == 1) return now + trail - now * trail;
  if (mode == 2) return min(now + trail, vec4(1.0));
  return now + trail * (1.0 - now.a);
}`,
  }),
  videoEffect({
    type: "pixel-motion-blur",
    label: "Pixel Motion Blur",
    tags: ["time", "blur"],
    params: [
      { kind: "number", key: "shutterAngle", label: "Shutter Angle", default: 180, min: 0, max: 720, unit: "°", step: 5, decimals: 0 },
      percent("minimumMotion", "Ignore Motion Under", 0.001, { max: 0.02, decimals: 1 }),
    ],
    history: { reach: (_v, fps) => 1.5 / fps, flow: true },
    glsl: `
vec4 effect(vec2 uv) {
  // ReelSmart Motion Blur: each pixel smeared along how it moved (optical flow), over the shutter.
  vec2 v = getFlow(uv) * (shutterAngle / 360.0);
  if (length(v * vec2(ratio, 1.0)) < minimumMotion) return getColor(uv);
  vec4 sum = vec4(0.0);
  const int N = 24;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N) - 0.5;
    sum += getColor(uv + v * f);
  }
  return sum / float(N);
}`,
  }),
  videoEffect({
    type: "datamosh",
    label: "Datamosh",
    tags: ["time", "glitch"],
    params: [
      // Keyframe it up at a cut: the new shot's motion drags the old one's pixels (a "bloom").
      percent("amount", "Amount", 0.9),
      percent("blockSize", "Block Size", 0.02, { min: 0.002, max: 0.1, decimals: 1 }),
      percent("refresh", "Refresh", 0.02, { max: 0.3, decimals: 1 }),
    ],
    history: { reach: (_v, fps) => 1.5 / fps, feedback: true, flow: true },
    glsl: `
vec4 effect(vec2 uv) {
  vec4 now = getColor(uv);
  if (!hasFeedback || amount <= 0.0) return now;
  // Like a video missing its key frames: the last picture keeps being moved by the new motion,
  // one compression block at a time.
  vec2 cell = vec2(blockSize / ratio, blockSize);
  vec2 block = (floor(uv / cell) + 0.5) * cell;
  vec2 v = getFlow(block);
  vec4 moshed = getFeedback(uv - v);
  // A few blocks refresh each frame, so the new shot creeps through.
  float fresh = step(1.0 - refresh, hash(floor(uv / cell) + floor(time * fps) * 17.13));
  return mix(moshed, now, max(fresh, 1.0 - amount));
}`,
  }),
];
