import { describe, expect, it } from "vitest";
import { INIT_REVERB } from "@shared/music/reverb-presets";
import type { ReverbState } from "@shared/music/types";
import { bandPoint, dbY, freqX, hitBand, hitPost, levelY, multiplierAt, newBandAt, onCurve, t60Y, timeX, xFreq, xTime, yDb, yT60 } from "./geometry";
import { reverbT60 } from "@shared/music/reverb";

const plot = { left: 10, top: 20, width: 600, height: 300 };
const withBand: ReverbState = { ...INIT_REVERB, bands: [{ id: 1, enabled: true, shape: "bell", frequency: 2000, multiplier: 0.5, q: 1 }] };

describe("the Reverb's display maths", () => {
  it("maps frequency, decay time and dB both ways", () => {
    expect(freqX(plot, 20)).toBe(10);
    expect(freqX(plot, 20000)).toBeCloseTo(610, 6);
    expect(xFreq(plot, freqX(plot, 1234))).toBeCloseTo(1234, 6);
    expect(yT60(plot, t60Y(plot, 2.5))).toBeCloseTo(2.5, 6);
    expect(t60Y(plot, 30)).toBeCloseTo(20, 6);
    expect(dbY(plot, 0)).toBe(170);
    expect(yDb(plot, dbY(plot, -6))).toBeCloseTo(-6, 6);
  });

  it("puts a band's dot at the seconds it asks for, and drags it as a multiplier", () => {
    const at = bandPoint(withBand, withBand.bands[0], plot);
    expect(hitBand(withBand, plot, at.x + 3, at.y - 2)).toBe(1);
    expect(hitBand(withBand, plot, at.x + 40, at.y)).toBeNull();
    expect(multiplierAt(withBand, 2000, at.y, plot)).toBeCloseTo(0.5, 6);
    expect(multiplierAt(withBand, 2000, plot.top, plot)).toBe(4);
  });

  it("makes shelves near the ends, bells between, notches near the bottom", () => {
    expect(newBandAt(INIT_REVERB, plot, freqX(plot, 80), 100).shape).toBe("lowShelf");
    expect(newBandAt(INIT_REVERB, plot, freqX(plot, 9000), 100).shape).toBe("highShelf");
    expect(newBandAt(INIT_REVERB, plot, freqX(plot, 1000), 100).shape).toBe("bell");
    expect(newBandAt(INIT_REVERB, plot, freqX(plot, 6500), plot.top + plot.height - 5).shape).toBe("notch");
  });

  it("finds the decay curve and the Post EQ's handles", () => {
    const t60 = reverbT60(INIT_REVERB);
    const x = freqX(plot, 1000);
    expect(onCurve(t60, plot, x, t60Y(plot, 1.8) + 2)).toBe(true);
    expect(onCurve(t60, plot, x, t60Y(plot, 1.8) + 30)).toBe(false);
    const cut = { ...INIT_REVERB, lowCut: 200 };
    expect(hitPost(cut, plot, freqX(plot, 200), dbY(plot, -3))).toBe("lowCut");
  });

  it("maps the Shape display's time (linear or log) and level", () => {
    expect(xTime(plot, timeX(plot, 0.3, 3), 3)).toBeCloseTo(0.3, 6);
    expect(xTime(plot, timeX(plot, 0.03, 3, true), 3, true)).toBeCloseTo(0.03, 6);
    expect(timeX(plot, 0.03, 3, true)).toBeGreaterThan(timeX(plot, 0.03, 3));
    expect(levelY(plot, 0)).toBe(20);
    expect(levelY(plot, -72)).toBe(320);
  });
});
