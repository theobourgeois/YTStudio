import { describe, expect, it } from "vitest";
import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from "./color";

describe("colours", () => {
  it("reads hex as typed, short or long, with or without its #", () => {
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("d4247a")).toBe("#d4247a");
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
  });

  it("goes between hex, RGB and HSV and back", () => {
    expect(hexToRgb("#d4247a")).toEqual({ r: 212, g: 36, b: 122 });
    expect(rgbToHex({ r: 212, g: 36, b: 122 })).toBe("#d4247a");
    expect(rgbToHex({ r: 300, g: -4, b: 12.6 })).toBe("#ff000d");
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#0000ff").h).toBe(240);
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    for (const hex of ["#d4247a", "#120c5c", "#ffffff", "#808080", "#00ff7f", "#ffee00"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});
