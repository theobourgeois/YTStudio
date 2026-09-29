import { describe, expect, it } from "vitest";
import { LANE_PAD, clampDelta, laneLeft, laneTicks, snapTime, timeAtX } from "./keyframe-geometry";

const range = { start: 2, end: 6 };

describe("keyframe lanes", () => {
  it("map timeline time across the lane, inset at both ends", () => {
    expect(laneLeft(range, 2)).toBe(`calc(${LANE_PAD}px + (100% - ${2 * LANE_PAD}px) * 0)`);
    expect(laneLeft(range, 5)).toBe(`calc(${LANE_PAD}px + (100% - ${2 * LANE_PAD}px) * 0.75)`);
    // A 416 px lane: 400 px for 4 s.
    expect(timeAtX(range, LANE_PAD + 100, 416)).toBe(3);
    expect(timeAtX(range, 0, 416)).toBe(2);
    expect(timeAtX(range, 1000, 416)).toBe(6);
  });

  it("snap to nearby targets, else to frames", () => {
    expect(snapTime(3.02, [3, 4], 0.05, 30)).toBe(3);
    expect(snapTime(3.2, [3, 4], 0.05, 30)).toBeCloseTo(3.2);
    expect(snapTime(3.21, [], 0.05, 30)).toBeCloseTo(96 / 30);
  });

  it("keep moved keyframes inside the clip", () => {
    expect(clampDelta(-5, [11, 13], 10, 20)).toBe(-1);
    expect(clampDelta(10, [11, 13], 10, 20)).toBe(7);
    expect(clampDelta(0.5, [11, 13], 10, 20)).toBe(0.5);
    // One already outside doesn't pin the others.
    expect(clampDelta(-3, [9, 13], 10, 20)).toBe(-3);
  });

  it("label the ruler", () => {
    const ticks = laneTicks(range, 416);
    const majors = ticks.filter((t) => t.major);
    expect(majors[0]).toMatchObject({ time: 2, fraction: 0, label: "0:02" });
    expect(majors.at(-1)!.time).toBeLessThanOrEqual(6);
  });
});
