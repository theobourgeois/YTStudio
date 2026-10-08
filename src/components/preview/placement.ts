/** Pure helpers for the on-canvas transform handles (what's where on the canvas right now). */
import type { Clip, MediaAsset, Project, Vec2 } from "@shared/types";
import { atFrameRate, isCameraClip, isShapeClip, isTextClip, motionAt, opacityAt, textStyleAt } from "@shared/effects";
import type { Rect } from "@shared/path";
import { shapeBounds, shapeContains } from "@shared/shapes";
import { cameraAt, projectLayer } from "@shared/camera";
import { placePoint } from "@shared/compositor";
import { carryPlacement, parentDelta } from "@shared/parenting";
import { type Matrix, type Placement, type Size, containsPoint, frameCorners, placeClip, toCanvas, toFrame } from "@shared/transform";
import { outputSize, videoTracks } from "@shared/timeline";
import { type TextLayout, layoutText, textUnit } from "@/lib/text-render";
import { planTrack } from "@shared/scene";

export interface OnCanvas {
  clip: Clip;
  /** Source time shown (what the clip's values are read at). */
  time: number;
  placement: Placement;
  /** How a text clip is laid out (null for media). */
  text: TextLayout | null;
  /** A 3D layer's corners on the canvas as the camera sees it (null: 2D, or not all in front of the camera). */
  corners3d?: Vec2[] | null;
  /** What its parents do to it (canvas px), already applied to `placement`; edits go back through it. */
  parent?: Matrix | null;
  /**
   * A shape layer: the box around what it draws, in fractions of its frame (which is the
   * whole canvas: the handles go around the shapes instead), and the frame's size at 1080p,
   * which its shapes are measured in. `box` is null when it draws nothing.
   */
  shape?: { box: Rect | null; reference: Size };
}

/** The corners on the canvas of the box the handles go around: a shape layer's shapes, else the frame. */
export function boxCorners(c: Pick<OnCanvas, "placement" | "shape">): [Vec2, Vec2, Vec2, Vec2] {
  const box = c.shape?.box;
  if (!box) return frameCorners(c.placement);
  const p = c.placement;
  const at = (u: number, v: number) => toCanvas(p, [(box.x + u * box.width) * p.width, (box.y + v * box.height) * p.height]);
  return [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
}

/** A point of that box (fractions of it) as fractions of the clip's frame: where a handle is. */
export function boxPoint(c: Pick<OnCanvas, "shape">, [u, v]: Vec2): Vec2 {
  const box = c.shape?.box;
  return box ? [box.x + u * box.width, box.y + v * box.height] : [u, v];
}

/** A null object's box on the canvas at 100% (it has no picture: this is only for grabbing it). */
export const nullFrame = (canvas: Size): Size => {
  const side = Math.min(canvas.width, canvas.height) * 0.12;
  return { width: side, height: side };
};

/** Where a clip is on the canvas at source time `time` (and its text layout, for text). */
export function placeOnCanvas(
  project: Project,
  clip: Clip,
  asset: MediaAsset | undefined,
  canvas: Size,
  time: number,
): { placement: Placement; text: TextLayout | null } {
  const motion = motionAt(clip, time);
  if (isTextClip(clip)) {
    const text = layoutText(textStyleAt(clip, time), textUnit(canvas, project.settings.aspectRatio));
    return { placement: placeClip(canvas, text, motion, text), text };
  }
  if (clip.nullObject) return { placement: placeClip(canvas, canvas, motion, nullFrame(canvas)), text: null };
  const media = asset?.width && asset.height ? { width: asset.width, height: asset.height } : canvas;
  return { placement: placeClip(canvas, media, motion), text: null };
}

/** A 3D layer's corners on the canvas (px), as the camera at timeline time `t` sees them; null for a 2D layer. */
export function projectedCorners(project: Project, clip: Clip, placement: Placement, canvas: Size, time: number, t: number): Vec2[] | null {
  const motion = motionAt(clip, time);
  if (!motion.threeD) return null;
  const { matrix } = projectLayer(placement, motion, canvas, cameraAt(project, t, canvas));
  const corners = ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([u, v]) => placePoint(matrix, u, v));
  return corners.every(Boolean) ? corners.map((c) => [c![0] * canvas.width, c![1] * canvas.height] as Vec2) : null;
}

