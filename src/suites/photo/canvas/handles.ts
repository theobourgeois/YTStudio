/**
 * The Move tool's transform handles (ux.md, "Transform and view"): where they are, and what dragging one does to
 * a layer's transform. Pure, in document pixels; the overlay draws them and the pointer feeds them. Every result
 * is absolute (from the transform at the press), so a drag's preview never drifts.
 */
import type { Size } from "@shared/photo/geometry";
import { type Affine, bounds, corners, layerPoint, transformedBy } from "@shared/photo/layers";
import { type Point, type Quad, isDistorted, linearPart, quadOf, transformFromQuad } from "@shared/photo/projective";
import type { LayerTransform, PhotoProject } from "@shared/photo/types";
import { type Guide, type SnapTargets, guidesOf, snapMove, snapResize } from "./snap";

/** A corner or edge, by its place on the source: x and y each 0 (left/top), 0.5 (middle) or 1 (right/bottom). */
export interface Handle {
  u: 0 | 0.5 | 1;
  v: 0 | 0.5 | 1;
}

export const HANDLES: readonly Handle[] = [
  { u: 0, v: 0 },
  { u: 0.5, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 0.5 },
  { u: 1, v: 1 },
  { u: 0.5, v: 1 },
  { u: 0, v: 1 },
  { u: 0, v: 0.5 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Where a handle is, in document pixels (on a skewed or distorted layer's outline too). */
export function handlePoint(t: LayerTransform, size: Size, h: Handle) {
  if (isDistorted(t)) return layerPoint(t, size, h.u * size.width, h.v * size.height);
  const r = rad(t.rotation);
  const lx = (h.u - 0.5) * size.width * t.scaleX;
  const ly = (h.v - 0.5) * size.height * t.scaleY;
  return { x: t.x + lx * Math.cos(r) - ly * Math.sin(r), y: t.y + lx * Math.sin(r) + ly * Math.cos(r) };
}

/** The layer's outline, for drawing. */
export const outline = (t: LayerTransform, size: Size) => corners(t, size);

/** Moved by (dx, dy) document pixels; `constrain` keeps to the axis it's moved furthest along (Shift). */
export function moved(t: LayerTransform, dx: number, dy: number, constrain = false): LayerTransform {
  if (constrain) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/**
 * Scaled by dragging `handle` to document point `p`. The opposite handle stays put (or the centre, `fromCentre`:
 * Alt). Corners keep the proportions unless `free` (Shift), edges stretch one way. Dragging past the opposite side
 * mirrors.
 */
export function scaled(t: LayerTransform, size: Size, handle: Handle, p: { x: number; y: number }, options: { free?: boolean; fromCentre?: boolean } = {}): LayerTransform {
  if (isDistorted(t)) return scaledDistorted(t, size, handle, p, options);
  const anchor: Handle = options.fromCentre ? { u: 0.5, v: 0.5 } : { u: (1 - handle.u) as Handle["u"], v: (1 - handle.v) as Handle["v"] };
  const a = handlePoint(t, size, anchor);
  const r = rad(t.rotation);
  // The pointer in the layer's own (rotated) frame, from the anchor.
  const dx = p.x - a.x;
  const dy = p.y - a.y;
  const lx = dx * Math.cos(r) + dy * Math.sin(r);
  const ly = -dx * Math.sin(r) + dy * Math.cos(r);
  const spanU = (handle.u - anchor.u) * size.width;
  const spanV = (handle.v - anchor.v) * size.height;
  let sx = spanU ? lx / spanU : t.scaleX;
  let sy = spanV ? ly / spanV : t.scaleY;
  const corner = handle.u !== 0.5 && handle.v !== 0.5;
  if (corner && !options.free) {
    // One factor for both, from whichever way the pointer went further.
    const fx = sx / t.scaleX;
    const fy = sy / t.scaleY;
    const f = Math.abs(fx) > Math.abs(fy) ? fx : fy;
    sx = t.scaleX * f;
    sy = t.scaleY * f;
  }
  const minimum = (s: number) => (Math.abs(s) < 1e-4 ? (s < 0 ? -1e-4 : 1e-4) : s);
  sx = minimum(sx);
  sy = minimum(sy);
  // The anchor stays where it was: the centre is the anchor plus the new half-extent towards it.
  const cx = (0.5 - anchor.u) * size.width * sx;
  const cy = (0.5 - anchor.v) * size.height * sy;
  return { ...t, scaleX: sx, scaleY: sy, x: a.x + cx * Math.cos(r) - cy * Math.sin(r), y: a.y + cx * Math.sin(r) + cy * Math.cos(r) };
}

/**
 * `scaled` for a skewed or distorted layer: stretched along its own axes (as they are at its centre) about the
 * anchor, by how far the pointer is along them, then carried by its corners. Upright layers keep `scaled`'s exact
 * arithmetic.
 */
function scaledDistorted(t: LayerTransform, size: Size, handle: Handle, p: Point, options: { free?: boolean; fromCentre?: boolean }): LayerTransform {
  const anchor: Handle = options.fromCentre ? { u: 0.5, v: 0.5 } : { u: (1 - handle.u) as Handle["u"], v: (1 - handle.v) as Handle["v"] };
  const a = handlePoint(t, size, anchor);
  const h = handlePoint(t, size, handle);
  const [b0, b1, b2, b3] = linearPart(t);
  // The layer's axes at its centre: pointer and handle in them, from the anchor.
  const det = b0 * b3 - b2 * b1;
  if (!det) return t;
  const local = (q: Point) => ({ u: (b3 * (q.x - a.x) - b2 * (q.y - a.y)) / det, v: (-b1 * (q.x - a.x) + b0 * (q.y - a.y)) / det });
  const want = local(p);
  const was = local(h);
  let fx = handle.u !== 0.5 && Math.abs(was.u) > 1e-9 ? want.u / was.u : 1;
  let fy = handle.v !== 0.5 && Math.abs(was.v) > 1e-9 ? want.v / was.v : 1;
  if (handle.u !== 0.5 && handle.v !== 0.5 && !options.free) fx = fy = Math.abs(fx) > Math.abs(fy) ? fx : fy;
  const tiny = (f: number) => (Math.abs(f) < 1e-4 ? (f < 0 ? -1e-4 : 1e-4) : f);
  fx = tiny(fx);
  fy = tiny(fy);
  // B · diag(fx, fy) · B⁻¹ about the anchor.
  const i0 = b3 / det;
  const i1 = -b1 / det;
  const i2 = -b2 / det;
  const i3 = b0 / det;
  const m0 = b0 * fx * i0 + b2 * fy * i1;
  const m1 = b1 * fx * i0 + b3 * fy * i1;
  const m2 = b0 * fx * i2 + b2 * fy * i3;
  const m3 = b1 * fx * i2 + b3 * fy * i3;
  const m: Affine = [m0, m1, m2, m3, a.x - (m0 * a.x + m2 * a.y), a.y - (m1 * a.x + m3 * a.y)];
  return transformedBy(t, size, m) ?? t;
}

/**
 * How a handle drags (Photoshop's Edit › Transform modes): scale (the default), skew (an edge slides along itself, a
 * corner along the edge it's pulled most along), distort (a corner goes anywhere, an edge's corners move with it)
 * and perspective (a corner and its neighbour move apart or together along their edge, symmetrically).
 */
export type TransformMode = "scale" | "skew" | "distort" | "perspective";

/**
 * What a handle drag does: Photoshop's modifiers first (⌘ on a corner distorts, on an edge skews; ⌘⌥⇧ on a corner
 * puts it in perspective; Ctrl on Windows), else Free Transform's mode, else scale.
 */
export function dragMode(handle: Handle, keys: { mod: boolean; alt: boolean; shift: boolean }, session: TransformMode | null): TransformMode {
  const corner = handle.u !== 0.5 && handle.v !== 0.5;
  if (keys.mod && keys.alt && keys.shift && corner) return "perspective";
  if (keys.mod) return corner ? "distort" : "skew";
  return session ?? "scale";
}

/** Which corner of the quad a handle is (top-left 0, then clockwise), or null for an edge. */
const cornerIndex = (h: Handle) => (h.u === 0.5 || h.v === 0.5 ? null : h.v === 0 ? (h.u === 0 ? 0 : 1) : h.u === 1 ? 2 : 3);

/** An edge handle's two corners (its quad indices). */
const edgeCorners = (h: Handle): [number, number] => (h.v === 0 ? [0, 1] : h.u === 1 ? [1, 2] : h.v === 1 ? [2, 3] : [3, 0]);

const unit = (a: Point, b: Point) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

/**
 * A handle dragged to `p` in `mode` (skew, distort, perspective): the layer's quad moved, and the place that puts the
 * layer on it. `projective` false (text, shapes) keeps it affine: distort and perspective then skew. The press's
 * place when the quad can't hold the picture (a bow tie, a sliver).
 */
export function reshaped(t: LayerTransform, size: Size, handle: Handle, p: Point, mode: Exclude<TransformMode, "scale">, projective = true): LayerTransform {
  const q = quadOf(t, size).map((c) => ({ ...c }));
  const corner = cornerIndex(handle);
  const from = handlePoint(t, size, handle);
  const d = { x: p.x - from.x, y: p.y - from.y };
  const effective = projective ? mode : "skew";
  if (corner === null) {
    const [i, j] = edgeCorners(handle);
    // Skew slides the edge along itself; distort moves it with the pointer.
    const along = unit(q[i], q[j]);
    const move = effective === "distort" ? d : { x: along.x * dot(d, along), y: along.y * dot(d, along) };
    for (const k of [i, j]) q[k] = { x: q[k].x + move.x, y: q[k].y + move.y };
  } else if (effective === "distort") {
    q[corner] = { x: p.x, y: p.y };
  } else {
    // The corner's two edges: across (sharing its v) and down (sharing its u).
    const across = [1, 0, 3, 2][corner];
    const down = [3, 2, 1, 0][corner];
    const ua = unit(q[corner], q[across]);
    const ud = unit(q[corner], q[down]);
    const da = dot(d, ua);
    const dd = dot(d, ud);
    const [k, u, amount] = Math.abs(da) >= Math.abs(dd) ? [across, ua, da] : [down, ud, dd];
    q[corner] = { x: q[corner].x + u.x * amount, y: q[corner].y + u.y * amount };
    // Perspective: the neighbour along that edge moves the other way (the edge grows or shrinks about its middle).
    // A skew of what stays affine slides the whole edge (one corner alone would put it in perspective).
    if (effective === "perspective") q[k] = { x: q[k].x - u.x * amount, y: q[k].y - u.y * amount };
    else if (!projective) q[k] = { x: q[k].x + u.x * amount, y: q[k].y + u.y * amount };
  }
  const next = transformFromQuad(q as unknown as Quad, size, t);
  if (!next) return t;
  if (!projective && next.perspective) return t;
  return next;
}

/** Snapping, when it's on: what to snap to, and how near (document pixels) is near enough. */
export interface SnapContext {
  targets: SnapTargets;
  threshold: number;
}

/** Whether a rotation is a whole number of right angles (then the layer's box is its outline, and its edges snap). */
const rightAngled = (rotation: number) => Math.abs(rotation / 90 - Math.round(rotation / 90)) < 1e-9;

/**
 * Moved by (dx, dy) as `moved` does, then snapped: the layer's box (its edges and centre) to the targets. A
 * Shift-constrained move snaps only along the axis it moves.
 */
export function movedWithSnap(t: LayerTransform, size: Size, dx: number, dy: number, constrain: boolean, snap: SnapContext | null): { t: LayerTransform; guides: Guide[] } {
  const next = moved(t, dx, dy, constrain);
  if (!snap) return { t: next, guides: [] };
  const alongX = !constrain || Math.abs(dx) > Math.abs(dy);
  const s = snapMove(bounds(next, size), snap.targets, snap.threshold, { x: alongX, y: !constrain || !alongX });
  // A snapped place is the guide's exactly (the sum leaves a last-digit error otherwise: 800.0000000000001).
  const exact = (v: number) => Math.round(v * 1e6) / 1e6;
  return { t: { ...next, x: s.dx ? exact(next.x + s.dx) : next.x, y: s.dy ? exact(next.y + s.dy) : next.y }, guides: s.guides };
}

/**
 * Scaled by dragging a handle as `scaled` does, then snapped: the edges the handle moves to the targets (only for a
 * layer at a right angle, whose box is its outline). A corner keeping its proportions snaps its nearer edge and
 * scales both ways about its anchor so that edge lands exactly.
 */
export function scaledWithSnap(
  t: LayerTransform,
  size: Size,
  handle: Handle,
  p: { x: number; y: number },
  options: { free?: boolean; fromCentre?: boolean },
  snap: SnapContext | null,
): { t: LayerTransform; guides: Guide[] } {
  const raw = scaled(t, size, handle, p, options);
  if (!snap || !rightAngled(raw.rotation)) return { t: raw, guides: [] };
  const box = bounds(raw, size);
  const hp = handlePoint(raw, size, handle);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const edges = {
    x: near(hp.x, box.x0) ? ("x0" as const) : near(hp.x, box.x1) ? ("x1" as const) : null,
    y: near(hp.y, box.y0) ? ("y0" as const) : near(hp.y, box.y1) ? ("y1" as const) : null,
  };
  const locked = handle.u !== 0.5 && handle.v !== 0.5 && !options.free;
  const s = snapResize(box, edges, snap.targets, snap.threshold, locked);
  if (!s.dx && !s.dy) return { t: raw, guides: [] };
  let next: LayerTransform;
  if (locked) {
    // One factor both ways, about the anchor (the opposite corner, or the centre), so the snapped edge lands.
    const alongX = s.dx !== 0;
    const extent = alongX ? box.x1 - box.x0 : box.y1 - box.y0;
    const edge = alongX ? edges.x : edges.y;
    const d = (alongX ? s.dx : s.dy) * (edge === "x1" || edge === "y1" ? 1 : -1) * (options.fromCentre ? 2 : 1);
    const k = (extent + d) / extent;
    const anchor: Handle = options.fromCentre ? { u: 0.5, v: 0.5 } : { u: (1 - handle.u) as Handle["u"], v: (1 - handle.v) as Handle["v"] };
    const a = handlePoint(raw, size, anchor);
    next = { ...raw, scaleX: raw.scaleX * k, scaleY: raw.scaleY * k, x: a.x + (raw.x - a.x) * k, y: a.y + (raw.y - a.y) * k };
  } else next = scaled(t, size, handle, { x: p.x + s.dx, y: p.y + s.dy }, options);
  const after = bounds(next, size);
  return { t: next, guides: guidesOf(after, snap.targets, { x: edges.x ? [after[edges.x]] : [], y: edges.y ? [after[edges.y]] : [] }) };
}

/** Rotated about its centre by the pointer's turn from `from` to `to`; `snap` (Shift) to 15°. */
export function rotated(t: LayerTransform, from: { x: number; y: number }, to: { x: number; y: number }, snap = false): LayerTransform {
  const turn = (Math.atan2(to.y - t.y, to.x - t.x) - Math.atan2(from.y - t.y, from.x - t.x)) * (180 / Math.PI);
  let rotation = t.rotation + turn;
  if (snap) rotation = Math.round(rotation / 15) * 15;
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
  return { ...t, rotation: rotation === -180 ? 180 : rotation };
}

/** Scaled to fit inside the canvas (contain) or to cover it, centred, its proportions kept and its turn and mirroring too. */
export function fitted(t: LayerTransform, size: Size, canvas: Size, mode: "contain" | "cover"): LayerTransform {
  const r = rad(t.rotation);
  // The box the unscaled, rotated source takes.
  const w = Math.abs(size.width * Math.cos(r)) + Math.abs(size.height * Math.sin(r));
  const h = Math.abs(size.width * Math.sin(r)) + Math.abs(size.height * Math.cos(r));
  const f = mode === "contain" ? Math.min(canvas.width / w, canvas.height / h) : Math.max(canvas.width / w, canvas.height / h);
  return { ...t, x: canvas.width / 2, y: canvas.height / 2, scaleX: Math.sign(t.scaleX || 1) * f, scaleY: Math.sign(t.scaleY || 1) * f };
}

/** Whether an image layer moved between two documents (its transform is a new object only when it changed). */
export function layersMoved(prev: PhotoProject | undefined, next: PhotoProject | undefined): boolean {
  if (!prev || !next) return false;
  const before = new Map(prev.layers.map((l) => [l.id, l]));
  return next.layers.some((l) => {
    const was = before.get(l.id);
    return l.kind === "image" && was?.kind === "image" && was.transform !== l.transform;
  });
}
