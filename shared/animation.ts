/**
 * Animating clip properties, like Premiere's Effect Controls: a parameter's
 * stopwatch turns animation on (a first keyframe at the playhead) or off, the
 * keyframe navigator adds or removes one at the playhead and jumps between
 * them, and keyframes can be moved, deleted or given another interpolation.
 * Changing an animated value (`setParams` with a time) keyframes it.
 *
 * Keyframes live in source time (`keyframes.ts`); helpers here convert to and
 * from the timeline. Edits return the same project when nothing changes.
 */
import { TIME_REMAP, effectDefinition, paramSpec, storedValuesAt, updateEffect } from "./effects.ts";
import { setTimeRemap } from "./time-remap.ts";
import { DEFAULT_INFLUENCE, MIN_INFLUENCE, SAME_KEYFRAME, clampHandle, keyframeAt, keyframeValue, setKeyframe } from "./keyframes.ts";
import { tidy } from "./math.ts";
import { isAnimatable } from "./params.ts";
import { clipEnd, sourceTime, timelineTime } from "./timeline.ts";
import type { Clip, Easing, Effect, Keyframe, Project, Vec2 } from "./types.ts";

/** One keyframe of one of a clip's parameters. */
export interface KeyframeRef {
  effectId: string;
  key: string;
  /** Source time. */
  time: number;
}

export const sameRef = (a: KeyframeRef, b: KeyframeRef) =>
  a.effectId === b.effectId && a.key === b.key && Math.abs(a.time - b.time) < SAME_KEYFRAME;

/** Whether a parameter of a clip can be animated (a number or a point of a known effect). */
export function canAnimate(effect: Effect, key: string): boolean {
  const def = effectDefinition(effect.type);
  const spec = def && paramSpec(def, key);
  return !!spec && isAnimatable(spec);
}

/** Timeline time of source time `s` of a clip. */
export { timelineTime };

/** Every keyframe time of a clip (source time, sorted, one per time), or of one of its parameters. */
export function keyframeTimes(clip: Clip, only?: { effectId: string; key?: string }): number[] {
  const times: number[] = [];
  for (const effect of clip.effects) {
    if (only && effect.id !== only.effectId) continue;
    for (const [key, keys] of Object.entries(effect.keyframes ?? {})) {
      if (only?.key !== undefined && key !== only.key) continue;
      for (const k of keys) if (!times.some((t) => Math.abs(t - k.time) < SAME_KEYFRAME)) times.push(k.time);
    }
  }
  return times.sort((a, b) => a - b);
}

/**
 * The source time an edit at timeline time `t` keyframes: the frame under the
 * playhead, or a keyframe of the clip that's within half a frame of it (so a
 * value is never keyframed a hair away from an existing keyframe).
 */
export function keyframeTime(clip: Clip, t: number, fps: number): number {
  const s = sourceTime(clip, t);
  const near = keyframeTimes(clip).find((k) => Math.abs(k - s) < 0.5 / fps);
  return near ?? tidy(sourceTime(clip, Math.round(t * fps) / fps));
}

/**
 * The timeline time of the clip's nearest keyframe before (-1) or after (1)
 * timeline time `t`, among those inside the clip (optionally of one
 * parameter); null when there's none. Half a frame counts as "on" `t`.
 */
export function adjacentKeyframe(
  clip: Clip,
  t: number,
  direction: -1 | 1,
  fps: number,
  only?: { effectId: string; key?: string },
): number | null {
  const tolerance = 0.5 / fps;
  const times = keyframeTimes(clip, only)
    .map((s) => timelineTime(clip, s))
    .filter((k) => k >= clip.start - 1e-6 && k <= clipEnd(clip) + 1e-6);
  if (direction < 0) return times.filter((k) => k < t - tolerance).at(-1) ?? null;
  return times.find((k) => k > t + tolerance) ?? null;
}

