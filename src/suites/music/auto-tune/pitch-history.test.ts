import { describe, expect, it } from "vitest";
import { KEPT_SECONDS, latestPitch, mergeReadings, readingAt } from "./pitch-history";

const state = (from: number, count: number, sung = 57.2) => ({
  latency: 2400,
  step: 0.005,
  points: Array.from({ length: count }, (_, i) => [from + i, sung, 57, 57] as [number, number, number, number]),
});

describe("an Auto-Tune's pitch history", () => {
  it("keeps each reading once, in order, timed from when the newest arrived", () => {
    let h = mergeReadings(undefined, state(100, 10), 1000);
    expect(h.readings.map((r) => r.n)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(readingAt(h, 109)).toBe(1000);
    expect(readingAt(h, 100)).toBe(955);
    // The next event repeats some: they're seen once; it's on time, so the anchor stays.
    h = mergeReadings(h, state(105, 10), 1025);
    expect(h.readings.map((r) => r.n).slice(-5)).toEqual([110, 111, 112, 113, 114]);
    expect(h.readings).toHaveLength(15);
    expect(h.anchorN).toBe(109);
    // Late by more than it should drift (a pause): timed afresh.
    h = mergeReadings(h, state(115, 2), 3000);
    expect(readingAt(h, 116)).toBe(3000);
  });

  it("forgets what's too old to show", () => {
    const perSecond = 200;
    let h = mergeReadings(undefined, state(0, 10), 0);
    h = mergeReadings(h, state((KEPT_SECONDS + 2) * perSecond, 10), 1);
    expect(h.readings.every((r) => r.n > 2 * perSecond)).toBe(true);
  });

  it("says the newest pitch, if it's recent", () => {
    const h = mergeReadings(undefined, { ...state(0, 3), points: [[0, 57, 57, 57], [1, 58, 58, 58], [2, -1, -1, -1]] }, 1000);
    expect(latestPitch(h, 1000)?.sung).toBe(58);
    expect(latestPitch(h, 2000)).toBeNull();
    expect(latestPitch(undefined, 0)).toBeNull();
  });
});
