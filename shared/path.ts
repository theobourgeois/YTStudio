/**
 * Bézier paths, like After Effects' masks and shape layer paths: a list of
 * vertices, each with an incoming and an outgoing tangent handle stored
 * *relative* to its point ([0, 0] = a corner with no handle), open or closed.
 * Masks, shape layers, text on a path, motion paths and a future vector app
 * all share this one module, so they measure, hit-test and draw paths alike.
 *
 * Coordinates are whatever the caller uses (canvas px, y down, in practice).
 * Angles are degrees, clockwise when y points down, like Motion's rotation.
 * Everything here is pure: edits return new paths (the same instance when
 * nothing changed) and never touch their input.
 */
import { isFiniteNumber } from "./math.ts";
import type { Vec2 } from "./types.ts";

export type { Vec2 };

export interface PathVertex {
  point: Vec2;
  /** Incoming tangent handle, relative to `point`. */
  in: Vec2;
  /** Outgoing tangent handle, relative to `point`. */
  out: Vec2;
}

export interface BezierPath {
  vertices: PathVertex[];
  /** The last vertex joins back to the first. */
  closed: boolean;
}

/** A cubic Bézier segment: start, first control, second control, end (all absolute). */
export type Segment = [Vec2, Vec2, Vec2, Vec2];

/** A 2D affine map [a, b, c, d, e, f]: x = a·u + c·v + e, y = b·u + d·v + f (`Affine` in compositor.ts). */
export type PathAffine = [number, number, number, number, number, number];

export type FillRule = "nonzero" | "evenodd";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Handle length (as a fraction of the radius) that makes four cubics a near-perfect circle (error < 0.03%). */
export const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/** Default flattening tolerance (px): the polyline never strays further than this from the curve. */
export const FLATTEN_TOLERANCE = 0.25;
/** Tolerance for measuring lengths, tighter because errors add up along a path. */
export const LENGTH_TOLERANCE = 0.01;

const RAD = Math.PI / 180;
const MAX_DEPTH = 18;

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const length = (a: Vec2) => Math.hypot(a[0], a[1]);
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Rotated a quarter turn (to the left with y up, to the right with y down). */
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
const samePoint = (a: Vec2, b: Vec2, eps = 1e-9) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

/** Distance from `p` to the line segment a–b. */
function distanceToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return distance(p, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2));
  return distance(p, add(a, scale(ab, t)));
}

// ---------------------------------------------------------------------------
// Constructors (After Effects' shape layer primitives)
// ---------------------------------------------------------------------------

const corner = (point: Vec2): PathVertex => ({ point: [point[0], point[1]], in: [0, 0], out: [0, 0] });

/** Straight lines through `points` (the pen tool's clicks without drags). */
export function polygonPath(points: readonly Vec2[], closed: boolean): BezierPath {
  return { vertices: points.map(corner), closed };
}

/**
 * A rectangle from its top-left corner, clockwise (y down) from the top-left.
 * `roundness` is the corner radius in px (AE's Roundness), capped at half the
 * shorter side; each corner is then a quarter ellipse drawn with `KAPPA`.
 */
export function rectPath(x: number, y: number, w: number, h: number, roundness = 0): BezierPath {
  const r = Math.max(0, Math.min(roundness, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r === 0) {
    return polygonPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
  }
  const sx = Math.sign(w) || 1;
  const sy = Math.sign(h) || 1;
  const rx = r * sx;
  const ry = r * sy;
  const k = KAPPA * r;
  const right = x + w;
  const bottom = y + h;
  // Each corner: the vertex before it with an outgoing handle, the one after with an incoming handle.
  const raw: PathVertex[] = [
    { point: [x, y + ry], in: [0, 0], out: [0, -k * sy] },
    { point: [x + rx, y], in: [-k * sx, 0], out: [0, 0] },
    { point: [right - rx, y], in: [0, 0], out: [k * sx, 0] },
    { point: [right, y + ry], in: [0, -k * sy], out: [0, 0] },
    { point: [right, bottom - ry], in: [0, 0], out: [0, k * sy] },
    { point: [right - rx, bottom], in: [k * sx, 0], out: [0, 0] },
    { point: [x + rx, bottom], in: [0, 0], out: [-k * sx, 0] },
    { point: [x, bottom - ry], in: [0, k * sy], out: [0, 0] },
  ];
  // Fully rounded sides have no straight part: merge the two vertices there.
  const vertices: PathVertex[] = [];
  for (const v of raw) {
    const last = vertices[vertices.length - 1];
    if (last && samePoint(last.point, v.point)) last.out = v.out;
    else vertices.push(v);
  }
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  if (vertices.length > 1 && samePoint(first.point, last.point)) {
    first.in = last.in;
    vertices.pop();
  }
  return { vertices, closed: true };
}

/** An ellipse as four cubics, clockwise (y down) from the top, like AE's Ellipse. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): BezierPath {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return {
    vertices: [
      { point: [cx, cy - ry], in: [-kx, 0], out: [kx, 0] },
      { point: [cx + rx, cy], in: [0, -ky], out: [0, ky] },
      { point: [cx, cy + ry], in: [kx, 0], out: [-kx, 0] },
      { point: [cx - rx, cy], in: [0, ky], out: [0, -ky] },
    ],
    closed: true,
  };
}

/** Vertices around a centre from the top, clockwise (y down), with AE's roundness handles. */
function radialPath(
  cx: number,
  cy: number,
  count: number,
  radius: (i: number) => number,
  roundness: (i: number) => number,
  handleScale: number,
  rotation: number,
): BezierPath {
  const step = (2 * Math.PI) / count;
  const vertices: PathVertex[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + rotation * RAD + i * step;
    const r = radius(i);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Handles run along the circle (perpendicular to the radius), AE's length.
    const k = r * handleScale * roundness(i);
    const tangent: Vec2 = [-sin * k, cos * k];
    vertices.push({ point: [cx + r * cos, cy + r * sin], in: scale(tangent, -1), out: tangent });
  }
  return { vertices, closed: true };
}

/**
 * A star (AE's Polystar, Star type): `points` outer vertices alternating with
 * inner ones, the first outer one straight up, turned by `rotation` degrees.
 * Roundness is a fraction (AE's percentage / 100) bending each vertex's edges
 * into an arc along the circle it sits on.
 */
export function starPath(
  cx: number,
  cy: number,
  points: number,
  innerRadius: number,
  outerRadius: number,
  rotation = 0,
  innerRoundness = 0,
  outerRoundness = 0,
): BezierPath {
  const n = Math.max(2, Math.floor(points));
  return radialPath(
    cx,
    cy,
    n * 2,
    (i) => (i % 2 === 0 ? outerRadius : innerRadius),
    (i) => (i % 2 === 0 ? outerRoundness : innerRoundness),
    Math.PI / (2 * n),
    rotation,
  );
}

/** A regular polygon (AE's Polystar, Polygon type), the first vertex straight up. */
export function polygonShapePath(
  cx: number,
  cy: number,
  points: number,
  radius: number,
  rotation = 0,
  roundness = 0,
): BezierPath {
  const n = Math.max(3, Math.floor(points));
  return radialPath(cx, cy, n, () => radius, () => roundness, Math.PI / (2 * n), rotation);
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** The path's cubic segments, in order (a closed path's last one returns to the first vertex). */
export function segments(path: BezierPath): Segment[] {
  const vs = path.vertices;
  const count = path.closed ? vs.length : vs.length - 1;
  const out: Segment[] = [];
  for (let i = 0; i < count; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    out.push([a.point, add(a.point, a.out), add(b.point, b.in), b.point]);
  }
  return out;
}

/** The point at parameter `t` (0..1) of a segment. */
export function pointAt(seg: Segment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * seg[0][0] + b * seg[1][0] + c * seg[2][0] + d * seg[3][0],
    a * seg[0][1] + b * seg[1][1] + c * seg[2][1] + d * seg[3][1],
  ];
}

