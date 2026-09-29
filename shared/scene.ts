/**
 * What the canvas shows at a point in time: for each video track, the clip
 * under the playhead (and the source time it shows), or the transition
 * playing there with both of its sides. The preview (`src/components/preview`)
 * and the export (`server/render.ts`) both draw from this, with the same
 * compositor (`compositor.ts`), so they agree on every frame.
 */
import { EPS } from "./math.ts";
import { END_GUARD, clipAtTime, clipEnd, projectDuration, sourceTime, trackClips, videoTracks } from "./timeline.ts";
import { type TransitionWindow, trackTransitions, transitionAt, windowProgress } from "./transition-windows.ts";
import type { Clip, Project } from "./types.ts";

/** A clip on screen and the source time it shows. */
export interface Shown {
  clip: Clip;
  time: number;
}

export interface TrackPlan {
  /** The clip on screen on this video track, with the source time it should show. */
  current: Shown | null;
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

export interface TransitionPlan {
  window: TransitionWindow;
  progress: number;
  /** The outgoing and incoming pictures (null: nothing). */
  from: Shown | null;
  to: Shown | null;
}

/** The source range a clip can show (see `clipSourceRange`). */
export type RangeOf = (clip: Clip) => { min: number; max: number };

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
  range: RangeOf,
): TransitionPlan | null {
  let window = transitionAt(windows, t);
  if (!window && t >= projectDuration(project) - 1e-3) {
    window = windows.find((w) => Math.abs(w.end - t) < 1e-3) ?? null;
  }
  if (!window) return null;
  const side = (clip: Clip | null) => clip && { clip, time: handleTime(clip, t, range(clip)) };
  return { window, progress: windowProgress(window, t), from: side(window.from), to: side(window.to) };
}

/** What one video track shows. */
export type TrackShot =
  | { kind: "clip"; trackId: string; shown: Shown }
  | ({ kind: "transition"; trackId: string } & TransitionPlan);

/** Every video track's transition windows (computing them isn't free; reuse them for one project). */
export function transitionWindows(project: Project): Map<string, TransitionWindow[]> {
  return new Map(videoTracks(project).map((t) => [t.id, trackTransitions(project, t.id)]));
}

/** What one video track shows at `t`: a transition, else the clip there, else nothing. */
export function trackShotAt(
  project: Project,
  trackId: string,
  windows: TransitionWindow[],
  t: number,
  range: RangeOf,
): TrackShot | null {
  const transition = windows.length ? planTransition(project, windows, t, range) : null;
  if (transition) return { kind: "transition", trackId, ...transition };
  const { current } = planTrack(project, trackId, t);
  return current ? { kind: "clip", trackId, shown: current } : null;
}

/** What every video track shows at `t`, bottom layer first (the order to draw them in). */
export function sceneAt(
  project: Project,
  windows: Map<string, TransitionWindow[]>,
  t: number,
  range: RangeOf,
): TrackShot[] {
  const shots: TrackShot[] = [];
  const tracks = videoTracks(project);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const id = tracks[i].id;
    const shot = trackShotAt(project, id, windows.get(id) ?? [], t, range);
    if (shot) shots.push(shot);
  }
  return shots;
}
