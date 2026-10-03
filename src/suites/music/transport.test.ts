import { describe, expect, it } from "vitest";
import { tickNow } from "./transport";

describe("tickNow", () => {
  // At 120 BPM, 96 ticks a beat: 192 ticks a second.
  const state = { playing: true, tick: 96, at: 1000, latencyMs: 0 };

  it("moves on from the engine's last word, round the loop", () => {
    expect(tickNow(state, 1500, 120, 96, 384)).toBe(192);
    expect(tickNow(state, 2500, 120, 96, 384)).toBe(0);
    expect(tickNow({ ...state, through: true }, 2500, 120, 96, 384)).toBe(384);
    expect(tickNow({ ...state, playing: false }, 1500, 120, 96, 384)).toBeNull();
  });

  it("moves continuously between reports even when output latency exceeds the report interval", () => {
    const delayed = { ...state, latencyMs: 100 };
    expect(tickNow(delayed, 1000, 120, 96, 384)).toBeCloseTo(76.8);
    expect(tickNow(delayed, 1016, 120, 96, 384)).toBeCloseTo(79.872);
    // The next engine report lands on the same extrapolated position, with no pause or jump.
    expect(tickNow({ ...delayed, tick: 103.68, at: 1040 }, 1040, 120, 96, 384))
      .toBeCloseTo(tickNow(delayed, 1040, 120, 96, 384)!);
    expect(tickNow({ ...delayed, tick: 0 }, 1000, 120, 96, 384)).toBeNull();
  });

  it("holds where play starts while a recording counts in, then moves on from there", () => {
    const counting = { ...state, countIn: 2 };
    expect(tickNow(counting, 1000, 120, 96, 384)).toBe(96);
    expect(tickNow(counting, 2900, 120, 96, 384)).toBe(96);
    expect(tickNow(counting, 3500, 120, 96, 384)).toBe(192);
  });
});
