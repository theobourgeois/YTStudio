import { describe, expect, it } from "vitest";
import { objectBox, objectProbabilities, paintedGrid } from "./object-select.ts";

/** A `side × side` answer with two discs the model found (1 inside, a soft rim of 0.3 just outside). */
function answer(side: number, discs: { x: number; y: number; r: number }[]): Float32Array {
  const out = new Float32Array(side * side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      for (const d of discs) {
        const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y);
        if (dist < d.r) out[y * side + x] = 1;
        else if (dist < d.r + 1) out[y * side + x] = Math.max(out[y * side + x], 0.3);
      }
    }
  }
  return out;
}

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0);

describe("Object Selection", () => {
  it("looks at the strokes' bounds and a quarter of their longer side past them, within the canvas", () => {
    // A stroke from (100, 100) to (300, 100), 40 px across: 80..320 × 80..120, grown by 60.
    expect(objectBox([[{ x: 100, y: 100 }, { x: 300, y: 100 }]], 40, { width: 1000, height: 1000 })).toEqual({ x: 20, y: 20, width: 360, height: 160 });
    expect(objectBox([[{ x: 10, y: 10 }]], 40, { width: 1000, height: 1000 })).toEqual({ x: 0, y: 0, width: 40, height: 40 });
    expect(objectBox([[{ x: -500, y: -500 }]], 40, { width: 1000, height: 1000 })).toBeNull();
    expect(objectBox([], 40, { width: 1000, height: 1000 })).toBeNull();
  });

  it("paints the strokes on the model's grid, squeezed with the box", () => {
    // A box 200 × 100 document pixels at (100, 100) of a half-size sample: 100 × 50 sample pixels at (50, 50).
    const grid = paintedGrid([[{ x: 200, y: 150 }]], 20, 0.5, { x: 50, y: 50, width: 100, height: 50 }, 64);
    // The dab's centre is the grid's; it's 10 / 200 of the grid wide and 10 / 100 of it high, each way.
    expect(grid[32 * 64 + 32]).toBe(1);
    expect(grid[32 * 64 + 34]).toBe(1);
    expect(grid[32 * 64 + 37]).toBe(0);
    expect(grid[37 * 64 + 32]).toBe(1);
    expect(grid[40 * 64 + 32]).toBe(0);
    // An ellipse: about π × 3.2 × 6.4 cells.
    expect(Math.abs(sum(grid) - Math.PI * 3.2 * 6.4)).toBeLessThan(12);
  });

  it("keeps what the strokes cover, with its soft rim, and drops what they only brushed past", () => {
    const side = 100;
    const probs = answer(side, [{ x: 30, y: 50, r: 20 }, { x: 75, y: 50, r: 15 }]);
    // Painted over most of the first disc, the brush spilling a little onto the second.
    const painted = paintedGrid([[{ x: 20, y: 50 }, { x: 40, y: 50 }, { x: 61, y: 50 }]], 20, 1, { x: 0, y: 0, width: side, height: side }, side);
    const kept = objectProbabilities(probs, side, painted)!;
    expect(kept[50 * side + 30]).toBe(1);
    // The first disc's rim stays soft; the second disc is gone, rim and all.
    expect(kept[50 * side + 9]).toBeCloseTo(0.3);
    expect(kept[50 * side + 75]).toBe(0);
    expect(kept[50 * side + 60]).toBe(0);
    const area = sum(kept.map((v) => (v >= 0.5 ? 1 : 0)));
    expect(Math.abs(area - Math.PI * 400)).toBeLessThan(60);
  });

  it("keeps several things when each is painted over, and nothing when nothing found was touched", () => {
    const side = 100;
    const probs = answer(side, [{ x: 30, y: 50, r: 20 }, { x: 75, y: 50, r: 15 }]);
    const both = paintedGrid([[{ x: 25, y: 50 }, { x: 80, y: 50 }]], 10, 1, { x: 0, y: 0, width: side, height: side }, side);
    const kept = objectProbabilities(probs, side, both)!;
    expect(kept[50 * side + 30]).toBe(1);
    expect(kept[50 * side + 75]).toBe(1);
    const corner = paintedGrid([[{ x: 5, y: 5 }]], 6, 1, { x: 0, y: 0, width: side, height: side }, side);
    expect(objectProbabilities(probs, side, corner)).toBeNull();
  });
});
