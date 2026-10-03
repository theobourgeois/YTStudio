import { describe, expect, it } from "vitest";
import { faderGain } from "@shared/music/compile";
import { SILENT_METER, detent, faderAt, faderDb, isClipping, meterFraction, meterScale, moveFadersTogether, stepMeter, toDb } from "./meter";

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

  it("marks the meter's scale every 3 dB from +3 to -51, more sparsely on a short meter", () => {
    const tall = meterScale(600);
    expect(tall.map((m) => m.db)).toEqual([3, 0, -3, -6, -9, -12, -15, -18, -21, -24, -27, -30, -33, -36, -39, -42, -45, -48, -51]);
    expect(tall[1].at).toBeCloseTo(meterFraction(1), 6);
    expect(meterScale(200).map((m) => m.db)).toEqual([0, -6, -12, -18, -24, -30, -36, -42, -48]);
    expect(meterScale(100).map((m) => m.db)).toEqual([0, -12, -24, -36, -48]);
  });
});

describe("faders moved together", () => {
  const db = (v: number) => Math.round(toDb(faderGain(v)) * 10) / 10;
  it("keep their offsets in dB", () => {
    const starts = new Map([["a", faderAt(-3)], ["b", faderAt(-10)]]);
    const moved = moveFadersTogether(starts, starts.get("a")!, faderAt(-5));
    expect([db(moved.get("a")!), db(moved.get("b")!)]).toEqual([-5, -12]);
  });

  it("leave one at −∞ there, and take them all to −∞ with the one dragged", () => {
    const starts = new Map([["a", faderAt(0)], ["b", 0]]);
    expect(moveFadersTogether(starts, faderAt(0), faderAt(-6)).get("b")).toBe(0);
    expect(moveFadersTogether(starts, faderAt(0), 0).get("a")).toBe(0);
    // Dragged up from −∞, the others stay.
    expect(moveFadersTogether(new Map([["a", 0], ["b", faderAt(-6)]]), 0, faderAt(-3)).get("b")).toBe(faderAt(-6));
  });

  it("stop at the top", () => {
    const starts = new Map([["a", faderAt(0)], ["b", faderAt(4)]]);
    expect(moveFadersTogether(starts, faderAt(0), faderAt(3)).get("b")).toBe(1);
  });
});
