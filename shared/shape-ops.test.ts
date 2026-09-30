import { describe, expect, it } from "vitest";
import {
  type BezierPath,
  type Vec2,
  KAPPA,
  distanceToPath,
  ellipsePath,
  pathLength,
  pointAtLength,
  polygonArea,
  polygonContains,
  polygonPath,
  rectPath,
  samePath,
  starPath,
} from "./path.ts";
import { type MergeMode, mergePaths, offsetPath, roundCorners, trimPaths, wigglePath, zigZag } from "./shape-ops.ts";

const square = (x: number, y: number, size = 100) => rectPath(x, y, size, size);
const circle = (r: number, cx = 0, cy = 0) => ellipsePath(cx, cy, r, r);
const ringOf = (path: BezierPath): Vec2[] => path.vertices.map((v) => v.point);
/** A polygon path's area, positive when wound clockwise (y down) like `rectPath`, negative for a hole. */
const signedArea = (path: BezierPath) => {
  const ring = ringOf(path);
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
};
/** The area a nonzero fill of the result covers (holes count negatively). */
const area = (paths: readonly BezierPath[]) => paths.reduce((sum, p) => sum + signedArea(p), 0);
const contains = (paths: readonly BezierPath[], p: Vec2) => polygonContains(paths.map(ringOf), p, "nonzero");
const isPolygon = (path: BezierPath) =>
  path.closed && path.vertices.every((v) => v.in[0] === 0 && v.in[1] === 0 && v.out[0] === 0 && v.out[1] === 0);
const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
};
const MODES: MergeMode[] = ["merge", "add", "subtract", "intersect", "exclude"];

