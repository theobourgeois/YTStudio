/**
 * Parenting (After Effects' pick-whip): a clip can follow another clip of its sequence (its
 * parent, often a null object), so moving, scaling or turning the parent carries the child
 * along. A child's own Motion stays its own; what the parent adds is how far its Motion has
 * moved away from where it was when they were linked (`ClipParent.rest`), so linking never
 * makes anything jump. Parents can have parents: the moves add up down the chain.
 *
 * Everything here is 2D, in canvas px: `layerMatrix` is a layer's Motion as the map from its
 * own space (the anchor point at the origin) to the canvas; a parent's contribution to its
 * children (`parentDelta`) is its world matrix now times the inverse of the one it was
 * linked at. 2D children get that map composed onto their placement; a 3D layer gets it as
 * a move, turn and scale of its placement before the camera sees it.
 */
import { MOTION, clipKind, findEffect, motionAt } from "./effects.ts";
import { clipsById, outputSize, sourceTime } from "./timeline.ts";
import { type Matrix, type Placement, type Size } from "./transform.ts";
import type { Clip, ClipParent, ParamValues, Project, Vec2 } from "./types.ts";

const RAD = Math.PI / 180;

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

/** `m · n` (apply `n` first). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const applyMatrix = (m: Matrix, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The parts of Motion a parent passes on: where its anchor is, its scale and its rotation. */
export type LayerPose = NonNullable<ClipParent["rest"]>;

/** A parent's pose when it's at its defaults (centred, 100%, upright): a fresh null object's. */
export const DEFAULT_POSE: LayerPose = { position: [0.5, 0.5], scale: [1, 1], rotation: 0 };

/** A layer's pose from its Motion. */
export const poseOf = (m: { position: Vec2; scaleX: number; scaleY: number; rotation: number }): LayerPose => ({
  position: [m.position[0], m.position[1]],
  scale: [m.scaleX, m.scaleY],
  rotation: m.rotation,
});

/** A layer's own space (its anchor point at the origin, unscaled, upright) -> canvas px. */
export function layerMatrix(pose: LayerPose, canvas: Size): Matrix {
  const cos = Math.cos(pose.rotation * RAD);
  const sin = Math.sin(pose.rotation * RAD);
  const [sx, sy] = pose.scale;
  return [cos * sx, sin * sx, -sin * sy, cos * sy, pose.position[0] * canvas.width, pose.position[1] * canvas.height];
}

/** A matrix's move, turn and scale (a skew, which only non-uniform scales under rotation make, is lost). */
export function decompose(m: Matrix, canvas: Size): LayerPose {
  const sx = Math.hypot(m[0], m[1]);
  const rotation = Math.atan2(m[1], m[0]) / RAD;
  // The y axis' length along its own direction, negative when flipped.
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = sx > 1e-12 ? det / sx : Math.hypot(m[2], m[3]);
  return { position: [m[4] / canvas.width, m[5] / canvas.height], scale: [sx, sy], rotation };
}

const MAX_DEPTH = 32;

/**
 * Whether `parentId` can be `childId`'s parent: another visual clip of the project that
 * isn't a camera, and isn't the child or one of the child's own descendants (a loop).
 */
export function canParent(project: Project, childId: string, parentId: string): boolean {
  if (childId === parentId) return false;
  const byId = clipsById(project);
  const parent = byId.get(parentId);
  const child = byId.get(childId);
  if (!parent || !child) return false;
  if (clipKind(parent) === "camera" || !findEffect(parent, MOTION.type)) return false;
  let at: Clip | undefined = parent;
  for (let depth = 0; at && depth < MAX_DEPTH; depth++) {
    if (at.id === childId) return false;
    at = at.parent ? byId.get(at.parent.id) : undefined;
  }
  return !at;
}

/**
 * A clip's world matrix at timeline time `t`: its own Motion's layer matrix, carried by its
 * parents' deltas. (A layer's picture isn't involved: this is where its anchor goes.)
 */
function worldMatrix(byId: ReadonlyMap<string, Clip>, clip: Clip, t: number, canvas: Size, depth: number): Matrix {
  const own = layerMatrix(poseOf(motionAt(clip, sourceTime(clip, t))), canvas);
  const delta = deltaOf(byId, clip, t, canvas, depth + 1);
  return delta ? multiply(delta, own) : own;
}

