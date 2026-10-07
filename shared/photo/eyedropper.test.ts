import { describe, expect, it } from "vitest";
import { averageColour, eyedropperBox } from "./eyedropper.ts";

const canvas = { width: 100, height: 50 };

describe("eyedropperBox", () => {
  it("is the pixel under the point, or the square centred on it", () => {
    expect(eyedropperBox({ x: 10.7, y: 20.2 }, 1, canvas)).toEqual({ x: 10, y: 20, width: 1, height: 1 });
    expect(eyedropperBox({ x: 10.7, y: 20.2 }, 5, canvas)).toEqual({ x: 8, y: 18, width: 5, height: 5 });
  });

  it("keeps to the canvas, and is nothing off it", () => {
    expect(eyedropperBox({ x: 0.5, y: 49.5 }, 11, canvas)).toEqual({ x: 0, y: 44, width: 6, height: 6 });
    expect(eyedropperBox({ x: -1, y: 5 }, 1, canvas)).toBeNull();
    expect(eyedropperBox({ x: 100, y: 5 }, 1, canvas)).toBeNull();
    expect(eyedropperBox({ x: Number.NaN, y: 5 }, 1, canvas)).toBeNull();
  });
});

describe("averageColour", () => {
  const sample = (...pixels: number[][]) => ({ width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) });

  it("reads one pixel as its hex", () => {
    expect(averageColour(sample([255, 128, 0, 255]))).toBe("#ff8000");
  });

  it("averages, weighting each pixel by its alpha", () => {
    expect(averageColour(sample([0, 0, 0, 255], [255, 255, 255, 255]))).toBe("#808080");
    // The transparent pixel's colour doesn't count; the half-transparent one counts half.
    expect(averageColour(sample([255, 0, 0, 255], [0, 0, 255, 0]))).toBe("#ff0000");
    expect(averageColour(sample([255, 0, 0, 255], [0, 0, 255, 128]))).toBe("#aa0055");
  });

  it("is nothing where everything is transparent", () => {
    expect(averageColour(sample([10, 20, 30, 0], [40, 50, 60, 0]))).toBeNull();
  });
});
