import { describe, expect, it } from "vitest";
import {
  type BezierPath,
  type Segment,
  type Vec2,
  KAPPA,
  arcLengthTable,
  bounds,
  containsPoint,
  distanceToPath,
  ellipsePath,
  flatten,
  hitStroke,
  insertVertex,
  lerpPath,
  moveVertex,
  parseSvgPathData,
  pathLength,
  pointAt,
  pointAtLength,
  polygonArea,
  polygonContains,
  polygonPath,
  polygonShapePath,
  rectPath,
  removeVertex,
  resamplePath,
  reversePath,
  samePath,
  sanitizePath,
  segments,
  setVertex,
  splitSegment,
  starPath,
  strokeOutline,
  tangentAt,
  toSvgPathData,
  transformPath,
  triangulate,
} from "./path.ts";

const circle = (r: number, cx = 0, cy = 0) => ellipsePath(cx, cy, r, r);
const triangleArea = (t: [Vec2, Vec2, Vec2]) =>
  Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;
const totalArea = (ts: [Vec2, Vec2, Vec2][]) => ts.reduce((s, t) => s + triangleArea(t), 0);
const near = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
/** Points evenly spread over the whole path (by length). */
const samplePoints = (path: BezierPath, n = 50) => {
  const table = arcLengthTable(path);
  return Array.from({ length: n }, (_, i) => pointAtLength(table, (table.total * i) / n)!.point);
};
/** Whether every point of `b` lies on `a` (within `tol`). */
const sameShape = (a: BezierPath, b: BezierPath, tol = 1e-6) => {
  for (const p of samplePoints(b)) expect(distanceToPath(a, p)!.distance).toBeLessThan(tol);
  for (const p of samplePoints(a)) expect(distanceToPath(b, p)!.distance).toBeLessThan(tol);
};

