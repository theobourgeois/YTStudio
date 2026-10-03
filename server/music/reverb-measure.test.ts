import { describe, expect, it } from "vitest";
import { correlation, decayCurvature, echoDensity, gaussian, noise, octaveBand, reverbTime } from "./reverb-measure.ts";

const RATE = 48_000;
/** Gaussian noise decaying to -60 dB in `t60` seconds. */
const decaying = (t60: number, seconds: number, seed = 1) => {
  const g = gaussian(noise(seed));
  return Float64Array.from({ length: Math.round(seconds * RATE) }, (_, i) => g() * 10 ** ((-3 * i) / RATE / t60));
};

describe("measuring a reverb", () => {
  it("measures the T60 of decaying noise within 2 %, broadband and in octave bands", () => {
    for (const t60 of [0.4, 1.5, 4]) {
      const x = decaying(t60, t60 * 1.5 + 0.5);
      expect(Math.abs(reverbTime(x, RATE) / t60 - 1)).toBeLessThan(0.02);
      for (const band of [250, 1000, 8000]) expect(Math.abs(reverbTime(octaveBand(x, RATE, band), RATE) / t60 - 1)).toBeLessThan(0.08);
    }
  });

  it("finds a single slope straight and a double slope bent", () => {
    expect(decayCurvature(decaying(1, 2), RATE)).toBeLessThan(1.5);
    const a = decaying(0.3, 2, 2),
      b = decaying(2, 2, 3);
    const both = a.map((v, i) => v + 0.05 * b[i]);
    expect(decayCurvature(both, RATE)).toBeGreaterThan(3);
  });

  it("reads Gaussian noise as fully dense and sparse clicks as not", () => {
    const dense = echoDensity(decaying(10, 0.5));
    expect(dense.slice(5).every((d) => d.density > 0.85)).toBe(true);
    const sparse = new Float64Array(RATE / 2);
    for (let i = 0; i < sparse.length; i += 480) sparse[i] = 1;
    expect(echoDensity(sparse).every((d) => d.density < 0.5)).toBe(true);
  });

  it("correlates a signal with itself and not with other noise", () => {
    const a = decaying(10, 0.5, 4),
      b = decaying(10, 0.5, 5);
    expect(correlation(a, a)).toBeCloseTo(1, 6);
    expect(Math.abs(correlation(a, b))).toBeLessThan(0.05);
  });
});
