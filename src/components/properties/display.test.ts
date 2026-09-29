import { describe, expect, it } from "vitest";
import { MOTION, OPACITY, type NumberSpec, type Vec2Spec, paramSpec } from "@shared/effects";
import { formatShown, fromDisplay, numberDisplay, parseShown, toDisplay } from "./display";

const ctx = { canvas: { width: 1080, height: 1920 }, media: { width: 4000, height: 3000 } };
const position = paramSpec(MOTION, "position") as Vec2Spec;
const anchor = paramSpec(MOTION, "anchor") as Vec2Spec;
const opacity = paramSpec(OPACITY, "opacity") as NumberSpec;
const rotation = paramSpec(MOTION, "rotation") as NumberSpec;

describe("display", () => {
  it("shows percentages and degrees", () => {
    expect(toDisplay(opacity, 0.5)).toBe(50);
    expect(fromDisplay(opacity, 25)).toBe(0.25);
    expect(toDisplay(rotation, 90)).toBe(90);
    expect(numberDisplay(opacity, ctx)).toEqual({ min: 0, max: 100, step: 1, decimals: 1, unit: "%" });
  });

  it("shows points in pixels of the canvas or the clip's media", () => {
    expect(toDisplay(position, [0.5, 0.5], ctx)).toEqual([540, 960]);
    expect(fromDisplay(position, [270, 1920], ctx)).toEqual([0.25, 1]);
    expect(toDisplay(anchor, [0.5, 0.5], ctx)).toEqual([2000, 1500]);
    expect(numberDisplay(position, ctx, 1)).toMatchObject({ min: -19200, max: 19200, unit: undefined });
  });

  it("formats and parses typed values", () => {
    expect(formatShown(-0.04, 1)).toBe("0.0");
    expect(formatShown(12.345, 1)).toBe("12.3");
    expect(parseShown(" 12,5 % ")).toBe(12.5);
    expect(parseShown("-3°")).toBe(-3);
    expect(parseShown("abc")).toBeNull();
    expect(parseShown("")).toBeNull();
  });
});
