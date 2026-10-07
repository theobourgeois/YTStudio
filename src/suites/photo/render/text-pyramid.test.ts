import { describe, expect, it } from "vitest";
import { coveragePyramid, coverageTile } from "./text-pyramid";

describe("a canvas raster's coverage", () => {
  it("reduces each level by the mean of what's below that exists, as the reduce kernel does", () => {
    // 3 × 1: 255, 0, 255 → level 1 is 2 × 1: (1 + 0) / 2, then the lone edge pixel 1.
    const levels = coveragePyramid([255, 0, 255], 3, 1, 2);
    expect(Array.from(levels[0].data)).toEqual([1, 0, 1]);
    expect(levels[1]).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(levels[1].data)).toEqual([0.5, 1]);
  });

  it("makes a tile premultiplied in the colour, or none where nothing is covered", () => {
    const [level] = coveragePyramid([0, 0, 0, 128], 2, 2, 1);
    const tile = coverageTile(level, 0, 0, 4, [1, 0.5, 0.25])!;
    const a = 128 / 255;
    expect(Array.from(tile.slice((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4))).toEqual([a, 0.5 * a, 0.25 * a, a].map((v) => Math.fround(v)));
    expect(tile[3]).toBe(0);
    // Past the level's pixels the tile is transparent; a tile with nothing covered is none.
    expect(coverageTile(level, 1, 0, 4, [1, 1, 1])).toBeNull();
    expect(coverageTile(coveragePyramid([0, 0], 2, 1, 1)[0], 0, 0, 4, [1, 1, 1])).toBeNull();
  });
});