/** The derivative at `t` (not normalised: its length is the speed along the curve). */
export function tangentAt(seg: Segment, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return [
    a * (seg[1][0] - seg[0][0]) + b * (seg[2][0] - seg[1][0]) + c * (seg[3][0] - seg[2][0]),
    a * (seg[1][1] - seg[0][1]) + b * (seg[2][1] - seg[1][1]) + c * (seg[3][1] - seg[2][1]),
  ];
}

/** The direction of travel at `t`, even where the derivative vanishes (a handle-less end). */
function directionAt(seg: Segment, t: number): Vec2 {
  const d = tangentAt(seg, t);
  if (length(d) > 1e-12) return unit(d);
  const h = 1e-4;
  const around = sub(pointAt(seg, Math.min(1, t + h)), pointAt(seg, Math.max(0, t - h)));
  if (length(around) > 1e-15) return unit(around);
  const chord = sub(seg[3], seg[0]);
  return length(chord) > 0 ? unit(chord) : [1, 0];
}

/** Split a segment at `t` (de Casteljau): the two halves draw exactly the same curve. */
export function splitSegment(seg: Segment, t: number): [Segment, Segment] {
  const [p0, p1, p2, p3] = seg;
  const a = mix(p0, p1, t);
  const b = mix(p1, p2, t);
  const c = mix(p2, p3, t);
  const d = mix(a, b, t);
  const e = mix(b, c, t);
  const m = mix(d, e, t);
  return [
    [p0, a, d, m],
    [m, e, c, p3],
  ];
}

/** Whether the control points lie within `tolerance` of the chord, so the chord can stand in for the curve. */
function isFlat(seg: Segment, tolerance: number): boolean {
  return distanceToLine(seg[1], seg[0], seg[3]) <= tolerance && distanceToLine(seg[2], seg[0], seg[3]) <= tolerance;
}

/** Parameters (0 first, 1 last) where a polyline within `tolerance` of the segment turns. */
function flattenParams(seg: Segment, tolerance: number): number[] {
  const ts = [0];
  const walk = (s: Segment, t0: number, t1: number, depth: number) => {
    if (depth >= MAX_DEPTH || isFlat(s, tolerance)) {
      ts.push(t1);
      return;
    }
    const [l, r] = splitSegment(s, 0.5);
    const tm = (t0 + t1) / 2;
    walk(l, t0, tm, depth + 1);
    walk(r, tm, t1, depth + 1);
  };
  walk(seg, 0, 1, 0);
  return ts;
}

// ---------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------

/**
 * Cumulative lengths along a path, measured once so that many lookups
 * (a glyph each, for text on a path) are a binary search each.
 */
export interface ArcLengthTable {
  path: BezierPath;
  segments: Segment[];
  /** Samples in path order: segment index, parameter, length from the path's start. */
  samples: { segment: number; t: number; at: number }[];
  total: number;
}

export function arcLengthTable(path: BezierPath, tolerance = LENGTH_TOLERANCE): ArcLengthTable {
  const segs = segments(path);
  const samples: ArcLengthTable["samples"] = [];
  let at = 0;
  segs.forEach((seg, segment) => {
    let prev = seg[0];
    for (const t of flattenParams(seg, tolerance)) {
      const p = t === 0 ? seg[0] : t === 1 ? seg[3] : pointAt(seg, t);
      at += distance(prev, p);
      prev = p;
      samples.push({ segment, t, at });
    }
  });
  return { path, segments: segs, samples, total: at };
}

/** A segment's length. */
export function segmentLength(seg: Segment, tolerance = LENGTH_TOLERANCE): number {
  let total = 0;
  let prev = seg[0];
  for (const t of flattenParams(seg, tolerance)) {
    const p = pointAt(seg, t);
    total += distance(prev, p);
    prev = p;
  }
  return total;
}

/** The path's length (every segment, including a closed path's closing one). */
export function pathLength(path: BezierPath, tolerance = LENGTH_TOLERANCE): number {
  return arcLengthTable(path, tolerance).total;
}

