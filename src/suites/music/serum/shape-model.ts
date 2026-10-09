/**
 * An LFO's shape as the Serum player edits it (`docs/serum/player.md` §3.5), pure: points dragged, added and
 * removed as Serum's own editor allows (the first at x 0 and the last at x 1, x never going back), and the line to
 * draw. Points are Serum's: [x, y] or [x, y, curve], each 0 to 1, y from the top (0 is the LFO's full value).
 */
import { clamp } from "@shared/math";
import type { SerumLfoPoint } from "@shared/music/serum-sound";

/** Point `i` moved to (x, y): x kept between its neighbours (the ends stay at 0 and 1), y within 0 to 1. Its curve stays. */
export function movePoint(points: readonly SerumLfoPoint[], i: number, x: number, y: number): SerumLfoPoint[] {
  const last = points.length - 1;
  const nx = i === 0 ? 0 : i === last ? 1 : clamp(x, points[i - 1][0], points[i + 1][0]);
  const moved: SerumLfoPoint = points[i].length === 3 ? [nx, clamp(y, 0, 1), points[i][2]!] : [nx, clamp(y, 0, 1)];
  return points.map((p, j) => (j === i ? moved : p));
}

/** A point added at (x, y), between the points around it: the shape and where the new one is. Nothing at an end. */
export function addPoint(points: readonly SerumLfoPoint[], x: number, y: number): { points: SerumLfoPoint[]; index: number } | null {
  const at = points.findIndex((p) => p[0] > x);
  if (at <= 0 || x <= 0 || x >= 1) return null;
  const next: SerumLfoPoint[] = [...points.slice(0, at), [x, clamp(y, 0, 1)], ...points.slice(at)];
  return { points: next, index: at };
}

/** Point `i` taken away: never an end (a shape runs from x 0 to 1). */
export function removePoint(points: readonly SerumLfoPoint[], i: number): SerumLfoPoint[] {
  if (i <= 0 || i >= points.length - 1) return [...points];
  return points.filter((_, j) => j !== i);
}

/**
 * The shape as an SVG path in a `width` × `height` box, y from the top as Serum draws it. A segment's curve (its
 * start point's third value, 0.5 straight) bends it as a power curve: an approximation of Serum's, to see it by.
 */
export function shapePath(points: readonly SerumLfoPoint[], width: number, height: number): string {
  const at = (x: number, y: number) => `${(x * width).toFixed(1)} ${(y * height).toFixed(1)}`;
  let d = `M ${at(points[0][0], points[0][1])}`;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0, curve = 0.5] = points[i];
    const [x1, y1] = points[i + 1];
    if (Math.abs(curve - 0.5) < 1e-6 || x1 === x0) {
      d += ` L ${at(x1, y1)}`;
      continue;
    }
    const power = 2 ** ((curve - 0.5) * 6);
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      d += ` L ${at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t ** power)}`;
    }
  }
  return d;
}

/** The point nearest (x, y) within `reach` (in the same units), or -1. */
export function pointAt(points: readonly SerumLfoPoint[], x: number, y: number, reach: number): number {
  let best = -1;
  let distance = reach;
  points.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d <= distance) {
      distance = d;
      best = i;
    }
  });
  return best;
}