describe("mergePaths", () => {
  const a = square(0, 0);
  const b = square(50, 50);

  it("combines two overlapping squares", () => {
    expect(area(mergePaths([a, b], "merge"))).toBeCloseTo(17500, 6);
    expect(area(mergePaths([a, b], "add"))).toBeCloseTo(17500, 6);
    expect(area(mergePaths([a, b], "intersect"))).toBeCloseTo(2500, 6);
    expect(area(mergePaths([a, b], "subtract"))).toBeCloseTo(7500, 6);
    expect(area(mergePaths([a, b], "exclude"))).toBeCloseTo(15000, 6);
  });

  it("combines two squares overlapping by half", () => {
    const c = square(50, 0);
    expect(area(mergePaths([a, c], "add"))).toBeCloseTo(15000, 6);
    expect(area(mergePaths([a, c], "intersect"))).toBeCloseTo(5000, 6);
    expect(area(mergePaths([a, c], "subtract"))).toBeCloseTo(5000, 6);
    expect(area(mergePaths([a, c], "exclude"))).toBeCloseTo(10000, 6);
    // Their top and bottom sides overlap: each result is still plain rectangles.
    expect(mergePaths([a, c], "add").map((p) => p.vertices.length)).toEqual([4]);
    expect(mergePaths([a, c], "intersect").map((p) => p.vertices.length)).toEqual([4]);
    expect(mergePaths([a, c], "exclude").map((p) => p.vertices.length)).toEqual([4, 4]);
  });

  it("returns closed polygons, outer rings wound like rectPath", () => {
    for (const mode of MODES) {
      const result = mergePaths([a, b], mode);
      expect(result.length).toBeGreaterThan(0);
      for (const path of result) {
        expect(isPolygon(path)).toBe(true);
        expect(signedArea(path)).toBeGreaterThan(0);
      }
    }
    expect(signedArea(a)).toBeGreaterThan(0);
  });

  it("gives the union's L-shaped outline", () => {
    const [union, ...rest] = mergePaths([a, b], "add");
    expect(rest).toEqual([]);
    expect(union.vertices.length).toBe(8);
    expect(contains([union], [25, 25])).toBe(true);
    expect(contains([union], [125, 125])).toBe(true);
    expect(contains([union], [75, 75])).toBe(true);
    expect(contains([union], [125, 25])).toBe(false);
    expect(contains([union], [25, 125])).toBe(false);
  });

  it("spot checks every mode's containment", () => {
    const inA: Vec2 = [25, 25];
    const inBoth: Vec2 = [75, 75];
    const inB: Vec2 = [125, 125];
    const expected: Record<MergeMode, boolean[]> = {
      merge: [true, true, true],
      add: [true, true, true],
      subtract: [true, false, false],
      intersect: [false, true, false],
      exclude: [true, false, true],
    };
    for (const mode of MODES) {
      const result = mergePaths([a, b], mode);
      expect([inA, inBoth, inB].map((p) => contains(result, p))).toEqual(expected[mode]);
    }
  });

  it("handles identical shapes", () => {
    for (const mode of ["merge", "add", "intersect"] as const) {
      const result = mergePaths([a, square(0, 0)], mode);
      expect(result.length).toBe(1);
      expect(result[0].vertices.length).toBe(4);
      expect(area(result)).toBeCloseTo(10000, 6);
    }
    expect(mergePaths([a, square(0, 0)], "subtract")).toEqual([]);
    expect(mergePaths([a, square(0, 0)], "exclude")).toEqual([]);
    // Three copies: an odd number overlap everywhere.
    expect(area(mergePaths([a, a, a], "exclude"))).toBeCloseTo(10000, 6);
  });

  it("unites squares sharing an edge into one rectangle", () => {
    const result = mergePaths([a, square(100, 0)], "add");
    expect(result.length).toBe(1);
    expect(result[0].vertices.length).toBe(4);
    expect(area(result)).toBeCloseTo(20000, 6);
    expect(mergePaths([a, square(100, 0)], "intersect")).toEqual([]);
    expect(area(mergePaths([a, square(100, 0)], "subtract"))).toBeCloseTo(10000, 6);
    const xor = mergePaths([a, square(100, 0)], "exclude");
    expect(xor.length).toBe(1);
    expect(area(xor)).toBeCloseTo(20000, 6);
  });

  it("unites squares sharing part of an edge", () => {
    const result = mergePaths([a, square(100, 50)], "add");
    expect(result.length).toBe(1);
    expect(result[0].vertices.length).toBe(8);
    expect(area(result)).toBeCloseTo(20000, 6);
  });

  it("handles one shape inside another", () => {
    const inner = square(25, 25, 50);
    const union = mergePaths([a, inner], "add");
    expect(union.length).toBe(1);
    expect(area(union)).toBeCloseTo(10000, 6);

    const hole = mergePaths([a, inner], "subtract");
    expect(hole.length).toBe(2);
    expect(hole.map(signedArea).sort((x, y) => x - y)).toEqual([expect.closeTo(-2500, 6), expect.closeTo(10000, 6)]);
    expect(area(hole)).toBeCloseTo(7500, 6);
    expect(contains(hole, [50, 50])).toBe(false);
    expect(contains(hole, [10, 10])).toBe(true);

    expect(mergePaths([inner, a], "subtract")).toEqual([]);
    expect(area(mergePaths([a, inner], "intersect"))).toBeCloseTo(2500, 6);
    const xor = mergePaths([a, inner], "exclude");
    expect(xor.length).toBe(2);
    expect(area(xor)).toBeCloseTo(7500, 6);
  });

  it("handles disjoint shapes", () => {
    const far = square(300, 0);
    const union = mergePaths([a, far], "add");
    expect(union.length).toBe(2);
    expect(area(union)).toBeCloseTo(20000, 6);
    expect(mergePaths([a, far], "intersect")).toEqual([]);
    expect(area(mergePaths([a, far], "subtract"))).toBeCloseTo(10000, 6);
    expect(mergePaths([a, far], "subtract").length).toBe(1);
    expect(mergePaths([a, far], "exclude").length).toBe(2);
  });

  it("handles shapes touching at one corner", () => {
    const corner = square(100, 100);
    const union = mergePaths([a, corner], "add");
    expect(union.length).toBe(2);
    expect(union.map((p) => p.vertices.length)).toEqual([4, 4]);
    expect(area(union)).toBeCloseTo(20000, 6);
    expect(mergePaths([a, corner], "intersect")).toEqual([]);
    expect(area(mergePaths([a, corner], "subtract"))).toBeCloseTo(10000, 6);
    expect(area(mergePaths([a, corner], "exclude"))).toBeCloseTo(20000, 6);
  });

  it("handles a vertex on another shape's edge", () => {
    // A diamond whose left point touches the square's right side.
    const diamond = polygonPath([[100, 50], [150, 0], [200, 50], [150, 100]], true);
    const union = mergePaths([a, diamond], "add");
    expect(area(union)).toBeCloseTo(15000, 6);
    expect(mergePaths([a, diamond], "intersect")).toEqual([]);
    // And one poking through it.
    const through = polygonPath([[50, 50], [100, 0], [150, 50], [100, 100]], true);
    expect(area(mergePaths([a, through], "intersect"))).toBeCloseTo(2500, 6);
    expect(area(mergePaths([a, through], "add"))).toBeCloseTo(12500, 6);
  });

  it("takes every other path off the first, and intersects them all", () => {
    const paths = [square(0, 0, 300), square(50, 50), square(100, 100), square(1000, 0)];
    // The two small squares overlap by 50×50; "exclude" keeps where one or all three of the first three are.
    expect(area(mergePaths(paths, "subtract"))).toBeCloseTo(90000 - 17500, 6);
    expect(area(mergePaths(paths.slice(0, 3), "intersect"))).toBeCloseTo(2500, 6);
    expect(mergePaths(paths, "intersect")).toEqual([]);
    expect(area(mergePaths(paths, "add"))).toBeCloseTo(100000, 6);
    expect(area(mergePaths(paths, "exclude"))).toBeCloseTo(72500 + 2500 + 10000, 6);
  });

  it("doesn't care which way the inputs wind", () => {
    const reversed = polygonPath([[50, 50], [50, 150], [150, 150], [150, 50]], true);
    expect(signedArea(reversed)).toBeLessThan(0);
    expect(area(mergePaths([a, reversed], "add"))).toBeCloseTo(17500, 6);
    expect(area(mergePaths([a, reversed], "intersect"))).toBeCloseTo(2500, 6);
    expect(area(mergePaths([reversed, a], "subtract"))).toBeCloseTo(7500, 6);
  });

  it("matches the analytic lens of two circles", () => {
    const r = 50;
    const d = 60;
    const lens = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    const disc = Math.PI * r * r;
    const pair = [circle(r), circle(r, d, 0)];
    const within = (value: number, target: number) => expect(Math.abs(value - target) / target).toBeLessThan(0.004);
    within(area(mergePaths(pair, "intersect", 0.02)), lens);
    within(area(mergePaths(pair, "add", 0.02)), 2 * disc - lens);
    within(area(mergePaths(pair, "subtract", 0.02)), disc - lens);
    within(area(mergePaths(pair, "exclude", 0.02)), 2 * (disc - lens));
    expect(mergePaths(pair, "intersect").length).toBe(1);
    expect(mergePaths(pair, "add").length).toBe(1);
    expect(mergePaths(pair, "exclude").length).toBe(2);
    const result = mergePaths(pair, "intersect");
    expect(contains(result, [30, 0])).toBe(true);
    expect(contains(result, [0, 0])).toBe(false);
    expect(contains(result, [30, 45])).toBe(false);
  });

  it("handles identical circles and a ring", () => {
    expect(mergePaths([circle(50), circle(50)], "add").length).toBe(1);
    expect(mergePaths([circle(50), circle(50)], "subtract")).toEqual([]);
    const ring = mergePaths([circle(50), circle(20)], "subtract", 0.02);
    expect(ring.length).toBe(2);
    expect(area(ring)).toBeCloseTo(Math.PI * (2500 - 400), -1);
    expect(contains(ring, [0, 0])).toBe(false);
    expect(contains(ring, [35, 0])).toBe(true);
  });

  it("resolves a self-intersecting path", () => {
    // A bow tie: two triangles meeting at the centre.
    const bow = polygonPath([[0, 0], [100, 100], [100, 0], [0, 100]], true);
    const result = mergePaths([bow], "add");
    expect(result.length).toBe(2);
    expect(result.every((p) => signedArea(p) > 0)).toBe(true);
    expect(area(result)).toBeCloseTo(5000, 6);
  });

  it("unites a star with a circle, close to the sum less the overlap", () => {
    const star = starPath(0, 0, 5, 40, 100);
    const disc = circle(60);
    const union = area(mergePaths([star, disc], "add"));
    const both = area(mergePaths([star, disc], "intersect"));
    const starArea = area(mergePaths([star], "add"));
    const discArea = area(mergePaths([disc], "add"));
    expect(union + both).toBeCloseTo(starArea + discArea, 4);
    expect(area(mergePaths([star, disc], "exclude"))).toBeCloseTo(union - both, 4);
    expect(area(mergePaths([star, disc], "subtract"))).toBeCloseTo(starArea - both, 4);
  });

  it("treats open paths as closed and ignores empty ones", () => {
    const open: BezierPath = { ...a, closed: false };
    expect(area(mergePaths([open, b], "add"))).toBeCloseTo(17500, 6);
    expect(mergePaths([], "add")).toEqual([]);
    expect(mergePaths([{ vertices: [], closed: true }], "add")).toEqual([]);
    expect(area(mergePaths([a, { vertices: [], closed: true }], "add"))).toBeCloseTo(10000, 6);
    expect(mergePaths([a, { vertices: [], closed: true }], "intersect")).toEqual([]);
    expect(mergePaths([{ vertices: [], closed: true }, a], "subtract")).toEqual([]);
  });

  it("works far from the origin and at small sizes", () => {
    const shift = 1e5;
    const far = [square(shift, shift), square(shift + 50, shift + 50)];
    expect(area(mergePaths(far, "add"))).toBeCloseTo(17500, 3);
    const tiny = [square(0, 0, 0.01), square(0.005, 0.005, 0.01)];
    expect(area(mergePaths(tiny, "add"))).toBeCloseTo(1.75e-4, 9);
  });

  it("doesn't touch its input", () => {
    const paths = freeze([square(0, 0), circle(50, 80, 80)]);
    expect(() => mergePaths(paths, "exclude")).not.toThrow();
  });

  it("merges a grid of overlapping circles in reasonable time", () => {
    const paths: BezierPath[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) paths.push(circle(40, i * 50, j * 50));
    const started = Date.now();
    const union = mergePaths(paths, "add");
    expect(Date.now() - started).toBeLessThan(3000);
    // One blob: the circles are close enough to leave no hole between four of them.
    expect(union.filter((p) => signedArea(p) > 0).length).toBe(1);
    expect(union.filter((p) => signedArea(p) < 0).length).toBe(0);
    expect(contains(union, [25, 25])).toBe(true);
    expect(contains(union, [-45, -45])).toBe(false);
  });
});

