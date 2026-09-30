/**
 * Where transitions are on the timeline, and edits to them.
 *
 * A transition is stored on a clip edge (`Clip.transitionIn`/`transitionOut`).
 * At a cut (two clips on a video track that touch) there's one transition,
 * normally on the outgoing clip's out edge; an in-transition on the incoming
 * clip only counts there when the outgoing clip has none (it waits, unused,
 * for the clips to come apart again). On a free edge the transition plays
 * inside the clip, from or into nothing.
 *
 * A transition's "window" is the stretch of timeline it plays over. Across a
 * cut it borrows media from past the clips' edges (their handles), holding
 * the first or last frame when there isn't any, like Premiere. Windows are
 * shortened to fit their clips and never overlap on a track.
 */
import { defaultParams } from "./params.ts";
import { clipDuration, clipEnd, getClip, getTrack, trackClips, videoTracks } from "./timeline.ts";
import { type TransitionDefinition, createTransition, patchTransition, replaceTransitionType, transitionDefinition } from "./transitions.ts";
import type { Clip, ParamValues, Project, Transition } from "./types.ts";
import { roundTime } from "./math.ts";
import { EPS } from "./math.ts";

/** Clip edges this close together count as touching. */
const TOUCH = 1e-4;

export type ClipEdge = "in" | "out";

/** Which transition: the clip edge that stores it. */
export interface TransitionRef {
  clipId: string;
  edge: ClipEdge;
}

export interface TransitionWindow {
  ref: TransitionRef;
  transition: Transition;
  def: TransitionDefinition;
  trackId: string;
  /** Outgoing clip (null: the transition comes from nothing). */
  from: Clip | null;
  /** Incoming clip (null: it goes into nothing). */
  to: Clip | null;
  /** Timeline range it plays over. */
  start: number;
  end: number;
  /** The cut (or the free edge) it's attached to. */
  at: number;
}

export const sameRef = (a: TransitionRef | null | undefined, b: TransitionRef | null | undefined) =>
  !!a && !!b && a.clipId === b.clipId && a.edge === b.edge;

/** A ref as a string (React keys, `data-` attributes); `parseRefKey` reads it back. */
export const refKey = (ref: TransitionRef) => `${ref.clipId}:${ref.edge}`;

export function parseRefKey(key: string): TransitionRef | null {
  const [clipId, edge] = key.split(":");
  return clipId && (edge === "in" || edge === "out") ? { clipId, edge } : null;
}

/** The transition stored on a clip edge, if any (whether or not it plays; see `findWindow`). */
export function storedTransition(clip: Clip, edge: ClipEdge): Transition | undefined {
  return edge === "in" ? clip.transitionIn : clip.transitionOut;
}

const touches = (a: Clip, b: Clip) => Math.abs(clipEnd(a) - b.start) < TOUCH;
/** Two clips a transition can go between: touching, and neither an adjustment layer (which has no picture of its own). */
const joined = (a: Clip, b: Clip) => touches(a, b) && !a.adjustment && !b.adjustment;

/** How much of a cut transition comes after the cut. */
const afterCut = (t: Transition) => (t.alignment === "start" ? 1 : t.alignment === "end" ? 0 : 0.5);