function deltaOf(byId: ReadonlyMap<string, Clip>, clip: Clip, t: number, canvas: Size, depth: number): Matrix | null {
  if (!clip.parent || depth > MAX_DEPTH) return null;
  const parent = byId.get(clip.parent.id);
  if (!parent) return null;
  const now = worldMatrix(byId, parent, t, canvas, depth);
  const rest = invert(layerMatrix(clip.parent.rest ?? DEFAULT_POSE, canvas));
  return rest ? multiply(now, rest) : null;
}

/**
 * What a clip's parents do to it at timeline time `t`: a map of canvas px to apply after
 * its own placement, or null when it has no parent (or the parent is gone).
 * Parents are evaluated wherever they are in time: before or after their own clip they hold
 * their first or last Motion, like layers outside their in and out points.
 */
export function parentDelta(project: Project, clip: Clip, t: number, canvas: Size): Matrix | null {
  if (!clip.parent) return null;
  return deltaOf(clipsById(project), clip, t, canvas, 0);
}

/** `parentDelta` for one clip, as a function of timeline time (null: it has no parent). */
export function parentAt(project: Project, clip: Clip, canvas: Size): ((t: number) => Matrix | null) | undefined {
  if (!clip.parent) return undefined;
  const byId = clipsById(project);
  return (t) => deltaOf(byId, clip, t, canvas, 0);
}

/** An affine of picture fractions -> canvas fractions, carried by a px map of the canvas. */
export function carryAffine(delta: Matrix, affine: Matrix, canvas: Size): Matrix {
  const { width: W, height: H } = canvas;
  const toPx: Matrix = [W, 0, 0, H, 0, 0];
  const toFraction: Matrix = [1 / W, 0, 0, 1 / H, 0, 0];
  return multiply(toFraction, multiply(delta, multiply(toPx, affine)));
}

/** A placement carried by a px map of the canvas (as a move, turn and scale: see `decompose`). */
export function carryPlacement(p: Placement, delta: Matrix): Placement {
  const [x, y] = applyMatrix(delta, [p.x, p.y]);
  const sx = Math.hypot(delta[0], delta[1]);
  const det = delta[0] * delta[3] - delta[1] * delta[2];
  const sy = sx > 1e-12 ? det / sx : 0;
  const rotation = Math.atan2(delta[1], delta[0]) / RAD;
  return { ...p, x, y, scaleX: p.scaleX * sx, scaleY: p.scaleY * sy, rotation: p.rotation + rotation };
}

/**
 * A Motion edit made on the canvas (where the clip is seen, carried by its parents) turned
 * into the clip's own values: positions go back through the parents' map, scales and
 * rotations lose what the parents add.
 */
export function uncarryMotion(patch: ParamValues, delta: Matrix, canvas: Size): ParamValues {
  const inverse = invert(delta);
  if (!inverse) return patch;
  const { scale: [sx, sy], rotation } = decompose(delta, canvas);
  const out: ParamValues = { ...patch };
  if (Array.isArray(patch.position)) {
    const [x, y] = applyMatrix(inverse, [patch.position[0] * canvas.width, patch.position[1] * canvas.height]);
    out.position = [x / canvas.width, y / canvas.height];
  }
  if (typeof patch.scale === "number" && Math.abs(sy) > 1e-9) out.scale = patch.scale / Math.abs(sy);
  if (typeof patch.scaleWidth === "number" && sx > 1e-9) out.scaleWidth = patch.scaleWidth / sx;
  if (typeof patch.rotation === "number") out.rotation = patch.rotation - rotation;
  return out;
}

/**
 * Link clips to a parent (or with null, unlink them), so that nothing moves at timeline
 * time `t`: the parent's pose then (with its own parents') is kept as the rest it's
 * measured from. Clips that can't have it (itself, a loop, a camera) are left alone.
 * Unlinking keeps a clip where it's seen when its Motion isn't animated.
 */
