import { describe, expect, it } from "vitest";
import { IDENTITY, layerMatrix } from "./layers.ts";
import { combineSelections, coverageIn, invertSelection, layerPixelCoverage, maskOf, modeFor, pixelCoverage, rectSelection, sameSelection, selectedArea, selectionCoverage, trimMask } from "./selection.ts";
import type { MaskSelection, RectSelection } from "./types.ts";

const canvas = { width: 100, height: 80 };
const rect = (x: number, y: number, width: number, height: number): RectSelection => ({ kind: "rect", x, y, width, height });

describe("mask selections", () => {
  it("trim to what's selected, and nothing is null", () => {
    const data = new Uint8Array(5 * 4);
    data[2 * 5 + 3] = 200;
    expect(trimMask(10, 20, 5, 4, data)).toMatchObject({ kind: "mask", x: 13, y: 22, width: 1, height: 1 });
    expect(trimMask(10, 20, 5, 4, new Uint8Array(20))).toBeNull();
  });

  it("a rectangle's mask keeps its fractional edges", () => {
    const m = maskOf(rect(10.5, 10, 4, 2))!;
    expect(m).toMatchObject({ x: 10, y: 10, width: 5, height: 2 });
    expect([...m.data.subarray(0, 5)]).toEqual([128, 255, 255, 255, 128]);
    expect(pixelCoverage(m, 10, 10)).toBeCloseTo(128 / 255);
    expect(pixelCoverage(m, 9, 10)).toBe(0);
  });

  it("combine: new, add, subtract and intersect, as Photoshop's", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 0, 10, 10);
    expect(combineSelections(a, b, "new")).toBe(b);
    const added = combineSelections(a, b, "add")!;
    expect(added).toMatchObject({ kind: "mask", x: 0, y: 0, width: 15, height: 10 });
    expect(selectedArea(added)).toBeCloseTo(150);
    const taken = combineSelections(a, b, "subtract")!;
    expect(taken).toMatchObject({ x: 0, width: 5 });
    expect(selectedArea(taken)).toBeCloseTo(50);
    // Two rectangles meet as a rectangle.
    expect(combineSelections(a, b, "intersect")).toEqual(rect(5, 0, 5, 10));
    // Nothing left is no selection.
    expect(combineSelections(a, a, "subtract")).toBeNull();
    expect(combineSelections(a, rect(50, 50, 5, 5), "intersect")).toBeNull();
    // With nothing selected, adding selects and the others leave nothing.
    expect(combineSelections(null, b, "add")).toBe(b);
    expect(combineSelections(null, b, "subtract")).toBeNull();
  });

  it("inverse covers what wasn't, over the canvas", () => {
    const inverse = invertSelection(rect(10, 10, 20, 20), canvas)!;
    expect(selectedArea(inverse)).toBeCloseTo(100 * 80 - 400);
    expect(pixelCoverage(inverse, 15, 15)).toBe(0);
    expect(pixelCoverage(inverse, 5, 5)).toBe(1);
    expect(invertSelection(rect(0, 0, 100, 80), canvas)).toBeNull();
    expect(sameSelection(invertSelection(inverse, canvas), maskOf(rect(10, 10, 20, 20)))).toBe(true);
  });

  it("covers layer pixels through any transform, and hands the GPU a region at once", () => {
    const m = maskOf(rect(0, 0, 50, 80))! as MaskSelection;
    const half = layerMatrix({ x: 50, y: 40, scaleX: 1, scaleY: 1, rotation: 0 }, canvas);
    expect(layerPixelCoverage(m, half, 49, 10)).toBe(1);
    expect(layerPixelCoverage(m, half, 50, 10)).toBe(0);
    // Twice the size: a layer pixel is 2 × 2 document pixels.
    const twice = layerMatrix({ x: 50, y: 40, scaleX: 2, scaleY: 2, rotation: 0 }, { width: 50, height: 40 });
    expect(layerPixelCoverage(m, twice, 24, 5)).toBe(1);
    expect(layerPixelCoverage(m, twice, 25, 5)).toBe(0);
    expect(selectionCoverage(m, IDENTITY, 60, 0, 16, 16)).toBe(0);
    expect(selectionCoverage(m, IDENTITY, 0, 0, 16, 16)).toBe(1);
    const edge = selectionCoverage(m, IDENTITY, 40, 0, 16, 16) as Float32Array;
    expect(edge[9]).toBe(1);
    expect(edge[10]).toBe(0);
  });

  it("reads coverage over any box, and modifier keys pick the mode", () => {
    const s = rectSelection({ x: 2, y: 2 }, { x: 4, y: 4 }, canvas)!;
    expect([...coverageIn(s, { x: 1, y: 2, width: 4, height: 1 })]).toEqual([0, 255, 255, 0]);
    expect(modeFor({ shiftKey: true, altKey: false }, "new")).toBe("add");
    expect(modeFor({ shiftKey: false, altKey: true }, "new")).toBe("subtract");
    expect(modeFor({ shiftKey: true, altKey: true }, "new")).toBe("intersect");
    expect(modeFor({ shiftKey: false, altKey: false }, "add")).toBe("add");
  });
});
