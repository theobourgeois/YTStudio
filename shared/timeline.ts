/**
 * Pure, immutable timeline operations. Every function takes a `Project` and
 * returns a new one (or the same instance when nothing changed), so they are
 * trivially undoable and unit-testable. See the rules documented on `Project`.
 */
import { DEFAULT_PROJECT_NAME } from "./suites.ts";
import { cameraEffects, clipKind, defaultEffects, hasMedia, solidEffects, textStyleAt } from "./effects.ts";
import { EPS, clamp, even, roundTime, tidy } from "./math.ts";
import type {
  AspectRatio,
  Clip,
  ExportResolution,
  MediaAsset,
  ParamValues,
  Project,
  Track,
  TrackKind,
} from "./types.ts";

/** Id of the video track a new project starts with. */
export const MAIN_TRACK_ID = "main";
/** A new project's name, until it's renamed (or named after its first import). */
export { DEFAULT_PROJECT_NAME };
/** Shortest clip the editor allows (seconds). */
export const MIN_CLIP_DURATION = 0.1;
/** How long a new clip of a still image is (seconds), like Premiere's default. */
export const STILL_DURATION = 5;

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createDefaultProject(): Project {
  return {
    version: 1,
    name: DEFAULT_PROJECT_NAME,
    settings: { aspectRatio: "9:16", fps: 30 },
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

/** Slowest and fastest a clip can play (10% and 1000%, like Premiere's usual range). */
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;

/** How fast a clip plays its media (1 = normal speed). */
export const clipSpeed = (c: Pick<Clip, "speed">) => c.speed ?? 1;
/** Length on the timeline: its source range at its speed. */
export const clipDuration = (c: Pick<Clip, "in" | "out" | "speed">) => (c.out - c.in) / clipSpeed(c);
export const clipEnd = (c: Pick<Clip, "start" | "in" | "out" | "speed">) => c.start + clipDuration(c);
/** Plays at a speed other than 1, or backwards. */
export const isRetimed = (c: Pick<Clip, "speed" | "reversed">) => clipSpeed(c) !== 1 || c.reversed === true;

export function getTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

/** One clip by id. For many lookups on the same project, use `clipsById`. */
export function getClip(project: Project, clipId: string): Clip | undefined {
  return project.clips.find((c) => c.id === clipId);
}

/**
 * `derive(project)` computed once per clip list and then reused, for queries
 * that read nothing but `project.clips`. Edits never change a `clips` array
 * in place (they make a new one), so a list's result stays valid for as long
 * as the list exists. The result is shared: treat it as read-only.
 */
export function perClipList<T>(derive: (project: Project) => T): (project: Project) => T {
  const cache = new WeakMap<readonly Clip[], T>();
  return (project) => {
    let value = cache.get(project.clips);
    if (value === undefined) {
      value = derive(project);
      cache.set(project.clips, value);
    }
    return value;
  };
}

/** Every clip by id. */
export const clipsById = perClipList(({ clips }): ReadonlyMap<string, Clip> => new Map(clips.map((c) => [c.id, c])));

const clipsByTrack = perClipList(({ clips }) => {
  const byTrack = new Map<string, Clip[]>();
  for (const c of clips) {
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  for (const list of byTrack.values()) list.sort((a, b) => a.start - b.start);
  return byTrack as ReadonlyMap<string, readonly Clip[]>;
});

const NO_CLIPS: readonly Clip[] = [];

/** Clips on a track, sorted by start time (stable). Shared between callers: don't change it. */
export function trackClips(project: Project, trackId: string): readonly Clip[] {
  return clipsByTrack(project).get(trackId) ?? NO_CLIPS;
}

/** Video tracks in display order: the first one is drawn on top of the others. */
export function videoTracks(project: Project): Track[] {
  return project.tracks.filter((t) => t.kind === "video");
}

/** Whether a clip sits on a video track. */
export function isOnVideoTrack(project: Project, clip: Clip): boolean {
  return getTrack(project, clip.trackId)?.kind === "video";
}

/** What to call a clip: its text's first line, its kind of layer, or its media's file name. */
export function clipName(clip: Clip, asset: Pick<MediaAsset, "name"> | undefined): string {
  const kind = clipKind(clip);
  if (kind === "text") return textStyleAt(clip, clip.in).text.trim().split("\n")[0].trim() || "Text";
  if (kind === "solid") return "Solid";
  if (kind === "adjustment") return "Adjustment Layer";
  if (kind === "camera") return "Camera";
  return asset?.name ?? "Media offline";
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
  // Clips on a track never overlap, so they're sorted by end too: find the first one ending after `time`.
  const clips = trackClips(project, trackId);
  let lo = 0;
  let hi = clips.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (time < clipEnd(clips[mid]) - EPS) hi = mid;
    else lo = mid + 1;
  }
  const clip = clips[lo];
  return clip && time >= clip.start - EPS ? clip : undefined;
}

/** Every clip covering `time`, on any track. */
export function clipsAtTime(project: Project, time: number): Clip[] {
  return project.clips.filter((c) => time >= c.start - EPS && time < clipEnd(c) - EPS);
}

/**
 * The source range a clip's in/out points must stay inside. A still image has
 * no length of its own, so its clips can be stretched either way.
 */
export function sourceRange(asset: Pick<MediaAsset, "kind" | "duration">): { min: number; max: number } {
  return asset.kind === "image" ? { min: -Infinity, max: Infinity } : { min: 0, max: asset.duration };
}

/** A clip without media (text, a solid, an adjustment layer), like a still, can be stretched either way. */
export const TEXT_SOURCE_RANGE = { min: -Infinity, max: Infinity } as const;

/**
 * The source range a clip's in/out points must stay inside, given its media
 * (`undefined` when that's offline: the clip keeps to what it already shows).
 */
export function clipSourceRange(
  clip: Clip,
  asset: Pick<MediaAsset, "kind" | "duration"> | undefined,
): { min: number; max: number } {
  if (!hasMedia(clip)) return TEXT_SOURCE_RANGE;
  return asset ? sourceRange(asset) : { min: clip.in, max: clip.out };
}

/** Keep source times this far before a clip's out-point so the frame shown belongs to the clip. */
export const END_GUARD = 1e-3;

type Timed = Pick<Clip, "start" | "in" | "out" | "speed" | "reversed">;

/**
 * The source time at a clip's timeline time `t` seen as an edge (unclamped):
 * where a cut at `t` divides its media. A reversed clip starts at its `out`
 * and runs down to its `in`.
 */
export function sourceEdge(clip: Timed, t: number): number {
  const played = (t - clip.start) * clipSpeed(clip);
  return clip.reversed ? clip.out - played : clip.in + played;
}

/**
 * Source-media time `clip` shows at timeline time `t`, unclamped (a
 * transition shows clips past their edges). Played backwards, each moment
 * shows the frame just before its edge, as forwards shows the one just after.
 */
export function sourceAt(clip: Timed, t: number): number {
  return sourceEdge(clip, t) - (clip.reversed ? END_GUARD : 0);
}

/**
 * Source-media time shown by `clip` at timeline time `t`, clamped into the
 * clip. Keyframes and effect values are read at this time.
 */
export function sourceTime(clip: Timed, t: number): number {
  return Math.min(Math.max(sourceAt(clip, t), clip.in), Math.max(clip.in, clip.out - END_GUARD));
}

/** Timeline time at which `clip` shows source time `s` (the inverse of `sourceAt`). */
export function timelineTime(clip: Timed, s: number): number {
  const played = clip.reversed ? clip.out - END_GUARD - s : s - clip.in;
  return clip.start + played / clipSpeed(clip);
}

/** Source seconds a clip plays in `dt` timeline seconds (negative when it plays backwards). */
export const sourceDelta = (clip: Pick<Clip, "speed" | "reversed">, dt: number) =>
  dt * clipSpeed(clip) * (clip.reversed ? -1 : 1);

/**
 * Where source time `s` of a clip is in the file it plays: the media itself,
 * or, for a reversed clip, its reversed copy (`duration` long like the
 * media), where each frame starts at the time the source frame before it ends.
 */
export function fileTime(clip: Pick<Clip, "reversed">, s: number, duration: number): number {
  return clip.reversed ? duration - END_GUARD - s : s;
}

/** Can play at another speed or backwards: clips of videos and sounds (not stills, text or other layers). */
export function canRetime(clip: Clip, asset: Pick<MediaAsset, "kind"> | undefined): boolean {
  return hasMedia(clip) && !!asset && asset.kind !== "image";
}

/**
 * A source time on a retimed clip's edge: rounded finely enough that at the
 * slowest speed the timeline edge still lands within `EPS` (normal-speed clips
 * keep microsecond source times).
 */
export const roundSourceTime = (clip: Pick<Clip, "speed">, s: number) => (clipSpeed(clip) === 1 ? roundTime(s) : tidy(s));

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
  clips: readonly Clip[],
  desired: number,
  duration: number,
  excludeId?: string,
): number {
  // A start inside (o.start - duration, end of o) overlaps o.
  const blocked: Span[] = [];
  for (const o of clips) if (o.id !== excludeId) blocked.push([o.start - duration, clipEnd(o)]);
  return roundTime(Math.max(0, nearestFree(blocked, Math.max(0, desired), 0)));
}

/** An open interval (from, to) of values that aren't allowed. */
type Span = [number, number];

/**
 * The value nearest `want` that's at least `min` and not inside any of the
 * `blocked` intervals. Touching an interval's end is allowed (with EPS of
 * slack), so the answer is `want` itself, `min` or the end of a run of
 * blocked intervals. Ties go to the later value. Sorts `blocked` in place.
 *
 * This is how a clip finds where it fits among its neighbours: sorting the
 * intervals makes it O(n log n), where trying every neighbour's edge against
 * every neighbour was O(n²) (and O(n²k²) for k clips moving together).
 */
function nearestFree(blocked: Span[], want: number, min: number): number {
  blocked.sort((a, b) => a[0] - b[0]);
  // Merge intervals into runs, joining two only when they overlap by more than EPS:
  // the ends of runs are then exactly the edges where something fits.
  const runs: Span[] = [];
  for (const [from, to] of blocked) {
    if (to - from <= 2 * EPS) continue; // blocks nothing
    const last = runs.at(-1);
    if (last && from < last[1] - EPS) last[1] = Math.max(last[1], to);
    else runs.push([from, to]);
  }
  const fits = (x: number) => {
    if (x < min - EPS) return false;
    // The last run starting before x is the only one that can contain it.
    let lo = 0;
    let hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (runs[mid][0] + EPS < x) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 || x >= runs[lo - 1][1] - EPS;
  };
  if (fits(want)) return want;
  // After every run (and at least `min`) always fits.
  let best = Math.max(min, runs.at(-1)?.[1] ?? min);
  const consider = (x: number) => {
    if (Math.abs(x - want) < Math.abs(best - want) - EPS && fits(x)) best = x;
  };
  consider(min);
  for (let i = runs.length - 1; i >= 0; i--) {
    consider(runs[i][1]);
    consider(runs[i][0]);
  }
  return best;
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

/** The one of sorted `points` nearest `time` (the earlier on a tie), or `time` when there are none. */
export function nearestPoint(points: readonly number[], time: number): number {
  let best = time;
  let bestDistance = Infinity;
  for (const p of points) {
    const d = Math.abs(p - time);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
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

/**
 * Add a clip as an insert edit (Auto ripple): where it lands inside a clip it goes to that
 * clip's nearer edge, and the clips after it on its track are pushed right just as far
 * as it needs, so what was joined stays joined.
 */
export function insertClip(project: Project, clip: Clip): Project {
  const clips = trackClips(project, clip.trackId);
  let at = Math.max(0, clip.start);
  const inside = clips.find((c) => c.start < at - EPS && clipEnd(c) > at + EPS);
  if (inside) at = at - inside.start < clipEnd(inside) - at ? inside.start : clipEnd(inside);
  const end = at + clipDuration(clip);
  const next = clips.find((c) => c.start >= at - EPS);
  const push = next ? end - next.start : 0;
  const pushed =
    push > EPS
      ? project.clips.map((c) => (c.trackId === clip.trackId && c.start >= at - EPS ? { ...c, start: roundTime(c.start + push) } : c))
      : project.clips;
  return withClips(project, [...pushed, { ...clip, start: roundTime(at) }]);
}

/**
 * Add a text clip at its `start`: on the top video track when that's free for
 * the whole clip, else on a new video track on top, so the text shows over
 * the picture.
 */
export function addTextClip(project: Project, clip: Omit<Clip, "trackId">): { project: Project; trackId: string } {
  const top = videoTracks(project)[0];
  if (isFree(project, top.id, clip.start, clipDuration(clip as Clip))) {
    return { project: withClips(project, [...project.clips, { ...clip, trackId: top.id }]), trackId: top.id };
  }
  const added = addTrack(project, "video");
  return {
    project: withClips(added.project, [...added.project.clips, { ...clip, trackId: added.trackId }]),
    trackId: added.trackId,
  };
}

/**
 * A new solid (with `solid`'s values over the Solid defaults) or adjustment layer from
 * timeline time `start`, `duration` long. Its source time runs from 0, so keyframes count
 * from its start.
 */
export function newLayerClip(
  kind: "adjustment" | "solid" | "camera",
  start: number,
  duration: number,
  params: ParamValues = {},
): Omit<Clip, "trackId"> {
  const base = { id: createId("clip"), assetId: "", start: roundTime(Math.max(0, start)), in: 0, out: roundTime(Math.max(MIN_CLIP_DURATION, duration)) };
  if (kind === "solid") return { ...base, effects: solidEffects(params) };
  if (kind === "camera") return { ...base, effects: cameraEffects(params) };
  return { ...base, effects: defaultEffects(), adjustment: true };
}

/**
 * Add a clip that goes over the picture (a solid or an adjustment layer): on the video
 * track `trackId` when it's free there, else like text, on the top video track or a new
 * one on top.
 */
export function addLayerClip(project: Project, clip: Omit<Clip, "trackId">, trackId?: string): { project: Project; trackId: string } {
  const track = trackId ? getTrack(project, trackId) : undefined;
  if (track?.kind === "video" && isFree(project, track.id, clip.start, clipDuration(clip as Clip))) {
    return { project: withClips(project, [...project.clips, { ...clip, trackId: track.id }]), trackId: track.id };
  }
  return addTextClip(project, clip);
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

  // A delta inside (o.start - end, o's end - start) makes that moving clip overlap obstacle o.
  const blocked: Span[] = [];
  for (const { clip, trackId } of moving) {
    for (const o of trackClips(project, trackId)) {
      if (!ids.has(o.id)) blocked.push([o.start - clipEnd(clip), clipEnd(o) - clip.start]);
    }
  }
  const minStart = Math.min(...moving.map((m) => m.clip.start));
  const best = nearestFree(blocked, delta, -minStart);

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
  const cut = roundSourceTime(clip, sourceEdge(clip, time));
  // The clip's transitions stay on its outer edges. Played backwards, the left half has the end of the media.
  const { transitionIn, transitionOut, ...rest } = clip;
  const [first, second] = clip.reversed ? [{ in: cut }, { out: cut }] : [{ out: cut }, { in: cut }];
  const left: Clip = { ...rest, ...first, ...(transitionIn && { transitionIn }) };
  const right: Clip = { ...rest, ...second, id: createId("clip"), start: roundTime(time), ...(transitionOut && { transitionOut }) };
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

/** Remove every clip and subclip that uses an asset (e.g. when the asset is deleted). */
export function removeAssetClips(project: Project, assetId: string): Project {
  const p = removeClips(
    project,
    project.clips.filter((c) => c.assetId === assetId).map((c) => c.id),
  );
  if (!p.subclips?.some((s) => s.assetId === assetId)) return p;
  const subclips = p.subclips.filter((s) => s.assetId !== assetId);
  if (subclips.length > 0) return { ...p, subclips };
  const { subclips: _, ...rest } = p;
  return rest;
}

/**
 * Trim a clip edge by `delta` seconds (positive = towards the right), clamped
 * so the clip stays within its source range (see `sourceRange`), at least `MIN_CLIP_DURATION`
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
  source: { min: number; max: number },
): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  const siblings = trackClips(project, clip.trackId).filter((c) => c.id !== clip.id);
  const speed = clipSpeed(clip);
  const duration = clipDuration(clip);
  // Timeline seconds of media left past the clip's start and end edges (a reversed clip starts at its out-point).
  const [before, after] = clip.reversed
    ? [(source.max - clip.out) / speed, (clip.in - source.min) / speed]
    : [(clip.in - source.min) / speed, (source.max - clip.out) / speed];
  let next: Clip;

  if (edge === "start") {
    const prevEnd = Math.max(0, ...siblings.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    const minDelta = Math.max(-before, prevEnd - clip.start);
    const maxDelta = duration - MIN_CLIP_DURATION;
    const d = clamp(delta, Math.min(minDelta, 0), Math.max(maxDelta, 0));
    const edgeSource = roundSourceTime(clip, sourceEdge(clip, clip.start + d));
    next = { ...clip, ...(clip.reversed ? { out: edgeSource } : { in: edgeSource }), start: roundTime(clip.start + d) };
  } else {
    let maxDelta = after;
    const following = siblings.filter((c) => c.start >= clipEnd(clip) - EPS);
    if (following.length) maxDelta = Math.min(maxDelta, Math.min(...following.map((c) => c.start)) - clipEnd(clip));
    const minDelta = MIN_CLIP_DURATION - duration;
    const d = clamp(delta, minDelta, Math.max(maxDelta, minDelta));
    const edgeSource = roundSourceTime(clip, sourceEdge(clip, clipEnd(clip) + d));
    next = { ...clip, ...(clip.reversed ? { in: edgeSource } : { out: edgeSource }) };
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
  const cut = roundSourceTime(clip, sourceEdge(clip, time));
  // Played backwards, the timeline's start edge is the media's out-point.
  const trimmed: Clip = (edge === "start") !== !!clip.reversed ? { ...clip, in: cut } : { ...clip, out: cut };
  const removed = edge === "start" ? time - clip.start : end - time;
  const p = replaceClips(project, new Map([[clipId, trimmed]]));
  return pullLeft(p, clip.trackId, end, removed);
}

/** Far enough from 0 that nothing before it limits an edit (see `rippleClipEdit`). */
const RIPPLE_ROOM = 1e6;

/**
 * `edit` (a trim or rate stretch of `clipId`) as a ripple edit, like Premiere's Ripple Edit
 * tool and Auto ripple: the clip keeps its start, the clips after it on its track move by
 * however much longer or shorter it got, and its neighbours never stop it (only its media
 * does). `edit` sees the clip alone on its track, far from 0.
 */
export function rippleClipEdit(project: Project, clipId: string, edit: (p: Project) => Project): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  const alone = withClips(project, [
    ...project.clips.filter((c) => c.trackId !== clip.trackId),
    { ...clip, start: clip.start + RIPPLE_ROOM },
  ]);
  const edited = getClip(edit(alone), clipId);
  if (!edited) return project;
  const change = roundTime(clipDuration(edited) - clipDuration(clip));
  const next: Clip = { ...edited, start: clip.start };
  if (Math.abs(change) <= EPS && next.in === clip.in && next.out === clip.out && next.speed === clip.speed) return project;
  const end = clipEnd(clip);
  const updated = new Map([[clipId, next]]);
  if (Math.abs(change) > EPS) {
    for (const c of trackClips(project, clip.trackId)) {
      if (c.id !== clipId && c.start >= end - EPS) updated.set(c.id, { ...c, start: roundTime(Math.max(0, c.start + change)) });
    }
  }
  return replaceClips(project, updated);
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

/** What `setClipSpeed` changes (anything left out stays as it is). */
export interface SpeedChange {
  speed?: number;
  reversed?: boolean;
  keepPitch?: boolean;
  /** Time Interpolation (see `Clip.timeInterpolation`): `frames` is Frame Sampling. */
  interpolation?: "frames" | "blend" | "flow";
}

/** The fastest a clip can play: `MAX_SPEED`, or as fast as keeps it `MIN_CLIP_DURATION` long. */
export function maxClipSpeed(clip: Pick<Clip, "in" | "out">): number {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, (clip.out - clip.in) / MIN_CLIP_DURATION));
}

/** `speed` limited to what the clip can play at. */
export function clampSpeed(clip: Pick<Clip, "in" | "out">, speed: number): number {
  return tidy(clamp(speed, MIN_SPEED, maxClipSpeed(clip)));
}

/** The speed at which a clip lasts `duration` timeline seconds (limited to what it can play at). */
export function speedForDuration(clip: Pick<Clip, "in" | "out">, duration: number): number {
  return clampSpeed(clip, (clip.out - clip.in) / Math.max(duration, 1e-6));
}

/** A clip with `change` applied (the same clip when nothing changes). Speed 1, forwards and a kept pitch aren't stored. */
function retimed(clip: Clip, change: SpeedChange): Clip {
  const speed = change.speed === undefined ? clipSpeed(clip) : clampSpeed(clip, change.speed);
  const reversed = change.reversed ?? clip.reversed === true;
  const keepPitch = change.keepPitch ?? clip.keepPitch !== false;
  const interpolation = change.interpolation ?? clip.timeInterpolation ?? "frames";
  if (
    speed === clipSpeed(clip) &&
    reversed === (clip.reversed === true) &&
    keepPitch === (clip.keepPitch !== false) &&
    interpolation === (clip.timeInterpolation ?? "frames")
  ) {
    return clip;
  }
  const { speed: _s, reversed: _r, keepPitch: _k, timeInterpolation: _i, ...rest } = clip;
  return {
    ...rest,
    ...(Math.abs(speed - 1) > 1e-9 && { speed }),
    ...(reversed && { reversed: true as const }),
    ...(!keepPitch && { keepPitch: false as const }),
    ...(interpolation !== "frames" && { timeInterpolation: interpolation }),
  };
}

/**
 * Premiere's Speed/Duration (with Ripple Edit on): set clips' speed, direction
 * and pitch. Each clip keeps its start, and the clips after it on its track
 * move with its end, so a faster clip leaves no gap and a slower one never
 * overlaps the next. Keyframes stay on their frames (they're in source time),
 * so an animation speeds up with its clip. Callers pick clips that can be
 * retimed (`canRetime`).
 */
export function setClipSpeed(project: Project, clipIds: Iterable<string>, change: SpeedChange): Project {
  const ids = new Set(clipIds);
  const tracks = new Set<string>();
  for (const c of project.clips) if (ids.has(c.id)) tracks.add(c.trackId);
  const updated = new Map<string, Clip>();
  for (const trackId of tracks) {
    let shift = 0;
    for (const c of trackClips(project, trackId)) {
      let next = ids.has(c.id) ? retimed(c, change) : c;
      if (shift !== 0) next = { ...next, start: roundTime(Math.max(0, c.start + shift)) };
      if (next === c) continue;
      shift += clipDuration(next) - clipDuration(c);
      updated.set(c.id, next);
    }
  }
  return replaceClips(project, updated);
}

/**
 * Premiere's Rate Stretch: drag a clip's edge by `delta` seconds and its speed
 * changes so the same media fills the new length; the other edge stays put.
 * Limited by its neighbours and the speed range. Like `trimClip`, a drag
 * passes the project from before it and the total delta.
 */
export function stretchClip(project: Project, clipId: string, edge: "start" | "end", delta: number): Project {
  const clip = getClip(project, clipId);
  if (!clip) return project;
  const siblings = trackClips(project, clip.trackId).filter((c) => c.id !== clip.id);
  const length = clip.out - clip.in;
  const duration = clipDuration(clip);
  const end = clipEnd(clip);
  const shortest = length / maxClipSpeed(clip);
  let longest = length / MIN_SPEED;
  if (edge === "end") {
    const following = siblings.filter((c) => c.start >= end - EPS);
    if (following.length) longest = Math.min(longest, Math.min(...following.map((c) => c.start)) - clip.start);
  } else {
    const prevEnd = Math.max(0, ...siblings.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    longest = Math.min(longest, end - prevEnd);
  }
  const wanted = edge === "end" ? duration + delta : duration - delta;
  const next = clamp(wanted, shortest, Math.max(longest, Math.min(duration, shortest)));
  // The fixed edge stays exactly where it was.
  const start = edge === "end" ? clip.start : roundTime(end - next);
  const stretched = retimed({ ...clip, start }, { speed: length / (edge === "end" ? next : end - start) });
  if (stretched.start === clip.start && clipSpeed(stretched) === clipSpeed(clip)) return project;
  return replaceClips(project, new Map([[clipId, stretched]]));
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

export const TRACK_KIND_LABEL: Record<TrackKind, string> = { video: "Video", audio: "Audio" };

/** "Video 3": the lowest number not already used by a track of that kind. */
function nextTrackName(project: Project, kind: TrackKind): string {
  const names = new Set(project.tracks.map((t) => t.name));
  let n = project.tracks.filter((t) => t.kind === kind).length + 1;
  while (names.has(`${TRACK_KIND_LABEL[kind]} ${n}`)) n++;
  return `${TRACK_KIND_LABEL[kind]} ${n}`;
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
// Output geometry
// ---------------------------------------------------------------------------

/** Every aspect ratio a project can have. */
export const ASPECT_RATIOS: readonly AspectRatio[] = ["9:16", "16:9", "1:1", "4:5"];

/** An aspect ratio's two sides, e.g. [9, 16]. */
export function aspectParts(aspect: AspectRatio): [number, number] {
  const [a, b] = aspect.split(":").map(Number);
  return [a, b];
}

const SHORT_SIDE: Record<ExportResolution, number> = { "720p": 720, "1080p": 1080, "4k": 2160 };

/** Every export resolution preset, smallest first. */
export const EXPORT_RESOLUTIONS = Object.keys(SHORT_SIDE) as ExportResolution[];

/** Pixel size of the rendered video for an aspect ratio and resolution preset. */
export function outputSize(
  aspect: AspectRatio,
  resolution: ExportResolution,
): { width: number; height: number } {
  const [a, b] = aspectParts(aspect);
  const short = SHORT_SIDE[resolution];
  return a <= b
    ? { width: short, height: even((short * b) / a) }
    : { width: even((short * a) / b), height: short };
}
