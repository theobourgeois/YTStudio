/** Curves' point edits, as the graph makes them (pure, so they're tested): levels are whole numbers on 0..255. */
import { MAX_CURVE_POINTS } from "@shared/photo/effects/params";
import type { CurvePoints } from "@shared/photo/types";

/** A curve's points with point `i` moved to (x, y), kept strictly between its neighbours, levels rounded. */
export function movePoint(points: CurvePoints, i: number, x: number, y: number): CurvePoints {
  const lo = i > 0 ? points[i - 1][0] + 1 : 0;
  const hi = i < points.length - 1 ? points[i + 1][0] - 1 : 255;
  const nx = Math.max(lo, Math.min(hi, Math.round(x)));
  const ny = Math.max(0, Math.min(255, Math.round(y)));
  return points.map((p, j) => (j === i ? [nx, ny] : p));
}

/** A point added at (x, y) (levels rounded), and its index; null when there's no room or it's already there. */
export function addPoint(points: CurvePoints, x: number, y: number): { points: CurvePoints; index: number } | null {
  const nx = Math.max(0, Math.min(255, Math.round(x)));
  if (points.length >= MAX_CURVE_POINTS || points.some((p) => p[0] === nx)) return null;
  const index = points.findIndex((p) => p[0] > nx);
  const at = index < 0 ? points.length : index;
  const next: CurvePoints = [...points.slice(0, at), [nx, Math.max(0, Math.min(255, Math.round(y)))], ...points.slice(at)];
  return { points: next, index: at };
}

/** Without point `i` (a curve keeps at least two). */
export const removePoint = (points: CurvePoints, i: number): CurvePoints => (points.length <= 2 ? points : points.filter((_, j) => j !== i));
