import { describe, expect, it } from "vitest";
import { METER_LEDS, editorBox, snapEdge, gridLines, gridTicks, hitEvent, hitPoint, ioLit, isBeyond, ledDegrees, ledOf, meterLeds, snapTick, tickX, valueY, xTick, yValue } from "./geometry";

describe("PanMan's editors", () => {
  // A bar of 4 beats (384 ticks), the second bar shown, 400 x 120 px.
  const box = editorBox(400, 120, 384, 1);

  it("shows one bar, R at the top and L at the bottom", () => {
    expect(box.barStart).toBe(384);
    expect(tickX(box, 384)).toBe(box.left);
    expect(tickX(box, 768)).toBe(box.left + box.width);
    expect(xTick(box, tickX(box, 500))).toBeCloseTo(500, 9);
    expect(valueY(box, 1)).toBe(box.top);
    expect(valueY(box, -1)).toBe(box.top + box.height);
    expect(yValue(box, valueY(box, 0.3))).toBeCloseTo(0.3, 9);
    expect(yValue(box, -50)).toBe(1);
  });

  it("snaps to the grid inside the bar, or to whole ticks off it", () => {
    const eighth = gridTicks("1/8");
    expect(eighth).toBe(48);
    expect(snapTick(box, 384 + 70, eighth)).toBe(384 + 48);
    expect(snapTick(box, 384 + 73, eighth)).toBe(384 + 96);
    // Never onto the next bar's start, nor before this one's.
    expect(snapTick(box, 900, eighth)).toBe(768 - 48);
    expect(snapTick(box, 10, eighth)).toBe(384);
    expect(snapTick(box, 384 + 70.4, eighth, false)).toBe(454);
    expect(gridTicks("nonsense")).toBe(48);
    // An end can be the bar's end.
    expect(snapEdge(box, 900, eighth)).toBe(768);
    expect(snapEdge(box, 384 + 30, eighth)).toBe(384 + 48);
  });

  it("draws the grid's lines, beats stronger than the grid's, the bar's start strongest", () => {
    const lines = gridLines(box, gridTicks("1/8t"));
    expect(lines).toHaveLength(12);
    expect(lines.filter((l) => l.strength === "beat").map((l) => l.tick)).toEqual([480, 576, 672]);
    expect(lines[0]).toEqual({ tick: 384, strength: "bar" });
  });

  it("finds the point under the pointer, only in the bar shown", () => {
    const points = [
      { tick: 0, value: 1 },
      { tick: 384 + 96, value: 0 },
      { tick: 384 + 192, value: -1 },
    ];
    expect(hitPoint(points, box, tickX(box, 480) + 3, valueY(box, 0) - 2)).toBe(1);
    expect(hitPoint(points, box, tickX(box, 480) + 30, valueY(box, 0))).toBe(-1);
    expect(hitPoint(points, box, box.left, box.top)).toBe(-1);
  });

  it("finds an event's edges and body", () => {
    const events = [{ tick: 384, length: 96 }];
    expect(hitEvent(events, box, tickX(box, 384) + 2)).toEqual({ index: 0, part: "start" });
    expect(hitEvent(events, box, tickX(box, 480) - 1)).toEqual({ index: 0, part: "end" });
    expect(hitEvent(events, box, tickX(box, 430))).toEqual({ index: 0, part: "body" });
    expect(hitEvent(events, box, tickX(box, 600))).toBeNull();
  });
});

describe("PanMan's meters", () => {
  it("spreads 29 LEDs over ±105°, two at each end beyond the speakers", () => {
    expect(ledDegrees(0)).toBe(-105);
    expect(ledDegrees(METER_LEDS - 1)).toBe(105);
    expect(ledOf(0)).toBe(14);
    expect(ledOf(-90)).toBe(2);
    expect(Array.from({ length: METER_LEDS }, (_, i) => i).filter(isBeyond)).toEqual([0, 1, 27, 28]);
  });

  it("lights where it's been since last time, the rest fading: trails", () => {
    const lit = meterLeds([], -10, 10, 0.5);
    expect(lit.filter((v) => v === 1)).toHaveLength(3);
    const next = meterLeds(lit, 90, 90, 0.5);
    expect(next[ledOf(0)]).toBe(0.5);
    expect(next[ledOf(90)]).toBe(1);
  });

  it("lights Input's and Output's LEDs by the peak: yellow 6 dB under clipping, red at it", () => {
    expect(ioLit(0)).toBe(0);
    expect(ioLit(0.1)).toBe(1);
    expect(ioLit(0.3)).toBe(3);
    expect(ioLit(0.6)).toBe(4);
    expect(ioLit(1)).toBe(5);
  });
});
