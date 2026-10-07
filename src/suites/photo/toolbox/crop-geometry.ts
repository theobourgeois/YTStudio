/**
 * The crop box's maths (docs/photo/tools/crop.md), pure: in the box's own frame (document pixels for the canvas, the
 * layer's pixels for a layer), so a turned layer's box is handled as an upright one. Every result is absolute (from
 * the box at the press), so a drag never drifts. `ratio` is width / height in the frame's units; `bounds`, where the
 * box must stay (a layer's pixels), or null (the canvas's box can go past it).
 */
import type { CropRect } from "@shared/photo/crop";

/** A handle: x and y each 0 (left, top), 0.5 (middle) or 1 (right, bottom). */
export interface CropHandle {
  u: 0 | 0.5 | 1;
  v: 0 | 0.5 | 1;
}

export const CROP_HANDLES: readonly CropHandle[] = [
  { u: 0, v: 0 },
  { u: 0.5, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 0.5 },
  { u: 1, v: 1 },
  { u: 0.5, v: 1 },
  { u: 0, v: 1 },
  { u: 0, v: 0.5 },
];

export interface Point {
  x: number;
  y: number;
}

export interface CropDragOptions {
  /** Width / height to keep (a chosen ratio, or Shift's), or null. */
  ratio: number | null;
  /** Alt: from the box's centre. */
  fromCentre: boolean;
  bounds: CropRect | null;
}

/** The smallest box side, in the frame's units. */
const MIN_SIDE = 1;

/** Where a handle is on a box. */
export const handleAt = (b: CropRect, h: CropHandle): Point => ({ x: b.x + h.u * b.width, y: b.y + h.v * b.height });

/** Whether a point is inside a box. */
export const inside = (b: CropRect, p: Point) => p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;

/**
 * How far a box can reach from `anchor` towards (sx, sy) (each −1 or 1) inside `bounds` (when there are any): half
 * that from a centre, which reaches both ways.
 */
function room(anchor: Point, sx: number, sy: number, bounds: CropRect | null, fromCentre: boolean): { w: number; h: number } {
  if (!bounds) return { w: Infinity, h: Infinity };
  const toX = sx > 0 ? bounds.x + bounds.width - anchor.x : anchor.x - bounds.x;
  const toY = sy > 0 ? bounds.y + bounds.height - anchor.y : anchor.y - bounds.y;
  if (!fromCentre) return { w: Math.max(0, toX), h: Math.max(0, toY) };
  const bothX = Math.min(bounds.x + bounds.width - anchor.x, anchor.x - bounds.x);
  const bothY = Math.min(bounds.y + bounds.height - anchor.y, anchor.y - bounds.y);
  return { w: Math.max(0, 2 * bothX), h: Math.max(0, 2 * bothY) };
}

/**
 * A box of extents (w, h) from `anchor` towards (sx, sy) (or centred on it), held to `ratio` (the larger way wins,
 * as Photoshop's) and to the room there is (scaled down together, so the ratio holds).
 */
function boxFrom(anchor: Point, sx: number, sy: number, w: number, h: number, o: CropDragOptions, lead: "x" | "y" | "both"): CropRect {
  if (o.ratio) {
    if (lead === "x") h = w / o.ratio;
    else if (lead === "y") w = h * o.ratio;
    else if (w / h > o.ratio) h = w / o.ratio;
    else w = h * o.ratio;
  }
  const r = room(anchor, sx, sy, o.bounds, o.fromCentre);
  if (o.ratio) {
    const k = Math.min(1, r.w / Math.max(w, 1e-9), r.h / Math.max(h, 1e-9));
    w *= k;
    h *= k;
  } else {
    w = Math.min(w, r.w);
    h = Math.min(h, r.h);
  }
  w = Math.max(Math.min(MIN_SIDE, r.w), w);
  h = Math.max(Math.min(MIN_SIDE, r.h), h);
  if (o.fromCentre) return { x: anchor.x - w / 2, y: anchor.y - h / 2, width: w, height: h };
  return { x: sx > 0 ? anchor.x : anchor.x - w, y: sy > 0 ? anchor.y : anchor.y - h, width: w, height: h };
}

/**
 * The box with `handle` dragged to `p`: the opposite side (or the centre, `fromCentre`) stays put; past it, the box
 * turns over. An edge with a ratio moves the other way too, about the box's middle.
 */
