import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "./colour.ts";
import { addAdjustmentLayer, addImageLayer, duplicateLayer, resetEffect, setEffectParams, setTransform } from "./edits.ts";
import { CURVE_TABLE_SIZE, curveFunction, curveTable, identityChannels, isIdentityCurve } from "./effects/curve-math.ts";
import { ADJUSTMENTS, effectDefinition, newEffect, unavailableReason, validateParams } from "./effects/index.ts";
import { IDENTITY_POINTS, identityCurveSet, sanitizePoints } from "./effects/params.ts";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import { curvesFor, exposurePixel, fade } from "./reference/adjustments.ts";
import { type AdjustmentLayer, type CurveSet, PHOTO_VERSION, type PhotoProject } from "./types.ts";

const image = (id: string) => ({ id, mediaId: `media_${id}`, name: `Image ${id}`, size: { width: 400, height: 200 } });
const adjustment = (doc: PhotoProject, id: string) => doc.layers.find((l) => l.id === id) as AdjustmentLayer;

describe("curves", () => {
  it("are a natural spline through their points, flat past the ends, held to [0, 1]", () => {
    const f = curveFunction([
      [0, 0],
      [64, 100],
      [255, 255],
    ]);
    expect(f(0)).toBe(0);
    expect(f(64 / 255)).toBeCloseTo(100 / 255, 12);
    expect(f(1)).toBe(1);
    // Smooth: no kink at the middle point (the slopes either side agree).
    const h = 1e-6;
    const x = 64 / 255;
    expect((f(x + h) - f(x)) / h).toBeCloseTo((f(x) - f(x - h)) / h, 3);
    const flat = curveFunction([
      [50, 30],
      [200, 220],
    ]);
    expect(flat(0.1)).toBeCloseTo(30 / 255, 12);
    expect(flat(0.95)).toBeCloseTo(220 / 255, 12);
    // A steep S overshoots between points: held to [0, 1].
    const s = curveFunction([
      [0, 0],
      [100, 0],
      [110, 255],
      [255, 255],
    ]);
    for (let i = 0; i <= 100; i++) expect(s(i / 100)).toBeGreaterThanOrEqual(0), expect(s(i / 100)).toBeLessThanOrEqual(1);
  });

  it("know when they're the identity, a straight diagonal through any points on it", () => {
    expect(isIdentityCurve(IDENTITY_POINTS)).toBe(true);
    expect(isIdentityCurve([[0, 0], [128, 128], [255, 255]])).toBe(true);
    expect(isIdentityCurve([[10, 10], [255, 255]])).toBe(false);
    const f = curveFunction([[0, 0], [128, 128], [255, 255]]);
    for (let i = 0; i <= 255; i++) expect(f(i / 255)).toBeCloseTo(i / 255, 14);
  });

  it("check points: held to 0..255, sorted, one per input, 2 to 16", () => {
    expect(sanitizePoints([[0, 0], [255, 255]])).toEqual({ value: [[0, 0], [255, 255]], repaired: false });
    expect(sanitizePoints([[255, 300], [0, -4], [0, 7], ["x", 1]])).toEqual({ value: [[0, 7], [255, 255]], repaired: true });
    expect(sanitizePoints([[10, 10]]).value).toEqual(IDENTITY_POINTS);
    const many = Array.from({ length: 20 }, (_, i) => [i * 10, i * 10]);
    expect(sanitizePoints(many).value).toHaveLength(16);
  });

  it("apply each channel's curve, then the composite, in a table the GPU interpolates within 1e-5", () => {
    const set: CurveSet = { ...identityCurveSet(), rgb: [[0, 0], [128, 160], [255, 255]], red: [[0, 30], [255, 255]] };
    const table = curveTable(set);
    const rgb = curveFunction(set.rgb);
    const red = curveFunction(set.red);
    expect(table[0]).toBeCloseTo(rgb(red(0)), 7);
    expect(table[CURVE_TABLE_SIZE]).toBe(0);
    // Between table entries, linear interpolation is close to the spline.
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const x = i / 9999;
      const at = x * (CURVE_TABLE_SIZE - 1);
      const lo = Math.floor(at);
      const hi = Math.min(CURVE_TABLE_SIZE - 1, lo + 1);
      const lerp = table[lo] + (table[hi] - table[lo]) * (at - lo);
      worst = Math.max(worst, Math.abs(lerp - rgb(red(x))));
    }
    expect(worst).toBeLessThan(1e-5);
    expect(identityChannels(set)).toEqual([false, false, false]);
    expect(identityChannels({ ...identityCurveSet(), blue: [[0, 0], [100, 120], [255, 255]] })).toEqual([true, true, false]);
  });
});

