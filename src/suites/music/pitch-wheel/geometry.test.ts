import { describe, expect, it } from "vitest";
import { angleOf, keyAt, keyboardLayout, pointerAngle, readout, scrollStep, ticks, turn, turned } from "./geometry";

describe("a Pitch Wheel's dial", () => {
  it("sweeps 270°, 0 at the top, the range's ends at 7:30 and 4:30", () => {
    expect(angleOf(0, 24)).toBe(0);
    expect(angleOf(-12, 24)).toBe(-135);
    expect(angleOf(12, 24)).toBe(135);
    expect(angleOf(3, 12)).toBe(67.5);
    // The actual pitch goes on round, past the ends.
    expect(angleOf(24, 24)).toBe(270);
  });

  it("reads the pointer's direction clockwise from the top", () => {
    expect(pointerAngle(0, -10)).toBeCloseTo(0);
    expect(pointerAngle(10, 0)).toBeCloseTo(90);
    expect(pointerAngle(-10, 0)).toBeCloseTo(-90);
    expect(Math.abs(pointerAngle(0, 10))).toBeCloseTo(180);
  });

  it("turns the short way round, so a drag across the bottom doesn't jump", () => {
    expect(turn(170, -170)).toBe(20);
    expect(turn(-170, 170)).toBe(-20);
    expect(turn(10, 40)).toBe(30);
  });

  it("turns the pointer by the drag, clamped to the range, finer with Shift", () => {
    expect(turned(0, 90, 24)).toBe(8);
    expect(turned(10, 90, 24)).toBe(12);
    expect(turned(0, 90, 24, true)).toBeCloseTo(1.6);
    expect(turned(0, -45, 2)).toBeCloseTo(-1 / 3);
  });

  it("marks each range: labels every semitone at 24, every four at 48, halves at 2", () => {
    const at24 = ticks(24);
    expect(at24.filter((t) => t.label).map((t) => t.label)).toHaveLength(25);
    expect(at24[0]).toEqual({ value: -12, major: true, label: "-12" });
    expect(at24.find((t) => t.value === 0)?.label).toBe("0");
    expect(at24.find((t) => t.value === 0.5)).toEqual({ value: 0.5, major: false, label: null });
    expect(ticks(48).filter((t) => t.label).map((t) => t.label)).toEqual(["-24", "-20", "-16", "-12", "-8", "-4", "0", "+4", "+8", "+12", "+16", "+20", "+24"]);
    expect(ticks(2).filter((t) => t.label).map((t) => t.label)).toEqual(["-1", "-0.5", "0", "+0.5", "+1"]);
  });

  it("shows values as QuikQuak's display does", () => {
    expect(readout(2)).toBe("+2.00");
    expect(readout(-0.351)).toBe("-0.35");
    expect(readout(0.001)).toBe("0.00");
    expect(readout(-0.001)).toBe("0.00");
  });

  it("scrolls by a semitone when snapped, a tenth when not", () => {
    expect(scrollStep("semitone", false)).toBe(1);
    expect(scrollStep("octave", false)).toBe(12);
    expect(scrollStep("off", false)).toBe(0.1);
    expect(scrollStep("off", true)).toBe(0.01);
  });
});

describe("its keyboard", () => {
  const keys = keyboardLayout(700, 40, 36, 95);
  it("lays five octaves out: 35 white keys side by side, the black ones over their joins", () => {
    expect(keys.filter((k) => !k.black)).toHaveLength(35);
    expect(keys.filter((k) => k.black)).toHaveLength(25);
    const cSharp = keys.find((k) => k.key === 37)!;
    expect(cSharp.x + cSharp.width / 2).toBeCloseTo(20);
  });

  it("finds the key under the pointer, black ones first", () => {
    expect(keyAt(keys, 20, 10)).toBe(37);
    expect(keyAt(keys, 15, 35)).toBe(36);
    expect(keyAt(keys, 5, 10)).toBe(36);
    expect(keyAt(keys, 699, 39)).toBe(95);
    expect(keyAt(keys, 800, 10)).toBeNull();
  });
});