describe("trimPaths", () => {
  const ellipse = ellipsePath(0, 0, 120, 60);
  const total = pathLength(ellipse);
  const line = polygonPath([[0, 0], [100, 0], [100, 100]], false);
  /** The vertices' points, rounded to a millionth of a px (cuts are found numerically). */
  const corners = (path: BezierPath) => path.vertices.map((v) => v.point.map((x) => Math.round(x * 1e6) / 1e6 + 0));
  const lengths = (paths: BezierPath[]) => paths.map((p) => pathLength(p));

  it("keeps the fraction of a curved path's length", () => {
    for (const [s, e] of [[0, 0.5], [0.25, 0.75], [0.1, 0.13], [0.4, 1], [0.33, 0.34]]) {
      const result = trimPaths([ellipse], s, e, 0, "simultaneously");
      expect(result.length).toBe(1);
      expect(result[0].closed).toBe(false);
      expect(pathLength(result[0])).toBeCloseTo((e - s) * total, 1);
    }
  });

  it("keeps true curves: every point of the result is on the path", () => {
    const [part] = trimPaths([ellipse], 0.1, 0.65, 0, "simultaneously");
    // Three whole-ish quarters: far fewer vertices than a flattened curve would have.
    expect(part.vertices.length).toBeLessThanOrEqual(5);
    for (let i = 0; i <= 40; i++) {
      const p = pointAtLength(part, (pathLength(part) * i) / 40)!.point;
      expect(distanceToPath(ellipse, p)!.distance).toBeLessThan(1e-6);
    }
    const first = part.vertices[0].point;
    const last = part.vertices[part.vertices.length - 1].point;
    const at = (f: number) => pointAtLength(ellipse, f * total)!.point;
    expect(Math.hypot(first[0] - at(0.1)[0], first[1] - at(0.1)[1])).toBeLessThan(0.05);
    expect(Math.hypot(last[0] - at(0.65)[0], last[1] - at(0.65)[1])).toBeLessThan(0.05);
  });

  it("cuts straight paths exactly", () => {
    const [part] = trimPaths([line], 0.25, 0.75, 0, "simultaneously");
    expect(corners(part)).toEqual([[50, 0], [100, 0], [100, 50]]);
    expect(part.closed).toBe(false);
    const [head] = trimPaths([line], 0, 0.5, 0, "simultaneously");
    expect(corners(head)).toEqual([[0, 0], [100, 0]]);
    const [tail] = trimPaths([line], 0.5, 1, 0, "simultaneously");
    expect(corners(tail)).toEqual([[100, 0], [100, 100]]);
  });

  it("returns the same paths for the full range", () => {
    const paths = [ellipse, line];
    for (const mode of ["simultaneously", "individually"] as const) {
      const result = trimPaths(paths, 0, 1, 0, mode);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(ellipse);
      expect(result[1]).toBe(line);
      expect(result[0].closed).toBe(true);
      expect(trimPaths(paths, 1, 0, 0.3, mode)[0]).toBe(ellipse);
      expect(trimPaths(paths, -1, 2, 0, mode)[1]).toBe(line);
    }
  });

  it("keeps nothing when start equals end", () => {
    expect(trimPaths([ellipse, line], 0.4, 0.4, 0, "simultaneously")).toEqual([]);
    expect(trimPaths([ellipse, line], 0.4, 0.4, 0.2, "individually")).toEqual([]);
    expect(trimPaths([ellipse], 0, 0, 0, "simultaneously")).toEqual([]);
    expect(trimPaths([ellipse], 1, 1, 0, "simultaneously")).toEqual([]);
  });

  it("swaps start and end when they're the wrong way round", () => {
    const forwards = trimPaths([ellipse], 0.2, 0.7, 0, "simultaneously");
    const backwards = trimPaths([ellipse], 0.7, 0.2, 0, "simultaneously");
    expect(backwards.length).toBe(1);
    expect(samePath(forwards[0], backwards[0])).toBe(true);
  });

  it("moves the kept part along with the offset", () => {
    const shifted = trimPaths([ellipse], 0.1, 0.4, 0.25, "simultaneously");
    const direct = trimPaths([ellipse], 0.35, 0.65, 0, "simultaneously");
    expect(shifted.length).toBe(1);
    expect(samePath(shifted[0], direct[0], 1e-6)).toBe(true);
    // Whole turns change nothing, and negative offsets wrap.
    expect(samePath(trimPaths([ellipse], 0.1, 0.4, 3.25, "simultaneously")[0], direct[0], 1e-6)).toBe(true);
    expect(samePath(trimPaths([ellipse], 0.1, 0.4, -0.75, "simultaneously")[0], direct[0], 1e-6)).toBe(true);
  });

  it("wraps a closed path into one piece through its start vertex", () => {
    const result = trimPaths([ellipse], 0.5, 0.9, 0.3, "simultaneously");
    expect(result.length).toBe(1);
    const [part] = result;
    expect(part.closed).toBe(false);
    expect(pathLength(part)).toBeCloseTo(0.4 * total, 1);
    // From 80% round, through the start (the top of the ellipse), to 20%.
    const start = ellipse.vertices[0];
    const through = part.vertices.find((v) => Math.hypot(v.point[0] - start.point[0], v.point[1] - start.point[1]) < 1e-9);
    expect(through).toBeDefined();
    // The start vertex keeps its smooth handles: no kink where the path used to close.
    expect(through!.in[1]).toBeCloseTo(0, 9);
    expect(through!.out[1]).toBeCloseTo(0, 9);
    expect(through!.in[0]).toBeLessThan(0);
    expect(through!.out[0]).toBeGreaterThan(0);
    const first = part.vertices[0].point;
    const at = pointAtLength(ellipse, 0.8 * total)!.point;
    expect(Math.hypot(first[0] - at[0], first[1] - at[1])).toBeLessThan(0.05);
    for (let i = 0; i <= 20; i++) {
      const p = pointAtLength(part, (pathLength(part) * i) / 20)!.point;
      expect(distanceToPath(ellipse, p)!.distance).toBeLessThan(1e-6);
    }
  });

  it("wraps an open path into two pieces", () => {
    const result = trimPaths([line], 0.5, 0.9, 0.3, "simultaneously");
    expect(result.length).toBe(2);
    // The piece at the path's start comes first.
    expect(corners(result[0])).toEqual([[0, 0], [40, 0]]);
    expect(corners(result[1])).toEqual([[100, 60], [100, 100]]);
    expect(lengths(result).reduce((a, b) => a + b)).toBeCloseTo(80, 6);
  });

  it("trims each path by the same fractions simultaneously", () => {
    const short = polygonPath([[0, 0], [100, 0]], false);
    const long = polygonPath([[0, 50], [300, 50]], false);
    const result = trimPaths([short, long], 0, 0.5, 0, "simultaneously");
    expect(result.length).toBe(2);
    expect(corners(result[0])).toEqual([[0, 0], [50, 0]]);
    expect(corners(result[1])).toEqual([[0, 50], [150, 50]]);
  });

  it("trims the paths as one long path individually", () => {
    const short = polygonPath([[0, 0], [100, 0]], false);
    const long = polygonPath([[0, 50], [300, 50]], false);
    // Half of 400 px: all of the first path and 100 px of the second.
    const half = trimPaths([short, long], 0, 0.5, 0, "individually");
    expect(half.length).toBe(2);
    expect(half[0]).toBe(short);
    expect(corners(half[1])).toEqual([[0, 50], [100, 50]]);
    // The first eighth is only on the first path.
    const eighth = trimPaths([short, long], 0, 0.125, 0, "individually");
    expect(eighth.length).toBe(1);
    expect(corners(eighth[0])).toEqual([[0, 0], [50, 0]]);
    // The last half is only on the second.
    const end = trimPaths([short, long], 0.5, 1, 0, "individually");
    expect(end.length).toBe(1);
    expect(corners(end[0])).toEqual([[100, 50], [300, 50]]);
    // Wrapping past the end comes back in on the first path.
    const wrapped = trimPaths([short, long], 0.5, 1, 0.125, "individually");
    expect(wrapped.length).toBe(2);
    expect(corners(wrapped[0])).toEqual([[0, 0], [50, 0]]);
    expect(corners(wrapped[1])).toEqual([[150, 50], [300, 50]]);
    expect(lengths(wrapped).reduce((a, b) => a + b)).toBeCloseTo(200, 6);
  });

  it("keeps the fraction of the total length individually, on curves", () => {
    const paths = [ellipse, circle(30, 300, 0), line];
    const sum = paths.reduce((s, p) => s + pathLength(p), 0);
    for (const [s, e, o] of [[0.1, 0.8, 0], [0.3, 0.5, 0.45], [0, 0.95, 0.5]]) {
      const result = trimPaths(paths, s, e, o, "individually");
      expect(lengths(result).reduce((a, b) => a + b, 0)).toBeCloseTo((e - s) * sum, 0);
    }
  });

  it("skips paths without a length and doesn't touch its input", () => {
    const dot = polygonPath([[5, 5]], false);
    expect(trimPaths([dot], 0, 0.5, 0, "simultaneously")).toEqual([]);
    expect(trimPaths([dot], 0, 0.5, 0, "individually")).toEqual([]);
    const frozen = freeze([ellipsePath(0, 0, 50, 80), polygonPath([[0, 0], [100, 0], [100, 100]], false)]);
    expect(() => trimPaths(frozen, 0.2, 0.9, 0.4, "simultaneously")).not.toThrow();
    expect(() => trimPaths(frozen, 0.2, 0.9, 0.4, "individually")).not.toThrow();
  });
});

