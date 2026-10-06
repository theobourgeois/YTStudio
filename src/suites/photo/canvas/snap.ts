/**
 * Smart guides (Photoshop's View › Snap To: Document Bounds, Layers): a layer moved or resized snaps its edges and
 * centre to the canvas's edges and centre and to other layers' edges and centres, when they're within a few screen
 * pixels, and a magenta line shows each alignment. Pure, in document pixels: the overlay feeds it boxes and draws
 * the guides.
 */
import type { Size } from "@shared/photo/geometry";

/** An axis-aligned box in document pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A line something can snap to: at `at` on its axis, spanning `from`..`to` on the other (where the guide is drawn). */
export interface SnapLine {
  at: number;
  from: number;
  to: number;
}

export interface SnapTargets {
  /** Vertical lines (x = at). */
  x: SnapLine[];
  /** Horizontal lines (y = at). */
  y: SnapLine[];
}

/** A guide to draw: a vertical (`axis: "x"`) or horizontal line at `at`, from `from` to `to`. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

export interface Snapped {
  dx: number;
  dy: number;
  guides: Guide[];
}

const centreX = (b: Box) => (b.x0 + b.x1) / 2;
const centreY = (b: Box) => (b.y0 + b.y1) / 2;

/** What a dragged layer can snap to: the canvas's edges and centre, and each other layer's box's. */
export function snapTargets(canvas: Size, others: readonly Box[]): SnapTargets {
  const x: SnapLine[] = [0, canvas.width / 2, canvas.width].map((at) => ({ at, from: 0, to: canvas.height }));
  const y: SnapLine[] = [0, canvas.height / 2, canvas.height].map((at) => ({ at, from: 0, to: canvas.width }));
  for (const b of others) {
    for (const at of [b.x0, centreX(b), b.x1]) x.push({ at, from: b.y0, to: b.y1 });
    for (const at of [b.y0, centreY(b), b.y1]) y.push({ at, from: b.x0, to: b.x1 });
  }
  return { x, y };
}

/**
 * The nearest snap on one axis: the smallest move (within `threshold`) that puts one of `points` on a line, and
 * every line one of the points is then on (a box's edge and centre can align with several at once).
 */
function snapAxis(points: readonly number[], lines: readonly SnapLine[], threshold: number): { delta: number; hits: { point: number; line: SnapLine }[] } | null {
  let best: number | null = null;
  for (const point of points) {
    for (const line of lines) {
      const d = line.at - point;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return null;
  const delta = best;
  const hits: { point: number; line: SnapLine }[] = [];
  for (const point of points) for (const line of lines) if (Math.abs(line.at - (point + delta)) < 1e-6) hits.push({ point: point + delta, line });
  return { delta, hits };
}

/** One guide per line a box is on, long enough to join the box and what it's aligned with. */
function guidesFor(axis: "x" | "y", hits: { line: SnapLine }[], box: Box): Guide[] {
  const seen = new Set<number>();
  const out: Guide[] = [];
  for (const { line } of hits) {
    if (seen.has(line.at)) continue;
    seen.add(line.at);
    const [b0, b1] = axis === "x" ? [box.y0, box.y1] : [box.x0, box.x1];
    out.push({ axis, at: line.at, from: Math.min(line.from, b0), to: Math.max(line.to, b1) });
  }
  return out;
}

/**
 * A moved box snapped: its edges and centre on each axis to the nearest target within `threshold` document pixels.
 * `axes` says which axes may move (a Shift-constrained drag moves along one).
 */
export function snapMove(box: Box, targets: SnapTargets, threshold: number, axes: { x: boolean; y: boolean } = { x: true, y: true }): Snapped {
  const sx = axes.x ? snapAxis([box.x0, centreX(box), box.x1], targets.x, threshold) : null;
  const sy = axes.y ? snapAxis([box.y0, centreY(box), box.y1], targets.y, threshold) : null;
  const dx = sx?.delta ?? 0;
  const dy = sy?.delta ?? 0;
  const moved = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };
  return { dx, dy, guides: [...(sx ? guidesFor("x", sx.hits, moved) : []), ...(sy ? guidesFor("y", sy.hits, moved) : [])] };
}

/**
 * A resized box's moving edges snapped: `edges.x` / `edges.y` are the edge the dragged handle moves on each axis
 * (null: that axis doesn't move). Only the edges snap, never the centre. With `oneAxis` (a corner keeping its
 * proportions) only the nearer of the two snaps: the other edge follows the proportions.
 */
export function snapResize(box: Box, edges: { x: "x0" | "x1" | null; y: "y0" | "y1" | null }, targets: SnapTargets, threshold: number, oneAxis = false): Snapped {
  let sx = edges.x ? snapAxis([box[edges.x]], targets.x, threshold) : null;
  let sy = edges.y ? snapAxis([box[edges.y]], targets.y, threshold) : null;
  if (oneAxis && sx && sy) {
    if (Math.abs(sx.delta) <= Math.abs(sy.delta)) sy = null;
    else sx = null;
  }
  const dx = sx?.delta ?? 0;
  const dy = sy?.delta ?? 0;
  return { dx, dy, guides: [] };
}

/** The guides for a box as it is (after a resize): each of its edges and centres that lies on a target line. */
export function guidesOf(box: Box, targets: SnapTargets, which: { x: number[]; y: number[] }): Guide[] {
  const on = (points: number[], lines: SnapLine[]) => points.flatMap((point) => lines.filter((line) => Math.abs(line.at - point) < 1e-6).map((line) => ({ point, line })));
  return [...guidesFor("x", on(which.x, targets.x), box), ...guidesFor("y", on(which.y, targets.y), box)];
}
