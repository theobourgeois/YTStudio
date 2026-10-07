import { describe, expect, it } from "vitest";
import { drawCrop, moveCrop, ratioCrop, resizeCrop, swapCrop } from "./crop-geometry";

const box = { x: 100, y: 100, width: 400, height: 200 };
const free = { ratio: null, fromCentre: false, bounds: null };

describe("the crop box", () => {
  it("resizes from the opposite side, turning over past it", () => {
    expect(resizeCrop(box, { u: 1, v: 1 }, { x: 600, y: 350 }, free)).toEqual({ x: 100, y: 100, width: 500, height: 250 });
    expect(resizeCrop(box, { u: 1, v: 0.5 }, { x: 50, y: 999 }, free)).toEqual({ x: 50, y: 100, width: 50, height: 200 });
    expect(resizeCrop(box, { u: 0.5, v: 0 }, { x: 0, y: 150 }, free)).toEqual({ x: 100, y: 150, width: 400, height: 150 });
  });

  it("keeps a ratio, the larger way winning, and works from the centre with Alt", () => {
    expect(resizeCrop(box, { u: 1, v: 1 }, { x: 300, y: 500 }, { ...free, ratio: 1 })).toEqual({ x: 100, y: 100, width: 400, height: 400 });
    expect(resizeCrop(box, { u: 1, v: 1 }, { x: 550, y: 250 }, { ...free, fromCentre: true })).toEqual({ x: 50, y: 150, width: 500, height: 100 });
    // An edge with a ratio moves the other way about the middle.
    expect(resizeCrop(box, { u: 1, v: 0.5 }, { x: 300, y: 0 }, { ...free, ratio: 2 })).toEqual({ x: 100, y: 150, width: 200, height: 100 });
  });

  it("stays inside a layer's bounds, its ratio kept", () => {
    const bounds = { x: 0, y: 0, width: 600, height: 400 };
    expect(resizeCrop(box, { u: 1, v: 1 }, { x: 900, y: 900 }, { ...free, bounds })).toEqual({ x: 100, y: 100, width: 500, height: 300 });
    const kept = resizeCrop(box, { u: 1, v: 1 }, { x: 900, y: 900 }, { ...free, ratio: 2, bounds });
    expect(kept).toEqual({ x: 100, y: 100, width: 500, height: 250 });
    const edge = resizeCrop(box, { u: 1, v: 0.5 }, { x: 800, y: 0 }, { ...free, ratio: 1, bounds });
    expect(edge.x).toBe(100);
    expect(edge.width).toBeCloseTo(edge.height);
    expect(edge.y).toBeGreaterThanOrEqual(0);
    expect(edge.y + edge.height).toBeLessThanOrEqual(400 + 1e-9);
    expect(moveCrop(box, 500, -500, bounds)).toEqual({ x: 200, y: 0, width: 400, height: 200 });
    expect(moveCrop(box, 500, -500, null)).toEqual({ x: 600, y: -400, width: 400, height: 200 });
  });

  it("draws a new box, and turns one on its side", () => {
    expect(drawCrop({ x: 50, y: 50 }, { x: 10, y: 150 }, free)).toEqual({ x: 10, y: 50, width: 40, height: 100 });
    expect(drawCrop({ x: 50, y: 50 }, { x: 150, y: 70 }, { ...free, ratio: 1, fromCentre: true })).toEqual({ x: -50, y: -50, width: 200, height: 200 });
    expect(swapCrop(box, null)).toEqual({ x: 200, y: 0, width: 200, height: 400 });
    expect(ratioCrop({ x: 0, y: 0, width: 1000, height: 800 }, 16 / 9)).toEqual({ x: 0, y: 118.75, width: 1000, height: 562.5 });
  });
});
