import { describe, expect, it } from "vitest";
import { keyframeSpeed } from "@shared/keyframes";
import type { Keyframe } from "@shared/types";
import { graphRange, handleFromSpeed, handleFromValue, handleSegment, handleSpeed, matchingHandle, speedHandle, valueHandle } from "./graph-geometry";

const k = (time: number, value: number, extra: Partial<Keyframe> = {}): Keyframe => ({ time, value, easing: "linear", ...extra });

describe("graph editor geometry", () => {
  it("puts value handles where the easing says, and round-trips a drag", () => {
    const [a, b] = [k(0, 0, { easing: "ease" }), k(2, 10)];
    expect(valueHandle(a, b, "out")).toEqual({ time: 2 / 3, y: 0 });
    expect(valueHandle(a, b, "in")).toMatchObject({ time: 4 / 3 });
    expect(handleFromValue(a, b, 0.5, 4)).toEqual([0.25, 0.4]);
    expect(handleFromValue(k(0, 3), k(1, 3), 0.5, 4)).toBeNull();
  });

  it("reads and makes handles by speed", () => {
    const [a, b] = [k(0, 0), k(2, 10)];
    // A linear segment: 5 per second at both ends.
    expect(handleSpeed(a, b, "out")).toBeCloseTo(5);
    expect(handleSpeed(a, b, "in")).toBeCloseTo(5);
    const h = handleFromSpeed(a, b, "out", 1, 12)!;
    expect(h[0]).toBeCloseTo(0.5);
    const shaped = { ...a, handleOut: h };
    expect(speedHandle(shaped, b, "out").y).toBeCloseTo(12);
    expect(keyframeSpeed([shaped, b], 1e-4)).toBeCloseTo(12, 1);
    const hin = handleFromSpeed(a, b, "in", 1.5, 0)!;
    expect(hin).toEqual([0.75, 1]);
  });

  it("matches the other side's speed for a smooth keyframe", () => {
    const keys = [k(0, 0), k(1, 10), k(3, 30)];
    const h = matchingHandle(keys, 1, "out", 4)!;
    expect(handleSpeed(keys[1], { ...keys[2] }, "out")).toBeCloseTo(10);
    expect(handleSpeed({ ...keys[1], handleOut: h }, keys[2], "out")).toBeCloseTo(4);
    expect(handleSegment(keys, 0, "in")).toBeNull();
    expect(handleSegment([k(0, 0, { easing: "hold" }), k(1, 1)], 0, "out")).toBeNull();
  });

  it("pads the range", () => {
    expect(graphRange([0, 10])).toEqual({ min: -1.2, max: 11.2 });
    const flat = graphRange([5, 5]);
    expect(flat.min).toBeLessThan(5);
    expect(flat.max).toBeGreaterThan(5);
  });
});
