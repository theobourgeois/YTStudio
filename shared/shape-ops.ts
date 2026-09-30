/**
 * After Effects' shape-layer operators over Bézier paths (`path.ts`): Merge
 * Paths, Trim Paths, Offset Paths, Zig Zag, Wiggle Paths and Round Corners.
 * A shape layer runs its paths through these, in order, before it's filled
 * and stroked, so the preview and the export get the same outlines.
 *
 * Coordinates are px with y down. Everything is pure: each operator returns
 * new paths (the same instance when it changes nothing) and never touches its
 * input.
 */
import {
  type ArcLengthTable,
  type BezierPath,
  type LineJoin,
  type PathVertex,
  type Segment,
  type Vec2,
  FLATTEN_TOLERANCE,
  KAPPA,
  arcLengthTable,
  flatten,
  pointAt,
  polygonContains,
  polygonPath,
  segmentLength,
  segments,
  splitSegment,
  strokeOutline,
  tangentAt,
} from "./path.ts";

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
/** (Adding 0 keeps -0 out of the results.) */
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k + 0, a[1] * k + 0];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const length = (a: Vec2) => Math.hypot(a[0], a[1]);
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a: Vec2): Vec2 => {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Rotated a quarter turn: the side a positively wound ring's inside is on (see `signedArea2`). */
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
const copy = (a: Vec2): Vec2 => [a[0], a[1]];
const isZero = (a: Vec2) => a[0] === 0 && a[1] === 0;
const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// ---------------------------------------------------------------------------
// Measuring along a segment
// ---------------------------------------------------------------------------

/** A lone segment as an open path, to measure it with `arcLengthTable`. */
const segmentPath = (seg: Segment): BezierPath => ({
  vertices: [
    { point: seg[0], in: [0, 0], out: sub(seg[1], seg[0]) },
    { point: seg[3], in: sub(seg[2], seg[3]), out: [0, 0] },
  ],
  closed: false,
});

/**
 * The parameter at length `d` along a measured path, and the segment it's on. The table's samples bracket it on
 * a piece that's flat to the measuring tolerance; but a cubic's parameter isn't its length (even a straight one
 * eases in and out of its ends), so within the piece it's found by halving on the distance from the piece's start.
 */
function locate(table: ArcLengthTable, d: number): { segment: number; t: number } {
  const { samples } = table;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].at < d) lo = mid + 1;
    else hi = mid;
  }
  const b = samples[lo];
  const a = lo > 0 && samples[lo - 1].segment === b.segment ? samples[lo - 1] : undefined;
  if (!a || !(b.at > a.at) || d >= b.at) return { segment: b.segment, t: b.t };
  if (d <= a.at) return { segment: b.segment, t: a.t };
  const seg = table.segments[b.segment];
  const origin = pointAt(seg, a.t);
  // The piece's chord stands in for its length; scale the target so the two ends still match.
  const target = ((d - a.at) / (b.at - a.at)) * distance(origin, pointAt(seg, b.t));
  let t0 = a.t;
  let t1 = b.t;
  for (let i = 0; i < 40; i++) {
    const mid = (t0 + t1) / 2;
    if (distance(origin, pointAt(seg, mid)) < target) t0 = mid;
    else t1 = mid;
  }
  return { segment: b.segment, t: (t0 + t1) / 2 };
}

/** The unit direction of travel at `t`, even where the derivative vanishes (a handle-less end). */
function directionAt(seg: Segment, t: number): Vec2 {
  const d = tangentAt(seg, t);
  if (length(d) > 1e-12) return unit(d);
  const h = 1e-4;
  const around = sub(pointAt(seg, Math.min(1, t + h)), pointAt(seg, Math.max(0, t - h)));
  if (length(around) > 1e-15) return unit(around);
  const chord = sub(seg[3], seg[0]);
  return length(chord) > 0 ? unit(chord) : [1, 0];
}

// ---------------------------------------------------------------------------
// Merge Paths (polygon booleans)
// ---------------------------------------------------------------------------

export type MergeMode = "merge" | "add" | "subtract" | "intersect" | "exclude";

/** Twice the signed area, signed like path.ts: positive when clockwise with y down. */
function signedArea2(ring: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s;
}

