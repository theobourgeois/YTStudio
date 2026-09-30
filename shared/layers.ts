/**
 * How a clip becomes a compositor layer at a moment (`compositor.ts`): where
 * it's placed, its opacity, blend mode, edges and video effects, and with
 * motion blur on, the same at each moment across the shutter. The preview
 * (`src/components/preview/engine.ts`) and the export (`server/render.ts`)
 * both build their layers here, so a blurred frame looks the same in both.
 */
import { type Affine, type Placed, type Sample, blendIndex, edgeIndex } from "./compositor.ts";
import { effectPasses, effectsChange } from "./effect-gl.ts";
import { lookAt, motionAt, opacityAt } from "./effects.ts";
import { sourceDelta } from "./timeline.ts";
import { type Size, placeClip, placementAffine } from "./transform.ts";
import type { Clip } from "./types.ts";

/** Where a clip's frame is on the canvas at source time `time` (null: nothing to draw then). */
export type AffineAt = (time: number) => Affine | null;

export interface LayerOptions {
  /** Output size in px (motion blur takes as many moments as the move needs at this size). */
  canvas: Size;
  fps: number;
  /** The most moments motion blur averages (the preview draws fewer than the export). */
  maxSamples: number;
}

/** Where a clip whose frame is the canvas at 100% (a solid, an adjustment layer) is at each source time. */
export function canvasAffine(clip: Clip, canvas: Size): AffineAt {
  return (t) => placementAffine(placeClip(canvas, canvas, motionAt(clip, t)), canvas) as Affine;
}

/** Most motion blur moments in the preview and in the export. */
export const PREVIEW_SAMPLES = 12;
export const EXPORT_SAMPLES = 48;

/** How far (canvas px) the picture may move between two moments of motion blur before it'd show steps. */
const STEP_PX = 1.5;

/** How far (px) any corner of a frame moves from one placement to another. */
export function affineTravel(a: Affine, b: Affine, canvas: Size): number {
  let most = 0;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const dx = (a[0] - b[0]) * u + (a[2] - b[2]) * v + (a[4] - b[4]);
    const dy = (a[1] - b[1]) * u + (a[3] - b[3]) * v + (a[5] - b[5]);
    most = Math.max(most, Math.hypot(dx * canvas.width, dy * canvas.height));
  }
  return most;
}

/**
 * A clip as a layer at source time `time` (everything but its picture: `key` or
 * `solid`), or null when it isn't drawn then. With Motion's Motion Blur on, the layer
 * averages moments over the shutter (Shutter Angle / 360 of a frame, centred on the
 * frame, like After Effects' default phase): as many as its fastest corner needs to
 * move smoothly, and more when an effect changes over the shutter (e.g. a spinning
 * Transform or a growing blur), up to `maxSamples`.
 */
export function clipLayer(clip: Clip, time: number, affineAt: AffineAt, opts: LayerOptions): Omit<Placed, "key"> | null {
  const affine = affineAt(time);
  if (!affine) return null;
  const look = lookAt(clip, time);
  const effects = effectPasses(clip, time);
  const layer: Omit<Placed, "key"> = {
    affine,
    opacity: look.opacity,
    ...(effects.length && { effects }),
    ...(look.blendMode !== "normal" && { blend: blendIndex(look.blendMode) }),
    ...(look.edges !== "none" && { edges: edgeIndex(look.edges) }),
  };
  if (!(look.shutter > 0) || opts.maxSamples < 2) return layer;

  // The shutter's opening, in timeline seconds either side of the frame.
  const half = look.shutter / 360 / opts.fps / 2;
  const at = (offset: number) => time + sourceDelta(clip, offset);
  const open = affineAt(at(-half));
  const close = affineAt(at(half));
  const travel = open && close ? Math.max(affineTravel(open, affine, opts.canvas), affineTravel(affine, close, opts.canvas)) * 2 : 0;
  let n = Math.ceil(travel / STEP_PX);
  // Effects that change over the shutter (their values, or time itself for effects that move on their own).
  const effectsMove = effects.length > 0 && (effectsChange(clip, at(-half), time) || effectsChange(clip, time, at(half)));
  if (effectsMove) n = Math.max(n, 12);
  const opacityMoves = opacityAt(clip, at(-half)) !== look.opacity || opacityAt(clip, at(half)) !== look.opacity;
  if (opacityMoves) n = Math.max(n, 4);
  n = Math.min(opts.maxSamples, n);
  if (n < 2) return layer;

  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const s = at(-half + ((i + 0.5) / n) * 2 * half);
    const placed = affineAt(s);
    if (!placed) continue;
    samples.push({
      affine: placed,
      opacity: opacityAt(clip, s),
      ...(effectsMove && { effects: effectPasses(clip, s) }),
    });
  }
  // Moments where the clip isn't drawn count as nothing (it fades as it leaves).
  while (samples.length && samples.length < n) samples.push({ ...samples[0], opacity: 0 });
  return samples.length > 1 ? { ...layer, samples } : layer;
}
