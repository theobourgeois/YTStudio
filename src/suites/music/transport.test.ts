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

  it("holds where play starts while a recording counts in, then moves on from there", () => {
    const counting = { ...state, countIn: 2 };
    expect(tickNow(counting, 1000, 120, 96, 384)).toBe(96);
    expect(tickNow(counting, 2900, 120, 96, 384)).toBe(96);
    expect(tickNow(counting, 3500, 120, 96, 384)).toBe(192);
  });
});
