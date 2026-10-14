/**
 * Visualizers (the Audio category, docs/visualizer/README.md): effects that draw what a sound does,
 * read at their clip's moment from its files' signals (`EffectShader.audio`): spectrum bars, a line, a
 * circle, an oscilloscope, a vectorscope, a spectrogram, bursts on hits, a waveform ring and a meter;
 * and effects for any clip that move it with the sound. Each listens to its `source` (the mix by
 * default). Put the drawing ones on a solid with Blend Mode Replace (New item › Visualizer does) to get
 * the visualizer alone over what's below, or Over to draw it on the clip.
 */
import type { AudioRequest } from "../compositor.ts";
import type { EffectDefinition } from "../effects.ts";
import type { ChoiceSpec, ColorSpec, NumberSpec, ParamSpec, SourceSpec } from "../params.ts";
import type { ParamValues } from "../types.ts";
import { BLEND_GLSL, blending, degrees, percent, point, videoEffect } from "./common.ts";

const source: SourceSpec = { kind: "source", key: "source", label: "Listens To", default: "master" };

const number = (key: string, label: string, value: number, min: number, max: number, opts: Partial<NumberSpec> = {}): NumberSpec => ({
  kind: "number",
  key,
  label,
  default: value,
  min,
  max,
  step: opts.step ?? 1,
  decimals: opts.decimals ?? 0,
  ...opts,
});
const hz = (key: string, label: string, value: number) => number(key, label, value, 20, 20_000, { unit: "Hz", step: 10 });
const seconds = (key: string, label: string, value: number, max = 2) => number(key, label, value, 0, max, { scale: 1000, unit: "ms", step: 10, slider: true });
const colour = (key: string, label: string, value: string): ColorSpec => ({ kind: "color", key, label, default: value });
const toggle = (key: string, label: string, value: boolean): ParamSpec => ({ kind: "boolean", key, label, default: value });
const boost = number("boost", "Boost", 1, 0.25, 4, { step: 0.05, decimals: 2, slider: true });
/** How big it is, as fractions of the frame's width and height. */
const size = (w: number, h: number): ParamSpec[] => [percent("width", "Width", w, { max: 2 }), percent("height", "Height", h, { max: 2 })];

const HITS: ChoiceSpec = {
  kind: "choice",
  key: "hits",
  label: "Hits",
  default: "any",
  options: [
    { value: "any", label: "Any" },
    { value: "kicks", label: "Kicks" },
    { value: "snares", label: "Snares and notes" },
    { value: "hats", label: "Hats" },
  ],
};
const ONSETS = { any: "onset", kicks: "onsetLow", snares: "onsetMid", hats: "onsetHigh" } as const;
const hitsOf = (values: ParamValues) => ONSETS[(values.hits as keyof typeof ONSETS) ?? "any"] ?? "onset";

/** What drives an effect for any clip: a level of the sound, or the beat. */
const DRIVE: ChoiceSpec = {
  kind: "choice",
  key: "drive",
  label: "Follows",
  default: "bass",
  options: [
    { value: "level", label: "Level" },
    { value: "bass", label: "Bass" },
    { value: "mid", label: "Mids" },
    { value: "high", label: "Highs" },
    { value: "beat", label: "The beat" },
  ],
};

const request = (r: Partial<AudioRequest>): AudioRequest => ({ rows: 1, span: 0, fall: 0, window: 0, ...r });

/** Square units (the frame's height is 1), the frame's centre at 0; and anti-aliased coverage of a distance. */
const AUDIO_GLSL = `
float hzX(float hz) { return log(max(hz, 20.0) / 20.0) / log(1000.0); }
vec2 sq(vec2 uv) { return vec2((uv.x - 0.5) * ratio, uv.y - 0.5); }
vec2 sqPoint(vec2 p) { vec2 q = toUv(p); return vec2((q.x - 0.5) * ratio, q.y - 0.5); }
float cover(float d) { float w = max(fwidth(d), 1e-5); return clamp(0.5 - d / w, 0.0, 1.0); }
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec4 paint(vec3 rgb, float a) { return vec4(rgb * a, a); }
vec4 over(vec4 top, vec4 under) { return top + under * (1.0 - top.a); }
float driveOf(int d) {
  if (d == 0) return audioLevel;
  if (d == 1) return audioBass;
  if (d == 2) return audioMid;
  if (d == 3) return audioHigh;
  return exp(-sinceBeat / 0.18);
}
`;

/** vaudio's visualizers: colours turned round the hue circle (degrees), and coverage of a distance at a pixel's width (inside loops, where `fwidth` can't be trusted). */
const VAUDIO_GLSL = `
vec3 hueTurn(vec3 c, float degrees) {
  const vec3 k = vec3(0.57735);
  float a = radians(degrees);
  return c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
}
float soft(float d) { float w = 1.5 / max(resolution.y, 1.0); return clamp(0.5 - d / w, 0.0, 1.0); }
`;

/** A visualizer's GLSL: the helpers, and for those that draw (a Blend Mode), `blendGenerated`. */
const audio = (shader: string, draws = true) => (draws ? BLEND_GLSL : "") + AUDIO_GLSL + shader;

