/**
 * The Playlist's maths: where ticks and tracks are on screen (tracks have heights of their own, FL's
 * track Size), which clip and which of its edges is under the pointer, how many tracks to show. Pure, so
 * it's tested; the canvas and the pointer handlers are thin over it. Snap and the grid are the Piano
 * roll's (`../piano/geometry.ts`).
 */
import { clamp } from "@shared/math";
import { type ClipContext, clipAt, clipEnd, lastUsedTrack } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS, MAX_SONG_TICKS } from "@shared/music/project";
import type { PlaylistClip, PlaylistTrack } from "@shared/music/types";
import { STEP_TICKS } from "@shared/music/types";
import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT, type PlaylistView } from "./store";

export const MIN_PX_PER_TICK = 0.005;
export const MAX_PX_PER_TICK = 2;
/** How close to a clip's edge (px) a press resizes it rather than moving it, and how much of a short clip that may be. */
export const EDGE_ZONE = 6;
/** Empty tracks shown below the last one in use, so there's always room to put a clip lower. */
export const SPARE_TRACKS = 8;
/** The fewest tracks shown. */
export const MIN_TRACKS = 16;
/** The strip at the top of a clip with its name. */
export const TITLE_HEIGHT = 13;

export const tickToX = (view: PlaylistView, tick: number) => (tick - view.scrollTick) * view.pxPerTick;
export const xToTick = (view: PlaylistView, x: number) => x / view.pxPerTick + view.scrollTick;

/** Where each track's top is, from the first's (`tops[i]`), and the bottom of the last (`tops[count]`). */
export type TrackLayout = number[];

const layouts = new WeakMap<readonly PlaylistTrack[], Map<string, TrackLayout>>();

/** The tracks' tops for `count` tracks at a track height (made once per tracks list, count and height). */
export function trackLayout(tracks: readonly PlaylistTrack[], count: number, trackHeight: number): TrackLayout {
  const key = `${count}|${trackHeight}`;
  let byKey = layouts.get(tracks);
  if (!byKey) layouts.set(tracks, (byKey = new Map()));
  let layout = byKey.get(key);
  if (!layout) {
    layout = [0];
    for (let i = 0; i < count; i++) layout.push(layout[i] + trackHeightOf(tracks[i]?.size ?? 1, trackHeight));
    byKey.set(key, layout);
  }
  return layout;
}

/** A track's height in px: its size times the tracks' height, never too small to see. */
export const trackHeightOf = (size: number, trackHeight: number) => Math.max(MIN_TRACK_HEIGHT * 0.5, Math.round(size * trackHeight));

/** The top of a track on screen. */
export const trackTop = (layout: TrackLayout, view: PlaylistView, track: number) => (layout[Math.min(track, layout.length - 1)] ?? 0) - view.scrollY;

/** The track a y on screen is in (the last one past the end, the first above the top). */
export function yToTrack(layout: TrackLayout, view: PlaylistView, y: number): number {
  const at = y + view.scrollY;
  let low = 0;
  let high = layout.length - 2;
  if (high < 0) return 0;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (layout[mid] <= at) low = mid;
    else high = mid - 1;
  }
  return clamp(low, 0, MAX_PLAYLIST_TRACKS - 1);
}

/** The tracks shown: those in use or changed, some spare ones, and enough to fill `height` px. */
export function shownTracks(clips: readonly PlaylistClip[], tracks: readonly PlaylistTrack[], trackHeight: number, scrollY: number, height: number): number {
  const used = Math.max(lastUsedTrack(clips) + 1, tracks.length) + SPARE_TRACKS;
  const filling = Math.ceil((scrollY + height) / Math.max(1, trackHeight * 0.5));
  return clamp(Math.max(MIN_TRACKS, used, Math.min(filling, used + 64)), 1, MAX_PLAYLIST_TRACKS);
}

/** The first and last track (inclusive) any part of which is in view. */
export function visibleTracks(layout: TrackLayout, view: PlaylistView, height: number): [number, number] {
  return [yToTrack(layout, view, 0), yToTrack(layout, view, height)];
}

export interface ClipHit {
  clip: PlaylistClip;
  /** The pointer is on an edge: a drag resizes from there. */
  edge: "start" | "end" | null;
}

/**
 * The clip under a point, if any (a selected one where several overlap, else the one on top), and whether
 * the pointer is on one of its edges: the outer `EDGE_ZONE` px of each end, never more than a third of it.
 */
export function hitClip(clips: readonly PlaylistClip[], ctx: ClipContext, layout: TrackLayout, view: PlaylistView, x: number, y: number, selected?: ReadonlySet<number>): ClipHit | null {
  const track = yToTrack(layout, view, y);
  if (y + view.scrollY >= layout[layout.length - 1]) return null;
  const clip = clipAt(clips, track, xToTick(view, x), ctx, selected);
  if (!clip) return null;
  const left = tickToX(view, clip.start);
  const right = tickToX(view, clipEnd(clip, ctx));
  const zone = Math.min(EDGE_ZONE, (right - left) / 3);
  return { clip, edge: x - left <= zone ? "start" : right - x <= zone ? "end" : null };
}

/** Zoom along time about a point: the tick under `x` stays under it. */
export function zoomAt(view: PlaylistView, x: number, pxPerTick: number): PlaylistView {
  const next = clamp(pxPerTick, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
  return { ...view, pxPerTick: next, scrollTick: Math.max(0, xToTick(view, x) - x / next) };
}

/** Zoom the tracks' height about a point: the track under `y` stays under it. */
export function zoomTracksAt(view: PlaylistView, y: number, trackHeight: number): PlaylistView {
  const next = clamp(Math.round(trackHeight), MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT);
  const scale = next / view.trackHeight;
  return { ...view, trackHeight: next, scrollY: Math.max(0, (view.scrollY + y) * scale - y) };
}

/** The view showing `[from, to)` ticks across `width` pixels, with a little room either side. */
export function zoomToRange(view: PlaylistView, from: number, to: number, width: number): PlaylistView {
  const span = Math.max(STEP_TICKS * 4, to - from);
  const pxPerTick = clamp((width * 0.94) / span, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
  return { ...view, pxPerTick, scrollTick: Math.max(0, from - (width / pxPerTick - span) / 2) };
}

/** The view scrolled by `dx` px along time and `dy` px down the tracks (never before the start). */
export function scrollViewBy(view: PlaylistView, dx: number, dy: number, maxY: number): PlaylistView {
  const scrollTick = clamp(view.scrollTick + dx / view.pxPerTick, 0, MAX_SONG_TICKS);
  const scrollY = clamp(view.scrollY + dy, 0, Math.max(0, maxY));
  return scrollTick === view.scrollTick && scrollY === view.scrollY ? view : { ...view, scrollTick, scrollY };
}

/**
 * The starts of the clips a paint stroke lays down from `from` to the pointer at `to`: one every
 * `length` ticks (never closer than a grid cell), from where the stroke began, rightwards.
 */
export function paintClipStarts(from: number, to: number, length: number, grid: number): number[] {
  const every = Math.max(grid, Math.ceil(length / grid) * grid);
  const starts: number[] = [];
  for (let at = from; at <= Math.max(from, to); at += every) starts.push(at);
  return starts;
}
