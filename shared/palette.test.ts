import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, PALETTE_ROLES, oklchHex, paletteFromPixels, rgbToOklab } from "./palette.ts";

/** A 48 × 48 picture, each pixel's colour from where it is. */
function picture(colour: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(48 * 48 * 4);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      const [r, g, b] = colour(x, y);
      out.set([r, g, b, 255], (y * 48 + x) * 4);
    }
  }
  return out;
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lab = (h: string) => rgbToOklab(...hex(h));
const hueOf = (h: string) => {
  const [, a, b] = lab(h);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};
const chromaOf = (h: string) => Math.hypot(lab(h)[1], lab(h)[2]);
const near = (a: number, b: number, within: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d) <= within;
};

describe("paletteFromPixels", () => {
  it("gives a two-colour cover's colours their roles, vivid, on a deep background", () => {
    const palette = paletteFromPixels(picture((x) => (x < 30 ? [200, 30, 40] : [30, 60, 200])));
    // The bigger red is the primary, the blue the secondary.
    expect(near(hueOf(palette.primary), hueOf("#c81e28"), 15)).toBe(true);
    expect(near(hueOf(palette.secondary), hueOf("#1e3cc8"), 15)).toBe(true);
    expect(lab(palette.background)[0]).toBeLessThan(0.2);
    expect(lab(palette.light)[0]).toBeGreaterThan(0.9);
    expect(palette.mono).toBe(false);
    for (const role of PALETTE_ROLES) expect(palette[role]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("finds a small bright colour on a dull cover, and makes it glow", () => {
    const palette = paletteFromPixels(picture((x, y) => (x > 18 && x < 30 && y > 18 && y < 30 ? [255, 140, 0] : [24, 22, 20])));
    expect(near(hueOf(palette.primary), hueOf("#ff8c00"), 15)).toBe(true);
    expect(lab(palette.primary)[0]).toBeGreaterThan(0.6);
  });

  it("lifts a muted colour so it can glow", () => {
    const palette = paletteFromPixels(picture(() => [110, 90, 70]));
    expect(chromaOf(palette.primary)).toBeGreaterThan(0.1);
    expect(lab(palette.primary)[0]).toBeGreaterThan(0.6);
  });

  it("keeps a black-and-white cover grey, with a cool accent", () => {
    const palette = paletteFromPixels(picture((x, y) => ((x + y) % 2 ? [240, 240, 240] : [12, 12, 12])));
    expect(palette.mono).toBe(true);
    expect(chromaOf(palette.primary)).toBeLessThan(0.01);
    expect(chromaOf(palette.accent)).toBeGreaterThan(0.05);
  });

  it("gives the same palette for the same cover, and the default for none", () => {
    const cover = picture((x, y) => [x * 5, y * 5, 128]);
    expect(paletteFromPixels(cover)).toEqual(paletteFromPixels(cover));
    expect(paletteFromPixels(new Uint8ClampedArray(0))).toEqual(DEFAULT_PALETTE);
  });
});

describe("oklchHex", () => {
  it("fits colours outside sRGB by lowering their chroma, keeping their hue", () => {
    const h = oklchHex(0.7, 0.5, (140 * Math.PI) / 180);
    expect(h).toMatch(/^#[0-9a-f]{6}$/);
    expect(near(hueOf(h), 140, 8)).toBe(true);
  });
});
