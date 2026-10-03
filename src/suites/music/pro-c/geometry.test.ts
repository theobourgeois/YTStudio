import { describe, expect, it } from "vitest";
import { PRO_C_SCALES, VINTAGE_TIMES } from "@shared/music/pro-c-presets";
import type { EngineProCState } from "@shared/music/engine";
import { mergePoints } from "./history";
import {
  RATIO_DOT_FRACTIONS,
  dbY,
  dialFraction,
  dialText,
  inputOfThreshold,
  kneeDb,
  kneeX,
  linearDb,
  meterFraction,
  nextScale,
  peakReductionOf,
  peakText,
  reductionY,
  scaleSteps,
  secondsAtDial,
  thresholdOfInput,
  thresholdOfPeakReduction,
  timeX,
  yDb,
} from "./geometry";

describe("the level display's scale", () => {
  it("puts 0 dB at the top and the scale at the bottom, and back", () => {
    expect(dbY(0, 36, 10, 360)).toBe(10);
    expect(dbY(-36, 36, 10, 360)).toBe(370);
    expect(dbY(-18, 36, 10, 360)).toBe(190);
    expect(dbY(-100, 36, 10, 360)).toBe(370);
    expect(dbY(6, 36, 10, 360)).toBe(10);
    expect(yDb(190, 36, 10, 360)).toBeCloseTo(-18);
  });
  it("hangs the gain reduction from the top on the same scale", () => {
    expect(reductionY(0, 72, 0, 720)).toBe(0);
    expect(reductionY(6, 72, 0, 720)).toBe(60);
    expect(reductionY(-3, 72, 0, 720)).toBe(0);
  });
  it("labels every few dB, from 0 down", () => {
    expect(scaleSteps(9)).toEqual([0, -1, -2, -3, -4, -5, -6, -7, -8, -9]);
    expect(scaleSteps(36)).toHaveLength(13);
    expect(scaleSteps(72).at(-1)).toBe(-72);
    expect(scaleSteps(90)).toEqual([0, -10, -20, -30, -40, -50, -60, -70, -80, -90]);
  });
  it("cycles the scales", () => {
    expect(nextScale(36)).toBe(54);
    expect(nextScale(PRO_C_SCALES.at(-1)!)).toBe(PRO_C_SCALES[0]);
  });
  it("scrolls right to left", () => {
    expect(timeX(0, 800)).toBe(800);
    expect(timeX(1000, 800)).toBeLessThan(800);
  });
});

describe("the knee display", () => {
  it("runs from the scale's bottom at its left to 0 dB at its right", () => {
    expect(kneeX(0, 36, 300)).toBe(300);
    expect(kneeX(-36, 36, 300)).toBe(0);
    expect(kneeX(-18, 36, 300)).toBe(150);
    expect(kneeDb(150, 36, 300)).toBeCloseTo(-18);
  });
});

describe("meters", () => {
  it("reads levels in dB and fills to 0 dB", () => {
    expect(linearDb(1)).toBe(0);
    expect(linearDb(0)).toBe(-120);
    expect(linearDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(meterFraction(0, 36)).toBe(1);
    expect(meterFraction(-18, 36)).toBe(0.5);
    expect(meterFraction(3, 36)).toBe(1);
    expect(peakText(-120)).toBe("−∞");
    expect(peakText(-15.04)).toBe("−15.0");
    expect(peakText(0)).toBe("0.0");
    expect(peakText(1.2)).toBe("+1.2");
  });
});

describe("the knobs", () => {
  it("puts the ratio's dots along the slope, ∞ at the end", () => {
    expect(RATIO_DOT_FRACTIONS.find((d) => d.ratio === 4)?.fraction).toBeCloseTo(0.75);
    expect(RATIO_DOT_FRACTIONS.at(-1)?.fraction).toBe(1);
  });
  it("shows a Vintage style's threshold as its Input, and Opto 2A's as Peak Reduction", () => {
    expect(inputOfThreshold(-18)).toBe(18);
    expect(thresholdOfInput(30)).toBe(-30);
    expect(thresholdOfInput(60)).toBe(-48);
    expect(peakReductionOf(-16)).toBeCloseTo(40);
    expect(thresholdOfPeakReduction(100)).toBeCloseTo(-40);
    expect(peakReductionOf(thresholdOfPeakReduction(55))).toBeCloseTo(55);
  });
  it("turns the 1176's dials with 7 (its fastest) at the right", () => {
    const fet = VINTAGE_TIMES.fet!;
    expect(dialFraction(fet.attack, fet.attack.min)).toBeCloseTo(1);
    expect(dialFraction(fet.attack, fet.attack.max)).toBeCloseTo(0);
    expect(dialText(fet.attack, 1)).toBe("7");
    expect(dialText(fet.attack, 0)).toBe("1");
    expect(secondsAtDial(fet.release, dialFraction(fet.release, 0.2))).toBeCloseTo(0.2);
  });
  it("turns the Distressor's from 0 to 10, slower to the right", () => {
    const d = VINTAGE_TIMES.distress!;
    expect(dialFraction(d.release, d.release.min)).toBe(0);
    expect(dialText(d.release, 0.5)).toBe("5");
    expect(secondsAtDial(d.attack, 1)).toBeCloseTo(d.attack.max);
  });
});

describe("the telemetry kept", () => {
  const state = (points: number, step = 0.005): EngineProCState => ({
    step,
    points: Array.from({ length: points }, (_, i) => [-20 + i, -24 + i, 4] as [number, number, number]),
    reduction: 4,
    key: -20,
    level: -20,
    threshold: -18,
    input: [0.1, 0.1],
    output: [0.08, 0.08],
    latency: 0,
  });
  it("adds each event's points, numbering them on", () => {
    let h = mergePoints(undefined, state(8), 1000);
    expect(h.points).toHaveLength(8);
    expect(h.last).toBe(8);
    h = mergePoints(h, state(8), 1040);
    expect(h.points).toHaveLength(16);
    expect(h.last).toBe(16);
    // On time: the anchor stays.
    expect(h.anchorAt).toBe(1000);
  });
  it("takes its anchor again when the clocks drift apart (a pause)", () => {
    const h = mergePoints(mergePoints(undefined, state(8), 1000), state(8), 5000);
    expect(h.anchorAt).toBe(5000);
    expect(h.anchorN).toBe(16);
  });
  it("lets the oldest go", () => {
    let h = mergePoints(undefined, state(1000, 0.05), 0);
    h = mergePoints(h, state(1000, 0.05), 50_000);
    expect(h.points.length).toBe(400);
  });
});
