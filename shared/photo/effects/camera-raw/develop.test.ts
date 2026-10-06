import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../../colour.ts";
import { rand } from "../../reference/kernel.ts";
import { defaultParams } from "../params.ts";
import { developPixel, developSettings, developTable, keepingHue, neutralWhiteBalance, shiftCode } from "./develop.ts";
import { CHART, fixtureRuns } from "./fixtures.ts";
import { CAMERA_RAW, changedSections } from "./index.ts";
import { CAMERA_RAW_PARAMS } from "./params.ts";

/** A run developed by our maths: RMS against Camera Raw's own result, in 8-bit levels, over its ramp and its patches. */
function errors(run: ReturnType<typeof fixtureRuns>[number]) {
  const table = developTable(run.params);
  const s = developSettings(run.params, CHART);
  const code = (input: number[], x: number, y: number) =>
    developPixel(
      input.map((c) => srgbToLinear(c / 255)),
      x,
      y,
      table,
      s,
      rand,
    ).map((l) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, Math.min(1, l))))) * 255));
  const rms = (rows: { input: number[]; x: number; y: number; out: number[] }[]) =>
    Math.sqrt(rows.reduce((sum, r) => sum + code(r.input, r.x, r.y).reduce((a, v, i) => a + (v - r.out[i]) ** 2, 0), 0) / (rows.length * 3));
  return { ramp: rms(run.ramp.map((r) => ({ ...r, input: [r.input, r.input, r.input] }))), patches: rms(run.patches) };
}

/** What CR1 matches, and how closely (docs/photo/camera-raw.md, "CR1 as built"): the worst RMS a family's runs may have. */
const BOUNDS: [RegExp, { ramp: number; patches: number }][] = [
  [/^identity-chart$/, { ramp: 0.5, patches: 0.5 }],
  [/^exposure[+-][\d.]+$/, { ramp: 3.5, patches: 9.5 }],
  [/^contrast[+-]/, { ramp: 0.5, patches: 3 }],
  [/^blacks[+-]/, { ramp: 0.5, patches: 17.5 }],
  [/^whites[+-]/, { ramp: 0.5, patches: 17.5 }],
  [/^p(shadows|darks|lights|highlights)[+-]/, { ramp: 0.5, patches: 5 }],
  // Darks and Lights both at 100 with the Midtone Split moved: the one combination the regions' model misses.
  [/^psplits-(10-50-75|25-50-90)$/, { ramp: 2, patches: 7 }],
  [/^psplits-25-30-75$/, { ramp: 15, patches: 21.5 }],
  [/^point-/, { ramp: 0.5, patches: 3 }],
  // White balance on a rendered picture: greys within a few levels; saturated colours drift (unmatched so far).
  [/^temperature[+-]\d+$/, { ramp: 4, patches: 47 }],
  [/^tint[+-]/, { ramp: 6, patches: 33 }],
  [/^saturation[+-]/, { ramp: 0.5, patches: 13.5 }],
  [/^vibrance[+-]/, { ramp: 0.5, patches: 16 }],
  [/^bw$/, { ramp: 0.5, patches: 7 }],
  [/^vignette[+-]/, { ramp: 16, patches: 18.5 }],
  [/^(exposure\+1-(contrast|pdarks)|temperature\+50-saturation)/, { ramp: 1, patches: 9 }],
];

describe("Camera Raw's develop against Camera Raw 18.7 (CR0's fixtures)", () => {
  const runs = fixtureRuns();
  it("reads every run it has parameters for", () => {
    expect(runs.length).toBeGreaterThan(60);
  });
  it.each(BOUNDS.map(([re, b]) => [re.source, re, b] as const))("%s", (_name, re, bound) => {
    const mine = runs.filter((r) => re.test(r.name));
    expect(mine.length).toBeGreaterThan(0);
    const measured = mine.map((run) => ({ run, e: errors(run) }));
    if (process.env.CAMERA_RAW_REPORT) for (const { run, e } of measured) console.log(`${run.name.padEnd(28)} ramp ${e.ramp.toFixed(2).padStart(6)}  patches ${e.patches.toFixed(2).padStart(6)}`);
    for (const { run, e } of measured) {
      expect(e.ramp, `${run.name} ramp`).toBeLessThanOrEqual(bound.ramp);
      expect(e.patches, `${run.name} patches`).toBeLessThanOrEqual(bound.patches);
    }
  });
});

