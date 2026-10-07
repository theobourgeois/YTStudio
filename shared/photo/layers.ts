/**
 * Where layers are: a layer's transform as a matrix from its own pixels to document pixels (and back), its
 * corners, and whether a document point is on it. The renderer, the transform handles and the assistant all place
 * layers through these (rendering.md, "Coordinates, units and bounds").
 */
import type { Size } from "./geometry.ts";
import { type Homography, fromLinear, invertHomography, isDistorted, isProjective, layerProjection, linearPart, maxLayerScale, project, quadOf, transformFromQuad } from "./projective.ts";
import type { LayerTransform, PhotoLayer } from "./types.ts";

/** A 2D affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f), the canvas convention. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export { cosSin } from "./projective.ts";

/**
 * Layer pixels (u, v), origin at the source's top-left edge, to document pixels: the layer's affine place (centre,
 * scale, rotation and skew). A layer in perspective isn't affine: what draws or hits it goes through
 * `layerProjection` (or `corners`, `bounds`, `contains`, which do); this is its place without the perspective.
 */
export function layerMatrix(t: LayerTransform, size: Size): Affine {
  const [a, b, c, d] = linearPart(t);
  const cx = size.width / 2;
  const cy = size.height / 2;
  return [a, b, c, d, t.x - (a * cx + c * cy), t.y - (b * cx + d * cy)];
}

/** An affine map as a homography. */
export const affineHomography = (m: Affine): Homography => [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];

/** A homography that's affine as an `Affine`, else null. */
export const homographyAffine = (h: Homography): Affine | null => (h[6] === 0 && h[7] === 0 && h[8] === 1 ? [h[0], h[3], h[1], h[4], h[2], h[5]] : null);

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error("A layer with no area can't be inverted.");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const apply = (m: Affine, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Where layer pixel (u, v) lands, in perspective too (NaN past the horizon, which no layer's own pixel is). */
export function layerPoint(t: LayerTransform, size: Size, u: number, v: number): { x: number; y: number } {
  if (!isProjective(t)) return apply(layerMatrix(t, size), u, v);
  return project(layerProjection(t, size), u, v) ?? { x: NaN, y: NaN };
}

/** The layer pixel under document point (x, y); null where none can be (past a layer in perspective's horizon). */
export function pointInLayer(t: LayerTransform, size: Size, x: number, y: number): { x: number; y: number } | null {
  if (!isProjective(t)) return apply(invert(layerMatrix(t, size)), x, y);
  return project(invertHomography(layerProjection(t, size)), x, y);
}

/** The layer's four corners in document pixels: top-left, top-right, bottom-right, bottom-left of the source. */
export function corners(t: LayerTransform, size: Size) {
  return [layerPoint(t, size, 0, 0), layerPoint(t, size, size.width, 0), layerPoint(t, size, size.width, size.height), layerPoint(t, size, 0, size.height)];
}

/** Whether document point (x, y) is on the layer's pixels. */
export function contains(t: LayerTransform, size: Size, x: number, y: number): boolean {
  const p = pointInLayer(t, size, x, y);
  return !!p && p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
}

/**
 * How many document pixels one layer pixel covers (the scale the renderer picks levels by): on average, or for a
 * layer in perspective at its nearest corner (its far side is read at that level, widened).
 */
export const layerScale = (t: LayerTransform) => maxLayerScale(t);

/** The axis-aligned box around the layer, in document pixels. */
export function bounds(t: LayerTransform, size: Size) {
  const c = corners(t, size);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** `m` after `n`: the map that applies `n`, then `m`. */
export function compose(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * A layer's transform after `m` moves its pixels (several layers transformed together: each is carried by the same
 * map). A plain place stays plain when it can (a rotated layer stretched one way is skewed); a layer in perspective
 * is carried by its corners. Null when the result can't hold a picture (no area).
 */
export function transformedBy(t: LayerTransform, size: Size, m: Affine): LayerTransform | null {
  if (isProjective(t)) {
    const q = quadOf(t, size).map((p) => apply(m, p.x, p.y));
    return transformFromQuad([q[0], q[1], q[2], q[3]], size, t);
  }
  const [a, b, c, d] = compose(m, layerMatrix(t, size));
  const centre = apply(compose(m, layerMatrix(t, size)), size.width / 2, size.height / 2);
  const scaleX = Math.hypot(a, b);
  if (!scaleX) return null;
  const scaleY = (a * d - b * c) / scaleX;
  // Plain when the second column is the first turned a right angle (no skew), as it was.
  if (!isDistorted(t) && Math.abs(a * c + b * d) <= 1e-9 * Math.max(1, scaleX * Math.abs(scaleY))) {
    const rotation = (Math.atan2(b, a) * 180) / Math.PI;
    return { x: centre.x, y: centre.y, scaleX, scaleY, rotation: rotation === -180 ? 180 : rotation };
  }
  return fromLinear(centre.x, centre.y, [a, b, c, d], [0, 0], t);
}

/** The box around a part of a layer's pixels (its crop), in document pixels. */
function partBounds(t: LayerTransform, size: Size, c: { x: number; y: number; width: number; height: number }) {
  const pts = [layerPoint(t, size, c.x, c.y), layerPoint(t, size, c.x + c.width, c.y), layerPoint(t, size, c.x + c.width, c.y + c.height), layerPoint(t, size, c.x, c.y + c.height)];
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}

/**
 * The layer an edit with the selection acts on when none is active (Photoshop always has one): the topmost visible
 * layer with content whose box meets `box` (a generator's content is everywhere); null when there's none.
 * `sizeOf` says a placed layer's size (null: not known yet).
 */
export function layerUnder(
  layers: readonly PhotoLayer[],
  box: { x0: number; y0: number; x1: number; y1: number },
  sizeOf: (layer: PhotoLayer) => Size | null,
): string | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible || l.kind === "adjustment") continue;
    if (l.kind === "generator") return l.id;
    const size = sizeOf(l);
    if (!size) continue;
    // What shows of it: inside its crop.
    const c = l.crop;
    const b = c ? partBounds(l.transform, size, c) : bounds(l.transform, size);
    if (b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0) return l.id;
  }
  return null;
}