describe("offsetPath", () => {
  const box = square(0, 0);

  it("grows a square with mitred corners", () => {
    const result = offsetPath(box, 10, "miter");
    expect(result.length).toBe(1);
    expect(area(result)).toBeCloseTo(120 * 120, 6);
    expect(result[0].vertices.length).toBe(4);
    expect(isPolygon(result[0])).toBe(true);
    expect(contains(result, [-9, -9])).toBe(true);
    expect(contains(result, [-11, 50])).toBe(false);
    // Miter is the default.
    expect(area(offsetPath(box, 10))).toBeCloseTo(120 * 120, 6);
  });

  it("grows a square with round corners", () => {
    const result = offsetPath(box, 10, "round", 4, 0.01);
    expect(result.length).toBe(1);
    const expected = 100 * 100 + 4 * 100 * 10 + Math.PI * 100;
    expect(Math.abs(area(result) - expected)).toBeLessThan(1);
    expect(contains(result, [-9, -9])).toBe(false);
    expect(contains(result, [-6, -6])).toBe(true);
  });

  it("grows a square with bevelled corners, and when the miter is too long", () => {
    const expected = 120 * 120 - 4 * 50;
    expect(area(offsetPath(box, 10, "bevel"))).toBeCloseTo(expected, 6);
    expect(offsetPath(box, 10, "bevel")[0].vertices.length).toBe(8);
    expect(area(offsetPath(box, 10, "miter", 1))).toBeCloseTo(expected, 6);
  });

  it("shrinks a square", () => {
    const result = offsetPath(box, -10);
    expect(result.length).toBe(1);
    expect(result[0].vertices.length).toBe(4);
    expect(area(result)).toBeCloseTo(80 * 80, 6);
    expect(contains(result, [5, 50])).toBe(false);
    expect(contains(result, [15, 50])).toBe(true);
  });

  it("shrinks a shape away past half its size", () => {
    expect(offsetPath(box, -60)).toEqual([]);
    expect(offsetPath(box, -51, "round")).toEqual([]);
    expect(offsetPath(circle(50), -55, "round")).toEqual([]);
  });

  it("grows and shrinks a circle", () => {
    const disc = circle(50);
    const grown = offsetPath(disc, 10, "round", 4, 0.01);
    expect(grown.length).toBe(1);
    expect(Math.abs(area(grown) - Math.PI * 3600) / (Math.PI * 3600)).toBeLessThan(0.005);
    const shrunk = offsetPath(disc, -10, "round", 4, 0.01);
    expect(shrunk.length).toBe(1);
    expect(Math.abs(area(shrunk) - Math.PI * 1600) / (Math.PI * 1600)).toBeLessThan(0.005);
    for (const v of grown[0].vertices) expect(Math.hypot(v.point[0], v.point[1])).toBeCloseTo(60, 0);
    for (const v of shrunk[0].vertices) expect(Math.hypot(v.point[0], v.point[1])).toBeCloseTo(40, 0);
  });

  it("splits a shape when a shrink closes its neck", () => {
    // Two 100 px squares joined by a bridge 10 px thick.
    const dumbbell = polygonPath(
      [[0, 0], [100, 0], [100, 45], [200, 45], [200, 0], [300, 0], [300, 100], [200, 100], [200, 55], [100, 55], [100, 100], [0, 100]],
      true,
    );
    const result = offsetPath(dumbbell, -10);
    expect(result.length).toBe(2);
    expect(area(result)).toBeCloseTo(2 * 80 * 80, 6);
    expect(result.every((p) => signedArea(p) > 0)).toBe(true);
  });

  it("closes a hole when a growth fills a notch", () => {
    // A C shape whose 10 px opening closes, leaving a hole.
    const c = polygonPath([[0, 0], [100, 0], [100, 45], [50, 45], [50, 55], [100, 55], [100, 100], [0, 100]], true);
    const result = offsetPath(c, 2);
    expect(result.length).toBe(1);
    const closed = offsetPath(polygonPath([[0, 0], [100, 0], [100, 40], [95, 40], [95, 30], [50, 30], [50, 70], [95, 70], [95, 60], [100, 60], [100, 100], [0, 100]], true), 12);
    expect(closed.filter((p) => signedArea(p) > 0).length).toBe(1);
    expect(closed.filter((p) => signedArea(p) < 0).length).toBe(1);
  });

  it("offsets a path wound the other way the same", () => {
    const reversed = polygonPath([[0, 0], [0, 100], [100, 100], [100, 0]], true);
    expect(area(offsetPath(reversed, 10))).toBeCloseTo(120 * 120, 6);
    expect(area(offsetPath(reversed, -10))).toBeCloseTo(80 * 80, 6);
  });

  it("returns the path itself for no amount or an open path", () => {
    expect(offsetPath(box, 0)).toEqual([box]);
    expect(offsetPath(box, 0)[0]).toBe(box);
    const open = polygonPath([[0, 0], [100, 0]], false);
    expect(offsetPath(open, 10)[0]).toBe(open);
    expect(offsetPath(open, 10).length).toBe(1);
    expect(() => offsetPath(freeze(square(0, 0)), 10)).not.toThrow();
  });
});

