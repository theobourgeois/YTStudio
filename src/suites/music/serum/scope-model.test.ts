import { describe, expect, it } from "vitest";
import { RIDGE_BINS, centroid, energy, follow, ridgeHeights, ridgeX, stereoPoints, triggered } from "./scope-model";

/** The engine's 480 points (10 Hz to 30 kHz), each `db`, with a peak of `peak` dB at `hz`. */
function spectrum(db: number, hz?: number, peak = 0): number[] {
  return Array.from({ length: 480 }, (_, i) => {
    const f = 10 * 3000 ** (i / 479);
    return hz && Math.abs(Math.log2(f / hz)) < 0.05 ? peak : db;
  });
}

describe("the Serum display's ridge", () => {
  it("is flat for silence, and rises where the sound is", () => {
    expect([...ridgeHeights(spectrum(-120))].every((h) => h === 0)).toBe(true);
    const heights = ridgeHeights(spectrum(-120, 1000, -6));
    const at = Math.floor(ridgeX(1000) * RIDGE_BINS);
    expect(Math.max(heights[at - 1], heights[at], heights[at + 1])).toBeGreaterThan(0.7);
    expect(heights[Math.floor(ridgeX(100) * RIDGE_BINS)]).toBe(0);
    expect(heights.length).toBe(RIDGE_BINS);
  });

  it("is tilted level: the same level reads higher up the spectrum", () => {
    const heights = ridgeHeights(spectrum(-40));
    expect(heights[RIDGE_BINS - 4]).toBeGreaterThan(heights[4]);
  });

  it("follows the sound quickly up and slowly down", () => {
    const current = new Float32Array([0, 1]);
    follow(current, new Float32Array([1, 0]), 1 / 60);
    expect(current[0]).toBeGreaterThan(0.35);
    expect(current[1]).toBeGreaterThan(0.9);
    for (let i = 0; i < 120; i++) follow(current, new Float32Array([1, 0]), 1 / 60);
    expect(current[0]).toBeCloseTo(1, 3);
    expect(current[1]).toBeLessThan(0.01);
  });

  it("says where the energy is and how much there is", () => {
    const low = new Float32Array(RIDGE_BINS);
    low[2] = 1;
    const high = new Float32Array(RIDGE_BINS);
    high[RIDGE_BINS - 3] = 1;
    expect(centroid(low)).toBeLessThan(0.1);
    expect(centroid(high)).toBeGreaterThan(0.9);
    expect(centroid(new Float32Array(RIDGE_BINS))).toBe(0.5);
    expect(energy(new Float32Array(RIDGE_BINS))).toBe(0);
    expect(energy(low)).toBeGreaterThan(0.6);
  });
});

describe("the Serum display's waveform and stereo picture", () => {
  it("starts the waveform on a rising zero crossing, so a steady note stands still", () => {
    const sine = (phase: number) => Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.1 + phase));
    const a = triggered(sine(1));
    const b = triggered(sine(2.5));
    expect(a.length).toBe(512);
    expect(a[0]).toBeGreaterThanOrEqual(0);
    expect(a[0]).toBeLessThan(0.1);
    expect(Math.abs(a[20] - b[20])).toBeLessThan(0.1);
    expect(triggered(new Array(1024).fill(0.5))[0]).toBe(0.5);
  });

  it("draws mono as a vertical line and the sides across", () => {
    const [mono] = stereoPoints([0.5], [0.5]);
    expect(mono[0]).toBeCloseTo(0, 6);
    expect(mono[1]).toBeCloseTo(0.707, 3);
    const [side] = stereoPoints([0.5], [-0.5]);
    expect(side[0]).toBeCloseTo(0.707, 3);
    expect(side[1]).toBeCloseTo(0, 6);
  });
});