describe("constructors", () => {
  it("polygonPath makes corners", () => {
    const p = polygonPath([[0, 0], [10, 0], [10, 10]], false);
    expect(p.closed).toBe(false);
    expect(p.vertices.map((v) => v.point)).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(p.vertices.every((v) => v.in[0] === 0 && v.out[1] === 0)).toBe(true);
    expect(segments(p)).toHaveLength(2);
    expect(segments({ ...p, closed: true })).toHaveLength(3);
  });

  it("rectPath without roundness is four corners; with it, rounded corners", () => {
    const r = rectPath(10, 20, 100, 50);
    expect(r.vertices).toHaveLength(4);
    expect(bounds(r)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    const rounded = rectPath(0, 0, 100, 50, 10);
    expect(rounded.vertices).toHaveLength(8);
    const b = bounds(rounded)!;
    expect(b.x).toBeCloseTo(0, 9);
    expect(b.width).toBeCloseTo(100, 9);
    expect(b.height).toBeCloseTo(50, 9);
    // Perimeter: straight sides plus a full circle of radius 10.
    expect(pathLength(rounded)).toBeCloseTo(2 * (80 + 30) + 2 * Math.PI * 10, 1);
    // The corner itself is cut off.
    expect(containsPoint(rounded, [1, 1])).toBe(false);
    expect(containsPoint(rounded, [5, 5])).toBe(true);
  });

  it("a fully rounded square is a circle with four vertices", () => {
    const r = rectPath(0, 0, 20, 20, 50);
    expect(r.vertices).toHaveLength(4);
    expect(pathLength(r)).toBeCloseTo(2 * Math.PI * 10, 1);
  });

  it("ellipsePath starts at the top and goes clockwise (y down)", () => {
    const e = ellipsePath(50, 50, 40, 20);
    expect(e.vertices.map((v) => v.point)).toEqual([[50, 30], [90, 50], [50, 70], [10, 50]]);
    expect(e.vertices[0].out).toEqual([40 * KAPPA, 0]);
    expect(bounds(e)).toEqual({ x: 10, y: 30, width: 80, height: 40 });
  });

  it("starPath alternates outer and inner vertices from the top", () => {
    const s = starPath(0, 0, 5, 20, 50);
    expect(s.vertices).toHaveLength(10);
    near(s.vertices[0].point, [0, -50]);
    const r = (v: Vec2) => Math.hypot(v[0], v[1]);
    s.vertices.forEach((v, i) => expect(r(v.point)).toBeCloseTo(i % 2 === 0 ? 50 : 20, 9));
    // Rotation turns the first point clockwise.
    near(starPath(0, 0, 5, 20, 50, 90).vertices[0].point, [50, 0]);
    // Roundness puts handles along the circle.
    const round = starPath(0, 0, 5, 20, 50, 0, 0, 1);
    expect(round.vertices[0].out[1]).toBeCloseTo(0, 9);
    expect(round.vertices[0].out[0]).toBeGreaterThan(0);
    expect(round.vertices[1].out).toEqual([0, 0]);
  });

  it("polygonShapePath is a regular polygon; fully round, nearly a circle", () => {
    const hex = polygonShapePath(0, 0, 6, 10);
    expect(hex.vertices).toHaveLength(6);
    expect(pathLength(hex)).toBeCloseTo(60, 6);
    const round = polygonShapePath(0, 0, 8, 10, 0, 1);
    // AE's roundness handles are a little short of a circle's.
    expect(Math.abs(pathLength(round) / (2 * Math.PI * 10) - 1)).toBeLessThan(0.01);
  });
});

describe("segments", () => {
  const seg: Segment = [[0, 0], [0, 100], [100, 100], [100, 0]];

  it("pointAt and tangentAt follow the Bernstein form", () => {
    near(pointAt(seg, 0), [0, 0]);
    near(pointAt(seg, 1), [100, 0]);
    near(pointAt(seg, 0.5), [50, 75]);
    near(tangentAt(seg, 0), [0, 300]);
    near(tangentAt(seg, 0.5), [150, 0]);
  });

  it("splitSegment's halves draw the same curve", () => {
    const [l, r] = splitSegment(seg, 0.3);
    near(l[3], pointAt(seg, 0.3));
    near(r[0], pointAt(seg, 0.3));
    for (const u of [0.25, 0.5, 0.9]) {
      near(pointAt(l, u), pointAt(seg, 0.3 * u));
      near(pointAt(r, u), pointAt(seg, 0.3 + 0.7 * u));
    }
  });
});

describe("lengths", () => {
  it("a circle's length is 2πr", () => {
    // Four cubics are 0.014% longer than a true circle.
    for (const r of [10, 250]) expect(Math.abs(pathLength(circle(r)) / (2 * Math.PI * r) - 1)).toBeLessThan(3e-4);
    // The tolerance is in px: small shapes need a finer one.
    expect(Math.abs(pathLength(circle(1)) / (2 * Math.PI) - 1)).toBeGreaterThan(1e-3);
    expect(Math.abs(pathLength(circle(1), 1e-5) / (2 * Math.PI) - 1)).toBeLessThan(3e-4);
  });

  it("straight lines and open paths", () => {
    expect(pathLength(polygonPath([[0, 0], [3, 4], [3, 10]], false))).toBeCloseTo(11, 9);
    expect(pathLength(polygonPath([[0, 0], [3, 4], [3, 10]], true))).toBeCloseTo(11 + Math.hypot(3, 10), 9);
    expect(pathLength(polygonPath([[5, 5]], false))).toBe(0);
  });

  it("pointAtLength walks the path at an even pace, with tangent and angle", () => {
    const line = polygonPath([[0, 0], [100, 0], [100, 100]], false);
    const a = pointAtLength(line, 50)!;
    near(a.point, [50, 0]);
    near(a.tangent, [1, 0]);
    expect(a.angle).toBeCloseTo(0, 9);
    const b = pointAtLength(line, 150)!;
    near(b.point, [100, 50]);
    expect(b.angle).toBeCloseTo(90, 9);
    expect(b.segmentIndex).toBe(1);
    // Open paths clamp.
    near(pointAtLength(line, -10)!.point, [0, 0]);
    near(pointAtLength(line, 1000)!.point, [100, 100]);
  });

  it("pointAtLength is even along straight segments too (which ease in and out in their parameter)", () => {
    const line = polygonPath([[0, 0], [100, 0]], false);
    for (const d of [10, 25, 50, 75, 90]) near(pointAtLength(line, d)!.point, [d, 0], 4);
  });

  it("pointAtLength wraps around a closed path and follows a circle", () => {
    const c = circle(100);
    const total = pathLength(c);
    const quarter = pointAtLength(c, total / 4)!;
    near(quarter.point, [100, 0], 1);
    const eighth = pointAtLength(c, total / 8)!;
    expect(Math.hypot(...eighth.point)).toBeCloseTo(100, 1);
    expect(Math.atan2(eighth.point[1], eighth.point[0]) / (Math.PI / 180)).toBeCloseTo(-45, 0);
    // Tangent is perpendicular to the radius, clockwise.
    expect(eighth.angle).toBeCloseTo(45, 0);
    near(pointAtLength(c, total + total / 4)!.point, quarter.point, 6);
    near(pointAtLength(c, -total * 0.75)!.point, quarter.point, 6);
  });

  it("the tangent is defined at a handle-less end of a curve", () => {
    const p: BezierPath = {
      vertices: [
        { point: [0, 0], in: [0, 0], out: [0, 0] },
        { point: [100, 100], in: [0, -100], out: [0, 0] },
      ],
      closed: false,
    };
    const start = pointAtLength(p, 0)!;
    expect(Number.isFinite(start.angle)).toBe(true);
    expect(Math.hypot(...start.tangent)).toBeCloseTo(1, 6);
  });

  it("paths without segments", () => {
    expect(pointAtLength({ vertices: [], closed: false }, 0)).toBeUndefined();
    expect(pointAtLength(polygonPath([[3, 4]], false), 10)!.point).toEqual([3, 4]);
  });
});

describe("bounds", () => {
  it("are tight, not the control points' box", () => {
    const p: BezierPath = {
      vertices: [
        { point: [0, 0], in: [0, 0], out: [0, 100] },
        { point: [100, 0], in: [0, 100], out: [0, 0] },
      ],
      closed: false,
    };
    // The curve reaches y = 75 at t = 0.5 (control points go to 100).
    const b = bounds(p)!;
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);
    expect(b.width).toBeCloseTo(100, 9);
    expect(b.height).toBeCloseTo(75, 9);
  });

  it("find extremes on both axes of an S curve", () => {
    const seg: Segment = [[0, 0], [100, 100], [-100, 100], [0, 200]];
    const p: BezierPath = {
      vertices: [
        { point: seg[0], in: [0, 0], out: [100, 100] },
        { point: seg[3], in: [-100, -100], out: [0, 0] },
      ],
      closed: false,
    };
    const b = bounds(p)!;
    // x(t) = 300t(1-t)(1-2t): extremes at t = (3 ± √3)/6.
    const t = (3 - Math.sqrt(3)) / 6;
    const xMax = pointAt(seg, t)[0];
    expect(b.x).toBeCloseTo(-xMax, 9);
    expect(b.width).toBeCloseTo(2 * xMax, 9);
    // And no flattened point escapes them.
    for (const q of flatten(p, 0.01)) {
      expect(q[0]).toBeGreaterThanOrEqual(b.x - 1e-9);
      expect(q[0]).toBeLessThanOrEqual(b.x + b.width + 1e-9);
    }
  });

  it("of nothing is undefined; of one point, that point", () => {
    expect(bounds({ vertices: [], closed: true })).toBeUndefined();
    expect(bounds(polygonPath([[4, 5]], false))).toEqual({ x: 4, y: 5, width: 0, height: 0 });
  });
});

