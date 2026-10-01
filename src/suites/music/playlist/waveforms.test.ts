import { describe, expect, it } from "vitest";
import { buildPeaks, peakRange } from "./waveforms";

/** The lowest and highest of `samples[from..to)`, the slow way. */
function exact(samples: Float32Array, from: number, to: number): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (let i = from; i < to; i++) {
    low = Math.min(low, samples[i]);
    high = Math.max(high, samples[i]);
  }
  return [low, high];
}

describe("waveform peaks", () => {
  const samples = Float32Array.from({ length: 100_000 }, (_, i) => Math.sin(i / 37) * (i / 100_000));

  it("reads short ranges from the samples themselves", () => {
    expect(peakRange(buildPeaks(samples), 5000, 5020)).toEqual(exact(samples, 5000, 5020));
  });

  it("reads long ranges from a level, reaching at most a bucket past either end", () => {
    const peaks = buildPeaks(samples);
    for (const [from, to] of [
      [0, 1000],
      [12_345, 67_890],
      [0, 100_000],
    ]) {
      const [low, high] = peakRange(peaks, from, to);
      const [wide, wider] = exact(samples, Math.max(0, from - (to - from) / 4), Math.min(samples.length, to + (to - from) / 4));
      const [inLow, inHigh] = exact(samples, from, to);
      expect(low).toBeLessThanOrEqual(inLow);
      expect(high).toBeGreaterThanOrEqual(inHigh);
      expect(low).toBeGreaterThanOrEqual(wide);
      expect(high).toBeLessThanOrEqual(wider);
    }
  });

  it("is empty outside the file", () => {
    const peaks = buildPeaks(samples);
    expect(peakRange(peaks, 200_000, 300_000)).toEqual([0, 0]);
    expect(peakRange(peaks, -50, -10)).toEqual([0, 0]);
  });
});
