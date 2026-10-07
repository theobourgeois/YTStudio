/**
 * The shape tools' handles (docs/photo/tools/shapes.md, "With a shape selected"), pure, in document pixels: a box's
 * eight handles and what dragging one does (the opposite side stays, Shift keeps the proportions, Alt resizes about
 * the centre), the rectangle's corner-radius handle, and a line's middle that bends it.
 */
import type { PlacedShape, Point } from "@shared/photo/shapes";

export type PlacedBox = Extract<PlacedShape, { type: "rect" | "ellipse" }>;
export type PlacedLine = Extract<PlacedShape, { type: "line" }>;

/** A handle on a box: (u, v) across it, 0 to 1, from its top-left (before it's turned). */
export interface BoxHandle {
  u: 0 | 0.5 | 1;
  v: 0 | 0.5 | 1;
}

export const BOX_HANDLES: readonly BoxHandle[] = [
  { u: 0, v: 0 },
  { u: 0.5, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 0.5 },
  { u: 1, v: 1 },
  { u: 0.5, v: 1 },
  { u: 0, v: 1 },
  { u: 0, v: 0.5 },
];

const turn = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { cos: Math.cos(a), sin: Math.sin(a) };
};

/** A point in the box's own frame (centred on 0, upright). */
export function toLocal(p: PlacedBox, pt: Point): Point {
  const { cos, sin } = turn(p.rotation);
  const dx = pt.x - p.cx;
  const dy = pt.y - p.cy;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** A point of the box's own frame on the canvas. */
export function fromLocal(p: PlacedBox, pt: Point): Point {
  const { cos, sin } = turn(p.rotation);
  return { x: p.cx + pt.x * cos - pt.y * sin, y: p.cy + pt.x * sin + pt.y * cos };
}

export const handlePoint = (p: PlacedBox, h: BoxHandle): Point => fromLocal(p, { x: (h.u - 0.5) * p.width, y: (h.v - 0.5) * p.height });

/** The box's four corners on the canvas, clockwise from its top-left. */
export const boxCorners = (p: PlacedBox): Point[] => [0, 1, 2, 3].map((i) => handlePoint(p, { u: i === 1 || i === 2 ? 1 : 0, v: i >= 2 ? 1 : 0 }));

/** The box with handle `h` dragged to `pointer`: its new centre and size (its turn kept). */
export function resizeBox(p: PlacedBox, h: BoxHandle, pointer: Point, { keepRatio = false, fromCentre = false } = {}): { cx: number; cy: number; width: number; height: number } {
  const local = toLocal(p, pointer);
  // The side opposite the handle stays put (Alt: the centre does).
  const ax = fromCentre ? 0 : (0.5 - h.u) * p.width;
  const ay = fromCentre ? 0 : (0.5 - h.v) * p.height;
  const k = fromCentre ? 2 : 1;
  let width = h.u === 0.5 ? p.width : Math.max(1, Math.abs(local.x - ax) * k);
  let height = h.v === 0.5 ? p.height : Math.max(1, Math.abs(local.y - ay) * k);
  if (keepRatio && p.width > 0 && p.height > 0) {
    // Corners scale by the larger change; an edge carries the other side along.
    const s = h.u === 0.5 ? height / p.height : h.v === 0.5 ? width / p.width : Math.max(width / p.width, height / p.height);
    width = p.width * s;
    height = p.height * s;
  }
  // Where the dragged side went (a drag past the opposite side flips it there).
  const sx = h.u === 0.5 ? 0 : Math.sign(local.x - ax) || Math.sign(h.u - 0.5);
  const sy = h.v === 0.5 ? 0 : Math.sign(local.y - ay) || Math.sign(h.v - 0.5);
  const centre = fromCentre ? { x: 0, y: 0 } : { x: h.u === 0.5 ? 0 : ax + (sx * width) / 2, y: h.v === 0.5 ? 0 : ay + (sy * height) / 2 };
  const c = fromLocal(p, centre);
  return { cx: c.x, cy: c.y, width, height };
}

/** The radius handle (Photoshop's corner widget): inside the top-left corner, at least `inset` in from it. */
export function radiusHandle(p: PlacedBox, inset: number): Point {
  const r = Math.max(Math.min(p.radius, p.width / 2, p.height / 2), Math.min(inset, p.width / 2, p.height / 2));
  return fromLocal(p, { x: -p.width / 2 + r, y: -p.height / 2 + r });
}

/** The corner radius a drag of the radius handle to `pointer` makes: how far in from the corner, along its diagonal. */
export function radiusFrom(p: PlacedBox, pointer: Point): number {
  const local = toLocal(p, pointer);
  const r = (local.x + p.width / 2 + (local.y + p.height / 2)) / 2;
  return Math.round(Math.max(0, Math.min(r, p.width / 2, p.height / 2)));
}

/** Where a line's middle is (its bend handle): the curve's point halfway, the chord's middle moved by the bend. */
export function bendHandle(l: PlacedLine): Point {
  const dx = l.to.x - l.from.x;
  const dy = l.to.y - l.from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: (l.from.x + l.to.x) / 2 + (dy / length) * l.bend, y: (l.from.y + l.to.y) / 2 - (dx / length) * l.bend };
}

/** The bend a drag of the middle to `pointer` makes: its distance from the chord, to the left; near it, straight. */
export function bendFrom(l: PlacedLine, pointer: Point, straightWithin: number): number {
  const dx = l.to.x - l.from.x;
  const dy = l.to.y - l.from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return 0;
  const bend = ((pointer.x - l.from.x) * dy - (pointer.y - l.from.y) * dx) / length;
  return Math.abs(bend) < straightWithin ? 0 : Math.round(bend * 10) / 10;
}