describe("flatten", () => {
  it("stays within tolerance and closes closed paths", () => {
    const c = circle(100);
    for (const tol of [1, 0.25, 0.01]) {
      const pts = flatten(c, tol);
      expect(pts[0]).toEqual(pts[pts.length - 1]);
      for (let i = 0; i + 1 < pts.length; i++) {
        const mid: Vec2 = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
        // The ellipse is a close approximation of a circle; the chord's middle is within tolerance of it.
        expect(100 - Math.hypot(...mid)).toBeLessThanOrEqual(tol + 0.03);
      }
    }
    expect(flatten(c, 0.01).length).toBeGreaterThan(flatten(c, 1).length);
  });

  it("keeps straight lines as their corners", () => {
    const pts = flatten(polygonPath([[0, 0], [10, 0], [10, 10]], false));
    expect(pts).toEqual([[0, 0], [10, 0], [10, 10]]);
  });
});

describe("hit testing", () => {
  const outer = rectPath(0, 0, 100, 100);
  const innerSame = rectPath(25, 25, 50, 50);
  const innerReversed = reversePath(innerSame);

  it("containsPoint for one path, closing open paths", () => {
    expect(containsPoint(circle(50, 50, 50), [50, 50])).toBe(true);
    expect(containsPoint(circle(50, 50, 50), [2, 2])).toBe(false);
    const open = polygonPath([[0, 0], [100, 0], [0, 100]], false);
    expect(containsPoint(open, [20, 20])).toBe(true);
  });

  it("nonzero vs evenodd with a hole", () => {
    const hole: Vec2 = [50, 50];
    const ring: Vec2 = [10, 10];
    // Same direction: nonzero fills the middle, evenodd doesn't.
    expect(containsPoint([outer, innerSame], hole, "nonzero")).toBe(true);
    expect(containsPoint([outer, innerSame], hole, "evenodd")).toBe(false);
    // Opposite directions: a hole either way.
    expect(containsPoint([outer, innerReversed], hole, "nonzero")).toBe(false);
    expect(containsPoint([outer, innerReversed], hole, "evenodd")).toBe(false);
    for (const rule of ["nonzero", "evenodd"] as const) {
      expect(containsPoint([outer, innerSame], ring, rule)).toBe(true);
      expect(containsPoint([outer, innerSame], [150, 50], rule)).toBe(false);
    }
  });

  it("distanceToPath finds the nearest segment and parameter", () => {
    const n = distanceToPath(outer, [50, -10])!;
    expect(n.distance).toBeCloseTo(10, 6);
    expect(n.segmentIndex).toBe(0);
    expect(n.t).toBeCloseTo(0.5, 6);
    near(n.point, [50, 0]);
    const c = distanceToPath(circle(100), [0, 0])!;
    expect(c.distance).toBeCloseTo(100, 1);
    const off = distanceToPath(circle(100), [300, 0])!;
    expect(off.distance).toBeCloseTo(200, 6);
    near(off.point, [100, 0]);
    expect(distanceToPath(polygonPath([[3, 4]], false), [0, 0])).toMatchObject({ distance: 5, segmentIndex: -1 });
    expect(distanceToPath({ vertices: [], closed: false }, [0, 0])).toBeUndefined();
  });

  it("hitStroke is within half the width", () => {
    const line = polygonPath([[0, 0], [100, 0]], false);
    expect(hitStroke(line, [50, 4], 10)).toBe(true);
    expect(hitStroke(line, [50, 6], 10)).toBe(false);
    expect(hitStroke(line, [103, 0], 10)).toBe(true);
  });
});