/** The transitions on a track, in time order, as they play. Audio tracks have none. */
export function trackTransitions(project: Project, trackId: string): TransitionWindow[] {
  if (getTrack(project, trackId)?.kind !== "video") return [];
  const clips = trackClips(project, trackId);
  const windows: TransitionWindow[] = [];
  const add = (ref: TransitionRef, transition: Transition, from: Clip | null, to: Clip | null) => {
    const def = transitionDefinition(transition.type);
    if (!def) return;
    const d = transition.duration;
    let start: number;
    let end: number;
    let at: number;
    if (from && to) {
      at = to.start;
      const f = afterCut(transition);
      // Shorten to fit both clips, keeping the alignment.
      let len = d;
      if (f < 1) len = Math.min(len, clipDuration(from) / (1 - f));
      if (f > 0) len = Math.min(len, clipDuration(to) / f);
      start = at - len * (1 - f);
      end = at + len * f;
    } else if (to) {
      at = to.start;
      start = at;
      end = at + Math.min(d, clipDuration(to));
    } else {
      at = clipEnd(from!);
      end = at;
      start = at - Math.min(d, clipDuration(from!));
    }
    windows.push({ ref, transition, def, trackId, from, to, start, end, at });
  };

  clips.forEach((clip, i) => {
    if (clip.adjustment) return;
    const prev = i > 0 && joined(clips[i - 1], clip) ? clips[i - 1] : null;
    const next = i + 1 < clips.length && joined(clip, clips[i + 1]) ? clips[i + 1] : null;
    if (clip.transitionIn && !prev?.transitionOut) add({ clipId: clip.id, edge: "in" }, clip.transitionIn, prev, clip);
    if (clip.transitionOut) add({ clipId: clip.id, edge: "out" }, clip.transitionOut, clip, next);
  });

  // Where two windows would overlap (short clips), they meet halfway through the overlap.
  windows.sort((a, b) => a.start - b.start);
  for (let i = 1; i < windows.length; i++) {
    const a = windows[i - 1];
    const b = windows[i];
    if (b.start < a.end - EPS) {
      const mid = Math.max(a.start, Math.min(b.end, (a.end + b.start) / 2));
      a.end = mid;
      b.start = mid;
    }
  }
  return windows.filter((w) => w.end - w.start > EPS);
}

/** Every transition on every video track. */
export function projectTransitions(project: Project): TransitionWindow[] {
  return videoTracks(project).flatMap((t) => trackTransitions(project, t.id));
}

/** The window playing on a track at timeline time `t` (start inclusive, end exclusive). */
export function transitionAt(windows: TransitionWindow[], t: number): TransitionWindow | null {
  return windows.find((w) => t >= w.start - EPS && t < w.end - EPS) ?? null;
}

/** 0..1 through the window at timeline time `t`. */
export function windowProgress(w: TransitionWindow, t: number): number {
  return Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start)));
}

/** The window of a stored transition, if it currently plays. */
export function findWindow(project: Project, ref: TransitionRef): TransitionWindow | null {
  const clip = getClip(project, ref.clipId);
  if (!clip) return null;
  return trackTransitions(project, clip.trackId).find((w) => sameRef(w.ref, ref)) ?? null;
}

/**
 * Where a transition dropped at timeline time `time` on a track goes: the
 * nearer edge of the clip there (or of the clip that just ended, in a gap
 * right after it). A cut is always stored on the outgoing clip.
 */
export function transitionTargetAt(project: Project, trackId: string, time: number, reach = 0): TransitionRef | null {
  if (getTrack(project, trackId)?.kind !== "video") return null;
  const clips = trackClips(project, trackId);
  let best: { ref: TransitionRef; distance: number } | null = null;
  for (const clip of clips) {
    if (clip.adjustment) continue;
    const inside = time >= clip.start - reach && time <= clipEnd(clip) + reach;
    if (!inside) continue;
    const toIn = Math.abs(time - clip.start);
    const toOut = Math.abs(time - clipEnd(clip));
    const ref: TransitionRef = { clipId: clip.id, edge: toIn < toOut ? "in" : "out" };
    const distance = Math.min(toIn, toOut);
    if (!best || distance < best.distance) best = { ref, distance };
  }
  return best && canonicalRef(project, best.ref);
}

/** The edge a transition at `ref` is stored on: a cut belongs to the outgoing clip. */
export function canonicalRef(project: Project, ref: TransitionRef): TransitionRef {
  if (ref.edge === "out") return ref;
  const clip = getClip(project, ref.clipId);
  if (!clip) return ref;
  const prev = trackClips(project, clip.trackId).find((c) => c.id !== clip.id && joined(c, clip));
  return prev ? { clipId: prev.id, edge: "out" } : ref;
}

/**
 * The edit point (clip edge) nearest to `time`, on the given tracks (default:
 * every video track): where ⌘D-style "apply" puts a transition.
 */
export function nearestEdge(project: Project, time: number, trackIds?: string[]): TransitionRef | null {
  const tracks = trackIds ?? videoTracks(project).map((t) => t.id);
  let best: { ref: TransitionRef; distance: number } | null = null;
  for (const trackId of tracks) {
    if (getTrack(project, trackId)?.kind !== "video") continue;
    for (const clip of trackClips(project, trackId)) {
      if (clip.adjustment) continue;
      for (const [edge, t] of [["in", clip.start], ["out", clipEnd(clip)]] as const) {
        const distance = Math.abs(t - time);
        if (!best || distance < best.distance - EPS) best = { ref: { clipId: clip.id, edge }, distance };
      }
    }
  }
  return best && canonicalRef(project, best.ref);
}

