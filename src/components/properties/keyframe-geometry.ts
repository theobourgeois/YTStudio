/**
 * Pure maths of the Effect Controls' keyframe lanes: each lane shows the
 * selected clip's stretch of the timeline, a little inset so keyframes on
 * the clip's first and last frames are drawn whole. Positions are CSS
 * (`calc` of the lane's width), so lanes never need measuring to draw.
 */
import { rulerTicks } from "@/components/timeline/geometry";

/** Space (px) at each end of a lane. */
export const LANE_PAD = 8;

/** The timeline times a lane spans (the clip's). */
export interface LaneRange {
  start: number;
  end: number;
}

export const laneFraction = (range: LaneRange, t: number) => (t - range.start) / Math.max(1e-9, range.end - range.start);

/** CSS `left` of timeline time `t` in a lane. */
export function laneLeft(range: LaneRange, t: number): string {
  return `calc(${LANE_PAD}px + (100% - ${2 * LANE_PAD}px) * ${laneFraction(range, t)})`;
}

/** Lane px per second, for a lane `width` px wide. */
export const pxPerSecond = (range: LaneRange, width: number) =>
  Math.max(1e-9, width - 2 * LANE_PAD) / Math.max(1e-9, range.end - range.start);

/** Timeline time at `x` px from the lane's left edge (clamped into the range). */
export function timeAtX(range: LaneRange, x: number, width: number): number {
  const t = range.start + (x - LANE_PAD) / pxPerSecond(range, width);
  return Math.min(range.end, Math.max(range.start, t));
}

/** Snap `t` to the nearest of `targets` within `threshold` seconds, else to the frame grid. */
export function snapTime(t: number, targets: readonly number[], threshold: number, fps: number): number {
  let best: number | null = null;
  for (const target of targets) {
    if (Math.abs(target - t) <= threshold && (best === null || Math.abs(target - t) < Math.abs(best - t))) best = target;
  }
  return best ?? Math.round(t * fps) / fps;
}

/** `delta` limited so every one of `times` stays inside [min, max] (unless it's already outside). */
export function clampDelta(delta: number, times: readonly number[], min: number, max: number): number {
  if (times.length === 0) return 0;
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  let d = delta;
  if (lo >= min) d = Math.max(d, min - lo);
  if (hi <= max) d = Math.min(d, max - hi);
  return d;
}

/** Ruler ticks for a lane `width` px wide, with their fraction across the range. */
export function laneTicks(range: LaneRange, width: number) {
  const zoom = pxPerSecond(range, width);
  return rulerTicks(zoom, range.start * zoom, range.end * zoom).map((tick) => ({
    ...tick,
    fraction: laneFraction(range, tick.time),
  }));
}