/** A ring's points without repeats (consecutive or a closing copy of the first). */
function cleanRing(points: readonly Vec2[]): Vec2[] {
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9;
  const out: Vec2[] = [];
  for (const p of points) if (out.length === 0 || !same(out[out.length - 1], p)) out.push(p);
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop();
  return out;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(points: readonly Vec2[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    if (p[0] < box.minX) box.minX = p[0];
    if (p[1] < box.minY) box.minY = p[1];
    if (p[0] > box.maxX) box.maxX = p[0];
    if (p[1] > box.maxY) box.maxY = p[1];
  }
  return box;
}

/** An input edge, and the vertices found on it (where other edges cross, touch or overlap it). */
interface Edge {
  a: number;
  b: number;
  pa: Vec2;
  pb: Vec2;
  box: Box;
  cuts: { t: number; id: number }[];
}

/**
 * The boolean of rings (each filled with the nonzero rule on its own) as
 * simple rings: outer boundaries wound positively, holes negatively.
 *
 * Every edge is split wherever another touches it, so the plane's boundaries
 * are made of whole sub-edges; a sub-edge belongs to the result when the
 * mode's predicate differs just either side of it. Testing sides rather than
 * tracking windings is what makes coincident edges (shapes sharing a side, a
 * stroke's overlapping pieces) come out right: they're one sub-edge, judged
 * once.
 */
function booleanRings(rings: readonly (readonly Vec2[])[], mode: MergeMode): Vec2[][] {
  const all = rings.flat();
  if (all.length === 0) return [];
  const world = boxOf(all);
  let size = Math.max(1, world.maxX - world.minX, world.maxY - world.minY);
  for (const p of all) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
  /** Points closer than this are one vertex. */
  const tol = 1e-9 * size;
  /** How far off a sub-edge its two sides are probed. */
  const eps = 1e-7 * size;

  // Vertices, snapped together on a grid of `tol` cells.
  const points: Vec2[] = [];
  const grid = new Map<string, number[]>();
  const cell = tol * 2;
  const vertex = (p: Vec2): number => {
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${ix + dx},${iy + dy}`);
        if (!bucket) continue;
        for (const id of bucket) if (distance(points[id], p) <= tol) return id;
      }
    }
    const id = points.length;
    points.push(p);
    const key = `${ix},${iy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(id);
    else grid.set(key, [id]);
    return id;
  };

  const edges: Edge[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const ids = ring.map(vertex);
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i];
      const b = ids[(i + 1) % ids.length];
      if (a === b) continue;
      const pa = points[a];
      const pb = points[b];
      edges.push({ a, b, pa, pb, box: boxOf([pa, pb]), cuts: [] });
    }
  }

  /** Cut `e` at vertex `id` if it lies on it, strictly between its ends. */
  const touch = (e: Edge, id: number) => {
    if (id === e.a || id === e.b) return;
    const r = sub(e.pb, e.pa);
    const p = points[id];
    const t = dot(sub(p, e.pa), r) / dot(r, r);
    if (!(t > 0 && t < 1)) return;
    if (distance(p, add(e.pa, scale(r, t))) <= tol) e.cuts.push({ t, id });
  };
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const f = edges[j];
      if (
        e.box.minX > f.box.maxX + tol ||
        f.box.minX > e.box.maxX + tol ||
        e.box.minY > f.box.maxY + tol ||
        f.box.minY > e.box.maxY + tol
      ) {
        continue;
      }
      // Ends lying on the other edge: T-junctions and collinear overlaps.
      touch(e, f.a);
      touch(e, f.b);
      touch(f, e.a);
      touch(f, e.b);
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      // A proper crossing.
      const r = sub(e.pb, e.pa);
      const s = sub(f.pb, f.pa);
      const denom = cross(r, s);
      if (Math.abs(denom) <= 1e-14 * length(r) * length(s)) continue;
      const between = sub(f.pa, e.pa);
      const t = cross(between, s) / denom;
      const u = cross(between, r) / denom;
      if (!(t > 0 && t < 1 && u > 0 && u < 1)) continue;
      const id = vertex(add(e.pa, scale(r, t)));
      if (id !== e.a && id !== e.b) e.cuts.push({ t, id });
      if (id !== f.a && id !== f.b) f.cuts.push({ t: u, id });
    }
  }

  // Sub-edges, one per pair of vertices however many rings run along it.
  const count = points.length;
  const seen = new Set<number>();
  const subEdges: [number, number][] = [];
  for (const e of edges) {
    e.cuts.sort((x, y) => x.t - y.t);
    let prev = e.a;
    for (const id of [...e.cuts.map((c) => c.id), e.b]) {
      if (id === prev) continue;
      const key = prev < id ? prev * count + id : id * count + prev;
      if (!seen.has(key)) {
        seen.add(key);
        subEdges.push([prev, id]);
      }
      prev = id;
    }
  }

  const boxes = rings.map(boxOf);
  const within = (i: number, p: Vec2): boolean => {
    const ring = rings[i];
    const box = boxes[i];
    if (ring.length < 3 || p[0] < box.minX || p[0] > box.maxX || p[1] < box.minY || p[1] > box.maxY) return false;
    return polygonContains([ring], p, "nonzero");
  };
  const inside = (p: Vec2): boolean => {
    switch (mode) {
      case "merge":
      case "add":
        for (let i = 0; i < rings.length; i++) if (within(i, p)) return true;
        return false;
      case "intersect":
        for (let i = 0; i < rings.length; i++) if (!within(i, p)) return false;
        return rings.length > 0;
      case "subtract":
        if (!within(0, p)) return false;
        for (let i = 1; i < rings.length; i++) if (within(i, p)) return false;
        return true;
      case "exclude": {
        let odd = false;
        for (let i = 0; i < rings.length; i++) if (within(i, p)) odd = !odd;
        return odd;
      }
    }
  };

  // The result's boundary: sub-edges with the result on one side only, directed so it's on the `perp` side.
  const from: number[] = [];
  const to: number[] = [];
  const outgoing = new Map<number, number[]>();
  for (const [a, b] of subEdges) {
    const pa = points[a];
    const pb = points[b];
    const mid: Vec2 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    const normal = scale(perp(unit(sub(pb, pa))), eps);
    const near = inside(add(mid, normal));
    const far = inside(sub(mid, normal));
    if (near === far) continue;
    const [u, v] = near ? [a, b] : [b, a];
    const index = from.length;
    from.push(u);
    to.push(v);
    const list = outgoing.get(u);
    if (list) list.push(index);
    else outgoing.set(u, [index]);
  }

  // Stitch them into rings. Where several leave a vertex (shapes touching at a point), take the one turning
  // most tightly towards the inside, so each ring walks around one piece and rings never cross.
  const used = new Uint8Array(from.length);
  const pick = (at: number, arriving: number): number | undefined => {
    const d = sub(points[to[arriving]], points[from[arriving]]);
    let best: number | undefined;
    let bestTurn = -Infinity;
    for (const e of outgoing.get(at) ?? []) {
      if (used[e]) continue;
      const g = sub(points[to[e]], points[from[e]]);
      const turn = Math.atan2(cross(d, g), dot(d, g));
      if (turn > bestTurn) {
        bestTurn = turn;
        best = e;
      }
    }
    return best;
  };
  const found: number[][] = [];
  for (let start = 0; start < from.length; start++) {
    if (used[start]) continue;
    const walked = [from[start]];
    const taken: number[] = [];
    const position = new Map<number, number>([[from[start], 0]]);
    let next: number | undefined = start;
    while (next !== undefined) {
      used[next] = 1;
      taken.push(next);
      const v = to[next];
      const at = position.get(v);
      if (at !== undefined) {
        // Back on the walk: what's been walked since is a ring.
        found.push(walked.slice(at));
        for (let k = at + 1; k < walked.length; k++) position.delete(walked[k]);
        walked.length = at + 1;
        taken.length = at;
      } else {
        position.set(v, walked.length);
        walked.push(v);
      }
      next = undefined;
      while (taken.length > 0) {
        next = pick(walked[walked.length - 1], taken[taken.length - 1]);
        if (next !== undefined) break;
        // A dead end (a sliver thinner than the probes): drop that edge and carry on from before it.
        position.delete(walked[walked.length - 1]);
        walked.pop();
        taken.pop();
      }
    }
  }

  const out: Vec2[][] = [];
  for (const ids of found) {
    const ring = withoutCollinear(ids.map((id) => points[id]), tol * 4);
    if (ring.length >= 3 && Math.abs(signedArea2(ring)) > 1e-9 * size * size) out.push(ring.map(copy));
  }
  return out;
}

