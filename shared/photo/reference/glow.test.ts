import { describe, expect, it } from "vitest";
import { type GlowParams, contribution, contributionWeight, glowOctaves, glowReach } from "../effects/glow.ts";
import { type FloatImage, glowReference } from "./glow.ts";

const PARAMS: GlowParams = { radius: 16, intensity: 0, threshold: 50, knee: 0, tint: "#ffffff", tintAmount: 0, mix: 100 };

/** A transparent image with opaque squares of light `value` at each (x, y, size). */
function image(width: number, height: number, squares: [number, number, number, number][], background: [number, number, number, number] = [0, 0, 0, 0]): FloatImage {
  const data = new Float64Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(background, i * 4);
  for (const [x0, y0, size, value] of squares) {
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) data.set([value, value, value, 1], (y * width + x) * 4);
  }
  return { width, height, data };
}

const sum = (a: Float64Array, stride: number, channel = 0) => {
  let s = 0;
  for (let i = channel; i < a.length; i += stride) s += a[i];
  return s;
};

describe("the glow (version 1)", () => {
  it("has six octaves halving from radius / 2, each on the coarsest level that keeps 1.5 texels, weights summing to 1", () => {
    const o = glowOctaves(100);
    expect(o.map((x) => x.sigma)).toEqual([50, 25, 12.5, 6.25, 3.125, 1.5625]);
    expect(o.map((x) => x.level)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(o.every((x) => x.texels >= 1.5 && x.texels < 3)).toBe(true);
    expect(o.reduce((a, x) => a + x.weight, 0)).toBeCloseTo(1, 12);
    // A tiny radius keeps its octaves at level 0, however small.
    expect(glowOctaves(2).every((x) => x.level === 0)).toBe(true);
    expect(glowReach(100)).toBeGreaterThan(3 * 50);
  });

  it("keeps the light's energy: the glow adds what was over the threshold, times its gain", () => {
    const img = image(128, 128, [[60, 60, 8, 2]]);
    const { light } = glowReference(img, PARAMS);
    // 64 pixels of light 2, all over the threshold.
    expect(sum(light, 3) / (64 * 2)).toBeCloseTo(1, 2);
    const brighter = glowReference(img, { ...PARAMS, intensity: 1, mix: 50 });
    expect(sum(brighter.light, 3) / sum(light, 3)).toBeCloseTo(1, 9);
  });

  it("is symmetric under mirroring (the pyramid's phase is the document's)", () => {
    const img = image(64, 64, [[12, 20, 6, 3], [40, 30, 4, 1.5]]);
    const mirrored: FloatImage = { ...img, data: new Float64Array(img.data.length) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let c = 0; c < 4; c++) mirrored.data[(y * 64 + (63 - x)) * 4 + c] = img.data[(y * 64 + x) * 4 + c];
    const a = glowReference(img, PARAMS).light;
    const b = glowReference(mirrored, PARAMS).light;
    let worst = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) worst = Math.max(worst, Math.abs(a[(y * 64 + x) * 3] - b[(y * 64 + (63 - x)) * 3]));
    expect(worst).toBeLessThan(1e-12);
  });

  it("falls off monotonically from a point of light, and reaches no further than glowReach", () => {
    const img = image(160, 160, [[80, 80, 1, 50]]);
    const { light } = glowReference(img, { ...PARAMS, radius: 20 });
    const row = Array.from({ length: 70 }, (_, d) => light[(80 * 160 + 80 + d) * 3]);
    for (let d = 1; d < row.length; d++) expect(row[d]).toBeLessThanOrEqual(row[d - 1] + 1e-12);
    const reach = glowReach(20);
    for (let d = Math.ceil(reach) + 1; d < 79; d++) expect(light[(80 * 160 + 80 + d) * 3]).toBe(0);
    expect(row[0]).toBeGreaterThan(0);
  });

  it("starts at the knee and is full from the threshold, on linear luminance", () => {
    expect(contributionWeight(0.5, 0.5, 0.25)).toBe(1);
    expect(contributionWeight(0.375, 0.5, 0.25)).toBe(0);
    expect(contributionWeight(0.4375, 0.5, 0.25)).toBeCloseTo(0.5, 12);
    expect(contributionWeight(0.49, 0.5, 0)).toBe(0);
    expect(contributionWeight(0, 0, 0)).toBe(1);
    // Premultiplied: the colour's own brightness decides, not its coverage.
    expect(contribution(0.4, 0.4, 0.4, 0.5, 0.75, 0)).toEqual([0.4, 0.4, 0.4]);
    expect(contribution(0.4, 0.4, 0.4, 1, 0.75, 0)).toEqual([0, 0, 0]);
    expect(contribution(1, 1, 1, 0, 0, 0)).toEqual([0, 0, 0]);
    const dim = glowReference(image(64, 64, [[28, 28, 8, 0.4]]), PARAMS);
    expect(sum(dim.light, 3)).toBe(0);
  });

  it("gives light coverage where the layer had none, and nothing at all where there's no light", () => {
    const { light, out } = glowReference(image(96, 96, [[44, 44, 8, 4]]), PARAMS);
    for (let i = 0; i < 96 * 96; i++) {
      const l = Math.max(light[i * 3], light[i * 3 + 1], light[i * 3 + 2]);
      const inside = out[i * 4 + 3] === 1 && l > 0 && (i % 96) >= 44 && (i % 96) < 52 && Math.floor(i / 96) >= 44 && Math.floor(i / 96) < 52;
      if (inside) continue;
      expect(out[i * 4 + 3]).toBeCloseTo(Math.min(1, l), 12);
      if (out[i * 4 + 3] === 0) expect([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]).toEqual([0, 0, 0]);
    }
  });

  it("tints by luminance and never makes NaN from extreme light", () => {
    const img = image(64, 64, [[30, 30, 2, 5e4]], [0, 0, 0, 0]);
    img.data[0] = -2; // out of gamut, no alpha: guarded
    const { light, out } = glowReference(img, { ...PARAMS, tint: "#ff0000", tintAmount: 100, intensity: 6 });
    expect(out.every(Number.isFinite)).toBe(true);
    // Fully tinted red: no green or blue.
    expect(sum(light, 3, 1)).toBe(0);
    expect(sum(light, 3, 0)).toBeGreaterThan(0);
  });
});