describe("the adjustments' references", () => {
  it("exposure multiplies linear light by 2^stops, adds the offset, then the gamma's power, mirrored below 0", () => {
    expect(exposurePixel([0.25, 0.1, 0, 1], { exposure: 1, offset: 0, gamma: 1 })).toEqual([0.5, 0.2, 0, 1]);
    // Premultiplied: the same light at half alpha.
    expect(exposurePixel([0.125, 0.05, 0, 0.5], { exposure: 1, offset: 0, gamma: 1 })).toEqual([0.25, 0.1, 0, 0.5]);
    const offset = exposurePixel([0.2, 0, 0, 0.5], { exposure: 0, offset: 0.1, gamma: 1 });
    expect(offset[0]).toBeCloseTo(0.25, 12);
    const gamma = exposurePixel([0.25, -0.25, 0, 1], { exposure: 0, offset: 0, gamma: 2 });
    expect(gamma[0]).toBeCloseTo(0.5, 12);
    expect(gamma[1]).toBeCloseTo(-0.5, 12);
    // Transparent stays transparent; light above white isn't clipped.
    expect(exposurePixel([0, 0, 0, 0], { exposure: 3, offset: 0.2, gamma: 1 })).toEqual([0, 0, 0, 0]);
    expect(exposurePixel([0.8, 0, 0, 1], { exposure: 2, offset: 0, gamma: 1 })[0]).toBe(3.2);
  });

  it("curves work on encoded values, pass values outside [0, 1] through, and leave untouched channels exact", () => {
    const lift = curvesFor({ ...identityCurveSet(), rgb: [[0, 0], [128, 192], [255, 255]] });
    const half = srgbToLinear(128 / 255);
    expect(linearToSrgb(lift([half, 0, 1, 1])[0])).toBeCloseTo(192 / 255, 9);
    expect(lift([1.5, -0.2, 0, 1]).slice(0, 2)).toEqual([1.5, -0.2]);
    const blueOnly = curvesFor({ ...identityCurveSet(), blue: [[0, 50], [255, 255]] });
    const px: [number, number, number, number] = [0.123456789, 0.987654321, 0, 0.75];
    const out = blueOnly(px);
    expect(out[0]).toBe(px[0]);
    expect(out[1]).toBe(px[1]);
    expect(out[2]).toBeCloseTo(srgbToLinear(50 / 255) * 0.75, 12);
  });

  it("fade by opacity over what was below", () => {
    expect(fade([0, 0, 0, 1], [1, 1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25, 1]);
    const adjusted: [number, number, number, number] = [1, 2, 3, 1];
    expect(fade([0, 0, 0, 1], adjusted, 1)).toBe(adjusted);
  });
});

describe("effect definitions", () => {
  it("say when they're the identity and when they commute with reduction", () => {
    const exposure = effectDefinition("exposure")!;
    const curves = effectDefinition("curves")!;
    expect(ADJUSTMENTS.map((d) => d.type)).toEqual(["exposure", "curves"]);
    expect(exposure.isIdentity(newEffect(exposure, "e").params)).toBe(true);
    expect(curves.isIdentity(newEffect(curves, "c").params)).toBe(true);
    expect(exposure.commutesWithReduction({ exposure: 2, offset: 0.1, gamma: 1 })).toBe(true);
    expect(exposure.commutesWithReduction({ exposure: 0, offset: 0, gamma: 1.4 })).toBe(false);
    expect(curves.commutesWithReduction(newEffect(curves, "c").params)).toBe(false);
    expect(exposure.summary({ exposure: 1.5, offset: 0, gamma: 1 })).toBe("+1.5 stops");
    expect(curves.summary({ curves: { ...identityCurveSet(), red: [[0, 20], [255, 255]] } })).toBe("Red shaped");
  });

  it("validate parameters: defaults for what's missing or bad, ranges held, unknown keys reported", () => {
    const exposure = effectDefinition("exposure")!;
    const { params, problems } = validateParams(exposure, { exposure: 99, gamma: "x", tint: 3 });
    expect(params).toEqual({ exposure: 20, offset: 0, gamma: 1 });
    expect(problems).toHaveLength(3);
  });
});

describe("adjustment layers", () => {
  const base = addImageLayer(createPhotoProject("A"), image("a"));

  it("are added above a layer (or on top), at their defaults or given parameters, and edited", () => {
    const d = addAdjustmentLayer(base, { id: "x", type: "exposure", params: { exposure: 1 } }, "a");
    expect(d.layers.map((l) => l.id)).toEqual(["a", "x"]);
    expect(adjustment(d, "x")).toMatchObject({ kind: "adjustment", name: "Exposure", effect: { id: "x_fx", type: "exposure", version: 1, params: { exposure: 1, offset: 0, gamma: 1 } } });
    expect(addAdjustmentLayer(base, { id: "y", type: "sparkle" })).toBe(base);
    const edited = setEffectParams(d, "x", { exposure: 2.5, gamma: 50 });
    expect(adjustment(edited, "x").effect.params).toEqual({ exposure: 2.5, offset: 0, gamma: 9.99 });
    expect(setEffectParams(edited, "x", { exposure: 2.5 })).toBe(edited);
    expect(setEffectParams(edited, "x", { exposure: Number.NaN, nope: 1 })).toBe(edited);
    expect(setEffectParams(edited, "a", { exposure: 1 })).toBe(edited);
    expect(adjustment(resetEffect(edited, "x"), "x").effect.params).toEqual({ exposure: 0, offset: 0, gamma: 1 });
    // They have no place of their own.
    expect(setTransform(edited, "x", { x: 4 })).toBe(edited);
    // A duplicate's effect has an id of its own.
    const copy = duplicateLayer(edited, "x", "x2");
    expect(adjustment(copy, "x2").effect.id).toBe("x2_fx");
    expect(adjustment(copy, "x2").effect.params).toEqual(adjustment(edited, "x").effect.params);
  });

  it("are normalised: parameters repaired and reported, unknown or newer effects kept as they were", () => {
    const problems: string[] = [];
    const doc = normalizePhotoProject(
      {
        version: 1,
        layers: [
          { kind: "adjustment", id: "e", effect: { id: "e_fx", type: "exposure", version: 1, params: { exposure: "bright", offset: 1 } } },
          { kind: "adjustment", id: "f", effect: { id: "f_fx", type: "glimmer", version: 3, params: { shine: [1, 2] } } },
          { kind: "adjustment", id: "g", effect: { id: "g_fx", type: "curves", version: 9, params: { anything: true } } },
          { kind: "adjustment", id: "h" },
        ],
      },
      (p) => problems.push(p),
    );
    expect(doc.version).toBe(PHOTO_VERSION);
    expect(doc.layers.map((l) => l.id)).toEqual(["e", "f", "g"]);
    expect(adjustment(doc, "e").effect.params).toEqual({ exposure: 0, offset: 0.5, gamma: 1 });
    expect(adjustment(doc, "f").effect).toEqual({ id: "f_fx", type: "glimmer", version: 3, enabled: true, params: { shine: [1, 2] } });
    expect(unavailableReason(adjustment(doc, "f").effect)).toMatch(/isn't an effect/);
    expect(unavailableReason(adjustment(doc, "g").effect)).toMatch(/newer version/);
    expect(adjustment(doc, "g").effect.params).toEqual({ anything: true });
    expect(problems.length).toBeGreaterThanOrEqual(4);
    // Unavailable effects are never edited.
    expect(setEffectParams(doc, "g", { curves: identityCurveSet() })).toBe(doc);
    expect(normalizePhotoProject(doc)).toEqual(doc);
  });
});
