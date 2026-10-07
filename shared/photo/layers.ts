/**
 * Where layers are: a layer's transform as a matrix from its own pixels to document pixels (and back), its
 * corners, and whether a document point is on it. The renderer, the transform handles and the assistant all place
 * layers through these (rendering.md, "Coordinates, units and bounds").
 */
import type { Size } from "./geometry.ts";
import type { LayerTransform, PhotoLayer } from "./types.ts";

/** A 2D affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f), the canvas convention. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/**
 * cos and sin of an angle in degrees, exact at right angles (Math.cos of 90° is 6e-17, not 0): a layer turned a
 * quarter keeps a matrix of 0s and ±1s, so it's drawn texel for texel (`alignedLayer`).
 */
export function cosSin(degrees: number): [cos: number, sin: number] {
  const quarter = degrees / 90;
  if (Number.isInteger(quarter)) {
    const k = ((quarter % 4) + 4) % 4;
    return [[1, 0, -1, 0][k], [0, 1, 0, -1][k]];
  }
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Layer pixels (u, v), origin at the source's top-left edge, to document pixels. */
export function layerMatrix(t: LayerTransform, size: Size): Affine {
  const [cos, sin] = cosSin(t.rotation);
  const a = cos * t.scaleX;
  const b = sin * t.scaleX;
  const c = -sin * t.scaleY;
  const d = cos * t.scaleY;
  const cx = size.width / 2;
  const cy = size.height / 2;
  return [a, b, c, d, t.x - (a * cx + c * cy), t.y - (b * cx + d * cy)];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) throw new Error("A layer with no area can't be inverted.");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const apply = (m: Affine, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** The layer's four corners in document pixels: top-left, top-right, bottom-right, bottom-left of the source. */
export function corners(t: LayerTransform, size: Size) {
  const m = layerMatrix(t, size);
  return [apply(m, 0, 0), apply(m, size.width, 0), apply(m, size.width, size.height), apply(m, 0, size.height)];
}

/** Whether document point (x, y) is on the layer's pixels. */
export function contains(t: LayerTransform, size: Size, x: number, y: number): boolean {
  const p = apply(invert(layerMatrix(t, size)), x, y);
  return p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height;
}

/** How many document pixels one layer pixel covers, on average (the scale the renderer picks levels by). */
export const layerScale = (t: LayerTransform) => Math.sqrt(Math.abs(t.scaleX * t.scaleY));

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
 * map), or null when the result would skew it, which a `LayerTransform` can't say (a rotated layer stretched one
 * way).
 */
export function transformedBy(t: LayerTransform, size: Size, m: Affine): LayerTransform | null {
  const [a, b, c, d] = compose(m, layerMatrix(t, size));
  const scaleX = Math.hypot(a, b);
  if (!scaleX) return null;
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  const scaleY = (a * d - b * c) / scaleX;
  // The second column must be the first turned a right angle: no skew.
  if (Math.abs(a * c + b * d) > 1e-9 * Math.max(1, scaleX * Math.abs(scaleY))) return null;
  const centre = apply(compose(m, layerMatrix(t, size)), size.width / 2, size.height / 2);
  return { x: centre.x, y: centre.y, scaleX, scaleY, rotation: rotation === -180 ? 180 : rotation };
}

/** Where the centre of a part of a layer's pixels (its crop) lands. */
function cropCentre(t: LayerTransform, size: Size, c: { x: number; y: number; width: number; height: number }) {
  return apply(layerMatrix(t, size), c.x + c.width / 2, c.y + c.height / 2);
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
    const b = c ? bounds({ ...l.transform, ...cropCentre(l.transform, size, c) }, { width: c.width, height: c.height }) : bounds(l.transform, size);
    if (b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0) return l.id;
  }
  return null;
}
