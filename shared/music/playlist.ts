/**
 * The playlist (FL Studio's, `docs/fl-studio/playlist.md`): the song's arrangement, clips of patterns and
 * audio clip channels on numbered tracks. Like the Piano roll's notes (`notes.ts`), every operation is a
 * pure function of the clip list that returns **the same list** when there's nothing to do, and clips are
 * told apart by `id`, so what's selected is a set of ids. The song-level edits at the end apply them.
 *
 * Times are ticks of the song. A clip's `offset` is in its content's own unit: ticks of its pattern, or
 * seconds of its audio file (`ClipContext.secondsPerTick` converts), so a sliced vocal keeps its words
 * where they were in the file whatever the tempo does.
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import {
  DEFAULT_PLAYLIST_TRACK,
  MAX_AUDIO_OFFSET,
  MAX_CLIPS,
  MAX_NAME,
  MAX_PATTERN_TICKS,
  MAX_PLAYLIST_TRACKS,
  MAX_SONG_TICKS,
  MAX_TRACK_SIZE,
  MIN_TRACK_SIZE,
  byClipStart,
  createAudioChannel,
  patternSteps,
  stepsPerBar,
  trimTracks,
} from "./project.ts";
import { type MusicProject, PPQ, type Pattern, type PlaylistClip, type PlaylistTrack, STEP_TICKS } from "./types.ts";

export type ClipIds = ReadonlySet<number>;

/** What a clip's length and content depend on, besides the clip: its pattern's length, and the tempo. */
export interface ClipContext {
  /** A pattern's length in ticks (0 for one that's gone). */
  patternTicks: (patternId: string) => number;
  /** Seconds a tick lasts at the song's tempo: how an audio clip's ticks become seconds of its file. */
  secondsPerTick: number;
  /** A bar, in ticks. */
  barTicks: number;
}

const contexts = new WeakMap<MusicProject["patterns"], Map<string, ClipContext>>();

/** The song's `ClipContext` (made once per pattern list and settings: nothing changes them in place). */
export function clipContext(song: Pick<MusicProject, "patterns" | "settings">): ClipContext {
  const key = `${song.settings.tempo}|${song.settings.timeSignature.join("/")}`;
  let byKey = contexts.get(song.patterns);
  if (!byKey) contexts.set(song.patterns, (byKey = new Map()));
  let ctx = byKey.get(key);
  if (!ctx) {
    const lengths = new Map(song.patterns.map((p) => [p.id, patternSteps(p, song.settings.timeSignature) * STEP_TICKS]));
    ctx = {
      patternTicks: (id) => lengths.get(id) ?? 0,
      secondsPerTick: 60 / (song.settings.tempo * PPQ),
      barTicks: stepsPerBar(song.settings.timeSignature) * STEP_TICKS,
    };
    byKey.set(key, ctx);
  }
  return ctx;
}

/** How long a clip is, in ticks: its own length, or (following its pattern) the pattern's from its offset. */
export function clipLength(clip: PlaylistClip, ctx: ClipContext): number {
  if (clip.length !== null) return clip.length;
  return Math.max(STEP_TICKS, ctx.patternTicks(clip.ref) - clip.offset);
}

export const clipEnd = (clip: PlaylistClip, ctx: ClipContext) => clip.start + clipLength(clip, ctx);

/** A move of `ticks` along the song, in the clip's content's unit (ticks of a pattern, seconds of audio). */
export const contentDelta = (clip: Pick<PlaylistClip, "kind">, ticks: number, ctx: ClipContext) => (clip.kind === "audio" ? ticks * ctx.secondsPerTick : ticks);

/** Where a clip's content is at a tick of the song: ticks into its pattern, or seconds into its file. */
export const contentAt = (clip: PlaylistClip, tick: number, ctx: ClipContext) => clip.offset + contentDelta(clip, tick - clip.start, ctx);

// ---------------------------------------------------------------------------
// Looking
// ---------------------------------------------------------------------------