describe("zigZag", () => {
  const box = square(0, 0);
  const line = polygonPath([[0, 0], [100, 0]], false);

  it("adds ridges to every segment", () => {
    expect(zigZag(box, 5, 3, "corner").vertices.length).toBe(16);
    expect(zigZag(box, 5, 0, "corner").vertices.length).toBe(4);
    expect(zigZag(line, 5, 3, "corner").vertices.length).toBe(5);
    expect(zigZag(polygonPath([[0, 0], [100, 0], [100, 100]], false), 5, 2, "smooth").vertices.length).toBe(7);
    expect(zigZag(circle(50), 5, 4, "smooth").vertices.length).toBe(20);
  });

  it("rounds the ridge count and never goes below none", () => {
    expect(zigZag(line, 5, 2.6, "corner").vertices.length).toBe(5);
    expect(zigZag(line, 5, -4, "corner").vertices.length).toBe(2);
    expect(zigZag(line, 5, Number.NaN, "corner").vertices.length).toBe(2);
  });

  it("pushes points alternately to each side by the size", () => {
    const result = zigZag(line, 5, 3, "corner");
    expect(result.vertices.map((v) => v.point[0])).toEqual([0, 25, 50, 75, 100].map((x) => expect.closeTo(x, 6)));
    expect(result.vertices.map((v) => v.point[1])).toEqual([5, -5, 5, -5, 5].map((y) => expect.closeTo(y, 6)));
    for (const v of result.vertices) {
      expect(v.in).toEqual([0, 0]);
      expect(v.out).toEqual([0, 0]);
    }
    // A negative size starts on the other side.
    expect(zigZag(line, -5, 3, "corner").vertices[0].point[1]).toBeCloseTo(-5, 6);
  });

  it("moves every point exactly the size off the path", () => {
    const disc = circle(50);
    for (const v of zigZag(disc, 4, 5, "corner").vertices) {
      expect(Math.abs(Math.hypot(v.point[0], v.point[1]) - 50)).toBeCloseTo(4, 1);
    }
    const radii = zigZag(disc, 4, 5, "corner").vertices.map((v) => Math.hypot(v.point[0], v.point[1]) > 50);
    radii.forEach((out, i) => expect(out).toBe(i % 2 === 1 ? !radii[0] : radii[0]));
  });

  it("makes waves with handles along the path", () => {
    const result = zigZag(line, 5, 3, "smooth");
    const inner = result.vertices[2];
    expect(inner.in[0]).toBeCloseTo(-25 / 3, 6);
    expect(inner.in[1]).toBeCloseTo(0, 6);
    expect(inner.out[0]).toBeCloseTo(25 / 3, 6);
    expect(inner.out[1]).toBeCloseTo(0, 6);
    // An open path's ends have no handle pointing off the path.
    expect(result.vertices[0].in).toEqual([0, 0]);
    expect(result.vertices[4].out).toEqual([0, 0]);
  });

  it("keeps closed paths closed and open ones open", () => {
    expect(zigZag(box, 5, 3, "corner").closed).toBe(true);
    expect(zigZag(box, 5, 3, "smooth").closed).toBe(true);
    expect(zigZag(line, 5, 3, "smooth").closed).toBe(false);
  });

  it("returns the same path when the size is 0", () => {
    expect(zigZag(box, 0, 3, "corner")).toBe(box);
    expect(zigZag(box, 0, 0, "smooth")).toBe(box);
    expect(zigZag(box, Number.NaN, 3, "corner")).toBe(box);
  });

  it("is deterministic and doesn't touch its input", () => {
    expect(zigZag(box, 5, 3, "smooth")).toEqual(zigZag(box, 5, 3, "smooth"));
    expect(() => zigZag(freeze(circle(40)), 5, 3, "smooth")).not.toThrow();
  });
});

