import { describe, expect, it } from "vitest";
import { DEFAULT_VELOCITY } from "@shared/music/project";
import { MUTED, NOTE, SELECTED, VELOCITY_LEVELS, contrast, luminance, mix, velocityColours } from "./note-colours";

describe("velocityColours", () => {
  it("mixes hex colours, and leaves anything else alone", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#fff", "#000", 0)).toBe("#ffffff");
    expect(mix("rgb(0, 0, 0)", "#ffffff", 0.5)).toBe("rgb(0, 0, 0)");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("draws a note at the default velocity or louder in its own colours, and darker the quieter it is", () => {
    expect(velocityColours(NOTE, 1)).toBe(NOTE);
    expect(velocityColours(NOTE, DEFAULT_VELOCITY)).toBe(NOTE);
    expect(velocityColours(SELECTED, 1)).toBe(SELECTED);
    for (const colours of [NOTE, SELECTED]) {
      let last = luminance(colours.bottom);
      for (let level = VELOCITY_LEVELS - 1; level >= 0; level--) {
        const shaded = velocityColours(colours, (level / VELOCITY_LEVELS) * DEFAULT_VELOCITY);
        expect(luminance(shaded.bottom)).toBeLessThan(last);
        last = luminance(shaded.bottom);
      }
      // Silent is clearly darker: under half as bright.
      expect(luminance(velocityColours(colours, 0).bottom)).toBeLessThan(luminance(colours.bottom) / 2);
    }
  });

  it("keeps every note's name readable on it, at any velocity", () => {
    for (const colours of [NOTE, SELECTED]) {
      for (let level = 0; level <= VELOCITY_LEVELS; level++) {
        const shaded = velocityColours(colours, (level / VELOCITY_LEVELS) * DEFAULT_VELOCITY);
        expect(contrast(shaded.text, mix(shaded.top, shaded.bottom, 0.5))).toBeGreaterThan(4);
      }
    }
  });

  it("works each shade out once, and keeps a selected note red", () => {
    expect(velocityColours(NOTE, 0.3)).toBe(velocityColours(NOTE, 0.3));
    const red = velocityColours(SELECTED, 0.2).bottom;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g * 1.4);
    expect(r).toBeGreaterThan(b * 1.4);
    expect(velocityColours(MUTED, 1)).toBe(MUTED);
  });
});