export interface ClipBounds {
  /** Ticks: the earliest start and the latest end. */
  start: number;
  end: number;
  /** The first and last track. */
  top: number;
  bottom: number;
}

/** What the given clips span (every clip, without `ids`), or null if there are none. */
export function clipBounds(clips: readonly PlaylistClip[], ctx: ClipContext, ids?: ClipIds): ClipBounds | null {
  let bounds: ClipBounds | null = null;
  for (const clip of clips) {
    if (ids && !ids.has(clip.id)) continue;
    const end = clipEnd(clip, ctx);
    if (!bounds) bounds = { start: clip.start, end, top: clip.track, bottom: clip.track };
    else {
      if (clip.start < bounds.start) bounds.start = clip.start;
      if (end > bounds.end) bounds.end = end;
      if (clip.track < bounds.top) bounds.top = clip.track;
      if (clip.track > bounds.bottom) bounds.bottom = clip.track;
    }
  }
  return bounds;
}

/** Each clip list's longest clip, per context: a clip that starts before the view may still reach into it. */
const longest = new WeakMap<readonly PlaylistClip[], { ctx: ClipContext; length: number }>();

function longestClip(clips: readonly PlaylistClip[], ctx: ClipContext): number {
  const known = longest.get(clips);
  if (known?.ctx === ctx) return known.length;
  let length = 0;
  for (const clip of clips) length = Math.max(length, clipLength(clip, ctx));
  longest.set(clips, { ctx, length });
  return length;
}

