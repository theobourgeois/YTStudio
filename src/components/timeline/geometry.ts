/**
 * Pure timeline geometry: lane layout, ruler ticks, snapping, zoom and
 * virtualisation math. No DOM access here so it can be unit-tested.
 * Horizontal positions are "lane px" (0 = time 0) unless stated otherwise.
 */
import type { Project, Track, TrackKind } from "@shared/types";
import { snapPoints, snapTime } from "@shared/timeline";
import { EPS, clamp } from "@shared/math";
import {
  AUDIO_LANE_HEIGHT,
  CLIP_INSET_Y,
  EDGE_SCROLL_MAX_SPEED,
  EDGE_SCROLL_ZONE,
  TOP_GUTTER,
  VIDEO_LANE_HEIGHT,
} from "./constants";

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

export interface LaneLayout {
  trackId: string;
  kind: TrackKind;
  top: number;
  height: number;
}

export const laneHeight = (kind: TrackKind) =>
  kind === "video" ? VIDEO_LANE_HEIGHT : AUDIO_LANE_HEIGHT;

/** Lanes stacked below the top gutter; `height` is where the last lane ends. */
export function layoutLanes(tracks: Track[]): { lanes: LaneLayout[]; height: number } {
  let top = TOP_GUTTER;
  const lanes = tracks.map((t) => {
    const lane = { trackId: t.id, kind: t.kind, top, height: laneHeight(t.kind) };
    top += lane.height;
    return lane;
  });
  return { lanes, height: top };
}

/** The lane containing `y` (lane-area px), or null above/below all lanes. */
export function laneAt(lanes: LaneLayout[], y: number): LaneLayout | null {
  return lanes.find((l) => y >= l.top && y < l.top + l.height) ?? null;
}

/** "above" the first lane, "below" the last one, or null when `y` is on a lane. */
export function newTrackZoneAt(lanes: LaneLayout[], y: number): "above" | "below" | null {
  if (lanes.length === 0) return null;
  if (y < lanes[0].top) return "above";
  const last = lanes[lanes.length - 1];
  return y >= last.top + last.height ? "below" : null;
}

/** Lane-area rectangle of a clip (for hit testing, e.g. marquee selection). */
export function clipRect(start: number, duration: number, lane: LaneLayout, zoom: number) {
  return {
    left: start * zoom,
    right: (start + duration) * zoom,
    top: lane.top + CLIP_INSET_Y,
    bottom: lane.top + lane.height - CLIP_INSET_Y,
  };
}

// ---------------------------------------------------------------------------
// Content size, zoom, scrolling
// ---------------------------------------------------------------------------

/** Scrollable lane width: the project plus generous trailing room, never less than the viewport. */
export function contentWidth(duration: number, zoom: number, viewWidth: number): number {
  const trailing = Math.max(viewWidth * 0.5, 240);
  return Math.ceil(Math.max(viewWidth, duration * zoom + trailing));
}

/** Share of the view a fitted edit fills (the rest is breathing room past the end). */
const FIT_FRACTION = 0.94;
/** Zooming all the way out shows at least this much, however short the edit. */
export const MIN_ZOOM_OUT_SECONDS = 60;

/** Zoom that fits `duration` into `viewWidth` (with a little breathing room), or null if empty. */
export function fitZoom(duration: number, viewWidth: number, min: number, max: number): number | null {
  if (duration <= 0 || viewWidth <= 0) return null;
  return clamp((viewWidth * FIT_FRACTION) / duration, min, max);
}

/**
 * Furthest zoom-out, like Premiere: the whole edit fits the view, so a longer
 * edit can zoom out further. `floor` applies until the view has been measured.
 */
export function minZoomFor(duration: number, viewWidth: number, floor: number, max: number): number {
  if (viewWidth <= 0) return floor;
  return clamp((viewWidth * FIT_FRACTION) / Math.max(duration, MIN_ZOOM_OUT_SECONDS), floor, max);
}

