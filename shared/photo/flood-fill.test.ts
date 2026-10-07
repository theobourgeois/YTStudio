import { describe, expect, it } from "vitest";
import { defringe, flood, floodSelection, matteShare } from "./flood-fill.ts";
import { magicWand } from "./magic-wand.ts";
import type { PixelSample } from "./pixel-sample.ts";

/** A sample from a colour function (straight RGBA 0..255). */
function sample(width: number, height: number, at: (x: number, y: number) => number[], scale = 1): PixelSample {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 4);
  return { width, height, data, scale };
}

const WHITE = [255, 255, 255, 255];
const RED = [255, 0, 0, 255];
const OPTIONS = { tolerance: 32, contiguous: true, antiAlias: false };

describe("flood", () => {
  it("reaches what the Magic Wand selects (its tolerance, contiguity and edge)", () => {
    // Two white areas split by a red column; a near-white pixel inside the first.
    const s = sample(9, 4, (x, y) => (x === 4 ? RED : x === 1 && y === 1 ? [240, 240, 240, 255] : WHITE));
    const canvas = { width: 9, height: 4 };
    for (const options of [OPTIONS, { ...OPTIONS, contiguous: false }, { ...OPTIONS, antiAlias: true }, { ...OPTIONS, tolerance: 0 }]) {
      const f = flood(s, { x: 0.5, y: 0.5 }, options, canvas)!;
      const wand = magicWand(s, { x: 0.5, y: 0.5 }, { ...options, sampleSize: 1 }, canvas);
      expect(floodSelection(s, f.amounts, canvas)).toEqual(wand);
    }
    const f = flood(s, { x: 0.5, y: 0.5 }, OPTIONS, canvas)!;
    expect(f.colour).toEqual(WHITE);
    expect(f.amounts[5]).toBe(0);
    expect(flood(s, { x: 0.5, y: 0.5 }, { ...OPTIONS, contiguous: false }, canvas)!.amounts[5]).toBe(255);
  });

  it("reaches nothing off the canvas", () => {
    const s = sample(2, 2, () => WHITE);
    expect(flood(s, { x: -1, y: 0 }, OPTIONS, { width: 2, height: 2 })).toBeNull();
    expect(flood(s, { x: 2, y: 0 }, OPTIONS, { width: 2, height: 2 })).toBeNull();
  });

  it("fills a transparent layer whole: every transparent pixel is one colour", () => {
    const s = sample(4, 3, () => [0, 0, 0, 0]);
    const f = flood(s, { x: 1, y: 1 }, OPTIONS, { width: 4, height: 3 })!;
    expect([...f.amounts]).toEqual(new Array(12).fill(255));
  });

  it("works on a reduced sample, in its pixels", () => {
    // A 4 × 2 sample of an 8 × 4 canvas: the click at (6, 3) is sample pixel (3, 1).
    const s = sample(4, 2, (x) => (x < 2 ? RED : WHITE), 0.5);
    const f = flood(s, { x: 6, y: 3 }, OPTIONS, { width: 8, height: 4 })!;
    expect([...f.amounts]).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
  });
});

describe("matteShare", () => {
  it("is how much of a colour the matte explains (Color to Alpha)", () => {
    expect(matteShare([1, 1, 1], [1, 1, 1])).toBe(1);
    expect(matteShare([1, 0, 0], [1, 1, 1])).toBe(0);
    expect(matteShare([1, 0.5, 0.5], [1, 1, 1])).toBeCloseTo(0.5);
    expect(matteShare([0.25, 0.25, 0.25], [0, 0, 0])).toBeCloseTo(0.75);
    // Mixed with green over a grey matte: past it on both sides.
    expect(matteShare([0.25, 0.75, 0.5], [0.5, 0.5, 0.5])).toBeCloseTo(0.5);
  });
});

describe("defringe", () => {
  // White, then a soft edge two pixels wide (75% and 25% white over red), then red.
  const edge = [WHITE, WHITE, [255, 191, 191, 255], [255, 64, 64, 255], RED, RED, RED];
  const s = sample(7, 1, (x) => edge[x]);
  const amounts = new Uint8Array([255, 255, 0, 0, 0, 0, 0]);

  it("erases the share of the colour clicked from the edge, ring by ring while it falls", () => {
    const out = defringe(s, amounts, WHITE);
    expect(out[2]).toBe(Math.round((191 / 255) * 255));
    expect(out[3]).toBe(64);
    expect([...out.slice(4)]).toEqual([0, 0, 0]);
  });

  it("stops at a flat colour, however light", () => {
    // A pale flat subject: its outermost pixel softens, its interior doesn't.
    const pale = sample(6, 1, (x) => (x < 2 ? WHITE : [230, 220, 210, 255]));
    const out = defringe(pale, new Uint8Array([255, 255, 0, 0, 0, 0]), WHITE);
    expect(out[2]).toBeGreaterThan(0);
    expect([...out.slice(3)]).toEqual([0, 0, 0]);
  });

  it("keeps the flood where it reached more, and leaves transparent pixels and wider rings alone", () => {
    const partly = defringe(s, new Uint8Array([255, 255, 250, 0, 0, 0, 0]), WHITE);
    expect(partly[2]).toBe(250);
    const clear = sample(3, 1, (x) => (x === 0 ? WHITE : [255, 255, 255, 0]));
    expect([...defringe(clear, new Uint8Array([255, 0, 0]), WHITE)]).toEqual([255, 0, 0]);
    expect(defringe(s, amounts, WHITE, 1)[3]).toBe(0);
  });
});
