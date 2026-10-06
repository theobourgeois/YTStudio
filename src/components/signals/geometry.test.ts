import { describe, expect, it } from "vitest";
import { addEvent, eventsBetween, formatHz, hzToX, moveEvents, quantizeEvents, rangeFromDrag, removeEvents, roundHz, snapToBeats, xToHz } from "./geometry";

describe("the spectrum's axis", () => {
  it("is logarithmic from 20 Hz to 20 kHz, and back", () => {
    expect(hzToX(20, 300)).toBe(0);
    expect(hzToX(20_000, 300)).toBe(300);
    expect(hzToX(632.5, 300)).toBeCloseTo(150, 0);
    expect(xToHz(hzToX(120, 300), 300)).toBeCloseTo(120, 6);
  });

  it("rounds a dragged band and keeps it at least a little wide", () => {
    expect(roundHz(123.4)).toBe(120);
    expect(roundHz(2468)).toBe(2500);
    const kick = rangeFromDrag(hzToX(118, 600), hzToX(41, 600), 600);
    expect(kick).toEqual({ low: 41, high: 120 });
    const thin = rangeFromDrag(200, 200, 600);
    expect(thin.high / thin.low).toBeGreaterThan(1.05);
    expect(formatHz(2500)).toBe("2.5 kHz");
    expect(formatHz(80)).toBe("80 Hz");
  });
});

describe("hits on the timeline", () => {
  const hits = [1, 2, 3, 4].map((time) => ({ time, velocity: 1 }));

  it("finds those in view", () => {
    expect(eventsBetween(hits, 1.5, 3)).toEqual([1, 2]);
    expect(eventsBetween(hits, 5, 9)).toEqual([]);
  });

  it("snaps to a beat in reach", () => {
    expect(snapToBeats(1.04, [0.5, 1, 1.5], 0.05)).toBe(1);
    expect(snapToBeats(1.2, [0.5, 1, 1.5], 0.05)).toBe(1.2);
  });

  it("moves, removes, adds and quantises", () => {
    expect(moveEvents(hits, new Set([0]), 2.5).map((e) => e.time)).toEqual([2, 3, 3.5, 4]);
    expect(moveEvents(hits, new Set([0]), -5)[0].time).toBe(0);
    expect(removeEvents(hits, new Set([1, 2])).map((e) => e.time)).toEqual([1, 4]);
    expect(addEvent(hits, 2.5).map((e) => e.time)).toEqual([1, 2, 2.5, 3, 4]);
    expect(addEvent(hits, 2.0004)).toHaveLength(4);
    const loose = [0.27, 0.49, 1.2, 1.16].map((time) => ({ time, velocity: 1 }));
    expect(quantizeEvents(loose, [0, 0.5, 1, 1.5], 2).map((e) => e.time)).toEqual([0.25, 0.5, 1.25]);
    expect(quantizeEvents(loose, [1], 2)).toHaveLength(4);
  });
});