/** The index of the first clip that starts at or after `tick` (the list is in order of start). */
function firstFrom(clips: readonly PlaylistClip[], tick: number): number {
  let low = 0;
  let high = clips.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (clips[mid].start < tick) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * The slice of the list that can show between two ticks: `[from, to)` indexes. Every clip in view is in
 * it; a few just outside may be too.
 */
export function visibleClips(clips: readonly PlaylistClip[], fromTick: number, toTick: number, ctx: ClipContext): [number, number] {
  return [firstFrom(clips, fromTick - longestClip(clips, ctx)), firstFrom(clips, toTick)];
}

/** The clips a rectangle touches: any part of them in `[from, to)` ticks, on a track from `top` to `bottom`. */
export function clipsInRect(clips: readonly PlaylistClip[], from: number, to: number, top: number, bottom: number, ctx: ClipContext): number[] {
  const found: number[] = [];
  const [first, last] = visibleClips(clips, from, to, ctx);
  for (let i = first; i < last; i++) {
    const clip = clips[i];
    if (clipEnd(clip, ctx) > from && clip.track >= top && clip.track <= bottom) found.push(clip.id);
  }
  return found;
}

/** The clips any part of which is in `[from, to)`: what a time selection selects, on every track. */
export const clipsInTime = (clips: readonly PlaylistClip[], from: number, to: number, ctx: ClipContext) => clipsInRect(clips, from, to, 0, MAX_PLAYLIST_TRACKS, ctx);

/** The clip on a track at a tick, if any: where several overlap, the one drawn last (on top), unless a selected one is there. */
export function clipAt(clips: readonly PlaylistClip[], track: number, tick: number, ctx: ClipContext, selected?: ClipIds): PlaylistClip | null {
  const [first, last] = visibleClips(clips, tick, tick + 1, ctx);
  let best: PlaylistClip | null = null;
  for (let i = first; i < last; i++) {
    const clip = clips[i];
    if (clip.track !== track || tick < clip.start || tick >= clipEnd(clip, ctx)) continue;
    if (!best || selected?.has(clip.id) || !selected?.has(best.id)) best = clip;
  }
  return best;
}

/** The last track with a clip on it, or -1. */
export function lastUsedTrack(clips: readonly PlaylistClip[]): number {
  let last = -1;
  for (const clip of clips) if (clip.track > last) last = clip.track;
  return last;
}

/**
 * How long the song is in song mode: to the end of its last clip's bar (a bar at least). Played, it goes
 * round to its start from there (Théo).
 */
export function songTicks(song: Pick<MusicProject, "patterns" | "settings" | "playlist">): number {
  const ctx = clipContext(song);
  let end = 0;
  for (const clip of song.playlist.clips) end = Math.max(end, clipEnd(clip, ctx));
  return Math.max(1, Math.ceil(end / ctx.barTicks)) * ctx.barTicks;
}

/**
 * Where a pattern is at a tick of the song: inside a clip of it that's there (its first, by start), ticks
 * into the pattern; null where none of its clips is, or past the pattern's end in one (where it plays nothing).
 */
export function patternTickInSong(song: Pick<MusicProject, "patterns" | "settings" | "playlist">, patternId: string, tick: number): number | null {
  const ctx = clipContext(song);
  const { clips } = song.playlist;
  const [first, last] = visibleClips(clips, tick, tick + 1, ctx);
  for (let i = first; i < last; i++) {
    const clip = clips[i];
    if (clip.kind !== "pattern" || clip.ref !== patternId || tick < clip.start || tick >= clipEnd(clip, ctx)) continue;
    const at = contentAt(clip, tick, ctx);
    if (at < ctx.patternTicks(patternId)) return at;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adding and removing
// ---------------------------------------------------------------------------

export type NewClip = Pick<PlaylistClip, "kind" | "ref" | "track" | "start"> & Partial<Pick<PlaylistClip, "length" | "offset" | "muted">>;

/** A new clip list, and the ids of the clips it gained. */
export interface CreatedClips {
  clips: PlaylistClip[];
  created: number[];
}

const nothing = (clips: PlaylistClip[]): CreatedClips => ({ clips, created: [] });

/** An id no clip of the list has. */
export function nextClipId(clips: readonly PlaylistClip[]): number {
  let max = 0;
  for (const clip of clips) if (clip.id > max) max = clip.id;
  return max + 1;
}

function tidy(clip: NewClip, id: number): PlaylistClip {
  const start = clamp(Math.round(clip.start), 0, MAX_SONG_TICKS - 1);
  return {
    id,
    kind: clip.kind,
    ref: clip.ref,
    track: clamp(Math.round(clip.track), 0, MAX_PLAYLIST_TRACKS - 1),
    start,
    length: clip.length === null || (clip.length === undefined && clip.kind === "pattern") ? null : clamp(Math.round(clip.length ?? STEP_TICKS), 1, MAX_SONG_TICKS - start),
    offset: clip.kind === "audio" ? clamp(clip.offset ?? 0, 0, MAX_AUDIO_OFFSET) : clamp(Math.round(clip.offset ?? 0), 0, MAX_PATTERN_TICKS),
    muted: clip.muted ?? false,
  };
}

/** Add clips, with ids of their own. Past `MAX_CLIPS`, no more are added. */
export function addClips(clips: PlaylistClip[], added: readonly NewClip[]): CreatedClips {
  const room = Math.max(0, MAX_CLIPS - clips.length);
  if (!added.length || !room) return nothing(clips);
  const first = nextClipId(clips);
  const made = added.slice(0, room).map((clip, i) => tidy(clip, first + i));
  return { clips: [...clips, ...made].sort(byClipStart), created: made.map((c) => c.id) };
}

export function removeClips(clips: PlaylistClip[], ids: ClipIds): PlaylistClip[] {
  if (!ids.size) return clips;
  const kept = clips.filter((c) => !ids.has(c.id));
  return kept.length === clips.length ? clips : kept;
}

/** The ids an operation acts on: the selection, or every clip when nothing is selected (as in FL Studio). */
export const orAllClips = (clips: readonly PlaylistClip[], ids: ClipIds): ClipIds => (ids.size ? ids : new Set(clips.map((c) => c.id)));

// ---------------------------------------------------------------------------
// Changing the clips there are
// ---------------------------------------------------------------------------

/** Apply `change` to the clips in `ids`, re-sorting only if one was changed. */
function mapClips(clips: PlaylistClip[], ids: ClipIds, change: (clip: PlaylistClip) => PlaylistClip): PlaylistClip[] {
  if (!ids.size) return clips;
  let any = false;
  const next = clips.map((clip) => {
    if (!ids.has(clip.id)) return clip;
    const changed = change(clip);
    any ||= changed !== clip;
    return changed;
  });
  return any ? next.sort(byClipStart) : clips;
}

/**
 * Move clips along the song and between tracks. They move together: if one would go before the song's
 * start or off the first or last track, they all stop there.
 */
export function moveClips(clips: PlaylistClip[], ids: ClipIds, ticks: number, tracks: number, ctx: ClipContext): PlaylistClip[] {
  const bounds = clipBounds(clips, ctx, ids);
  if (!bounds) return clips;
  const dt = clamp(Math.round(ticks), -bounds.start, MAX_SONG_TICKS - 1 - bounds.start);
  const dk = clamp(Math.round(tracks), -bounds.top, MAX_PLAYLIST_TRACKS - 1 - bounds.bottom);
  if (!dt && !dk) return clips;
  return mapClips(clips, ids, (clip) => ({ ...clip, start: clip.start + dt, track: clip.track + dk }));
}

/** Copies of clips, moved by `ticks` and `tracks` (Shift+drag): the originals stay. */
export function cloneClips(clips: PlaylistClip[], ids: ClipIds, ticks: number, tracks: number, ctx: ClipContext): CreatedClips {
  const copied = clips.filter((c) => ids.has(c.id));
  const bounds = clipBounds(copied, ctx);
  if (!bounds) return nothing(clips);
  const dt = clamp(Math.round(ticks), -bounds.start, MAX_SONG_TICKS - 1 - bounds.start);
  const dk = clamp(Math.round(tracks), -bounds.top, MAX_PLAYLIST_TRACKS - 1 - bounds.bottom);
  return addClips(
    clips,
    copied.map((c) => ({ ...c, start: c.start + dt, track: c.track + dk })),
  );
}

/**
 * Resize clips by an edge, `ticks` along (FL: either edge, Théo). The end makes them longer or shorter;
 * the start moves where the window begins, the content staying put (a clip can't reach before its content's
 * start, or the song's). A resized pattern clip stops following its pattern's length. None gets shorter than `min`.
 */
export function resizeClips(clips: PlaylistClip[], ids: ClipIds, edge: "start" | "end", ticks: number, ctx: ClipContext, min = 1): PlaylistClip[] {
  const by = Math.round(ticks);
  const least = Math.max(1, Math.round(min));
  return mapClips(clips, ids, (clip) => {
    const length = clipLength(clip, ctx);
    if (edge === "end") {
      const next = clamp(length + by, least, MAX_SONG_TICKS - clip.start);
      return next === length && clip.length !== null ? clip : { ...clip, length: next };
    }
    // How far back the start can go: to the content's start, and the song's.
    const back = clip.kind === "audio" ? Math.floor(clip.offset / ctx.secondsPerTick + 1e-9) : clip.offset;
    const dt = clamp(by, -Math.min(back, clip.start), length - least);
    if (!dt) return clip;
    const offset = clip.kind === "audio" ? Math.max(0, clip.offset + dt * ctx.secondsPerTick) : clip.offset + dt;
    return { ...clip, start: clip.start + dt, length: length - dt, offset };
  });
}

/**
 * Slip clips' content `ticks` along inside them (the slip tool), their windows staying where they are. The
 * content can't move so far right that the window would start before it.
 */
export function slipClips(clips: PlaylistClip[], ids: ClipIds, ticks: number, ctx: ClipContext): PlaylistClip[] {
  const by = Math.round(ticks);
  if (!by) return clips;
  return mapClips(clips, ids, (clip) => {
    const offset = clip.kind === "audio" ? clamp(clip.offset - by * ctx.secondsPerTick, 0, MAX_AUDIO_OFFSET) : clamp(clip.offset - by, 0, MAX_PATTERN_TICKS);
    // Its length is fixed from now on: slipping the content mustn't change where the clip ends.
    return offset === clip.offset ? clip : { ...clip, offset, length: clipLength(clip, ctx) };
  });
}

/**
 * Slice: cut clips in two at `at` (on the tracks from `top` to `bottom`, or the ones in `ids`). The first
 * part keeps the clip's id; the second is a new clip, starting at the cut, its content carrying on from
 * there. A cut at a clip's very start or end, or outside it, leaves it whole.
 */
export function sliceClips(clips: PlaylistClip[], at: number, top: number, bottom: number, ctx: ClipContext, ids?: ClipIds): CreatedClips {
  const cut = Math.round(at);
  const tails: NewClip[] = [];
  const low = Math.min(top, bottom);
  const high = Math.max(top, bottom);
  const next = clips.map((clip) => {
    if (clip.track < low || clip.track > high || (ids?.size && !ids.has(clip.id))) return clip;
    const end = clipEnd(clip, ctx);
    if (cut <= clip.start || cut >= end) return clip;
    tails.push({ ...clip, start: cut, length: end - cut, offset: contentAt(clip, cut, ctx) });
    return { ...clip, length: cut - clip.start };
  });
  if (!tails.length) return nothing(clips);
  return addClips(next, tails);
}

export type ClipPatch = Partial<Pick<PlaylistClip, "muted">>;

/** Set properties of clips outright (mute). */
export function setClipProps(clips: PlaylistClip[], ids: ClipIds, patch: ClipPatch): PlaylistClip[] {
  return mapClips(clips, ids, (clip) => (patch.muted === undefined || patch.muted === clip.muted ? clip : { ...clip, muted: patch.muted }));
}

/** Put clips' starts on a grid (Quick quantize). */
export function quantizeClips(clips: PlaylistClip[], ids: ClipIds, grid: number): PlaylistClip[] {
  if (!(grid >= 1)) return clips;
  return mapClips(clips, orAllClips(clips, ids), (clip) => {
    const start = clamp(Math.round(Math.round(clip.start / grid) * grid), 0, MAX_SONG_TICKS - 1);
    return start === clip.start ? clip : { ...clip, start };
  });
}

/**
 * Duplicate to the right (Ctrl+B): copies of the selected clips (or of all of them) placed `interval`
 * later. Without an interval (no time selection), it's what the clips span, rounded up to the snap's
 * `grid`: the copy starts straight after the original.
 */
export function duplicateClips(clips: PlaylistClip[], ids: ClipIds, grid: number, ctx: ClipContext, interval?: number): CreatedClips & { interval: number } {
  const chosen = orAllClips(clips, ids);
  const bounds = clipBounds(clips, ctx, chosen);
  if (!bounds) return { ...nothing(clips), interval: 0 };
  const step = Math.max(1, Math.round(grid));
  const by = interval && interval > 0 ? Math.round(interval) : Math.max(step, Math.ceil((bounds.end - bounds.start) / step) * step);
  const copies = clips.filter((c) => chosen.has(c.id) && c.start + by < MAX_SONG_TICKS).map((c) => ({ ...c, start: c.start + by }));
  return { ...addClips(clips, copies), interval: by };
}

/** Clips as they're copied: relative to the first one's start (they keep their tracks), to paste anywhere. */
export function copyClips(clips: readonly PlaylistClip[], ids: ClipIds): PlaylistClip[] {
  const copied = clips.filter((c) => ids.has(c.id));
  const start = copied.length ? copied[0].start : 0;
  return copied.map((c) => ({ ...c, start: c.start - start }));
}

/** Paste copied clips with the first at `at`, on their own tracks. */
export const pasteClips = (clips: PlaylistClip[], copied: readonly PlaylistClip[], at: number): CreatedClips =>
  addClips(
    clips,
    copied.filter((c) => c.start + at < MAX_SONG_TICKS).map((c) => ({ ...c, start: c.start + at })),
  );

/**
 * Insert space (Ctrl+Ins): everything from `from` on moves `to - from` later, on every track. With
 * `slice` (Ctrl+Alt+Ins), clips that cross `from` are cut there first, their second part moving too.
 */
export function insertSpace(clips: PlaylistClip[], from: number, to: number, ctx: ClipContext, slice = false): PlaylistClip[] {
  const by = Math.round(to - from);
  if (by <= 0) return clips;
  const cut = slice ? sliceClips(clips, from, 0, MAX_PLAYLIST_TRACKS - 1, ctx).clips : clips;
  const moving = new Set(cut.filter((c) => c.start >= from).map((c) => c.id));
  if (!moving.size) return cut;
  return mapClips(cut, moving, (clip) => (clip.start + by >= MAX_SONG_TICKS ? clip : { ...clip, start: clip.start + by }));
}

/**
 * Delete space (Ctrl+Del): what's between `from` and `to` goes, on every track (clips crossing its edges
 * are cut there), and everything after it moves back to close the gap.
 */
export function deleteSpace(clips: PlaylistClip[], from: number, to: number, ctx: ClipContext): PlaylistClip[] {
  const by = Math.round(to - from);
  if (by <= 0) return clips;
  const last = MAX_PLAYLIST_TRACKS - 1;
  const cut = sliceClips(sliceClips(clips, from, 0, last, ctx).clips, to, 0, last, ctx).clips;
  const inside = new Set(cut.filter((c) => c.start >= from && c.start < to).map((c) => c.id));
  const kept = removeClips(cut, inside);
  const after = new Set(kept.filter((c) => c.start >= to).map((c) => c.id));
  const result = mapClips(kept, after, (clip) => ({ ...clip, start: clip.start - by }));
  return result === clips ? clips : result;
}

// ---------------------------------------------------------------------------
// The song
// ---------------------------------------------------------------------------

/** Apply a clip-list operation to the song's playlist (the same song if it changes nothing). */
export function editClips(song: MusicProject, update: (clips: PlaylistClip[], ctx: ClipContext) => PlaylistClip[]): MusicProject {
  const clips = update(song.playlist.clips, clipContext(song));
  return clips === song.playlist.clips ? song : { ...song, playlist: { ...song.playlist, clips } };
}

/** A track as it is (as new, past the end of the list). */
export const trackAt = (song: Pick<MusicProject, "playlist">, index: number): PlaylistTrack => song.playlist.tracks[index] ?? DEFAULT_PLAYLIST_TRACK;

/** "Track 3": a track's name, or its number's. */
export const trackName = (song: Pick<MusicProject, "playlist">, index: number) => trackAt(song, index).name ?? `Track ${index + 1}`;

function setTracks(song: MusicProject, tracks: PlaylistTrack[]): MusicProject {
  const trimmed = trimTracks(tracks);
  const same = trimmed.length === song.playlist.tracks.length && trimmed.every((t, i) => t === song.playlist.tracks[i]);
  return same ? song : { ...song, playlist: { ...song.playlist, tracks: trimmed } };
}

export type TrackPatch = Partial<PlaylistTrack>;

/** Change tracks' name, colour, size or mute. A track given back its defaults is as new again. */
export function updateTracks(song: MusicProject, indexes: readonly number[], patch: TrackPatch): MusicProject {
  const valid = indexes.filter((i) => Number.isInteger(i) && i >= 0 && i < MAX_PLAYLIST_TRACKS);
  if (!valid.length) return song;
  const tracks = [...song.playlist.tracks];
  const count = Math.max(tracks.length, Math.max(...valid) + 1);
  while (tracks.length < count) tracks.push(DEFAULT_PLAYLIST_TRACK);
  for (const index of valid) {
    const was = tracks[index];
    const next: PlaylistTrack = {
      name: patch.name === undefined ? was.name : patch.name?.trim().slice(0, MAX_NAME) || null,
      color: patch.color === undefined ? was.color : patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color.toLowerCase() : null,
      size: patch.size === undefined ? was.size : Math.round(clamp(patch.size, MIN_TRACK_SIZE, MAX_TRACK_SIZE) * 100) / 100,
      muted: patch.muted ?? was.muted,
    };
    const same = next.name === was.name && next.color === was.color && next.size === was.size && next.muted === was.muted;
    if (!same) tracks[index] = next;
  }
  return setTracks(song, tracks);
}

export const updateTrack = (song: MusicProject, index: number, patch: TrackPatch) => updateTracks(song, [index], patch);

/**
 * Solo a track, as channels are soloed: every other track in use (or named, coloured, muted) is muted and
 * this one unmuted; soloing the track that's already alone unmutes them all.
 */
export function soloTrack(song: MusicProject, index: number): MusicProject {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PLAYLIST_TRACKS) return song;
  const count = Math.max(song.playlist.tracks.length, lastUsedTrack(song.playlist.clips) + 1, index + 1);
  const others = Array.from({ length: count }, (_, i) => i).filter((i) => i !== index);
  const alone = !trackAt(song, index).muted && others.every((i) => trackAt(song, i).muted);
  if (alone) return updateTracks(song, others, { muted: false });
  return updateTrack(updateTracks(song, others, { muted: true }), index, { muted: false });
}

/** The track numbers' new order after a change: `map[old] = new`, or -1 for one that's gone. */
function renumber(song: MusicProject, map: (index: number) => number): MusicProject {
  const tracks: PlaylistTrack[] = [];
  song.playlist.tracks.forEach((track, i) => {
    const to = map(i);
    if (to >= 0 && to < MAX_PLAYLIST_TRACKS) tracks[to] = track;
  });
  for (let i = 0; i < tracks.length; i++) tracks[i] ??= DEFAULT_PLAYLIST_TRACK;
  const clips = song.playlist.clips.flatMap((clip) => {
    const to = map(clip.track);
    if (to < 0 || to >= MAX_PLAYLIST_TRACKS) return [];
    return [to === clip.track ? clip : { ...clip, track: to }];
  });
  const changed = clips.length !== song.playlist.clips.length || clips.some((c, i) => c !== song.playlist.clips[i]);
  const next = setTracks(song, tracks);
  return changed ? { ...next, playlist: { ...next.playlist, clips: clips.sort(byClipStart) } } : next;
}

/** Insert an empty track before `index`: it and everything below it moves down a track. */
export const insertTrack = (song: MusicProject, index: number) => renumber(song, (i) => (i >= index ? i + 1 : i));

/** Delete a track and its clips: everything below it moves up a track. */
export const deleteTrack = (song: MusicProject, index: number) => renumber(song, (i) => (i === index ? -1 : i > index ? i - 1 : i));

/** Move a track up (-1) or down (1), its clips with it (Shift+wheel over the headers, the menu's Move up / down). */
export function moveTrack(song: MusicProject, index: number, direction: -1 | 1): MusicProject {
  const to = index + direction;
  if (to < 0 || to >= MAX_PLAYLIST_TRACKS) return song;
  return renumber(song, (i) => (i === index ? to : i === to ? index : i));
}

/**
 * Make unique: the clip gets a copy of its pattern of its own (named "Pattern 1 #2", right after the
 * original), so editing it changes no other clip. Audio clips share their file; only patterns are copied.
 */
export function makeUnique(song: MusicProject, clipId: number, newId = createId("pat")): MusicProject {
  const clip = song.playlist.clips.find((c) => c.id === clipId);
  const index = clip?.kind === "pattern" ? song.patterns.findIndex((p) => p.id === clip.ref) : -1;
  if (!clip || index < 0) return song;
  const original = song.patterns[index];
  const copy: Pattern = { ...original, id: newId, name: uniqueName(song, original.name) };
  return {
    ...song,
    patterns: [...song.patterns.slice(0, index + 1), copy, ...song.patterns.slice(index + 1)],
    playlist: { ...song.playlist, clips: song.playlist.clips.map((c) => (c === clip ? { ...c, ref: newId } : c)) },
  };
}

/** "Name #2": the first such name no pattern has. */
function uniqueName(song: MusicProject, name: string): string {
  const base = name.replace(/ #\d+$/, "");
  const names = new Set(song.patterns.map((p) => p.name));
  for (let n = 2; ; n++) if (!names.has(`${base} #${n}`)) return `${base} #${n}`.slice(0, MAX_NAME);
}

/**
 * Split by channel (FL's, the pattern's menu): the pattern is replaced by one pattern per channel that has
 * notes in it, each named after its channel and holding only its notes, in its place in the list. Every
 * clip of it on the playlist becomes one clip per channel: the first on its track, the others on the free
 * tracks below it (no clip there in its time). Each new pattern is as long as the old one was, so the
 * clips line up. One edit, so one undo step brings the pattern back. `ids` names the new patterns.
 */
export function splitByChannel(song: MusicProject, patternId: string, ids: () => string = () => createId("pat")): MusicProject {
  const index = song.patterns.findIndex((p) => p.id === patternId);
  if (index < 0) return song;
  const pattern = song.patterns[index];
  const channels = song.channels.filter((c) => pattern.notes[c.id]?.length);
  if (!channels.length) return song;
  const steps = patternSteps(pattern, song.settings.timeSignature);
  const names = new Set(song.patterns.filter((p) => p.id !== patternId).map((p) => p.name));
  const parts: Pattern[] = channels.map((channel) => {
    let name = channel.name;
    for (let n = 2; names.has(name); n++) name = `${channel.name} #${n}`;
    names.add(name);
    return { id: ids(), name: name.slice(0, MAX_NAME), length: steps, notes: { [channel.id]: pattern.notes[channel.id] } };
  });

  const ctx = clipContext(song);
  const originals = song.playlist.clips.filter((c) => c.kind === "pattern" && c.ref === patternId);
  const gone = new Set(originals.map((c) => c.id));
  let clips = song.playlist.clips.filter((c) => !gone.has(c.id));
  for (const clip of originals) {
    const start = clip.start;
    const end = clipEnd(clip, ctx);
    const busy = (track: number) => clips.some((c) => c.track === track && c.start < end && clipEnd(c, ctx) > start);
    const placed: NewClip[] = [];
    let track = clip.track;
    parts.forEach((part, i) => {
      if (i > 0) {
        track++;
        while (track < MAX_PLAYLIST_TRACKS - 1 && busy(track)) track++;
      }
      placed.push({ kind: "pattern", ref: part.id, track: Math.min(track, MAX_PLAYLIST_TRACKS - 1), start, length: clip.length, offset: clip.offset, muted: clip.muted });
    });
    clips = addClips(clips, placed).clips;
  }
  return {
    ...song,
    patterns: [...song.patterns.slice(0, index), ...parts, ...song.patterns.slice(index + 1)],
    playlist: { ...song.playlist, clips },
  };
}

/**
 * Audio files dropped on the playlist (FL Studio's audio clips): a channel of its own for each file, in the
 * rack's Audio group, and a clip of it as long as the file, the first at `start` on `track` and each next one
 * on the track below (`after`: one after another on the same track instead, FL's Shift). `seconds` is each
 * file's length.
 */
export function addAudioClips(
  song: MusicProject,
  files: readonly { channelId?: string; name: string; sampleId: string; seconds: number }[],
  at: { start: number; track: number; after?: boolean },
): { song: MusicProject; channelIds: string[]; clipIds: number[] } {
  if (!files.length) return { song, channelIds: [], clipIds: [] };
  const ctx = clipContext(song);
  const channels = files.map((f) => createAudioChannel(f.name.trim().slice(0, MAX_NAME) || "Audio", f.sampleId, f.channelId));
  let start = Math.max(0, Math.round(at.start));
  const added: NewClip[] = files.map((file, i) => {
    const length = Math.max(1, Math.round(file.seconds / ctx.secondsPerTick));
    const clip: NewClip = { kind: "audio", ref: channels[i].id, track: at.after ? at.track : at.track + i, start, length, offset: 0 };
    if (at.after) start += length;
    return clip;
  });
  const result = addClips(song.playlist.clips, added);
  return {
    song: { ...song, channels: [...song.channels, ...channels], playlist: { ...song.playlist, clips: result.clips } },
    channelIds: channels.map((c) => c.id),
    clipIds: result.created,
  };
}
