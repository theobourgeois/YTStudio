import { describe, expect, it } from "vitest";
import { intersect, rounded, subtract, visibleParts } from "./visible";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const area = (boxes: { width: number; height: number }[]) => boxes.reduce((sum, b) => sum + b.width * b.height, 0);

describe("intersect", () => {
  it("is where two rectangles overlap", () => {
    expect(intersect(box(0, 0, 10, 10), box(5, 5, 10, 10))).toEqual(box(5, 5, 5, 5));
  });
  it("is null when they only touch", () => {
    expect(intersect(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBeNull();
  });
});

describe("subtract", () => {
  it("leaves a rectangle alone when the hole misses it", () => {
    expect(subtract(box(0, 0, 10, 10), box(20, 20, 5, 5))).toEqual([box(0, 0, 10, 10)]);
  });
  it("cuts a hole in the middle into four bands", () => {
    const parts = subtract(box(0, 0, 10, 10), box(3, 3, 4, 4));
    expect(parts).toHaveLength(4);
    expect(area(parts)).toBe(100 - 16);
  });
  it("leaves nothing when the hole covers it", () => {
    expect(subtract(box(2, 2, 4, 4), box(0, 0, 10, 10))).toEqual([]);
  });
  it("keeps what's left of a corner", () => {
    expect(subtract(box(0, 0, 10, 10), box(5, 5, 10, 10))).toEqual([box(0, 0, 10, 5), box(0, 5, 5, 5)]);
  });
});

describe("visibleParts", () => {
  it("clips the body to its frame and the desktop", () => {
    expect(visibleParts(box(0, 0, 100, 100), [box(-10, 20, 200, 200), box(0, 0, 50, 500)], [])).toEqual([box(0, 20, 50, 80)]);
  });
  it("takes out every window in front", () => {
    const parts = visibleParts(box(0, 0, 100, 100), [], [box(0, 0, 50, 100), box(50, 0, 50, 50)]);
    expect(parts).toEqual([box(50, 50, 50, 50)]);
  });
  it("is empty when it's off the desktop", () => {
    expect(visibleParts(box(0, 0, 10, 10), [box(100, 100, 10, 10)], [])).toEqual([]);
  });
});

describe("rounded", () => {
  it("snaps out to whole pixels", () => {
    expect(rounded(box(1.4, 2.6, 10, 10))).toEqual(box(1, 2, 11, 11));
  });
});
