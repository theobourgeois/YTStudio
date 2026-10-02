/**
 * The Playlist's maths: where ticks and tracks are on screen (tracks have heights of their own, FL's
 * track Size), which clip and which of its edges is under the pointer, how many tracks to show. Pure, so
 * it's tested; the canvas and the pointer handlers are thin over it. Snap and the grid are the Piano
 * roll's (`../piano/geometry.ts`).
 */
import { clamp } from "@shared/math";
import { type ClipContext, clipAt, clipEnd, fadeShape, lastUsedTrack } from "@shared/music/playlist";
import { MAX_PLAYLIST_TRACKS, MAX_SONG_TICKS } from "@shared/music/project";
import type { PlaylistClip, PlaylistTrack, TimeMarker } from "@shared/music/types";
import { STEP_TICKS } from "@shared/music/types";
import type { PlaylistView } from "./store";

/** A track's height at size 1 (FL's track height control zooms it), and its limits. */
export const DEFAULT_TRACK_HEIGHT = 48;
export const MIN_TRACK_HEIGHT = 18;
export const MAX_TRACK_HEIGHT = 160;
/** The furthest out the view ever zooms; how far it may for a song is `minPxPerTick`. */
export const MIN_PX_PER_TICK = 0.0005;
export const MAX_PX_PER_TICK = 2;
/** Fully zoomed out shows at least this many bars, however short the song. */
export const MIN_ZOOM_OUT_BARS = 32;
/** How close to a clip's edge (px) a press resizes it rather than moving it, and how much of a short clip that may be. */
export const EDGE_ZONE = 6;
/** Empty tracks shown below the last one in use, so there's always room to put a clip lower. */
export const SPARE_TRACKS = 8;
/** The fewest tracks shown. */
export const MIN_TRACKS = 16;
/** The strip at the top of a clip with its name. */
export const TITLE_HEIGHT = 13;
/** The ruler's height, and the band along its bottom where the time markers are. */
export const RULER_HEIGHT = 32;
export const MARKER_BAND = 12;

/** How wide a marker's label is on the ruler (its flag and its name, about), in px. */
export const markerWidth = (marker: Pick<TimeMarker, "name">) => 12 + Math.ceil(marker.name.length * 5.6);

/** The time marker under a point of the ruler (in its band along the bottom), the later one where two overlap. */
export function markerAt(markers: readonly TimeMarker[], view: PlaylistView, x: number, y: number, height = RULER_HEIGHT): TimeMarker | null {
  if (y < height - MARKER_BAND) return null;
  for (let i = markers.length - 1; i >= 0; i--) {
    const left = tickToX(view, markers[i].tick);
    if (x >= left - 3 && x <= left + markerWidth(markers[i])) return markers[i];
  }
  return null;
}

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
  /** The pointer is on the clip's menu arrow, at the start of its title (FL's clip menu). */
  menu: boolean;
  /** The pointer is on one of an audio clip's handles (its fades, their curves, its gain). */
  handle?: ClipHandle | null;
}

/** An audio clip's handles (FL's clip fades and gain): its fades' corners, the middles of their curves, its gain. */
export type ClipHandle = "fadeIn" | "fadeOut" | "fadeInTension" | "fadeOutTension" | "gain";

/** How close (px) the pointer must be to a handle to take it, and how far in from a clip's edge a fade's corner sits when it has no fade (past the edge's zone). */
export const HANDLE_REACH = 5;
export const HANDLE_INSET = EDGE_ZONE + 2;
/** The least an audio clip shows its handles at: px wide, and its body px tall. */
export const HANDLES_MIN_WIDTH = 40;
export const HANDLES_MIN_HEIGHT = 16;

/** Where an audio clip's body is on screen, under its title, and the px its fades take. */
export function clipBody(clip: PlaylistClip, ctx: ClipContext, layout: TrackLayout, view: PlaylistView) {
  const left = tickToX(view, clip.start);
  const right = tickToX(view, clipEnd(clip, ctx));
  const y = trackTop(layout, view, clip.track);
  const bottom = trackTop(layout, view, clip.track + 1) - 2;
  return { left, right, top: y + TITLE_HEIGHT, bottom, fadeIn: (clip.fadeIn ?? 0) * view.pxPerTick, fadeOut: (clip.fadeOut ?? 0) * view.pxPerTick };
}

