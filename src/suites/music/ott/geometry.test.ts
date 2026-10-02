import { describe, expect, it } from "vitest";
import { OTT_FLOOR_DB, draggedThreshold, levelX, rowAt, xLevel, zoneAt } from "./geometry";

describe("OTT's display", () => {
  it("puts levels across a row, from its floor to full scale, and back", () => {
    expect(levelX(OTT_FLOOR_DB, 420)).toBe(0);
    expect(levelX(0, 420)).toBe(420);
    expect(levelX(-42, 420)).toBe(210);
    expect(levelX(-200, 420)).toBe(0);
    expect(levelX(6, 420)).toBe(420);
    expect(xLevel(210, 420)).toBe(-42);
  });

  it("finds the row under the pointer, none between rows", () => {
    expect(rowAt(5, 40, 4)).toBe(0);
    expect(rowAt(42, 40, 4)).toBeNull();
    expect(rowAt(50, 40, 4)).toBe(1);
    expect(rowAt(120, 40, 4)).toBe(2);
    expect(rowAt(140, 40, 4)).toBeNull();
  });

  it("tells the upward range, the gap and the downward range apart", () => {
    expect(zoneAt(-60, -46, -39)).toBe("up");
    expect(zoneAt(-42, -46, -39)).toBe("gap");
    expect(zoneAt(-20, -46, -39)).toBe("down");
  });

  it("moves a band's threshold as far as its gap is dragged, kept to 0..200%", () => {
    // 84 dB across 420 px: 5 px a dB; the mid band's knees move 23.743 dB for a whole 100%.
    expect(draggedThreshold(1, 1, 5 * 23.743, 420)).toBeCloseTo(2, 9);
    expect(draggedThreshold(1, 1, -5 * 23.743 / 2, 420)).toBeCloseTo(0.5, 9);
    expect(draggedThreshold(0, 1, 9999, 420)).toBe(2);
    expect(draggedThreshold(0, 1, -9999, 420)).toBe(0);
  });
});
