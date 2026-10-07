import { describe, expect, it } from "vitest";
import {
  type PixelWindow,
  accumulate,
  dabErase,
  dabWindow,
  encodePixels,
  eraseAmounts,
  flood,
  matchAmount,
  sampleAt,
  sampleLight,
  toleranceLevels,
} from "./background-eraser.ts";
import { srgbToLinear } from "./colour.ts";
import { extractPixel } from "./reference/background-erase.ts";

/** A window from rows of "#rrggbb" (or "" for transparent). */
function windowOf(rows: string[][], x = 0, y = 0): PixelWindow {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.flat().forEach((hex, i) => {
    if (!hex) return;
    data.set([1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16)), i * 4);
    data[i * 4 + 3] = 255;
  });
  return { x, y, width, height, data };
}

const W = "#ffffff";
const K = "#101010";

describe("matching", () => {
  it("erases wholly up to half the tolerance, then less to nothing at it", () => {
    expect(matchAmount(0, 100)).toBe(1);
    expect(matchAmount(50, 100)).toBe(1);
    expect(matchAmount(75, 100)).toBeCloseTo(0.5);
    expect(matchAmount(100, 100)).toBe(0);
    expect(matchAmount(0, 0)).toBe(1);
    expect(matchAmount(1, 0)).toBe(0);
    expect(matchAmount(90, 100, true)).toBe(1);
    expect(toleranceLevels(50)).toBeCloseTo(127.5);
  });

  it("keeps only what's joined to the hotspot (Contiguous), or everything matching (Discontiguous)", () => {
    // White on both sides of a black wall; the hotspot is on the left.
    const win = windowOf([
      [W, W, K, W, W],
      [W, W, K, W, W],
      [W, W, K, W, W],
    ]);
    const base = { sample: [255, 255, 255] as const, tolerance: 60, protect: null, seed: { x: 0, y: 1 } };
    const joined = eraseAmounts(win, { ...base, limits: "contiguous" });
    expect([...joined.slice(0, 5)]).toEqual([1, 1, 0, 0, 0]);
    const everywhere = eraseAmounts(win, { ...base, limits: "discontiguous" });
    expect([...everywhere.slice(0, 5)]).toEqual([1, 1, 0, 1, 1]);
  });

  it("stops Find Edges' flood at strong edges, but erases the edge pixels it reaches", () => {
    // A soft step (white → light grey, within tolerance but a strong edge) then more light grey.
    const G = "#a0a0a0";
    const win = windowOf([[W, W, G, G, G]]);
    const match = { sample: [255, 255, 255] as const, tolerance: 120, protect: null, seed: { x: 0, y: 0 } };
    expect([...eraseAmounts(win, { ...match, limits: "contiguous" })].every((v) => v > 0)).toBe(true);
    expect([...eraseAmounts(win, { ...match, limits: "edges" })]).toEqual([1, 1, 0, 0, 0]);
  });

  it("spares the foreground colour", () => {
    const R = "#e0b0b0";
    const win = windowOf([[W, R, W]]);
    const out = eraseAmounts(win, { sample: [255, 255, 255], tolerance: 100, limits: "discontiguous", protect: [224, 176, 176], seed: null });
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[1]).toBe(0);
  });

  it("leaves transparent pixels and whatever the flood can't reach", () => {
    const win = windowOf([[W, "", W]]);
    const out = eraseAmounts(win, { sample: [255, 255, 255], tolerance: 10, limits: "contiguous", protect: null, seed: { x: 0, y: 0 } });
    expect([...out]).toEqual([1, 0, 0]);
    expect(flood(new Float32Array([0, 1]), 2, 1, 0)[1]).toBe(0);
  });

  it("samples the hotspot's pixel, never a transparent one", () => {
    const win = windowOf([[W, ""]], 10, 20);
    expect(sampleAt(win, 10.5, 20.5)).toEqual([255, 255, 255]);
    expect(sampleAt(win, 11.5, 20.5)).toBeNull();
    expect(sampleAt(win, 3, 3)).toBeNull();
  });
});

describe("a dab", () => {
  it("erases within its disc, by the brush's coverage", () => {
    const dab = { x: 5, y: 5, radius: 4, hardness: 1 };
    const win = dabWindow(dab);
    expect(win).toEqual({ x: 1, y: 1, width: 8, height: 8 });
    const pixels = windowOf(Array.from({ length: 8 }, () => Array(8).fill(W)), win.x, win.y);
    const w = dabErase(pixels, dab, [255, 255, 255], { tolerance: 50, limits: "contiguous", protect: null });
    expect(w[0]).toBe(0); // a corner, outside the disc
    expect(w[4 * 8 + 4]).toBe(1);
  });

  it("accumulates source-over: the background taken out and how much", () => {
    const acc = new Float32Array(2 * 1 * 4);
    accumulate(acc, 2, 1, new Float32Array([0.5]), 1, 0, 1, 1, [1, 0, 0]);
    accumulate(acc, 2, 1, new Float32Array([0.5]), 1, 0, 1, 1, [0, 0, 1]);
    expect([...acc.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...acc.slice(4)]).toEqual([0.25, 0, 0.5, 0.75]);
  });
});

describe("encodePixels", () => {
  it("is 8-bit encoded straight colour", () => {
    const l = srgbToLinear(128 / 255);
    expect([...encodePixels(new Float32Array([l * 0.5, 0, 0.5, 0.5, 0, 0, 0, 0]))]).toEqual([128, 0, 255, 128, 0, 0, 0, 0]);
    expect(sampleLight([255, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe("extractPixel", () => {
  const white = [1, 1, 1] as const;

  it("takes the background out of a mixed edge pixel, leaving the subject's colour", () => {
    // A pixel that's 70% white background over a pure red subject, erased by 0.7 of white.
    const subject = [1, 0, 0];
    const mixed = subject.map((f, i) => 0.3 * f + 0.7 * white[i]);
    const out = extractPixel([...mixed, 1] as [number, number, number, number], [0.7, 0.7, 0.7, 0.7]);
    expect(out[3]).toBeCloseTo(0.3);
    [0, 1, 2].forEach((i) => expect(out[i] / out[3]).toBeCloseTo(subject[i], 6));
  });

  it("erases wholly, partly by the selection, and not at all", () => {
    expect(extractPixel([1, 1, 1, 1], [1, 1, 1, 1])).toEqual([0, 0, 0, 0]);
    expect(extractPixel([0.2, 0.3, 0.4, 1], [0, 0, 0, 0])).toEqual([0.2, 0.3, 0.4, 1]);
    const half = extractPixel([1, 1, 1, 1], [1, 1, 1, 1], 0.5);
    expect(half[3]).toBeCloseTo(0.5);
    expect(half[0]).toBeCloseTo(0.5);
  });

  it("never makes a channel negative or brighter than it can be", () => {
    // A black subject pixel "erased" of a white background it doesn't contain.
    const out = extractPixel([0, 0, 0, 1], [0.5, 0.5, 0.5, 0.5]);
    expect(out).toEqual([0, 0, 0, 0.5]);
    const bright = extractPixel([1, 1, 1, 1], [0, 0, 0, 0.5]);
    expect(bright[0]).toBeLessThanOrEqual(bright[3] + 1e-12);
  });
});
