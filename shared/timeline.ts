/**
 * Pure, immutable timeline operations. Every function takes a `Project` and
 * returns a new one (or the same instance when nothing changed), so they are
 * trivially undoable and unit-testable. See the rules documented on `Project`.
 */
import type {
  AspectRatio,
  Clip,
  ExportResolution,
  MediaAsset,
  Project,
  Track,
} from "./types.ts";

export const MAIN_TRACK_ID = "main";
/** Shortest clip the editor allows (seconds). */
export const MIN_CLIP_DURATION = 0.1;
const EPS = 1e-6;

/** Round to microseconds so repeated edits never accumulate float noise. */
export const roundTime = (t: number) => Math.round(t * 1e6) / 1e6;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createDefaultProject(): Project {
  return {
    version: 1,
    name: "Untitled",
    settings: { aspectRatio: "9:16", fps: 30, background: "#000000" },
    tracks: [
      { id: MAIN_TRACK_ID, kind: "video", name: "Video", muted: false },
      { id: "audio_1", kind: "audio", name: "Audio 1", muted: false },
    ],
    clips: [],
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const clipDuration = (c: Clip) => c.out - c.in;
export const clipEnd = (c: Clip) => c.start + c.out - c.in;

export function getTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

export function getClip(project: Project, clipId: string): Clip | undefined {
  return project.clips.find((c) => c.id === clipId);
}

/** Clips on a track, sorted by start time (stable). */
export function trackClips(project: Project, trackId: string): Clip[] {
  return project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** End of the last clip on any track (0 for an empty timeline). */
export function projectDuration(project: Project): number {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, clipEnd(c));
  return roundTime(end);
}

/** The clip on `trackId` covering `time` (start inclusive, end exclusive). */
export function clipAtTime(project: Project, trackId: string, time: number): Clip | undefined {
  return project.clips.find(
    (c) => c.trackId === trackId && time >= c.start - EPS && time < clipEnd(c) - EPS,
  );
}

/** Whether an asset may be placed on a track of the given kind. */
export function canPlaceOnTrack(asset: Pick<MediaAsset, "hasVideo" | "hasAudio">, track: Track) {
  return track.kind === "video" ? asset.hasVideo : asset.hasAudio;
}

/**
 * Insertion index for the magnetic main track when something is dropped with
 * its centre at `time`: the index of the first clip whose midpoint lies after
 * `time`. Positions are the clips' *current* positions (excluding `excludeId`).
 */
export function mainInsertIndex(project: Project, time: number, excludeId?: string): number {
  const clips = trackClips(project, MAIN_TRACK_ID).filter((c) => c.id !== excludeId);
  const i = clips.findIndex((c) => time < c.start + clipDuration(c) / 2);
  return i === -1 ? clips.length : i;
}

/**
 * The start time closest to `desired` at which a clip of `duration` fits among
 * `clips` without overlapping any of them (and not before 0).
 */
export function findFreeStart(
  clips: Clip[],
  desired: number,
  duration: number,
  excludeId?: string,
): number {
  const others = clips.filter((c) => c.id !== excludeId);
  const fits = (s: number) =>
    s >= -EPS &&
    others.every((o) => s + duration <= o.start + EPS || s >= clipEnd(o) - EPS);
  const candidates = [
    Math.max(0, desired),
    ...others.map(clipEnd),
    ...others.map((o) => o.start - duration),
  ];
  let best = Infinity;
  for (const s of candidates) {
    if (fits(s) && Math.abs(s - desired) < Math.abs(best - desired)) best = s;
  }
  // Unreachable in practice (the end of the last clip always fits), but be safe.
  if (!Number.isFinite(best)) best = Math.max(0, ...others.map(clipEnd));
  return roundTime(Math.max(0, best));
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** Candidate snap targets: 0, the playhead and every clip edge (except `excludeClipId`). */
export function snapPoints(project: Project, playhead: number, excludeClipId?: string): number[] {
  const pts = new Set<number>([0, roundTime(playhead)]);
  for (const c of project.clips) {
    if (c.id === excludeClipId) continue;
    pts.add(roundTime(c.start));
    pts.add(roundTime(clipEnd(c)));
  }
  return [...pts];
}

/** Snap `time` to the nearest point within `threshold`; returns the point used, if any. */
export function snapTime(
  time: number,
  points: number[],
  threshold: number,
): { time: number; snappedTo: number | null } {
  let best: number | null = null;
  for (const p of points) {
    const d = Math.abs(p - time);
    if (d <= threshold && (best === null || d < Math.abs(best - time))) best = p;
  }
  return best === null ? { time, snappedTo: null } : { time: best, snappedTo: best };
}

// ---------------------------------------------------------------------------
// Mutations (all return a new Project)
// ---------------------------------------------------------------------------

function withClips(project: Project, clips: Clip[]): Project {
  return { ...project, clips };
}

/** Lay the main track out back-to-back from 0, preserving the given order. */
function layoutMain(project: Project, ordered: Clip[]): Project {
  let t = 0;
  const placed = new Map<string, Clip>();
  for (const c of ordered) {
    placed.set(c.id, { ...c, trackId: MAIN_TRACK_ID, start: roundTime(t) });
    t += clipDuration(c);
  }
  const rest = project.clips.filter((c) => c.trackId !== MAIN_TRACK_ID && !placed.has(c.id));
  return withClips(project, [...ordered.map((c) => placed.get(c.id)!), ...rest]);
}

/** Re-pack the magnetic main track (closes gaps, keeps order). */
export function packMain(project: Project): Project {
  return layoutMain(project, trackClips(project, MAIN_TRACK_ID));
}

/**
 * Add a new clip. On the main track it is inserted at the slot nearest to its
 * centre; on audio tracks it goes to the nearest free position.
 */
export function addClip(project: Project, clip: Clip): Project {
  if (clip.trackId === MAIN_TRACK_ID) {
    const index = mainInsertIndex(project, clip.start + clipDuration(clip) / 2);
    const ordered = trackClips(project, MAIN_TRACK_ID);
    ordered.splice(index, 0, clip);
    return layoutMain(project, ordered);
  }
  const start = findFreeStart(trackClips(project, clip.trackId), clip.start, clipDuration(clip));
  return withClips(project, [...project.clips, { ...clip, start }]);
}

/** Insert a clip into the main track at slot `index` (clamped). */
export function insertIntoMain(project: Project, clip: Clip, index: number): Project {
  const ordered = trackClips(project, MAIN_TRACK_ID).filter((c) => c.id !== clip.id);
  const i = Math.max(0, Math.min(ordered.length, index));
  ordered.splice(i, 0, { ...clip, trackId: MAIN_TRACK_ID });
  return layoutMain(withClips(project, project.clips.filter((c) => c.id !== clip.id)), ordered);
}

/** Append a clip to the end of the main track. */
export function appendToMain(project: Project, clip: Clip): Project {
  const ordered = [...trackClips(project, MAIN_TRACK_ID), { ...clip, trackId: MAIN_TRACK_ID }];
  return layoutMain(project, ordered);
}

/**
 * Move a clip to `trackId` with its left edge at `desiredStart`.
 * - main -> main: reorders to the slot at `insertAt` (default: the dragged
 *   clip's centre). Drags should pass the pointer time so the slot follows
 *   the cursor regardless of how long the clip is.
 * - anything -> audio: nearest non-overlapping position.
 * - audio -> main: inserted at the slot nearest its centre.
 * Kind compatibility (see `canPlaceOnTrack`) is the caller's responsibility.
 */
export function moveClip(
  project: Project,
  clipId: string,
  trackId: string,
  desiredStart: number,
  insertAt?: number,
): Project {
  const clip = getClip(project, clipId);
  if (!clip || !getTrack(project, trackId)) return project;

  if (trackId === MAIN_TRACK_ID) {
    const anchor = insertAt ?? desiredStart + clipDuration(clip) / 2;
    const index = mainInsertIndex(project, anchor, clipId);
    const ordered = trackClips(project, MAIN_TRACK_ID).filter((c) => c.id !== clipId);
    ordered.splice(index, 0, { ...clip, trackId });
    const others = project.clips.filter((c) => c.id !== clipId);
    return layoutMain(withClips(project, others), ordered);
  }

  const start = findFreeStart(trackClips(project, trackId), desiredStart, clipDuration(clip), clipId);
  const moved = { ...clip, trackId, start };
  const next = withClips(
    project,
    project.clips.map((c) => (c.id === clipId ? moved : c)),
  );
  return clip.trackId === MAIN_TRACK_ID ? packMain(next) : next;
}

/**
 * Split a clip at timeline `time`. Returns the original project and `null` when
 * `time` is not far enough inside the clip for both halves to be valid.
 */
export function splitClip(
  project: Project,
  clipId: string,
  time: number,
): { project: Project; newClipId: string | null } {
  const clip = getClip(project, clipId);
  if (
    !clip ||
    time < clip.start + MIN_CLIP_DURATION - EPS ||
    time > clipEnd(clip) - MIN_CLIP_DURATION + EPS
  ) {
    return { project, newClipId: null };
  }
  const cut = roundTime(clip.in + (time - clip.start));
  const left: Clip = { ...clip, out: cut };
  const right: Clip = { ...clip, id: createId("clip"), start: roundTime(time), in: cut };
  const clips: Clip[] = [];
  for (const c of project.clips) {
    if (c.id === clipId) clips.push(left, right);
    else clips.push(c);
  }
  return { project: withClips(project, clips), newClipId: right.id };
}

/** Remove clips; the main track closes up the gap (ripple delete). */
export function removeClips(project: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds);
  if (!project.clips.some((c) => ids.has(c.id))) return project;
  return packMain(withClips(project, project.clips.filter((c) => !ids.has(c.id))));
}

/** Remove every clip that uses an asset (e.g. when the asset is deleted). */
export function removeAssetClips(project: Project, assetId: string): Project {
  return removeClips(
    project,
    project.clips.filter((c) => c.assetId === assetId).map((c) => c.id),
  );
}

/**
 * Trim a clip edge by `delta` seconds (positive = towards the right), clamped
 * so the clip stays within its source media, at least `MIN_CLIP_DURATION`
 * long, and (on audio tracks) doesn't overlap its neighbours.
 *
 * Callers doing a drag gesture should always pass the project from *before*
 * the gesture plus the total delta, so clamping never accumulates.
 *
 * - main track, start edge: moves the source in-point; the clip keeps its slot
 *   and everything after it ripples.
 * - main track, end edge: moves the out-point; later clips ripple.
 * - audio track, start edge: moves both timeline start and in-point.
 * - audio track, end edge: moves the out-point.
 */
export function trimClip(
  project: Project,
  clipId: string,
  edge: "start" | "end",
  delta: number,
  assetDuration: number,
): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  const isMain = clip.trackId === MAIN_TRACK_ID;
  let next: Clip;

  if (edge === "start") {
    let minDelta = -clip.in;
    if (!isMain) {
      const prev = trackClips(project, clip.trackId).filter(
        (c) => c.id !== clip.id && clipEnd(c) <= clip.start + EPS,
      );
      const prevEnd = prev.length ? Math.max(...prev.map(clipEnd)) : 0;
      minDelta = Math.max(minDelta, prevEnd - clip.start);
    }
    const maxDelta = clip.out - MIN_CLIP_DURATION - clip.in;
    const d = clamp(delta, Math.min(minDelta, 0), Math.max(maxDelta, 0));
    next = {
      ...clip,
      in: roundTime(clip.in + d),
      start: isMain ? clip.start : roundTime(clip.start + d),
    };
  } else {
    let maxOut = assetDuration;
    if (!isMain) {
      const following = trackClips(project, clip.trackId).filter(
        (c) => c.id !== clip.id && c.start >= clipEnd(clip) - EPS,
      );
      if (following.length) {
        const nextStart = Math.min(...following.map((c) => c.start));
        maxOut = Math.min(maxOut, clip.in + (nextStart - clip.start));
      }
    }
    const minOut = clip.in + MIN_CLIP_DURATION;
    next = { ...clip, out: roundTime(clamp(clip.out + delta, minOut, Math.max(maxOut, minOut))) };
  }

  const updated = withClips(project, project.clips.map((c) => (c.id === clipId ? next : c)));
  return isMain ? packMain(updated) : updated;
}

export function updateClip(
  project: Project,
  clipId: string,
  patch: Partial<Pick<Clip, "volume" | "fit">>,
): Project {
  if (!getClip(project, clipId)) return project;
  const volume = patch.volume === undefined ? undefined : clamp(patch.volume, 0, 1);
  return withClips(
    project,
    project.clips.map((c) =>
      c.id === clipId
        ? { ...c, ...patch, ...(volume === undefined ? {} : { volume }) }
        : c,
    ),
  );
}

export function addAudioTrack(project: Project): { project: Project; trackId: string } {
  const count = project.tracks.filter((t) => t.kind === "audio").length;
  const track: Track = { id: createId("track"), kind: "audio", name: `Audio ${count + 1}`, muted: false };
  return { project: { ...project, tracks: [...project.tracks, track] }, trackId: track.id };
}

/** Remove an audio track and its clips. The main track can't be removed. */
export function removeTrack(project: Project, trackId: string): Project {
  if (trackId === MAIN_TRACK_ID || !getTrack(project, trackId)) return project;
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    clips: project.clips.filter((c) => c.trackId !== trackId),
  };
}