describe("strokeOutline", () => {
  const line = polygonPath([[0, 0], [100, 0]], false);

  it("of a straight line with butt caps is a rectangle", () => {
    const pieces = strokeOutline(line, 10, { cap: "butt" });
    expect(pieces).toHaveLength(1);
    const xs = pieces[0].map((p) => p[0]).sort((a, b) => a - b);
    const ys = pieces[0].map((p) => p[1]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0, 100, 100]);
    expect(ys).toEqual([-5, -5, 5, 5]);
    expect(polygonArea(pieces[0])).toBeCloseTo(1000, 9);
  });

  it("square caps extend it by half the width; round caps add half discs", () => {
    const square = strokeOutline(line, 10, { cap: "square" });
    expect(polygonArea(square[0])).toBeCloseTo(1100, 9);
    const round = strokeOutline(line, 10, { cap: "round", tolerance: 0.01 });
    expect(round).toHaveLength(3);
    const caps = polygonArea(round[1]) + polygonArea(round[2]);
    expect(caps).toBeCloseTo(Math.PI * 25, 0);
  });

  it("joins: miter reaches the corner, bevel cuts it, the miter limit bevels sharp ones", () => {
    const l = polygonPath([[0, 0], [100, 0], [100, 100]], false);
    const miter = strokeOutline(l, 10, { join: "miter" });
    expect(miter).toHaveLength(3);
    expect(containsPoint(miter.map((r) => polygonPath(r, true)), [104, -4])).toBe(true);
    const bevel = strokeOutline(l, 10, { join: "bevel" });
    expect(polygonContains(bevel, [104, -4])).toBe(false);
    expect(polygonContains(bevel, [101, -1])).toBe(true);
    const round = strokeOutline(l, 10, { join: "round" });
    expect(polygonContains(round, [103, -3])).toBe(true);
    expect(polygonContains(round, [104.5, -4.5])).toBe(false);
    // A very sharp turn exceeds the default miter limit (4).
    const sharp = polygonPath([[0, 0], [100, 0], [0, 5]], false);
    const pieces = strokeOutline(sharp, 10, { join: "miter" });
    expect(pieces[2]).toHaveLength(3);
  });

  it("every piece is wound the same way, so the nonzero rule fills their union", () => {
    const pieces = strokeOutline(starPath(0, 0, 5, 20, 50, 0, 0.3, 0), 6, { join: "round" });
    for (const p of pieces) expect(polygonArea(p)).toBeGreaterThan(0);
    const ring = flatten(starPath(0, 0, 5, 20, 50, 0, 0.3, 0));
    // Midpoints of the centreline (its vertices sit on pieces' edges).
    for (let i = 0; i + 1 < ring.length; i++) {
      const mid: Vec2 = [(ring[i][0] + ring[i + 1][0]) / 2, (ring[i][1] + ring[i + 1][1]) / 2];
      expect(polygonContains(pieces, mid)).toBe(true);
    }
    expect(polygonContains(pieces, [0, 0])).toBe(false);
  });

  it("closed paths have no caps and join all around", () => {
    const pieces = strokeOutline(rectPath(0, 0, 100, 100), 10, { cap: "round", join: "miter" });
    expect(pieces).toHaveLength(8);
    expect(polygonContains(pieces, [-4, -4])).toBe(true);
    expect(polygonContains(pieces, [50, 50])).toBe(false);
  });

  it("a single point with round or square caps is a dot", () => {
    const dot = polygonPath([[0, 0]], false);
    expect(strokeOutline(dot, 10, { cap: "butt" })).toEqual([]);
    expect(polygonArea(strokeOutline(dot, 10, { cap: "square" })[0])).toBeCloseTo(100, 9);
    expect(polygonArea(strokeOutline(dot, 10, { cap: "round", tolerance: 0.01 })[0])).toBeCloseTo(Math.PI * 25, 0);
    expect(strokeOutline(line, 0)).toEqual([]);
  });
});

