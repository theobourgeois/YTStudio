import { describe, expect, it } from "vitest";
import type { EngineProLState } from "@shared/music/engine";
import { columnAt, latestOf, mergeColumns } from "./history";

const state = (columns: number): EngineProLState => ({
  latency: 0,
  reduction: 0,
  input: [0, 0],
  output: [0, 0],
  truePeak: [0, 0],
  rms: [-120, -120],
  loudness: { momentary: -120, shortTerm: -120, integrated: -120, range: 0, maxMomentary: -120, maxShortTerm: -120, maxTruePeak: -120, seconds: 0, paused: false },
  clipped: 0,
  density: 0,
  maxClip: 0,
  maxReduction: 0,
  step: 0.01,
  columns: Array.from({ length: columns }, () => [-6, -6, 0, 0, -14, -14] as [number, number, number, number, number, number]),
});

describe("YT-L's column history", () => {
  it("adds columns on and times them evenly from an anchor", () => {
    let h = mergeColumns(undefined, state(4), 1000);
    expect(h.last).toBe(4);
    h = mergeColumns(h, state(4), 1040);
    expect(h.columns).toHaveLength(8);
    expect(h.last).toBe(8);
    // The anchor holds while the clocks agree: column 8 is 40 ms after column 4.
    expect(columnAt(h, 8) - columnAt(h, 4)).toBeCloseTo(40, 9);
    // A long gap takes the anchor again.
    h = mergeColumns(h, state(2), 5000);
    expect(columnAt(h, h.last)).toBe(5000);
  });

  it("keeps two minutes at most, and says what it said last only while it's recent", () => {
    let h = mergeColumns(undefined, state(12_000), 0);
    h = mergeColumns(h, state(100), 10);
    expect(h.columns).toHaveLength(12_000);
    expect(latestOf(h, 200)).not.toBeNull();
    expect(latestOf(h, 1000)).toBeNull();
  });
});
