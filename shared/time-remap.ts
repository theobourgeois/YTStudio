/**
 * Time remapping (After Effects' Time Remap, Premiere's speed keyframes): a clip's
 * Time Remapping keyframes say which source time it shows at each moment of its own clock,
 * so within one clip its speed can ramp up and down, freeze, or run backwards.
 *
 * A remapped clip plays at 1× in its own clock: its `in`/`out` and every keyframe (its
 * other effects' too) are in that clock, as for a clip that isn't remapped; only what's
 * shown is remapped (`mediaTime`). So moving, trimming and splitting it work as usual, and
 * its animations don't freeze or reverse with the picture. Past its last keyframe it holds
 * that frame, like After Effects.
 *
 * The speed at a moment is the remap curve's slope (`remapSpeed`): the graph editor's Speed
 * Graph shapes ramps, and the edits here make the usual ones: a speed per stretch between
 * keyframes (a velocity edit), a freeze frame, a section played backwards, or a whole
 * curve from a list of speeds.
 */
import { clampHandle, keyframeSpeed, keyframeValue } from "./keyframes.ts";
import { EPS, roundTime, tidy } from "./math.ts";
import { TIME_REMAP, isVideoEffect, remapKeys } from "./effects.ts";
import {
  END_GUARD,
  MIN_CLIP_DURATION,
  clipDuration,
  clipEnd,
  clipSpeed,
  getClip,
  replaceClips,
  sourceEdge,
  sourceTime,
  trackClips,
} from "./timeline.ts";
import type { Clip, Easing, Effect, Keyframe, Project } from "./types.ts";

/** Speeds a remapped stretch can be given (10% to 1000%, like Speed/Duration). */
export const MIN_REMAP_SPEED = 0.1;
export const MAX_REMAP_SPEED = 10;

/**
 * The media time a clip shows at source time `s` of its own clock: the remap curve's value
 * for a remapped clip (never before the media's start), `s` itself otherwise.
 */
export function mediaTime(clip: Pick<Clip, "effects">, s: number): number {
  const keys = remapKeys(clip);
  if (!keys) return s;
  return Math.max(0, keyframeValue(keys, s) as number);
}

/**
 * How fast (media seconds per timeline second, negative backwards) a clip plays its media at
 * source time `s`: the remap curve's slope, or its constant speed.
 */
export function remapSpeed(clip: Pick<Clip, "effects" | "speed" | "reversed">, s: number): number {
  const keys = remapKeys(clip);
  if (!keys) return clipSpeed(clip) * (clip.reversed ? -1 : 1);
  return keyframeSpeed(keys, s);
}

/** The lowest and highest media times a clip shows between source times `from` and `to`. */
export function mediaRange(clip: Clip, from = clip.in, to = clip.out): { min: number; max: number } {
  const keys = remapKeys(clip);
  if (!keys) return { min: Math.min(from, to), max: Math.max(from, to) };
  let min = Infinity;
  let max = -Infinity;
  const see = (s: number) => {
    const v = mediaTime(clip, s);
    min = Math.min(min, v);
    max = Math.max(max, v);
  };
  see(from);
  see(to);
  for (const k of keys) if (k.time > from && k.time < to) see(k.time);
  // A handle can overshoot between keyframes: sample the curve too.
  const steps = 64;
  for (let i = 1; i < steps; i++) see(from + ((to - from) * i) / steps);
  return { min, max };
}

// ---------------------------------------------------------------------------
// Turning it on and off
// ---------------------------------------------------------------------------

/** Every keyframe of every effect (not Time Remapping's) moved to `map(time)`. */
function remapEffectKeys(effects: Effect[], map: (time: number) => number): Effect[] {
  return effects.map((e) => {
    if (!e.keyframes || e.type === TIME_REMAP.type) return e;
    const keyframes = Object.fromEntries(
      Object.entries(e.keyframes).map(([k, keys]) => [k, keys.map((kf) => ({ ...kf, time: tidy(map(kf.time)) })).sort((a, b) => a.time - b.time)]),
    );
    return { ...e, keyframes };
  });
}

const remapEffect = (keys: Keyframe[]): Effect => ({ id: TIME_REMAP.type, type: TIME_REMAP.type, enabled: true, params: { time: 0 }, keyframes: { time: keys } });

