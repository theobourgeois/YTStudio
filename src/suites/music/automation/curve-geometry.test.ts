import { describe, expect, it } from "vitest";
import type { AutomationPoint } from "@shared/music/types";
import { CURVE_PAD, curveValueAt, curveX, curveY, draggedTension, hitCurve, tensionHandle } from "./curve-geometry";

const box = { x0: 100, pxPerTick: 0.5, top: 20, height: 46 };
const point = (tick: number, value: number, curve: AutomationPoint["curve"] = "single", tension = 0): AutomationPoint => ({ tick, value, tension, curve });
const points = [point(0, 0), point(96, 1), point(192, 0.5, "stairs")];

describe("an automation clip's curve on screen", () => {
  it("puts its ticks along and its values up, inside the box's padding", () => {
    expect(curveX(box, 96)).toBe(148);
    expect(curveY(box, 1)).toBe(20 + CURVE_PAD);
    expect(curveY(box, 0)).toBe(20 + 46 - CURVE_PAD);
    expect(curveValueAt(box, curveY(box, 0.3))).toBeCloseTo(0.3);
    expect(curveValueAt(box, 0)).toBe(1);
    expect(curveValueAt(box, 500)).toBe(0);
  });

  it("puts a segment's tension handle half-way along it, on the curve", () => {
    expect(tensionHandle(points, 0, box)).toBeNull();
    expect(tensionHandle(points, 1, box)).toEqual({ x: curveX(box, 48), y: curveY(box, 0.5) });
    const bent = [point(0, 0), point(96, 1, "single", 0.5)];
    expect(tensionHandle(bent, 1, box)!.y).toBeGreaterThan(curveY(box, 0.5));
  });

  it("finds the point under the pointer, then a tension handle, nothing further than a few px", () => {
    expect(hitCurve(points, box, curveX(box, 96) + 2, curveY(box, 1) - 2)).toEqual({ kind: "point", index: 1 });
    expect(hitCurve(points, box, curveX(box, 48), curveY(box, 0.5) + 1)).toEqual({ kind: "tension", index: 1 });
    expect(hitCurve(points, box, curveX(box, 48), curveY(box, 0.9))).toBeNull();
    // Outside the clip's window, points aren't there to grab.
    expect(hitCurve(points, box, curveX(box, 192), curveY(box, 0.5), 0, curveX(box, 150))).toBeNull();
    // Too narrow a segment has no handle.
    const narrow = { ...box, pxPerTick: 0.1 };
    expect(hitCurve(points, narrow, curveX(narrow, 48), curveY(narrow, 0.5))).toBeNull();
  });

  it("drags a tension so the handle follows the pointer: up raises a segment's middle, either way it goes", () => {
    // Rising: a lower tension starts faster, its middle higher.
    expect(draggedTension(points, 1, 0, 40, false)).toBeLessThan(0);
    // Falling: the other way.
    const falling = [point(0, 1), point(96, 0)];
    expect(draggedTension(falling, 1, 0, 40, false)).toBeGreaterThan(0);
    // Stairs: up is more steps.
    expect(draggedTension(points, 2, 0, 40, false)).toBeGreaterThan(0);
    // Ctrl: finer; never past its range.
    expect(Math.abs(draggedTension(points, 1, 0, 40, true))).toBeLessThan(Math.abs(draggedTension(points, 1, 0, 40, false)));
    expect(draggedTension(points, 1, 0, 1000, false)).toBe(-1);
  });
});