describe("editing", () => {
  it("insertVertex keeps the shape", () => {
    const c = circle(100);
    const inserted = insertVertex(c, 1, 0.3);
    expect(inserted.vertices).toHaveLength(5);
    near(inserted.vertices[2].point, pointAt(segments(c)[1], 0.3));
    sameShape(c, inserted);
    expect(pathLength(inserted)).toBeCloseTo(pathLength(c), 2);
    // On the closing segment, the new vertex goes last.
    const closing = insertVertex(c, 3, 0.5);
    near(closing.vertices[4].point, pointAt(segments(c)[3], 0.5));
    sameShape(c, closing);
    expect(insertVertex(c, 9, 0.5)).toBe(c);
    expect(insertVertex(c, 0, 0)).toBe(c);
  });

  it("insertVertex into a curve on an open path", () => {
    const p: BezierPath = {
      vertices: [
        { point: [0, 0], in: [0, 0], out: [30, 80] },
        { point: [100, 0], in: [-10, 90], out: [0, 0] },
      ],
      closed: false,
    };
    const q = insertVertex(p, 0, 0.7);
    expect(q.vertices).toHaveLength(3);
    sameShape(p, q);
  });

  it("the pen tool's round trip: nearest point, then insert there", () => {
    const c = circle(100);
    const hit = distanceToPath(c, [80, 80])!;
    const q = insertVertex(c, hit.segmentIndex, hit.t);
    near(q.vertices[hit.segmentIndex + 1].point, hit.point);
  });

  it("removeVertex, moveVertex and setVertex", () => {
    const tri = polygonPath([[0, 0], [10, 0], [10, 10]], true);
    expect(removeVertex(tri, 1).vertices.map((v) => v.point)).toEqual([[0, 0], [10, 10]]);
    expect(removeVertex(tri, 5)).toBe(tri);
    const c = circle(10);
    const moved = moveVertex(c, 0, [5, -20]);
    expect(moved.vertices[0]).toEqual({ point: [5, -20], in: c.vertices[0].in, out: c.vertices[0].out });
    expect(moveVertex(c, 0, [0, -10])).toBe(c);
    expect(c.vertices[0].point).toEqual([0, -10]);
    expect(setVertex(c, 1, { out: [1, 2] }).vertices[1]).toEqual({ ...c.vertices[1], out: [1, 2] });
  });

  it("reversePath draws the same shape the other way", () => {
    const c = circle(50);
    const r = reversePath(c);
    expect(r.vertices[0].point).toEqual(c.vertices[0].point);
    expect(r.vertices[1].point).toEqual(c.vertices[3].point);
    sameShape(c, r);
    expect(samePath(reversePath(r), c)).toBe(true);
    const open = polygonPath([[0, 0], [1, 0], [2, 2]], false);
    expect(reversePath(open).vertices.map((v) => v.point)).toEqual([[2, 2], [1, 0], [0, 0]]);
    // Winding flips: the pair makes a hole under nonzero.
    expect(containsPoint([circle(100), reversePath(circle(50))], [0, 0])).toBe(false);
  });

  it("transformPath maps points fully and handles linearly", () => {
    const p: BezierPath = { vertices: [{ point: [1, 2], in: [3, 4], out: [-1, 0] }], closed: false };
    const t = transformPath(p, [2, 0, 0, 3, 10, 20]);
    expect(t.vertices[0]).toEqual({ point: [12, 26], in: [6, 12], out: [-2, 0] });
    // A quarter turn (x = -v, y = u) keeps a circle's length.
    const turned = transformPath(circle(10, 30, 0), [0, 1, -1, 0, 0, 0]);
    near(turned.vertices[0].point, [10, 30]);
    expect(pathLength(turned)).toBeCloseTo(pathLength(circle(10)), 6);
  });
});