/** Map zoom <-> a 0..1 slider position on a log scale. */
export function zoomToSlider(zoom: number, min: number, max: number): number {
  return clamp(Math.log(zoom / min) / Math.log(max / min), 0, 1);
}
export function sliderToZoom(v: number, min: number, max: number): number {
  return clamp(min * Math.pow(max / min, clamp(v, 0, 1)), min, max);
}

/** Multiplicative zoom factor for a ctrl/⌘ wheel or trackpad pinch event. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -60, 60) * 0.008);
}

/** scrollLeft that keeps `time` under viewport offset `vx` at `zoom`. */
export function anchoredScrollLeft(time: number, zoom: number, vx: number): number {
  return Math.max(0, time * zoom - vx);
}

/**
 * Page-style follow: when `x` is outside the visible range [scrollLeft, scrollLeft + viewWidth - margin],
 * return a new scrollLeft that puts it `margin` px from the left edge; otherwise null.
 */
export function pageScrollTarget(
  x: number,
  scrollLeft: number,
  viewWidth: number,
  margin: number,
): number | null {
  if (viewWidth <= margin * 2) return null;
  if (x >= scrollLeft && x <= scrollLeft + viewWidth - margin) return null;
  return Math.max(0, x - margin);
}

/** Auto-scroll speed (px/frame, signed) for a pointer at viewport offset `vx` while dragging. */
export function edgeScrollSpeed(vx: number, viewWidth: number): number {
  const zone = Math.min(EDGE_SCROLL_ZONE, viewWidth / 4);
  if (vx < zone) return -EDGE_SCROLL_MAX_SPEED * clamp((zone - vx) / zone, 0, 1);
  if (vx > viewWidth - zone) return EDGE_SCROLL_MAX_SPEED * clamp((vx - (viewWidth - zone)) / zone, 0, 1);
  return 0;
}

/**
 * The range of lane px worth rendering for a scroll position, quantised to
 * `chunk` so consumers only re-render when a chunk boundary is crossed.
 */
