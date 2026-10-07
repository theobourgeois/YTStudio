import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "./colour.ts";
import { FILL_MODES, eraseMask, erasePixels, fillMask, fillPixels } from "./fill-compose.ts";
import { compositePixel } from "./reference/blend.ts";

const at0 = { x: 0, y: 0 };
const params = { mode: "normal" as const, opacity: 1, compositing: "photoshop" as const, seed: 7 };
const RED: [number, number, number, number] = [1, 0, 0, 1];
const BLUE: [number, number, number, number] = [0, 0, 1, 1];

const tileOf = (...pixels: number[][]) => Float32Array.from(pixels.flat());

describe("FILL_MODES", () => {
  it("is Photoshop's painting menu: Normal, Dissolve, Behind, Clear, then the layer modes", () => {
    expect(FILL_MODES.slice(0, 5).map((m) => m.id)).toEqual(["normal", "dissolve", "behind", "clear", "darken"]);
    expect(FILL_MODES).toHaveLength(29);
  });
});

describe("fillPixels", () => {
  it("fills what's reached whole, and leaves the rest", () => {
    const tile = tileOf(BLUE, BLUE, [0, 0, 0, 0]);
    expect(fillPixels(tile, 3, 1, at0, Float32Array.from([1, 0, 1]), RED, params)).toBe(true);
    expect([...tile]).toEqual([...RED, ...BLUE, ...RED]);
  });

  it("mixes partly reached pixels as the layer blend does, in the document's compositing", () => {
    for (const compositing of ["photoshop", "linear"] as const) {
      const tile = tileOf(BLUE);
      fillPixels(tile, 1, 1, at0, 0.5, RED, { ...params, opacity: 0.8, compositing });
      const expected = compositePixel(BLUE, [0.5, 0, 0, 0.5], { mode: "normal", opacity: 0.8, fill: 1, channels: { r: true, g: true, b: true }, blendIf: {}, compositing });
      expect([...tile].map((v) => +v.toFixed(5))).toEqual(expected.map((v) => +v.toFixed(5)));
    }
    // In a "photoshop" document half red over blue is half in encoded values.
    const tile = tileOf(BLUE);
    fillPixels(tile, 1, 1, at0, 0.5, RED, params);
    expect(linearToSrgb(tile[0])).toBeCloseTo(0.5, 5);
  });

  it("blends through a mode", () => {
    const grey = srgbToLinear(0.5);
    const tile = tileOf([grey, grey, grey, 1]);
    fillPixels(tile, 1, 1, at0, 1, [grey, grey, grey, 1], { ...params, mode: "multiply" });
    expect(linearToSrgb(tile[0])).toBeCloseTo(0.25, 4);
  });

  it("paints Behind only where the layer is transparent, and Clear takes it away", () => {
    const tile = tileOf(BLUE, [0, 0, 0, 0], [0, 0, 0.5, 0.5]);
    fillPixels(tile, 3, 1, at0, 1, RED, { ...params, mode: "behind" });
    expect([...tile.slice(0, 8)]).toEqual([...BLUE, ...RED]);
    expect(tile[11]).toBeCloseTo(1);
    expect(tile[2]).toBe(1);
    const cleared = tileOf(BLUE, BLUE);
    fillPixels(cleared, 2, 1, at0, Float32Array.from([1, 0.5]), RED, { ...params, mode: "clear" });
    expect([...cleared]).toEqual([0, 0, 0, 0, 0, 0, 0.5, 0.5]);
  });

  it("fills a pattern by the surface's pixel, and nothing changes at Opacity 0 or no cover", () => {
    const tile = tileOf(BLUE, BLUE);
    const seen: number[][] = [];
    fillPixels(tile, 2, 1, { x: 10, y: 4 }, 1, (x, y) => (seen.push([x, y]), x % 2 ? RED : BLUE), params);
    expect(seen).toEqual([[10, 4], [11, 4]]);
    expect([...tile]).toEqual([...BLUE, ...RED]);
    expect(fillPixels(tileOf(BLUE), 1, 1, at0, 1, RED, { ...params, opacity: 0 })).toBe(false);
    expect(fillPixels(tileOf(BLUE), 1, 1, at0, 0, RED, params)).toBe(false);
    expect(fillPixels(tileOf(RED), 1, 1, at0, 1, RED, params)).toBe(false);
  });

  it("dissolves by pixel: whole or nothing", () => {
    const tile = new Float32Array(64 * 4).fill(0);
    fillPixels(tile, 64, 1, at0, 0.5, RED, { ...params, mode: "dissolve" });
    const alphas = [...tile].filter((_, i) => i % 4 === 3);
    expect(alphas.every((a) => a === 0 || a === 1)).toBe(true);
    expect(alphas.filter((a) => a === 1).length).toBeGreaterThan(10);
    expect(alphas.filter((a) => a === 0).length).toBeGreaterThan(10);
  });
});

describe("fillMask", () => {
  it("mixes towards the grey by coverage × opacity; a mode acts on the grey", () => {
    const tile = Float32Array.from([1, 1, 0.5]);
    fillMask(tile, 3, 1, at0, Float32Array.from([1, 0.5, 1]), 0, "normal", 1);
    expect([...tile]).toEqual([0, 0.5, 0]);
    const t2 = Float32Array.from([0.5]);
    fillMask(t2, 1, 1, at0, 1, 0.5, "multiply", 1);
    expect(t2[0]).toBeCloseTo(0.25);
    const t3 = Float32Array.from([1]);
    fillMask(t3, 1, 1, at0, 1, 0, "clear", 0.25);
    expect(t3[0]).toBeCloseTo(0.75);
  });
});

describe("erasePixels", () => {
  it("takes coverage × opacity of each pixel's alpha", () => {
    const tile = tileOf(RED, RED, [0, 0, 0, 0]);
    expect(erasePixels(tile, 3, 1, Float32Array.from([1, 0.5, 1]), 1, null)).toBe(true);
    expect([...tile]).toEqual([0, 0, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 0, 0]);
    const half = tileOf(RED);
    erasePixels(half, 1, 1, 1, 0.25, null);
    expect(half[3]).toBeCloseTo(0.75);
    expect(erasePixels(tileOf([0, 0, 0, 0]), 1, 1, 1, 1, null)).toBe(false);
  });

  it("with Defringe, unmixes what's left from the colour clicked: no white rim", () => {
    // A pixel half white, half red (encoded), half erased: what's left is red.
    const pink = srgbToLinear(0.5);
    const tile = tileOf([1, pink, pink, 1]);
    erasePixels(tile, 1, 1, 0.5, 1, [1, 1, 1]);
    expect(tile[3]).toBeCloseTo(0.5);
    expect(tile[0] / tile[3]).toBeCloseTo(1, 4);
    expect(tile[1] / tile[3]).toBeCloseTo(0, 4);
    // Over white it looks as it did.
    const overWhite = linearToSrgb(tile[1] / tile[3]) * tile[3] + 1 * (1 - tile[3]);
    expect(overWhite).toBeCloseTo(0.5, 4);
  });
});

describe("eraseMask", () => {
  it("hides what's reached", () => {
    const tile = Float32Array.from([1, 1, 0.5, 0]);
    expect(eraseMask(tile, 4, 1, Float32Array.from([1, 0.25, 1, 1]), 1)).toBe(true);
    expect([...tile]).toEqual([0, 0.75, 0, 0]);
    expect(eraseMask(Float32Array.from([1]), 1, 1, 0, 1)).toBe(false);
  });
});
