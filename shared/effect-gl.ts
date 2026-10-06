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
import { type EffectDefinition, definitionOf, effectValuesAt, isComputed } from "./effects.ts";
import { type UniformValue, paramUniforms, uniformDeclarations } from "./transition-gl.ts";
import { MAX_HISTORY, effectFragmentSource, isUniformSpec } from "./effect-prelude.ts";
import type { Clip, ParamValues } from "./types.ts";

export { AUDIO_PRELUDE, MAX_HISTORY, RESERVED_AUDIO_UNIFORMS, RESERVED_EFFECT_UNIFORMS, effectFragmentSource } from "./effect-prelude.ts";

const shaders = new Map<string, Shader>();
/** The Shader effect's, by definition (one per code: see `shaderDefinition`). */
const userShaders = new WeakMap<EffectDefinition, Shader>();

/** A video effect's shader, built once (null for effects that aren't drawn by a shader). */
export function effectShader(def: EffectDefinition): Shader | null {
  if (!def.shader) return null;
  if (def.shader.source) {
    let user = userShaders.get(def);
    if (!user) userShaders.set(def, (user = { key: def.shader.key ?? `fx:${def.type}`, source: def.shader.source }));
    return user;
  }
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
  if (def.shader?.uniforms) return def.shader.uniforms(values, { time, clipTime, fps });
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
    const def = effect.enabled ? definitionOf(effect) : undefined;
    if (!def?.shader) continue;
    if (def.shader.animated || def.shader.audio) return true;
    if (!effect.keyframes && !isComputed(effect)) continue;
    const va = effectValuesAt(def, effect, a, clip);
    const vb = effectValuesAt(def, effect, b, clip);
    if (Object.keys({ ...effect.keyframes, ...effect.expressions, ...effect.links }).some((key) => JSON.stringify(va[key]) !== JSON.stringify(vb[key]))) return true;
  }
  return false;
}

/** Whether a user's shader compiles (the tab's compiler: `src/lib/shader-compiler.ts`); none: every one is drawn. */
let compiles: ((shader: Shader) => boolean) | null = null;

/**
 * Called by the tab: the Shader effects whose code doesn't compile are left out of what's drawn (the clip
 * shows without them), rather than failing its every other effect.
 */
export function provideShaderCheck(check: ((shader: Shader) => boolean) | null): void {
  compiles = check;
}

/** Whether an effect's shader can be drawn: built-in ones always, the user's when they compile. */
export function drawable(def: EffectDefinition): boolean {
  if (!def.shader?.source || !compiles) return true;
  const shader = effectShader(def);
  return !!shader && compiles(shader);
}

/**
 * What a clip's enabled video effects draw at source time `time`, in order. `record`: time
 * effects add this moment to their earlier frames (not for motion blur's in-between moments).
 */
export function effectPasses(clip: Clip, time: number, fps = DEFAULT_FPS, record = true): EffectPass[] {
  const passes: EffectPass[] = [];
  for (const effect of clip.effects) {
    const def = effect.enabled ? definitionOf(effect) : undefined;
    const clipTime = timelineTime(clip, time) - clip.start;
    if (!def?.shader || !drawable(def)) continue;
    const values = effectValuesAt(def, effect, time, clip);
    // A visualizer hears its source at this moment.
    const audio = def.shader.audio ? clipAudio(clip.id, time, values.source, def.shader.audio.request(values), fps) : undefined;
    const pass = effectPass(def, values, time, fps, `${clip.id}/${effect.id}`, record, clipTime, audio);
    if (pass) passes.push(pass);
  }
  return passes;
}
