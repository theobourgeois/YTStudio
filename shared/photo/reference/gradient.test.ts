import { describe, expect, it } from "vitest";
import { srgbToLinear } from "../colour.ts";
import { addGeneratorLayer, findLayer } from "../edits.ts";
import { GRADIENT_FILL, GRADIENT_FILL_PRESETS, type GradientFillShape, gradientDither, gradientFillShape, gradientT } from "../effects/gradient.ts";
import { effectDefinition, validateParams } from "../effects/index.ts";
import { createPhotoProject } from "../project.ts";
import { GRADIENT_PRESETS, gradientAt } from "../style/gradients.ts";
import type { DocPoint, Gradient, GeneratorLayer } from "../types.ts";
import { fillTable, gradientColourAt, gradientFillPixel, paintMask, paintPixel, tableAt } from "./gradient.ts";

const BW = GRADIENT_PRESETS[0];
const shape = (style: GradientFillShape["style"], start: DocPoint, end: DocPoint, extra: Partial<GradientFillShape> = {}): GradientFillShape => ({ style, start, end, gradient: { ...BW, method: "classic" }, reverse: false, dither: false, ...extra });

describe("the line's types", () => {
  it("Linear runs from the start to the end, held past them", () => {
    expect(gradientT("linear", [0, 0], [100, 0], 0, 50)).toBeCloseTo(0);
    expect(gradientT("linear", [0, 0], [100, 0], 25, -30)).toBeCloseTo(0.25);
    expect(gradientT("linear", [0, 0], [100, 0], 100, 10)).toBeCloseTo(1);
    expect(gradientT("linear", [0, 0], [100, 0], -40, 0)).toBe(0);
    expect(gradientT("linear", [0, 0], [100, 0], 400, 0)).toBe(1);
    // Turned: across the line it's the same.
    expect(gradientT("linear", [0, 0], [0, 100], 70, 50)).toBeCloseTo(0.5);
  });

  it("Radial is a circle around the start, the line its radius", () => {
    expect(gradientT("radial", [50, 50], [150, 50], 50, 50)).toBe(0);
    expect(gradientT("radial", [50, 50], [150, 50], 50, 100)).toBeCloseTo(0.5);
    expect(gradientT("radial", [50, 50], [150, 50], 50, 300)).toBe(1);
  });

  it("Angle sweeps anticlockwise on the screen from the line's direction", () => {
    // The line points right; a quarter turn anticlockwise on the screen is up (y down).
    expect(gradientT("angle", [0, 0], [10, 0], 10, 0.0001)).toBeGreaterThan(0.99);
    expect(gradientT("angle", [0, 0], [10, 0], 10, -0.0001)).toBeLessThan(0.01);
    expect(gradientT("angle", [0, 0], [10, 0], 0, -10)).toBeCloseTo(0.25);
    expect(gradientT("angle", [0, 0], [10, 0], -10, 0)).toBeCloseTo(0.5);
    expect(gradientT("angle", [0, 0], [10, 0], 0, 10)).toBeCloseTo(0.75);
  });

  it("Reflected mirrors the linear gradient about the start", () => {
    expect(gradientT("reflected", [100, 0], [200, 0], 150, 0)).toBeCloseTo(0.5);
    expect(gradientT("reflected", [100, 0], [200, 0], 50, 0)).toBeCloseTo(0.5);
    expect(gradientT("reflected", [100, 0], [200, 0], 100, 0)).toBe(0);
  });

  it("Diamond reaches its end at the end, a corner, and turns with the line", () => {
    expect(gradientT("diamond", [0, 0], [100, 0], 100, 0)).toBeCloseTo(1);
    expect(gradientT("diamond", [0, 0], [100, 0], 50, 50)).toBeCloseTo(1);
    expect(gradientT("diamond", [0, 0], [100, 0], 25, 25)).toBeCloseTo(0.5);
    expect(gradientT("diamond", [0, 0], [0, 100], 0, -100)).toBeCloseTo(1);
  });

  it("a line of no length is all its end", () => {
    for (const style of ["linear", "radial", "angle", "reflected", "diamond"] as const) expect(gradientT(style, [5, 5], [5, 5], 0, 0)).toBe(1);
  });
});