describe("wigglePath", () => {
  const box = square(0, 0);
  const options = { size: 10, detail: 4, points: "corner" as const, speed: 2, time: 1.3, seed: 7 };
  const still = (path: BezierPath, o = options) => wigglePath(path, { ...o, size: 1e-12 });
  const moves = (a: BezierPath, b: BezierPath) =>
    a.vertices.map((v, i) => Math.hypot(v.point[0] - b.vertices[i].point[0], v.point[1] - b.vertices[i].point[1]));

  it("resamples by the detail, keeping the path's own vertices", () => {
    // 4 segments per 100 px: each 100 px side in four.
    const result = still(box);
    expect(result.vertices.length).toBe(16);
    box.vertices.forEach((v, i) => {
      expect(result.vertices[i * 4].point[0]).toBeCloseTo(v.point[0], 6);
      expect(result.vertices[i * 4].point[1]).toBeCloseTo(v.point[1], 6);
    });
    expect(result.vertices[1].point[0]).toBeCloseTo(25, 6);
    expect(result.vertices[1].point[1]).toBeCloseTo(0, 6);
    // At least one segment per original segment.
    expect(wigglePath(box, { ...options, detail: 0 }).vertices.length).toBe(4);
    expect(wigglePath(box, { ...options, detail: 0.2 }).vertices.length).toBe(4);
    expect(wigglePath(box, { ...options, detail: 10 }).vertices.length).toBe(40);
    const line = polygonPath([[0, 0], [200, 0]], false);
    expect(wigglePath(line, { ...options, detail: 2 }).vertices.length).toBe(5);
    expect(wigglePath(line, options).closed).toBe(false);
    expect(wigglePath(box, options).closed).toBe(true);
  });

  it("is deterministic", () => {
    expect(wigglePath(box, options)).toEqual(wigglePath(box, { ...options }));
    expect(wigglePath(circle(50), { ...options, points: "smooth" })).toEqual(wigglePath(circle(50), { ...options, points: "smooth" }));
  });

  it("changes with the seed and with time", () => {
    const a = wigglePath(box, options);
    expect(Math.max(...moves(a, wigglePath(box, { ...options, seed: 8 })))).toBeGreaterThan(1);
    expect(Math.max(...moves(a, wigglePath(box, { ...options, time: 4.1 })))).toBeGreaterThan(1);
    // Vertices don't all move the same way.
    const base = still(box);
    const offsets = a.vertices.map((v, i) => [v.point[0] - base.vertices[i].point[0], v.point[1] - base.vertices[i].point[1]]);
    expect(new Set(offsets.map((o) => Math.round(Math.atan2(o[1], o[0]) * 10))).size).toBeGreaterThan(4);
  });

  it("never moves a vertex further than the size", () => {
    for (const path of [box, circle(80), starPath(0, 0, 5, 30, 90)]) {
      for (const time of [0, 0.37, 1, 2.5, 13.99]) {
        for (const seed of [0, 1, 99]) {
          const o = { ...options, time, seed };
          const moved = moves(wigglePath(path, o), still(path, o));
          expect(Math.max(...moved)).toBeLessThanOrEqual(10 + 1e-9);
        }
      }
    }
    // And it does use the room it has.
    const all = [0, 1, 2, 3, 4, 5].flatMap((seed) => moves(wigglePath(circle(80), { ...options, seed }), still(circle(80), { ...options, seed })));
    expect(Math.max(...all)).toBeGreaterThan(7);
  });

  it("scales with the size", () => {
    const small = moves(wigglePath(box, { ...options, size: 5 }), still(box));
    const large = moves(wigglePath(box, options), still(box));
    small.forEach((d, i) => expect(large[i]).toBeCloseTo(d * 2, 6));
  });

  it("moves continuously in time", () => {
    const dt = 1e-4;
    // Including across the moment one wiggle hands over to the next (time × speed whole).
    for (const time of [0, 0.3, 0.5 - dt / 2, 1 - dt / 2, 1.3, 2, -0.5 - dt / 2, -1.7]) {
      const a = wigglePath(box, { ...options, time });
      const b = wigglePath(box, { ...options, time: time + dt });
      expect(Math.max(...moves(a, b))).toBeLessThan(0.02);
    }
    // No jump at the handover itself.
    const before = wigglePath(box, { ...options, time: 0.5 - 1e-9 });
    const after = wigglePath(box, { ...options, time: 0.5 });
    expect(Math.max(...moves(before, after))).toBeLessThan(1e-6);
  });

  it("stands still when the speed is 0 and moves over time otherwise", () => {
    const frozen = { ...options, speed: 0 };
    expect(wigglePath(box, { ...frozen, time: 0 })).toEqual(wigglePath(box, { ...frozen, time: 9 }));
    expect(Math.max(...moves(wigglePath(box, { ...options, time: 0 }), wigglePath(box, { ...options, time: 0.5 })))).toBeGreaterThan(1);
  });

  it("gives corners straight segments and smooth points handles", () => {
    for (const v of wigglePath(box, options).vertices) {
      expect(v.in).toEqual([0, 0]);
      expect(v.out).toEqual([0, 0]);
    }
    const smooth = wigglePath(box, { ...options, points: "smooth" });
    const corner = wigglePath(box, options);
    // The same points, now with handles that mirror each other.
    expect(moves(smooth, corner).every((d) => d === 0)).toBe(true);
    const n = smooth.vertices.length;
    smooth.vertices.forEach((v, i) => {
      expect(v.in[0]).toBeCloseTo(-v.out[0], 9);
      expect(v.in[1]).toBeCloseTo(-v.out[1], 9);
      const prev = smooth.vertices[(i - 1 + n) % n].point;
      const next = smooth.vertices[(i + 1) % n].point;
      expect(v.out[0]).toBeCloseTo((next[0] - prev[0]) / 6, 9);
      expect(v.out[1]).toBeCloseTo((next[1] - prev[1]) / 6, 9);
    });
    const open = wigglePath(polygonPath([[0, 0], [200, 0]], false), { ...options, points: "smooth" });
    expect(open.vertices[0].in).toEqual([0, 0]);
    expect(open.vertices[open.vertices.length - 1].out).toEqual([0, 0]);
  });

  it("returns the same path when the size is 0, and doesn't touch its input", () => {
    expect(wigglePath(box, { ...options, size: 0 })).toBe(box);
    expect(() => wigglePath(freeze(circle(40)), options)).not.toThrow();
    // Odd numbers don't break it.
    const odd = wigglePath(box, { ...options, time: Number.NaN, speed: Infinity, seed: Number.NaN, detail: Number.NaN });
    expect(odd.vertices.every((v) => Number.isFinite(v.point[0]) && Number.isFinite(v.point[1]))).toBe(true);
  });
});

