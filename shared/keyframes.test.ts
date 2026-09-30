import { describe, expect, it } from "vitest";
import {
  bezierProgress,
  bezierSlope,
  dynamicProgress,
  easedProgress,
  isDynamicSegment,
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

describe("arriving with a movement (overshoot, spring, bounce)", () => {
  const to = (easing: Keyframe["easing"], extra: Partial<Keyframe> = {}) => [key(0, 0), key(1, 100, { easing, ...extra })];
  const at = (keys: Keyframe[], t: number) => keyframeValue(keys, t) as number;
  const samples = (keys: Keyframe[]) => Array.from({ length: 101 }, (_, i) => at(keys, i / 100));

  it("start on the keyframe before and land exactly on their own", () => {
    for (const easing of ["overshoot", "spring", "bounce"] as const) {
      expect(dynamicProgress(easing, 0)).toBe(0);
      expect(dynamicProgress(easing, 1)).toBe(1);
      expect(at(to(easing), 0)).toBe(0);
      expect(at(to(easing), 1)).toBe(100);
      // Held after it, like any keyframe.
      expect(at(to(easing), 2)).toBe(100);
    }
  });

  it("overshoot goes past the value once and comes back; more with more influence", () => {
    const values = samples(to("overshoot"));
    expect(Math.max(...values)).toBeCloseTo(110, 0);
    expect(values.filter((v, i) => i > 0 && v >= 100 && values[i - 1] < 100)).toHaveLength(1);
    expect(Math.max(...samples(to("overshoot", { influence: 0.75 })))).toBeGreaterThan(125);
    // Quick off the mark: most of the way there in the first third.
    expect(at(to("overshoot"), 0.33)).toBeGreaterThan(80);
  });

  it("spring swings around the value, less each time; influence says how many times", () => {
    const crossings = (keys: Keyframe[]) => samples(keys).filter((v, i, all) => i > 0 && i < 100 && (v - 100) * (all[i - 1] - 100) < 0).length;
    expect(crossings(to("spring"))).toBe(3);
    expect(crossings(to("spring", { influence: 0.75 }))).toBeGreaterThan(5);
    const values = samples(to("spring"));
    const peak = Math.max(...values);
    expect(peak).toBeGreaterThan(110);
    // The second time past, it's closer than the first.
    expect(Math.max(...values.slice(60))).toBeLessThan(peak - 8);
  });

  it("bounce lands and bounces lower each time, never going past", () => {
    const values = samples(to("bounce"));
    expect(Math.max(...values)).toBeLessThanOrEqual(100);
    const landings = values.filter((v, i, all) => i > 0 && i < 100 && v > 99 && all[i - 1] <= v && all[i + 1] < v).length;
    expect(landings).toBeGreaterThanOrEqual(2);
  });

  it("give a speed, give way to graph handles, and survive saving", () => {
    expect(keyframeSpeed(to("overshoot"), 0.1)).toBeGreaterThan(100);
    expect(keyframeSpeed(to("overshoot"), 0.8)).toBeLessThan(0);
    // A handle on either end makes it a Bézier curve again.
    expect(isDynamicSegment(key(0, 0), key(1, 1, { easing: "spring" }))).toBe(true);
    expect(isDynamicSegment(key(0, 0, { handleOut: [0.3, 0] }), key(1, 1, { easing: "spring" }))).toBe(false);
    expect(Math.max(...samples([key(0, 0), key(1, 100, { easing: "overshoot", handleIn: [0.7, 1] })]))).toBeLessThanOrEqual(100.0001);
    expect(sanitizeKeyframes(NUMBER, to("spring", { influence: 0.5 }))).toEqual(to("spring", { influence: 0.5 }));
    // The way it leaves its own keyframe is plain.
    const three = [key(0, 0), key(1, 50, { easing: "bounce" }), key(2, 100)];
    expect(at(three, 1.5)).toBe(75);
  });
});
