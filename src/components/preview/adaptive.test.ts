import { describe, expect, it } from "vitest";
import { ADAPTIVE_LEVELS, FRAME_BUDGET_MS, LIVE_FRAME_BUDGET_MS, adaptiveLevel, nextAdaptiveLevel } from "./adaptive";

describe("adaptive resolution", () => {
  it("draws in full what fits the budget, and the fewest pixels it has for the heaviest", () => {
    expect(adaptiveLevel(10)).toBe(1);
    expect(adaptiveLevel(FRAME_BUDGET_MS)).toBe(1);
    // A 90 ms frame (a raymarched scene on a Retina monitor) fits at half its pixels a side.
    expect(adaptiveLevel(90)).toBe(0.5);
    expect(adaptiveLevel(10_000)).toBe(ADAPTIVE_LEVELS[ADAPTIVE_LEVELS.length - 1]);
  });

  it("goes down at once to the level that fits", () => {
    expect(nextAdaptiveLevel(1, 1, 290)).toBe(0.25);
    // Measured at half: 40 ms there is 160 ms in full.
    expect(nextAdaptiveLevel(0.5, 0.5, 40)).toBe(0.375);
  });

  it("goes up a step at a time, and only when the step up still fits", () => {
    expect(nextAdaptiveLevel(0.25, 0.25, 5)).toBe(0.375);
    expect(nextAdaptiveLevel(0.5, 0.5, 11)).toBe(0.75);
    // 20 ms at half would be 45 at three quarters: stay.
    expect(nextAdaptiveLevel(0.5, 0.5, 20)).toBe(0.5);
    // A cheap frame in full (the picture held still) brings it all the way back.
    expect(nextAdaptiveLevel(0.25, 1, 8)).toBe(1);
  });

  it("never swings: a level's cost after a step up stays under the budget", () => {
    for (let k = 1; k < ADAPTIVE_LEVELS.length; k++) {
      const [up, level] = [ADAPTIVE_LEVELS[k - 1], ADAPTIVE_LEVELS[k]];
      const cost = FRAME_BUDGET_MS * 0.4 - 0.01;
      expect(nextAdaptiveLevel(level, level, cost)).toBe(up);
      expect(cost * (up / level) ** 2).toBeLessThanOrEqual(FRAME_BUDGET_MS);
    }
  });

  it("holds a live picture to its own, tighter budget", () => {
    // 20 ms in full is fine while editing, but not for a visualizer due every 60th of a second.
    expect(nextAdaptiveLevel(1, 1, 20)).toBe(1);
    expect(nextAdaptiveLevel(1, 1, 20, LIVE_FRAME_BUDGET_MS)).toBe(0.5);
  });
});