/** `effects` with Time Remapping's keyframes set to `keys` (added after the built-in effects when missing). */
function withRemap(effects: Effect[], keys: Keyframe[]): Effect[] {
  const at = effects.findIndex((e) => e.type === TIME_REMAP.type);
  if (at >= 0) return effects.map((e, i) => (i === at ? { ...e, keyframes: { time: keys } } : e));
  // After the built-ins (and a text's or solid's own effects), before the video effects.
  const firstVideo = effects.findIndex(isVideoEffect);
  const i = firstVideo < 0 ? effects.length : firstVideo;
  return [...effects.slice(0, i), remapEffect(keys), ...effects.slice(i)];
}

/**
 * Turn Time Remapping on: two keyframes, at the clip's start and end, showing what it shows
 * there now, so nothing changes until they're moved. A clip that was sped up, slowed down or
 * reversed keeps playing the same (its speed moves into the curve, and its keyframes into
 * its clock, which then runs at 1×).
 */
export function enableTimeRemap(clip: Clip): Clip {
  if (remapKeys(clip)) return clip;
  const duration = clipDuration(clip);
  const start = clip.start;
  const end = clipEnd(clip);
  // The clock starts at the clip's in-point, so a clip at normal speed keeps its keyframes where they are.
  const c0 = clip.in;
  const toClock = (s: number) => c0 + ((clip.reversed ? clip.out - s : s - clip.in) / clipSpeed(clip));
  const keys: Keyframe[] = [
    { time: tidy(c0), value: tidy(sourceEdge(clip, start)), easing: "linear" },
    { time: tidy(c0 + duration), value: tidy(Math.max(0, sourceEdge(clip, end))), easing: "linear" },
  ];
  const { speed: _s, reversed: _r, keepPitch: _k, ...rest } = clip;
  return {
    ...rest,
    in: roundTime(c0),
    out: roundTime(c0 + duration),
    effects: withRemap(remapEffectKeys(clip.effects, toClock), keys),
  };
}

/**
 * Turn Time Remapping off: the clip plays on at 1× from what it showed at its start (for as
 * long as it lasted, or until its media ends), its keyframes back in media time.
 */
export function disableTimeRemap(clip: Clip, mediaDuration: number): Clip {
  if (!remapKeys(clip)) return clip;
  const from = Math.min(mediaTime(clip, clip.in), Math.max(0, mediaDuration - MIN_CLIP_DURATION));
  const length = Math.min(clip.out - clip.in, mediaDuration - from);
  const shift = from - clip.in;
  return {
    ...clip,
    in: roundTime(from),
    out: roundTime(from + Math.max(MIN_CLIP_DURATION, length)),
    effects: remapEffectKeys(
      clip.effects.filter((e) => e.type !== TIME_REMAP.type),
      (t) => t + shift,
    ),
  };
}

/** Turn remapping on or off for some clips (`durations`: their media's length, by clip id). */
export function setTimeRemap(project: Project, clipIds: readonly string[], on: boolean, durations: Readonly<Record<string, number>>): Project {
  const updated = new Map<string, Clip>();
  for (const id of clipIds) {
    const clip = getClip(project, id);
    if (!clip) continue;
    const next = on ? enableTimeRemap(clip) : disableTimeRemap(clip, durations[id] ?? Infinity);
    if (next !== clip) updated.set(id, next);
  }
  return rippleLengths(project, updated);
}

// ---------------------------------------------------------------------------
// Shaping it
// ---------------------------------------------------------------------------

/**
 * Put changed clips in, moving whatever comes after each on its track by how much longer or
 * shorter it got (like Speed/Duration's ripple), so nothing overlaps or leaves a gap.
 */
function rippleLengths(project: Project, updated: Map<string, Clip>): Project {
  if (updated.size === 0) return project;
  const all = new Map(updated);
  const tracks = new Set([...updated.values()].map((c) => c.trackId));
  for (const trackId of tracks) {
    let shift = 0;
    for (const c of trackClips(project, trackId)) {
      const changed = updated.get(c.id);
      if (!changed && shift !== 0) all.set(c.id, { ...c, start: roundTime(Math.max(0, c.start + shift)) });
      if (changed) shift += clipDuration(changed) - clipDuration(c);
    }
  }
  return replaceClips(project, all);
}

/** A remapped clip with new remap keyframes and every keyframe of its clock from `from` on moved by `by`, `out` too. */
function reshaped(clip: Clip, keys: Keyframe[], from: number, by: number): Clip {
  const move = (t: number) => (t >= from - 1e-7 ? t + by : t);
  return {
    ...clip,
    out: roundTime(clip.out + by),
    effects: withRemap(remapEffectKeys(clip.effects, move), keys),
  };
}