/** A ring without the points that lie on the line between their neighbours (within `tol`), spikes included. */
function withoutCollinear(ring: Vec2[], tol: number): Vec2[] {
  let points = ring;
  for (let changed = true; changed && points.length >= 3; ) {
    changed = false;
    const kept: Vec2[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = kept.length > 0 ? kept[kept.length - 1] : points[points.length - 1];
      const b = points[i];
      const c = points[(i + 1) % points.length];
      const chord = sub(c, a);
      const l = length(chord);
      const off = l > 0 ? Math.abs(cross(sub(b, a), chord)) / l : distance(a, b);
      if (off <= tol) changed = true;
      else kept.push(b);
    }
    points = kept;
  }
  return points;
}

/**
 * AE's Merge Paths over closed paths (open ones are treated as closed). "merge" and "add" are the union of all,
 * "subtract" the first minus every other, "intersect" what's common to all, and "exclude" where an odd number
 * overlap (xor). Returns the result's boundary as closed polygon paths (corner vertices): outer rings wound
 * positively (clockwise with y down) and holes the other way, so a nonzero fill shows the holes.
 * `tolerance` is the flattening tolerance in px.
 */
export function mergePaths(paths: readonly BezierPath[], mode: MergeMode, tolerance = FLATTEN_TOLERANCE): BezierPath[] {
  const rings = paths.map((path) => cleanRing(flatten({ vertices: path.vertices, closed: true }, tolerance)));
  return booleanRings(rings, mode).map((ring) => polygonPath(ring, true));
}

