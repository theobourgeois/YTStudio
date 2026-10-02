import { describe, expect, it } from "vitest";
import { type BandFilter, autoGain, bandSections, flatTiltSlope, playedBand, responseAt } from "./pro-q-filters.ts";
import { DEFAULT_PRO_Q_STATE, DEFAULT_BAND } from "./pro-q-presets.ts";
import type { EqBand, EqSlope } from "./types.ts";

const db = (band: BandFilter, hz: number) => {
  const [re, im] = responseAt(bandSections(band), hz);
  return 10 * Math.log10(re * re + im * im);
};
const band = (patch: Partial<BandFilter>): BandFilter => ({ shape: "bell", slope: 12, frequency: 1000, q: 1, gain: 0, ...patch });
const SLOPES: EqSlope[] = [6, 12, 18, 24, 30, 36, 48, 72, 96];
/** The frequencies either side of `f` where a bell's level is half its gain in dB (its Q's points). */
function halfGainPoints(b: BandFilter): [number, number] {
  const find = (lo: number, hi: number, rising: boolean) => {
    for (let i = 0; i < 80; i++) {
      const mid = Math.sqrt(lo * hi);
      const over = db(b, mid) > b.gain / 2;
      if (over === rising) hi = mid;
      else lo = mid;
    }
    return Math.sqrt(lo * hi);
  };
  return [find(10, b.frequency, true), find(b.frequency, 30_000, false)];
}
const octaves = ([lo, hi]: [number, number]) => Math.log2(hi / lo);

describe("Pro-Q's Q (the textbook Q times √2)", () => {
  it("is a bandwidth between the half-gain points: Q 2 one octave, 0.943 two, 0.571 three, 1 is 1.90", () => {
    expect(octaves(halfGainPoints(band({ gain: 12, q: 2 })))).toBeCloseTo(1, 3);
    expect(octaves(halfGainPoints(band({ gain: 12, q: 0.943 })))).toBeCloseTo(2, 2);
    expect(octaves(halfGainPoints(band({ gain: 12, q: 0.571 })))).toBeCloseTo(3, 2);
    const [lo, hi] = halfGainPoints(band({ gain: 12, q: 1 }));
    expect(lo).toBeCloseTo(517, -1);
    expect(hi).toBeCloseTo(1931, -1);
  });

  it("keeps a bell's half-gain points where they are at every slope, its cut the inverse of its boost", () => {
    const at12 = halfGainPoints(band({ gain: 9, q: 1.5 }));
    for (const slope of [24, 48, 72, 96] as const) {
      const [lo, hi] = halfGainPoints(band({ gain: 9, q: 1.5, slope }));
      expect(lo).toBeCloseTo(at12[0], 0);
      expect(hi).toBeCloseTo(at12[1], 0);
    }
    for (const slope of [12, 24, 48] as const)
      for (const hz of [100, 700, 1000, 3000]) expect(db(band({ gain: -7, slope, q: 2 }), hz)).toBeCloseTo(-db(band({ gain: 7, slope, q: 2 }), hz), 6);
  });

  it("puts a bell's gain at its frequency and nothing far from it", () => {
    for (const slope of [12, 18, 24, 36, 96] as const) {
      const b = band({ gain: 12, slope, frequency: 400, q: 0.7 });
      expect(db(b, 400)).toBeCloseTo(12, 6);
      expect(Math.abs(db(b, 10))).toBeLessThan(0.2);
      expect(Math.abs(db(b, 30_000))).toBeLessThan(0.05);
    }
  });
});

describe("shelves", () => {
  it("are half their gain at their frequency, at every slope and Q, and their gain at the end", () => {
    for (const shape of ["lowShelf", "highShelf"] as const)
      for (const slope of SLOPES)
        for (const q of [0.3, 1, 3]) {
          const b = band({ shape, slope, q, gain: 10, frequency: 500 });
          expect(db(b, 500)).toBeCloseTo(5, 6);
          expect(db(b, shape === "lowShelf" ? 1 : 1e7)).toBeCloseTo(10, 2);
          expect(db(b, shape === "lowShelf" ? 1e7 : 1)).toBeCloseTo(0, 2);
        }
  });

  it("are Butterworth at Q 1 (no overshoot) and resonant above", () => {
    const flat = band({ shape: "highShelf", gain: 12, q: 1 });
    for (let hz = 20; hz < 20_000; hz *= 1.1) expect(db(flat, hz)).toBeLessThanOrEqual(12 + 1e-9);
    const resonant = band({ shape: "highShelf", gain: 12, q: 4 });
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => db(resonant, 20 * 1.04 ** i)))).toBeGreaterThan(13);
  });

  it("tilt about their frequency: -G/2 below, +G/2 above, 0 dB on it", () => {
    for (const slope of [6, 12, 24] as const) {
      const b = band({ shape: "tiltShelf", slope, gain: 8, frequency: 1000 });
      expect(db(b, 1000)).toBeCloseTo(0, 6);
      expect(db(b, 1)).toBeCloseTo(-4, 2);
      expect(db(b, 1e7)).toBeCloseTo(4, 2);
    }
  });
});

