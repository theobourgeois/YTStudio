/**
 * 3D scenes (V8): three.js worlds as effects (`EffectShader.scene`). What moves in them (a tesseract's
 * angles, a black hole's debris, a creature's spine) is state stepped here, in TypeScript, from the
 * clip's first frame at the sequence's frame step, fed by the sound's signals: the same numbers whether
 * the tab draws a frame or the export's plan does (`steppedState` keeps checkpoints, so a seek doesn't
 * step from the start again). The tab's renderer (`src/scenes/`) only draws a state, as `SceneDraw`.
 */
import type { AudioRequest, SceneDraw } from "../compositor.ts";
import { clipAudio, demoAudio } from "../audio-signals.ts";
import { type EffectDefinition, effectValuesAt } from "../effects.ts";
import { frameSourceTime, steppedState } from "../simulation.ts";
import type { Clip, Effect, ParamValues } from "../types.ts";
import { follow, type SceneFrame, type SceneInput } from "./kit.ts";
import { TESSERACT } from "./tesseract.ts";
import { SINGULARITY } from "./singularity.ts";
import { CATHEDRAL } from "./cathedral.ts";
import { LEVIATHAN } from "./leviathan.ts";

export type { SceneFrame, SceneInput } from "./kit.ts";

/** A scene: how its state starts and steps, and what its renderer is sent. */
export interface SceneSpec<S = unknown> {
  type: string;
  /** What its objects are built from (a change builds them again): a seed, a level of detail. */
  build(values: ParamValues): Record<string, number | string | boolean>;
  init(build: Record<string, number | string | boolean>): S;
  /** One frame on: changes `state`. */
  step(state: S, frame: SceneFrame): void;
  /** What the renderer is sent at a frame: plain values, from the state and this moment's sound. */
  view(state: S, frame: SceneFrame): Record<string, unknown>;
}

const SCENES: Record<string, SceneSpec> = Object.fromEntries(
  ([TESSERACT, SINGULARITY, CATHEDRAL, LEVIATHAN] as SceneSpec[]).map((s) => [s.type, s]),
);

export const sceneSpec = (type: string): SceneSpec | undefined => SCENES[type];

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
  // 32 bands from the 96 (vaudio's lattice and tunnels read 32).
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

/** The scene as drawn at frame `frame`, stepped by `inputOf` (a frame's input) from the start. */
function sceneAt(spec: SceneSpec, owner: object, key: string, version: string, frame: number, instance: string, inputOf: (k: number) => SceneInput): SceneDraw {
  const now = inputOf(frame);
  // The palette is built into the scene's materials, so a new one builds it again.
  const { colorize, colorA, colorB } = now.values;
  const build = { ...spec.build(now.values), colorize: Math.round(Number(colorize ?? 0) * 100) / 100, colorA: String(colorA ?? ""), colorB: String(colorB ?? "") };
  const buildKey = JSON.stringify(build);
  const stepped = steppedState(
    owner,
    `${key}:${buildKey}`,
    version,
    frame,
    () => ({ scene: spec.init(build), audio: follow.init() }),
    (st, k) => {
      const input = k === frame ? now : inputOf(k);
      follow.step(st.audio, input);
      spec.step(st.scene, { ...input, follow: st.audio });
    },
    clone,
  );
  // The effect's Bloom and Exposure, on top of the scene's own.
  const grade = { bloom: Math.max(0, Number(now.values.bloom ?? 1)), exposure: Math.max(0, Number(now.values.exposure ?? 1)) };
  return { type: spec.type, instance, build, state: { ...spec.view(stepped.scene, { ...now, follow: stepped.audio }), grade } };
}

/** A clip's scene effect at frame `frame` of the clip: stepped from the clip's first frame on what it hears. */
export function clipScene(def: EffectDefinition, type: string, clip: Clip, effect: Effect, frame: number, fps: number, version: string): SceneDraw | null {
  const spec = SCENES[type];
  if (!spec) return null;
  const inputOf = (k: number) => {
    const time = frameSourceTime(clip, k, fps);
    const values = effectValuesAt(def, effect, time, clip);
    return inputAt(k, fps, values, clipAudio(clip.id, time, values.source, sceneRequest(values), fps));
  };
  return sceneAt(spec, clip, effect.id, version, frame, `${clip.id}/${effect.id}`, inputOf);
}

const demoOwners = new Map<string, object>();

/** A scene with these values throughout, on made-up sound (cards, sheets). */
export function demoScene(type: string, values: ParamValues, instance: string, frame: number, fps: number): SceneDraw | null {
  const spec = SCENES[type];
  if (!spec) return null;
  let owner = demoOwners.get(instance);
  if (!owner) demoOwners.set(instance, (owner = {}));
  const inputOf = (k: number) => inputAt(k, fps, values, demoAudio(k / fps, sceneRequest(values)));
  return sceneAt(spec, owner, type, JSON.stringify(values), frame, instance, inputOf);
}
