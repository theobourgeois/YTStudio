/**
 * What every scene's state is stepped with: its input at a frame, vaudio's audio follower (punch, the
 * beat's impulse, smoothed bands) on the sound's signals, and the small maths its scenes share. Rates
 * are per second and steps a frame long, so a scene moves the same at any frame rate.
 */
import type { UniformValue } from "../transition-gl.ts";
import type { ParamValues } from "../types.ts";

/** A scene's input at a frame of its clip. */
export interface SceneInput {
  frame: number;
  /** Seconds since its clip started, and the seconds a frame lasts. */
  time: number;
  dt: number;
  /** Its effect's values at this frame. */
  values: ParamValues;
  /** The sound's levels, 0..1 (times the effect's Reactivity). */
  level: number;
  bass: number;
  mid: number;
  high: number;
  /** A hit that started during this frame: how hard (0: none). */
  hit: number;
  /** 32 bands of the spectrum, low to high, 0..1. */
  bands: number[];
}

/** vaudio's audio follower: smoothed levels, the low end's punch, the beat. */
export interface Follow {
  level: number;
  bass: number;
  mid: number;
  high: number;
  /** A fast-attack, slow-release envelope of the low end: punchy motion. */
  punch: number;
  /** An impulse, 1 on a hit and falling over a quarter-second (squared when read: `beatOf`). */
  beat: number;
  /** Hits so far, and whether one landed on this frame. */
  beatCount: number;
  onBeat: boolean;
  sinceBeat: number;
}

/** A scene's input with its follower, as its `step` and `view` get it. */
export type SceneFrame = SceneInput & { follow: Follow };

/** Frame-rate independent approach: `tau` is the time to close ~63% of the gap. */
export const smoothing = (dt: number, tau: number) => 1 - Math.exp(-Math.max(dt, 0) / tau);
export const smoothTo = (current: number, target: number, dt: number, tau: number) => current + (target - current) * smoothing(dt, tau);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-5));
  return t * t * (3 - 2 * t);
}
/** `value` wrapped into [min, min + span). */
export function wrap(value: number, min: number, span: number): number {
  const shifted = (value - min) % span;
  return (shifted < 0 ? shifted + span : shifted) + min;
}

/** The next number (0..1) of a seeded generator (mulberry32) whose state is `rng.seed`. */
export function random(rng: { seed: number }): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Hits closer together than this are one (vaudio's onset gate). */
const MIN_BEAT_GAP = 0.16;

export const follow = {
  init: (): Follow => ({ level: 0, bass: 0, mid: 0, high: 0, punch: 0, beat: 0, beatCount: 0, onBeat: false, sinceBeat: 1 }),
  step(a: Follow, input: SceneInput): void {
    const { dt } = input;
    const k = smoothing(dt, 0.12);
    a.level += (input.level - a.level) * k;
    a.bass += (input.bass - a.bass) * k;
    a.mid += (input.mid - a.mid) * k;
    a.high += (input.high - a.high) * k;
    const drive = Math.max(input.bass, input.mid * 0.55);
    a.punch += (drive - a.punch) * smoothing(dt, drive > a.punch ? 0.012 : 0.16);
    a.sinceBeat += dt;
    a.onBeat = input.hit > 0 && a.sinceBeat > MIN_BEAT_GAP;
    if (a.onBeat) {
      a.sinceBeat = 0;
      a.beat = 1;
      a.beatCount += 1;
    } else a.beat = Math.max(0, a.beat - dt * 4);
  },
};

/** The beat's impulse as scenes read it. */
export const beatOf = (f: Follow) => f.beat * f.beat;

/** A number value of a scene's effect, or `fallback`. */
export const num = (values: ParamValues, key: string, fallback: number) => {
  const v = Number(values[key]);
  return Number.isFinite(v) ? v : fallback;
};

/** How fast a scene's own clock runs (its Speed), times the frame. */
export const sceneDt = (frame: SceneFrame) => frame.dt * Math.max(0, num(frame.values, "speed", 1));

/** Uniforms, by type. */
export const float = (name: string, value: number): UniformValue => ({ name, type: "float", value });
export const vec2 = (name: string, value: readonly number[]): UniformValue => ({ name, type: "vec2", value: [value[0], value[1]] });
export const vec3 = (name: string, value: readonly number[]): UniformValue => ({ name, type: "vec3", value: [value[0], value[1], value[2]] });
export const vec4 = (name: string, value: readonly number[]): UniformValue => ({ name, type: "vec4", value: [value[0], value[1], value[2], value[3]] });

export type Vec3 = [number, number, number];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));
export const mix3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * A camera as the uniforms `SCENE_GLSL` reads (`camPos`, `camFwd`, `camRight`, `camUp`, `camLens`): at `pos`, looking
 * at `target`, turned `roll` radians about its view, seeing `fov` degrees across the frame's shorter side. Up is +Y
 * unless `up` says otherwise (a camera that turns through any direction gives its own).
 */
export function cameraUniforms(pos: Vec3, target: Vec3, roll: number, fov: number, up: Vec3 = [0, 1, 0]): UniformValue[] {
  const fwd = normalize(sub(target, pos));
  let right = cross(fwd, up);
  if (length(right) < 1e-6) right = cross(fwd, [1, 0, 0]);
  right = normalize(right);
  const upward = cross(right, fwd);
  const [c, s] = [Math.cos(roll), Math.sin(roll)];
  const r: Vec3 = add(scale(right, c), scale(upward, s));
  const u: Vec3 = sub(scale(upward, c), scale(right, s));
  return [vec3("camPos", pos), vec3("camFwd", fwd), vec3("camRight", r), vec3("camUp", u), float("camLens", Math.tan(((fov * Math.PI) / 180) / 2))];
}

/** The sound every scene's GLSL can read (`sLevel`, `sBass`, `sMid`, `sHigh`, `sPunch`, `sBeat`), followed and smoothed. */
export function soundUniforms(frame: SceneFrame): UniformValue[] {
  const f = frame.follow;
  return [float("sLevel", f.level), float("sBass", f.bass), float("sMid", f.mid), float("sHigh", f.high), float("sPunch", f.punch), float("sBeat", beatOf(f))];
}