// ---------------------------------------------------------------------------
// Trim Paths
// ---------------------------------------------------------------------------

/** An open path drawing a chain of segments (each starting where the last ended). */
function pathOfSegments(chain: readonly Segment[]): BezierPath {
  const vertices: PathVertex[] = chain.map((seg, i) => ({
    point: copy(seg[0]),
    in: i > 0 ? sub(chain[i - 1][2], chain[i - 1][3]) : [0, 0],
    out: sub(seg[1], seg[0]),
  }));
  const last = chain[chain.length - 1];
  vertices.push({ point: copy(last[3]), in: sub(last[2], last[3]), out: [0, 0] });
  return { vertices, closed: false };
}

/** The part of a measured path between lengths `lo` and `hi`, as an open path of true curves. */
function piece(table: ArcLengthTable, lo: number, hi: number): BezierPath {
  const segs = table.segments;
  const from = locate(table, lo);
  const to = locate(table, hi);
  // A boundary between segments belongs to the later one at the start and the earlier one at the end.
  if (from.t >= 1 - 1e-12 && from.segment < segs.length - 1) {
    from.segment++;
    from.t = 0;
  }
  if (to.t <= 1e-12 && to.segment > from.segment) {
    to.segment--;
    to.t = 1;
  }
  const head = (seg: Segment, t: number) => (t >= 1 ? seg : splitSegment(seg, t)[0]);
  const tail = (seg: Segment, t: number) => (t <= 0 ? seg : splitSegment(seg, t)[1]);
  const chain: Segment[] = [];
  if (from.segment === to.segment) {
    const left = head(segs[from.segment], to.t);
    chain.push(tail(left, to.t > 0 ? Math.min(1, from.t / to.t) : 0));
  } else {
    chain.push(tail(segs[from.segment], from.t));
    for (let i = from.segment + 1; i < to.segment; i++) chain.push(segs[i]);
    chain.push(head(segs[to.segment], to.t));
  }
  return pathOfSegments(chain);
}

