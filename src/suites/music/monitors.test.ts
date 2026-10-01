import { describe, expect, it } from "vitest";
import { outputColourStops, peakLevel } from "./monitors";

describe("the output graph's colours", () => {
  it("are the meters': green from the middle, amber by -6 dB, red at its edge (0 dB)", () => {
    const stops = outputColourStops();
    expect(stops.map((s) => s.colour)).toEqual(["low", "low", "mid", "high"]);
    expect(stops[0].at).toBe(0);
    expect(stops.at(-1)!.at).toBe(1);
    expect(stops[2].at).toBeCloseTo(peakLevel(10 ** (-6 / 20)));
    expect(stops.every((s, i) => i === 0 || s.at >= stops[i - 1].at)).toBe(true);
  });
});
