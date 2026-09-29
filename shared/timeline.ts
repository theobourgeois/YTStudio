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
  TrackKind,
} from "./types.ts";

/** Id of the first video track of every project (older projects' only one). */
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
      { id: MAIN_TRACK_ID, kind: "video", name: "Video 1", muted: false },
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

/** Video tracks in display order: the first one is drawn on top of the others. */
export function videoTracks(project: Project): Track[] {
  return project.tracks.filter((t) => t.kind === "video");
}

/** Whether a clip sits on a video track. */
export function isOnVideoTrack(project: Project, clip: Clip): boolean {
  return getTrack(project, clip.trackId)?.kind === "video";
}

/** End of the last clip on any track (0 for an empty timeline). */
export function projectDuration(project: Project): number {
  let end = 0;
  for (const c of project.clips) end = Math.max(end, clipEnd(c));
  return roundTime(end);
}

/** The project without its audio tracks' clips (video tracks keep their own sound). */
export function withoutAudioTracks(project: Project): Project {
  return { ...project, clips: project.clips.filter((c) => isOnVideoTrack(project, c)) };
}

/** The clip on `trackId` covering `time` (start inclusive, end exclusive). */
export function clipAtTime(project: Project, trackId: string, time: number): Clip | undefined {
  return project.clips.find(
    (c) => c.trackId === trackId && time >= c.start - EPS && time < clipEnd(c) - EPS,
  );
}

/** Every clip covering `time`, on any track. */
export function clipsAtTime(project: Project, time: number): Clip[] {
  return project.clips.filter((c) => time >= c.start - EPS && time < clipEnd(c) - EPS);
}

/** Whether an asset may be placed on a track of the given kind. */
export function canPlaceOnTrack(asset: Pick<MediaAsset, "hasVideo" | "hasAudio">, track: Pick<Track, "kind">) {
  return track.kind === "video" ? asset.hasVideo : asset.hasAudio;
}

