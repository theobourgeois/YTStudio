/**
 * How a clip becomes a compositor layer at a moment (`compositor.ts`): where
 * it's placed, its opacity, blend mode, edges and video effects, and with
 * motion blur on, the same at each moment across the shutter. The preview
 * (`src/components/preview/engine.ts`) and the export (`server/render.ts`)
 * both build their layers here, so a blurred frame looks the same in both.
 */
import { type Camera3D, cameraAt, defocus, projectLayer } from "./camera.ts";
import { type EffectPass, type Placed, type Placement2D, type Sample, blendIndex, edgeIndex, placePoint } from "./compositor.ts";
import { effectPass, effectPasses, effectsChange } from "./effect-gl.ts";
import { effectDefinition, lookAt, motionAt, opacityAt } from "./effects.ts";
import { sourceDelta, timelineTime } from "./timeline.ts";
import { carryAffine, carryPlacement } from "./parenting.ts";
import { type Matrix, type Placement, type Size, placeClip, placementAffine } from "./transform.ts";
import type { Clip, Project } from "./types.ts";

/**
 * Where a clip's frame is on the canvas at a moment: its placement, and for a 3D layer
 * also its own shape (width / height, which effects work in), how deep it is in front of
 * the camera (far layers are drawn first) and its depth-of-field blur (a fraction of the
 * canvas height).
 */
export interface Where {
  affine: Placement2D;
  aspect?: number;
  depth?: number;
  blur?: number;
}

/** Where a clip's frame is on the canvas at source time `time` (null: nothing to draw then). */
export type AffineAt = (time: number) => Placement2D | Where | null;

const whereOf = (w: Placement2D | Where | null): Where | null => (w === null ? null : Array.isArray(w) ? { affine: w } : w);

/**
 * Where a clip lands at each of its source times: `placementAt`'s 2D placement as an affine
 * map, or for a 3D layer (Motion's 3D Layer switch) that placement in space, seen through the
 * camera at the clip's timeline time then (`camera`). A parented clip is carried by what its
 * parents do at that timeline time (`parent`, see `parenting.ts`).
 */
export function placer(
  clip: Clip,
  canvas: Size,
  placementAt: (time: number) => Placement | null,
  camera: (t: number) => Camera3D,
  parent?: (t: number) => Matrix | null,
): (time: number) => Where | null {
  return (time) => {
    let p = placementAt(time);
    if (!p) return null;
    const motion = motionAt(clip, time);
    const delta = parent?.(timelineTime(clip, time)) ?? null;
    if (!motion.threeD) {
      const affine = placementAffine(p, canvas);
      return { affine: delta ? carryAffine(delta, affine, canvas) : affine };
    }
    if (delta) p = carryPlacement(p, delta);
    const cam = camera(timelineTime(clip, time));
    const { matrix, depth } = projectLayer(p, motion, canvas, cam);
    const aspect = (p.width * Math.abs(p.scaleX)) / Math.max(1e-9, p.height * Math.abs(p.scaleY));
    return { affine: matrix, depth, aspect, blur: defocus(cam, depth, canvas) };
  };
}

/** The camera 3D layers of `project` are seen through, at timeline times, on a canvas of `canvas` px. */
export const projectCamera = (project: Project, canvas: Size) => (t: number) => cameraAt(project, t, canvas);

export interface LayerOptions {
  /** Output size in px (motion blur takes as many moments as the move needs at this size). */
  canvas: Size;
  fps: number;
  /** The most moments motion blur averages (the preview draws fewer than the export). */
  maxSamples: number;
}

/**
 * A 3D layer's depth-of-field blur, as a Gaussian Blur over its picture: the camera's blur
 * (a fraction of the canvas height) as a fraction of the layer's height as shown.
 */
function defocusPasses(where: Where | null, time: number, opts: LayerOptions): EffectPass[] {
  if (!where?.blur || !(where.blur > 1e-4)) return [];
  const top = placePoint(where.affine, 0.5, 0);
  const bottom = placePoint(where.affine, 0.5, 1);
  const shown = top && bottom ? Math.hypot(top[0] - bottom[0], (top[1] - bottom[1]) * 1) : 1;
  const def = effectDefinition("gaussian-blur");
  const pass = def && effectPass(def, { blurriness: Math.min(0.25, where.blur / Math.max(shown, 0.01)), dimensions: "both" }, time, opts.fps);
  return pass ? [pass] : [];
}

/**
 * Draw 3D layers far first: each run of neighbouring layers that have a depth (3D layers on
 * tracks next to each other) is reordered by it, like After Effects; 2D layers stay put.
 */