/** Rewrite one parameter's keyframes (an empty list turns animation off, keeping `staticValue`). */
function updateKeys(
  project: Project,
  clipId: string,
  effectId: string,
  key: string,
  update: (keys: Keyframe[], effect: Effect) => { keys: Keyframe[]; staticValue?: Keyframe["value"] } | null,
): Project {
  return updateEffect(project, clipId, effectId, (effect) => {
    if (!canAnimate(effect, key)) return effect;
    const before = effect.keyframes?.[key] ?? [];
    const result = update(before, effect);
    if (!result || result.keys === before) return effect;
    const { [key]: _, ...others } = effect.keyframes ?? {};
    const keyframes = result.keys.length ? { ...others, [key]: result.keys } : others;
    const next: Effect = { ...effect };
    if (Object.keys(keyframes).length) next.keyframes = keyframes;
    else delete next.keyframes;
    if (!result.keys.length && result.staticValue !== undefined) next.params = { ...effect.params, [key]: result.staticValue };
    return next;
  });
}

/** The value a parameter shows at source time `time` (keyframed or static). */
function valueAt(effect: Effect, key: string, time: number) {
  const def = effectDefinition(effect.type)!;
  return storedValuesAt(def, effect, time)[key];
}

/**
 * Premiere's stopwatch: turning animation on keyframes the current value at
 * source time `time`; turning it off drops the keyframes and keeps the value
 * showing at `time`.
 */
export function setAnimated(project: Project, clipId: string, effectId: string, key: string, time: number, on: boolean): Project {
  // Time Remapping's stopwatch turns remapping itself on or off (see `time-remap.ts`).
  if (effectId === TIME_REMAP.type) return setTimeRemap(project, [clipId], on, {});
  return updateKeys(project, clipId, effectId, key, (keys, effect) => {
    if (on === keys.length > 0) return null;
    if (!on) return { keys: [], staticValue: valueAt(effect, key, time) };
    return { keys: [{ time: tidy(time), value: valueAt(effect, key, time), easing: "linear" }] };
  });
}

/**
 * The navigator's "Add/Remove Keyframe": a keyframe of the value showing at
 * source time `time`, or none if there was one (removing the last one ends
 * the animation at its value).
 */
export function toggleKeyframe(project: Project, clipId: string, effectId: string, key: string, time: number): Project {
  return updateKeys(project, clipId, effectId, key, (keys, effect) => {
    const at = keyframeAt(keys, time);
    if (at) return { keys: keys.filter((k) => k !== at), staticValue: at.value };
    return { keys: setKeyframe(keys, time, valueAt(effect, key, time)) };
  });
}

/** Group refs by parameter. */
function byParam(refs: readonly KeyframeRef[]): Map<string, { effectId: string; key: string; times: number[] }> {
  const groups = new Map<string, { effectId: string; key: string; times: number[] }>();
  for (const r of refs) {
    const id = `${r.effectId}\u0000${r.key}`;
    const group = groups.get(id) ?? { effectId: r.effectId, key: r.key, times: [] };
    group.times.push(r.time);
    groups.set(id, group);
  }
  return groups;
}

const isAny = (times: number[]) => (k: Keyframe) => times.some((t) => Math.abs(t - k.time) < SAME_KEYFRAME);

/**
 * Delete keyframes. A parameter left without any stops animating, keeping the
 * value it showed at source time `time`.
 */
export function deleteKeyframes(project: Project, clipId: string, refs: readonly KeyframeRef[], time: number): Project {
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      const kept = keys.filter((k) => !isAny(times)(k));
      if (kept.length === keys.length) return null;
      return { keys: kept, staticValue: keys.length ? keyframeValue(keys, time) : undefined };
    });
  }
  return p;
}

/**
 * Move keyframes by `delta` seconds. One that lands on another keyframe of
 * its parameter replaces it.
 */
export function moveKeyframes(project: Project, clipId: string, refs: readonly KeyframeRef[], delta: number): Project {
  if (Math.abs(delta) < 1e-9) return project;
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      const moving = keys.filter(isAny(times));
      if (!moving.length) return null;
      const moved = moving.map((k) => ({ ...k, time: tidy(k.time + delta) }));
      const staying = keys.filter((k) => !moving.includes(k) && !moved.some((m) => Math.abs(m.time - k.time) < SAME_KEYFRAME));
      return { keys: [...staying, ...moved].sort((a, b) => a.time - b.time) };
    });
  }
  return p;
}

