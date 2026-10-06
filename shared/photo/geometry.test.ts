import { describe, expect, it } from "vitest";
import { DabSpacer, dabCoverage, strokeDabs, tilesUnder } from "./brush.ts";
import { docToView, fitView, levelCount, levelForScale, levelSize, mitchell, panBy, tileGrid, viewToDoc, visibleTiles, zoomAbout } from "./geometry.ts";
import { fromHalf, toHalf } from "./half.ts";

describe("tiles and levels", () => {
  it("covers an image with whole tiles", () => {
    expect(tileGrid({ width: 8000, height: 6000 }, 256)).toEqual({ tilesX: 32, tilesY: 24 });
    expect(tileGrid({ width: 8000, height: 6000 }, 512)).toEqual({ tilesX: 16, tilesY: 12 });
    expect(tileGrid({ width: 1, height: 1 }, 256)).toEqual({ tilesX: 1, tilesY: 1 });
  });

  it("halves each level, rounding up, down to one tile", () => {
    expect(levelSize({ width: 8000, height: 6001 }, 1)).toEqual({ width: 4000, height: 3001 });
    expect(levelSize({ width: 7, height: 3 }, 2)).toEqual({ width: 2, height: 1 });
    expect(levelCount({ width: 8000, height: 6000 }, 256)).toBe(6); // 8000 → 250 at level 5
    expect(levelCount({ width: 256, height: 100 }, 256)).toBe(1);
    expect(levelCount({ width: 257, height: 100 }, 256)).toBe(2);
  });

  it("samples the smallest level with at least the view's resolution", () => {
    expect(levelForScale(2, 6)).toBe(0);
    expect(levelForScale(1, 6)).toBe(0);
    expect(levelForScale(0.6, 6)).toBe(0);
    expect(levelForScale(0.5, 6)).toBe(1);
    expect(levelForScale(0.3, 6)).toBe(1);
    expect(levelForScale(0.25, 6)).toBe(2);
    expect(levelForScale(0.001, 6)).toBe(5);
  });
});

describe("the view", () => {
  it("maps device pixels to document pixels and back", () => {
    const view = { zoom: 2, x: 100, y: 50, width: 800, height: 600 };
    expect(viewToDoc(view, 0, 0)).toEqual({ x: 100, y: 50 });
    expect(viewToDoc(view, 200, 100)).toEqual({ x: 200, y: 100 });
    expect(docToView(view, 200, 100)).toEqual({ x: 200, y: 100 });
  });

  it("fits a document in the middle", () => {
    const view = fitView({ width: 8000, height: 6000 }, 1048, 848, 24);
    expect(view.zoom).toBeCloseTo(0.125);
    expect(viewToDoc(view, 524, 424).x).toBeCloseTo(4000);
    expect(viewToDoc(view, 524, 424).y).toBeCloseTo(3000);
  });

  it("zooms about the pointer and pans with it", () => {
    const view = { zoom: 1, x: 0, y: 0, width: 800, height: 600 };
    const zoomed = zoomAbout(view, 300, 200, 4);
    expect(viewToDoc(zoomed, 300, 200).x).toBeCloseTo(300);
    expect(viewToDoc(zoomed, 300, 200).y).toBeCloseTo(200);
    expect(viewToDoc(panBy(zoomed, 40, 0), 340, 200).x).toBeCloseTo(300);
  });

  it("lists the tiles in view at a level", () => {
    const view = { zoom: 1, x: 300, y: 0, width: 300, height: 100 };
    expect(visibleTiles(view, { width: 2000, height: 1000 }, 0, 256).map((t) => `${t.tx},${t.ty}`)).toEqual(["1,0", "2,0"]);
    expect(visibleTiles(view, { width: 2000, height: 1000 }, 1, 256).map((t) => `${t.tx},${t.ty}`)).toEqual(["0,0", "1,0"]);
  });
});

describe("resampling kernel", () => {
  it("is Mitchell–Netravali's, summing to 1 at any phase", () => {
    expect(mitchell(0)).toBeCloseTo(8 / 9);
    expect(mitchell(1)).toBeCloseTo(1 / 18);
    expect(mitchell(2)).toBe(0);
    for (const phase of [0, 0.1, 0.25, 0.5, 0.9]) {
      const sum = [-2, -1, 0, 1, 2].reduce((s, i) => s + mitchell(i - phase), 0);
      expect(sum).toBeCloseTo(1, 12);
    }
  });
});

describe("half floats", () => {
  it("round-trips every half", () => {
    for (let bits = 0; bits < 0x10000; bits++) {
      const v = fromHalf(bits);
      if (Number.isNaN(v)) continue;
      expect(toHalf(v)).toBe(bits === 0x8000 ? 0x8000 : bits);
    }
  });

  it("rounds to nearest, ties to even, and saturates to infinity", () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(65520)).toBe(0x7c00);
    expect(fromHalf(toHalf(1 + 2 ** -11))).toBe(1); // a tie, to even
    expect(fromHalf(toHalf(1 + 3 * 2 ** -11))).toBe(1 + 2 ** -9);
    expect(fromHalf(toHalf(2 ** -24))).toBe(2 ** -24);
    expect(toHalf(-2)).toBe(0xc000);
  });
});

describe("brush", () => {
  const brush = { radius: 10, hardness: 0.5, strength: 1, spacing: 0.25 };

  it("spaces dabs evenly along the path, whatever the samples", () => {
    const dabs = strokeDabs(brush, [{ x: 0, y: 0 }, { x: 13, y: 0 }, { x: 50, y: 0 }]);
    expect(dabs.map((d) => d.x)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    const many = strokeDabs(brush, Array.from({ length: 51 }, (_, x) => ({ x, y: 0 })));
    expect(many.map((d) => d.x)).toEqual(dabs.map((d) => d.x));
  });

  it("carries the spacing round corners", () => {
    const spacer = new DabSpacer(brush);
    spacer.add(0, 0);
    expect(spacer.add(3, 0)).toEqual([]);
    expect(spacer.add(3, 4).map((d) => [d.x, d.y])).toEqual([[3, 2]]);
  });

  it("knows which tiles a dab touches", () => {
    const tiles = tilesUnder([{ x: 255, y: 2, radius: 4, hardness: 1, strength: 1 }], 256);
    expect([...tiles.keys()].sort()).toEqual(["0,-1", "0,0", "1,-1", "1,0"]);
  });

  it("falls off smoothly from the hard core to the edge", () => {
    expect(dabCoverage(brush, 0)).toBe(1);
    expect(dabCoverage(brush, 5)).toBe(1);
    expect(dabCoverage(brush, 7.5)).toBeCloseTo(0.5);
    expect(dabCoverage(brush, 10)).toBe(0);
  });
});