export function resizeCrop(start: CropRect, handle: CropHandle, p: Point, o: CropDragOptions): CropRect {
  const corner = handle.u !== 0.5 && handle.v !== 0.5;
  const centre = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  if (corner) {
    const anchor = o.fromCentre ? centre : handleAt(start, { u: (1 - handle.u) as CropHandle["u"], v: (1 - handle.v) as CropHandle["v"] });
    const k = o.fromCentre ? 2 : 1;
    const sx = p.x >= anchor.x ? 1 : -1;
    const sy = p.y >= anchor.y ? 1 : -1;
    return boxFrom(anchor, sx, sy, Math.abs(p.x - anchor.x) * k, Math.abs(p.y - anchor.y) * k, o, "both");
  }
  // An edge: one way follows the pointer; with a ratio, the other follows about the box's middle line.
  const alongX = handle.v === 0.5;
  const lo = alongX ? start.x : start.y;
  const size = alongX ? start.width : start.height;
  const mid = alongX ? centre.x : centre.y;
  const at = alongX ? p.x : p.y;
  const bLo = o.bounds ? (alongX ? o.bounds.x : o.bounds.y) : -Infinity;
  const bHi = o.bounds ? bLo + (alongX ? o.bounds.width : o.bounds.height) : Infinity;
  let a0: number;
  let a1: number;
  let anchor: number;
  if (o.fromCentre) {
    const half = Math.max(MIN_SIDE / 2, Math.min(Math.abs(at - mid), mid - bLo, bHi - mid));
    [a0, a1, anchor] = [mid - half, mid + half, mid];
  } else {
    anchor = (alongX ? handle.u : handle.v) === 1 ? lo : lo + size;
    const to = Math.min(Math.max(at, bLo), bHi);
    [a0, a1] = [Math.min(anchor, to), Math.max(anchor, to)];
    if (a1 - a0 < MIN_SIDE) a1 = a0 + MIN_SIDE;
  }
  const along = a1 - a0;
  if (!o.ratio) return alongX ? { ...start, x: a0, width: along } : { ...start, y: a0, height: along };
  const across = alongX ? along / o.ratio : along * o.ratio;
  const box = alongX ? { x: a0, y: centre.y - across / 2, width: along, height: across } : { x: centre.x - across / 2, y: a0, width: across, height: along };
  const pivot = alongX ? { x: anchor, y: centre.y } : { x: centre.x, y: anchor };
  return shrinkInto(box, pivot, o.bounds);
}

/** A box scaled down about `pivot` (a point of its edge or its centre) until it's inside `bounds`. */
function shrinkInto(b: CropRect, pivot: Point, bounds: CropRect | null): CropRect {
  if (!bounds) return b;
  // Each side at pivot + (side − pivot)·k must stay inside the bounds: the largest such k, at most 1.
  const limit = (lo: number, hi: number, blo: number, bhi: number, a: number) => {
    let k = 1;
    if (lo < blo && a - lo > 1e-9) k = Math.min(k, (a - blo) / (a - lo));
    if (hi > bhi && hi - a > 1e-9) k = Math.min(k, (bhi - a) / (hi - a));
    return Math.max(0, k);
  };
  const k = Math.min(limit(b.x, b.x + b.width, bounds.x, bounds.x + bounds.width, pivot.x), limit(b.y, b.y + b.height, bounds.y, bounds.y + bounds.height, pivot.y));
  if (k >= 1) return b;
  return { x: pivot.x + (b.x - pivot.x) * k, y: pivot.y + (b.y - pivot.y) * k, width: Math.max(MIN_SIDE, b.width * k), height: Math.max(MIN_SIDE, b.height * k) };
}

/** The box moved by (dx, dy), kept inside the bounds. */
export function moveCrop(start: CropRect, dx: number, dy: number, bounds: CropRect | null): CropRect {
  let x = start.x + dx;
  let y = start.y + dy;
  if (bounds) {
    x = Math.min(Math.max(x, bounds.x), bounds.x + bounds.width - start.width);
    y = Math.min(Math.max(y, bounds.y), bounds.y + bounds.height - start.height);
  }
  return { ...start, x, y };
}

/** A new box drawn from `a` to `b` (from its centre with Alt), held to the ratio and the bounds. */
export function drawCrop(a: Point, b: Point, o: CropDragOptions): CropRect {
  const from = o.bounds ? { x: Math.min(Math.max(a.x, o.bounds.x), o.bounds.x + o.bounds.width), y: Math.min(Math.max(a.y, o.bounds.y), o.bounds.y + o.bounds.height) } : a;
  const sx = b.x >= from.x ? 1 : -1;
  const sy = b.y >= from.y ? 1 : -1;
  const k = o.fromCentre ? 2 : 1;
  return boxFrom(from, sx, sy, Math.abs(b.x - from.x) * k, Math.abs(b.y - from.y) * k, o, "both");
}

/** The box turned on its side (⇄, X), about its centre, kept inside the bounds. */
export function swapCrop(b: CropRect, bounds: CropRect | null): CropRect {
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return shrinkInto({ x: c.x - b.height / 2, y: c.y - b.width / 2, width: b.height, height: b.width }, c, bounds);
}

/** The largest box of `ratio` inside `within`, centred on `about` (its own centre by default), kept inside it. */
export function ratioCrop(within: CropRect, ratio: number, about?: Point): CropRect {
  const width = Math.min(within.width, within.height * ratio);
  const height = width / ratio;
  const c = about ?? { x: within.x + within.width / 2, y: within.y + within.height / 2 };
  const x = Math.min(Math.max(c.x - width / 2, within.x), within.x + within.width - width);
  const y = Math.min(Math.max(c.y - height / 2, within.y), within.y + within.height - height);
  return { x, y, width, height };
}
