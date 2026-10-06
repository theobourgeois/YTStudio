import { describe, expect, it } from "vitest";
import { magicWand, wandAmount } from "./magic-wand.ts";
import { pixelCoverage, selectedArea } from "./selection.ts";
import type { PixelSample } from "./pixel-sample.ts";

/** A 40 × 20 sample: two red squares (one darker) on blue, the darker one apart. */
function picture(scale = 1): PixelSample {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const red = y >= 5 && y < 15 && ((x >= 5 && x < 15) || (x >= 25 && x < 35));
      data.set(red ? [x < 20 ? 220 : 200, 20, 20, 255] : [20, 40, 220, 255], i);
    }
  }
  return { width, height, data, scale };
}

const canvas = { width: 40, height: 20 };

describe("the magic wand", () => {
  it("selects the colour clicked and what joins it", () => {
    const s = magicWand(picture(), { x: 8, y: 8 }, { tolerance: 32, contiguous: true, antiAlias: false, sampleSize: 1 }, canvas)!;
    expect(s).toMatchObject({ x: 5, y: 5, width: 10, height: 10 });
    expect(selectedArea(s)).toBe(100);
  });

  it("everywhere when not contiguous, within its tolerance", () => {
    const both = magicWand(picture(), { x: 8, y: 8 }, { tolerance: 32, contiguous: false, antiAlias: false, sampleSize: 1 }, canvas)!;
    expect(selectedArea(both)).toBe(200);
    const tight = magicWand(picture(), { x: 8, y: 8 }, { tolerance: 10, contiguous: false, antiAlias: false, sampleSize: 1 }, canvas)!;
    expect(selectedArea(tight)).toBe(100);
  });

  it("anti-alias covers pixels just past the tolerance partly", () => {
    expect(wandAmount(10, 32, true)).toBe(1);
    expect(wandAmount(32, 32, true)).toBe(1);
    expect(wandAmount(40, 32, true)).toBeCloseTo(0.5);
    expect(wandAmount(48, 32, true)).toBe(0);
    expect(wandAmount(0, 0, true)).toBe(1);
  });

  it("works on a reduced sample, its edge read between pixels", () => {
    // The sample is the document at half size: its pixel (8, 8) is document (16..18).
    const s = magicWand(picture(0.5), { x: 16, y: 16 }, { tolerance: 32, contiguous: true, antiAlias: false, sampleSize: 1 }, { width: 80, height: 40 })!;
    expect(pixelCoverage(s, 18, 18)).toBe(1);
    expect(pixelCoverage(s, 2, 2)).toBe(0);
    expect(selectedArea(s)).toBeCloseTo(400, -1);
  });
});
