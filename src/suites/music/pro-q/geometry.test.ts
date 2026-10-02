import { describe, expect, it } from "vitest";
import { EQ_SPECTRUM_POINTS, spectrumFrequency } from "@shared/music/pro-q-presets";
import { DEFAULT_BAND } from "@shared/music/pro-q-presets";
import { type EqView, bandAt, dbAt, dotOf, frequencyLines, gainSteps, hzAt, qAtHeight, qHeight, scrolled, shapeForClick, xOf, yOf, zeroY, zoomed } from "./geometry";
import { findPeaks } from "./peaks";

const view: EqView = { width: 1000, height: 600, low: 10, high: 30_000, range: 12, analyzerRange: 90, top: 30, bottom: 20 };

describe("Pro-Q's display", () => {
  it("puts frequencies on a log scale and gains either side of 0 dB in the middle", () => {
    expect(xOf(view, 10)).toBeCloseTo(0);
    expect(xOf(view, 30_000)).toBeCloseTo(1000);
    expect(hzAt(view, xOf(view, 1234))).toBeCloseTo(1234);
    expect(yOf(view, 0)).toBe(zeroY(view));
    expect(dbAt(view, yOf(view, 7.5))).toBeCloseTo(7.5);
    expect(yOf(view, 12)).toBeGreaterThan(view.top);
  });

  it("labels the grid as Pro-Q does", () => {
    expect(frequencyLines(view).filter((l) => l.label).map((l) => l.label)).toEqual(["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"]);
    expect(gainSteps(12)).toEqual([-12, -9, -6, -3, 0, 3, 6, 9, 12]);
    expect(gainSteps(30)).toEqual([-30, -20, -10, 0, 10, 20, 30]);
    expect(gainSteps(3)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("puts a gainless band's dot at its Q (1 on 0 dB), and finds dots under the pointer", () => {
    const cut = { ...DEFAULT_BAND, id: 1, shape: "lowCut" as const, frequency: 100, q: 1 };
    expect(dotOf(view, cut).y).toBe(zeroY(view));
    expect(qAtHeight(qHeight(2.5, 12), 12)).toBeCloseTo(2.5);
    const bell = { ...DEFAULT_BAND, id: 2, frequency: 1000, gain: 6 };
    const dot = dotOf(view, bell);
    expect(bandAt(view, [cut, bell], dot.x + 3, dot.y - 2)?.id).toBe(2);
    expect(bandAt(view, [cut, bell], dot.x + 30, dot.y)).toBeNull();
  });

  it("makes a Notch along the bottom, cuts at the sides, a Bell elsewhere", () => {
    expect(shapeForClick(view, xOf(view, 1000), view.height - view.bottom - 2)).toBe("notch");
    expect(shapeForClick(view, xOf(view, 15), zeroY(view))).toBe("lowCut");
    expect(shapeForClick(view, xOf(view, 20_000), zeroY(view))).toBe("highCut");
    expect(shapeForClick(view, xOf(view, 1000), zeroY(view))).toBe("bell");
  });

  it("zooms the frequency scale round where it's held, and scrolls inside 10 Hz to 30 kHz", () => {
    const z = zoomed(view, 1000, 4);
    expect(z.low).toBeLessThan(1000);
    expect(z.high).toBeGreaterThan(1000);
    expect(Math.log(z.high / z.low)).toBeCloseTo(Math.log(3000) / 4);
    const far = scrolled({ ...view, ...z }, -100_000);
    expect(far.high).toBeCloseTo(30_000);
    expect(zoomed(view, 1000, 0.5)).toEqual({ low: 10, high: 30_000 });
  });
});

describe("Spectrum Grab's peaks", () => {
  it("finds the peaks that stand out, the most prominent first, with a Q for their width", () => {
    // A pink-ish slope with a narrow peak at 100 Hz and a wide one at 2 kHz.
    const levels = Array.from({ length: EQ_SPECTRUM_POINTS }, (_, i) => {
      const octave = Math.log2(spectrumFrequency(i) / 1000);
      return -40 - 3 * octave + 18 * Math.exp(-((Math.log2(spectrumFrequency(i) / 100) / 0.08) ** 2)) + 9 * Math.exp(-((Math.log2(spectrumFrequency(i) / 2000) / 0.25) ** 2));
    });
    const peaks = findPeaks(levels);
    expect(peaks).toHaveLength(2);
    expect(peaks[0].hz).toBeCloseTo(100, -1);
    expect(peaks[1].hz).toBeCloseTo(2000, -2);
    expect(peaks[0].q).toBeGreaterThan(peaks[1].q);
    expect(findPeaks(levels.map(() => -50))).toEqual([]);
  });
});