describe("roundCorners", () => {
  const box = square(0, 0);

  it("turns each corner into an arc", () => {
    const result = roundCorners(box, 10);
    expect(result.closed).toBe(true);
    expect(result.vertices.length).toBe(8);
    // The same outline as a rounded rectangle.
    const rounded = rectPath(0, 0, 100, 100, 10);
    for (let i = 0; i < 60; i++) {
      const p = pointAtLength(result, (pathLength(result) * i) / 60)!.point;
      expect(distanceToPath(rounded, p)!.distance).toBeLessThan(1e-6);
    }
    expect(pathLength(result)).toBeCloseTo(pathLength(rounded), 6);
    // The first corner (top-left): in from the left side, out along the top.
    const [a, b] = result.vertices;
    expect(a.point).toEqual([0, 10]);
    expect(a.out[0]).toBeCloseTo(0, 9);
    expect(a.out[1]).toBeCloseTo(-10 * KAPPA, 9);
    expect(a.in).toEqual([0, 0]);
    expect(b.point).toEqual([10, 0]);
    expect(b.in[0]).toBeCloseTo(-10 * KAPPA, 9);
    expect(b.in[1]).toBeCloseTo(0, 9);
    expect(b.out).toEqual([0, 0]);
  });

  it("covers a little less than the sharp shape", () => {
    const sharp = polygonArea(box.vertices.map((v) => v.point));
    const result = mergePaths([roundCorners(box, 10)], "add", 0.01);
    expect(area(result)).toBeCloseTo(sharp - (4 - Math.PI) * 100, 0);
  });

  it("caps the radius at half the shorter neighbouring segment", () => {
    const result = roundCorners(box, 500);
    // Arcs meet in the middle of each side and share that vertex: a near circle.
    expect(result.vertices.length).toBe(4);
    expect(result.vertices.map((v) => v.point)).toEqual([[0, 50], [50, 0], [100, 50], [50, 100]]);
    for (let i = 0; i < 40; i++) {
      const p = pointAtLength(result, (pathLength(result) * i) / 40)!.point;
      expect(Math.hypot(p[0] - 50, p[1] - 50)).toBeCloseTo(50, 1);
    }
    const wide = roundCorners(rectPath(0, 0, 200, 40), 500);
    expect(wide.vertices.length).toBe(6);
    expect(samePath(roundCorners(box, 50), result)).toBe(true);
  });

  it("leaves vertices with handles alone", () => {
    const disc = circle(50);
    expect(roundCorners(disc, 10)).toBe(disc);
    // A rounded rectangle's vertices all touch a curve: nothing to round.
    const rounded = rectPath(0, 0, 100, 100, 10);
    expect(roundCorners(rounded, 5)).toBe(rounded);
    // A D shape: two corners on the left, an arc on the right.
    const d: BezierPath = {
      vertices: [
        { point: [0, 0], in: [0, 0], out: [0, 0] },
        { point: [50, 0], in: [0, 0], out: [60, 0] },
        { point: [50, 100], in: [60, 0], out: [0, 0] },
        { point: [0, 100], in: [0, 0], out: [0, 0] },
      ],
      closed: true,
    };
    const result = roundCorners(d, 10);
    expect(result.vertices.length).toBe(6);
    expect(result.vertices[2]).toEqual(d.vertices[1]);
    expect(result.vertices[3]).toEqual(d.vertices[2]);
  });

  it("leaves an open path's ends alone", () => {
    const open = polygonPath([[0, 0], [100, 0], [100, 100]], false);
    const result = roundCorners(open, 20);
    expect(result.closed).toBe(false);
    expect(result.vertices.map((v) => v.point)).toEqual([[0, 0], [80, 0], [100, 20], [100, 100]]);
    const line = polygonPath([[0, 0], [100, 0]], false);
    expect(roundCorners(line, 20)).toBe(line);
  });

  it("returns the same path for no radius", () => {
    expect(roundCorners(box, 0)).toBe(box);
    expect(roundCorners(box, -5)).toBe(box);
    expect(roundCorners(box, Number.NaN)).toBe(box);
  });

  it("is deterministic and doesn't touch its input", () => {
    expect(roundCorners(box, 10)).toEqual(roundCorners(box, 10));
    expect(() => roundCorners(freeze(starPath(0, 0, 5, 30, 80)), 8)).not.toThrow();
    expect(roundCorners(starPath(0, 0, 5, 30, 80), 8).vertices.length).toBe(20);
  });
});