export function setTrackMuted(project: Project, trackId: string, muted: boolean): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
  };
}

// ---------------------------------------------------------------------------
// Validation / normalisation (used on load and before export)
// ---------------------------------------------------------------------------

/**
 * Repair a project from untrusted storage: guarantees the main track exists
 * and is first, drops invalid clips (unknown track/asset, non-positive length,
 * out of source range), clamps values, resolves audio overlaps and packs main.
 * Pass `assets` to also validate clips against their source media.
 */
export function normalizeProject(
  input: Project,
  assets?: Record<string, Pick<MediaAsset, "duration" | "hasVideo" | "hasAudio">>,
): Project {
  const base = createDefaultProject();
  const tracksIn = Array.isArray(input?.tracks) ? input.tracks : [];
  const main: Track = {
    ...base.tracks[0],
    ...tracksIn.find((t) => t.id === MAIN_TRACK_ID),
    kind: "video",
  };
  const seen = new Set<string>([MAIN_TRACK_ID]);
  const audio: Track[] = [];
  for (const t of tracksIn) {
    if (!t || typeof t.id !== "string" || seen.has(t.id) || t.kind !== "audio") continue;
    seen.add(t.id);
    audio.push({ id: t.id, kind: "audio", name: String(t.name ?? "Audio"), muted: !!t.muted });
  }
  const tracks = [main, ...audio];
  const trackKind = new Map(tracks.map((t) => [t.id, t.kind]));

  const clips: Clip[] = [];
  const clipIds = new Set<string>();
  for (const c of Array.isArray(input?.clips) ? input.clips : []) {
    if (!c || typeof c.id !== "string" || clipIds.has(c.id)) continue;
    const kind = trackKind.get(c.trackId);
    if (!kind) continue;
    const nums = [c.start, c.in, c.out];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    let out = c.out;
    const inPoint = Math.max(0, c.in);
    if (assets) {
      const a = assets[c.assetId];
      if (!a || (kind === "video" ? !a.hasVideo : !a.hasAudio)) continue;
      out = Math.min(out, a.duration);
    }
    if (out - inPoint < MIN_CLIP_DURATION - EPS) continue;
    clipIds.add(c.id);
    clips.push({
      id: c.id,
      assetId: String(c.assetId),
      trackId: c.trackId,
      start: roundTime(Math.max(0, c.start)),
      in: roundTime(inPoint),
      out: roundTime(out),
      volume: clamp(typeof c.volume === "number" ? c.volume : 1, 0, 1),
      fit: c.fit === "cover" ? "cover" : "contain",
    });
  }

  let project: Project = {
    version: 1,
    name: typeof input?.name === "string" && input.name ? input.name : base.name,
    settings: {
      aspectRatio: (["9:16", "16:9", "1:1", "4:5"] as const).includes(input?.settings?.aspectRatio)
        ? input.settings.aspectRatio
        : base.settings.aspectRatio,
      fps: clamp(Math.round(Number(input?.settings?.fps) || base.settings.fps), 1, 120),
      background: /^#[0-9a-f]{6}$/i.test(input?.settings?.background ?? "")
        ? input.settings.background
        : base.settings.background,
    },
    tracks,
    clips: [],
  };

  // Re-insert audio clips one by one so any overlaps get resolved.
  const [mainClips, audioClips] = [
    clips.filter((c) => c.trackId === MAIN_TRACK_ID),
    clips.filter((c) => c.trackId !== MAIN_TRACK_ID).sort((a, b) => a.start - b.start),
  ];
  project = layoutMain(project, mainClips.sort((a, b) => a.start - b.start));
  for (const c of audioClips) project = addClip(project, c);
  return project;
}

// ---------------------------------------------------------------------------
// Output geometry
// ---------------------------------------------------------------------------

const SHORT_SIDE: Record<ExportResolution, number> = { "720p": 720, "1080p": 1080, "4k": 2160 };
const even = (n: number) => Math.round(n / 2) * 2;

/** Pixel size of the rendered video for an aspect ratio and resolution preset. */
export function outputSize(
  aspect: AspectRatio,
  resolution: ExportResolution,
): { width: number; height: number } {
  const [a, b] = aspect.split(":").map(Number);
  const short = SHORT_SIDE[resolution];
  return a <= b
    ? { width: short, height: even((short * b) / a) }
    : { width: even((short * a) / b), height: short };
}
