/** Pure helpers for the on-canvas transform handles (what's where on the canvas right now). */
import type { Clip, MediaAsset, Project, Vec2 } from "@shared/types";
import { isTextClip, motionAt, opacityAt, textStyleAt } from "@shared/effects";
import { type Placement, type Size, containsPoint, frameCorners, placeClip } from "@shared/transform";
import { videoTracks } from "@shared/timeline";
import { type TextLayout, layoutText, textUnit } from "@/lib/text-render";
import { planTrack } from "@shared/scene";

export interface OnCanvas {
  clip: Clip;
  /** Source time shown (what the clip's values are read at). */
  time: number;
  placement: Placement;
  /** How a text clip is laid out (null for media). */
  text: TextLayout | null;
}

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
  const media = asset?.width && asset.height ? { width: asset.width, height: asset.height } : canvas;
  return { placement: placeClip(canvas, media, motion), text: null };
}

/** The clip each video track shows at timeline time `t`, placed on the canvas, top layer first. */
export function clipsOnCanvas(project: Project, assets: MediaAsset[], canvas: Size, t: number): OnCanvas[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out: OnCanvas[] = [];
  for (const track of videoTracks(project)) {
    const { current } = planTrack(project, track.id, t);
    if (!current) continue;
    const asset = byId.get(current.clip.assetId);
    out.push({ ...current, ...placeOnCanvas(project, current.clip, asset, canvas, current.time) });
  }
  return out;
}

/** The topmost visible clip under a canvas point. */
export function clipAtPoint(clips: OnCanvas[], point: Vec2): OnCanvas | undefined {
  return clips.find((c) => opacityAt(c.clip, c.time) > 0 && containsPoint(c.placement, point));
}

/**
 * Snap a moved frame's bounding box to the canvas edges and centre lines:
 * the smallest correction on each axis that lines up an edge or the centre
 * of the box with one of them, within `threshold` px.
 */
export function snapMove(
  placement: Placement,
  delta: Vec2,
  canvas: Size,
  threshold: number,
): { delta: Vec2; guides: { x: number | null; y: number | null } } {
  const corners = frameCorners(placement);
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
