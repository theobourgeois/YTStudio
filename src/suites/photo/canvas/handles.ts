/**
 * The Move tool's transform handles (ux.md, "Transform and view"): where they are, and what dragging one does to
 * a layer's transform. Pure, in document pixels; the overlay draws them and the pointer feeds them. Every result
 * is absolute (from the transform at the press), so a drag's preview never drifts.
 */
import type { Size } from "@shared/photo/geometry";
import { corners } from "@shared/photo/layers";
import type { LayerTransform, PhotoProject } from "@shared/photo/types";

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

/** Where a handle is, in document pixels. */
export function handlePoint(t: LayerTransform, size: Size, h: Handle) {
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
