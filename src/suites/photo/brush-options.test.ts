import { describe, expect, it } from "vitest";
import { brushSettings, sanitizeBrush, stepBrushSize, strokeColour } from "./brush-options";
import { sanitizeColours } from "./colours";

describe("brush options", () => {
  it("steps sizes as Photoshop's [ and ] do", () => {
    expect(stepBrushSize(5, 1)).toBe(6);
    expect(stepBrushSize(10, -1)).toBe(9);
    expect(stepBrushSize(60, 1)).toBe(70);
    expect(stepBrushSize(100, -1)).toBe(90);
    expect(stepBrushSize(150, 1)).toBe(175);
    expect(stepBrushSize(1, -1)).toBe(1);
    expect(stepBrushSize(5000, 1)).toBe(5000);
  });

  it("keeps settings in range, and paints a mask's grey and pixels' light", () => {
    expect(sanitizeBrush({ size: 0.2, hardness: 4, strength: -1 })).toEqual({ size: 1, hardness: 1, strength: 0 });
    expect(sanitizeColours({ foreground: "red", background: "#ABCDEF" })).toEqual({ foreground: "#000000", background: "#abcdef" });
    expect(brushSettings({ size: 40, hardness: 0.5, strength: 0.8 })).toEqual({ radius: 20, hardness: 0.5, strength: 0.8, spacing: 0.1 });
    expect(strokeColour("#ffffff", "mask")).toEqual([1, 1, 1, 1]);
    expect(strokeColour("#000000", "mask")).toEqual([0, 0, 0, 1]);
    expect(strokeColour("#808080", "mask")[0]).toBeCloseTo(128 / 255, 6);
    expect(strokeColour("#808080", "pixels")[0]).toBeCloseTo(0.2158605, 6);
  });
});
