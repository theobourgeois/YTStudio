import { describe, expect, it } from "vitest";
import { srgbToLinear } from "../../colour.ts";
import { autoSettings, autoStats } from "./auto.ts";

/** Pixels from a function of their index (0..1 along the picture) giving sRGB-encoded colours, as premultiplied linear. */
function pixels(n: number, code: (t: number) => [number, number, number]) {
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = code(i / (n - 1));
    data.set([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), 1], i * 4);
  }
  return data;
}

describe("Camera Raw's Auto", () => {
  it("brightens a dark picture and darkens a bright one", () => {
    const dark = autoSettings(autoStats(pixels(500, (t) => [0.05 + 0.25 * t, 0.05 + 0.25 * t, 0.05 + 0.25 * t]))!);
    expect(dark.exposure).toBeGreaterThan(0.8);
    const bright = autoSettings(autoStats(pixels(500, (t) => [0.6 + 0.35 * t, 0.6 + 0.35 * t, 0.6 + 0.35 * t]))!);
    expect(bright.exposure).toBeLessThan(-0.3);
  });

  it("gives a flat, dull picture contrast, its ends and vibrance", () => {
    const flat = autoSettings(autoStats(pixels(500, (t) => [0.35 + 0.25 * t, 0.38 + 0.2 * t, 0.4 + 0.2 * t]))!);
    expect(flat.contrast).toBeGreaterThan(10);
    expect(flat.whites).toBeGreaterThan(10);
    expect(flat.blacks).toBeLessThan(-10);
    expect(flat.vibrance).toBeGreaterThan(10);
  });

  it("pulls back clipped highlights and opens deep shadows", () => {
    const harsh = autoSettings(autoStats(pixels(500, (t) => (t > 0.85 ? [1, 1, 1] : t < 0.15 ? [0.02, 0.02, 0.02] : [t, t * 0.9, t * 0.8])))!);
    expect(harsh.highlights).toBeLessThan(-30);
    expect(harsh.shadows).toBeGreaterThan(15);
  });

  it("leaves a well-exposed, full-range picture nearly alone", () => {
    const good = autoSettings(autoStats(pixels(500, (t) => [t, Math.min(1, t * 1.05), t * 0.6 + 0.2]))!);
    expect(Math.abs(good.exposure)).toBeLessThan(0.35);
    expect(Math.abs(good.whites)).toBeLessThan(10);
    expect(Math.abs(good.blacks)).toBeLessThan(10);
  });

  it("reads nothing from transparent pixels", () => {
    expect(autoStats(new Float32Array(40))).toBeNull();
  });
});