export function setParent(
  project: Project,
  childIds: readonly string[],
  parentId: string | null,
  t: number,
  canvas: Size = outputSize(project.settings.aspectRatio, "1080p"),
): Project {
  const ids = new Set(childIds);
  const byId = clipsById(project);
  const parent = parentId ? byId.get(parentId) : undefined;
  if (parentId && !parent) return project;
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!ids.has(clip.id)) return clip;
    if (parentId === null) {
      if (!clip.parent) return clip;
      changed = true;
      const { parent: _, ...rest } = clip;
      return bakeParent(project, clip, rest, t, canvas);
    }
    if (clip.parent?.id === parentId || !canParent(project, clip.id, parentId)) return clip;
    changed = true;
    const pose = decompose(worldMatrix(byId, parent!, t, canvas, 0), canvas);
    const atRest = samePose(pose, DEFAULT_POSE);
    const link: ClipParent = { id: parentId, ...(!atRest && { rest: tidyPose(pose) }) };
    // Already linked elsewhere: the old parent's move is baked in first where it can be.
    const base = clip.parent ? bakeParent(project, clip, { ...clip, parent: undefined }, t, canvas) : clip;
    return { ...base, parent: link };
  });
  return changed ? { ...project, clips } : project;
}

/** `unlinked` (the clip without its parent) keeping where the parents put it at `t`, when its Motion isn't animated. */
function bakeParent(project: Project, clip: Clip, unlinked: Clip, t: number, canvas: Size): Clip {
  const delta = parentDelta(project, clip, t, canvas);
  const motion = findEffect(clip, MOTION.type);
  const { parent: _, ...plain } = unlinked;
  if (!delta || !motion || motion.keyframes?.position || motion.keyframes?.scale || motion.keyframes?.rotation) return plain;
  const m = motionAt(clip, sourceTime(clip, t));
  const world = decompose(multiply(delta, layerMatrix(poseOf(m), canvas)), canvas);
  const uniform = motion.params.uniformScale !== false && Math.abs(Math.abs(world.scale[0]) - Math.abs(world.scale[1])) < 1e-6;
  const params: ParamValues = {
    ...motion.params,
    position: [tidyNumber(world.position[0]), tidyNumber(world.position[1])],
    rotation: tidyNumber(world.rotation),
    scale: tidyNumber(Math.abs(world.scale[1])),
    ...(uniform ? {} : { uniformScale: false, scaleWidth: tidyNumber(world.scale[0]) }),
  };
  return { ...plain, effects: plain.effects.map((e) => (e === motion ? { ...e, params } : e)) };
}

const tidyNumber = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const tidyPose = (p: LayerPose): LayerPose => ({
  position: [tidyNumber(p.position[0]), tidyNumber(p.position[1])],
  scale: [tidyNumber(p.scale[0]), tidyNumber(p.scale[1])],
  rotation: tidyNumber(p.rotation),
});
const samePose = (a: LayerPose, b: LayerPose) =>
  [a.position[0] - b.position[0], a.position[1] - b.position[1], a.scale[0] - b.scale[0], a.scale[1] - b.scale[1], (a.rotation - b.rotation) / 360].every(
    (d) => Math.abs(d) < 1e-6,
  );

/** A stored parent link from untrusted storage (its clip is checked once every clip is known). */
export function sanitizeParent(raw: unknown): ClipParent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { id, rest } = raw as { id?: unknown; rest?: unknown };
  if (typeof id !== "string" || !id) return undefined;
  const link: ClipParent = { id };
  const r = rest as { position?: unknown; scale?: unknown; rotation?: unknown } | undefined;
  const pair = (v: unknown): v is Vec2 => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (r && pair(r.position) && pair(r.scale) && typeof r.rotation === "number" && Number.isFinite(r.rotation)) {
    link.rest = { position: [r.position[0], r.position[1]], scale: [r.scale[0], r.scale[1]], rotation: r.rotation };
  }
  return link;
}

/** Drop links to clips that aren't in `clips` (or that would loop), after loading or deleting. */
export function pruneParents(clips: Clip[]): Clip[] {
  if (!clips.some((c) => c.parent)) return clips;
  const byId = new Map(clips.map((c) => [c.id, c]));
  const loops = (clip: Clip) => {
    let at: Clip | undefined = clip;
    for (let depth = 0; at?.parent; depth++) {
      if (depth > MAX_DEPTH) return true;
      at = byId.get(at.parent.id);
      if (at === clip) return true;
    }
    return false;
  };
  let changed = false;
  const out = clips.map((c) => {
    if (!c.parent) return c;
    const parent = byId.get(c.parent.id);
    if (parent && clipKind(parent) !== "camera" && !loops(c)) return c;
    changed = true;
    const { parent: _, ...rest } = c;
    return rest;
  });
  return changed ? out : clips;
}