describe("interpolation", () => {
  it("lerpPath with equal counts is per component", () => {
    const a = rectPath(0, 0, 10, 10);
    const b = rectPath(10, 10, 30, 30);
    const m = lerpPath(a, b, 0.5);
    expect(m.vertices.map((v) => v.point)).toEqual([[5, 5], [25, 5], [25, 25], [5, 25]]);
    expect(samePath(lerpPath(a, b, 0), a)).toBe(true);
    expect(samePath(lerpPath(a, b, 1), b)).toBe(true);
  });

  it("different counts: the smaller is resampled without changing shape", () => {
    const tri = polygonPath([[0, 0], [100, 0], [0, 10]], true);
    const up = resamplePath(tri, 6);
    expect(up.vertices).toHaveLength(6);
    sameShape(tri, up);
    // The longest sides got the new vertices: the hypotenuse twice, the bottom once, the short side never.
    expect(up.vertices.filter((v) => v.point[1] === 0)).toHaveLength(3);
    expect(up.vertices.filter((v) => v.point[0] === 0)).toHaveLength(2);
    const star = starPath(0, 0, 5, 20, 50);
    const m = lerpPath(tri, star, 0);
    expect(m.vertices).toHaveLength(10);
    sameShape(tri, m);
    sameShape(star, lerpPath(tri, star, 1));
    expect(resamplePath(star, 3)).toBe(star);
  });

  it("a single vertex is repeated", () => {
    const dot = polygonPath([[5, 5]], false);
    expect(resamplePath(dot, 3).vertices.map((v) => v.point)).toEqual([[5, 5], [5, 5], [5, 5]]);
    expect(lerpPath(dot, polygonPath([[0, 0], [10, 0]], false), 0.5).vertices.map((v) => v.point)).toEqual([
      [2.5, 2.5],
      [7.5, 2.5],
    ]);
  });

  it("samePath", () => {
    expect(samePath(circle(10), circle(10))).toBe(true);
    expect(samePath(circle(10), circle(10.001))).toBe(false);
    expect(samePath(circle(10), circle(10.001), 0.01)).toBe(true);
    expect(samePath(circle(10), { ...circle(10), closed: false })).toBe(false);
  });
});

