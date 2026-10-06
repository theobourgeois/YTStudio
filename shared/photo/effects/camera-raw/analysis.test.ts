import { describe, expect, it } from "vitest";
import { srgbToLinear } from "../../colour.ts";
import { rand } from "../../reference/kernel.ts";
import { defaultParams } from "../params.ts";
import { GRID_FLOATS, analyse, analysisSpacing, gridAt } from "./analysis.ts";
import { ANALYSIS_PARAM, developPixel, developSettings, developTable } from "./develop.ts";
import { CAMERA_RAW_PARAMS } from "./params.ts";

/** A picture of `width` × `height` from a function of the pixel giving 8-bit codes, as premultiplied linear floats. */
function picture(width: number, height: number, code: (x: number, y: number) => [number, number, number]) {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = code(x, y);
      data.set([srgbToLinear(c[0] / 255), srgbToLinear(c[1] / 255), srgbToLinear(c[2] / 255), 1], (y * width + x) * 4);
    }
  return { width, height, data };
}

/** The picture developed with these settings (analysed at full resolution), as linear floats per pixel. */
function develop(img: ReturnType<typeof picture>, settings: Record<string, unknown>) {
  const canvas = { width: img.width, height: img.height };
  const analysis = analyse(img, canvas, 1, "test");
  const p = { ...defaultParams(CAMERA_RAW_PARAMS), ...settings, [ANALYSIS_PARAM]: analysis } as unknown as Record<string, never>;
  const table = developTable(p);
  const s = developSettings(p, canvas);
  return {
    analysis,
    at: (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return developPixel([img.data[i], img.data[i + 1], img.data[i + 2]], x + 0.5, y + 0.5, table, s, rand);
    },
  };
}

const luminance = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const stops = (after: readonly number[], before: readonly number[]) => Math.log2(luminance(after) / luminance(before));

describe("Camera Raw's analysis", () => {
  it("puts a canvas's long side within 256 cells, in powers of two", () => {
    expect(analysisSpacing({ width: 200, height: 100 })).toBe(1);
    expect(analysisSpacing({ width: 6000, height: 4000 })).toBe(32);
    expect(analysisSpacing({ width: 1080, height: 1920 })).toBe(8);
  });

  it("leaves a flat picture alone: it has no range for Highlights and Shadows, no detail, no haze over it", () => {
    const flat = picture(64, 48, () => [150, 150, 150]);
    const { analysis, at } = develop(flat, { highlights: -100, shadows: 100, clarity: 100, texture: 100 });
    expect(analysis.high - analysis.low).toBeLessThan(1e-6);
    const before = [flat.data[0], flat.data[1], flat.data[2]];
    at(10, 10).forEach((v, i) => expect(v).toBeCloseTo(before[i], 6));
  });

  it("moves a step edge's bright side with Highlights and its dark side with Shadows, each evenly, with no halo", () => {
    const edge = picture(256, 128, (x) => (x < 128 ? [50, 50, 50] : [190, 190, 190]));
    const dark = [edge.data[0], edge.data[1], edge.data[2]];
    const bright = [edge.data[255 * 4], edge.data[255 * 4 + 1], edge.data[255 * 4 + 2]];
    const down = develop(edge, { highlights: -100 });
    // The bright side comes down the same everywhere, right up to the edge; the dark side doesn't move, even beside it.
    const far = stops(down.at(250, 64), bright);
    expect(far).toBeLessThan(-0.15);
    expect(Math.abs(stops(down.at(129, 64), bright) - far)).toBeLessThan(0.05);
    expect(Math.abs(stops(down.at(126, 64), dark))).toBeLessThan(0.05);
    const up = develop(edge, { shadows: 100 });
    const lifted = stops(up.at(5, 64), dark);
    expect(lifted).toBeGreaterThan(0.5);
    expect(Math.abs(stops(up.at(126, 64), dark) - lifted)).toBeLessThan(0.05);
    expect(Math.abs(stops(up.at(130, 64), bright))).toBeLessThan(0.05);
    // Clarity keeps a large edge's shape: no overshoot past a few percent beside it.
    const clear = develop(edge, { clarity: 100 });
    expect(Math.abs(stops(clear.at(120, 64), dark))).toBeLessThan(0.1);
    expect(Math.abs(stops(clear.at(136, 64), bright))).toBeLessThan(0.1);
  });

  it("brings out (or smooths) detail with Clarity and Texture, by its size", () => {
    // A grating of period 24 px (±20 levels) on 512 px: Clarity's scale; a period of 4: Texture's.
    const amplitude = (period: number, settings: Record<string, unknown>) => {
      const img = picture(512, 64, (x) => {
        const v = 128 + 20 * Math.sin((2 * Math.PI * x) / period);
        return [v, v, v];
      });
      const { at } = develop(img, settings);
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = 200; x < 300; x++) {
        const l = Math.log2(luminance(at(x, 32)));
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
      return hi - lo;
    };
    const plainWide = amplitude(24, {});
    expect(amplitude(24, { clarity: 100 }) / plainWide).toBeGreaterThan(1.8);
    expect(amplitude(24, { clarity: -100 }) / plainWide).toBeLessThan(0.75);
    const plainFine = amplitude(4, {});
    expect(amplitude(4, { texture: 100 }) / plainFine).toBeGreaterThan(1.3);
    expect(amplitude(4, { texture: -100 }) / plainFine).toBeLessThan(0.75);
  });

  it("takes haze out with Dehaze, and puts it in", () => {
    // A hazy scene: a pale sky over a washed-out dark field.
    const hazy = picture(128, 128, (x, y) => (y < 64 ? [205, 210, 220] : [140 + (x % 8), 145, 150]));
    const below = [hazy.data[(100 * 128 + 4) * 4], hazy.data[(100 * 128 + 4) * 4 + 1], hazy.data[(100 * 128 + 4) * 4 + 2]];
    expect(stops(develop(hazy, { dehaze: 100 }).at(4, 100), below)).toBeLessThan(-0.5);
    expect(stops(develop(hazy, { dehaze: -100 }).at(4, 100), below)).toBeGreaterThan(0.1);
  });

  it("pivots Contrast around the picture's own mean tone, as Camera Raw does", () => {
    // The same middle grey under Contrast +100: brightened in a dark picture, darkened in a bright one.
    const mid = (background: number) => {
      const img = picture(64, 64, (x, y) => (x > 24 && x < 40 && y > 24 && y < 40 ? [118, 118, 118] : [background, background, background]));
      return develop(img, { contrast: 100 }).at(32, 32)[0];
    };
    expect(mid(25)).toBeGreaterThan(mid(230));
  });

  it("reads its grid between cell centres, held at the edges", () => {
    const img = picture(4, 2, (x) => [x * 60, x * 60, x * 60]);
    const an = analyse(img, { width: 8, height: 4 }, 2, "grid");
    const first = gridAt(an, 0, 0);
    const centre = gridAt(an, 1, 1);
    first.forEach((v, k) => expect(v).toBeCloseTo(centre[k], 6));
    const between = gridAt(an, 2, 1);
    expect(between[1]).toBeCloseTo((an.grid[1] + an.grid[GRID_FLOATS + 1]) / 2, 5);
  });
});