/**
 * Where an audio clip's handles are (px), or null when it isn't one or it's too small to show them: each
 * fade's corner at the top of its body, the middle of each fade's curve (when there's room for it), and
 * the gain's half-circle in the middle of its bottom edge.
 */
export function clipHandles(clip: PlaylistClip, ctx: ClipContext, layout: TrackLayout, view: PlaylistView): Partial<Record<ClipHandle, { x: number; y: number }>> | null {
  if (clip.kind !== "audio") return null;
  const body = clipBody(clip, ctx, layout, view);
  const width = body.right - body.left;
  const height = body.bottom - body.top;
  if (width < HANDLES_MIN_WIDTH || height < HANDLES_MIN_HEIGHT) return null;
  const handles: Partial<Record<ClipHandle, { x: number; y: number }>> = {
    fadeIn: { x: body.left + Math.max(HANDLE_INSET, body.fadeIn), y: body.top + 3 },
    fadeOut: { x: body.right - Math.max(HANDLE_INSET, body.fadeOut), y: body.top + 3 },
    gain: { x: (body.left + body.right) / 2, y: body.bottom - 3 },
  };
  // The middle of a fade's curve: where dragging up and down bends it.
  if (body.fadeIn >= 16) handles.fadeInTension = { x: body.left + body.fadeIn / 2, y: body.bottom - fadeShape(0.5, clip.fadeInTension) * height };
  if (body.fadeOut >= 16) handles.fadeOutTension = { x: body.right - body.fadeOut / 2, y: body.bottom - fadeShape(0.5, clip.fadeOutTension) * height };
  return handles;
}

/** The handle of `clip` within reach of a point, if any. */
export function handleAt(clip: PlaylistClip, ctx: ClipContext, layout: TrackLayout, view: PlaylistView, x: number, y: number): ClipHandle | null {
  const handles = clipHandles(clip, ctx, layout, view);
  if (!handles) return null;
  let best: ClipHandle | null = null;
  let nearest = HANDLE_REACH;
  for (const [name, at] of Object.entries(handles) as [ClipHandle, { x: number; y: number }][]) {
    const distance = Math.hypot(at.x - x, at.y - y);
    if (distance <= nearest) {
      nearest = distance;
      best = name;
    }
  }
  return best;
}

/** Where a clip's menu arrow is in its title: this many px from its left edge, past the edge's zone. */
export const MENU_FROM = EDGE_ZONE;
export const MENU_TO = EDGE_ZONE + 11;

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
  const edge = x - left <= zone ? "start" : right - x <= zone ? "end" : null;
  // An audio clip's handles come before its edges (a fade's corner sits just inside one).
  const handle = handleAt(clip, ctx, layout, view, x, y);
  if (handle) return { clip, edge: null, menu: false, handle };
  const inTitle = y - trackTop(layout, view, clip.track) < TITLE_HEIGHT;
  const menu = !edge && inTitle && right - left > MENU_TO + 4 && x - left >= MENU_FROM && x - left < MENU_TO;
  return { clip, edge, menu, handle: null };
}

/**
 * How far out the view may zoom for a song ending at `songEnd` (px a tick): the whole song and some room
 * after it (an eighth of it, four bars at least) across `width` px, and never fewer than
 * `MIN_ZOOM_OUT_BARS` bars, so a short song doesn't stop zooming at two.
 */
export function minPxPerTick(songEnd: number, barTicks: number, width: number): number {
  const room = Math.max(4, Math.ceil(songEnd / barTicks / 8)) * barTicks;
  const span = Math.max(MIN_ZOOM_OUT_BARS * barTicks, songEnd + room);
  return clamp(width / span, MIN_PX_PER_TICK, MAX_PX_PER_TICK);
}

/** Zoom along time about a point: the tick under `x` stays under it (no further out than `min`). */
export function zoomAt(view: PlaylistView, x: number, pxPerTick: number, min = MIN_PX_PER_TICK): PlaylistView {
  const next = clamp(pxPerTick, min, MAX_PX_PER_TICK);
  return { ...view, pxPerTick: next, scrollTick: Math.max(0, xToTick(view, x) - x / next) };
}

