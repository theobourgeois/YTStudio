import { describe, expect, it } from "vitest";
import { BLEND_MODES } from "../blending.ts";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import type { BlendMode } from "../types.ts";
import fixtures from "./blend-fixtures.json" with { type: "json" };
import { type BlendParams, type Rgba, blendColour, blendIfGate, compositeAdjustment, compositePixel, dissolveThreshold, rangePass } from "./blend.ts";

const params = (mode: BlendMode, p: Partial<BlendParams> = {}): BlendParams => ({
  mode,
  opacity: 1,
  fill: 1,
  channels: { r: true, g: true, b: true },
  blendIf: {},
  compositing: "photoshop",
  ...p,
});
const fromCode = (c: number[], a = 1): Rgba => [srgbToLinear(c[0] / 255) * a, srgbToLinear(c[1] / 255) * a, srgbToLinear(c[2] / 255) * a, a];
// Photoshop rounds an exact half up: 50% white over black is 128.
const toCode = (p: Rgba) => [0, 1, 2].map((i) => Math.round(linearToSrgb(p[i] / p[3]) * 255 + 1e-6));

/** Photoshop's integer arithmetic leaves these: measured in photoshop-measurements.md. */
const TOLERANCE: Partial<Record<BlendMode, number>> = { hue: 7, saturation: 7, color: 7, luminosity: 7, "hard-mix": 6, "vivid-light": 2, "linear-light": 2, "color-burn": 2, "color-dodge": 2, "hard-light": 2 };
const lumOf = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

describe("blend modes against Photoshop 27.11", () => {
  for (const c of fixtures.cases) {
    const mode = c.mode as BlendMode;
    it(`${mode} at opacity ${c.opacity}, fill ${c.fill}, alpha ${c.alpha.toFixed(2)}`, () => {
      const tolerance = TOLERANCE[mode] ?? 1;
      for (const row of c.rows) {
        const [b, s, want] = [row.slice(0, 3), row.slice(3, 6), row.slice(6, 9)];
        // Darker and Lighter Color pick the other colour at near-ties (within a level): Photoshop's integers.
        if ((mode === "darker-color" || mode === "lighter-color") && Math.abs(lumOf(b) - lumOf(s)) < 1.5) continue;
        // Dissolve's speckle is Photoshop's own noise: only its 100% (Normal) can match pixel for pixel.
        if (mode === "dissolve" && (c.opacity < 1 || c.fill < 1 || c.alpha < 1)) continue;
        // Hard Mix at reduced opacity rounds its threshold right at the diagonal.
        if (mode === "hard-mix" && Math.abs(b[0] + s[0] - 255) <= 1) continue;
        const got = toCode(compositePixel(fromCode(b), fromCode(s, c.alpha), params(mode, { opacity: c.opacity, fill: c.fill })));
        got.forEach((v, i) => expect(Math.abs(v - want[i]), `${mode} b=${b} s=${s}: got ${got}, Photoshop ${want}`).toBeLessThanOrEqual(tolerance));
      }
    });
  }
  it("covers every mode", () => {
    expect(new Set(fixtures.cases.map((c) => c.mode))).toEqual(new Set(BLEND_MODES.map((m) => m.id)));
  });
});

