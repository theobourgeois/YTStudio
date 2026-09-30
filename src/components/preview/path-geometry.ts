/**
 * Pure helpers for editing a path on the Program monitor (a mask's, a drawn shape's):
 * a path's points are fractions of its clip's frame, the pointer is in canvas px.
 */
import { type BezierPath, type PathAffine, distanceToPath, transformPath } from "@shared/path";
import { type Placement, placementMatrix, toFrame } from "@shared/transform";
import type { Vec2 } from "@shared/types";

/** The map from fractions of a placed clip's frame to canvas px. */
export function frameToCanvas(p: Placement): PathAffine {
  const [a, b, c, d, e, f] = placementMatrix(p);
  return [a * p.width, b * p.width, c * p.height, d * p.height, e, f];
}

/** A path given in fractions of a placed clip's frame, in canvas px. */
export const pathOnCanvas = (path: BezierPath, p: Placement): BezierPath => transformPath(path, frameToCanvas(p));

/** A canvas point as fractions of a placed clip's frame (null when the frame is scaled to nothing). */
export function canvasToFrame(p: Placement, point: Vec2): Vec2 | null {
  const f = toFrame(p, point);
  return f && p.width > 0 && p.height > 0 ? [f[0] / p.width, f[1] / p.height] : null;
}

/** What of a path is under the pointer. */
export type PathHit =
  | { kind: "vertex"; index: number }
  | { kind: "handle"; index: number; side: "in" | "out" }
  | { kind: "segment"; segmentIndex: number; t: number };

/**
 * What of `path` (in canvas px) is within `radius` px of `point`: a handle of one of the
 * `selected` vertices (only those show their handles), else a vertex, else the outline.
 */
export function hitPath(path: BezierPath, point: Vec2, selected: readonly number[], radius: number): PathHit | null {
  const near = (p: Vec2) => Math.hypot(p[0] - point[0], p[1] - point[1]) <= radius;
  for (const index of selected) {
    const v = path.vertices[index];
    if (!v) continue;
    for (const side of ["out", "in"] as const) {
      const h = v[side];
      if ((h[0] || h[1]) && near([v.point[0] + h[0], v.point[1] + h[1]])) return { kind: "handle", index, side };
    }
  }
  // The last vertex drawn is on top.
  for (let index = path.vertices.length - 1; index >= 0; index--) {
    if (near(path.vertices[index].point)) return { kind: "vertex", index };
  }
  const on = distanceToPath(path, point);
  if (on && on.segmentIndex >= 0 && on.distance <= radius) return { kind: "segment", segmentIndex: on.segmentIndex, t: on.t };
  return null;
}

/** The axis-aligned box between two corners: its top-left and size (never negative). */
export function dragBox(a: Vec2, b: Vec2, square: boolean): { x: number; y: number; width: number; height: number } {
  let w = b[0] - a[0];
  let h = b[1] - a[1];
  if (square) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * side;
    h = Math.sign(h || 1) * side;
  }
  return { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), width: Math.abs(w), height: Math.abs(h) };
}