/** One stretch between two remap keyframes, in timeline and media time, and its average speed. */
export interface RemapSegment {
  /** Index of its first keyframe. */
  index: number;
  start: number;
  end: number;
  mediaFrom: number;
  mediaTo: number;
  /** Media seconds per second (negative: backwards, 0: a freeze). */
  speed: number;
}

/** The stretches between a remapped clip's keyframes (only those it shows). */
export function remapSegments(clip: Clip): RemapSegment[] {
  const keys = remapKeys(clip);
  if (!keys) return [];
  const toTimeline = (c: number) => clip.start + (c - clip.in);
  const out: RemapSegment[] = [];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [a, b] = [keys[i], keys[i + 1]];
    const dt = b.time - a.time;
    const hold = a.easing === "hold";
    out.push({
      index: i,
      start: roundTime(toTimeline(a.time)),
      end: roundTime(toTimeline(b.time)),
      mediaFrom: a.value as number,
      mediaTo: hold ? (a.value as number) : (b.value as number),
      speed: hold || !(dt > 0) ? 0 : ((b.value as number) - (a.value as number)) / dt,
    });
  }
  return out;
}

/**
 * A velocity edit: play the stretch after remap keyframe `index` at `speed` (its size: the
 * direction it runs stays), by moving the keyframes after it (and the clip's end, rippling
 * the track). A stretch that holds or doesn't move can't be sped up.
 */
export function setSegmentSpeed(project: Project, clipId: string, index: number, speed: number): Project {
  const clip = getClip(project, clipId);
  const keys = clip && remapKeys(clip);
  if (!clip || !keys || index < 0 || index + 1 >= keys.length) return project;
  const [a, b] = [keys[index], keys[index + 1]];
  const change = Math.abs((b.value as number) - (a.value as number));
  if (a.easing === "hold" || change < 1e-9) return project;
  const s = Math.min(MAX_REMAP_SPEED, Math.max(MIN_REMAP_SPEED, Math.abs(speed)));
  const length = Math.max(1 / 240, change / s);
  const by = tidy(a.time + length - b.time);
  if (Math.abs(by) < 1e-9) return project;
  const moved = keys.map((k, i) => (i > index ? { ...k, time: tidy(k.time + by) } : k));
  return rippleLengths(project, new Map([[clipId, reshaped(clip, moved, b.time, by)]]));
}

/** The remap keyframes of a clip, turning remapping on first when it's off. */
function remapped(clip: Clip): { clip: Clip; keys: Keyframe[] } {
  const on = enableTimeRemap(clip);
  return { clip: on, keys: remapKeys(on)! };
}

/** A keyframe on the curve at clock time `c` (its value there), unless one's already within a frame's hair. */
function withKeyAt(keys: Keyframe[], c: number): Keyframe[] {
  if (keys.some((k) => Math.abs(k.time - c) < 1e-4)) return keys;
  const value = tidy(keyframeValue(keys, c) as number);
  const before = [...keys].reverse().find((k) => k.time < c);
  // Inside a hold, the new keyframe holds too.
  const easing: Easing = before?.easing === "hold" ? "hold" : "linear";
  return [...keys, { time: tidy(c), value, easing }].sort((x, y) => x.time - y.time);
}

/**
 * A freeze frame (Premiere's Frame Hold / Insert Frame Hold Segment): at timeline time `t`
 * the clip holds its frame for `duration` seconds, then plays on from there; the clip gets
 * that much longer (rippling the track).
 */
export function addFreezeFrame(project: Project, clipId: string, t: number, duration: number): Project {
  const found = getClip(project, clipId);
  if (!found || !(duration > 0) || t < found.start - EPS || t > clipEnd(found) + EPS) return project;
  const { clip, keys } = remapped(found);
  const c = tidy(sourceTime(clip, t));
  const d = tidy(duration);
  const split = withKeyAt(keys, c);
  const at = split.findIndex((k) => Math.abs(k.time - c) < 1e-4);
  const held = split[at];
  const moved = split.map((k, i) => (i > at ? { ...k, time: tidy(k.time + d) } : k));
  // The keyframe at t holds for `duration`; one after it picks up where it left off.
  const next: Keyframe[] = [
    ...moved.slice(0, at),
    { ...held, easing: "hold" },
    { time: tidy(c + d), value: held.value, easing: held.easing === "hold" ? "hold" : "linear" },
    ...moved.slice(at + 1),
  ];
  return rippleLengths(project, new Map([[clipId, reshaped(clip, next, c + 1e-5, d)]]));
}

