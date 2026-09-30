/**
 * Markers, like Premiere's: named points in time to cut, snap and animate to. Sequence
 * markers (`Project.markers`, and each nested sequence's own) sit on the timeline's ruler,
 * in timeline time. Clip markers (`Clip.markers`) are on a clip, in its source time, so
 * they stay on their frame when the clip moves, trims or splits (each half keeps them
 * all; only those inside a clip's range show).
 */
import { EPS, isFiniteNumber, roundTime, tidy } from "./math.ts";
import { clipEnd, createId, getClip, sourceAt, timelineTime } from "./timeline.ts";
import type { Clip, Marker, MarkerColor, Project } from "./types.ts";

/** The colours a marker can have, in the order menus list them (the first is a new marker's). */
export const MARKER_COLORS: readonly { value: MarkerColor; label: string }[] = [
  { value: "green", label: "Green" },
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "white", label: "White" },
];

export const DEFAULT_MARKER_COLOR: MarkerColor = "green";
const MAX_LABEL = 200;
/** Markers closer than this (seconds) are the same marker. */
const SAME_MARKER = 1e-3;

const cleanLabel = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL) : "");
const isColor = (raw: unknown): raw is MarkerColor => MARKER_COLORS.some((c) => c.value === raw);

/**
 * Valid markers from untrusted storage, in time order: one per id and per time, never
 * before `min` (0 on a timeline; a clip's can be anywhere in its source).
 */
