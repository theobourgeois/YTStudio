/**
 * Video effect shaders: the GLSL prelude every video effect is written
 * against, and turning a clip's effects into the passes the compositor
 * (`compositor.ts`) runs. The compositor draws the clip's own picture into a
 * layer of its size as shown (never bigger than the media), runs each enabled
 * effect over it in order, then places the result where Motion puts it, like
 * Premiere draws standard effects before Motion and Opacity.
 */
import type { AudioInputs, EffectPass, Shader } from "./compositor.ts";
import { clipAudio, demoAudio } from "./audio-signals.ts";
import { particleSources } from "./particles.ts";
import { timelineTime } from "./timeline.ts";
import { type EffectDefinition, effectDefinition, effectValuesAt, isComputed } from "./effects.ts";
import type { ParamSpec } from "./params.ts";
import { GLSL_HELPERS, type UniformSpec, type UniformValue, paramUniforms, uniformDeclarations } from "./transition-gl.ts";
import type { Clip, ParamValues } from "./types.ts";

/**
 * Everything a video effect's GLSL can use:
 *
 * - `ratio` (the clip's frame width / height as shown), `resolution` (px of the
 *   picture being worked on: about its size on the output), `time` (the
 *   clip's source time in seconds, for effects that move), `clipTime` (seconds
 *   since the clip started on the timeline, for timing things within it), `fps` (the video's
 *   frame rate, for effects that blur their own motion over a frame's
 *   shutter), `pass` (which run of a multi-pass effect this is, from 0).
 * - `getColor(uv)`: the clip's picture (after the effects before this one,
 *   and in a multi-pass effect, after its passes so far), premultiplied RGBA;
 *   past the edges it repeats the edge pixels (or mirrors or tiles the
 *   picture, as the clip's Motion Edges say). `getColorOrClear(uv)` is
 *   transparent there instead. `getInput(uv)` is what this effect started
 *   from, for multi-pass effects that combine their result with it (a glow
 *   blurs in its passes, then adds to the picture). `uv` (0, 0) is bottom left.
 * - `unpremultiply(c)` (its straight RGB) and `withRgb(c, rgb)` (straight RGB
 *   back with `c`'s alpha, clamped), for colour maths.
 * - Helpers shared with transitions: `PI`, `ease`, `hash`/`hash2`, `noise`,
 *   `fbm`, `rot`, `luma`, `inside(uv)`, `toUv` (a point parameter to uv),
 *   `aspect(uv)` (uv around the centre in square units), `mirrored(uv)`.
 *
 * The result must be premultiplied (rgb never above alpha); it's clamped.
 * Distances are best given as fractions of the frame's height, so an effect
 * looks the same in the preview and the (bigger) export.
 */
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uInput;
uniform float ratio;
uniform vec2 resolution;
uniform float time;
uniform float clipTime;
uniform float fps;
uniform int pass;
uniform vec4 uFrame;
${GLSL_HELPERS}
vec4 getColor(vec2 uv) { return texture(uSrc, uv); }
vec4 getColorOrClear(vec2 uv) { return inside(uv) ? texture(uSrc, uv) : vec4(0.0); }
vec4 getInput(vec2 uv) { return texture(uInput, uv); }
// A point of the clip's frame (fractions, y down, like a Center parameter) in this layer's uv: the
// same as toUv, unless an effect grew the layer past the frame (Grow Bounds).
vec2 frameUv(vec2 p) { vec2 q = toUv(p); return uFrame.xy + q * (uFrame.zw - uFrame.xy); }
vec3 unpremultiply(vec4 c) { return c.a > 0.0 ? c.rgb / c.a : vec3(0.0); }
vec4 withRgb(vec4 c, vec3 rgb) { return vec4(clamp(rgb, 0.0, 1.0) * c.a, c.a); }
`;

const MAIN = `
void main() {
  vec4 c = clamp(effect(vUv), 0.0, 1.0);
  c.rgb = min(c.rgb, vec3(c.a));
  fragColor = c;
}
`;

/** Most earlier frames a time effect keeps. */
export const MAX_HISTORY = 48;

/**
 * What a time effect (`EffectShader.history`) can also use:
 *
 * - `getFrameAgo(seconds, uv)`: its input that long ago (blending the two frames recorded
 *   around then), or its input now when there's nothing that old (`historyReach` is how
 *   far back frames go, 0 for none).
 * - `getFeedback(uv)`: its own output a frame ago (for trails and datamosh), transparent
 *   when there's none (`hasFeedback`).
 * - `getFlow(uv)`: how far the picture at `uv` moved since the last frame, in uv
 *   (optical flow: now ≈ a frame ago at `uv - getFlow(uv)`); zero when unknown.
 */
const HISTORY_PRELUDE = `
uniform highp sampler2DArray uHistory;
uniform float uHistoryAge[${MAX_HISTORY}];
uniform int uHistoryCount;
uniform sampler2D uFeedback;
uniform bool hasFeedback;
uniform sampler2D uFlow;
uniform bool hasFlow;
float historyReach() {
  float most = 0.0;
  for (int i = 0; i < ${MAX_HISTORY}; i++) {
    if (i >= uHistoryCount) break;
    most = max(most, uHistoryAge[i]);
  }
  return most;
}
vec4 getFrameAgo(float seconds, vec2 uv) {
  if (seconds <= 0.0 || uHistoryCount == 0) return getInput(uv);
  // The recorded frames just newer and just older than then (now counts as age 0).
  float newer = 0.0;
  int newerAt = -1;
  float older = 1e9;
  int olderAt = -1;
  for (int i = 0; i < ${MAX_HISTORY}; i++) {
    if (i >= uHistoryCount) break;
    float age = uHistoryAge[i];
    if (age < 0.0) continue;
    if (age <= seconds && age >= newer) { newer = age; newerAt = i; }
    if (age >= seconds && age < older) { older = age; olderAt = i; }
  }
  vec4 a = newerAt < 0 ? getInput(uv) : texture(uHistory, vec3(uv, float(newerAt)));
  if (olderAt < 0) return a;
  vec4 b = texture(uHistory, vec3(uv, float(olderAt)));
  return older > newer ? mix(a, b, (seconds - newer) / (older - newer)) : b;
}
vec4 getFeedback(vec2 uv) { return hasFeedback && inside(uv) ? texture(uFeedback, uv) : vec4(0.0); }
vec2 getFlow(vec2 uv) { return hasFlow ? texture(uFlow, uv).xy : vec2(0.0); }
`;

/**
 * What a visualizer (`EffectShader.audio`) can also use, all at the clip's moment:
 *
 * - `spectrum(x)`: the sound's level at `x` along a log frequency axis (0 is 20 Hz, 1 is 20 kHz), 0..1
 *   against its own loud parts, falling away as the effect asks; `spectrumAgo(x, seconds)` the same
 *   that long ago (as far back as it asked: waterfalls, trails); `spectrumBands` is 96.
 * - `wave(x)`: the sound itself around now, left and right, -1..1 (`x` 0..1 across the window it asked
 *   for, now in the middle).
 * - `audioLevel`, `audioBass`, `audioMid`, `audioHigh` (0..1), `audioOnset` (an impulse at each hit),
 *   `sinceOnset` (seconds since the last hit), `beatCount` (beats so far, counting up smoothly),
 *   `beatPhase` (0..1 through this beat), `sinceBeat` (seconds), `bpm`.
 * - `hitAge[i]`, `hitVelocity[i]`: the last 8 hits, newest first: seconds since each (very large where
 *   there's none) and how hard it was, for bursts that each play out.
 */
const AUDIO_PRELUDE = `
uniform highp sampler2D uSpectrum;
uniform int uSpectrumRows;
uniform float uSpectrumSpan;
uniform highp sampler2D uWave;
uniform int uWavePoints;
uniform float audioLevel;
uniform float audioBass;
uniform float audioMid;
uniform float audioHigh;
uniform float audioOnset;
uniform float sinceOnset;
uniform float beatCount;
uniform float beatPhase;
uniform float sinceBeat;
uniform float bpm;
uniform float hitAge[8];
uniform float hitVelocity[8];
const float spectrumBands = 96.0;
float spectrumRow(float x, int row) {
  float fx = clamp(x, 0.0, 1.0) * (spectrumBands - 1.0);
  int i = int(floor(fx));
  int j = min(i + 1, int(spectrumBands) - 1);
  int r = clamp(row, 0, max(uSpectrumRows - 1, 0));
  return mix(texelFetch(uSpectrum, ivec2(i, r), 0).r, texelFetch(uSpectrum, ivec2(j, r), 0).r, fract(fx));
}
float spectrum(float x) { return spectrumRow(x, 0); }
float spectrumAgo(float x, float seconds) {
  if (uSpectrumRows <= 1 || uSpectrumSpan <= 0.0) return spectrumRow(x, 0);
  float r = clamp(seconds / uSpectrumSpan, 0.0, 1.0) * float(uSpectrumRows - 1);
  int r0 = int(floor(r));
  return mix(spectrumRow(x, r0), spectrumRow(x, r0 + 1), fract(r));
}
vec2 wave(float x) {
  if (uWavePoints < 2) return vec2(0.0);
  float fx = clamp(x, 0.0, 1.0) * float(uWavePoints - 1);
  int i = int(floor(fx));
  int j = min(i + 1, uWavePoints - 1);
  return mix(texelFetch(uWave, ivec2(i, 0), 0).rg, texelFetch(uWave, ivec2(j, 0), 0).rg, fract(fx));
}
`;

/** Names the prelude uses, which parameters can't have. */
export const RESERVED_EFFECT_UNIFORMS = [
  "uSrc",
  "uInput",
  "ratio",
  "resolution",
  "time",
  "clipTime",
  "fps",
  "uFrame",
  "pass",
  "vUv",
  "fragColor",
  "uHistory",
  "uHistoryAge",
  "uHistoryCount",
  "uFeedback",
  "hasFeedback",
  "uFlow",
  "hasFlow",
];

/** Names a visualizer's prelude adds (`AUDIO_PRELUDE`), which its parameters can't have. */
export const RESERVED_AUDIO_UNIFORMS = [
  "uSpectrum",
  "uSpectrumRows",
  "uSpectrumSpan",
  "uWave",
  "uWavePoints",
  "audioLevel",
  "audioBass",
  "audioMid",
  "audioHigh",
  "audioOnset",
  "sinceOnset",
  "beatCount",
  "beatPhase",
  "sinceBeat",
  "bpm",
  "spectrumBands",
  "hitAge",
  "hitVelocity",
];

const isUniformSpec = (spec: ParamSpec): spec is UniformSpec =>
  spec.kind === "number" || spec.kind === "boolean" || spec.kind === "choice" || spec.kind === "vec2" || spec.kind === "color";

/** The complete fragment shader of a video effect (a time effect's with its history helpers, a visualizer's with its sound). */
export function effectFragmentSource(def: { params: readonly ParamSpec[]; glsl: string; history?: unknown; audio?: unknown }): string {
  return `${PRELUDE}${def.history ? HISTORY_PRELUDE : ""}${def.audio ? AUDIO_PRELUDE : ""}\n${uniformDeclarations(def.params.filter(isUniformSpec))}\n${def.glsl}\n${MAIN}`;
}

const shaders = new Map<string, Shader>();

/** A video effect's shader, built once (null for effects that aren't drawn by a shader). */
export function effectShader(def: EffectDefinition): Shader | null {
  if (!def.shader) return null;
  let shader = shaders.get(def.type);
  if (!shader) {
    // Keyed apart from transitions, which share the compositor's program cache.
    const key = `fx:${def.type}`;
    if (def.shader.particles) {
      // The particles' shaders, and the layer under them (the effect's own `effect(uv)`).
      const { vertex, fragment } = particleSources(uniformDeclarations(def.params.filter(isUniformSpec)), def.shader.particles.glsl);
      shader = { key, source: fragment, vertex, base: effectFragmentSource({ params: def.params, glsl: def.shader.glsl, audio: def.shader.audio }) };
    } else {
      shader = { key, source: effectFragmentSource({ params: def.params, glsl: def.shader.glsl, history: def.shader.history, audio: def.shader.audio }) };
    }
    shaders.set(def.type, shader);
  }
  return shader;
}

/** Frame rate effects are drawn at when nobody says (cards, sheets). */
export const DEFAULT_FPS = 30;

/** A video effect's values (and the time, time into its clip and frame rate) as uniforms. */
export function effectUniforms(def: EffectDefinition, values: ParamValues, time: number, fps = DEFAULT_FPS, clipTime = time): UniformValue[] {
  return [
    ...paramUniforms(def.params.filter(isUniformSpec), values),
    { name: "time", type: "float", value: time },
    { name: "clipTime", type: "float", value: clipTime },
    { name: "fps", type: "float", value: fps },
  ];
}

/**
 * The pass of one effect with these values, at source time `time`. A time effect keeps its
 * earlier frames under `instance` (a clip's effect: see `EffectPass.history`), only
 * recording new ones when `record` (not for motion blur's in-between moments). A visualizer
 * hears `audio` (made-up sound when none is given: cards, sheets).
 */
export function effectPass(
  def: EffectDefinition,
  values: ParamValues,
  time: number,
  fps = DEFAULT_FPS,
  instance?: string,
  record = true,
  clipTime = time,
  audio?: AudioInputs,
): EffectPass | null {
  const shader = effectShader(def);
  if (!shader) return null;
  const pass: EffectPass = { shader, uniforms: effectUniforms(def, values, time, fps, clipTime), passes: def.shader?.passes ?? 1 };
  if (def.shader?.audio) pass.audio = audio ?? demoAudio(time, def.shader.audio.request(values));
  const particles = def.shader?.particles;
  if (particles) pass.particles = { count: Math.max(0, Math.round(particles.count(values))), blend: particles.blend(values) };
  const grow = def.shader?.grow?.(values) ?? 0;
  if (grow > 0) pass.grow = grow;
  const history = def.shader?.history;
  if (history && instance) {
    pass.history = {
      id: instance,
      time,
      fps,
      reach: Math.max(1 / fps, Math.min(history.reach(values, fps), MAX_HISTORY / fps)),
      ...(history.feedback && { feedback: true }),
      ...(history.flow && { flow: true }),
      ...(!record && { record: false }),
    };
  }
  return pass;
}

/**
 * Whether a clip's video effects draw differently at source times `a` and `b`: a
 * value changes (keyframes), or an effect that moves by itself is on.
 */
export function effectsChange(clip: Clip, a: number, b: number): boolean {
  if (a === b) return false;
  for (const effect of clip.effects) {
    const def = effect.enabled ? effectDefinition(effect.type) : undefined;
    if (!def?.shader) continue;
    if (def.shader.animated || def.shader.audio) return true;
    if (!effect.keyframes && !isComputed(effect)) continue;
    const va = effectValuesAt(def, effect, a, clip);
    const vb = effectValuesAt(def, effect, b, clip);
    if (Object.keys({ ...effect.keyframes, ...effect.expressions, ...effect.links }).some((key) => JSON.stringify(va[key]) !== JSON.stringify(vb[key]))) return true;
  }
  return false;
}

/**
 * What a clip's enabled video effects draw at source time `time`, in order. `record`: time
 * effects add this moment to their earlier frames (not for motion blur's in-between moments).
 */
export function effectPasses(clip: Clip, time: number, fps = DEFAULT_FPS, record = true): EffectPass[] {
  const passes: EffectPass[] = [];
  for (const effect of clip.effects) {
    const def = effect.enabled ? effectDefinition(effect.type) : undefined;
    const clipTime = timelineTime(clip, time) - clip.start;
    if (!def?.shader) continue;
    const values = effectValuesAt(def, effect, time, clip);
    // A visualizer hears its source at this moment.
    const audio = def.shader.audio ? clipAudio(clip.id, time, values.source, def.shader.audio.request(values), fps) : undefined;
    const pass = effectPass(def, values, time, fps, `${clip.id}/${effect.id}`, record, clipTime, audio);
    if (pass) passes.push(pass);
  }
  return passes;
}
