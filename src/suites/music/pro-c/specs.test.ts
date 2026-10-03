import { describe, expect, it } from "vitest";
import { slopeOf } from "@shared/music/pro-c-presets";
import { parseTyped, rounded, typedText } from "./specs";

describe("Pro-C's controls typed and kept", () => {
  it("reads times in ms (or s), ratios, percentages and Dry's off", () => {
    expect(parseTyped("attack", "10")).toBeCloseTo(0.01);
    expect(parseTyped("release", "1.5s")).toBeCloseTo(1.5);
    expect(parseTyped("release", "250 ms")).toBeCloseTo(0.25);
    expect(parseTyped("ratio", "4")).toBeCloseTo(0.75);
    expect(parseTyped("ratio", "4:1")).toBeCloseTo(0.75);
    expect(parseTyped("ratio", "∞")).toBe(1);
    expect(parseTyped("ratio", "0.5")).toBeNull();
    expect(parseTyped("mix", "150")).toBeCloseTo(1.5);
    expect(parseTyped("dry", "off")).toBe(-36);
    expect(parseTyped("threshold", "−24")).toBe(-24);
    expect(parseTyped("threshold", "x")).toBeNull();
  });
  it("says them back as they're typed", () => {
    expect(typedText("ratio", slopeOf(4))).toBe("4");
    expect(typedText("ratio", 1)).toBe("∞");
    expect(typedText("attack", 0.0123)).toBe("12.3");
    expect(typedText("dry", -36)).toBe("off");
    expect(typedText("threshold", -18)).toBe("-18.0");
  });
  it("rounds what the song keeps", () => {
    expect(rounded("threshold", -18.04)).toBe(-18);
    expect(rounded("attack", 0.0123456)).toBe(0.0123);
    expect(rounded("mix", 0.996)).toBe(1);
    expect(rounded("ratio", 0.7512)).toBe(0.7512);
  });
});
