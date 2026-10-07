import { describe, expect, it } from "vitest";
import { DEFAULT_PRO_L_METER } from "@shared/music/pro-l-presets";
import { dbY, displaySeconds, headFraction, loudnessFraction, loudnessSpan, loudnessZone, peakText, relativeTo, scaleRange, scaleSteps, yDb } from "./geometry";

describe("YT-L's displays", () => {
  it("gives the top quarter of a scale half its height, and reads a level back", () => {
    expect(dbY(0, 32, 10, 200)).toBe(10);
    expect(dbY(-8, 32, 10, 200)).toBe(110);
    expect(dbY(-32, 32, 10, 200)).toBe(210);
    expect(dbY(-60, 32, 10, 200)).toBe(210);
    for (const db of [-0.5, -3, -8, -20, -31]) expect(yDb(dbY(db, 32, 10, 200), 32, 10, 200)).toBeCloseTo(db, 9);
  });

  it("knows each scale's range and the K-System's 0 marks", () => {
    expect(scaleRange("16")).toEqual({ range: 16, zero: 0 });
    expect(scaleRange("k14")).toEqual({ range: 34, zero: -14 });
    expect(scaleRange("loudness").range).toBe(48);
    expect(scaleSteps(32).slice(0, 6)).toEqual([0, -1, -2, -3, -6, -9]);
    expect(scaleSteps(48).at(-1)).toBe(-48);
  });

  it("scrolls as Pro-L 2's modes do", () => {
    expect(displaySeconds("fast", 0)).toBe(3);
    expect(displaySeconds("off", 10)).toBe(0);
    expect(displaySeconds("infinite", 40)).toBe(40);
    expect(headFraction("slowDown", 6, 3)).toBe(0.5);
    expect(headFraction("slowDown", 6, 30)).toBe(1);
    expect(headFraction("fast", 3, 0.1)).toBe(1);
  });

  it("places loudness on its bar and colours it by the target", () => {
    const meter = { ...DEFAULT_PRO_L_METER, target: -14, loudnessRange: 9 as const };
    expect(loudnessSpan(meter)).toEqual({ low: -41, high: -5 });
    expect(loudnessFraction(-14, meter)).toBeCloseTo(0.75, 9);
    expect(loudnessZone(-20, -14)).toBe("low");
    expect(loudnessZone(-14.5, -14)).toBe("near");
    expect(loudnessZone(-13.2, -14)).toBe("over");
    expect(relativeTo(-12, { ...meter, relative: true })).toBe(2);
    expect(relativeTo(-120, { ...meter, relative: true })).toBe(-120);
    expect(peakText(-120)).toBe("−∞");
    expect(peakText(-0.1)).toBe("−0.1");
  });
});
