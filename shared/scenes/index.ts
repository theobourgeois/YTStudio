/**
 * 3D scenes (docs/visualizer/scenes.md): raymarched worlds as effects (`EffectShader.scene`). What moves in
 * them (a camera's flight, its swoops, a flash set off by a kick) is state stepped here, in TypeScript, from the
 * clip's first frame at the sequence's frame step, fed by the sound's signals: the same numbers whether the tab
 * draws a frame or the export's plan does (`steppedState` keeps checkpoints, so a seek doesn't step from the
 * start again). The state reaches the scene's GLSL as uniforms; the GLSL is a pure function of them.
 */
import type { AudioRequest } from "../compositor.ts";
import { clipAudio, demoAudio } from "../audio-signals.ts";
import { type EffectDefinition, effectValuesAt } from "../effects.ts";
import type { ParamSpec } from "../params.ts";
import { frameSourceTime, steppedState } from "../simulation.ts";
import type { UniformValue } from "../transition-gl.ts";
import type { Clip, Effect, ParamValues } from "../types.ts";
import { follow, type SceneFrame, type SceneInput } from "./kit.ts";
import { SCENES } from "./list.ts";

export type { SceneFrame, SceneInput } from "./kit.ts";

/** A scene: its effect's own parameters and GLSL, how its state starts and steps, and the uniforms it makes. */
export interface SceneSpec<S = unknown> {
  type: string;
  label: string;
  /** Its own looks (the shared ones, what it hears, Speed, Quality, blending, are added for every scene). */
  params: ParamSpec[];
  /** Values its card shows, where its defaults don't read at that size. */
  demo?: ParamValues;
  /**
   * GLSL defining `vec3 scene(vec2 uv)`: the linear colour seen through the camera at `uv` (see `SCENE_GLSL` in
   * `effect-library/scenes.ts` for the camera and helpers). It declares the uniforms `uniforms` makes.
   */
  glsl: string;
  /** It also hears the sound directly in GLSL (the spectrum texture: `spectrum(x)`), as visualizers do. */
  audio?: (values: ParamValues) => AudioRequest;
  init(): S;
  /** One frame on: changes `state`. */
  step(state: S, frame: SceneFrame): void;
  /** Its state and this moment's sound as the uniforms its GLSL declares. */
  uniforms(state: S, frame: SceneFrame): UniformValue[];
}

export { SCENES };
const BY_TYPE: Record<string, SceneSpec> = Object.fromEntries(SCENES.map((s) => [s.type, s]));

export const sceneSpec = (type: string): SceneSpec | undefined => BY_TYPE[type];

/** What a scene hears each frame: the levels, kicks (or the hits its `hits` value names) and the spectrum's bands. */
export function sceneRequest(values: ParamValues): AudioRequest {
  const hits = values.hits === "any" ? "onset" : values.hits === "snares" ? "onsetMid" : values.hits === "hats" ? "onsetHigh" : "onsetLow";
  return { rows: 1, span: 0, fall: 0.12, window: 0, hits };
}

/** A scene's input at frame `frame`, from its values and what it hears then. */
function inputAt(frame: number, fps: number, values: ParamValues, audio: ReturnType<typeof demoAudio>): SceneInput {
  const dt = 1 / fps;
  // A hit that started during this frame (ages are from now back).
  const hit = audio.hits.find(([age]) => age >= 0 && age < dt);
  // 32 bands from the 96.
  const bands: number[] = [];
  for (let i = 0; i < 32; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) sum += audio.spectrum[i * 3 + j] ?? 0;
    bands.push(Math.round((sum / 3) * 1000) / 1000);
  }
  const gain = Math.max(0.05, Number(values.reactivity ?? 1));
  const s = audio.scalars;
  return {
    frame,
    time: frame * dt,
    dt,
    values,
    level: Math.min(1, s.level * gain),
    bass: Math.min(1, s.bass * gain),
    mid: Math.min(1, s.mid * gain),
    high: Math.min(1, s.high * gain),
    hit: hit ? Math.max(0.2, hit[1]) : 0,
    bands: bands.map((b) => Math.min(1, b * gain)),
  };
}

/** Plain JSON copies: a state is numbers, arrays and objects of them. */
const clone = <S>(state: S): S => structuredClone(state);

/** The scene's uniforms at frame `frame`, stepped by `inputOf` (a frame's input) from the start. */
function sceneAt(spec: SceneSpec, owner: object, key: string, version: string, frame: number, inputOf: (k: number) => SceneInput): UniformValue[] {
  const now = inputOf(frame);
  const stepped = steppedState(
    owner,
    key,
    version,
    frame,
    () => ({ scene: spec.init(), audio: follow.init() }),
    (st, k) => {
      const input = k === frame ? now : inputOf(k);
      follow.step(st.audio, input);
      spec.step(st.scene, { ...input, follow: st.audio });
    },
    clone,
  );
  return spec.uniforms(stepped.scene, { ...now, follow: stepped.audio });
}

/** A clip's scene effect at frame `frame` of the clip: stepped from the clip's first frame on what it hears. */
export function clipScene(def: EffectDefinition, type: string, clip: Clip, effect: Effect, frame: number, fps: number, version: string): UniformValue[] | null {
  const spec = BY_TYPE[type];
  if (!spec) return null;
  const inputOf = (k: number) => {
    const time = frameSourceTime(clip, k, fps);
    const values = effectValuesAt(def, effect, time, clip);
    return inputAt(k, fps, values, clipAudio(clip.id, time, values.source, sceneRequest(values), fps));
  };
  return sceneAt(spec, clip, effect.id, version, frame, inputOf);
}

const demoOwners = new Map<string, object>();

/** A scene with these values throughout, on made-up sound (cards, sheets). */
export function demoScene(type: string, values: ParamValues, instance: string, frame: number, fps: number): UniformValue[] | null {
  const spec = BY_TYPE[type];
  if (!spec) return null;
  let owner = demoOwners.get(instance);
  if (!owner) demoOwners.set(instance, (owner = {}));
  const inputOf = (k: number) => inputAt(k, fps, values, demoAudio(k / fps, sceneRequest(values)));
  return sceneAt(spec, owner, type, `${fps}:${JSON.stringify(values)}`, frame, inputOf);
}