/** Give keyframes another interpolation. */
export function setKeyframeEasing(project: Project, clipId: string, refs: readonly KeyframeRef[], easing: Easing): Project {
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      if (!keys.some((k) => isAny(times)(k) && (k.easing !== easing || k.handleIn || k.handleOut))) return null;
      return { keys: keys.map((k) => (isAny(times)(k) ? { ...withoutHandles(k), easing } : k)) };
    });
  }
  return p;
}

/**
 * Set how far keyframes' eased handles reach (After Effects' keyframe velocity
 * influence, 0.01..1; 1/3 is Premiere's ease). Linear sides ignore it.
 */
export function setKeyframeInfluence(project: Project, clipId: string, refs: readonly KeyframeRef[], influence: number): Project {
  const value = tidy(Math.min(1, Math.max(MIN_INFLUENCE, influence)));
  const same = (k: Keyframe) => Math.abs((k.influence ?? DEFAULT_INFLUENCE) - value) < 1e-6;
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      if (!keys.some((k) => isAny(times)(k) && (!same(k) || k.handleIn || k.handleOut))) return null;
      return {
        keys: keys.map((k) => {
          if (!isAny(times)(k)) return k;
          const { influence: _, ...rest } = withoutHandles(k);
          return Math.abs(value - DEFAULT_INFLUENCE) < 1e-6 ? rest : { ...rest, influence: value };
        }),
      };
    });
  }
  return p;
}

/** A keyframe without the graph editor's handles (back to what its easing says). */
function withoutHandles(k: Keyframe): Keyframe {
  if (!k.handleIn && !k.handleOut) return k;
  const { handleIn: _i, handleOut: _o, ...rest } = k;
  return rest;
}

/**
 * The graph editor: set (or with null, clear) one keyframe's Bézier handles (see
 * `Keyframe.handleIn`), each clamped into its segment. Absent sides are left alone.
 */
export function setKeyframeHandles(
  project: Project,
  clipId: string,
  ref: KeyframeRef,
  handles: { in?: Vec2 | null; out?: Vec2 | null },
): Project {
  return updateKeys(project, clipId, ref.effectId, ref.key, (keys) => {
    const at = keyframeAt(keys, ref.time);
    if (!at) return null;
    const next: Keyframe = { ...at };
    for (const side of ["in", "out"] as const) {
      const h = handles[side];
      if (h === undefined) continue;
      const field = side === "in" ? "handleIn" : "handleOut";
      if (h === null) delete next[field];
      else next[field] = clampHandle(h, side);
    }
    const same = (a?: Vec2, b?: Vec2) => (!a && !b) || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
    if (same(next.handleIn, at.handleIn) && same(next.handleOut, at.handleOut)) return null;
    return { keys: keys.map((k) => (k === at ? next : k)) };
  });
}

/**
 * Set one keyframe's value (the graph editor's vertical drag). Values are sanitised
 * like any stored value by the caller's spec (numbers here).
 */
export function setKeyframeValue(project: Project, clipId: string, ref: KeyframeRef, value: Keyframe["value"]): Project {
  return updateKeys(project, clipId, ref.effectId, ref.key, (keys) => {
    const at = keyframeAt(keys, ref.time);
    if (!at || at.value === value) return null;
    return { keys: keys.map((k) => (k === at ? { ...k, value } : k)) };
  });
}

/** Every keyframe of a clip (optionally only those at source time `time`, or of one effect). */
export function clipKeyframes(clip: Clip, filter: { time?: number; effectId?: string } = {}): KeyframeRef[] {
  const refs: KeyframeRef[] = [];
  for (const effect of clip.effects) {
    if (filter.effectId !== undefined && effect.id !== filter.effectId) continue;
    for (const [key, keys] of Object.entries(effect.keyframes ?? {})) {
      for (const k of keys) {
        if (filter.time !== undefined && Math.abs(k.time - filter.time) >= SAME_KEYFRAME) continue;
        refs.push({ effectId: effect.id, key, time: k.time });
      }
    }
  }
  return refs;
}