describe("triangulate", () => {
  it("covers a convex polygon", () => {
    const square: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const ts = triangulate([square]);
    expect(ts).toHaveLength(2);
    expect(totalArea(ts)).toBeCloseTo(100, 9);
  });

  it("covers a concave polygon exactly, whichever way it winds", () => {
    const star = flatten(starPath(0, 0, 7, 20, 60));
    const area = polygonArea(star);
    for (const ring of [star, [...star].reverse()]) {
      const ts = triangulate([ring]);
      expect(ts).toHaveLength(12);
      expect(totalArea(ts)).toBeCloseTo(area, 6);
    }
  });

  it("area equals the polygon's for a flattened curve", () => {
    const ring = flatten(circle(100), 0.1);
    expect(totalArea(triangulate([ring]))).toBeCloseTo(polygonArea(ring), 6);
    expect(polygonArea(ring)).toBeCloseTo(Math.PI * 100 * 100, -2);
  });

  it("holes: evenodd always, nonzero only when wound the other way", () => {
    const outer = flatten(rectPath(0, 0, 100, 100));
    const inner = flatten(circle(20, 50, 50), 0.1);
    const innerArea = polygonArea(inner);
    expect(totalArea(triangulate([outer, inner], "evenodd"))).toBeCloseTo(10000 - innerArea, 6);
    expect(totalArea(triangulate([outer, inner], "nonzero"))).toBeCloseTo(10000, 6);
    const reversed = [...inner].reverse();
    expect(totalArea(triangulate([outer, reversed], "nonzero"))).toBeCloseTo(10000 - innerArea, 6);
  });

  it("several holes and an island inside a hole", () => {
    const outer = flatten(rectPath(0, 0, 100, 100));
    const h1 = flatten(rectPath(10, 10, 30, 30));
    const h2 = flatten(rectPath(60, 60, 30, 30));
    const island = flatten(rectPath(20, 20, 10, 10));
    const ts = triangulate([outer, h1, h2, island], "evenodd");
    expect(totalArea(ts)).toBeCloseTo(10000 - 900 - 900 + 100, 6);
    // No triangle covers a hole.
    const centroid = (t: [Vec2, Vec2, Vec2]): Vec2 => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
    for (const t of ts) expect(polygonContains([outer, h1, h2, island], centroid(t), "evenodd")).toBe(true);
  });

  it("separate shapes are each filled, and triangles are wound positively", () => {
    const a = flatten(rectPath(0, 0, 10, 10));
    const b = [...flatten(rectPath(20, 0, 10, 10))].reverse();
    const ts = triangulate([a, b]);
    expect(totalArea(ts)).toBeCloseTo(200, 9);
    for (const [p, q, r] of ts) expect((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])).toBeGreaterThan(0);
  });

  it("ignores degenerate rings and collinear points", () => {
    expect(triangulate([[[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]]])).toEqual([]);
    const withCollinear: Vec2[] = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(totalArea(triangulate([withCollinear]))).toBeCloseTo(100, 9);
  });

  it("fills a stroke outline", () => {
    const pieces = strokeOutline(polygonPath([[0, 0], [100, 0]], false), 10);
    expect(totalArea(triangulate(pieces))).toBeCloseTo(1000, 9);
  });
});

