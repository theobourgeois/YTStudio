/**
 * Where a visual clip lands on the canvas. The preview (CSS), the on-canvas
 * transform handles and the export (ffmpeg) all use this, so they agree.
 *
 * The clip's frame is first fitted to the canvas (`fit`: the whole frame, or
 * filling the canvas), which is its size at 100% (text has its own size). Then, like Premiere's Motion
 * effect, it's scaled and rotated around its anchor point, and the anchor point
 * is put at `position`:
 *
 *   canvas point = position + Rotate(rotation) · Scale(scaleX, scaleY) · (frame point - anchor)
 *
 * Canvas and frame coordinates are px with y pointing down, so positive
 * rotation is clockwise.
 */
import type { Motion } from "./effects.ts";
import type { FitMode, Vec2 } from "./types.ts";

export interface Size {
  width: number;
  height: number;
}

export interface Placement {
  /** Frame size at 100% (fitted to the canvas), in canvas px. */
  width: number;
  height: number;
  /** Anchor point in the unscaled frame, px from its top-left. */
  anchorX: number;
  anchorY: number;
  /** Canvas px the anchor point sits at. */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
}

/** 2D affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (CSS `matrix()` order). */
export type Matrix = [number, number, number, number, number, number];

const RAD = Math.PI / 180;

/** The frame's size at 100%: the whole frame inside the canvas, or covering all of it. */
export function fittedSize(canvas: Size, media: Size, fit: FitMode): Size {
  if (!(media.width > 0 && media.height > 0)) return { ...canvas };
  const kx = canvas.width / media.width;
  const ky = canvas.height / media.height;
  const k = fit === "cover" ? Math.max(kx, ky) : Math.min(kx, ky);
  return { width: media.width * k, height: media.height * k };
}

/**
 * Where a clip's frame lands. `frame` is the frame's size at 100% when it
 * isn't the media fitted to the canvas: text is laid out at its own size.
 */
export function placeClip(canvas: Size, media: Size, motion: Motion, frame?: Size): Placement {
  const size = frame ?? fittedSize(canvas, media, motion.fit);
  return {
    ...size,
    anchorX: motion.anchor[0] * size.width,
    anchorY: motion.anchor[1] * size.height,
    x: motion.position[0] * canvas.width,
    y: motion.position[1] * canvas.height,
    scaleX: motion.scaleX,
    scaleY: motion.scaleY,
    rotation: motion.rotation,
  };
}

/** Frame px (unscaled) -> canvas px. */
export function placementMatrix(p: Placement): Matrix {
  const cos = Math.cos(p.rotation * RAD);
  const sin = Math.sin(p.rotation * RAD);
  const a = cos * p.scaleX;
  const b = sin * p.scaleX;
  const c = -sin * p.scaleY;
  const d = cos * p.scaleY;
  return [a, b, c, d, p.x - (a * p.anchorX + c * p.anchorY), p.y - (b * p.anchorX + d * p.anchorY)];
}

export function toCanvas(p: Placement, [x, y]: Vec2): Vec2 {
  const [a, b, c, d, e, f] = placementMatrix(p);
  return [a * x + c * y + e, b * x + d * y + f];
}

/** Canvas px -> frame px (unscaled), or null when the frame is scaled to nothing. */
export function toFrame(p: Placement, [x, y]: Vec2): Vec2 | null {
  const [a, b, c, d, e, f] = placementMatrix(p);
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const dx = x - e;
  const dy = y - f;
  return [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
}

/** The frame's corners on the canvas: top-left, top-right, bottom-right, bottom-left. */
export function frameCorners(p: Placement): [Vec2, Vec2, Vec2, Vec2] {
  return [
    toCanvas(p, [0, 0]),
    toCanvas(p, [p.width, 0]),
    toCanvas(p, [p.width, p.height]),
    toCanvas(p, [0, p.height]),
  ];
}

/** Whether a canvas point is on the clip's frame. */
export function containsPoint(p: Placement, point: Vec2): boolean {
  const f = toFrame(p, point);
  return !!f && f[0] >= 0 && f[0] <= p.width && f[1] >= 0 && f[1] <= p.height;
}

export function cssMatrix(p: Placement): string {
  return `matrix(${placementMatrix(p).map((n) => +n.toFixed(6)).join(", ")})`;
}

// ---------------------------------------------------------------------------
// Direct manipulation: new motion values from a pointer, all in canvas px.
// ---------------------------------------------------------------------------

/** Angle of `point` around `center`, in degrees clockwise from the x axis. */
export function angleAround(center: Vec2, point: Vec2): number {
  return Math.atan2(point[1] - center[1], point[0] - center[0]) / RAD;
}

/** Wrap an angle difference into (-180, 180]. */
export function wrapDegrees(delta: number): number {
  const d = ((delta % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/**
 * Scale from dragging a handle (given as fractions of the frame: corners,
 * edge midpoints) to `pointer`, around the anchor point. Edge handles only
 * change their own axis unless `proportional`, which keeps the aspect ratio.
 */
export function scaleFromHandle(
  p: Placement,
  handle: Vec2,
  pointer: Vec2,
  proportional: boolean,
): { scaleX: number; scaleY: number } {
  const cos = Math.cos(p.rotation * RAD);
  const sin = Math.sin(p.rotation * RAD);
  // The pointer relative to the anchor, in the clip's (unrotated) axes.
  const dx = pointer[0] - p.x;
  const dy = pointer[1] - p.y;
  const qx = cos * dx + sin * dy;
  const qy = -sin * dx + cos * dy;
  // The handle relative to the anchor, unscaled.
  const hx = handle[0] * p.width - p.anchorX;
  const hy = handle[1] * p.height - p.anchorY;
  const onX = handle[0] !== 0.5 && Math.abs(hx) > 1e-6;
  const onY = handle[1] !== 0.5 && Math.abs(hy) > 1e-6;

  if (proportional) {
    // How far along its own direction the handle was pulled.
    const vx = onX ? p.scaleX * hx : 0;
    const vy = onY ? p.scaleY * hy : 0;
    const len = vx * vx + vy * vy;
    if (len < 1e-9) return { scaleX: p.scaleX, scaleY: p.scaleY };
    const k = Math.max(0, (qx * vx + qy * vy) / len);
    return { scaleX: p.scaleX * k, scaleY: p.scaleY * k };
  }
  return {
    scaleX: onX ? Math.max(0, qx / hx) : p.scaleX,
    scaleY: onY ? Math.max(0, qy / hy) : p.scaleY,
  };
}

/**
 * Move the anchor point to `pointer` without moving the picture: the new
 * anchor (fractions of the frame) and position (fractions of the canvas).
 */
export function anchorAt(p: Placement, canvas: Size, pointer: Vec2): { anchor: Vec2; position: Vec2 } | null {
  const f = toFrame(p, pointer);
  if (!f || !(p.width > 0 && p.height > 0)) return null;
  return {
    anchor: [f[0] / p.width, f[1] / p.height],
    position: [pointer[0] / canvas.width, pointer[1] / canvas.height],
  };
}
