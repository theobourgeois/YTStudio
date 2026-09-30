import { describe, expect, it } from "vitest";
import {
  bezierProgress,
  bezierSlope,
  easedProgress,
  keyframeSpeed,
  keyframeValue,
  sanitizeKeyframes,
  segmentHandles,
  setKeyframe,
} from "./keyframes.ts";
import type { NumberSpec } from "./params.ts";
import type { Keyframe } from "./types.ts";

const NUMBER: NumberSpec = { kind: "number", key: "x", label: "X", default: 0, min: -100, max: 100, step: 1, decimals: 0 };

const key = (time: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({ time, value, easing: "linear", ...extra });

describe("Bézier handles (graph editor)", () => {
  it("follows the plain eased curve when no handle is set", () => {
    const a = key(0, 0, { easing: "ease" });
    const b = key(1, 10, { easing: "ease" });
    for (const f of [0.1, 0.25, 0.5, 0.8]) expect(keyframeValue([a, b], f)).toBeCloseTo(10 * easedProgress(f, true, true), 6);
  });

  it("uses a keyframe's handles over its easing", () => {
    const a = key(0, 0, { easing: "ease", handleOut: [0.5, 1] });
    const b = key(2, 10, { handleIn: [0.5, 1] });
    expect(segmentHandles(a, b)).toEqual({ out: [0.5, 1], in: [0.5, 1] });
    // Both handles at (0.5, 1): the value rushes up and levels off well before b.
    expect(keyframeValue([a, b], 1)).toBeCloseTo(10 * bezierProgress(0.5, 0.5, 1, 0.5, 1), 6);
    expect(keyframeValue([a, b], 1)).toBeGreaterThan(8);
  });

  it("can overshoot the next keyframe's value", () => {
    const a = key(0, 0, { handleOut: [0.3, 1.6] });
    const b = key(1, 1, { handleIn: [0.7, 1.4] });
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => keyframeValue([a, b], i / 50) as number));
    expect(peak).toBeGreaterThan(1.05);
  });

  it("has a slope that matches the curve", () => {
    const [x1, y1, x2, y2] = [0.2, 0.7, 0.6, 1.1];
    for (const f of [0.1, 0.4, 0.75]) {
      const d = 1e-5;
      const numeric = (bezierProgress(f + d, x1, y1, x2, y2) - bezierProgress(f - d, x1, y1, x2, y2)) / (2 * d);
      expect(bezierSlope(f, x1, y1, x2, y2)).toBeCloseTo(numeric, 3);
    }
    expect(bezierSlope(0.5, 1 / 3, 1 / 3, 2 / 3, 2 / 3)).toBeCloseTo(1, 6);
  });

  it("gives the speed graph in value per second", () => {
    const keys = [key(0, 0), key(2, 10)];
    expect(keyframeSpeed(keys, 1)).toBeCloseTo(5, 6);
    expect(keyframeSpeed(keys, 3)).toBe(0);
    const eased = [key(0, 0, { easing: "ease" }), key(2, 10, { easing: "ease" })];
    expect(keyframeSpeed(eased, 0.001)).toBeLessThan(0.1);
    expect(keyframeSpeed(eased, 1)).toBeCloseTo(7.5, 1);
    // A point's speed is along its path.
    const points: Keyframe[] = [
      { time: 0, value: [0, 0], easing: "linear" },
      { time: 1, value: [3, 4], easing: "linear" },
    ];
    expect(keyframeSpeed(points, 0.5)).toBeCloseTo(5, 6);
  });

  it("sanitises stored handles into their segment", () => {
    const [k] = sanitizeKeyframes(NUMBER, [
      { time: 0, value: 1, easing: "linear", handleOut: [0, 50], handleIn: [2, -1] },
    ]);
    expect(k.handleOut).toEqual([0.01, 10]);
    expect(k.handleIn).toEqual([0.99, -1]);
    const [bad] = sanitizeKeyframes(NUMBER, [{ time: 0, value: 1, easing: "linear", handleOut: ["x", 1] }]);
    expect(bad.handleOut).toBeUndefined();
  });

  it("keeps a keyframe's handles when its value changes", () => {
    const keys = [key(0, 0, { handleOut: [0.4, 0.2] })];
    expect(setKeyframe(keys, 0, 5)[0]).toEqual({ time: 0, value: 5, easing: "linear", handleOut: [0.4, 0.2] });
  });
});
