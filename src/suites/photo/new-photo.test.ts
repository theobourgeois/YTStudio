import { describe, expect, it } from "vitest";
import { parseSide, presetOf, ratioOf, shapeBox } from "./new-photo";

describe("the New photo window", () => {
  it("names the preset of a size, and none for a custom one", () => {
    expect(presetOf(1080, 1920)?.id).toBe("story");
    expect(presetOf(1000, 1000)?.id).toBe("square-1000");
    expect(presetOf(1920, 1080)?.id).toBe("hd");
    expect(presetOf(1080, 1081)).toBeUndefined();
  });

  it("takes whole sides the canvas can have", () => {
    expect(parseSide("1000")).toBe(1000);
    expect(parseSide(" 720 ")).toBe(720);
    expect(parseSide("")).toBeNull();
    expect(parseSide("0")).toBeNull();
    expect(parseSide("12.5")).toBeNull();
    expect(parseSide("-4")).toBeNull();
    expect(parseSide("30001")).toBeNull();
    expect(parseSide("30000")).toBe(30000);
  });

  it("draws the shape in a square, its long side the square's", () => {
    expect(shapeBox(1080, 1920, 64)).toEqual({ width: 36, height: 64 });
    expect(shapeBox(1920, 1080, 64)).toEqual({ width: 64, height: 36 });
    expect(shapeBox(1000, 1000, 64)).toEqual({ width: 64, height: 64 });
    // A sliver still shows.
    expect(shapeBox(30000, 1, 64)).toEqual({ width: 64, height: 4 });
  });

  it("says ratios as people do", () => {
    expect(ratioOf(1080, 1920)).toBe("9:16");
    expect(ratioOf(1080, 1350)).toBe("4:5");
    expect(ratioOf(1280, 720)).toBe("16:9");
    expect(ratioOf(1000, 1000)).toBe("1:1");
    expect(ratioOf(1001, 1000)).toBeNull();
  });
});