/** Whether [start, start + duration) is free on `trackId` (ignoring `exclude`) and not before 0. */
export function isFree(
  project: Project,
  trackId: string,
  start: number,
  duration: number,
  exclude: ReadonlySet<string> = new Set(),
): boolean {
  if (start < -EPS) return false;
  return project.clips.every(
    (o) =>
      o.trackId !== trackId ||
      exclude.has(o.id) ||
      start + duration <= o.start + EPS ||
      start >= clipEnd(o) - EPS,
  );
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

/** Sorted, de-duplicated edit points (clip starts and ends) plus 0. */
export function editPoints(project: Project): number[] {
  const pts = new Set<number>([0]);
  for (const c of project.clips) {
    pts.add(roundTime(c.start));
    pts.add(roundTime(clipEnd(c)));
  }
  return [...pts].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** Candidate snap targets: 0, the playhead and every clip edge (except `exclude`d clips). */
export function snapPoints(
  project: Project,
  playhead: number,
  exclude: ReadonlySet<string> | string = new Set(),
): number[] {
  const skip = typeof exclude === "string" ? new Set([exclude]) : exclude;
  const pts = new Set<number>([0, roundTime(playhead)]);
  for (const c of project.clips) {
    if (skip.has(c.id)) continue;
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

function replaceClips(project: Project, updated: Map<string, Clip>): Project {
  if (updated.size === 0) return project;
  return withClips(project, project.clips.map((c) => updated.get(c.id) ?? c));
}

/** Add a new clip at the free position on its track nearest to its `start`. */
export function addClip(project: Project, clip: Clip): Project {
  const start = findFreeStart(trackClips(project, clip.trackId), clip.start, clipDuration(clip));
  return withClips(project, [...project.clips, { ...clip, start }]);
}

/** Add a clip right after the last clip on `trackId`. */
export function appendToTrack(project: Project, clip: Clip, trackId: string): Project {
  const end = Math.max(0, ...trackClips(project, trackId).map(clipEnd));
  return withClips(project, [...project.clips, { ...clip, trackId, start: roundTime(end) }]);
}

/**
 * Move clips by `delta` seconds, each onto `trackFor(clip)` (default: its own
 * track). When the requested position collides with other clips, the nearest
 * delta at which every moved clip fits is used instead, so clips never overlap
 * and never start before 0. Kind compatibility is the caller's responsibility.
 */
export function moveClips(
  project: Project,
  clipIds: string[],
  delta: number,
  trackFor: (clip: Clip) => string = (c) => c.trackId,
): Project {
  const ids = new Set(clipIds);
  const moving = project.clips
    .filter((c) => ids.has(c.id))
    .map((c) => ({ clip: c, trackId: trackFor(c) }));
  if (moving.length === 0 || moving.some((m) => !getTrack(project, m.trackId))) return project;

  const obstacles = new Map<string, Clip[]>();
  for (const { trackId } of moving) {
    if (!obstacles.has(trackId)) {
      obstacles.set(trackId, project.clips.filter((c) => c.trackId === trackId && !ids.has(c.id)));
    }
  }
  const minStart = Math.min(...moving.map((m) => m.clip.start));
  const fits = (d: number) =>
    minStart + d >= -EPS &&
    moving.every(({ clip, trackId }) => {
      const s = clip.start + d;
      const e = clipEnd(clip) + d;
      return obstacles.get(trackId)!.every((o) => e <= o.start + EPS || s >= clipEnd(o) - EPS);
    });

  // Candidate deltas: as asked, clamped at 0, and every "just touching an obstacle" position.
  const candidates = [delta, -minStart];
  let afterAll = -minStart;
  for (const { clip, trackId } of moving) {
    for (const o of obstacles.get(trackId)!) {
      candidates.push(clipEnd(o) - clip.start, o.start - clipEnd(clip));
      afterAll = Math.max(afterAll, clipEnd(o) - clip.start);
    }
  }
  candidates.push(afterAll); // always fits
  let best = afterAll;
  for (const d of candidates) {
    if (fits(d) && Math.abs(d - delta) < Math.abs(best - delta) - EPS) best = d;
  }

  const updated = new Map<string, Clip>();
  for (const { clip, trackId } of moving) {
    const start = roundTime(Math.max(0, clip.start + best));
    if (start !== clip.start || trackId !== clip.trackId) {
      updated.set(clip.id, { ...clip, trackId, start });
    }
  }
  return replaceClips(project, updated);
}

/** Move one clip to `trackId` with its left edge as close to `desiredStart` as fits. */
export function moveClip(
  project: Project,
  clipId: string,
  trackId: string,
  desiredStart: number,
): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  return moveClips(project, [clipId], desiredStart - clip.start, () => trackId);
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

/** Split every listed clip that `time` falls inside; returns the new right-hand clip ids. */
export function splitClips(
  project: Project,
  clipIds: string[],
  time: number,
): { project: Project; newClipIds: string[] } {
  let p = project;
  const newClipIds: string[] = [];
  for (const id of clipIds) {
    const res = splitClip(p, id, time);
    p = res.project;
    if (res.newClipId) newClipIds.push(res.newClipId);
  }
  return { project: p, newClipIds };
}

/** Remove clips, leaving gaps where they were. */
export function removeClips(project: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds);
  if (!project.clips.some((c) => ids.has(c.id))) return project;
  return withClips(project, project.clips.filter((c) => !ids.has(c.id)));
}

/**
 * Remove clips and close the gaps they leave: on each affected track, later
 * clips slide left by the total length removed before them.
 */
export function rippleDelete(project: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds);
  const removed = project.clips.filter((c) => ids.has(c.id));
  if (removed.length === 0) return project;
  const clips = project.clips
    .filter((c) => !ids.has(c.id))
    .map((c) => {
      let shift = 0;
      for (const r of removed) {
        if (r.trackId === c.trackId && clipEnd(r) <= c.start + EPS) shift += clipDuration(r);
      }
      return shift ? { ...c, start: roundTime(Math.max(0, c.start - shift)) } : c;
    });
  return withClips(project, clips);
}

/** Slide every clip on `trackId` starting at or after `from` left by `amount`. */
function pullLeft(project: Project, trackId: string, from: number, amount: number): Project {
  if (amount <= EPS) return project;
  return withClips(
    project,
    project.clips.map((c) =>
      c.trackId === trackId && c.start >= from - EPS
        ? { ...c, start: roundTime(Math.max(0, c.start - amount)) }
        : c,
    ),
  );
}

/** The empty stretch of `trackId` containing `time` (from the previous clip's end, or 0, to the next clip). */
export function gapAt(project: Project, trackId: string, time: number): { start: number; end: number } | null {
  if (clipAtTime(project, trackId, time)) return null;
  const clips = trackClips(project, trackId);
  const next = clips.find((c) => c.start >= time - EPS);
  if (!next) return null;
  const prevEnd = Math.max(0, ...clips.filter((c) => clipEnd(c) <= time + EPS).map(clipEnd));
  return next.start - prevEnd > EPS ? { start: roundTime(prevEnd), end: next.start } : null;
}

/** Close the gap at `time` on `trackId` by sliding the clips after it left. */
export function closeGap(project: Project, trackId: string, time: number): Project {
  const gap = gapAt(project, trackId, time);
  return gap ? pullLeft(project, trackId, gap.end, gap.end - gap.start) : project;
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
 * long, and doesn't overlap its neighbours. The start edge moves both the
 * timeline start and the in-point; the end edge moves the out-point.
 *
 * Callers doing a drag gesture should always pass the project from *before*
 * the gesture plus the total delta, so clamping never accumulates.
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
  const siblings = trackClips(project, clip.trackId).filter((c) => c.id !== clip.id);
  let next: Clip;

  if (edge === "start") {
    const prevEnd = Math.max(0, ...siblings.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    const minDelta = Math.max(-clip.in, prevEnd - clip.start);
    const maxDelta = clip.out - MIN_CLIP_DURATION - clip.in;
    const d = clamp(delta, Math.min(minDelta, 0), Math.max(maxDelta, 0));
    next = { ...clip, in: roundTime(clip.in + d), start: roundTime(clip.start + d) };
  } else {
    let maxOut = assetDuration;
    const following = siblings.filter((c) => c.start >= clipEnd(clip) - EPS);
    if (following.length) {
      const nextStart = Math.min(...following.map((c) => c.start));
      maxOut = Math.min(maxOut, clip.in + (nextStart - clip.start));
    }
    const minOut = clip.in + MIN_CLIP_DURATION;
    next = { ...clip, out: roundTime(clamp(clip.out + delta, minOut, Math.max(maxOut, minOut))) };
  }
  return replaceClips(project, new Map([[clipId, next]]));
}

/**
 * Ripple-trim a clip to timeline `time`: cut away everything before it
 * (`edge = "start"`) or after it (`"end"`), then slide the rest of the track
 * left to close the gap. No-op unless both parts would be valid clips.
 */
export function rippleTrimTo(
  project: Project,
  clipId: string,
  edge: "start" | "end",
  time: number,
): Project {
  const clip = getClip(project, clipId);
  if (
    !clip ||
    time < clip.start + MIN_CLIP_DURATION - EPS ||
    time > clipEnd(clip) - MIN_CLIP_DURATION + EPS
  ) {
    return project;
  }
  const end = clipEnd(clip);
  const cut = roundTime(clip.in + (time - clip.start));
  const trimmed: Clip = edge === "start" ? { ...clip, in: cut } : { ...clip, out: cut };
  const removed = edge === "start" ? time - clip.start : end - time;
  const p = replaceClips(project, new Map([[clipId, trimmed]]));
  return pullLeft(p, clip.trackId, end, removed);
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

/** A copied clip plus the kind of track it came from (its track may be gone by paste time). */
export interface CopiedClip {
  clip: Clip;
  kind: TrackKind;
}

export function copyClips(project: Project, clipIds: string[]): CopiedClip[] {
  const ids = new Set(clipIds);
  return project.clips
    .filter((c) => ids.has(c.id))
    .map((clip) => ({ clip, kind: getTrack(project, clip.trackId)?.kind ?? "audio" }));
}

/**
 * Put copies of copied clips on the timeline with the earliest one starting at
 * `at`, keeping their relative timing. Each copy goes back to its original
 * track when that still exists and the whole group fits there; otherwise the
 * group lands on new tracks, one per source track, next to the originals.
 */
export function pasteClips(
  project: Project,
  copied: CopiedClip[],
  at: number,
): { project: Project; clipIds: string[] } {
  if (copied.length === 0) return { project, clipIds: [] };
  const offset = Math.max(0, at) - Math.min(...copied.map((c) => c.clip.start));
  const copies = copied.map(({ clip }) => ({
    ...clip,
    id: createId("clip"),
    start: roundTime(clip.start + offset),
  }));
  const kindOf = new Map(copied.map(({ clip, kind }) => [clip.trackId, kind]));
  const fitsInPlace = copies.every(
    (c) =>
      getTrack(project, c.trackId)?.kind === kindOf.get(c.trackId) &&
      isFree(project, c.trackId, c.start, clipDuration(c)),
  );

  let p = project;
  if (!fitsInPlace) {
    const newTrackFor = new Map<string, string>();
    for (const [sourceId, kind] of kindOf) {
      const index = p.tracks.findIndex((t) => t.id === sourceId);
      const at = index === -1 ? undefined : kind === "video" ? index : index + 1;
      const added = addTrack(p, kind, at);
      p = added.project;
      newTrackFor.set(sourceId, added.trackId);
    }
    for (const c of copies) c.trackId = newTrackFor.get(c.trackId)!;
  }
  return { project: withClips(p, [...p.clips, ...copies]), clipIds: copies.map((c) => c.id) };
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<TrackKind, string> = { video: "Video", audio: "Audio" };

/** "Video 3": the lowest number not already used by a track of that kind. */
function nextTrackName(project: Project, kind: TrackKind): string {
  const names = new Set(project.tracks.map((t) => t.name));
  let n = project.tracks.filter((t) => t.kind === kind).length + 1;
  while (names.has(`${KIND_LABEL[kind]} ${n}`)) n++;
  return `${KIND_LABEL[kind]} ${n}`;
}

/**
 * Add an empty track at array position `index` (clamped so video tracks stay
 * above audio tracks). By default a video track goes on top of the other video
 * tracks and an audio track goes below the other audio tracks.
 */
export function addTrack(
  project: Project,
  kind: TrackKind,
  index?: number,
): { project: Project; trackId: string } {
  const videoCount = project.tracks.filter((t) => t.kind === "video").length;
  const [min, max] = kind === "video" ? [0, videoCount] : [videoCount, project.tracks.length];
  const at = clamp(index ?? (kind === "video" ? 0 : project.tracks.length), min, max);
  const track: Track = { id: createId("track"), kind, name: nextTrackName(project, kind), muted: false };
  const tracks = [...project.tracks];
  tracks.splice(at, 0, track);
  return { project: { ...project, tracks }, trackId: track.id };
}

export function addAudioTrack(project: Project): { project: Project; trackId: string } {
  return addTrack(project, "audio");
}

/** Remove a track and its clips. The last video track can't be removed. */
export function removeTrack(project: Project, trackId: string): Project {
  const track = getTrack(project, trackId);
  if (!track || (track.kind === "video" && videoTracks(project).length <= 1)) return project;
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    clips: project.clips.filter((c) => c.trackId !== trackId),
  };
}

/**
 * Remove `trackId` if it has no clips, unless it's a "home" track: the bottom
 * video track or the top audio track (where new media lands by default).
 */
export function pruneEmptyTrack(project: Project, trackId: string): Project {
  const track = getTrack(project, trackId);
  if (!track || project.clips.some((c) => c.trackId === trackId)) return project;
  const home =
    track.kind === "video"
      ? videoTracks(project).at(-1)
      : project.tracks.find((t) => t.kind === "audio");
  if (home?.id === trackId) return project;
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) };
}

export function setTrackMuted(project: Project, trackId: string, muted: boolean): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
  };
}

