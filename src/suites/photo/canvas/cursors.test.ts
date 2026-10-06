import { describe, expect, it } from "vitest";
import { resizeCursor, rotateCursor } from "./cursors";

const turn = (cursor: string) => Number(decodeURIComponent(cursor).match(/rotate\((-?[\d.]+) 12 12\)/)?.[1]);

describe("the Move tool's pointers", () => {
  it("pull along the nearest of the four directions", () => {
    expect(resizeCursor(0)).toBe("ew-resize");
    expect(resizeCursor(45)).toBe("nwse-resize");
    expect(resizeCursor(-135)).toBe("nwse-resize");
    expect(resizeCursor(-45)).toBe("nesw-resize");
    expect(resizeCursor(90)).toBe("ns-resize");
  });

  it("rotate bowed around the corner they're outside, to the nearest 15°", () => {
    expect(turn(rotateCursor(-45))).toBe(315);
    expect(turn(rotateCursor(45))).toBe(45);
    expect(turn(rotateCursor(135))).toBe(135);
    expect(turn(rotateCursor(-135))).toBe(225);
    expect(turn(rotateCursor(52))).toBe(45);
    expect(turn(rotateCursor(360))).toBe(0);
    expect(rotateCursor(44)).toBe(rotateCursor(45));
    expect(rotateCursor(45)).toMatch(/^url\("data:image\/svg\+xml,.*"\) 12 12, grab$/);
  });
});
