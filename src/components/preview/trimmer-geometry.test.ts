import { describe, expect, it } from "vitest";
import { percentAt, stripTiles } from "./trimmer-geometry.ts";

describe("trimmer geometry", () => {
  it("lays filmstrip frames across the strip, each showing the frame at its middle", () => {
    expect(stripTiles(100, 40, 10)).toEqual([
      { x: 0, width: 40, frame: 2 },
      { x: 40, width: 40, frame: 6 },
      { x: 80, width: 20, frame: 9 },
    ]);
    expect(stripTiles(0, 40, 10)).toEqual([]);
    expect(stripTiles(100, 40, 0)).toEqual([]);
  });

  it("places times as percentages, held inside the strip", () => {
    expect(percentAt(2, 8)).toBe("25%");
    expect(percentAt(-1, 8)).toBe("0%");
    expect(percentAt(9, 8)).toBe("100%");
    expect(percentAt(1, 0)).toBe("0%");
  });
});