/**
 * The neighbouring track of the same kind above (`dir = -1`) or below (`1`)
 * `trackId`, or null at the edge of its group.
 */
export function adjacentTrack(project: Project, trackId: string, dir: -1 | 1): Track | null {
  const track = getTrack(project, trackId);
  if (!track) return null;
  const same = project.tracks.filter((t) => t.kind === track.kind);
  return same[same.findIndex((t) => t.id === trackId) + dir] ?? null;
}

// ---------------------------------------------------------------------------
// Validation / normalisation (used on load and before export)
// ---------------------------------------------------------------------------

/**
 * Repair a project from untrusted storage: guarantees at least one video
 * track, video tracks before audio tracks, drops invalid clips (unknown
 * track/asset, non-positive length, out of source range), clamps values and
 * resolves overlaps. Pass `assets` to also validate clips against their media.
 */
export function normalizeProject(
  input: Project,
  assets?: Record<string, Pick<MediaAsset, "duration" | "hasVideo" | "hasAudio">>,
): Project {
  const base = createDefaultProject();
  const tracksIn = Array.isArray(input?.tracks) ? input.tracks : [];
  const seen = new Set<string>();
  const byKind: Record<TrackKind, Track[]> = { video: [], audio: [] };
  for (const t of tracksIn) {
    if (!t || typeof t.id !== "string" || seen.has(t.id)) continue;
    if (t.kind !== "video" && t.kind !== "audio") continue;
    seen.add(t.id);
    byKind[t.kind].push({
      id: t.id,
      kind: t.kind,
      name: String(t.name ?? KIND_LABEL[t.kind]),
      muted: !!t.muted,
    });
  }
  if (byKind.video.length === 0) byKind.video.push({ ...base.tracks[0] });
  const tracks = [...byKind.video, ...byKind.audio];
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

  // Re-insert clips one by one (in time order) so any overlaps get resolved.
  for (const c of clips.sort((a, b) => a.start - b.start)) project = addClip(project, c);
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