describe("Camera Raw's develop", () => {
  const at = (params: Record<string, unknown>, rgb: number[], x = 50, y = 50) => {
    const p = { ...defaultParams(CAMERA_RAW_PARAMS), ...params } as Record<string, never>;
    return developPixel(rgb, x, y, developTable(p), developSettings(p, { width: 100, height: 100 }), rand);
  };
  it("is the identity at its defaults, light above white included", () => {
    expect(CAMERA_RAW.isIdentity(defaultParams(CAMERA_RAW_PARAMS))).toBe(true);
    for (const rgb of [[0.2, 0.5, 0.9], [0, 0, 0], [1, 1, 1], [3, 1.5, 0.2]]) {
      at({}, rgb).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 4));
    }
  });
  it("moves a code by stops and back", () => {
    for (const c of [10, 60, 118]) {
      // Brightening and darkening have their own fits: a round trip is close, not exact.
      expect(Math.abs(shiftCode(shiftCode(c, 1), -1) - c)).toBeLessThan(3);
      expect(shiftCode(c, 0.5)).toBeGreaterThan(c);
    }
    expect(shiftCode(255, 1)).toBeGreaterThan(255);
    // White comes down when darkening (Camera Raw: −2 stops takes 255 to 197; the fit, a little less far).
    expect(shiftCode(255, -2)).toBeLessThan(220);
  });
  it("keeps hue: the middle channel stays in proportion", () => {
    const [r, g, b] = keepingHue([0.2, 0.5, 0.8], (v) => v * v);
    expect(r).toBeCloseTo(0.04, 10);
    expect(b).toBeCloseTo(0.64, 10);
    expect((g - r) / (b - r)).toBeCloseTo(0.5, 10);
  });
  it("keeps greys grey under Saturation, Vibrance and B&W", () => {
    for (const params of [{ saturation: 80 }, { vibrance: -60 }, { treatment: "bw" }]) {
      const [r, g, b] = at(params, [0.3, 0.3, 0.3]);
      expect(r).toBeCloseTo(0.3, 5);
      expect(g).toBeCloseTo(0.3, 5);
      expect(b).toBeCloseTo(0.3, 5);
    }
  });
  it("darkens the corners, not the middle", () => {
    expect(at({ vignette: -60 }, [0.3, 0.3, 0.3], 50, 50)[0]).toBeCloseTo(0.3, 5);
    expect(at({ vignette: -60 }, [0.3, 0.3, 0.3], 1, 1)[0]).toBeLessThan(0.1);
    expect(at({ vignette: 60 }, [0.3, 0.3, 0.3], 1, 1)[0]).toBeGreaterThan(0.5);
  });
  it("adds grain centred on the picture, the same each time", () => {
    const values = Array.from({ length: 400 }, (_, i) => at({ grain: 60 }, [0.2, 0.2, 0.2], i % 20, Math.floor(i / 20))[0]);
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    expect(Math.abs(mean - 0.2)).toBeLessThan(0.03);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.05);
    expect(at({ grain: 60 }, [0.2, 0.2, 0.2], 3, 7)).toEqual(at({ grain: 60 }, [0.2, 0.2, 0.2], 3, 7));
  });
  it("says which sections changed", () => {
    expect(changedSections({ ...defaultParams(CAMERA_RAW_PARAMS), exposure: 1, vignette: -20 })).toEqual(["light", "effects"]);
    expect(CAMERA_RAW.summary({ ...defaultParams(CAMERA_RAW_PARAMS), tint: 5 })).toBe("Color");
  });
  it("finds the white balance that makes a picked colour grey", () => {
    expect(neutralWhiteBalance([0.3, 0.3, 0.3])).toEqual({ temperature: 0, tint: 0 });
    // A warm cast wants cooling, a green one magenta.
    expect(neutralWhiteBalance([0.45, 0.3, 0.15]).temperature).toBeLessThan(-10);
    expect(neutralWhiteBalance([0.25, 0.4, 0.25]).tint).toBeGreaterThan(10);
    // And it is grey after, near enough.
    const cast = [0.42, 0.33, 0.22];
    const wb = neutralWhiteBalance(cast);
    const p = { ...defaultParams(CAMERA_RAW_PARAMS), ...wb };
    const [r, g, b] = developPixel(cast, 0, 0, developTable(p), developSettings(p, { width: 10, height: 10 }), rand);
    expect(Math.abs(r - g) / g).toBeLessThan(0.08);
    expect(Math.abs(b - g) / g).toBeLessThan(0.08);
  });
});
