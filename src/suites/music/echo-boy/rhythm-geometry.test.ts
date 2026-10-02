import { describe, expect, it } from "vitest";
import { beatX, gridLines, levelY, placeBeat, tapAt, tapReadout, xBeat, yLevel } from "./rhythm-geometry";

const box = { width: 200, height: 100, length: 2 };

describe("Rhythm Echo's grid", () => {
  it("puts beats across and levels up", () => {
    expect(beatX(box, 1)).toBe(100);
    expect(xBeat(box, 50)).toBe(0.5);
    expect(yLevel(box, levelY(box, 0.3))).toBeCloseTo(0.3);
    expect(yLevel(box, -50)).toBe(1);
  });

  it("finds the tap under the pointer", () => {
    const taps = [{ beat: 0, level: 1 }, { beat: 0.5, level: 1 }, { beat: 0.55, level: 1 }];
    expect(tapAt(box, taps, 49)).toBe(1);
    expect(tapAt(box, taps, 56)).toBe(2);
    expect(tapAt(box, taps, 80)).toBeNull();
  });

  it("places taps on the grid, or off it", () => {
    expect(placeBeat(box, 60, 8, false)).toBe(0.5);
    expect(placeBeat(box, 60, 16, false)).toBe(0.5);
    expect(placeBeat(box, 61, 32, false)).toBe(0.625);
    expect(placeBeat(box, 61, 8, true)).toBe(0.61);
    // Never on the pattern's end.
    expect(placeBeat(box, 200, 8, false)).toBe(1.5);
  });

  it("draws a line each grid step, the beats marked", () => {
    expect(gridLines(box, 4)).toEqual([{ x: 100, beat: true }]);
    expect(gridLines(box, 8).map((l) => l.beat)).toEqual([false, true, false]);
  });

  it("reads a tap out as EchoBoy does: where in beats, its level in dB", () => {
    expect(tapReadout({ beat: 1.75, level: 0.5 })).toEqual({ at: "2 3/4", level: "-6.0 dB" });
    expect(tapReadout({ beat: 0.437, level: 1 })).toEqual({ at: "1.437", level: "0.0 dB" });
    expect(tapReadout({ beat: 1, level: 0 }).level).toBe("-∞ dB");
  });
});
