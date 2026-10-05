import { describe, expect, it } from "vitest";
import { WHEEL_STEP, wheelScroll, wheelSteps, wheelTurn } from "./wheel";

const event = (deltaY: number, more: { deltaX?: number; deltaMode?: number; shiftKey?: boolean } = {}) => ({ deltaX: 0, deltaMode: 0, shiftKey: false, deltaY, ...more });

describe("wheelSteps", () => {
  it("makes a Windows mouse's notch (100 px) one step, up for more", () => {
    const rest = { current: 0 };
    expect(wheelSteps(-100, 0, rest)).toBe(1);
    expect(wheelSteps(100, 0, rest)).toBe(-1);
    // A larger notch (high DPI, faster settings) is still one step.
    expect(wheelSteps(-300, 0, rest)).toBe(1);
  });

  it("adds up a trackpad's small deltas", () => {
    const rest = { current: 0 };
    const steps = Array.from({ length: 10 }, () => wheelSteps(-8, 0, rest)).reduce((a, b) => a + b, 0);
    expect(steps).toBe(2);
  });

  it("counts lines and pages (Firefox) as a notch each", () => {
    const rest = { current: 0 };
    expect(wheelSteps(3, 1, rest)).toBe(-1);
    expect(wheelSteps(-1, 1, rest)).toBe(1);
    expect(wheelSteps(1, 2, rest)).toBe(-1);
  });
});

describe("wheelScroll", () => {
  it("scrolls down with the wheel, in pixels whatever the unit", () => {
    expect(wheelScroll(event(100))).toEqual({ x: 0, y: 100 });
    expect(wheelScroll(event(3, { deltaMode: 1 }))).toEqual({ x: 0, y: 3 * WHEEL_STEP });
  });

  it("scrolls sideways with Shift, as Windows' Chromium sends it (deltaX) or as others do (deltaY)", () => {
    expect(wheelScroll(event(0, { deltaX: 100, shiftKey: true }))).toEqual({ x: 100, y: 0 });
    expect(wheelScroll(event(100, { shiftKey: true }))).toEqual({ x: 100, y: 0 });
  });
});

describe("wheelTurn", () => {
  it("reads Shift+wheel on Windows (deltaX) as a turn, but not a sideways swipe", () => {
    expect(wheelTurn(event(0, { deltaX: 100, shiftKey: true }))).toBe(100);
    expect(wheelTurn(event(0, { deltaX: 100 }))).toBe(0);
    expect(wheelTurn(event(-100))).toBe(-100);
  });
});
