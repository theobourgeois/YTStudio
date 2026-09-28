/**
 * Pure timeline geometry: lane layout, ruler ticks, snapping, zoom and
 * virtualisation math. No DOM access here so it can be unit-tested.
 * Horizontal positions are "lane px" (0 = time 0) unless stated otherwise.
 */
import type { Project, Track, TrackKind } from "@shared/types";
import {
  MAIN_TRACK_ID,
  clipEnd,
  getClip,
  removeClips,
  snapPoints,
  snapTime,
  trackClips,
} from "@shared/timeline";
import {
  AUDIO_LANE_HEIGHT,
  EDGE_SCROLL_MAX_SPEED,
  EDGE_SCROLL_ZONE,
  VIDEO_LANE_HEIGHT,
} from "./constants";

const EPS = 1e-6;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

export function layoutLanes(tracks: Track[]): { lanes: LaneLayout[]; height: number } {
  let top = 0;
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

// ---------------------------------------------------------------------------
// Content size, zoom, scrolling
// ---------------------------------------------------------------------------

/** Scrollable lane width: the project plus generous trailing room, never less than the viewport. */
export function contentWidth(duration: number, zoom: number, viewWidth: number): number {
  const trailing = Math.max(viewWidth * 0.5, 240);
  return Math.ceil(Math.max(viewWidth, duration * zoom + trailing));
}

/** Zoom that fits `duration` into `viewWidth` (with a little breathing room), or null if empty. */
export function fitZoom(duration: number, viewWidth: number, min: number, max: number): number | null {
  if (duration <= 0 || viewWidth <= 0) return null;
  return clamp((viewWidth * 0.94) / duration, min, max);
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
 * Snap a moving clip by whichever edge (start or end) is closer to a snap
 * point within `threshold`. The start never goes below 0.
 */
export function snapClipStart(
  desired: number,
  duration: number,
  points: number[],
  threshold: number,
): { start: number; snappedTo: number | null } {
  const start = Math.max(0, desired);
  if (threshold <= 0 || points.length === 0) return { start, snappedTo: null };
  const a = snapTime(start, points, threshold);
  const b = snapTime(start + duration, points, threshold);
  const da = a.snappedTo === null ? Infinity : Math.abs(a.time - start);
  const db = b.snappedTo === null || b.time - duration < -EPS ? Infinity : Math.abs(b.time - (start + duration));
  if (da === Infinity && db === Infinity) return { start, snappedTo: null };
  return da <= db
    ? { start: a.time, snappedTo: a.snappedTo }
    : { start: Math.max(0, b.time - duration), snappedTo: b.snappedTo };
}

/** Snap points for moving `clipId`: the layout everything else will have once it's lifted out. */
export function moveSnapPoints(project: Project, clipId: string, playhead: number): number[] {
  return snapPoints(removeClips(project, [clipId]), playhead, clipId);
}

/**
 * Snap points for trimming `clipId`: edges that stay put during the trim.
 * On the magnetic main track, clips after the trimmed one ripple, so they're excluded.
 */
export function trimSnapPoints(project: Project, clipId: string, playhead: number): number[] {
  const clip = getClip(project, clipId);
  if (!clip) return [];
  const isMain = clip.trackId === MAIN_TRACK_ID;
  const stable = project.clips.filter(
    (c) =>
      c.id !== clipId &&
      !(isMain && c.trackId === MAIN_TRACK_ID && c.start >= clip.start - EPS),
  );
  return snapPoints({ ...project, clips: stable }, playhead, clipId);
}

/** Timeline time of the boundary before main-track slot `index` (for drop indicators). */
export function mainSlotTime(project: Project, index: number): number {
  const clips = trackClips(project, MAIN_TRACK_ID);
  if (clips.length === 0) return 0;
  if (index < clips.length) return clips[Math.max(0, index)].start;
  return clipEnd(clips[clips.length - 1]);
}

// ---------------------------------------------------------------------------
// Thumbnails and waveforms
// ---------------------------------------------------------------------------

/**
 * Filmstrip tiles intersecting clip-local px [from, to]. Tile k sits at
 * x = k * tileWidth and shows the frame nearest to source time in + x / zoom.
 */
export function filmstripTiles(opts: {
  from: number;
  to: number;
  tileWidth: number;
  inPoint: number;
  zoom: number;
  assetDuration: number;
  frameCount: number;
}): { key: number; x: number; frame: number }[] {
  const { from, to, tileWidth, inPoint, zoom, assetDuration, frameCount } = opts;
  if (to <= from || tileWidth <= 0 || frameCount <= 0 || assetDuration <= 0) return [];
  const k0 = Math.max(0, Math.floor(from / tileWidth));
  const k1 = Math.ceil(to / tileWidth);
  const perFrame = assetDuration / frameCount;
  const tiles = [];
  for (let k = k0; k < k1; k++) {
    const x = k * tileWidth;
    const t = inPoint + x / zoom;
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
