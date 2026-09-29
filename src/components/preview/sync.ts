/**
 * Pure "what should every media element be doing at time t" logic for the
 * preview. The imperative side (media elements, store subscriptions) lives in
 * `engine.ts` / `media-slot.ts`; everything here is deterministic and tested.
 */
import type { Clip, Project } from "@shared/types";
import { END_GUARD, clipAtTime, clipEnd, getTrack, projectDuration, sourceTime, trackClips } from "@shared/timeline";
import { type TransitionWindow, transitionAt, windowProgress } from "@shared/transition-windows";
import { EPS } from "@shared/math";

/** Drift (seconds) beyond which a playing element is re-seeked instead of nudged. */
export const SEEK_DRIFT = 0.25;
/** Drift below which a playing element is left alone. */
const NUDGE_DRIFT = 0.03;
/** Maximum playback-rate deviation used to converge small drift. */
const MAX_NUDGE = 0.08;

export interface TrackPlan {
  /** The clip on screen on this video track, with the source time it should show. */
  current: { clip: Clip; time: number } | null;
  /** The clip after the playhead on this track, to be preloaded at its in-point. */
  next: Clip | null;
}

/**
 * The video track's clip under the playhead and the next one after the
 * playhead. When the playhead sits exactly at the end of the project and the
 * track reaches that far, its last clip's final frame is held rather than
 * dropping to what's underneath.
 */
export function planTrack(project: Project, trackId: string, t: number): TrackPlan {
  const clips = trackClips(project, trackId);
  let clip = clipAtTime(project, trackId, t);
  if (!clip && clips.length) {
    const last = clips[clips.length - 1];
    const end = clipEnd(last);
    if (Math.abs(t - end) < 1e-3 && t >= projectDuration(project) - 1e-3) clip = last;
  }
  const next = clips.find((c) => c.start > t + EPS && c.id !== clip?.id) ?? null;
  return { current: clip ? { clip, time: sourceTime(clip, t) } : null, next };
}

/** A clip on screen and the source time it shows. */
export interface Shown {
  clip: Clip;
  time: number;
}

export interface TransitionPlan {
  window: TransitionWindow;
  progress: number;
  /** The outgoing and incoming pictures (null: nothing). */
  from: Shown | null;
  to: Shown | null;
}

/**
 * Source time a transition shows of `clip` at timeline time `t`: it may run
 * past the clip's in/out points into the media's handles, and holds the first
 * or last frame where the media ends (`range` is the clip's source range, see
 * `sourceRange`).
 */
export function handleTime(clip: Clip, t: number, range: { min: number; max: number }): number {
  const s = clip.in + (t - clip.start);
  return Math.min(Math.max(s, range.min), Math.max(range.min, range.max - END_GUARD));
}

/**
 * The transition playing at time `t` among a track's windows, if any, with
 * both of its sides. Parked at the very end of the project, a transition that
 * ends there shows its last frame.
 */
export function planTransition(
  project: Project,
  windows: TransitionWindow[],
  t: number,
  range: (clip: Clip) => { min: number; max: number },
): TransitionPlan | null {
  let window = transitionAt(windows, t);
  if (!window && t >= projectDuration(project) - 1e-3) {
    window = windows.find((w) => Math.abs(w.end - t) < 1e-3) ?? null;
  }
  if (!window) return null;
  const side = (clip: Clip | null) => clip && { clip, time: handleTime(clip, t, range(clip)) };
  return { window, progress: windowProgress(window, t), from: side(window.from), to: side(window.to) };
}

export interface AudioPlan {
  clip: Clip;
  /** The playhead is inside the clip. */
  active: boolean;
  /** Where the element should be parked: the playhead position when active, the in-point
   *  while the clip is still ahead, `null` once it has passed (leave it alone). */
  time: number | null;
}

/** Every clip on an audio track, with its desired state at time `t`. */
export function planAudio(project: Project, t: number): AudioPlan[] {
  return project.clips
    .filter((c) => getTrack(project, c.trackId)?.kind === "audio")
    .map((clip) => {
      const active = t >= clip.start - EPS && t < clipEnd(clip) - EPS;
      const time = active ? sourceTime(clip, t) : t < clip.start ? clip.in : null;
      return { clip, active, time };
    });
}

/** Clip ids held by the two double-buffered video elements. */
export type SlotIds = readonly [string | null, string | null];

/**
 * Decide which video element holds the current clip and which preloads the
 * next one, moving as little as possible: a clip already loaded in an element
 * stays there (so at a cut the preloaded element simply becomes the visible
 * one), and an element with nothing new to do keeps its old clip in case the
 * playhead comes back.
 */
export function assignSlots(slots: SlotIds, currentId: string | null, nextId: string | null): SlotIds {
  const cur = currentId === null ? -1 : slots.indexOf(currentId);
  const nxt = nextId === null ? -1 : slots.indexOf(nextId);
  const out: [string | null, string | null] = [slots[0], slots[1]];
  if (cur !== -1) {
    if (nextId !== null) out[1 - cur] = nextId;
  } else if (nxt !== -1) {
    if (currentId !== null) out[1 - nxt] = currentId;
  } else {
    if (currentId !== null) out[0] = currentId;
    if (nextId !== null) out[currentId === null ? 0 : 1] = nextId;
  }
  return out;
}

/**
 * How a playing element should react to `drift` (element time minus expected
 * time): re-seek when far off. A silent element may also steer its playback
 * rate slightly so it converges without the stutter a seek would cause; an
 * audible one never does, because rate changes time-stretch its sound (warble,
 * crackle). Its drift comes from start/seek latency, not clock skew, so it
 * stays roughly constant and well inside SEEK_DRIFT.
 */
export function playbackCorrection(drift: number, audible: boolean): { seek: boolean; rate: number } {
  if (Math.abs(drift) > SEEK_DRIFT) return { seek: true, rate: 1 };
  if (audible || Math.abs(drift) < NUDGE_DRIFT) return { seek: false, rate: 1 };
  const nudge = Math.min(MAX_NUDGE, Math.abs(drift) * 0.5);
  return { seek: false, rate: drift > 0 ? 1 - nudge : 1 + nudge };
}