/** What's left of one path when only `ranges` (of its length, ascending) are kept. */
function cut(path: BezierPath, table: ArcLengthTable, ranges: readonly [number, number][]): BezierPath[] {
  const total = table.total;
  const tiny = 1e-9 * Math.max(1, total);
  const kept = ranges
    .map(([lo, hi]): [number, number] => [lo <= tiny ? 0 : lo, hi >= total - tiny ? total : hi])
    .filter(([lo, hi]) => hi - lo > tiny);
  if (kept.some(([lo, hi]) => lo === 0 && hi === total)) return [path];
  if (path.closed && kept.length === 2 && kept[0][0] === 0 && kept[1][1] === total) {
    // The kept part runs past the end of a closed path: one piece through its start vertex.
    const before = piece(table, kept[1][0], total);
    const after = piece(table, 0, kept[0][1]);
    const seam = before.vertices[before.vertices.length - 1];
    return [
      {
        vertices: [
          ...before.vertices.slice(0, -1),
          { point: seam.point, in: seam.in, out: after.vertices[0].out },
          ...after.vertices.slice(1),
        ],
        closed: false,
      },
    ];
  }
  return kept.map(([lo, hi]) => piece(table, lo, hi));
}

/**
 * AE's Trim Paths. `start`/`end` are fractions 0..1 of the length and `offset` is in turns (1 = once around; any
 * real number, it wraps). "simultaneously" trims each path by the same fractions on its own; "individually"
 * treats the paths as one long path laid end to end, in order. What's kept keeps its true curves. When the offset
 * carries the kept range past the end, a closed path gives one open piece running through its start vertex and an
 * open path two pieces (in path order: the one at its start first). start > end swaps them; start == end keeps
 * nothing; the full range returns the paths themselves.
 */
