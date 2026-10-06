import { describe, expect, it } from "vitest";
import { pixelCoverage, selectedArea } from "./selection.ts";
import { ellipseSelection, featherSelection, polygonSelection } from "./selection-shapes.ts";

const canvas = { width: 200, height: 150 };

describe("lasso and ellipse", () => {
  it("fills a polygon with its exact area, edges anti-aliased", () => {
    const triangle = polygonSelection([{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 10, y: 110 }], canvas)!;
    expect(selectedArea(triangle)).toBeCloseTo(5000, -1);
    expect(pixelCoverage(triangle, 20, 20)).toBe(1);
    expect(pixelCoverage(triangle, 100, 100)).toBe(0);
    // On the diagonal a pixel is about half in.
    expect(pixelCoverage(triangle, 59, 60)).toBeGreaterThan(0.2);
    expect(pixelCoverage(triangle, 59, 60)).toBeLessThan(0.8);
  });

  it("without anti-alias a pixel is in when its centre is", () => {
    const square = polygonSelection([{ x: 10.4, y: 10 }, { x: 20.6, y: 10 }, { x: 20.6, y: 20 }, { x: 10.4, y: 20 }], canvas, false)!;
    expect(pixelCoverage(square, 10, 15)).toBe(1);
    expect(pixelCoverage(square, 20, 15)).toBe(1);
    expect(pixelCoverage(square, 21, 15)).toBe(0);
    expect(new Set(square.data)).toEqual(new Set([255]));
  });

  it("keeps a loop drawn over itself selected (nonzero), and clips to the canvas", () => {
    // A square traced twice around: still the square.
    const twice = [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }, { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 }];
    expect(selectedArea(polygonSelection(twice, canvas)!)).toBeCloseTo(400, 0);
    const off = polygonSelection([{ x: -50, y: -50 }, { x: 50, y: -50 }, { x: 50, y: 50 }, { x: -50, y: 50 }], canvas)!;
    expect(off).toMatchObject({ x: 0, y: 0, width: 50, height: 50 });
    expect(polygonSelection([{ x: -50, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -10 }], canvas)).toBeNull();
  });

  it("an ellipse's area is π·a·b", () => {
    const e = ellipseSelection({ x: 20, y: 20 }, { x: 120, y: 80 }, canvas)!;
    expect(selectedArea(e) / (Math.PI * 50 * 30)).toBeCloseTo(1, 2);
  });

  it("feather softens the edge and keeps the amount selected", () => {
    const square = polygonSelection([{ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }], canvas)!;
    const soft = featherSelection(square, 5, canvas)!;
    expect(selectedArea(soft)).toBeCloseTo(2500, -1);
    expect(soft.x).toBeLessThan(50);
    expect(pixelCoverage(soft, 75, 75)).toBe(1);
    expect(pixelCoverage(soft, 49, 75)).toBeGreaterThan(0.2);
    expect(pixelCoverage(soft, 49, 75)).toBeLessThan(0.6);
  });
});