/** The clip each video track shows at timeline time `t`, placed on the canvas, top layer first. Cameras draw nothing, so they aren't here. */
export function clipsOnCanvas(project: Project, assets: MediaAsset[], canvas: Size, t: number): OnCanvas[] {
  return atFrameRate(project.settings.fps, () => onCanvasAt(project, assets, canvas, t));
}

function onCanvasAt(project: Project, assets: MediaAsset[], canvas: Size, t: number): OnCanvas[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: OnCanvas[] = [];
  for (const track of videoTracks(project)) {
    if (track.hidden) continue;
    const { current } = planTrack(project, track.id, t);
    if (!current || isCameraClip(current.clip)) continue;
    const asset = byId.get(current.clip.assetId);
    const placed = placeOnCanvas(project, current.clip, asset, canvas, current.time);
    const parent = parentDelta(project, current.clip, t, canvas);
    const placement = parent ? carryPlacement(placed.placement, parent) : placed.placement;
    let shape: OnCanvas["shape"];
    if (isShapeClip(current.clip)) {
      const reference = outputSize(project.settings.aspectRatio, "1080p");
      const b = shapeBounds(current.clip, current.time, reference);
      shape = {
        reference,
        box: b ? { x: b.x / reference.width, y: b.y / reference.height, width: b.width / reference.width, height: b.height / reference.height } : null,
      };
    }
    out.push({
      ...current,
      ...placed,
      placement,
      parent,
      corners3d: projectedCorners(project, current.clip, placement, canvas, current.time, t),
      ...(shape && { shape }),
    });
  }
  return out;
}

/** Whether a point is inside a convex polygon (either winding). */
function insidePolygon(corners: Vec2[], [x, y]: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % corners.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * The topmost visible clip under a canvas point. Adjustment layers (which cover the
 * whole canvas but show nothing of their own) are only found when `adjustments` says so,
 * e.g. to drag the selected one; otherwise clicks go through to what's below.
 */
export function clipAtPoint(clips: OnCanvas[], point: Vec2, adjustments = false): OnCanvas | undefined {
  return clips.find(
    (c) =>
      (adjustments || !c.clip.adjustment) &&
      opacityAt(c.clip, c.time) > 0 &&
      (c.corners3d ? insidePolygon(c.corners3d, point) : c.shape ? onShape(c, point) : containsPoint(c.placement, point)),
  );
}

/** How near (canvas px) a press must be to a thin shape to grab it. */
const SHAPE_SLACK_PX = 5;

/** Whether a canvas point is on something a shape layer draws (not just on its frame, which is the whole canvas). */
function onShape(c: OnCanvas, point: Vec2): boolean {
  const f = toFrame(c.placement, point);
  const { reference } = c.shape!;
  if (!f || !(c.placement.width > 0 && c.placement.height > 0)) return false;
  const k = reference.width / c.placement.width;
  const slack = (SHAPE_SLACK_PX * k) / Math.max(1e-6, Math.abs(c.placement.scaleX));
  return shapeContains(c.clip, c.time, reference, [f[0] * k, (f[1] * reference.height) / c.placement.height], slack);
}

/**
 * Snap a moved frame's bounding box to the canvas edges and centre lines:
 * the smallest correction on each axis that lines up an edge or the centre
 * of the box with one of them, within `threshold` px.
 */
export function snapMove(
  target: Placement | readonly Vec2[],
  delta: Vec2,
  canvas: Size,
  threshold: number,
): { delta: Vec2; guides: { x: number | null; y: number | null } } {
  const corners = Array.isArray(target) ? (target as readonly Vec2[]) : frameCorners(target as Placement);
  const axis = (i: 0 | 1, size: number) => {
    const values = corners.map((c) => c[i] + delta[i]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    let best: { shift: number; at: number } | null = null;
    for (const edge of [lo, (lo + hi) / 2, hi]) {
      for (const target of [0, size / 2, size]) {
        const shift = target - edge;
        if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) {
          best = { shift, at: target };
        }
      }
    }
    return best;
  };
  const x = axis(0, canvas.width);
  const y = axis(1, canvas.height);
  return {
    delta: [delta[0] + (x?.shift ?? 0), delta[1] + (y?.shift ?? 0)],
    guides: { x: x?.at ?? null, y: y?.at ?? null },
  };
}