export interface PathPoint {
  point: Vec2;
  /** Unit direction of travel. */
  tangent: Vec2;
  /** The tangent's angle in degrees (clockwise with y down, like Motion's rotation). */
  angle: number;
  segmentIndex: number;
  t: number;
}

/**
 * The point `distance` along the path (text on a path, motion paths). Open
 * paths clamp to their ends; closed ones wrap around. Pass an
 * `arcLengthTable` to look up many distances on one path. Undefined for a
 * path with no vertices.
 */
export function pointAtLength(path: BezierPath | ArcLengthTable, distance: number): PathPoint | undefined {
  const table = "samples" in path ? path : arcLengthTable(path);
  const { samples, total } = table;
  if (samples.length === 0) {
    const v = table.path.vertices[0];
    return v && { point: [v.point[0], v.point[1]], tangent: [1, 0], angle: 0, segmentIndex: -1, t: 0 };
  }
  let d = isFiniteNumber(distance) ? distance : 0;
  if (table.path.closed && total > 0) d = ((d % total) + total) % total;
  else d = Math.min(total, Math.max(0, d));
  // The first sample at or past `d`.
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].at < d) lo = mid + 1;
    else hi = mid;
  }
  const b = samples[lo];
  const a = lo > 0 && samples[lo - 1].segment === b.segment ? samples[lo - 1] : undefined;
  const seg = table.segments[b.segment];
  let t = b.t;
  if (a && b.at > a.at) {
    // Between two samples the curve is as good as straight, but it isn't travelled at an even
    // pace (a segment without handles eases in and out of its ends): find the parameter that
    // far from the first sample, rather than splitting the parameter in proportion.
    const from = pointAt(seg, a.t);
    const want = d - a.at;
    let near = a.t;
    let far = b.t;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      const at = pointAt(seg, mid);
      if (Math.hypot(at[0] - from[0], at[1] - from[1]) < want) near = mid;
      else far = mid;
    }
    t = (near + far) / 2;
  }
  const tangent = directionAt(seg, t);
  return {
    point: pointAt(seg, t),
    tangent,
    angle: Math.atan2(tangent[1], tangent[0]) / RAD,
    segmentIndex: b.segment,
    t,
  };
}

// ---------------------------------------------------------------------------
// Bounds and flattening
// ---------------------------------------------------------------------------