/** Zoom the tracks' height about a point: the track under `y` stays under it. */
export function zoomTracksAt(view: PlaylistView, y: number, trackHeight: number): PlaylistView {
  const next = clamp(Math.round(trackHeight), MIN_TRACK_HEIGHT, MAX_TRACK_HEIGHT);
  const scale = next / view.trackHeight;
  return { ...view, trackHeight: next, scrollY: Math.max(0, (view.scrollY + y) * scale - y) };
}

/** The view showing `[from, to)` ticks across `width` pixels, with a little room either side. */
export function zoomToRange(view: PlaylistView, from: number, to: number, width: number, min = MIN_PX_PER_TICK): PlaylistView {
  const span = Math.max(STEP_TICKS * 4, to - from);
  const pxPerTick = clamp((width * 0.94) / span, min, MAX_PX_PER_TICK);
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

/**
 * The overview along the top (FL's mini playlist, its zoom and scroll bar): how many ticks it spans, the
 * whole song and the room after it that zooming out shows (`minPxPerTick`), or as far as the view goes
 * when it's scrolled past that.
 */
export function overviewSpan(view: PlaylistView, width: number, songEnd: number, barTicks: number): number {
  return Math.max(width / minPxPerTick(songEnd, barTicks, width), view.scrollTick + width / view.pxPerTick);
}

/** The narrowest the overview's window onto the view gets (px), so its ends can still be taken. */
export const OVERVIEW_MIN_THUMB = 16;
/** How far into each end of the window (px) a press zooms rather than scrolls. */
export const OVERVIEW_EDGE = 5;

/** Where the view's window is on the overview, in px across its `width`. */
export function overviewThumb(view: PlaylistView, width: number, span: number): { left: number; width: number } {
  const across = Math.max(OVERVIEW_MIN_THUMB, (width / view.pxPerTick / span) * width);
  const left = Math.min((view.scrollTick / span) * width, width - across);
  return { left: Math.max(0, left), width: Math.min(across, width) };
}

/**
 * The view as a drag on the overview leaves it, from the view it started with (`start`) and how far it's
 * gone (`dx`, px): the window moved along (`move`, never before the song's start or past the span), or
 * one of its ends taken, which zooms with the other end staying put (no further out than `min`, no
 * further in than `MAX_PX_PER_TICK`). `span` is the overview's when the drag started, so the mapping holds still.
 */
export function overviewDrag(start: PlaylistView, part: "move" | "start" | "end", dx: number, width: number, span: number, min = MIN_PX_PER_TICK): PlaylistView {
  const perPx = span / Math.max(1, width);
  const visible = width / start.pxPerTick;
  if (part === "move") {
    const last = Math.max(span - visible, start.scrollTick);
    const scrollTick = clamp(start.scrollTick + dx * perPx, 0, last);
    return scrollTick === start.scrollTick ? start : { ...start, scrollTick };
  }
  const zoomTo = (ticks: number) => clamp(width / Math.max(1, ticks), min, MAX_PX_PER_TICK);
  if (part === "end") {
    const pxPerTick = zoomTo(visible + dx * perPx);
    return { ...start, pxPerTick };
  }
  const right = start.scrollTick + visible;
  const pxPerTick = zoomTo(right - Math.max(0, start.scrollTick + dx * perPx));
  return { ...start, pxPerTick, scrollTick: Math.max(0, right - width / pxPerTick) };
}

/**
 * The tracks' height as a drag on an end of the vertical scrollbar leaves it (FL's: its ends zoom too):
 * the window `thumb` px tall grown or shrunk by `dy`, the tracks shorter or taller by as much, with the
 * opposite end's track staying put (the top one for the bottom end, the bottom one for the top end).
 */
export function trackZoomDrag(start: PlaylistView, edge: "start" | "end", dy: number, thumb: number, height: number): PlaylistView {
  const grown = Math.max(8, edge === "end" ? thumb + dy : thumb - dy);
  return zoomTracksAt(start, edge === "end" ? 0 : height, (start.trackHeight * thumb) / grown);
}
