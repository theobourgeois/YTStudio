/**
 * Where layers are: a layer's transform as a matrix from its own pixels to document pixels (and back), its
 * corners, and whether a document point is on it. The renderer, the transform handles and the assistant all place
 * layers through these (rendering.md, "Coordinates, units and bounds").
 */
import type { Size } from "./geometry.ts";
import type { LayerTransform } from "./types.ts";

/** A 2D affine map: (x, y) → (a·x + c·y + e, b·x + d·y + f), the canvas convention. */
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** Layer pixels (u, v), origin at the source's top-left edge, to document pixels. */
export function layerMatrix(t: LayerTransform, size: Size): Affine {
  const r = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
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
