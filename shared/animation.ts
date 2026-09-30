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
import {
  DEFAULT_INFLUENCE,
  MIN_INFLUENCE,
  SAME_KEYFRAME,
  clampHandle,
  keyframeAt,
  keyframeDistance,
  keyframeValue,
  sanitizeSpatial,
  setKeyframe,
} from "./keyframes.ts";
import { tidy } from "./math.ts";
import { isAnimatable, sanitizeValue } from "./params.ts";
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

// ---------------------------------------------------------------------------
// Motion paths: a point's spatial handles (see `Keyframe.spatialIn`)
// ---------------------------------------------------------------------------

/**
 * Set (or with null, clear) one point keyframe's spatial handles, each relative to its
 * value. Absent sides are left alone.
 */
export function setKeyframeSpatial(
  project: Project,
  clipId: string,
  ref: KeyframeRef,
  handles: { in?: Vec2 | null; out?: Vec2 | null },
): Project {
  return updateKeys(project, clipId, ref.effectId, ref.key, (keys, effect) => {
    const at = keyframeAt(keys, ref.time);
    if (!at || !Array.isArray(at.value) || paramSpec(effectDefinition(effect.type)!, ref.key)?.kind !== "vec2") return null;
    const next: Keyframe = { ...at };
    for (const side of ["in", "out"] as const) {
      const h = handles[side];
      if (h === undefined) continue;
      const field = side === "in" ? "spatialIn" : "spatialOut";
      const clean = h === null ? undefined : sanitizeSpatial(h);
      if (clean) next[field] = clean;
      else delete next[field];
    }
    const same = (a?: Vec2, b?: Vec2) => (!a && !b) || (!!a && !!b && a[0] === b[0] && a[1] === b[1]);
    if (same(next.spatialIn, at.spatialIn) && same(next.spatialOut, at.spatialOut)) return null;
    return { keys: keys.map((k) => (k === at ? next : k)) };
  });
}

/**
 * Make point keyframes pass smoothly along their path (After Effects' Auto Bézier): each
 * one's handles run along the line between its neighbours, a third of the way to each.
 * With `smooth` false, back to straight lines (no handles).
 */
export function smoothMotionPath(project: Project, clipId: string, refs: readonly KeyframeRef[], smooth: boolean): Project {
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      let changed = false;
      const next = keys.map((k, i) => {
        if (!isAny(times)(k) || !Array.isArray(k.value)) return k;
        const { spatialIn: _i, spatialOut: _o, ...bare } = k;
        if (!smooth) {
          if (!k.spatialIn && !k.spatialOut) return k;
          changed = true;
          return bare;
        }
        const here = k.value as Vec2;
        const before = keys[i - 1]?.value;
        const after = keys[i + 1]?.value;
        const a = (Array.isArray(before) ? before : here) as Vec2;
        const b = (Array.isArray(after) ? after : here) as Vec2;
        const along: Vec2 = [b[0] - a[0], b[1] - a[1]];
        const length = Math.hypot(along[0], along[1]);
        if (!(length > 0)) return k;
        const reach = (to: Vec2) => Math.hypot(to[0] - here[0], to[1] - here[1]) / 3 / length;
        const smoothed: Keyframe = { ...bare };
        if (Array.isArray(before)) smoothed.spatialIn = [tidy(-along[0] * reach(a)), tidy(-along[1] * reach(a))];
        if (Array.isArray(after)) smoothed.spatialOut = [tidy(along[0] * reach(b)), tidy(along[1] * reach(b))];
        changed = true;
        return smoothed;
      });
      return changed ? { keys: next } : null;
    });
  }
  return p;
}

// ---------------------------------------------------------------------------
// Keyframe workflow: copy and paste, stretching, roving
// ---------------------------------------------------------------------------

/** Keyframes copied to paste elsewhere: each property's, with times from the first one copied. */
export interface CopiedKeyframes {
  items: { effectId: string; effectType: string; key: string; keys: Keyframe[] }[];
}

/** Copy keyframes of a clip (⌘C with keyframes selected). Null when none of `refs` exist. */
export function copyKeyframes(clip: Clip, refs: readonly KeyframeRef[]): CopiedKeyframes | null {
  const items: CopiedKeyframes["items"] = [];
  let first = Infinity;
  for (const { effectId, key, times } of byParam(refs).values()) {
    const effect = clip.effects.find((e) => e.id === effectId);
    const keys = (effect?.keyframes?.[key] ?? []).filter(isAny(times));
    if (!effect || !keys.length) continue;
    first = Math.min(first, keys[0].time);
    items.push({ effectId, effectType: effect.type, key, keys });
  }
  if (!items.length) return null;
  return { items: items.map((item) => ({ ...item, keys: item.keys.map((k) => ({ ...k, time: tidy(k.time - first) })) })) };
}

