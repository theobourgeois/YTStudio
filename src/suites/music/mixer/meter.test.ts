import { describe, expect, it } from "vitest";
import { SILENT_METER, detent, faderAt, faderDb, isClipping, meterFraction, stepMeter } from "./meter";

describe("meters", () => {
  it("put 0 dB near the top, and silence at the bottom", () => {
    expect(meterFraction(1)).toBeCloseTo(60 / 66, 5);
    expect(meterFraction(0)).toBe(0);
    expect(meterFraction(0.0001)).toBe(0);
    expect(meterFraction(4)).toBe(1);
  });

  it("rise at once to what's heard, and fall steadily after", () => {
    let meter = stepMeter(SILENT_METER, 0.5, 16, 0);
    expect(meter.level).toBe(0.5);
    // Half a second later, 18 dB down.
    meter = stepMeter(meter, null, 500, 500);
    expect(20 * Math.log10(meter.level / 0.5)).toBeCloseTo(-18, 5);
    // A quieter report doesn't pull it down faster than it falls.
    expect(stepMeter(meter, 0.01, 16, 516).level).toBeGreaterThan(0.01);
    // Long silent, it's at the bottom.
    expect(stepMeter(meter, null, 5000, 5500).level).toBe(0);
  });

  it("stay red for a moment after going over 0 dB", () => {
    const meter = stepMeter(SILENT_METER, 1.2, 16, 1000);
    expect(isClipping(meter, 1100)).toBe(true);
    expect(isClipping(meter, 3000)).toBe(false);
    expect(isClipping(stepMeter(SILENT_METER, 0.9, 16, 1000), 1100)).toBe(false);
  });
});

describe("a fader's level", () => {
  it("reads in dB, and a typed dB puts it back where it was", () => {
    expect(faderDb(0.8)).toBe("0.0 dB");
    expect(faderDb(0)).toBe("−∞ dB");
    expect(faderDb(0.4)).toBe("−18.1 dB");
    expect(faderDb(1)).toBe("+5.8 dB");
    expect(faderAt(0)).toBeCloseTo(0.8, 6);
    expect(faderAt(-18.06)).toBeCloseTo(0.4, 3);
    expect(faderAt(40)).toBe(1);
    expect(faderAt(-Infinity)).toBe(0);
  });
});

describe("a fader's hold at 0 dB", () => {
  it("keeps it at 0 dB a little way either side, then carries on smoothly to both ends", () => {
    expect(detent(0.8, 0.8, 0.03)).toBe(0.8);
    expect(detent(0.82, 0.8, 0.03)).toBe(0.8);
    expect(detent(0.775, 0.8, 0.03)).toBe(0.8);
    // Just past the hold, just past 0 dB: no jump.
    expect(detent(0.831, 0.8, 0.03)).toBeCloseTo(0.8, 2);
    expect(detent(1, 0.8, 0.03)).toBeCloseTo(1, 6);
    expect(detent(0, 0.8, 0.03)).toBeCloseTo(0, 6);
    expect(detent(0.9, 0.8, 0)).toBe(0.9);
  });
});
