import { describe, expect, it } from "vitest";
import { bandCurve } from "@shared/music/pro-q-filters";
import { EQ_SPECTRUM_POINTS, spectrumFrequency } from "@shared/music/pro-q-presets";
import { Average, collisions, matchBands, matchDifference, matchError } from "./match";

const FREQUENCIES = Float64Array.from({ length: EQ_SPECTRUM_POINTS }, (_, i) => spectrumFrequency(i));
/** A pink-ish spectrum with some bumps (dB). */
const music = Float64Array.from(FREQUENCIES, (hz) => -30 - 3 * Math.log2(hz / 1000) + 2 * Math.sin(Math.log2(hz) * 3));

describe("EQ Match", () => {
  it("finds the bands that turn the input into the reference", () => {
    // The reference: the input with a +6 dB bell at 2 kHz and -5 dB under 120 Hz, and 10 dB quieter (level doesn't count).
    const bell = bandCurve({ shape: "bell", slope: 12, frequency: 2000, q: 1, gain: 6 }, FREQUENCIES);
    const shelf = bandCurve({ shape: "lowShelf", slope: 12, frequency: 120, q: 1, gain: -5 }, FREQUENCIES);
    const reference = Float64Array.from(music, (v, i) => v + bell[i] + shelf[i] - 10);
    const difference = matchDifference(music, reference);
    const before = matchError(difference, []);
    const bands = matchBands(difference, 3);
    expect(bands.length).toBeGreaterThanOrEqual(2);
    const peak = bands.find((b) => b.shape === "bell" && b.gain > 3)!;
    expect(peak.frequency).toBeGreaterThan(1400);
    expect(peak.frequency).toBeLessThan(2800);
    expect(bands.some((b) => b.shape === "lowShelf" && b.gain < -2)).toBe(true);
    expect(matchError(difference, bands)).toBeLessThan(before / 3);
  });

  it("asks for nothing when the two are alike, whatever their levels", () => {
    const difference = matchDifference(music, music.map((v) => v - 12));
    expect(matchBands(difference, 5)).toEqual([]);
  });

  it("averages power over frames, leaving silence out", () => {
    const average = new Average();
    average.add(Array.from({ length: EQ_SPECTRUM_POINTS }, () => -20));
    average.add(Array.from({ length: EQ_SPECTRUM_POINTS }, () => -120));
    average.add(Array.from({ length: EQ_SPECTRUM_POINTS }, () => -26));
    expect(average.frames).toBe(2);
    expect(average.levels()[200]).toBeCloseTo(10 * Math.log10((10 ** -2 + 10 ** -2.6) / 2), 6);
  });
});

describe("collisions", () => {
  it("light where both stand out together, not where one is alone", () => {
    const bump = (center: number, height: number) => Float64Array.from(FREQUENCIES, (hz) => -60 + height * Math.exp(-((Math.log2(hz / center) / 0.3) ** 2)));
    const kick = bump(80, 40);
    const bass = Float64Array.from(bump(90, 38), (v, i) => Math.max(v, bump(800, 30)[i]));
    const c = collisions(kick, bass);
    const at = (hz: number) => c[FREQUENCIES.findIndex((f) => f >= hz)];
    expect(at(85)).toBeGreaterThan(0.5);
    expect(at(800)).toBe(0);
    expect(at(5000)).toBe(0);
  });
});