export function trimPaths(
  paths: readonly BezierPath[],
  start: number,
  end: number,
  offset: number,
  mode: "simultaneously" | "individually",
): BezierPath[] {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, finite(v)));
  let s = clamp01(start);
  let e = clamp01(end);
  if (s > e) [s, e] = [e, s];
  if (s === e) return [];
  if (s === 0 && e === 1) return [...paths];
  const turns = finite(offset);
  const o = turns - Math.floor(turns);
  let a = s + o;
  let b = e + o;
  if (a >= 1) {
    a -= 1;
    b -= 1;
  }
  const ranges: [number, number][] = b <= 1 ? [[a, b]] : [[0, b - 1], [a, 1]];
  const out: BezierPath[] = [];
  if (mode === "simultaneously") {
    for (const path of paths) {
      const table = arcLengthTable(path);
      if (!(table.total > 0)) continue;
      out.push(...cut(path, table, ranges.map(([lo, hi]) => [lo * table.total, hi * table.total])));
    }
    return out;
  }
  const tables = paths.map((path) => arcLengthTable(path));
  const total = tables.reduce((sum, table) => sum + table.total, 0);
  if (!(total > 0)) return [];
  let before = 0;
  paths.forEach((path, i) => {
    const own = tables[i].total;
    if (own > 0) {
      const local = ranges.map(([lo, hi]): [number, number] => [
        Math.max(lo * total, before) - before,
        Math.min(hi * total, before + own) - before,
      ]);
      out.push(...cut(path, tables[i], local));
    }
    before += own;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Offset Paths
// ---------------------------------------------------------------------------

/**
 * AE's Offset Paths for a closed path: grown by `amount` px (shrunk when negative) with the given join (a miter
 * no longer than `miterLimit` stroke widths). It's the shape united with its own stroke `2·|amount|` wide, or
 * with that stroke taken off it, so the result is polygons (corner vertices, flattened to `tolerance`): several
 * when a shrink splits the shape, none when it shrinks away. An open path, or no amount, returns `[path]`.
 */
export function offsetPath(
  path: BezierPath,
  amount: number,
  join: LineJoin = "miter",
  miterLimit = 4,
  tolerance = FLATTEN_TOLERANCE,
): BezierPath[] {
  if (!path.closed || !Number.isFinite(amount) || amount === 0) return [path];
  const stroke = strokeOutline(path, 2 * Math.abs(amount), { join, miterLimit, tolerance });
  const rings = [cleanRing(flatten(path, tolerance)), ...stroke.map(cleanRing)];
  return booleanRings(rings, amount > 0 ? "add" : "subtract").map((ring) => polygonPath(ring, true));
}

// ---------------------------------------------------------------------------
// Resampling (Zig Zag, Wiggle Paths)
// ---------------------------------------------------------------------------

/** A point on a segment and the unit direction of travel there. */
interface Along {
  point: Vec2;
  tangent: Vec2;
}

/** One segment cut into equal lengths: its ends, the points in between and how far apart they are. */
interface Division {
  start: Along;
  end: Along;
  inner: Along[];
  spacing: number;
}

function divide(seg: Segment, parts: number): Division {
  const table = arcLengthTable(segmentPath(seg));
  const at = (t: number): Along => ({ point: t <= 0 ? copy(seg[0]) : t >= 1 ? copy(seg[3]) : pointAt(seg, t), tangent: directionAt(seg, t) });
  const inner: Along[] = [];
  for (let k = 1; k < parts; k++) inner.push(at(locate(table, (table.total * k) / parts).t));
  return { start: at(0), end: at(1), inner, spacing: table.total / parts };
}

/** A point of a resampled path: where it is, which way the path runs there, and the gaps either side. */
interface Sample {
  point: Vec2;
  tangent: Vec2;
  before: number;
  after: number;
}

/** The path's vertices plus each segment's in-between points (`parts(segment)` equal lengths per segment). */
function resample(path: BezierPath, parts: (seg: Segment) => number): Sample[] {
  const vs = path.vertices;
  const n = vs.length;
  const divisions = segments(path).map((seg) => divide(seg, parts(seg)));
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const next: Division | undefined = divisions[i];
    const prev: Division | undefined = path.closed ? divisions[(i - 1 + n) % n] : divisions[i - 1];
    // At a corner the path's direction is halfway between the two sides'.
    let tangent = unit(add(prev?.end.tangent ?? [0, 0], next?.start.tangent ?? [0, 0]));
    if (isZero(tangent)) tangent = next?.start.tangent ?? prev?.end.tangent ?? [1, 0];
    out.push({ point: copy(vs[i].point), tangent, before: prev?.spacing ?? 0, after: next?.spacing ?? 0 });
    if (next) for (const p of next.inner) out.push({ point: p.point, tangent: p.tangent, before: next.spacing, after: next.spacing });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zig Zag
// ---------------------------------------------------------------------------

/**
 * AE's Zig Zag: every segment gets `ridges` extra points, pushed alternately to each side of the path by `size`
 * px along its normal (the path's own vertices are pushed too, alternating, as AE does). "corner" gives straight
 * zigzags and "smooth" waves (handles along the path's direction, a third of the spacing long). `ridges` is
 * rounded and at least 0. A size of 0 returns the same path.
 */
export function zigZag(path: BezierPath, size: number, ridges: number, points: "corner" | "smooth"): BezierPath {
  if (!Number.isFinite(size) || size === 0 || path.vertices.length < 2) return path;
  const parts = Math.max(0, Math.round(finite(ridges))) + 1;
  const vertices = resample(path, () => parts).map((s, k): PathVertex => {
    const point = add(s.point, scale(perp(s.tangent), k % 2 === 0 ? size : -size));
    if (points === "corner") return { point, in: [0, 0], out: [0, 0] };
    return { point, in: scale(s.tangent, -s.before / 3), out: scale(s.tangent, s.after / 3) };
  });
  return { vertices, closed: path.closed };
}

// ---------------------------------------------------------------------------
// Wiggle Paths
// ---------------------------------------------------------------------------

/** A number in [0, 1) from four integers (an integer hash: the same everywhere, unlike Math.random). */
function hash(seed: number, index: number, step: number, channel: number): number {
  let h =
    Math.imul(seed | 0, 0x9e3779b1) ^
    Math.imul((index + 1) | 0, 0x85ebca6b) ^
    Math.imul(step | 0, 0xc2b2ae35) ^
    Math.imul(channel + 1, 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A point in the unit disc for vertex `index` at wiggle number `step`. */
function wiggleAt(seed: number, index: number, step: number): Vec2 {
  const angle = 2 * Math.PI * hash(seed, index, step, 0);
  const r = Math.sqrt(hash(seed, index, step, 1));
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

/**
 * AE's Wiggle Paths: the path is resampled (`detail` segments per 100 px of length, at least one per original
 * segment; its own vertices stay) and every vertex is moved by up to `size` px in a random direction that changes
 * smoothly over `time` (seconds), `speed` times a second. It's value noise from an integer hash of the seed, the
 * vertex and the wiggle's number, eased with smoothstep, so the same options always give the same path and it
 * moves continuously. "corner" joins the moved points with straight lines, "smooth" with Catmull-Rom handles.
 * A size of 0 returns the same path.
 */
export function wigglePath(
  path: BezierPath,
  options: { size: number; detail: number; points: "corner" | "smooth"; speed: number; time: number; seed: number },
): BezierPath {
  const { size, points } = options;
  if (!Number.isFinite(size) || size === 0 || path.vertices.length < 2) return path;
  const detail = Math.max(0, finite(options.detail));
  const seed = Math.floor(finite(options.seed));
  const clock = finite(options.time) * finite(options.speed);
  const step = Math.floor(clock);
  const f = clock - step;
  const ease = f * f * (3 - 2 * f);
  const samples = resample(path, (seg) => Math.max(1, Math.round((segmentLength(seg) * detail) / 100)));
  const moved = samples.map((s, k): Vec2 => {
    const a = wiggleAt(seed, k, step);
    const b = wiggleAt(seed, k, step + 1);
    return [s.point[0] + size * (a[0] + (b[0] - a[0]) * ease), s.point[1] + size * (a[1] + (b[1] - a[1]) * ease)];
  });
  const n = moved.length;
  const vertices = moved.map((point, k): PathVertex => {
    if (points === "corner") return { point, in: [0, 0], out: [0, 0] };
    const prev = path.closed ? moved[(k - 1 + n) % n] : moved[Math.max(0, k - 1)];
    const next = path.closed ? moved[(k + 1) % n] : moved[Math.min(n - 1, k + 1)];
    const handle = scale(sub(next, prev), 1 / 6);
    const open = !path.closed;
    return {
      point,
      in: open && k === 0 ? [0, 0] : scale(handle, -1),
      out: open && k === n - 1 ? [0, 0] : handle,
    };
  });
  return { vertices, closed: path.closed };
}

// ---------------------------------------------------------------------------
// Round Corners
// ---------------------------------------------------------------------------

/**
 * AE's Round Corners: every corner (a vertex without handles, between two straight segments) becomes an arc-like
 * cubic starting `radius` px before it and ending `radius` px after (at most half of the shorter of its two
 * segments, so neighbouring corners never overlap), with `KAPPA` handles towards the corner. Vertices with
 * handles, those next to a curved segment and an open path's ends are left alone. A radius of 0 or less (or no
 * corner to round) returns the same path.
 */
export function roundCorners(path: BezierPath, radius: number): BezierPath {
  const vs = path.vertices;
  const n = vs.length;
  if (!(radius > 0) || n < 3) return path;
  const out: PathVertex[] = [];
  let changed = false;
  const same = (a: Vec2, b: Vec2) => distance(a, b) <= 1e-9;
  for (let i = 0; i < n; i++) {
    const v = vs[i];
    const prev: PathVertex | undefined = path.closed ? vs[(i - 1 + n) % n] : vs[i - 1];
    const next: PathVertex | undefined = path.closed ? vs[(i + 1) % n] : vs[i + 1];
    const r =
      prev && next && isZero(v.in) && isZero(v.out) && isZero(prev.out) && isZero(next.in)
        ? Math.min(radius, distance(prev.point, v.point) / 2, distance(next.point, v.point) / 2)
        : 0;
    if (!prev || !next || !(r > 1e-9)) {
      out.push({ point: copy(v.point), in: copy(v.in), out: copy(v.out) });
      continue;
    }
    changed = true;
    const back = unit(sub(prev.point, v.point));
    const on = unit(sub(next.point, v.point));
    const a = add(v.point, scale(back, r));
    const b = add(v.point, scale(on, r));
    const last = out[out.length - 1];
    // Two arcs meeting in the middle of a segment share that vertex.
    if (last && same(last.point, a)) last.out = scale(back, -r * KAPPA);
    else out.push({ point: a, in: [0, 0], out: scale(back, -r * KAPPA) });
    out.push({ point: b, in: scale(on, -r * KAPPA), out: [0, 0] });
  }
  if (!changed) return path;
  if (path.closed && out.length > 1 && same(out[0].point, out[out.length - 1].point)) {
    out[0].in = out[out.length - 1].in;
    out.pop();
  }
  return { vertices: out, closed: path.closed };
}
