import { describe, expect, it } from "vitest";
import type { SerumLfoPoint } from "@shared/music/serum-sound";
import { addPoint, movePoint, pointAt, removePoint, shapePath } from "./shape-model";

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