describe("cuts", () => {
  it("are 20·log10(Q/√2) at their frequency at every slope, plain Butterworth at Q 1", () => {
    for (const shape of ["lowCut", "highCut"] as const)
      for (const slope of SLOPES.filter((s) => s !== 6))
        for (const q of [0.5, 0.707, 1, 2, 5]) expect(db(band({ shape, slope, q, frequency: 300 }), 300)).toBeCloseTo(20 * Math.log10(q / Math.SQRT2), 6);
    // No hump at Q 1, even at 48 dB/oct.
    const cut = band({ shape: "lowCut", slope: 48, q: 1, frequency: 100 });
    for (let hz = 20; hz < 20_000; hz *= 1.05) expect(db(cut, hz)).toBeLessThanOrEqual(1e-9);
  });

  it("fall at their slope", () => {
    for (const slope of SLOPES) {
      const b = band({ shape: "highCut", slope, frequency: 100 });
      expect(db(b, 1600) - db(b, 3200)).toBeCloseTo(slope as number, 0);
    }
  });

  it("Brickwall: 3 dB down at its frequency, 100 dB down a tone past it, flat before", () => {
    const high = band({ shape: "highCut", slope: "brickwall", frequency: 1000 });
    expect(db(high, 1000)).toBeCloseTo(-3, 1);
    expect(db(high, 1130)).toBeLessThan(-95);
    for (let hz = 20; hz < 900; hz *= 1.1) expect(Math.abs(db(high, hz))).toBeLessThan(0.06);
    const low = band({ shape: "lowCut", slope: "brickwall", frequency: 1000 });
    expect(db(low, 1000)).toBeCloseTo(-3, 1);
    expect(db(low, 1000 / 1.13)).toBeLessThan(-95);
    expect(Math.abs(db(low, 5000))).toBeLessThan(0.06);
  });
});

describe("notch, band pass and flat tilt", () => {
  it("a notch takes its frequency out entirely, -3 dB at Ω = ±1", () => {
    for (const slope of [12, 24, 48] as const) {
      const b = band({ shape: "notch", slope, q: 2, frequency: 1000 });
      expect(db(b, 1000)).toBeLessThan(-100);
      // Ω = Qr·(w - 1/w) = 1 → w = (1/Qr + √(1/Qr² + 4)) / 2.
      const qr = 2 / Math.SQRT2;
      const w = (1 / qr + Math.sqrt(1 / qr ** 2 + 4)) / 2;
      expect(db(b, 1000 * w)).toBeCloseTo(-3.0103, 3);
      expect(Math.abs(db(b, 20))).toBeLessThan(0.01);
    }
  });

  it("a band pass is 0 dB at its frequency and falls at its slope outside", () => {
    for (const slope of [6, 12, 24, 48] as const) {
      const b = band({ shape: "bandPass", slope, q: 1, frequency: 1000 });
      expect(db(b, 1000)).toBeCloseTo(0, 6);
      expect(db(b, 30) - db(b, 15)).toBeCloseTo(slope, 0);
    }
  });

  it("a flat tilt is a straight line through its pivot, gain / 5 dB an octave", () => {
    for (const gain of [-30, -6, 15, 30]) {
      const b = band({ shape: "flatTilt", gain, frequency: 1000 });
      const slope = flatTiltSlope(gain);
      for (let hz = 20; hz <= 20_000; hz *= 1.07) expect(Math.abs(db(b, hz) - slope * Math.log2(hz / 1000))).toBeLessThan(0.08);
    }
    expect(flatTiltSlope(15)).toBeCloseTo(3, 1);
    expect(bandSections(band({ shape: "flatTilt", gain: 0 }))).toEqual([]);
  });
});

describe("the whole EQ", () => {
  const eqBand = (patch: Partial<EqBand>): EqBand => ({ ...DEFAULT_BAND, id: 1, ...patch });

  it("Gain Scale scales gains and ranges; Gain-Q narrows a boosted bell", () => {
    const played = playedBand(eqBand({ gain: 6, range: -4 }), { gainScale: 0.5, gainQ: true });
    expect(played.gain).toBe(3);
    expect(played.range).toBe(-2);
    expect(played.q).toBeGreaterThan(1);
    const cut = eqBand({ shape: "lowCut" });
    expect(playedBand(cut, { gainScale: 2, gainQ: true })).toBe(cut);
  });

  it("Auto Gain takes back what the curve adds, more for the mids than the extremes", () => {
    const state = (bands: EqBand[]) => ({ ...DEFAULT_PRO_Q_STATE, bands });
    expect(autoGain(state([]))).toBe(0);
    const mid = autoGain(state([eqBand({ gain: 6 })]));
    expect(mid).toBeLessThan(-0.8);
    expect(mid).toBeGreaterThan(-3);
    const air = autoGain(state([eqBand({ shape: "highShelf", frequency: 10_000, gain: 6 })]));
    expect(air).toBeLessThan(0);
    expect(air).toBeGreaterThan(mid - 1);
    // A cut is given back less than a boost is taken back: the curve's power is what's averaged.
    const cut = autoGain(state([eqBand({ gain: -6 })]));
    expect(cut).toBeGreaterThan(0.5);
    expect(cut).toBeLessThan(-mid);
  });
});
