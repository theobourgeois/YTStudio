import { describe, expect, it } from "vitest";
import { outlinePath, selectionOutline, traceOutline } from "./selection-outline.ts";
import { maskOf } from "./selection.ts";

const grid = (rows: string[]) => ({ x: 0, y: 0, width: rows[0].length, height: rows.length, scale: 1, inside: (i: number, j: number) => rows[j][i] === "#" });

describe("marching ants", () => {
  it("trace a square as its four corners", () => {
    expect(traceOutline(grid(["....", ".##.", ".##.", "...."]))).toEqual([[1, 1, 3, 1, 3, 3, 1, 3]]);
  });

  it("trace a hole as a loop of its own", () => {
    const loops = traceOutline(grid(["###", "#.#", "###"]));
    expect(loops).toHaveLength(2);
    expect(loops.map((l) => l.length / 2).sort()).toEqual([4, 4]);
  });

  it("keep pixels that meet at a corner apart", () => {
    const loops = traceOutline(grid(["#.", ".#"]));
    expect(loops).toHaveLength(2);
  });

  it("follow half-covered pixels, at the document's place and scale", () => {
    const m = maskOf({ kind: "rect", x: 10.5, y: 4, width: 3, height: 2 })!;
    // Pixels covered by at least half are in (128 of 255).
    expect(selectionOutline(m)).toEqual([[10, 4, 14, 4, 14, 6, 10, 6]]);
    expect(traceOutline({ ...grid(["#"]), x: 5, y: 5, scale: 2 })).toEqual([[5, 5, 7, 5, 7, 7, 5, 7]]);
    expect(outlinePath([[0, 0, 1, 0, 1, 1]])).toBe("M0 0L1 0L1 1Z");
  });
});