describe("the table both sides read", () => {
  it("is the gradient within a hair of the exact value, whatever the method", () => {
    for (const method of ["classic", "linear", "perceptual", "smooth"] as const) {
      const g: Gradient = { ...GRADIENT_PRESETS[4], method };
      const table = fillTable({ ...shape("linear", [0, 0], [1, 0]), gradient: g });
      for (let t = 0; t <= 1; t += 0.0137) {
        const exact = gradientAt(g, t);
        const got = tableAt(table, t);
        for (let c = 0; c < 4; c++) expect(Math.abs(got[c] - exact[c])).toBeLessThan(2e-4);
      }
    }
  });

  it("Reverse runs it from the end", () => {
    const s = shape("linear", [0, 0], [100, 0], { reverse: true });
    expect(gradientColourAt(s, fillTable(s), 0.5, 0)[0]).toBeGreaterThan(0.99);
    expect(gradientColourAt(s, fillTable(s), 99.5, 0)[0]).toBeLessThan(0.01);
  });
});

describe("methods", () => {
  const two: Gradient = { name: "t", method: "stripes", colours: [{ at: 0, colour: "#0000ff" }, { at: 1, colour: "#ffff00" }], opacities: [{ at: 0, opacity: 1 }, { at: 1, opacity: 1 }] };

  it("Stripes doesn't mix: a stretch is the stop it ends at", () => {
    expect(gradientAt(two, 0)).toEqual([0, 0, 1, 1]);
    expect(gradientAt(two, 0.01)).toEqual([1, 1, 0, 1]);
    expect(gradientAt(two, 0.99)).toEqual([1, 1, 0, 1]);
    const three: Gradient = { ...two, colours: [...two.colours.slice(0, 1), { at: 0.5, colour: "#ff0000" }, two.colours[1]] };
    expect(gradientAt(three, 0.3)).toEqual([1, 0, 0, 1]);
    expect(gradientAt(three, 0.7)).toEqual([1, 1, 0, 1]);
  });

  it("Smooth is level at its stops and Perceptual's halfway", () => {
    const smooth: Gradient = { ...BW, method: "smooth" };
    const perceptual: Gradient = { ...BW, method: "perceptual" };
    expect(gradientAt(smooth, 0.5)[0]).toBeCloseTo(gradientAt(perceptual, 0.5)[0], 6);
    // Eased: flatter than Perceptual near the ends.
    expect(gradientAt(smooth, 0.05)[0]).toBeLessThan(gradientAt(perceptual, 0.05)[0]);
    expect(gradientAt(smooth, 0.95)[0]).toBeGreaterThan(gradientAt(perceptual, 0.95)[0]);
  });
});

describe("Dither", () => {
  it("is under one 8-bit level, averages out, and is the same at a pixel wherever it's read", () => {
    let sum = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const d = gradientDither(x, y);
        expect(Math.abs(d)).toBeLessThan(1);
        sum += d;
      }
    expect(Math.abs(sum / 4096)).toBeLessThan(0.02);
    expect(gradientDither(-3, 7)).toBe(gradientDither(-3, 7));
    // Within a pixel the offset is that pixel's.
    const s = shape("linear", [0, 0], [255, 0], { dither: true });
    const plain = { ...s, dither: false };
    const table = fillTable(s);
    const offset = (x: number, y: number) => gradientColourAt(s, table, x, y)[0] - gradientColourAt(plain, table, x, y)[0];
    expect(offset(10.2, 3.9)).toBeCloseTo(gradientDither(10, 3) / 255, 9);
    expect(offset(10.8, 3.1)).toBeCloseTo(gradientDither(10, 3) / 255, 9);
  });
});

describe("a Gradient Fill's pixel", () => {
  it("is premultiplied linear light, its opacity its coverage", () => {
    const g: Gradient = { name: "fade", method: "classic", colours: [{ at: 0, colour: "#ff8000" }, { at: 1, colour: "#ff8000" }], opacities: [{ at: 0, opacity: 1 }, { at: 1, opacity: 0 }] };
    const s = shape("linear", [0, 0], [100, 0], { gradient: g });
    const p = gradientFillPixel(s, fillTable(s), 50, 0);
    expect(p[3]).toBeCloseTo(0.5, 2);
    expect(p[0] / p[3]).toBeCloseTo(1, 5);
    expect(p[1] / p[3]).toBeCloseTo(srgbToLinear(128 / 255), 2);
  });
});

