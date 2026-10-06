import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "./colour.ts";
import { fromHalf, toHalf } from "./half.ts";
import { DITHER_8BIT, ditherAt, encodePixel, filmHighlights, hash2, quantize8 } from "./output.ts";

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
          for (const highlights of ["clip", "film"] as const) {
            const [r, , , qa] = quantize8(v, v, v, a, x, y, DITHER_8BIT, highlights);
            if (r !== code || qa !== alpha) throw new Error(`code ${code} at alpha ${alpha} came back ${r}/${qa} (${highlights})`);
          }
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

  it("film leaves [0, 1] alone and rolls light above white towards white, keeping its hue", () => {
    expect(filmHighlights(0.2, 1, 0.5)).toEqual([0.2, 1, 0.5]);
    // One stop over: halfway to white, the largest channel at 1.
    const [r, g, b] = filmHighlights(2, 1, 0);
    expect([r, g, b].map((v) => +v.toFixed(6))).toEqual([1, 0.75, 0.5]);
    // Continuous at the knee, monotonic in intensity, and white in the end.
    const at = (k: number) => filmHighlights(k, k * 0.5, k * 0.25);
    expect(at(1 + 1e-9)[1]).toBeCloseTo(0.5, 6);
    let last = at(1);
    for (let k = 1; k < 64; k *= 1.1) {
      const now = at(k);
      for (let c = 0; c < 3; c++) expect(now[c]).toBeGreaterThanOrEqual(last[c] - 1e-12);
      last = now;
    }
    expect(at(1e6).every((v) => v > 0.999)).toBe(true);
    // The hue: the colour's direction away from white is kept.
    const ratio = (c: number[]) => (1 - c[1]) / (1 - c[2]);
    expect(ratio(at(3))).toBeCloseTo(ratio([1, 0.5, 0.25]), 9);
    // Clip, by contrast, clips each channel alone.
    expect(encodePixel(2, 1, 0, 1, "clip")[1]).toBeCloseTo(linearToSrgb(1), 9);
    expect(encodePixel(2, 1, 0, 1, "film")[1]).toBeCloseTo(linearToSrgb(0.75), 9);
  });
});

describe("transparent pixels", () => {
  it("keep no colour once their alpha is stored as 0, however faint their light", () => {
    expect(quantize8(0.001, 0.0005, 0, 0.001, 3, 4)).toEqual([0, 0, 0, 0]);
    expect(quantize8(0.004, 0.004, 0.004, 0.004, 3, 4)[3]).toBe(1);
  });
});