describe("compositing", () => {
  it("mixes encoded values the Photoshop way, linear light the other", () => {
    const white: Rgba = [1, 1, 1, 1];
    const black: Rgba = [0, 0, 0, 1];
    expect(toCode(compositePixel(black, white, params("normal", { opacity: 0.5 })))[0]).toBe(128);
    expect(toCode(compositePixel(black, white, params("normal", { opacity: 0.5, compositing: "linear" })))[0]).toBe(188);
  });
  it("leaves a grey Overlay layer neutral in Photoshop's compositing", () => {
    const grey = fromCode([128, 128, 128]);
    for (const v of [10, 90, 200]) expect(toCode(compositePixel(fromCode([v, v, v]), grey, params("overlay")))[0]).toBeCloseTo(v, -0.5);
  });
  it("shows the layer as Normal over transparency, whatever the mode", () => {
    const layer = fromCode([200, 40, 90], 0.6);
    const out = compositePixel([0, 0, 0, 0], layer, params("multiply"));
    out.forEach((v, i) => expect(v).toBeCloseTo(layer[i], 6));
  });
  it("keeps the backdrop in an excluded channel", () => {
    const out = toCode(compositePixel(fromCode([10, 20, 30]), fromCode([200, 200, 200]), params("normal", { channels: { r: false, g: true, b: true } })));
    expect(out).toEqual([10, 200, 200]);
  });
  it("lets light above white through the unbounded modes", () => {
    const bright: Rgba = [3, 3, 3, 1];
    expect(compositePixel([0.2, 0.2, 0.2, 1], bright, params("normal"))[0]).toBeCloseTo(3, 4);
    expect(compositePixel([0.2, 0.2, 0.2, 1], bright, params("linear-dodge"))[0]).toBeGreaterThan(3);
    // Within sRGB, Add clips at white as Photoshop's does.
    expect(toCode(compositePixel(fromCode([200, 200, 200]), fromCode([150, 150, 150]), params("linear-dodge")))[0]).toBe(255);
  });
  it("is exact for Normal and leaves an opaque layer as it is", () => {
    const layer = fromCode([37, 140, 251]);
    expect(toCode(compositePixel(fromCode([1, 2, 3]), layer, params("normal")))).toEqual([37, 140, 251]);
  });
});

describe("Blend If", () => {
  it("ramps across a split handle, both ends inside", () => {
    expect(rangePass([45, 124, 255, 255], 80)).toBeCloseTo(36 / 80, 6);
    expect(rangePass([45, 124, 255, 255], 44)).toBe(0);
    expect(rangePass([45, 124, 255, 255], 124)).toBe(1);
    expect(rangePass([0, 0, 235, 235], 236)).toBe(0);
    expect(rangePass([0, 0, 255, 255], 0)).toBe(1);
  });
  it("lets the transparent backdrop through the Underlying test", () => {
    const cut = { gray: { layer: [0, 0, 255, 255] as [number, number, number, number], underlying: [200, 200, 255, 255] as [number, number, number, number] } };
    expect(blendIfGate(cut, [0.5, 0.5, 0.5], [0.1, 0.1, 0.1], 0)).toBe(1);
    expect(blendIfGate(cut, [0.5, 0.5, 0.5], [0.1, 0.1, 0.1], 1)).toBe(0);
  });
  it("hides a layer's bright pixels with This Layer's white handle", () => {
    const blendIf = { gray: { layer: [0, 0, 128, 128] as [number, number, number, number], underlying: [0, 0, 255, 255] as [number, number, number, number] } };
    expect(toCode(compositePixel(fromCode([0, 0, 0]), fromCode([250, 250, 250]), params("normal", { blendIf })))).toEqual([0, 0, 0]);
    expect(toCode(compositePixel(fromCode([0, 0, 0]), fromCode([100, 100, 100]), params("normal", { blendIf })))).toEqual([100, 100, 100]);
  });
});

describe("Dissolve", () => {
  it("keeps about as many pixels as its opacity, the same ones every time", () => {
    let kept = 0;
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        const out = compositePixel([0, 0, 0, 1], [1, 1, 1, 1], params("dissolve", { opacity: 0.3, dissolveAt: { x, y, seed: 7 } }));
        if (out[0] > 0.99) kept++;
        else expect(out[0]).toBe(0);
      }
    expect(kept / 10_000).toBeCloseTo(0.3, 1);
    expect(dissolveThreshold(5, 9, 7)).toBe(dissolveThreshold(5, 9, 7));
  });
});

describe("adjustment layers' modes", () => {
  it("leave alpha alone and blend the adjusted colour by the mode", () => {
    const original = fromCode([100, 150, 200], 0.5);
    const brighter = fromCode([200, 250, 255], 0.5);
    const out = compositeAdjustment(original, brighter, 1, params("normal"));
    expect(out[3]).toBe(0.5);
    expect(toCode(out)).toEqual([200, 250, 255]);
    const half = toCode(compositeAdjustment(original, brighter, 0.5, params("normal")));
    expect(half).toEqual([150, 200, 228]);
    expect(blendColour("multiply", [0.5, 0.5, 0.5], [0.5, 0.5, 0.5])).toEqual([0.25, 0.25, 0.25]);
  });
});