export function visibleWindow(scrollLeft: number, viewWidth: number, chunk: number) {
  const x0 = Math.max(0, (Math.floor(scrollLeft / chunk) - 1) * chunk);
  const x1 = (Math.floor((scrollLeft + viewWidth) / chunk) + 2) * chunk;
  return { x0, x1 };
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

/** [major, minor] tick intervals in seconds, finest first. */
const TICK_STEPS: [number, number][] = [
  [0.25, 0.05],
  [0.5, 0.1],
  [1, 0.25],
  [2, 0.5],
  [5, 1],
  [10, 2],
  [15, 5],
  [30, 5],
  [60, 10],
  [120, 30],
  [300, 60],
  [600, 120],
  [1800, 300],
  [3600, 600],
];
export const MIN_LABEL_SPACING_PX = 72;
const MIN_MINOR_SPACING_PX = 6;

export function tickSpacing(zoom: number): { major: number; minor: number | null } {
  const step = TICK_STEPS.find(([major]) => major * zoom >= MIN_LABEL_SPACING_PX) ?? TICK_STEPS.at(-1)!;
  const [major, minor] = step;
  return { major, minor: minor * zoom >= MIN_MINOR_SPACING_PX ? minor : null };
}

/** "0:05", "1:30", "1:02:03"; sub-second majors add a fraction ("0:01.5", "0:00.25"). */
export function formatRulerLabel(time: number, major: number): string {
  const t = Math.max(0, time);
  const whole = Math.floor(t + EPS);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  const frac = t - whole;
  if (major >= 1 || frac < EPS) return base;
  const decimals = major >= 0.5 ? 1 : 2;
  const digits = frac.toFixed(decimals).slice(1).replace(/0+$/, "");
  return digits === "." ? base : `${base}${digits}`;
}

export interface Tick {
  time: number;
  x: number;
  major: boolean;
  label: string | null;
}

/** Ticks covering lane px [x0, x1]. Indexes by integer steps so there is no float drift. */
export function rulerTicks(zoom: number, x0: number, x1: number): Tick[] {
  const { major, minor } = tickSpacing(zoom);
  const step = minor ?? major;
  const every = Math.round(major / step);
  const i0 = Math.max(0, Math.ceil(x0 / zoom / step - EPS));
  const i1 = Math.floor(x1 / zoom / step + EPS);
  const ticks: Tick[] = [];
  for (let i = i0; i <= i1; i++) {
    const time = Math.round(i * step * 1e6) / 1e6;
    const isMajor = i % every === 0;
    ticks.push({
      time,
      x: time * zoom,
      major: isMajor,
      label: isMajor ? formatRulerLabel(time, major) : null,
    });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/**
 * Snap a move of `delta` seconds: whichever edge (start or end) of any moving
 * span lands closest to a snap point within `threshold` pulls the whole move
 * onto it. Spans are the moving clips' current [start, start + duration).
 */
export function snapDelta(
  delta: number,
  spans: { start: number; duration: number }[],
  points: number[],
  threshold: number,
): { delta: number; snappedTo: number | null } {
  if (threshold <= 0 || points.length === 0 || spans.length === 0) return { delta, snappedTo: null };
  let best: { delta: number; snappedTo: number; dist: number } | null = null;
  for (const { start, duration } of spans) {
    for (const edge of [start, start + duration]) {
      const res = snapTime(edge + delta, points, threshold);
      if (res.snappedTo === null) continue;
      const dist = Math.abs(res.time - (edge + delta));
      if (!best || dist < best.dist) best = { delta: res.time - edge, snappedTo: res.snappedTo, dist };
    }
  }
  // Snapping must never push the group before 0.
  const minStart = Math.min(...spans.map((s) => s.start));
  if (!best || minStart + best.delta < -EPS) return { delta, snappedTo: null };
  return { delta: best.delta, snappedTo: best.snappedTo };
}

/** Snap points for moving clips: every other clip's edges, 0 and the playhead. */
export function moveSnapPoints(project: Project, clipIds: string[], playhead: number): number[] {
  return snapPoints(project, playhead, new Set(clipIds));
}

/** Snap points for trimming `clipId`: every other clip's edges, 0 and the playhead. */
export function trimSnapPoints(project: Project, clipId: string, playhead: number): number[] {
  return snapPoints(project, playhead, clipId);
}

// ---------------------------------------------------------------------------
// Thumbnails and waveforms
// ---------------------------------------------------------------------------

/**
 * Filmstrip tiles intersecting clip-local px [from, to]. Tile k sits at
 * x = k * tileWidth and shows the frame nearest to source time
 * in + x / zoom * rate (`inPoint` is the source time at the clip's left edge;
 * `rate` its speed, negative when it plays backwards).
 */
export function filmstripTiles(opts: {
  from: number;
  to: number;
  tileWidth: number;
  inPoint: number;
  zoom: number;
  assetDuration: number;
  frameCount: number;
  rate?: number;
}): { key: number; x: number; frame: number }[] {
  const { from, to, tileWidth, inPoint, zoom, assetDuration, frameCount, rate = 1 } = opts;
  if (to <= from || tileWidth <= 0 || frameCount <= 0 || assetDuration <= 0) return [];
  const k0 = Math.max(0, Math.floor(from / tileWidth));
  const k1 = Math.ceil(to / tileWidth);
  const perFrame = assetDuration / frameCount;
  const tiles = [];
  for (let k = k0; k < k1; k++) {
    const x = k * tileWidth;
    const t = inPoint + (x / zoom) * rate;
    tiles.push({ key: k, x, frame: clamp(Math.round(t / perFrame), 0, frameCount - 1) });
  }
  return tiles;
}

/** Max peak (0..1) over source time [t0, t1). Always samples at least one bucket. */
export function peakInRange(peaks: ArrayLike<number>, peaksPerSecond: number, t0: number, t1: number): number {
  const n = peaks.length;
  if (n === 0) return 0;
  const i0 = Math.floor(t0 * peaksPerSecond);
  const i1 = Math.max(i0 + 1, Math.ceil(t1 * peaksPerSecond));
  let max = 0;
  for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) {
    if (peaks[i] > max) max = peaks[i];
  }
  return max;
}
