import { describe, expect, it } from "vitest";
import { fromHalf, toHalf } from "./half.ts";
import { composeShiftedTile, planShift, shiftedManifest } from "./surface-shift.ts";
import type { SurfaceManifest } from "./surfaces.ts";

const T = 256;
const A = "a".repeat(64);
const B = "b".repeat(64);

/** A mask whose tile (0, 0) is stored (A), (1, 0) is a constant 0.5, the rest the fill (1). */
const mask: SurfaceManifest = { v: 1, format: "r16f", tile: T, fill: [1], tiles: [[0, 0, A], [1, 0, "c:0.5"], [3, 3, B]] };

/** Tile A's samples: each texel's value is its x / 1024 (exact in halves). */
const tileA = new Uint16Array(T * T).map((_, i) => toHalf((i % T) / 1024));

describe("moving a surface by whole pixels", () => {
  it("renumbers tiles for whole-tile moves, dropping those past the grid", () => {
    expect(planShift(mask, -T, -T, { width: 4 * T, height: 4 * T })).toEqual({ manifest: { ...mask, tiles: [[2, 2, B]] } });
    expect(planShift(mask, T, 0, { width: 4 * T, height: 4 * T })).toEqual({ manifest: { ...mask, tiles: [[1, 0, A], [2, 0, "c:0.5"]] } });
  });

  it("makes each new tile from the old ones under it, exactly", () => {
    const plan = planShift(mask, -100, 0, { width: 4 * T, height: 4 * T });
    if (!("tiles" in plan)) throw new Error("expected tiles");
    // New tile (0, 0): old tile 0 from x 100, then old tile 1's constant.
    const t0 = plan.tiles.find((t) => t.tx === 0 && t.ty === 0)!;
    expect(t0.sources.map((s) => [s.tx, s.ox, s.ref])).toEqual([
      [0, -100, A],
      [1, 156, "c:0.5"],
    ]);
    const out = composeShiftedTile(mask, t0, () => tileA);
    expect(fromHalf(out[0])).toBe(100 / 1024);
    expect(fromHalf(out[155])).toBe(255 / 1024);
    expect(fromHalf(out[156])).toBe(0.5);
    expect(fromHalf(out[T * 7 + 255])).toBe(0.5);
    // New tile (1, 0): the constant, then the fill.
    const t1 = plan.tiles.find((t) => t.tx === 1 && t.ty === 0)!;
    const out1 = composeShiftedTile(mask, t1, () => tileA);
    expect(fromHalf(out1[155])).toBe(0.5);
    expect(fromHalf(out1[156])).toBe(1);
    // Tile (3, 3) moved left reaches new tiles (2, 3) and (3, 3); nothing else is made.
    expect(plan.tiles.map((t) => `${t.tx},${t.ty}`).sort()).toEqual(["0,0", "1,0", "2,3", "3,3"]);
    const manifest = shiftedManifest(mask, plan.tiles, ["h0", "c:0.5", "c:1", "h3"]);
    expect(manifest.tiles).toEqual([[0, 0, "h0"], [1, 0, "c:0.5"], [3, 3, "h3"]]);
  });

  it("brings the fill in where nothing was", () => {
    const plan = planShift(mask, 10, 10, { width: T, height: T });
    if (!("tiles" in plan)) throw new Error("expected tiles");
    const out = composeShiftedTile(mask, plan.tiles[0], () => tileA);
    expect(fromHalf(out[0])).toBe(1);
    expect(fromHalf(out[10 * T + 10])).toBe(0);
    expect(fromHalf(out[10 * T + 20])).toBe(10 / 1024);
  });
});