export function normalizeMarkers(raw: unknown, min = -Infinity): Marker[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const out: Marker[] = [];
  for (const m of raw as Partial<Marker>[]) {
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id || ids.has(m.id) || !isFiniteNumber(m.time)) continue;
    const time = tidy(Math.max(min, m.time));
    if (out.some((o) => Math.abs(o.time - time) < SAME_MARKER)) continue;
    ids.add(m.id);
    const label = cleanLabel(m.label);
    out.push({ id: m.id, time, ...(label && { label }), ...(isColor(m.color) && m.color !== DEFAULT_MARKER_COLOR && { color: m.color }) });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** A marker's own fields, as an edit gives them. */
export interface MarkerPatch {
  time?: number;
  label?: string;
  color?: MarkerColor;
}

function patched(marker: Marker, patch: MarkerPatch, min: number): Marker {
  const next: Marker = { ...marker };
  if (patch.time !== undefined && isFiniteNumber(patch.time)) next.time = tidy(Math.max(min, patch.time));
  if (patch.label !== undefined) {
    const label = cleanLabel(patch.label);
    if (label) next.label = label;
    else delete next.label;
  }
  if (patch.color !== undefined && isColor(patch.color)) {
    if (patch.color === DEFAULT_MARKER_COLOR) delete next.color;
    else next.color = patch.color;
  }
  return next;
}

const sameMarker = (a: Marker, b: Marker) => a.time === b.time && a.label === b.label && a.color === b.color;
const sorted = (markers: Marker[]) => [...markers].sort((a, b) => a.time - b.time);

/** A list with `marker` in it (in time order), replacing any other marker at its time. */
function placed(markers: readonly Marker[], marker: Marker): Marker[] {
  return sorted([...markers.filter((m) => m.id !== marker.id && Math.abs(m.time - marker.time) >= SAME_MARKER), marker]);
}

const NONE: readonly Marker[] = [];

/** The sequence's markers, in time order (the same empty list whenever there are none, so it's safe in a store selector). */
export const sequenceMarkers = (project: Pick<Project, "markers">): readonly Marker[] => project.markers ?? NONE;

function withMarkers(project: Project, markers: Marker[]): Project {
  const next: Project = { ...project, markers };
  if (!markers.length) delete next.markers;
  return next;
}

/**
 * Add a sequence marker at timeline time `time` (Premiere's M). One already there (within
 * `tolerance` seconds, e.g. half a frame) is returned instead, so M on a marker doesn't
 * stack another on it.
 */
export function addMarker(project: Project, time: number, init: Omit<MarkerPatch, "time"> = {}, tolerance = SAME_MARKER): { project: Project; id: string } {
  const at = roundTime(Math.max(0, time));
  const there = sequenceMarkers(project).find((m) => Math.abs(m.time - at) < tolerance);
  if (there) return { project, id: there.id };
  const marker = patched({ id: createId("marker"), time: at }, init, 0);
  return { project: withMarkers(project, placed(sequenceMarkers(project), marker)), id: marker.id };
}

/** Change a sequence marker (move it, name it, colour it). The same project when nothing changes. */
export function updateMarker(project: Project, id: string, patch: MarkerPatch): Project {
  const marker = sequenceMarkers(project).find((m) => m.id === id);
  if (!marker) return project;
  const next = patched(marker, { ...patch, ...(patch.time !== undefined && { time: roundTime(patch.time) }) }, 0);
  if (sameMarker(next, marker)) return project;
  return withMarkers(project, placed(sequenceMarkers(project), next));
}

export function removeMarkers(project: Project, ids: readonly string[]): Project {
  const kept = sequenceMarkers(project).filter((m) => !ids.includes(m.id));
  return kept.length === sequenceMarkers(project).length ? project : withMarkers(project, kept);
}

// ---------------------------------------------------------------------------
// Clip markers (source time)
// ---------------------------------------------------------------------------

function withClipMarkers(project: Project, clip: Clip, markers: Marker[]): Project {
  const next: Clip = { ...clip, markers };
  if (!markers.length) delete next.markers;
  return { ...project, clips: project.clips.map((c) => (c === clip ? next : c)) };
}

/** A clip's markers that are inside what it shows, with their timeline times, in timeline order. */
export function clipMarkers(clip: Clip): { marker: Marker; time: number }[] {
  if (!clip.markers?.length) return [];
  const lo = Math.min(clip.in, clip.out) - EPS;
  const hi = Math.max(clip.in, clip.out) - EPS;
  return clip.markers
    .filter((m) => m.time >= lo && m.time < hi)
    .map((marker) => ({ marker, time: roundTime(timelineTime(clip, marker.time)) }))
    .filter((m) => m.time >= clip.start - EPS && m.time < clipEnd(clip) + EPS)
    .sort((a, b) => a.time - b.time);
}

/** Add a marker to a clip at timeline time `time` (inside the clip); one already on that frame is returned instead. */
export function addClipMarker(project: Project, clipId: string, time: number, init: Omit<MarkerPatch, "time"> = {}, tolerance = SAME_MARKER): { project: Project; id: string | null } {
  const clip = getClip(project, clipId);
  if (!clip || time < clip.start - EPS || time > clipEnd(clip) + EPS) return { project, id: null };
  const there = clipMarkers(clip).find((m) => Math.abs(m.time - time) < tolerance);
  if (there) return { project, id: there.marker.id };
  const marker = patched({ id: createId("marker"), time: tidy(sourceAt(clip, time)) }, init, -Infinity);
  return { project: withClipMarkers(project, clip, placed(clip.markers ?? [], marker)), id: marker.id };
}

/** Change one of a clip's markers; `patch.time` is a timeline time. */
export function updateClipMarker(project: Project, clipId: string, id: string, patch: MarkerPatch): Project {
  const clip = getClip(project, clipId);
  const marker = clip?.markers?.find((m) => m.id === id);
  if (!clip || !marker) return project;
  const next = patched(marker, { ...patch, ...(patch.time !== undefined && { time: tidy(sourceAt(clip, patch.time)) }) }, -Infinity);
  if (sameMarker(next, marker)) return project;
  return withClipMarkers(project, clip, placed(clip.markers!, next));
}

export function removeClipMarkers(project: Project, clipId: string, ids: readonly string[]): Project {
  const clip = getClip(project, clipId);
  const kept = clip?.markers?.filter((m) => !ids.includes(m.id));
  if (!clip || !kept || kept.length === clip.markers!.length) return project;
  return withClipMarkers(project, clip, kept);
}

// ---------------------------------------------------------------------------
// Every marker on the timeline
// ---------------------------------------------------------------------------

/** A marker as it sits on the timeline: the sequence's, or one of a clip's. */
export interface PlacedMarker {
  marker: Marker;
  /** Timeline time. */
  time: number;
  /** The clip it's on (absent: a sequence marker). */
  clipId?: string;
}

/** Every marker on the timeline (the sequence's and the clips' that show), in time order. `exclude`: clips to leave out. */
export function allMarkers(project: Project, exclude?: ReadonlySet<string>): PlacedMarker[] {
  const out: PlacedMarker[] = sequenceMarkers(project).map((marker) => ({ marker, time: marker.time }));
  for (const clip of project.clips) {
    if (!clip.markers?.length || exclude?.has(clip.id)) continue;
    for (const m of clipMarkers(clip)) out.push({ ...m, clipId: clip.id });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The nearest marker before (-1) or after (1) timeline time `t` (more than `tolerance` away), or null. */
export function adjacentMarker(project: Project, t: number, direction: -1 | 1, tolerance = SAME_MARKER): PlacedMarker | null {
  const markers = allMarkers(project);
  if (direction < 0) return markers.filter((m) => m.time < t - tolerance).at(-1) ?? null;
  return markers.find((m) => m.time > t + tolerance) ?? null;
}

/** The marker at timeline time `t` (within `tolerance`): a selected clip's first, then the sequence's. */
export function markerAt(project: Project, t: number, tolerance: number, clipIds: readonly string[] = []): PlacedMarker | null {
  const near = allMarkers(project).filter((m) => Math.abs(m.time - t) < tolerance);
  return near.find((m) => m.clipId && clipIds.includes(m.clipId)) ?? near.find((m) => !m.clipId) ?? near[0] ?? null;
}
