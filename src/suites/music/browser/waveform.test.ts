import { describe, expect, it } from "vitest";
import { columns, waveformStops } from "./waveform";

describe("columns", () => {
  it("keeps each column's lowest and highest point, the channels mixed", () => {
    const left = new Float32Array([0, 1, -1, 0.5, 0, 0, 0, 0]);
    const right = new Float32Array([0, 1, 1, 0.5, 0, 0, 0, -0.5]);
    const peaks = columns([left, right], 2, 2);
    expect([...peaks.max]).toEqual([1, 0]);
    expect([...peaks.min]).toEqual([0, -0.25]);
    expect(peaks.duration).toBe(2);
  });

  it("draws a short file across every column", () => {
    const peaks = columns([new Float32Array([0.5, -0.5])], 0.1, 4);
    expect([...peaks.max]).toEqual([0.5, 0.5, -0.5, -0.5]);
  });
});

describe("waveformStops", () => {
  it("colours the waveform as the meters do: green in the middle, red at its peaks, the same both ways", () => {
    const stops = waveformStops(44, 20);
    expect(stops[0]).toEqual({ offset: 2 / 44, colour: "var(--meter-high)" });
    expect(stops.at(-1)).toEqual({ offset: 42 / 44, colour: "var(--meter-high)" });
    // Half way to the top is -6 dB: amber.
    expect(stops.find((s) => s.colour === "var(--meter-mid)")!.offset).toBeCloseTo((22 - 10) / 44, 2);
    // The middle is green, and the offsets only go down the picture.
    expect(stops.filter((s) => s.offset === 0.5).every((s) => s.colour === "var(--meter-low)")).toBe(true);
    expect(stops.every((s, i) => i === 0 || s.offset >= stops[i - 1].offset)).toBe(true);
  });
});