describe("sanitizePath", () => {
  it("keeps valid paths", () => {
    const c = circle(10);
    expect(sanitizePath(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("repairs or rejects bad data", () => {
    expect(sanitizePath(undefined)).toBeUndefined();
    expect(sanitizePath("path")).toBeUndefined();
    expect(sanitizePath({ vertices: [] })).toBeUndefined();
    expect(sanitizePath({ vertices: [{ point: [Number.NaN, 0] }] })).toBeUndefined();
    expect(
      sanitizePath({
        vertices: [{ point: [1, 2], in: [Infinity, 0], out: "x" }, null, { point: [1] }, { point: [3, 4], in: [1, 1], out: [2, 2] }],
        closed: "yes",
      }),
    ).toEqual({
      vertices: [
        { point: [1, 2], in: [0, 0], out: [0, 0] },
        { point: [3, 4], in: [1, 1], out: [2, 2] },
      ],
      closed: false,
    });
  });
});

describe("SVG", () => {
  it("writes lines, curves and closes", () => {
    expect(toSvgPathData(polygonPath([[0, 0], [10, 0], [10, 10]], true))).toBe("M0 0 L10 0 L10 10 Z");
    expect(toSvgPathData(polygonPath([[0, 0], [10, 0]], false))).toBe("M0 0 L10 0");
    expect(toSvgPathData(ellipsePath(0, 0, 1, 1))).toMatch(/^M0 -1 C0\.552285 -1 1 -0\.552285 1 0 C/);
    expect(toSvgPathData([rectPath(0, 0, 1, 1), rectPath(2, 2, 1, 1)])).toBe("M0 0 L1 0 L1 1 L0 1 Z M2 2 L3 2 L3 3 L2 3 Z");
  });

  it("round trips paths", () => {
    const paths = [
      circle(50, 10, 20),
      rectPath(0, 0, 100, 60, 12),
      starPath(0, 0, 5, 20, 50, 15, 0.2, 0.4),
      polygonPath([[0, 0], [10, 5], [20, 0]], false),
      insertVertex(circle(30), 2, 0.4),
    ];
    for (const p of paths) {
      const back = parseSvgPathData(toSvgPathData(p));
      expect(back).toHaveLength(1);
      expect(samePath(back[0], p, 1e-5)).toBe(true);
    }
    const compound = parseSvgPathData(toSvgPathData(paths));
    expect(compound).toHaveLength(paths.length);
  });

  it("parses absolute and relative commands", () => {
    const [p] = parseSvgPathData("M10 10 h10 v10 H10 V10 z");
    expect(p.closed).toBe(true);
    expect(p.vertices.map((v) => v.point)).toEqual([[10, 10], [20, 10], [20, 20], [10, 20]]);
    const [q] = parseSvgPathData("m10,10 l10,0 l0,10 L10,20z");
    expect(samePath(p, q)).toBe(true);
    // Implicit linetos after a moveto, compact numbers.
    const [r] = parseSvgPathData("M0 0 10 0 10-10.5.5.5");
    expect(r.vertices.map((v) => v.point)).toEqual([[0, 0], [10, 0], [10, -10.5], [0.5, 0.5]]);
    const [s] = parseSvgPathData("m1 1 2 2 3 3");
    expect(s.vertices.map((v) => v.point)).toEqual([[1, 1], [3, 3], [6, 6]]);
    expect(parseSvgPathData("M1e2 0L1.5E1 2")[0].vertices.map((v) => v.point)).toEqual([[100, 0], [15, 2]]);
  });

  it("parses cubics, smooth cubics, quadratics and smooth quadratics", () => {
    const [c] = parseSvgPathData("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
    expect(c.vertices).toHaveLength(3);
    expect(c.vertices[1].in).toEqual([0, 10]);
    // S reflects the previous second control point.
    expect(c.vertices[1].out).toEqual([0, -10]);
    const [rel] = parseSvgPathData("M0 0 c0 10 10 10 10 0 s10 -10 10 0");
    expect(samePath(rel, c)).toBe(true);
    const [q] = parseSvgPathData("M0 0 Q50 100 100 0");
    // A quadratic raised to a cubic: controls 2/3 of the way to the quadratic's.
    expect(q.vertices[0].out[0]).toBeCloseTo(100 / 3, 9);
    expect(q.vertices[0].out[1]).toBeCloseTo(200 / 3, 9);
    expect(bounds(q)!.height).toBeCloseTo(50, 9);
    const [t] = parseSvgPathData("M0 0 Q50 100 100 0 T200 0");
    expect(bounds(t)!.y).toBeCloseTo(-50, 9);
    const [tr] = parseSvgPathData("M0 0 q50 100 100 0 t100 0");
    expect(samePath(tr, t)).toBe(true);
    // S without a cubic before it uses the current point.
    const [s] = parseSvgPathData("M0 0 L10 0 S20 10 30 0");
    expect(s.vertices[1].out).toEqual([0, 0]);
  });

  it("converts arcs to cubics", () => {
    const [half] = parseSvgPathData("M0 0 A50 50 0 0 1 100 0");
    expect(pathLength(half)).toBeCloseTo(Math.PI * 50, 1);
    const b = bounds(half)!;
    expect(b.height).toBeCloseTo(50, 2);
    // Sweep 1 goes clockwise with y down: through the top.
    expect(b.y).toBeCloseTo(-50, 2);
    const [large] = parseSvgPathData("M0 0 a50 50 0 1 0 0.0001 0 z");
    expect(pathLength(large)).toBeCloseTo(2 * Math.PI * 50, 0);
    // Flags written without separators; radii too small get scaled up.
    const [compact] = parseSvgPathData("M0 0a1 1 0 00100 0");
    expect(pathLength(compact)).toBeCloseTo(Math.PI * 50, 1);
    expect(bounds(compact)!.y).toBeCloseTo(0, 2);
    // A zero radius draws a line.
    expect(parseSvgPathData("M0 0 A0 5 0 0 1 10 0")[0].vertices.map((v) => v.point)).toEqual([[0, 0], [10, 0]]);
  });

  it("subpaths, closepath and errors", () => {
    const paths = parseSvgPathData("M0 0 L10 0 L10 10 Z L0 10 L-10 0 M50 50 M60 60 L70 70");
    expect(paths).toHaveLength(3);
    expect(paths[0].closed).toBe(true);
    // Drawing after Z starts at the subpath's start.
    expect(paths[1].vertices[0].point).toEqual([0, 0]);
    expect(paths[1].closed).toBe(false);
    expect(paths[2].vertices.map((v) => v.point)).toEqual([[60, 60], [70, 70]]);
    // A closepath back onto the start merges the vertices, keeping the handle.
    const [closedCurve] = parseSvgPathData("M0 0 L10 0 C10 10 0 10 0 0 Z");
    expect(closedCurve.vertices).toHaveLength(2);
    expect(closedCurve.vertices[0].in).toEqual([0, 10]);
    // Keeps what came before an error.
    expect(parseSvgPathData("M0 0 L10 0 L10 X 20 20")[0].vertices).toHaveLength(2);
    expect(parseSvgPathData("L10 10")).toEqual([]);
    expect(parseSvgPathData("")).toEqual([]);
  });
});