describe("Classic onto pixels and masks", () => {
  const opaque = [0.2, 0.4, 0.6, 1] as [number, number, number, number];

  it("Normal at full opacity is the gradient's colour", () => {
    const out = paintPixel(opaque, [1, 0.5, 0, 1], { mode: "normal", opacity: 1, compositing: "photoshop" }, 0, 0);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(srgbToLinear(0.5), 6);
    expect(out[3]).toBe(1);
  });

  it("Opacity mixes it in the photo's values (encoded in a Photoshop photo)", () => {
    const out = paintPixel([0, 0, 0, 1], [1, 1, 1, 1], { mode: "normal", opacity: 0.5, compositing: "photoshop" }, 0, 0);
    expect(out[0]).toBeCloseTo(srgbToLinear(0.5), 6);
    const linear = paintPixel([0, 0, 0, 1], [1, 1, 1, 1], { mode: "normal", opacity: 0.5, compositing: "linear" }, 0, 0);
    expect(linear[0]).toBeCloseTo(0.5, 6);
  });

  it("Behind goes only where it's transparent; Clear takes the layer away", () => {
    expect(paintPixel(opaque, [1, 1, 1, 1], { mode: "behind", opacity: 1, compositing: "linear" }, 0, 0)).toEqual(opaque);
    const under = paintPixel([0, 0, 0, 0], [1, 1, 1, 1], { mode: "behind", opacity: 1, compositing: "linear" }, 0, 0);
    expect(under[3]).toBeCloseTo(1);
    expect(paintPixel(opaque, [0, 0, 0, 0.5], { mode: "clear", opacity: 1, compositing: "linear" }, 0, 0)[3]).toBeCloseTo(0.5);
  });

  it("a mask takes the gradient's grey: black hides, white reveals, opacity mixes", () => {
    expect(paintMask(1, [0, 0, 0, 1], { mode: "normal", opacity: 1, compositing: "photoshop" }, 0, 0)).toBeCloseTo(0);
    expect(paintMask(0, [1, 1, 1, 1], { mode: "normal", opacity: 1, compositing: "photoshop" }, 0, 0)).toBeCloseTo(1);
    expect(paintMask(1, [0, 0, 0, 1], { mode: "normal", opacity: 0.25, compositing: "photoshop" }, 0, 0)).toBeCloseTo(0.75);
    // A transparent part of the gradient leaves the mask alone.
    expect(paintMask(0.6, [0, 0, 0, 0], { mode: "normal", opacity: 1, compositing: "photoshop" }, 0, 0)).toBeCloseTo(0.6);
    // Multiply on a mask darkens it by the grey.
    expect(paintMask(0.8, [0.5, 0.5, 0.5, 1], { mode: "multiply", opacity: 1, compositing: "photoshop" }, 0, 0)).toBeCloseTo(0.4);
  });
});

describe("the Gradient Fill generator", () => {
  it("is a generator in the catalogue, its presets across the canvas", () => {
    const def = effectDefinition(GRADIENT_FILL)!;
    expect(def.kind).toBe("generator");
    expect(GRADIENT_FILL_PRESETS.length).toBe(GRADIENT_PRESETS.length);
    expect(GRADIENT_FILL_PRESETS[0].params({ width: 400, height: 200 })).toMatchObject({ start: [0, 100], end: [400, 100] });
    expect(def.summary(validateParams(def, { style: "radial", start: [1, 2], end: [3, 4] }).params)).toBe("Radial Black, White, 1, 2 → 3, 4");
  });

  it("is added blending normally, across the canvas, with its parameters checked", () => {
    const doc = addGeneratorLayer(createPhotoProject("t", { width: 400, height: 200 }), { id: "g", type: GRADIENT_FILL, params: { style: "diamond", end: [300, 50], reverse: true, bogus: 1 } });
    const layer = findLayer(doc, "g") as GeneratorLayer;
    expect(layer.blend).toBeUndefined();
    expect(layer.blendSpace).toBeUndefined();
    const s = gradientFillShape(layer.effect.params);
    expect(s).toMatchObject({ style: "diamond", start: [0, 100], end: [300, 50], reverse: true, dither: true });
    expect(layer.effect.params).not.toHaveProperty("bogus");
  });

  it("validates a gradient's new methods and refuses a type it doesn't know", () => {
    const def = effectDefinition(GRADIENT_FILL)!;
    const { params, problems } = validateParams(def, { gradient: { ...BW, method: "stripes" }, style: "spiral" });
    expect((params.gradient as Gradient).method).toBe("stripes");
    expect(params.style).toBe("linear");
    expect(problems.length).toBe(1);
  });
});