/** Roots in (0, 1) of a·t² + b·t + c. */
function quadraticRoots(a: number, b: number, c: number): number[] {
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** The tight bounding box: vertices plus each segment's extremes (where its derivative is zero). */
export function bounds(path: BezierPath): Rect | undefined {
  if (path.vertices.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (p: Vec2) => {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  };
  for (const v of path.vertices) include(v.point);
  for (const seg of segments(path)) {
    for (const axis of [0, 1]) {
      const [p0, p1, p2, p3] = seg.map((p) => p[axis]);
      const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
      const b = 6 * (p0 - 2 * p1 + p2);
      const c = 3 * (p1 - p0);
      for (const t of quadraticRoots(a, b, c)) include(pointAt(seg, t));
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The path as a polyline no further than `tolerance` from the curve (adaptive
 * subdivision: few points on flat parts, more on tight bends). A closed path's
 * polyline ends on its first point again.
 */
export function flatten(path: BezierPath, tolerance = FLATTEN_TOLERANCE): Vec2[] {
  const vs = path.vertices;
  if (vs.length === 0) return [];
  const out: Vec2[] = [[vs[0].point[0], vs[0].point[1]]];
  for (const seg of segments(path)) {
    const ts = flattenParams(seg, tolerance);
    for (let i = 1; i < ts.length; i++) out.push(ts[i] === 1 ? [seg[3][0], seg[3][1]] : pointAt(seg, ts[i]));
  }
  return out;
}

/** Points without consecutive repeats. */
function withoutRepeats(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (out.length === 0 || !samePoint(out[out.length - 1], p)) out.push(p);
  return out;
}

/** A ring's points without repeats (consecutive or a closing copy of the first). */
function cleanRing(points: readonly Vec2[]): Vec2[] {
  const out = withoutRepeats(points);
  while (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** Twice the signed area (positive when counter-clockwise with y up, clockwise with y down). */
function signedArea2(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s;
}

/** A ring's area, whichever way it winds. */
export function polygonArea(ring: readonly Vec2[]): number {
  return Math.abs(signedArea2(cleanRing(ring))) / 2;
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** How many times `ring` winds around `p` (signed like `signedArea2`). */
function windingNumber(ring: readonly Vec2[], p: Vec2): number {
  let w = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const side = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && side > 0) w++;
    } else if (b[1] <= p[1] && side < 0) w--;
  }
  return w;
}

/** Whether `p` is inside polygons (rings, closing edges implied) under `fillRule`. */
export function polygonContains(polygons: readonly (readonly Vec2[])[], p: Vec2, fillRule: FillRule = "nonzero"): boolean {
  let w = 0;
  for (const ring of polygons) {
    const n = windingNumber(ring, p);
    w += fillRule === "evenodd" ? Math.abs(n) : n;
  }
  return fillRule === "evenodd" ? w % 2 === 1 : w !== 0;
}

/**
 * Whether `point` is in the fill of a path, or of several (a compound path:
 * holes, like several masks on one layer). Open paths fill as if closed,
 * as in After Effects.
 */
export function containsPoint(
  path: BezierPath | readonly BezierPath[],
  point: Vec2,
  fillRule: FillRule = "nonzero",
  tolerance = FLATTEN_TOLERANCE,
): boolean {
  const paths = Array.isArray(path) ? (path as readonly BezierPath[]) : [path as BezierPath];
  return polygonContains(
    paths.map((p) => flatten({ vertices: p.vertices, closed: true }, tolerance)),
    point,
    fillRule,
  );
}

export interface NearestPoint {
  distance: number;
  point: Vec2;
  /** The segment the nearest point is on (-1 when the path has a single vertex and no segment). */
  segmentIndex: number;
  t: number;
}

/**
 * The point on the path's outline nearest `point` (the pen tool inserts a
 * vertex there with `insertVertex(path, segmentIndex, t)`). Undefined for a
 * path with no vertices.
 */
export function distanceToPath(path: BezierPath, point: Vec2): NearestPoint | undefined {
  const segs = segments(path);
  if (segs.length === 0) {
    const v = path.vertices[0];
    return v && { distance: distance(v.point, point), point: [v.point[0], v.point[1]], segmentIndex: -1, t: 0 };
  }
  let best: NearestPoint | undefined;
  const samples = 24;
  segs.forEach((seg, segmentIndex) => {
    // Coarse samples find the right valley; halving steps then walk down it.
    let t = 0;
    let d = Infinity;
    for (let i = 0; i <= samples; i++) {
      const di = distance(pointAt(seg, i / samples), point);
      if (di < d) [d, t] = [di, i / samples];
    }
    for (let step = 1 / samples; step > 1e-9; step /= 2) {
      for (const tt of [t - step, t + step]) {
        if (tt < 0 || tt > 1) continue;
        const dt = distance(pointAt(seg, tt), point);
        if (dt < d) [d, t] = [dt, tt];
      }
    }
    if (!best || d < best.distance) best = { distance: d, point: pointAt(seg, t), segmentIndex, t };
  });
  return best;
}

/** Whether `point` is on a stroke `width` wide along the path (round ends and joins). */
export function hitStroke(path: BezierPath, point: Vec2, width: number): boolean {
  const near = distanceToPath(path, point);
  return near !== undefined && near.distance <= width / 2;
}

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

export type LineJoin = "miter" | "round" | "bevel";
export type LineCap = "butt" | "round" | "square";

export interface StrokeStyle {
  join?: LineJoin;
  cap?: LineCap;
  /** Longest miter, in stroke widths, before it's bevelled (AE's and SVG's default is 4). */
  miterLimit?: number;
  tolerance?: number;
}

/** Points on an arc of `r` around `c` from angle `from` turning by `sweep` (radians), both ends included. */
function arcPoints(c: Vec2, r: number, from: number, sweep: number, tolerance: number): Vec2[] {
  const maxStep = r > tolerance ? 2 * Math.acos(1 - tolerance / r) : Math.PI / 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / Math.min(maxStep, Math.PI / 8)));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + (sweep * i) / steps;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** The ring wound positively (see `signedArea2`). */
const orient = (ring: Vec2[]) => (signedArea2(ring) < 0 ? ring.reverse() : ring);

/**
 * Polygons covering a stroke of `width` along the flattened path: one
 * quadrilateral per polyline edge, plus a piece per join and cap. Each piece
 * is convex and all are wound the same way, so filling them with the nonzero
 * rule (or testing whether a point is in any of them) gives the stroke.
 *
 * Limitations: the pieces overlap, so a translucent stroke must be drawn as
 * one coverage mask (a stencil, or opaque into a layer that's then faded)
 * rather than blending each triangle; joins between the flattening's own
 * short edges are always round-ish whatever `join` says (only the path's
 * corners, where the direction really turns, show a visible miter or bevel);
 * and there's no dashing.
 */
export function strokeOutline(path: BezierPath, width: number, style: StrokeStyle = {}): Vec2[][] {
  const hw = width / 2;
  if (!(hw > 0)) return [];
  const { join = "miter", cap = "butt", miterLimit = 4, tolerance = FLATTEN_TOLERANCE } = style;
  const pts = path.closed ? cleanRing(flatten(path, tolerance)) : withoutRepeats(flatten(path, tolerance));
  const out: Vec2[][] = [];
  if (pts.length === 0) return out;
  if (pts.length === 1) {
    const p = pts[0];
    if (cap === "round") out.push(orient(arcPoints(p, hw, 0, 2 * Math.PI, tolerance).slice(0, -1)));
    else if (cap === "square") out.push(orient(rectRing(p[0] - hw, p[1] - hw, width, width)));
    return out;
  }
  const closed = path.closed && pts.length > 2;
  const n = pts.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    let a = pts[i];
    let b = pts[(i + 1) % n];
    const d = unit(sub(b, a));
    const nrm = scale(perp(d), hw);
    if (!closed && cap === "square") {
      if (i === 0) a = sub(a, scale(d, hw));
      if (i === edges - 1) b = add(b, scale(d, hw));
    }
    out.push(orient([add(a, nrm), add(b, nrm), sub(b, nrm), sub(a, nrm)]));
  }
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const v = pts[i];
    const d0 = unit(sub(v, pts[(i - 1 + n) % n]));
    const d1 = unit(sub(pts[(i + 1) % n], v));
    const turn = cross(d0, d1);
    const along = dot(d0, d1);
    if (Math.abs(turn) < 1e-9 && along > 0) continue;
    // The gap opens on the outside of the turn.
    const s = turn > 0 ? -1 : 1;
    const n0 = scale(perp(d0), s * hw);
    const n1 = scale(perp(d1), s * hw);
    const bevel = [v, add(v, n0), add(v, n1)];
    if (join === "round") {
      const from = Math.atan2(n0[1], n0[0]);
      let sweep = Math.atan2(n1[1], n1[0]) - from;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;
      out.push(orient([v, ...arcPoints(v, hw, from, sweep, tolerance)]));
    } else if (join === "miter" && along > -1 + 1e-9) {
      const ratio = 1 / Math.sqrt((1 + along) / 2);
      if (ratio <= miterLimit) out.push(orient([v, add(v, n0), add(v, scale(unit(add(n0, n1)), hw * ratio)), add(v, n1)]));
      else out.push(orient(bevel));
    } else {
      out.push(orient(bevel));
    }
  }
  if (!closed && cap === "round") {
    const d0 = unit(sub(pts[1], pts[0]));
    const nrm0 = perp(d0);
    out.push(orient(arcPoints(pts[0], hw, Math.atan2(nrm0[1], nrm0[0]), Math.PI, tolerance)));
    const d1 = unit(sub(pts[n - 1], pts[n - 2]));
    const nrm1 = perp(d1);
    out.push(orient(arcPoints(pts[n - 1], hw, Math.atan2(nrm1[1], nrm1[0]), -Math.PI, tolerance)));
  }
  return out;
}

const rectRing = (x: number, y: number, w: number, h: number): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * A vertex added at `t` on segment `segmentIndex` without changing the shape
 * (the pen tool clicking on a path): the segment's neighbours' handles shrink
 * to the halves' and the new vertex gets the handles in between.
 */
export function insertVertex(path: BezierPath, segmentIndex: number, t: number): BezierPath {
  const segs = segments(path);
  const seg = segs[segmentIndex];
  if (!seg || !(t > 0 && t < 1)) return path;
  const [l, r] = splitSegment(seg, t);
  const vs = path.vertices;
  const i = segmentIndex;
  const j = (i + 1) % vs.length;
  const m = l[3];
  const vertices = vs.map((v, k) => {
    if (k === i && k === j) return { ...v, out: sub(l[1], l[0]), in: sub(r[2], r[3]) };
    if (k === i) return { ...v, out: sub(l[1], l[0]) };
    if (k === j) return { ...v, in: sub(r[2], r[3]) };
    return v;
  });
  vertices.splice(i + 1, 0, { point: m, in: sub(l[2], m), out: sub(r[1], m) });
  return { vertices, closed: path.closed };
}

/** The path without vertex `index` (its neighbours join directly, as AE's Delete Vertex does). */
export function removeVertex(path: BezierPath, index: number): BezierPath {
  if (!path.vertices[index]) return path;
  return { vertices: path.vertices.filter((_, k) => k !== index), closed: path.closed };
}

/** Vertex `index` moved to `to`, its handles going with it. */
export function moveVertex(path: BezierPath, index: number, to: Vec2): BezierPath {
  const v = path.vertices[index];
  if (!v || samePoint(v.point, to, 0)) return path;
  return setVertex(path, index, { point: [to[0], to[1]] });
}

/** Vertex `index` with some of its fields replaced (e.g. dragging one handle). */
export function setVertex(path: BezierPath, index: number, patch: Partial<PathVertex>): BezierPath {
  if (!path.vertices[index]) return path;
  return { vertices: path.vertices.map((v, k) => (k === index ? { ...v, ...patch } : v)), closed: path.closed };
}

/** Whether a vertex is a corner: no handle on either side. */
export const isCornerVertex = (v: PathVertex) => v.in[0] === 0 && v.in[1] === 0 && v.out[0] === 0 && v.out[1] === 0;

/**
 * Vertex `index` turned from a corner into a smooth point or back (After Effects' Convert
 * Vertex tool): smooth, its handles run along the line between its neighbours, a third of
 * the way towards each.
 */
export function toggleSmooth(path: BezierPath, index: number): BezierPath {
  const vs = path.vertices;
  const v = vs[index];
  if (!v) return path;
  if (!isCornerVertex(v)) return setVertex(path, index, { in: [0, 0], out: [0, 0] });
  const n = vs.length;
  const prev = path.closed ? vs[(index - 1 + n) % n] : vs[index - 1];
  const next = path.closed ? vs[(index + 1) % n] : vs[index + 1];
  const a = prev?.point ?? v.point;
  const b = next?.point ?? v.point;
  const dir = unit(sub(b, a));
  if (dir[0] === 0 && dir[1] === 0) return path;
  return setVertex(path, index, {
    in: prev ? scale(dir, -distance(v.point, prev.point) / 3) : [0, 0],
    out: next ? scale(dir, distance(v.point, next.point) / 3) : [0, 0],
  });
}

/**
 * One handle of vertex `index` dragged to `handle` (relative to the vertex). With `mirror`
 * the other handle stays opposite it, keeping its own length (or taking this one's, when it
 * had none): a smooth point. Without, the other handle is left alone (a cusp).
 */
export function setHandle(path: BezierPath, index: number, side: "in" | "out", handle: Vec2, mirror: boolean): BezierPath {
  const v = path.vertices[index];
  if (!v) return path;
  const other = side === "in" ? "out" : "in";
  const patch: Partial<PathVertex> = { [side]: [handle[0], handle[1]] };
  if (mirror) {
    const reach = length(v[other]) || length(handle);
    patch[other] = scale(unit(handle), -reach);
  }
  return setVertex(path, index, patch);
}

/** Several vertices moved by `delta`, their handles going with them. */
export function moveVertices(path: BezierPath, indices: readonly number[], delta: Vec2): BezierPath {
  if ((delta[0] === 0 && delta[1] === 0) || indices.length === 0) return path;
  return { vertices: path.vertices.map((v, k) => (indices.includes(k) ? { ...v, point: add(v.point, delta) } : v)), closed: path.closed };
}

/** The path without the vertices `indices` (see `removeVertex`). */
export function removeVertices(path: BezierPath, indices: readonly number[]): BezierPath {
  if (!indices.some((i) => path.vertices[i])) return path;
  return { vertices: path.vertices.filter((_, k) => !indices.includes(k)), closed: path.closed };
}

/** The same shape drawn the other way (a closed path keeps its first vertex first). */
export function reversePath(path: BezierPath): BezierPath {
  const vs = path.vertices;
  if (vs.length < 2) return path;
  const order = path.closed ? [vs[0], ...vs.slice(1).reverse()] : [...vs].reverse();
  return { vertices: order.map((v) => ({ point: v.point, in: v.out, out: v.in })), closed: path.closed };
}

/** The path through an affine map (handles, being relative, only through its linear part). */
export function transformPath(path: BezierPath, m: PathAffine): BezierPath {
  const [a, b, c, d, e, f] = m;
  const lin = (p: Vec2): Vec2 => [a * p[0] + c * p[1], b * p[0] + d * p[1]];
  return {
    vertices: path.vertices.map((v) => {
      const p = lin(v.point);
      return { point: [p[0] + e, p[1] + f], in: lin(v.in), out: lin(v.out) };
    }),
    closed: path.closed,
  };
}

// ---------------------------------------------------------------------------
// Interpolation (path keyframes)
// ---------------------------------------------------------------------------

/**
 * The same shape with `count` vertices: new ones split the longest segments
 * first (at their middle parameter), so the path looks the same but can
 * morph into a path with more vertices.
 */
export function resamplePath(path: BezierPath, count: number): BezierPath {
  if (path.vertices.length === 0 || path.vertices.length >= count) return path;
  let result = path;
  const lengths = segments(path).map((s) => segmentLength(s, 0.1));
  while (result.vertices.length < count) {
    if (lengths.length === 0) {
      // A single vertex has no segment to split: stack copies of it.
      const last = result.vertices[result.vertices.length - 1];
      result = { vertices: [...result.vertices, { ...last }], closed: result.closed };
      continue;
    }
    let longest = 0;
    for (let i = 1; i < lengths.length; i++) if (lengths[i] > lengths[longest]) longest = i;
    const [l, r] = splitSegment(segments(result)[longest], 0.5);
    result = insertVertex(result, longest, 0.5);
    lengths.splice(longest, 1, segmentLength(l, 0.1), segmentLength(r, 0.1));
  }
  return result;
}

/**
 * The path `f` of the way (0..1) from `a` to `b`, vertex by vertex (points and
 * handles). When the counts differ the one with fewer vertices is resampled
 * first (`resamplePath`), so neither end changes shape.
 */
export function lerpPath(a: BezierPath, b: BezierPath, f: number): BezierPath {
  if (a.vertices.length === 0 || b.vertices.length === 0) return f < 0.5 ? a : b;
  const count = Math.max(a.vertices.length, b.vertices.length);
  const from = resamplePath(a, count);
  const to = resamplePath(b, count);
  return {
    vertices: from.vertices.map((v, i) => {
      const w = to.vertices[i];
      return { point: mix(v.point, w.point, f), in: mix(v.in, w.in, f), out: mix(v.out, w.out, f) };
    }),
    closed: f < 0.5 ? a.closed : b.closed,
  };
}

/** Whether two paths are the same (every coordinate within `eps`). */
export function samePath(a: BezierPath, b: BezierPath, eps = 1e-9): boolean {
  if (a === b) return true;
  if (a.closed !== b.closed || a.vertices.length !== b.vertices.length) return false;
  return a.vertices.every((v, i) => {
    const w = b.vertices[i];
    return samePoint(v.point, w.point, eps) && samePoint(v.in, w.in, eps) && samePoint(v.out, w.out, eps);
  });
}

// ---------------------------------------------------------------------------
// Triangulation
// ---------------------------------------------------------------------------

export type Triangle = [Vec2, Vec2, Vec2];

/** Whether `p` is in triangle a–b–c (wound positively), edges included. */
function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  return cross(sub(b, a), sub(p, a)) >= 0 && cross(sub(c, b), sub(p, b)) >= 0 && cross(sub(a, c), sub(p, c)) >= 0;
}

/**
 * Join a hole (wound negatively) into an outer ring (wound positively) with a
 * two-way bridge from the hole's rightmost vertex to a vertex of the ring it
 * can see (Eberly's method), leaving one weakly simple ring.
 */
function bridgeHole(outer: Vec2[], hole: Vec2[]): Vec2[] {
  let hm = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i][0] > hole[hm][0]) hm = i;
  const m = hole[hm];
  // The nearest edge a ray from m towards +x hits.
  let hitX = Infinity;
  let candidate = -1;
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a[1] === b[1] || (a[1] > m[1] && b[1] > m[1]) || (a[1] < m[1] && b[1] < m[1])) continue;
    const x = a[0] + ((m[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    if (x < m[0] || x >= hitX) continue;
    hitX = x;
    candidate = a[0] > b[0] ? i : (i + 1) % outer.length;
    if (x === a[0] && m[1] === a[1]) candidate = i;
    else if (x === b[0] && m[1] === b[1]) candidate = (i + 1) % outer.length;
  }
  if (candidate < 0) return outer;
  const hit: Vec2 = [hitX, m[1]];
  const p = outer[candidate];
  if (!samePoint(p, hit)) {
    // A reflex vertex inside m–hit–p would block the view: take the one closest in angle to the ray.
    const [ta, tb, tc] = signedArea2([m, hit, p]) >= 0 ? [m, hit, p] : [m, p, hit];
    let bestTan = Infinity;
    for (let i = 0; i < outer.length; i++) {
      const v = outer[i];
      if (i === candidate || samePoint(v, m)) continue;
      const prev = outer[(i - 1 + outer.length) % outer.length];
      const next = outer[(i + 1) % outer.length];
      if (cross(sub(v, prev), sub(next, v)) >= 0 || !inTriangle(v, ta, tb, tc)) continue;
      const tan = Math.abs(v[1] - m[1]) / Math.max(1e-12, v[0] - m[0]);
      if (tan < bestTan || (tan === bestTan && v[0] < outer[candidate][0])) {
        bestTan = tan;
        candidate = i;
      }
    }
  }
  const loop = [...hole.slice(hm), ...hole.slice(0, hm), hole[hm]];
  return [...outer.slice(0, candidate + 1), ...loop, outer[candidate], ...outer.slice(candidate + 1)];
}

/** Ear clipping of one (weakly) simple ring wound positively. */
function earClip(ring: Vec2[], out: Triangle[]) {
  const n = ring.length;
  const next = ring.map((_, i) => (i + 1) % n);
  const prev = ring.map((_, i) => (i - 1 + n) % n);
  let remaining = n;
  let i = 0;
  let misses = 0;
  const remove = (k: number) => {
    next[prev[k]] = next[k];
    prev[next[k]] = prev[k];
    remaining--;
    misses = 0;
  };
  const isEar = (p: number, k: number, q: number) => {
    const [a, b, c] = [ring[p], ring[k], ring[q]];
    for (let j = next[q]; j !== p; j = next[j]) {
      const v = ring[j];
      if (samePoint(v, a) || samePoint(v, b) || samePoint(v, c)) continue;
      if (inTriangle(v, a, b, c)) return false;
    }
    return true;
  };
  while (remaining > 3) {
    const p = prev[i];
    const q = next[i];
    const turn = cross(sub(ring[i], ring[p]), sub(ring[q], ring[i]));
    if (Math.abs(turn) < 1e-12) {
      // Collinear or a spike: nothing to fill there.
      remove(i);
      i = q;
    } else if (turn > 0 && isEar(p, i, q)) {
      out.push([ring[p], ring[i], ring[q]]);
      remove(i);
      i = q;
    } else if (++misses > remaining) {
      // No ear: the ring isn't simple (self-intersecting). Clip anyway so it ends.
      if (turn > 0) out.push([ring[p], ring[i], ring[q]]);
      remove(i);
      i = q;
    } else {
      i = q;
    }
  }
  if (remaining === 3) {
    const [a, b, c] = [ring[prev[i]], ring[i], ring[next[i]]];
    if (signedArea2([a, b, c]) > 1e-12) out.push([a, b, c]);
  }
}

/**
 * Triangles filling polygons (flattened paths, a closing edge implied) under
 * `fillRule`, for drawing a fill on the GPU (`.flat(2)` is the vertex data).
 * Each ring is an outer boundary or a hole depending on whether the fill
 * changes across it; holes are bridged into the ring around them and the
 * result is ear-clipped. Triangles are wound positively (see `polygonArea`).
 *
 * Rings must be simple and must not cross each other: fill self-intersecting
 * paths with a stencil instead (draw a fan of every ring into the stencil,
 * counting windings, then cover where the rule says).
 */
export function triangulate(polygons: readonly (readonly Vec2[])[], fillRule: FillRule = "nonzero"): Triangle[] {
  const rings = polygons.map(cleanRing).filter((r) => r.length >= 3 && Math.abs(signedArea2(r)) > 1e-12);
  const filled = (w: number) => (fillRule === "evenodd" ? Math.abs(w) % 2 === 1 : w !== 0);
  const outers: { ring: Vec2[]; area: number; holes: Vec2[][] }[] = [];
  const holes: Vec2[][] = [];
  rings.forEach((ring, i) => {
    const probe = ring[0];
    let outside = 0;
    rings.forEach((other, j) => {
      if (j === i) return;
      const w = windingNumber(other, probe);
      outside += fillRule === "evenodd" ? (w !== 0 ? 1 : 0) : w;
    });
    const inside = outside + (fillRule === "evenodd" ? 1 : Math.sign(signedArea2(ring)));
    if (filled(inside) && !filled(outside)) {
      outers.push({ ring: orient([...ring]), area: Math.abs(signedArea2(ring)), holes: [] });
    } else if (!filled(inside) && filled(outside)) {
      holes.push(signedArea2(ring) > 0 ? [...ring].reverse() : [...ring]);
    }
  });
  for (const hole of holes) {
    let owner: (typeof outers)[number] | undefined;
    for (const o of outers) {
      if (windingNumber(o.ring, hole[0]) !== 0 && (!owner || o.area < owner.area)) owner = o;
    }
    owner?.holes.push(hole);
  }
  const out: Triangle[] = [];
  for (const o of outers) {
    const maxX = (r: Vec2[]) => Math.max(...r.map((p) => p[0]));
    let ring = o.ring;
    for (const hole of [...o.holes].sort((a, b) => maxX(b) - maxX(a))) ring = bridgeHole(ring, hole);
    earClip(ring, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const sanitizeVec2 = (raw: unknown): Vec2 | undefined =>
  Array.isArray(raw) && raw.length === 2 && isFiniteNumber(raw[0]) && isFiniteNumber(raw[1]) ? [raw[0], raw[1]] : undefined;

/**
 * A valid path from untrusted storage: vertices without a finite point are
 * dropped and bad handles become corners. Undefined when no vertex is left.
 */
export function sanitizePath(raw: unknown): BezierPath | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { vertices, closed } = raw as { vertices?: unknown; closed?: unknown };
  if (!Array.isArray(vertices)) return undefined;
  const out: PathVertex[] = [];
  for (const v of vertices) {
    if (!v || typeof v !== "object") continue;
    const point = sanitizeVec2((v as PathVertex).point);
    if (!point) continue;
    out.push({ point, in: sanitizeVec2((v as PathVertex).in) ?? [0, 0], out: sanitizeVec2((v as PathVertex).out) ?? [0, 0] });
  }
  return out.length > 0 ? { vertices: out, closed: closed === true } : undefined;
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const fmt = (v: number) => String(Math.round(v * 1e6) / 1e6 + 0);
const fmtPoint = (p: Vec2) => `${fmt(p[0])} ${fmt(p[1])}`;
const isLine = (seg: Segment) => samePoint(seg[1], seg[0], 0) && samePoint(seg[2], seg[3], 0);

/** SVG path data (`d`) for one path or several (a compound path). Coordinates are rounded to 6 decimals. */
export function toSvgPathData(path: BezierPath | readonly BezierPath[]): string {
  const paths = Array.isArray(path) ? (path as readonly BezierPath[]) : [path as BezierPath];
  const parts: string[] = [];
  for (const p of paths) {
    if (p.vertices.length === 0) continue;
    parts.push(`M${fmtPoint(p.vertices[0].point)}`);
    const segs = segments(p);
    segs.forEach((seg, i) => {
      const closing = p.closed && i === segs.length - 1;
      if (closing && isLine(seg)) return;
      parts.push(isLine(seg) ? `L${fmtPoint(seg[3])}` : `C${fmtPoint(seg[1])} ${fmtPoint(seg[2])} ${fmtPoint(seg[3])}`);
    });
    if (p.closed) parts.push("Z");
  }
  return parts.join(" ");
}

/** Cubic control triples [c1, c2, end] for an SVG elliptical arc (SVG 1.1 F.6.5), at most 90° each. */
function arcToCubics(
  p0: Vec2,
  rxIn: number,
  ryIn: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Vec2,
): [Vec2, Vec2, Vec2][] {
  if (samePoint(p0, p1, 0)) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = rotation * RAD;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1) / ry;
  const cyp = (-coef * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const angle = (u: Vec2, v: Vec2) => Math.atan2(cross(u, v), dot(u, v));
  const start: Vec2 = [(x1 - cxp) / rx, (y1 - cyp) / ry];
  const theta1 = angle([1, 0], start);
  let delta = angle(start, [(-x1 - cxp) / rx, (-y1 - cyp) / ry]);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const map = (u: Vec2): Vec2 => [cx + rx * cos * u[0] - ry * sin * u[1], cy + rx * sin * u[0] + ry * cos * u[1]];
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < n; i++) {
    const a1 = theta1 + i * step;
    const a2 = a1 + step;
    const e1: Vec2 = [Math.cos(a1), Math.sin(a1)];
    const e2: Vec2 = [Math.cos(a2), Math.sin(a2)];
    out.push([
      map([e1[0] - k * e1[1], e1[1] + k * e1[0]]),
      map([e2[0] + k * e2[1], e2[1] - k * e2[0]]),
      i === n - 1 ? [p1[0], p1[1]] : map(e2),
    ]);
  }
  return out;
}

const ARG_COUNTS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

/**
 * Paths from SVG path data: every command (absolute and relative), with
 * quadratics raised to cubics and arcs split into cubics. Like a browser, it
 * keeps what was drawn before a syntax error. Subpaths that draw nothing (a
 * lone moveto) are left out. A closepath that lands on the subpath's start
 * merges the two vertices, so a closed path doesn't get a zero-length side.
 */
export function parseSvgPathData(d: string): BezierPath[] {
  const paths: BezierPath[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = (): number | undefined => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return undefined;
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): number | undefined => {
    skip();
    if (d[i] === "0" || d[i] === "1") return Number(d[i++]);
    return undefined;
  };

  let current: PathVertex[] | undefined;
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let lastCubic: Vec2 | undefined;
  let lastQuad: Vec2 | undefined;
  const finish = (closed: boolean) => {
    if (!current) return;
    if (closed && current.length > 1 && samePoint(current[0].point, current[current.length - 1].point)) {
      current[0].in = current[current.length - 1].in;
      current.pop();
    }
    if (current.length > 1) paths.push({ vertices: current, closed });
    current = undefined;
  };
  const vertices = () => (current ??= [corner(start)]);
  const lineTo = (p: Vec2) => {
    vertices().push(corner(p));
    cur = p;
  };
  const cubicTo = (c1: Vec2, c2: Vec2, p: Vec2) => {
    const vs = vertices();
    const last = vs[vs.length - 1];
    last.out = sub(c1, last.point);
    vs.push({ point: p, in: sub(c2, p), out: [0, 0] });
    cur = p;
  };

  let command: string | undefined;
  let started = false;
  outer: while (true) {
    skip();
    if (i >= d.length) break;
    const c = d[i];
    if (/[a-zA-Z]/.test(c)) {
      if (!(c.toLowerCase() in ARG_COUNTS)) break;
      command = c;
      i++;
    } else if (!command || command.toLowerCase() === "z") {
      break;
    }
    if (!command) break;
    const lower = command.toLowerCase();
    const rel = command !== command.toUpperCase();
    // Path data must start with a moveto.
    if (!started && lower !== "m") break;
    started = true;
    const args: number[] = [];
    for (let k = 0; k < ARG_COUNTS[lower]; k++) {
      const v = lower === "a" && (k === 3 || k === 4) ? flag() : number();
      if (v === undefined) break outer;
      args.push(v);
    }
    const at = (x: number, y: number): Vec2 => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    let cubicCtrl: Vec2 | undefined;
    let quadCtrl: Vec2 | undefined;
    switch (lower) {
      case "m": {
        finish(false);
        const p = at(args[0], args[1]);
        start = p;
        cur = p;
        current = [corner(p)];
        // Further pairs are linetos.
        command = rel ? "l" : "L";
        break;
      }
      case "l":
        lineTo(at(args[0], args[1]));
        break;
      case "h":
        lineTo([rel ? cur[0] + args[0] : args[0], cur[1]]);
        break;
      case "v":
        lineTo([cur[0], rel ? cur[1] + args[0] : args[0]]);
        break;
      case "c": {
        const c2 = at(args[2], args[3]);
        cubicTo(at(args[0], args[1]), c2, at(args[4], args[5]));
        cubicCtrl = c2;
        break;
      }
      case "s": {
        const c1: Vec2 = lastCubic ? sub(scale(cur, 2), lastCubic) : cur;
        const c2 = at(args[0], args[1]);
        cubicTo(c1, c2, at(args[2], args[3]));
        cubicCtrl = c2;
        break;
      }
      case "q":
      case "t": {
        const q = lower === "q" ? at(args[0], args[1]) : lastQuad ? sub(scale(cur, 2), lastQuad) : cur;
        const p = lower === "q" ? at(args[2], args[3]) : at(args[0], args[1]);
        const p0 = cur;
        cubicTo(mix(p0, q, 2 / 3), mix(p, q, 2 / 3), p);
        quadCtrl = q;
        break;
      }
      case "a": {
        const p = at(args[5], args[6]);
        // An arc without a radius is a straight line (SVG's rule).
        if (args[0] === 0 || args[1] === 0) lineTo(p);
        else for (const [c1, c2, end] of arcToCubics(cur, args[0], args[1], args[2], args[3] === 1, args[4] === 1, p)) cubicTo(c1, c2, end);
        cur = p;
        break;
      }
      case "z":
        finish(true);
        cur = start;
        break;
    }
    lastCubic = cubicCtrl;
    lastQuad = quadCtrl;
  }
  finish(false);
  return paths;
}
