import { describe, expect, it } from "vitest";
import { DEFAULT_PRECOMPUTED } from "@shared/music/project";
import { waveformColumns } from "./waveform";

/** A ramp up from -0.5 to just under 0.5 over 8 samples. */
const ramp = Float32Array.from([-0.5, -0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375]);
const list = (values: Float32Array) => [...values].map((v) => Math.round(v * 1000) / 1000);
const draw = (samples: Float32Array, precomputed = {}, columns = 4) => {
  const { min, max } = waveformColumns(samples, { ...DEFAULT_PRECOMPUTED, ...precomputed }, columns);
  return { min: list(min), max: list(max) };
};

describe("waveformColumns", () => {
  it("draws the lowest and highest sample of each column", () => {
    expect(draw(ramp)).toEqual({ min: [-0.5, -0.25, 0, 0.25], max: [-0.375, -0.125, 0.125, 0.375] });
    // More columns than samples: each sample is drawn more than once.
    expect(draw(Float32Array.from([1, -1]), {}, 4).max).toEqual([1, 1, -1, -1]);
    expect(draw(new Float32Array(0)).max).toEqual([0, 0, 0, 0]);
    expect(draw(ramp, {}, 0).max).toEqual([]);
  });

  it("trims from the start, then keeps a part of what's left", () => {
    expect(draw(ramp, { start: 0.5 }).min).toEqual([0, 0.125, 0.25, 0.375]);
    expect(draw(ramp, { start: 0.5, length: 0.5 }, 2).min).toEqual([0, 0.125]);
  });

  it("reverses, normalises and fades what's kept, in that order", () => {
    expect(draw(ramp, { reverse: true }).max).toEqual([0.375, 0.125, -0.125, -0.375]);
    expect(draw(ramp, { normalize: true }).min).toEqual([-1, -0.5, 0, 0.5]);
    const flat = new Float32Array(8).fill(1);
    expect(draw(flat, { fadeIn: 0.5 }, 8).max).toEqual([0, 0.25, 0.5, 0.75, 1, 1, 1, 1]);
    expect(draw(flat, { fadeOut: 0.5 }, 8).max).toEqual([1, 1, 1, 1, 1, 0.75, 0.5, 0.25]);
    // Reversed first, then faded: the fade is at the start of what plays.
    expect(draw(ramp, { reverse: true, fadeIn: 1 }, 8).max[0]).toBeCloseTo(0);
  });
});