/** A visualizer: its card plays (on made-up sound), as it moves by itself. */
const visualizer = (def: Parameters<typeof videoEffect>[0]) => videoEffect({ animated: true, ...def });

export const AUDIO_EFFECTS: EffectDefinition[] = [
  visualizer({
    type: "audio-bars",
    label: "Spectrum Bars",
    tags: ["audio", "generate"],
    params: [
      source,
      number("bars", "Bars", 48, 4, 128, { slider: true }),
      hz("lowHz", "From", 40),
      hz("highHz", "To", 12_000),
      point("center", "Baseline", [0.5, 0.72]),
      ...size(0.85, 0.32),
      percent("gap", "Gap", 0.3, { max: 0.9 }),
      boost,
      seconds("fall", "Fall", 0.18),
      toggle("mirror", "Mirror", false),
      toggle("rounded", "Rounded", true),
      toggle("peaks", "Peaks", true),
      colour("color", "Colour", "#33d6ff"),
      colour("color2", "Top Colour", "#ff4fd8"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ rows: v.peaks ? 16 : 1, span: 0.6, fall: v.fall as number }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv);
  vec2 c = sqPoint(center);
  float W = width * ratio;
  float raw = (p.x - c.x) / W + 0.5;
  // Outside the box draws nothing (masked, not returned early: \`cover\` needs its neighbours' derivatives).
  float inBox = step(0.0, raw) * step(raw, 1.0);
  float lx = clamp(raw, 0.0, 1.0);
  float n = max(1.0, floor(bars));
  float i = min(floor(lx * n), n - 1.0);
  float f = lx * n - i;
  float x = mix(hzX(lowHz), hzX(highHz), (i + 0.5) / n);
  float half_ = mirror > 0.5 ? 0.5 : 1.0;
  float H = height * half_;
  float yy = p.y - c.y;
  if (mirror > 0.5) yy = abs(yy);
  float v = clamp(spectrum(x) * boost, 0.0, 1.0);
  float top = max(v * H, 0.004);
  float barW = W / n;
  float halfW = barW * (0.5 - gap * 0.5);
  float r = rounded > 0.5 ? min(halfW, top * 0.5) : 0.0;
  float d = box(vec2((f - 0.5) * barW, yy - top * 0.5), vec2(halfW, top * 0.5), r);
  vec3 rgb = mix(color, color2, clamp(yy / max(H, 1e-4), 0.0, 1.0));
  vec4 g = paint(rgb, cover(d) * inBox);
  if (peaks > 0.5) {
    float most = v;
    for (int k = 1; k < 8; k++) most = max(most, clamp(spectrumAgo(x, float(k) * 0.08) * boost, 0.0, 1.0) - float(k) * 0.03);
    float py = max(most * H, top) + 0.006;
    float dp = box(vec2((f - 0.5) * barW, yy - py), vec2(halfW, 0.0035), 0.0);
    g = over(paint(color2, cover(dp) * inBox), g);
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-line",
    label: "Line Spectrum",
    tags: ["audio", "generate"],
    params: [
      source,
      hz("lowHz", "From", 30),
      hz("highHz", "To", 14_000),
      point("center", "Baseline", [0.5, 0.65]),
      ...size(0.9, 0.3),
      boost,
      seconds("fall", "Fall", 0.12),
      number("thickness", "Thickness", 0.006, 0.001, 0.05, { scale: 1000, unit: "‰", step: 1, slider: true }),
      percent("fill", "Fill", 0.35),
      toggle("mirror", "Mirror", true),
      colour("color", "Colour", "#ffffff"),
      colour("color2", "Fill Colour", "#7c5cff"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ fall: v.fall as number }) },
    glsl: audio(`
float level(float lx) { return clamp(spectrum(mix(hzX(lowHz), hzX(highHz), clamp(lx, 0.0, 1.0))) * boost, 0.0, 1.0); }
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv);
  vec2 c = sqPoint(center);
  float W = width * ratio;
  float raw = (p.x - c.x) / W + 0.5;
  float inBox = step(0.0, raw) * step(raw, 1.0);
  float lx = clamp(raw, 0.0, 1.0);
  float H = height * (mirror > 0.5 ? 0.5 : 1.0);
  float yy = p.y - c.y;
  if (mirror > 0.5) yy = abs(yy);
  float v = level(lx) * H;
  float e = 0.002;
  float slope = (level(lx + e) - level(lx - e)) * H / (2.0 * e * W);
  float d = abs(yy - v) / sqrt(1.0 + slope * slope) - thickness * 0.5;
  float under = yy >= 0.0 ? cover(yy - v) * fill * (0.35 + 0.65 * clamp(yy / max(v, 1e-4), 0.0, 1.0)) : 0.0;
  vec4 g = over(paint(color, cover(d) * inBox), paint(color2, under * inBox));
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-circle",
    label: "Circular Spectrum",
    tags: ["audio", "generate"],
    params: [
      source,
      number("bars", "Bars", 96, 8, 256, { slider: true }),
      hz("lowHz", "From", 40),
      hz("highHz", "To", 10_000),
      point("center", "Center", [0.5, 0.5]),
      percent("radius", "Radius", 0.16, { max: 1 }),
      percent("barLength", "Length", 0.16, { max: 1 }),
      percent("gap", "Gap", 0.35, { max: 0.9 }),
      boost,
      seconds("fall", "Fall", 0.15),
      degrees("rotation", "Rotation", 0),
      number("spin", "Spin", 0, -360, 360, { unit: "°/s", step: 1, decimals: 0 }),
      toggle("mirror", "Mirror", true),
      percent("pulse", "Pulse on the Bass", 0.15),
      colour("color", "Colour", "#ffd166"),
      colour("color2", "Loud Colour", "#ff3d6e"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ fall: v.fall as number }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 d = sq(uv) - sqPoint(center);
  float r = length(d);
  // From straight down, so a mirrored circle has its lows at the bottom and highs at the top.
  float a = atan(d.x, -d.y) - radians(rotation + spin * time);
  float t = fract(a / (2.0 * PI));
  if (mirror > 0.5) t = 1.0 - abs(2.0 * t - 1.0);
  float n = max(1.0, floor(bars));
  float i = min(floor(t * n), n - 1.0);
  float f = t * n - i;
  float v = clamp(spectrum(mix(hzX(lowHz), hzX(highHz), (i + 0.5) / n)) * boost, 0.0, 1.0);
  float R = radius * (1.0 + pulse * audioBass);
  float L = max(v * barLength, 0.004);
  // Radians a bar takes (a mirrored circle has its bars twice, half each side).
  float span = (mirror > 0.5 ? PI : 2.0 * PI) / n;
  float dist = box(vec2((f - 0.5) * span * r, r - R - L * 0.5), vec2(span * R * (0.5 - gap * 0.5), L * 0.5), 0.0);
  vec4 g = paint(mix(color, color2, v), cover(dist));
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-oscilloscope",
    label: "Oscilloscope",
    tags: ["audio", "generate"],
    params: [
      source,
      number("window", "Window", 0.03, 0.005, 0.25, { scale: 1000, unit: "ms", step: 1, slider: true }),
      {
        kind: "choice",
        key: "channel",
        label: "Channel",
        default: "both",
        options: [
          { value: "both", label: "Left + Right" },
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
      },
      point("center", "Center", [0.5, 0.5]),
      ...size(0.9, 0.3),
      number("gain", "Gain", 1.5, 0.25, 8, { step: 0.05, decimals: 2, slider: true }),
      number("thickness", "Thickness", 0.005, 0.001, 0.05, { scale: 1000, unit: "‰", step: 1, slider: true }),
      percent("glow", "Glow", 0.5),
      colour("color", "Colour", "#5cff9d"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ window: v.window as number }) },
    glsl: audio(`
float sampleAt(float x) { vec2 s = wave(x); return channel == 0 ? (s.x + s.y) * 0.5 : channel == 1 ? s.x : s.y; }
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv);
  vec2 c = sqPoint(center);
  float W = width * ratio;
  float raw = (p.x - c.x) / W + 0.5;
  float inBox = step(0.0, raw) * step(raw, 1.0);
  float lx = clamp(raw, 0.0, 1.0);
  float H = height * 0.5;
  float v = clamp(sampleAt(lx) * gain, -1.0, 1.0) * H;
  float e = 0.002;
  float slope = (sampleAt(lx + e) - sampleAt(lx - e)) * gain * H / (2.0 * e * W);
  float d = abs(p.y - c.y - v) / sqrt(1.0 + slope * slope) - thickness * 0.5;
  float a = max(cover(d), glow * 0.6 * exp(-max(d, 0.0) / (thickness * 3.0 + 1e-4))) * inBox;
  return blendGenerated(paint(color, clamp(a, 0.0, 1.0)), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-vectorscope",
    label: "Vectorscope",
    tags: ["audio", "generate"],
    params: [
      source,
      number("window", "Window", 0.05, 0.01, 0.25, { scale: 1000, unit: "ms", step: 1, slider: true }),
      point("center", "Center", [0.5, 0.5]),
      percent("scale", "Size", 0.3, { max: 1 }),
      number("gain", "Gain", 1.5, 0.25, 8, { step: 0.05, decimals: 2, slider: true }),
      number("thickness", "Thickness", 0.004, 0.001, 0.03, { scale: 1000, unit: "‰", step: 1, slider: true }),
      percent("glow", "Glow", 0.5),
      colour("color", "Colour", "#a0e7ff"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ window: v.window as number }) },
    glsl: audio(`
vec2 lissajous(float x) { vec2 s = clamp(wave(x) * gain, -1.0, 1.0); return vec2(s.x - s.y, s.x + s.y) * 0.7071 * scale; }
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  if (max(abs(p.x), abs(p.y)) > scale * 1.6) return blendGenerated(vec4(0.0), base, opacity);
  float best = 1e9;
  vec2 a = lissajous(0.0);
  for (int i = 1; i < 160; i++) {
    vec2 b = lissajous(float(i) / 159.0);
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    best = min(best, length(p - a - ab * h));
    a = b;
  }
  float d = best - thickness * 0.5;
  float alpha = max(cover(d), glow * 0.6 * exp(-max(d, 0.0) / (thickness * 3.0 + 1e-4)));
  return blendGenerated(paint(color, clamp(alpha, 0.0, 1.0)), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-spectrogram",
    label: "Spectrogram",
    tags: ["audio", "generate"],
    params: [
      source,
      hz("lowHz", "From", 30),
      hz("highHz", "To", 16_000),
      number("history", "History", 3, 0.5, 10, { unit: "s", step: 0.1, decimals: 1, slider: true }),
      {
        kind: "choice",
        key: "direction",
        label: "Time Goes",
        default: "up",
        options: [
          { value: "up", label: "Up (a waterfall)" },
          { value: "left", label: "Left" },
        ],
      },
      point("center", "Center", [0.5, 0.5]),
      ...size(1, 1),
      boost,
      number("contrast", "Contrast", 1.6, 0.5, 4, { step: 0.05, decimals: 2, slider: true }),
      colour("color", "Quiet Colour", "#2a1b6b"),
      colour("color2", "Loud Colour", "#ffe36e"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ rows: 64, span: v.history as number }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  vec2 l = vec2(p.x / (width * ratio), p.y / height) + 0.5;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThan(l, vec2(1.0)))) return blendGenerated(vec4(0.0), base, opacity);
  float freq = direction == 0 ? l.x : l.y;
  float ago = (direction == 0 ? l.y : 1.0 - l.x) * history;
  float v = clamp(spectrumAgo(mix(hzX(lowHz), hzX(highHz), freq), ago) * boost, 0.0, 1.0);
  float a = pow(v, contrast);
  return blendGenerated(paint(mix(color, color2, a), a), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-burst",
    label: "Hit Burst",
    tags: ["audio", "generate"],
    params: [
      source,
      HITS,
      point("center", "Center", [0.5, 0.5]),
      number("count", "Particles", 28, 4, 64, { slider: true }),
      percent("spread", "Spread", 0.45, { max: 2 }),
      number("life", "Life", 0.9, 0.1, 3, { unit: "s", step: 0.05, decimals: 2, slider: true }),
      number("particleSize", "Size", 0.008, 0.001, 0.05, { scale: 1000, unit: "‰", step: 1, slider: true }),
      percent("gravity", "Gravity", 0.2, { max: 2 }),
      colour("color", "Colour", "#ffffff"),
      colour("color2", "Fading Colour", "#ff7a3d"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ hits: hitsOf(v) }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  vec4 g = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    float age = hitAge[k];
    if (age > life) continue;
    // Seeded by when the hit was, so its particles keep their paths as newer hits come.
    float born = floor((clipTime - age) * 1000.0 + 0.5);
    float fade = 1.0 - age / life;
    float strength = 0.4 + 0.6 * hitVelocity[k];
    for (int j = 0; j < 64; j++) {
      if (float(j) >= count) break;
      vec2 h = hash2(vec2(born * 0.013 + float(j) * 1.7, float(j) * 3.1 + born * 0.007));
      float angle = h.x * 2.0 * PI;
      float speed = spread * (0.35 + 0.65 * h.y) * strength;
      // Flung out fast, slowing, falling.
      vec2 at = vec2(sin(angle), cos(angle)) * speed * (1.0 - exp(-age * 3.0)) - vec2(0.0, gravity * age * age);
      float d = length(p - at) - particleSize * (0.4 + 0.6 * fade) * strength;
      float a = cover(d) * fade;
      g = over(paint(mix(color2, color, fade), a), g);
    }
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-ring",
    label: "Waveform Ring",
    tags: ["audio", "generate"],
    params: [
      source,
      number("window", "Window", 0.04, 0.005, 0.25, { scale: 1000, unit: "ms", step: 1, slider: true }),
      point("center", "Center", [0.5, 0.5]),
      percent("radius", "Radius", 0.2, { max: 1 }),
      percent("amplitude", "Amplitude", 0.08, { max: 0.5 }),
      number("thickness", "Thickness", 0.006, 0.001, 0.05, { scale: 1000, unit: "‰", step: 1, slider: true }),
      percent("pulse", "Pulse on the Bass", 0.15),
      percent("glow", "Glow", 0.4),
      degrees("rotation", "Rotation", 0),
      colour("color", "Colour", "#ff5cf0"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ window: v.window as number }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 d = sq(uv) - sqPoint(center);
  float r = length(d);
  float t = fract((atan(d.x, d.y) - radians(rotation)) / (2.0 * PI));
  // Read forwards then back, so the ring closes without a seam.
  float x = 1.0 - abs(2.0 * t - 1.0);
  vec2 s = wave(x);
  float R = radius * (1.0 + pulse * audioBass) + clamp((s.x + s.y) * 0.5, -1.0, 1.0) * amplitude;
  float dist = abs(r - R) - thickness * 0.5;
  float a = max(cover(dist), glow * 0.6 * exp(-max(dist, 0.0) / (thickness * 3.0 + 1e-4)));
  return blendGenerated(paint(color, clamp(a, 0.0, 1.0)), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-meter",
    label: "Level Meter",
    tags: ["audio", "generate"],
    params: [
      source,
      { ...DRIVE, default: "level", options: DRIVE.options.filter((o) => o.value !== "beat") },
      point("center", "Center", [0.5, 0.5]),
      ...size(0.04, 0.5),
      number("segments", "Segments", 24, 4, 64, { slider: true }),
      percent("gap", "Gap", 0.25, { max: 0.9 }),
      seconds("fall", "Fall", 0.3),
      colour("color", "Colour", "#3ddc84"),
      colour("color2", "Hot Colour", "#ffcf3d"),
      colour("color3", "Peak Colour", "#ff3d3d"),
      ...blending("over"),
    ],
    audio: { request: (v) => request({ fall: v.fall as number }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  vec2 l = vec2(p.x / (width * ratio), p.y / height) + 0.5;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThan(l, vec2(1.0)))) return blendGenerated(vec4(0.0), base, opacity);
  float v = clamp(driveOf(drive), 0.0, 1.0);
  float n = max(1.0, floor(segments));
  float i = floor(l.y * n);
  float f = fract(l.y * n);
  float lit = step((i + 0.5) / n, v);
  float pos = (i + 0.5) / n;
  vec3 rgb = pos < 0.6 ? color : pos < 0.85 ? color2 : color3;
  float segment = step(gap * 0.5, f) * step(f, 1.0 - gap * 0.5);
  float a = segment * mix(0.12, 1.0, lit);
  return blendGenerated(paint(rgb, a), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-displace",
    label: "Audio Displacement",
    tags: ["audio", "distort"],
    params: [
      source,
      DRIVE,
      percent("amount", "Amount", 0.35, { max: 2 }),
      number("scale", "Scale", 3, 0.5, 20, { step: 0.1, decimals: 1, slider: true }),
      number("speed", "Speed", 0.6, 0, 5, { step: 0.05, decimals: 2, slider: true }),
      percent("pump", "Pump", 0.25, { max: 1 }),
    ],
    audio: { request: () => request({ fall: 0.12 }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  float v = clamp(driveOf(drive), 0.0, 1.0);
  vec2 q = aspect(uv) * scale;
  vec2 n = vec2(fbm(q + time * speed), fbm(q + vec2(7.3, 1.9) - time * speed)) - 0.5;
  vec2 moved = uv + n * amount * v * 0.12;
  moved = 0.5 + (moved - 0.5) / (1.0 + pump * v * 0.15);
  return getColor(moved);
}
`, false),
  }),
  visualizer({
    type: "audio-strobe",
    label: "Strobe on Hits",
    tags: ["audio", "stylize"],
    params: [
      source,
      HITS,
      {
        kind: "choice",
        key: "mode",
        label: "Mode",
        default: "flash",
        options: [
          { value: "flash", label: "Flash" },
          { value: "invert", label: "Invert" },
          { value: "black", label: "Black Out" },
        ],
      },
      percent("amount", "Amount", 0.8),
      seconds("decay", "Decay", 0.12, 1),
      colour("color", "Flash Colour", "#ffffff"),
    ],
    audio: { request: (v) => request({ hits: hitsOf(v) }) },
    glsl: audio(`
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float f = 0.0;
  for (int k = 0; k < 8; k++) {
    if (hitAge[k] > decay * 8.0 + 0.001) continue;
    f = max(f, hitVelocity[k] * exp(-hitAge[k] / max(decay, 0.001)));
  }
  f = clamp(f * amount, 0.0, 1.0);
  vec3 rgb = unpremultiply(c);
  if (mode == 0) rgb = mix(rgb, color, f);
  else if (mode == 1) rgb = mix(rgb, 1.0 - rgb, f);
  else rgb = mix(rgb, vec3(0.0), f);
  return withRgb(c, rgb);
}
`, false),
  }),
  visualizer({
    type: "audio-hue",
    label: "Hue Orbit",
    tags: ["audio", "color"],
    params: [source, { ...DRIVE, default: "beat" }, degrees("amount", "Hue Shift", 90, -360, 360), percent("saturation", "Saturate", 0.3, { max: 2 })],
    audio: { request: () => request({ fall: 0.1 }) },
    glsl: audio(`
vec3 hueShift(vec3 rgb, float a) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYiq * rgb;
  yiq.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * yiq.yz;
  return toRgb * yiq;
}
vec4 effect(vec2 uv) {
  vec4 c = getColor(uv);
  float v = clamp(driveOf(drive), 0.0, 1.0);
  vec3 rgb = hueShift(unpremultiply(c), radians(amount) * v);
  float y = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(y), rgb, 1.0 + saturation * v);
  return withRgb(c, rgb);
}
`, false),
  }),

  // vaudio's visualizers (docs/visualizer/vaudio-port.md), redrawn in GLSL. vaudio drew them on a canvas that
  // kept its last frame; here they're the moment alone, and their trails are the Feedback effect's.
  visualizer({
    type: "audio-wave-bars",
    label: "Wave Bars",
    tags: ["audio", "generate"],
    params: [
      source,
      number("bars", "Bars", 96, 8, 160, { slider: true }),
      point("center", "Center", [0.5, 0.55]),
      percent("height", "Height", 0.72, { max: 1.5 }),
      boost,
      degrees("hueSpread", "Hue Spread", 120, 0, 360),
      number("hueDrift", "Hue Drift", 28, -180, 180, { unit: "°/s", step: 1 }),
      percent("glow", "Glow", 0.4),
      colour("color", "Colour", "#ff4fd8"),
      colour("color2", "Loud Colour", "#33d6ff"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.12 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  float n = max(4.0, floor(bars));
  float lx = p.x / ratio + 0.5;
  float i = clamp(floor(lx * n), 0.0, n - 1.0);
  float f = lx * n - i;
  float v = clamp(spectrum(mix(hzX(40.0), hzX(12000.0), (i + 0.5) / n)) * boost, 0.0, 1.0);
  // Up a little more than down, as vaudio's.
  float h = max(v * (0.55 + audioLevel * 0.9) * height, 0.003);
  float barW = ratio / n;
  float d = box(vec2((f - 0.5) * barW, p.y - h * 0.05), vec2(barW * 0.41, h * 0.5), 0.0);
  vec3 rgb = hueTurn(mix(color, color2, v), (i / n) * hueSpread + hueDrift * time + audioLevel * 40.0) * (0.55 + 0.6 * v);
  vec4 g = paint(rgb, soft(d) * step(0.0, lx) * step(lx, 1.0));
  // A glow in the middle, growing with the sound.
  float R = 0.08 + audioLevel * 0.18;
  float r = length(p);
  g = over(paint(hueTurn(color, hueDrift * time), glow * (0.18 + audioLevel * 0.35) * exp(-(r * r) / (R * R * 1.5))), g);
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-radial",
    label: "Radial Pulse",
    tags: ["audio", "generate"],
    params: [
      source,
      number("spokes", "Spokes", 72, 8, 180, { slider: true }),
      point("center", "Center", [0.5, 0.5]),
      percent("size", "Size", 0.42, { max: 1.5 }),
      boost,
      number("spin", "Spin", 20, -360, 360, { unit: "°/s", step: 1 }),
      number("thickness", "Thickness", 1, 0.25, 4, { step: 0.05, decimals: 2, slider: true }),
      degrees("hueSpread", "Hue Spread", 300, 0, 360),
      number("hueDrift", "Hue Drift", 40, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#ff4fd8"),
      colour("color2", "Outer Colour", "#ffd166"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.1 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 d = sq(uv) - sqPoint(center);
  float r = length(d);
  float n = max(4.0, floor(spokes));
  float t = fract((atan(d.y, d.x) - radians(spin) * time) / (2.0 * PI)) * n;
  float i = floor(t);
  float f = t - i;
  float v = clamp(spectrum(mix(hzX(40.0), hzX(12000.0), (i + 0.5) / n)) * boost, 0.0, 1.0);
  float inner = size * (0.18 + audioLevel * 0.08);
  float outer = inner + v * size * (0.55 + audioLevel * 0.55);
  // Across the spoke (an arc of its angle at this radius), and along it.
  float across = abs(f - 0.5) * (2.0 * PI / n) * r - (0.003 + 0.007 * v) * thickness;
  float dist = max(across, max(inner - r, r - outer));
  vec3 rgb = hueTurn(mix(color, color2, clamp((r - inner) / max(outer - inner, 1e-3), 0.0, 1.0)), (i / n) * hueSpread + hueDrift * time);
  vec4 g = paint(rgb, soft(dist) * (0.35 + 0.65 * v));
  float disc = soft(r - size * (0.12 + audioLevel * 0.2)) * (0.12 + audioLevel * 0.35);
  g = over(g, paint(hueTurn(color2, hueDrift * time * 1.25), disc));
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-tunnel",
    label: "Signal Tunnel",
    tags: ["audio", "generate"],
    params: [
      source,
      number("rings", "Rings", 19, 4, 32, { slider: true }),
      point("center", "Center", [0.5, 0.5]),
      boost,
      number("wobble", "Wobble", 1, 0, 3, { step: 0.05, decimals: 2, slider: true }),
      number("hueDrift", "Hue Drift", 30, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Inner Colour", "#7c5cff"),
      colour("color2", "Outer Colour", "#33d6ff"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.1 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv) - sqPoint(center);
  vec4 g = vec4(0.0);
  float n = max(2.0, floor(rings));
  // The outer rings first, the inner ones over them.
  for (int k = 31; k >= 0; k--) {
    float i = float(k);
    float on = step(i, n - 1.0);
    float t = i / (n - 1.0);
    float energy = clamp(spectrum(1.0 - t) * boost, 0.0, 1.0) * (0.5 + audioLevel);
    float radius = 0.05 + t * 0.55 + sin(time * 2.2 + i * 0.4) * 0.02 * wobble + energy * 0.08;
    vec2 shift = vec2(sin(time * 0.8 + i * 0.2) * 0.05, cos(time * 0.7 + i * 0.15) * 0.033) * energy * wobble;
    vec2 q = rot(time * 0.15) * (p - shift);
    vec2 axes = vec2(radius * ratio, radius);
    float dist = abs(length(q / axes) - 1.0) * radius - (0.002 + energy * 0.008);
    vec3 rgb = hueTurn(mix(color, color2, t), hueDrift * time + energy * 80.0);
    g = over(paint(rgb, soft(dist) * (0.15 + energy * 0.7) * on), g);
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-lattice",
    label: "Bass Lattice",
    tags: ["audio", "generate"],
    params: [
      source,
      number("columns", "Columns", 16, 2, 48, { slider: true }),
      number("rows", "Rows", 9, 2, 32, { slider: true }),
      boost,
      number("hueDrift", "Hue Drift", 25, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#a3e635"),
      colour("color2", "Second Colour", "#ff4fd8"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.12 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 grid = vec2(max(1.0, floor(columns)), max(1.0, floor(rows)));
  // Top left first, as vaudio counted them.
  vec2 at = vec2(uv.x, 1.0 - uv.y) * grid;
  vec2 cell = min(floor(at), grid - 1.0);
  vec2 local = fract(at) - 0.5;
  float n = (cell.x + cell.y * grid.x) / (grid.x * grid.y);
  float pulse = clamp(spectrum(n) * boost, 0.0, 1.0) * 0.65 + audioBass * (1.0 - abs(cell.x / grid.x - 0.5)) + audioMid * sin(time + cell.x * 0.4 + cell.y * 0.3) * 0.25 + audioHigh * 0.15;
  float s = max(0.08, pulse) * (0.55 + audioLevel * 0.7);
  vec2 cellSize = vec2(ratio, 1.0) / grid;
  // Never quite filling its cell, so the grid always reads.
  float d = box(local * cellSize, cellSize * 0.5 * clamp(s, 0.0, 0.86), 0.0);
  vec3 rgb = hueTurn(mix(color, color2, n), hueDrift * time + audioBass * 60.0) * (0.6 + 0.5 * clamp(pulse, 0.0, 1.0));
  return blendGenerated(paint(rgb, soft(d) * clamp(0.2 + pulse * 0.8, 0.0, 1.0)), base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-ribbons",
    label: "Ribbon Field",
    tags: ["audio", "generate"],
    params: [
      source,
      number("ribbons", "Ribbons", 7, 1, 12, { slider: true }),
      boost,
      percent("swing", "Swing", 1, { max: 3 }),
      number("thickness", "Thickness", 1, 0.25, 4, { step: 0.05, decimals: 2, slider: true }),
      number("hueDrift", "Hue Drift", 35, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#ff5cf0"),
      colour("color2", "Last Colour", "#5cffd6"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.12 }) },
    glsl: audio(VAUDIO_GLSL + `
float ribbonY(float x, float r, float n) {
  // Each ribbon reads the spectrum a little further along (not round: a jump would draw a cliff).
  float s = clamp(spectrum(clamp(x * 0.85 + r * 0.02, 0.0, 1.0)) * boost, 0.0, 1.0);
  return (r + 1.0) / (n + 1.0) - 0.5 + sin(x * PI * 4.0 + time * (1.2 + r * 0.15) + r) * (0.05 + audioLevel * 0.11) * swing + (s - 0.5) * 0.28;
}
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv);
  float x = uv.x;
  float n = max(1.0, floor(ribbons));
  vec4 g = vec4(0.0);
  for (int k = 0; k < 12; k++) {
    float r = float(k);
    float on = step(r, n - 1.0);
    // From the top down, as vaudio's.
    float y = -ribbonY(x, r, n);
    float e = 0.002;
    float slope = -(ribbonY(x + e, r, n) - ribbonY(x - e, r, n)) / (2.0 * e * ratio);
    float band = clamp(spectrum((r + 0.5) / n) * boost, 0.0, 1.0);
    float half_ = (0.0028 + audioLevel * 0.007 + band * 0.011) * thickness;
    float d = abs(p.y - y) / sqrt(1.0 + slope * slope) - half_;
    vec3 rgb = hueTurn(mix(color, color2, r / max(n - 1.0, 1.0)), hueDrift * time + audioLevel * 50.0);
    g = over(paint(rgb, soft(d) * (0.35 + audioLevel * 0.45) * on), g);
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-orbs",
    label: "Orb Bloom",
    tags: ["audio", "generate"],
    params: [
      source,
      number("orbs", "Orbs", 28, 4, 48, { slider: true }),
      boost,
      percent("orbSize", "Size", 1, { max: 3 }),
      percent("spread", "Spread", 1, { max: 2 }),
      number("hueDrift", "Hue Drift", 40, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#ff7ae0"),
      colour("color2", "Second Colour", "#7cf7ff"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.15 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = sq(uv);
  float n = max(1.0, floor(orbs));
  vec4 g = vec4(0.0);
  for (int k = 0; k < 48; k++) {
    float i = float(k);
    float on = step(i, n - 1.0);
    float t = i / n;
    float s = clamp(spectrum(t) * boost, 0.0, 1.0);
    float orbit = (0.15 + s * 0.35 + audioLevel * 0.12) * spread;
    vec2 at = vec2(cos(time * (0.4 + t) + i * 1.7) * orbit * (0.7 + s) * ratio, sin(time * (0.35 + t * 0.8) + i * 1.3) * orbit * (0.55 + s));
    float radius = (0.03 + s * 0.15 + audioLevel * 0.07) * (0.6 + mod(i, 3.0) * 0.2) * orbSize;
    float r = length(p - at) / radius;
    vec3 inner = hueTurn(mix(color, color2, t), hueDrift * time + s * 90.0);
    vec3 outer = hueTurn(inner, 40.0);
    // Bright in the middle, a halo of the next hue, nothing at the edge.
    float a = r < 0.55 ? mix(0.35 + s * 0.55, 0.12 + s * 0.25, r / 0.55) : mix(0.12 + s * 0.25, 0.0, clamp((r - 0.55) / 0.45, 0.0, 1.0));
    vec3 rgb = r < 0.55 ? mix(inner * 1.2, outer, r / 0.55) : outer;
    g = over(paint(min(rgb, vec3(1.0)), a * on), g);
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-shards",
    label: "Hard Shards",
    tags: ["audio", "generate"],
    params: [
      source,
      number("shards", "Shards", 24, 4, 48, { slider: true }),
      boost,
      percent("shardSize", "Size", 1, { max: 3 }),
      degrees("hueSpread", "Hue Spread", 360, 0, 720),
      number("hueDrift", "Hue Drift", 60, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#ff3d6e"),
      colour("color2", "Second Colour", "#ffd166"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.1 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  vec2 p = vec2(uv.x * ratio, 1.0 - uv.y);
  float n = max(1.0, floor(shards));
  vec4 g = vec4(0.0);
  for (int k = 0; k < 48; k++) {
    float i = float(k);
    float on = step(i, n - 1.0);
    float t = i / n;
    float s = clamp(spectrum(t) * boost, 0.0, 1.0);
    float energy = s * (0.4 + audioLevel);
    vec2 at = vec2(((sin(i * 12.9898 + time) * 0.5 + 0.5) * 0.9 + 0.05) * ratio, (cos(i * 78.233 + time * 0.7) * 0.5 + 0.5) * 0.9 + 0.05);
    float len = (0.055 + energy * 0.33) * shardSize;
    // A thin triangle, its point at len along its angle.
    vec2 q = rot(-(time * (0.8 + t) + i * 0.9 + s * 3.0)) * (p - at);
    float w = len * 0.15;
    float edge = max(-q.x, abs(q.y) - w * (1.0 - q.x / len));
    vec3 rgb = hueTurn(mix(color, color2, t), t * hueSpread + hueDrift * time) * (0.6 + energy * 0.6);
    g = over(paint(min(rgb, vec3(1.0)), soft(edge) * (0.25 + energy * 0.7) * on), g);
  }
  return blendGenerated(g, base, opacity);
}
`),
  }),
  visualizer({
    type: "audio-plasma",
    label: "Acid Plasma",
    tags: ["audio", "generate"],
    params: [
      source,
      boost,
      number("pixelSize", "Pixel Size", 0.012, 0, 0.05, { scale: 1000, unit: "‰", step: 1, slider: true }),
      number("speed", "Speed", 1, 0, 4, { step: 0.05, decimals: 2, slider: true }),
      degrees("hueSpread", "Hue Spread", 140, 0, 360),
      number("hueDrift", "Hue Drift", 20, -180, 180, { unit: "°/s", step: 1 }),
      colour("color", "Colour", "#2ee6a8"),
      colour("color2", "Hot Colour", "#ff4fd8"),
      ...blending("over"),
    ],
    audio: { request: () => request({ fall: 0.12 }) },
    glsl: audio(VAUDIO_GLSL + `
vec4 effect(vec2 uv) {
  vec4 base = getColor(uv);
  // In blocks, as vaudio drew it (none at 0).
  vec2 q = pixelSize > 0.0 ? (floor(uv * vec2(ratio, 1.0) / pixelSize) + 0.5) * pixelSize / vec2(ratio, 1.0) : uv;
  float u = q.x;
  float v = 1.0 - q.y;
  float tt = time * speed;
  float wave = sin(u * 8.0 + tt * 1.4 + audioBass * 4.0) * cos(v * 7.0 - tt * 1.1 + audioMid * 3.0) * 0.5 + 0.5;
  float spark = clamp(spectrum((u + v) * 0.5) * boost, 0.0, 1.0) * audioHigh;
  float value = min(1.0, wave * (0.45 + audioLevel * 0.4) + spark * 0.55 + audioBass * 0.2);
  float shown = smoothstep(0.16, 0.2, value);
  vec3 rgb = hueTurn(mix(color, color2, value), value * hueSpread + hueDrift * time + audioBass * hueSpread * 0.35) * (0.5 + value * 0.6);
  return blendGenerated(paint(min(rgb, vec3(1.0)), (0.15 + value * 0.7) * shown), base, opacity);
}
`),
  }),
];
