/**
 * Projective maps (homographies) for layers distorted in perspective (Edit › Transform › Distort and Perspective:
 * docs/photo/ux.md, "Transform and view"). A layer's place stays its `LayerTransform`: centre, scale, rotation, and
 * with these its skew and perspective, so that typed values stay exact; here is the maths between those numbers, a
 * 3 × 3 matrix and the four corners a drag moves. Pure.
 */
import type { Size } from "./geometry.ts";
import type { LayerTransform } from "./types.ts";

/**
 * A homography, row-major: (x, y) → ((m0·x + m1·y + m2) / w, (m3·x + m4·y + m5) / w) with w = m6·x + m7·y + m8.
 * An affine map has m6 = m7 = 0 and m8 = 1.
 */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** A point in document pixels. */
export interface Point {
  x: number;
  y: number;
}

/** Four corners: the layer's top-left, top-right, bottom-right and bottom-left, where they land. */
export type Quad = readonly [Point, Point, Point, Point];

/** (x, y) through `m`; null where it's at or past the horizon (w ≤ 0: no point of the picture lands there). */
export function project(m: Homography, x: number, y: number): Point | null {
  const w = m[6] * x + m[7] * y + m[8];
  if (!(w > 0)) return null;
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/** The inverse, scaled so that it maps points the right side of the horizon with w > 0. */
export function invertHomography(m: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) throw new Error("A layer with no area can't be inverted.");
  // The adjugate over the determinant; its sign keeps w positive for points the map reaches.
  const s = 1 / det;
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s];
}

/** `m` after `n`: the map that applies `n`, then `m`. */
export function composeHomography(m: Homography, n: Homography): Homography {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(m[r * 3] * n[c] + m[r * 3 + 1] * n[3 + c] + m[r * 3 + 2] * n[6 + c]);
  return out as unknown as Homography;
}

/** The degrees of `t`'s skew and its perspective, 0 when absent. */
export const skewOf = (t: LayerTransform) => t.skew ?? 0;
export const perspectiveOf = (t: LayerTransform): [number, number] => t.perspective ?? [0, 0];

/** Whether a layer is drawn in perspective (its edges don't stay parallel). */
export const isProjective = (t: LayerTransform) => !!t.perspective && (t.perspective[0] !== 0 || t.perspective[1] !== 0);

/** Whether a layer is more than moved, scaled and turned: skewed or in perspective. */
export const isDistorted = (t: LayerTransform) => skewOf(t) !== 0 || isProjective(t);

/**
 * cos and sin of an angle in degrees, exact at right angles (Math.cos of 90° is 6e-17, not 0): a layer turned a
 * quarter keeps a matrix of 0s and ±1s, so it's drawn texel for texel.
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

/**
 * The linear part of a layer's place, R(rotation) · K(skew) · S(scale): layer pixels (from its centre) to document
 * pixels. Skew leans the layer's vertical edges: K = [[1, tan skew], [0, 1]] (Photoshop's horizontal skew).
 */
export function linearPart(t: LayerTransform): [a: number, b: number, c: number, d: number] {
  const [cos, sin] = cosSin(t.rotation);
  const k = skewOf(t) ? Math.tan((skewOf(t) * Math.PI) / 180) : 0;
  // R · K · S: the first column is R·(sx, 0); the second R·(k·sy, sy).
  const c1x = cos * t.scaleX;
  const c1y = sin * t.scaleX;
  const kx = k * t.scaleY;
  const ky = t.scaleY;
  // Without a skew exactly as it always was (−sin·sy, cos·sy: −0 stays −0).
  if (!kx) return [c1x, c1y, -sin * ky, cos * ky];
  return [c1x, c1y, cos * kx - sin * ky, sin * kx + cos * ky];
}

/**
 * Layer pixels (u, v) to document pixels. With q = (u, v) − size / 2 and w = 1 + px·2q.x/width + py·2q.y/height,
 * a pixel lands at centre + L · q / w (L the linear part): the perspective is how much the far side shrinks (at the
 * right edge w = 1 + px), and the centre stays at (x, y).
 */
export function layerProjection(t: LayerTransform, size: Size): Homography {
  const [a, b, c, d] = linearPart(t);
  const [px, py] = perspectiveOf(t);
  const gx = (2 * px) / size.width;
  const gy = (2 * py) / size.height;
  const hw = size.width / 2;
  const hh = size.height / 2;
  // In q: [[L + centre·gᵀ, centre], [gᵀ, 1]]; then q = (u − hw, v − hh).
  const m00 = a + t.x * gx;
  const m01 = c + t.x * gy;
  const m10 = b + t.y * gx;
  const m11 = d + t.y * gy;
  return [m00, m01, t.x - m00 * hw - m01 * hh, m10, m11, t.y - m10 * hw - m11 * hh, gx, gy, 1 - gx * hw - gy * hh];
}