/**
 * Play a stretch backwards (Premiere's reverse speed keyframes): after the clip plays from
 * timeline time `from` to `to`, it plays that back in reverse and then forwards again,
 * and goes on; the clip gets twice that much longer (rippling the track).
 */
export function addReverseSection(project: Project, clipId: string, from: number, to: number): Project {
  const found = getClip(project, clipId);
  if (!found || !(to - from >= MIN_CLIP_DURATION / 2)) return project;
  const { clip, keys } = remapped(found);
  const a = tidy(Math.max(clip.in, sourceTime(clip, from)));
  const b = tidy(Math.min(clip.out, sourceTime(clip, to)));
  const d = tidy(b - a);
  if (!(d > 0)) return project;
  let split = withKeyAt(withKeyAt(keys, a), b);
  const va = keyframeValue(split, a) as number;
  const vb = keyframeValue(split, b) as number;
  const at = split.findIndex((k) => Math.abs(k.time - b) < 1e-4);
  split = split.map((k, i) => (i > at ? { ...k, time: tidy(k.time + 2 * d) } : k));
  const next: Keyframe[] = [
    ...split.slice(0, at + 1).map((k, i) => (i === at ? { ...k, easing: "linear" as const } : k)),
    { time: tidy(b + d), value: tidy(va), easing: "linear" },
    { time: tidy(b + 2 * d), value: tidy(vb), easing: split[at].easing },
    ...split.slice(at + 1),
  ];
  return rippleLengths(project, new Map([[clipId, reshaped(clip, next, b + 1e-5, 2 * d)]]));
}

/** One part of a remap made from speeds (`remapFromSpeeds`). */
export interface SpeedStep {
  /** Timeline seconds it lasts. */
  duration: number;
  /** Media seconds per second: 1 normal, 0.25 slow motion, 0 a freeze, negative backwards. */
  speed: number;
}

/**
 * A whole remap curve from speeds, like a speed ramp drawn as steps: starting at what the
 * clip shows at its start, each step plays at its speed for its duration. `ease` (0..1, the
 * handles' influence) smooths the changes of speed into ramps. The clip's length becomes the
 * steps' (rippling the track); media times stay inside `mediaDuration`.
 */
export function remapFromSpeeds(project: Project, clipId: string, steps: readonly SpeedStep[], mediaDuration: number, ease = 0): Project {
  const found = getClip(project, clipId);
  if (!found || steps.length === 0) return project;
  const { clip } = remapped(found);
  let c = clip.in;
  let v = mediaTime(clip, clip.in);
  const keys: Keyframe[] = [{ time: tidy(c), value: tidy(v), easing: "linear" }];
  const last = Math.max(0, mediaDuration - END_GUARD);
  for (const step of steps) {
    const d = Math.max(1 / 240, step.duration);
    c += d;
    v = Math.min(last, Math.max(0, v + step.speed * d));
    keys.push({ time: tidy(c), value: tidy(v), easing: "linear" });
  }
  if (ease > 0) {
    // Each inner keyframe eases between its two speeds: its handles reach `ease` of the way, in line (a smooth ramp).
    for (let i = 1; i + 1 < keys.length; i++) {
      const [p, k, n] = [keys[i - 1], keys[i], keys[i + 1]];
      const inSpeed = ((k.value as number) - (p.value as number)) / (k.time - p.time);
      const outSpeed = ((n.value as number) - (k.value as number)) / (n.time - k.time);
      const speed = (inSpeed + outSpeed) / 2;
      const handle = (a: Keyframe, b: Keyframe, side: "in" | "out") => {
        const change = (b.value as number) - (a.value as number);
        const dt = b.time - a.time;
        if (Math.abs(change) < 1e-9) return undefined;
        const reach = Math.min(1, Math.max(0.01, ease));
        return side === "out" ? clampHandle([reach, (speed * reach * dt) / change], "out") : clampHandle([1 - reach, 1 - (speed * reach * dt) / change], "in");
      };
      const hin = handle(p, k, "in");
      const hout = handle(k, n, "out");
      keys[i] = { ...k, ...(hin && { handleIn: hin }), ...(hout && { handleOut: hout }) };
    }
  }
  const length = c - clip.in;
  const next: Clip = { ...clip, out: roundTime(clip.in + length), effects: withRemap(clip.effects, keys) };
  return rippleLengths(project, new Map([[clipId, next]]));
}
