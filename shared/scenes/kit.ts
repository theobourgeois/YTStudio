/**
 * What every scene's state is stepped with: its input at a frame, vaudio's audio follower (punch, the
 * beat's impulse, smoothed bands) on the sound's signals, and the small maths its scenes share. Rates
 * are per second and steps a frame long, so a scene moves the same at any frame rate.
 */
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

/** What every scene's view carries of its sound: the smoothed levels, punch, the beat, the bands. */
export function heard(frame: SceneFrame) {
  const f = frame.follow;
  return { level: r5(f.level), bass: r5(f.bass), mid: r5(f.mid), high: r5(f.high), punch: r5(f.punch), beat: r5(beatOf(f)), bands: frame.bands };
}

/** A number value of a scene's effect, or `fallback`. */
export const num = (values: ParamValues, key: string, fallback: number) => {
  const v = Number(values[key]);
  return Number.isFinite(v) ? v : fallback;
};

/** How fast a scene's own clock runs (its Speed), times the frame. */
export const sceneDt = (frame: SceneFrame) => frame.dt * Math.max(0, num(frame.values, "speed", 1));

/** Round to 5 decimals, so what's sent to the renderer is short and the same everywhere. */
export const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