/** The layer's corners in document pixels (top-left, top-right, bottom-right, bottom-left). */
export function quadOf(t: LayerTransform, size: Size): Quad {
  const m = layerProjection(t, size);
  const at = (x: number, y: number) => project(m, x, y) ?? { x: NaN, y: NaN };
  return [at(0, 0), at(size.width, 0), at(size.width, size.height), at(0, size.height)];
}

/**
 * How many document pixels one layer pixel covers at most (sqrt of the area it covers, at its nearest corner): the
 * level a distorted layer's pixels are read at, the far side's widened by its filter.
 */
export function maxLayerScale(t: LayerTransform): number {
  const area = Math.abs(t.scaleX * t.scaleY);
  if (!isProjective(t)) return Math.sqrt(area);
  const [px, py] = perspectiveOf(t);
  // The area a pixel covers is det(L) / w³; w is least at a corner.
  const w = Math.min(1 - px - py, 1 + px - py, 1 + px + py, 1 - px + py);
  return Math.sqrt(area / Math.max(w, 1e-6) ** 3);
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether four corners make a convex quadrilateral with some area, turning one way all round (either way: mirrored). */
export function isConvexQuad(q: Quad): boolean {
  if (q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false;
  const turns = q.map((p, i) => cross(p, q[(i + 1) % 4], q[(i + 2) % 4]));
  const area = Math.abs(cross(q[0], q[1], q[2])) + Math.abs(cross(q[0], q[2], q[3]));
  return area > 1e-6 && (turns.every((t) => t > 0) || turns.every((t) => t < 0));
}

/** The homography taking the rectangle [0, width] × [0, height] to a quad (Heckbert's square-to-quad, scaled). */
export function rectToQuad(size: Size, q: Quad): Homography {
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    // A parallelogram: affine.
    [a, b, c, d, e, f, g, h] = [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0];
  } else {
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    [a, b, c] = [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x];
    [d, e, f] = [p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y];
  }
  // The unit square to the quad, after the rectangle to the unit square.
  return [a / size.width, b / size.height, c, d / size.width, e / size.height, f, g / size.width, h / size.height, 1];
}

/**
 * The place that puts a layer of `size` on four corners (Distort, Perspective, a skew dragged; the assistant's
 * corners): its centre, scale, rotation, skew and perspective. Null when the corners can't hold a picture (not
 * convex, no area, its centre past the horizon). `like`: a transform whose mirroring to keep (a flipped layer's
 * width stays negative rather than becoming a half turn and a flipped height).
 */
export function transformFromQuad(q: Quad, size: Size, like?: LayerTransform): LayerTransform | null {
  if (!isConvexQuad(q)) return null;
  const m = rectToQuad(size, q);
  // In q-space (pixels from the layer's centre), normalised so the centre's w is 1.
  const hw = size.width / 2;
  const hh = size.height / 2;
  const w0 = m[6] * hw + m[7] * hh + m[8];
  if (!(w0 > 0)) return null;
  const gx = m[6] / w0;
  const gy = m[7] / w0;
  const x = (m[0] * hw + m[1] * hh + m[2]) / w0;
  const y = (m[3] * hw + m[4] * hh + m[5]) / w0;
  // L = (the q-space block) − centre·gᵀ.
  const a = m[0] / w0 - x * gx;
  const c = m[1] / w0 - x * gy;
  const b = m[3] / w0 - y * gx;
  const d = m[4] / w0 - y * gy;
  return fromLinear(x, y, [a, b, c, d], [gx * hw, gy * hh], like);
}

/** A place from its centre, linear part and perspective: R · K · S taken apart (rotation, skew, scales). */
export function fromLinear(x: number, y: number, [a, b, c, d]: readonly [number, number, number, number], perspective: readonly [number, number], like?: LayerTransform): LayerTransform | null {
  const det = a * d - b * c;
  const length = Math.hypot(a, b);
  if (!length || !det || ![x, y, a, b, c, d, ...perspective].every(Number.isFinite)) return null;
  // The first column is R·(sx, 0): its length is |sx|; a mirrored layer keeps its width negative when `like`'s is.
  const sx = like && like.scaleX < 0 ? -length : length;
  const angle = Math.atan2(b / sx, a / sx);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  // R⁻¹ · second column = (k·sy, sy).
  const ks = cos * c + sin * d;
  const sy = -sin * c + cos * d;
  const rotation = clean((angle * 180) / Math.PI);
  const t: LayerTransform = { x: clean(x), y: clean(y), scaleX: clean(sx), scaleY: clean(sy), rotation: rotation === -180 ? 180 : rotation };
  const k = clean(Math.atan(ks / sy) * (180 / Math.PI));
  if (k) t.skew = k;
  const p: [number, number] = [clean(perspective[0]), clean(perspective[1])];
  if (p[0] || p[1]) t.perspective = p;
  return t;
}

/** Rounding noise taken off (a quad from a plain place gives back 1e-15s): to 1e-9. */
const clean = (v: number) => {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};