export function sortByDepth<L>(layers: readonly L[], depthOf: (layer: L) => number | undefined): L[] {
  const out: L[] = [];
  let run: L[] = [];
  const flush = () => {
    out.push(...run.map((l, i) => ({ l, i })).sort((a, b) => depthOf(b.l)! - depthOf(a.l)! || a.i - b.i).map((x) => x.l));
    run = [];
  };
  for (const layer of layers) {
    if (depthOf(layer) === undefined) {
      flush();
      out.push(layer);
    } else run.push(layer);
  }
  flush();
  return out;
}

/**
 * Track mattes (After Effects' TrkMat): each layer (bottom first) whose `matteOf` isn't 0
 * takes the layer on the video track right above its own (`above`) as its matte, which
 * then isn't drawn itself. Only `canMatte` layers (a picture, not a transition) can be one.
 */
export function withTrackMattes<L extends { trackId: string }>(
  layers: readonly L[],
  above: (trackId: string) => string | undefined,
  matteOf: (layer: L) => number,
  canMatte: (layer: L) => boolean,
  attach: (layer: L, matte: L, mode: number) => L,
): L[] {
  const used = new Set<number>();
  const out: L[] = [];
  layers.forEach((layer, i) => {
    if (used.has(i)) return;
    const mode = matteOf(layer);
    const upper = mode > 0 ? above(layer.trackId) : undefined;
    const j = upper === undefined ? -1 : layers.findIndex((l, k) => k > i && l.trackId === upper);
    if (j < 0 || !canMatte(layers[j])) {
      out.push(layer);
      return;
    }
    used.add(j);
    out.push(attach(layer, layers[j], mode));
  });
  return out;
}

/**
 * Where a clip whose frame is the canvas at 100% (a solid, an adjustment layer) is at each
 * source time; a 3D solid through `camera` (default: the default camera).
 */
export function canvasAffine(clip: Clip, canvas: Size, camera?: (t: number) => Camera3D, parent?: (t: number) => Matrix | null): AffineAt {
  return placer(clip, canvas, (t) => placeClip(canvas, canvas, motionAt(clip, t)), camera ?? (() => cameraAt(null, 0, canvas)), parent);
}

/** Most motion blur moments in the preview and in the export. */
export const PREVIEW_SAMPLES = 12;
export const EXPORT_SAMPLES = 48;

/** How far (canvas px) the picture may move between two moments of motion blur before it'd show steps. */
const STEP_PX = 1.5;

/** How far (px) any corner (or the middle) of a frame moves from one placement to another. */
export function affineTravel(a: Placement2D, b: Placement2D, canvas: Size): number {
  let most = 0;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.5, 0.5],
  ]) {
    const p = placePoint(a, u, v);
    const q = placePoint(b, u, v);
    // A corner crossing behind the camera: as far as the canvas is big.
    if (!p || !q) {
      if (p !== q) most = Math.max(most, canvas.width + canvas.height);
      continue;
    }
    most = Math.max(most, Math.hypot((p[0] - q[0]) * canvas.width, (p[1] - q[1]) * canvas.height));
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
export function clipLayer(clip: Clip, time: number, placeAt: AffineAt, opts: LayerOptions): (Omit<Placed, "key"> & { depth?: number }) | null {
  const affineAt = (t: number) => whereOf(placeAt(t))?.affine ?? null;
  const where = whereOf(placeAt(time));
  if (!where) return null;
  const { affine } = where;
  const look = lookAt(clip, time);
  const effects = [...effectPasses(clip, time, opts.fps), ...defocusPasses(where, time, opts)];
  const layer: Omit<Placed, "key"> & { depth?: number } = {
    affine,
    opacity: look.opacity,
    ...(effects.length && { effects }),
    ...(look.blendMode !== "normal" && { blend: blendIndex(look.blendMode) }),
    ...(look.edges !== "none" && { edges: edgeIndex(look.edges) }),
    ...(where.aspect !== undefined && { aspect: where.aspect }),
    ...(where.depth !== undefined && { depth: where.depth }),
  };
  if (!(look.shutter > 0) || opts.maxSamples < 2) return layer;

  // The shutter's opening, in timeline seconds either side of the frame.
  const half = look.shutter / 360 / opts.fps / 2;
  const at = (offset: number) => time + sourceDelta(clip, offset);
  const open = affineAt(at(-half));
  const close = affineAt(at(half));
  const travel = open && close ? Math.max(affineTravel(open, affine, opts.canvas), affineTravel(affine, close, opts.canvas)) * 2 : 0;
  let n = Math.ceil(travel / STEP_PX - 1e-6);
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
      // The middle moment is the frame's own, which time effects remember.
      ...(effectsMove && { effects: [...effectPasses(clip, s, opts.fps, i === Math.floor(n / 2)), ...defocusPasses(whereOf(placeAt(s)), s, opts)] }),
    });
  }
  // Moments where the clip isn't drawn count as nothing (it fades as it leaves).
  while (samples.length && samples.length < n) samples.push({ ...samples[0], opacity: 0 });
  return samples.length > 1 ? { ...layer, samples } : layer;
}
