import { describe, expect, it } from "vitest";
import { ellipsePath, rectPath } from "@shared/path";
import type { Placement } from "@shared/transform";
import { canvasToFrame, dragBox, hitPath, pathOnCanvas } from "./path-geometry";

// A 200 x 100 frame at twice its size, its centre on (300, 200).
const placed: Placement = { width: 200, height: 100, anchorX: 100, anchorY: 50, x: 300, y: 200, scaleX: 2, scaleY: 2, rotation: 0 };

describe("paths on the monitor", () => {
  it("map between fractions of a clip's frame and canvas px", () => {
    const path = pathOnCanvas(rectPath(0, 0, 1, 1), placed);
    expect(path.vertices.map((v) => v.point)).toEqual([[100, 100], [500, 100], [500, 300], [100, 300]]);
    expect(canvasToFrame(placed, [300, 200])).toEqual([0.5, 0.5]);
    expect(canvasToFrame(placed, [100, 300])).toEqual([0, 1]);
    // Handles scale with the frame (they're relative to their point).
    expect(pathOnCanvas(ellipsePath(0.5, 0.5, 0.5, 0.5), placed).vertices[0].out[0]).toBeCloseTo(400 * 0.5 * 0.5523, 1);
    expect(canvasToFrame({ ...placed, scaleX: 0 }, [0, 0])).toBeNull();
    // Turned a quarter: the frame's right edge points down the canvas.
    const [x, y] = canvasToFrame({ ...placed, rotation: 90 }, [300, 400])!;
    expect([x, y].map((n) => Math.round(n * 100) / 100)).toEqual([1, 0.5]);
  });

  it("find what's under the pointer: a selected point's handle, a point, then the outline", () => {
    const path = pathOnCanvas(ellipsePath(0.5, 0.5, 0.25, 0.5), placed);
    // The top point is at (300, 100), its out handle to its right.
    const handle: [number, number] = [300 + path.vertices[0].out[0], 100];
    expect(hitPath(path, [300, 102], [], 7)).toEqual({ kind: "vertex", index: 0 });
    expect(hitPath(path, handle, [], 7)).toBeNull();
    expect(hitPath(path, handle, [0], 7)).toEqual({ kind: "handle", index: 0, side: "out" });
    const on = hitPath(path, [371, 129], [], 7);
    expect(on).toMatchObject({ kind: "segment", segmentIndex: 0 });
    expect(hitPath(path, [300, 200], [], 7)).toBeNull();
  });

  it("drag a box out from a corner, square with Shift", () => {
    expect(dragBox([10, 20], [110, 60], false)).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(dragBox([110, 60], [10, 20], false)).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(dragBox([10, 20], [110, 60], true)).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    expect(dragBox([110, 60], [10, 50], true)).toEqual({ x: 10, y: -40, width: 100, height: 100 });
  });
});
