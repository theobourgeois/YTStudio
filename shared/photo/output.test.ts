import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "./colour.ts";
import { fromHalf, toHalf } from "./half.ts";
import { DITHER_8BIT, ditherAt, encodePixel, hash2, quantize8 } from "./output.ts";

/** What an 8-bit sample becomes in an f16 tile: linear, premultiplied, rounded to the nearest half. */
const stored = (code: number, alpha: number) => fromHalf(toHalf(Math.fround(srgbToLinear(code / 255)) * (alpha / 255)));

describe("the output transform", () => {
  it("hashes like the WGSL (u32 arithmetic), spread evenly", () => {
    expect(hash2(0, 0)).toBe(hash2(0, 0));
    expect(hash2(1, 0)).not.toBe(hash2(0, 1));
    const offsets = Array.from({ length: 10_000 }, (_, i) => ditherAt(i % 100, Math.floor(i / 100)));
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-DITHER_8BIT);
    expect(Math.max(...offsets)).toBeLessThan(DITHER_8BIT);
    expect(Math.abs(offsets.reduce((a, b) => a + b) / offsets.length)).toBeLessThan(0.01);
  });

  it("brings every 8-bit level back exactly through f16 tiles, at every alpha, dithered", () => {
    let worst = 0;
    for (let alpha = 1; alpha < 256; alpha++) {
      const a = fromHalf(toHalf(alpha / 255));
      for (let code = 0; code < 256; code++) {
        const v = stored(code, alpha);
        const encoded = encodePixel(v, v, v, a)[0] * 255;
        worst = Math.max(worst, Math.abs(encoded - code));
        // The dither's extremes at a few pixels: never enough to reach the next level.
        for (const [x, y] of [[0, 0], [17, 3], [1000, 2000], [code, alpha]]) {
          const [r, , , qa] = quantize8(v, v, v, a, x, y);
          if (r !== code || qa !== alpha) throw new Error(`code ${code} at alpha ${alpha} came back ${r}/${qa}`);
        }
      }
    }
    // The margin rendering.md promises: ½ − DITHER_8BIT is more than the worst error.
    expect(worst).toBeLessThan(0.5 - DITHER_8BIT - 0.03);
  });

  it("clips highlights and negatives, and has no colour without alpha", () => {
    expect(encodePixel(2, -0.5, 0.5, 1).map((v) => +v.toFixed(6))).toEqual([1, 0, +linearToSrgb(0.5).toFixed(6), 1]);
    expect(encodePixel(0.3, 0.3, 0.3, 0)).toEqual([0, 0, 0, 0]);
    expect(quantize8(0.25, 0.25, 0.25, 0.5, 0, 0, 0)).toEqual([188, 188, 188, 128]);
  });
});
