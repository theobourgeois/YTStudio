import { describe, expect, it } from "vitest";
import { WHEEL_STEP, createRails, isPreciseWheel, wheelScroll, wheelSteps, wheelTurn, wheelZoom } from "./wheel";

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

/** A wheel event as Chromium sends it: a trackpad's `wheelDelta` is -3 × its pixels, a wheel's 120 a notch. */
const trackpad = (deltaY: number, deltaX = 0) => ({ deltaX, deltaY, deltaMode: 0, wheelDeltaX: -3 * deltaX, wheelDeltaY: -3 * deltaY });
const notch = (deltaY: number, ticks: number) => ({ deltaX: 0, deltaY, deltaMode: 0, wheelDeltaX: 0, wheelDeltaY: ticks * 120 });

describe("isPreciseWheel", () => {
  it("tells a trackpad's pixels from a wheel's notches, a Mac mouse's small ones too", () => {
    expect(isPreciseWheel(trackpad(4.5))).toBe(true);
    expect(isPreciseWheel(trackpad(0, -12))).toBe(true);
    expect(isPreciseWheel(notch(100, -1))).toBe(false);
    expect(isPreciseWheel(notch(4.000244140625, -1))).toBe(false);
    // Without `wheelDelta` (Firefox): lines are a wheel's, small pixels a trackpad's.
    expect(isPreciseWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe(false);
    expect(isPreciseWheel({ deltaX: 0, deltaY: 6, deltaMode: 0 })).toBe(true);
    expect(isPreciseWheel({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(false);
  });
});

describe("wheelZoom", () => {
  it("zooms a wheel 10% a notch, whatever size its deltas come in", () => {
    expect(wheelZoom(notch(-100, 1), false)).toBeCloseTo(1.1);
    expect(wheelZoom(notch(4.000244140625, -1), false)).toBeCloseTo(1 / 1.1);
    expect(wheelZoom({ deltaX: 0, deltaY: -100, deltaMode: 0 }, false)).toBeCloseTo(1.1);
    expect(wheelZoom({ deltaX: 0, deltaY: 3, deltaMode: 1 }, false)).toBeCloseTo(1 / 1.1);
    expect(wheelZoom(notch(-1000, 10), false)).toBeCloseTo(1.21);
    expect(wheelZoom(notch(0, 0), false)).toBe(1);
  });

  it("follows a pinch's fingers: its deltas are the log of its scale", () => {
    expect(wheelZoom(trackpad(-100 * Math.log(1.05)), true)).toBeCloseTo(1.05);
    expect(wheelZoom(trackpad(100 * Math.log(1.2)), true)).toBeCloseTo(1 / 1.2);
  });

  it("zooms a trackpad's scroll in proportion to how far it went, smoothly at any speed", () => {
    // Many small deltas zoom as much as a few larger ones over the same distance.
    const small = Array.from({ length: 20 }, () => wheelZoom(trackpad(-3), false)).reduce((a, b) => a * b, 1);
    const large = Array.from({ length: 2 }, () => wheelZoom(trackpad(-30), false)).reduce((a, b) => a * b, 1);
    expect(small).toBeCloseTo(large, 9);
    // No jump between a slower and a faster swipe.
    expect(wheelZoom(trackpad(49), false) / wheelZoom(trackpad(51), false)).toBeLessThan(1.01);
    // A fling's spike zooms no more than a little at once.
    expect(wheelZoom(trackpad(-400), false)).toBeLessThan(1.3);
  });
});

describe("createRails", () => {
  it("holds a scroll to the axis it set off along, letting the other's drift go", () => {
    const rails = createRails();
    expect(rails({ x: 0.5, y: 6 }, 0)).toEqual({ x: 0, y: 6 });
    expect(rails({ x: 1, y: 5 }, 10)).toEqual({ x: 0, y: 5 });
    // Decided: drift sideways stays out, even a moment that leans that way.
    expect(rails({ x: 4, y: 3 }, 20)).toEqual({ x: 0, y: 3 });
    // Still a while: the next scroll chooses again.
    expect(rails({ x: 8, y: 1 }, 400)).toEqual({ x: 8, y: 0 });
  });

  it("leaves a diagonal scroll free", () => {
    const rails = createRails();
    expect(rails({ x: 5, y: 5 }, 0)).toEqual({ x: 5, y: 5 });
    expect(rails({ x: 6, y: 1 }, 10)).toEqual({ x: 6, y: 1 });
  });
});
