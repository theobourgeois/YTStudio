import { describe, expect, it } from "vitest";
import type { SerumLfoPoint } from "@shared/music/serum-sound";
import { addPoint, curvedStage, curveThrough, movePoint, pointAt, removePoint, segmentCurveThrough, shapePath, withCurve } from "./shape-model";

const triangle: SerumLfoPoint[] = [
  [0, 1],
  [0.5, 0, 0.3],
  [1, 1],
];

describe("an LFO's shape, edited", () => {
  it("moves a point between its neighbours, the ends kept at x 0 and 1, y within 0 to 1, its curve kept", () => {
    expect(movePoint(triangle, 1, 0.8, -0.2)).toEqual([[0, 1], [0.8, 0, 0.3], [1, 1]]);
    expect(movePoint(triangle, 1, 1.4, 0.5)[1]).toEqual([1, 0.5, 0.3]);
    expect(movePoint(triangle, 0, 0.3, 0.2)[0]).toEqual([0, 0.2]);
    expect(movePoint(triangle, 2, 0.3, 0.7)[2]).toEqual([1, 0.7]);
  });

  it("adds a point where it's put, in order, but never at an end", () => {
    expect(addPoint(triangle, 0.25, 0.4)).toEqual({ points: [[0, 1], [0.25, 0.4], [0.5, 0, 0.3], [1, 1]], index: 1 });
    expect(addPoint(triangle, 0, 0.4)).toBeNull();
    expect(addPoint(triangle, 1, 0.4)).toBeNull();
  });

  it("removes a point, but never an end", () => {
    expect(removePoint(triangle, 1)).toEqual([[0, 1], [1, 1]]);
    expect(removePoint(triangle, 0)).toEqual(triangle);
  });

  it("finds the point nearest a press, within reach", () => {
    expect(pointAt(triangle, 0.48, 0.05, 0.1)).toBe(1);
    expect(pointAt(triangle, 0.25, 0.5, 0.1)).toBe(-1);
  });

  it("draws straight segments straight, and a curved one through its ends", () => {
    expect(shapePath([[0, 1], [1, 0]], 100, 50)).toBe("M 0.0 50.0 L 100.0 0.0");
    const curved = shapePath(triangle, 100, 50);
    expect(curved.startsWith("M 0.0 50.0 L 50.0 0.0")).toBe(true);
    expect(curved.endsWith("L 100.0 50.0")).toBe(true);
  });
});

describe("curves, as their handles drag them", () => {
  it("bends an envelope stage, straight at 0.5, and finds the curve through a middle", () => {
    expect(curvedStage(0, 1, 0.5, 0.5)).toBeCloseTo(0.5);
    expect(curvedStage(0, 1, 0.5, 0.8)).toBeGreaterThan(0.5);
    expect(curvedStage(1, 0.25, 0.5, 0.7)).toBeLessThan(0.625);
    for (const [y0, y1, curve] of [[0, 1, 0.3], [1, 0.2, 0.75], [0.6, 0, 0.4]]) expect(curveThrough(y0, y1, curvedStage(y0, y1, 0.5, curve))).toBeCloseTo(curve);
    expect(curveThrough(0.5, 0.5, 0.2)).toBe(0.5);
  });

  it("puts an LFO segment's middle where its handle is dragged, and keeps a straight one as [x, y]", () => {
    const curve = segmentCurveThrough(1, 0, 0.8);
    const path = shapePath([[0, 1, curve], [1, 0]], 100, 100);
    expect(curve).toBeGreaterThan(0.5);
    expect(path).toMatch(/ L 50\.0 (7|8)\d\.\d/);
    expect(withCurve(triangle, 1, 0.5)[1]).toEqual([0.5, 0]);
    expect(withCurve(triangle, 0, 0.7)[0]).toEqual([0, 1, 0.7]);
  });
});