// ---------------------------------------------------------------------------
// Edits (all return a new Project, or the same one when nothing changed)
// ---------------------------------------------------------------------------

const key = (edge: ClipEdge) => (edge === "in" ? "transitionIn" : "transitionOut");

function updateClip(project: Project, clipId: string, update: (c: Clip) => Clip): Project {
  let changed = false;
  const clips = project.clips.map((c) => {
    if (c.id !== clipId) return c;
    const next = update(c);
    changed ||= next !== c;
    return next;
  });
  return changed ? { ...project, clips } : project;
}

function withTransition(clip: Clip, edge: ClipEdge, transition: Transition | undefined): Clip {
  const k = key(edge);
  if (clip[k] === transition) return clip;
  const next = { ...clip };
  if (transition) next[k] = transition;
  else delete next[k];
  return next;
}

/**
 * Put a transition of `type` on a clip edge. An existing transition there is
 * replaced (keeping its length and alignment). At a cut it's stored on the
 * outgoing clip, and a waiting in-transition on the incoming clip is dropped.
 */
export function addTransition(project: Project, ref: TransitionRef, type: string): { project: Project; ref: TransitionRef | null } {
  const target = canonicalRef(project, ref);
  const clip = getClip(project, target.clipId);
  if (!clip || clip.adjustment || !transitionDefinition(type) || getTrack(project, clip.trackId)?.kind !== "video") {
    return { project, ref: null };
  }
  // Whatever plays at this edge now (possibly the incoming clip's in-transition).
  const current = findWindow(project, target) ?? (target.edge === "out" ? incomingWindow(project, clip) : null);
  const transition = current ? replaceTransitionType(current.transition, type) : createTransition(type);
  let p = updateClip(project, target.clipId, (c) => withTransition(c, target.edge, transition));
  if (target.edge === "out") {
    const next = cutPartner(p, clip);
    if (next?.transitionIn) p = updateClip(p, next.id, (c) => withTransition(c, "in", undefined));
  }
  return { project: p, ref: target };
}

/** The window of the in-transition of the clip right after `clip`, when it plays at their cut. */
function incomingWindow(project: Project, clip: Clip): TransitionWindow | null {
  const next = cutPartner(project, clip);
  return next ? findWindow(project, { clipId: next.id, edge: "in" }) : null;
}

/** The clip that starts where `clip` ends, on its track. */
function cutPartner(project: Project, clip: Clip): Clip | undefined {
  return trackClips(project, clip.trackId).find((c) => c.id !== clip.id && joined(clip, c));
}

export function removeTransition(project: Project, ref: TransitionRef): Project {
  return updateClip(project, ref.clipId, (c) => withTransition(c, ref.edge, undefined));
}

/** Change a transition's duration, alignment or parameters. */
export function setTransitionParams(project: Project, ref: TransitionRef, patch: ParamValues): Project {
  return updateClip(project, ref.clipId, (c) => {
    const t = storedTransition(c, ref.edge);
    if (!t) return c;
    const next = patchTransition(t, patch);
    return next === t ? c : withTransition(c, ref.edge, next);
  });
}

/** Put a transition's parameters (not its timing) back to their defaults. */
export function resetTransitionParams(project: Project, ref: TransitionRef, keys?: string[]): Project {
  const clip = getClip(project, ref.clipId);
  const t = clip && storedTransition(clip, ref.edge);
  const def = t && transitionDefinition(t.type);
  if (!t || !def) return project;
  const patch = defaultParams(def.params.filter((p) => !keys || keys.includes(p.key)));
  return setTransitionParams(project, ref, patch);
}

/**
 * The duration that makes a window's edge land on timeline time `time` while
 * dragging it (the other edge stays put for free edges; around a cut the
 * alignment is kept).
 */
export function durationForEdge(w: TransitionWindow, side: "start" | "end", time: number): number {
  const f = w.from && w.to ? afterCut(w.transition) : w.to ? 1 : 0;
  const reach = side === "end" ? time - w.at : w.at - time;
  const share = side === "end" ? f : 1 - f;
  if (share <= 0) return w.transition.duration;
  return roundTime(Math.max(0, reach) / share);
}