/**
 * Paste copied keyframes onto a clip, the first one landing at source time `time`, each
 * property's onto the same property (of the effect with the same id, else the first of
 * its type): across clips, or later on the same one. With `onto`, one copied property's
 * keyframes go onto that property instead, whatever it is, as long as it holds the same
 * kind of value (a number's onto a number, a point's onto a point). Values are checked
 * against the property they land on; keyframes already at those times are replaced.
 * Returns what was pasted (to select it).
 */
export function pasteKeyframes(
  project: Project,
  clipId: string,
  copied: CopiedKeyframes,
  time: number,
  onto?: { effectId: string; key: string },
): { project: Project; refs: KeyframeRef[] } {
  const clip = project.clips.find((c) => c.id === clipId);
  const refs: KeyframeRef[] = [];
  if (!clip || (onto && copied.items.length !== 1)) return { project, refs };
  let p = project;
  for (const item of copied.items) {
    const effect = onto
      ? clip.effects.find((e) => e.id === onto.effectId)
      : (clip.effects.find((e) => e.id === item.effectId && e.type === item.effectType) ?? clip.effects.find((e) => e.type === item.effectType));
    const key = onto?.key ?? item.key;
    const def = effect && effectDefinition(effect.type);
    const spec = def && paramSpec(def, key);
    if (!effect || !spec || !isAnimatable(spec)) continue;
    const pasted: Keyframe[] = [];
    for (const k of item.keys) {
      const value = sanitizeValue(spec, k.value);
      if (value === undefined) continue;
      const next: Keyframe = { ...k, time: tidy(time + k.time), value };
      // Spatial handles only mean something on points.
      if (spec.kind !== "vec2") {
        delete next.spatialIn;
        delete next.spatialOut;
      }
      pasted.push(next);
    }
    if (!pasted.length) continue;
    p = updateKeys(p, clipId, effect.id, key, (keys) => ({
      keys: [...keys.filter((k) => !pasted.some((n) => Math.abs(n.time - k.time) < SAME_KEYFRAME)), ...pasted].sort((a, b) => a.time - b.time),
    }));
    refs.push(...pasted.map((k) => ({ effectId: effect.id, key, time: k.time })));
  }
  return { project: p, refs };
}

/**
 * Stretch keyframes in time about source time `pivot` by `factor` (After Effects' ⌥-drag
 * of the first or last selected keyframe): their spacing scales, their order stays. One
 * that lands on a keyframe that isn't moving replaces it.
 */
export function scaleKeyframes(project: Project, clipId: string, refs: readonly KeyframeRef[], pivot: number, factor: number): Project {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-9) return project;
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      const moving = keys.filter(isAny(times));
      if (!moving.length) return null;
      const moved = moving.map((k) => ({ ...k, time: tidy(pivot + (k.time - pivot) * factor) }));
      // Squeezed onto each other: the first of them stays.
      const apart = moved.filter((k, i) => !moved.slice(0, i).some((m) => Math.abs(m.time - k.time) < SAME_KEYFRAME));
      const staying = keys.filter((k) => !moving.includes(k) && !apart.some((m) => Math.abs(m.time - k.time) < SAME_KEYFRAME));
      return { keys: [...staying, ...apart].sort((a, b) => a.time - b.time) };
    });
  }
  return p;
}

/**
 * After Effects' Rove Across Time, done once: of each property's selected keyframes, the
 * ones between the first and the last are moved in time so the value travels at one even
 * speed through all of them (by distance: along the motion path for a point), and passed
 * straight through (linear). Needs three or more selected keyframes of a number or point.
 */
export function roveKeyframes(project: Project, clipId: string, refs: readonly KeyframeRef[]): Project {
  let p = project;
  for (const { effectId, key, times } of byParam(refs).values()) {
    p = updateKeys(p, clipId, effectId, key, (keys) => {
      const chosen = keys.filter(isAny(times));
      if (chosen.length < 3) return null;
      const [first, last] = [keys.indexOf(chosen[0]), keys.indexOf(chosen.at(-1)!)];
      // Every keyframe between the two ends roves, selected or not (they're on the way).
      const span = keys.slice(first, last + 1);
      const lengths = span.slice(1).map((k, i) => keyframeDistance(span[i], k));
      const total = lengths.reduce((a, b) => a + b, 0);
      if (!(total > 0)) return null;
      let travelled = 0;
      const roved = span.map((k, i) => {
        if (i === 0 || i === span.length - 1) return k;
        travelled += lengths[i - 1];
        const time = tidy(span[0].time + ((span.at(-1)!.time - span[0].time) * travelled) / total);
        const { handleIn: _i, handleOut: _o, influence: _f, ...rest } = k;
        return { ...rest, time, easing: "linear" as const };
      });
      if (roved.every((k, i) => k.time === span[i].time && k.easing === span[i].easing && !span[i].handleIn && !span[i].handleOut)) return null;
      return { keys: [...keys.slice(0, first), ...roved, ...keys.slice(last + 1)].sort((a, b) => a.time - b.time) };
    });
  }
  return p;
}
