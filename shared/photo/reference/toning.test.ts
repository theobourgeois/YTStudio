import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { dabCoverage, strokeDabs } from "../brush.ts";
import { type Rgba, TONE_SPACING, type ToneEffect, type ToneRange, dabRate, luminance, strokeLaw, toneCurve, toneMask, tonePixel } from "./toning.ts";

const RANGES: ToneRange[] = ["shadows", "midtones", "highlights"];
const grey = (encoded: number, alpha = 1): Rgba => {
  const l = srgbToLinear(encoded) * alpha;
  return [l, l, l, alpha];
};
const encodedOf = (p: Rgba) => [0, 1, 2].map((i) => linearToSrgb(p[i] / p[3]));
const hue = (p: Rgba) => {
  const [r, g, b] = [p[0], p[1], p[2]];
  const s = r + g + b;
  return [r / s, g / s, b / s];
};

describe("toneCurve", () => {
  it("is the identity at no amount", () => {
    for (const tool of ["dodge", "burn"] as const) for (const range of RANGES) for (const x of [0, 0.3, 1]) expect(toneCurve(tool, range, true, x, 0)).toBe(x);
  });

  it("is monotonic, and dodge lightens while burn darkens", () => {
    for (const tool of ["dodge", "burn"] as const) {
      for (const range of RANGES) {
        for (const protect of [false, true]) {
          for (const a of [0.2, 0.5, 1]) {
            let last = -Infinity;
            for (let i = 0; i <= 100; i++) {
              const x = i / 100;
              const y = toneCurve(tool, range, protect, x, a);
              expect(y).toBeGreaterThanOrEqual(last - 1e-12);
              last = y;
              if (tool === "dodge") expect(y).toBeGreaterThanOrEqual(x - 1e-12);
              else expect(y).toBeLessThanOrEqual(x + 1e-12);
            }
          }
        }
      }
    }
  });

  it("follows GIMP's curves without Protect Tones", () => {
    expect(toneCurve("dodge", "shadows", false, 0, 1)).toBeCloseTo(1 / 3);
    expect(toneCurve("dodge", "midtones", false, 0.25, 1)).toBeCloseTo(0.5);
    expect(toneCurve("dodge", "highlights", false, 0.9, 1)).toBeCloseTo(1.2);
    expect(toneCurve("burn", "shadows", false, 0.2, 1)).toBe(0);
    expect(toneCurve("burn", "midtones", false, 0.5, 0.75)).toBeCloseTo(0.5 ** 1.25);
    expect(toneCurve("burn", "highlights", false, 1, 1)).toBeCloseTo(2 / 3);
  });

  it("never clips with Protect Tones: black and white stay where they are", () => {
    for (const range of RANGES) {
      expect(toneCurve("dodge", range, true, 1, 1)).toBeCloseTo(1);
      expect(toneCurve("burn", range, true, 0, 1)).toBeCloseTo(0);
      for (let i = 0; i <= 20; i++) {
        expect(toneCurve("dodge", range, true, i / 20, 1)).toBeLessThanOrEqual(1 + 1e-12);
        expect(toneCurve("burn", range, true, i / 20, 1)).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });

  it("changes its range most", () => {
    const change = (tool: "dodge" | "burn", range: ToneRange, x: number) => Math.abs(toneCurve(tool, range, true, x, 0.5) - x);
    for (const tool of ["dodge", "burn"] as const) {
      expect(change(tool, "shadows", 0.15)).toBeGreaterThan(change(tool, "shadows", 0.85));
      expect(change(tool, "highlights", 0.85)).toBeGreaterThan(change(tool, "highlights", 0.15));
      expect(change(tool, "midtones", 0.5)).toBeGreaterThan(change(tool, "midtones", 0.95));
      expect(change(tool, "midtones", 0.5)).toBeGreaterThan(change(tool, "midtones", 0.03));
    }
  });
});

describe("tonePixel", () => {
  const dodge: ToneEffect = { tool: "dodge", range: "midtones", protect: true };
  const burn: ToneEffect = { tool: "burn", range: "shadows", protect: true };

  it("leaves alpha, transparent pixels and an amount of 0 alone", () => {
    expect(tonePixel(dodge, [0, 0, 0, 0], 1)).toEqual([0, 0, 0, 0]);
    const p: Rgba = [0.1, 0.2, 0.05, 0.5];
    expect(tonePixel(dodge, p, 0)).toEqual(p);
    expect(tonePixel(dodge, p, 1)[3]).toBe(0.5);
  });

  it("works on straight colour: half-transparent pixels tone as opaque ones do", () => {
    const opaque = tonePixel(dodge, grey(0.4), 0.6);
    const half = tonePixel(dodge, grey(0.4, 0.5), 0.6);
    for (let i = 0; i < 3; i++) expect(half[i] / 0.5).toBeCloseTo(opaque[i], 6);
  });

  it("dodges greys by the curve on their encoded value", () => {
    const out = encodedOf(tonePixel(dodge, grey(0.25), 1));
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[2]).toBeCloseTo(0.5, 5);
  });

  it("keeps hue and saturation with Protect Tones, and shifts them without", () => {
    const orange: Rgba = [0.8, 0.3, 0.05, 1];
    const kept = tonePixel(burn, orange, 1);
    hue(kept).forEach((v, i) => expect(v).toBeCloseTo(hue(orange)[i], 6));
    expect(luminance(kept[0], kept[1], kept[2])).toBeLessThan(luminance(0.8, 0.3, 0.05));
    const legacy = tonePixel({ ...burn, protect: false }, orange, 1);
    expect(Math.abs(hue(legacy)[0] - hue(orange)[0])).toBeGreaterThan(0.01);
  });

  it("doesn't clip a bright colour dodged with Protect Tones: it desaturates towards white instead", () => {
    const sky: Rgba = [0.3, 0.6, 0.95, 1];
    const out = tonePixel({ tool: "dodge", range: "highlights", protect: true }, sky, 1);
    expect(Math.max(out[0], out[1], out[2])).toBeLessThanOrEqual(1 + 1e-9);
    expect(luminance(out[0], out[1], out[2])).toBeGreaterThan(luminance(0.3, 0.6, 0.95));
    const legacy = tonePixel({ tool: "dodge", range: "highlights", protect: false }, sky, 1);
    expect(Math.max(legacy[0], legacy[1], legacy[2])).toBeGreaterThan(1);
  });

  it("lifts black to grey when dodging shadows", () => {
    const out = tonePixel({ tool: "dodge", range: "shadows", protect: true }, [0, 0, 0, 1], 1);
    expect(linearToSrgb(out[0])).toBeCloseTo(1 / 3, 5);
    expect(out[0]).toBeCloseTo(out[1], 9);
  });

  it("keeps light past white past white", () => {
    const out = tonePixel({ tool: "burn", range: "highlights", protect: false }, [2, 2, 2, 1], 1);
    expect(linearToSrgb(out[0])).toBeGreaterThan(1);
  });
});

describe("sponge", () => {
  const desaturate: ToneEffect = { tool: "sponge", mode: "desaturate", vibrance: false };
  const saturate: ToneEffect = { tool: "sponge", mode: "saturate", vibrance: true };
  const red: Rgba = [srgbToLinear(0.8), srgbToLinear(0.3), srgbToLinear(0.3), 1];

  it("desaturates to the colour's grey at full amount", () => {
    const out = encodedOf(tonePixel(desaturate, red, 1));
    expect(out[0]).toBeCloseTo(out[1], 6);
    expect(out[0]).toBeCloseTo(0.299 * 0.8 + 0.587 * 0.3 + 0.114 * 0.3, 6);
  });

  it("never colours a grey", () => {
    const g = grey(0.5);
    const out = tonePixel(saturate, g, 1);
    out.forEach((v, i) => expect(v).toBeCloseTo(g[i], 9));
  });

  it("saturates without clipping with Vibrance, and clips without", () => {
    const strong: Rgba = [srgbToLinear(0.95), srgbToLinear(0.2), srgbToLinear(0.1), 1];
    const e = encodedOf(tonePixel(saturate, strong, 1));
    for (const v of e) {
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1e-6);
    }
    const clipped = encodedOf(tonePixel({ ...saturate, vibrance: false } as ToneEffect, strong, 1));
    expect(clipped[0]).toBeCloseTo(1, 6);
  });

  it("raises muted colours more than strong ones with Vibrance", () => {
    const spread = (p: Rgba) => {
      const e = encodedOf(p);
      return Math.max(...e) - Math.min(...e);
    };
    const muted: Rgba = [srgbToLinear(0.55), srgbToLinear(0.45), srgbToLinear(0.45), 1];
    const vivid: Rgba = [srgbToLinear(0.7), srgbToLinear(0.3), srgbToLinear(0.3), 1];
    const gain = (p: Rgba) => spread(tonePixel(saturate, p, 0.5)) / spread(p);
    expect(gain(muted)).toBeGreaterThan(gain(vivid));
  });
});

describe("toneMask", () => {
  it("dodges and burns a mask's grey, and sponges its contrast", () => {
    expect(toneMask({ tool: "dodge", range: "midtones", protect: true }, 0.25, 1)).toBeCloseTo(0.5);
    expect(toneMask({ tool: "burn", range: "highlights", protect: false }, 1, 1)).toBeCloseTo(2 / 3);
    expect(toneMask({ tool: "sponge", mode: "saturate", vibrance: true }, 0.75, 1)).toBeCloseTo(1);
    expect(toneMask({ tool: "sponge", mode: "desaturate", vibrance: true }, 0.75, 1)).toBeCloseTo(0.5);
  });
});

describe("strokeLaw", () => {
  it("caps Dodge and Burn at their Exposure, and makes Sponge's Flow a rate", () => {
    expect(strokeLaw({ tool: "dodge", range: "midtones", protect: true }, 0.3, false)).toEqual({ dab: 1, cap: 0.3 });
    const sponge = strokeLaw({ tool: "sponge", mode: "desaturate", vibrance: true }, 0.5, false);
    expect(sponge.cap).toBe(1);
    // Ten dabs (a pass at 10% spacing) of that rate add the Flow.
    expect(1 - (1 - sponge.dab) ** 10).toBeCloseTo(0.5, 9);
    expect(dabRate(0)).toBe(0);
    expect(dabRate(1)).toBe(1);
  });

  it("makes one pass add about the Flow at the stroke's middle, hard or soft", () => {
    for (const hardness of [0, 0.5, 1]) {
      const { dab } = strokeLaw({ tool: "sponge", mode: "desaturate", vibrance: true }, 0.5, false, hardness);
      const dabs = strokeDabs({ radius: 50, hardness, strength: dab, spacing: TONE_SPACING }, [{ x: 0, y: 0 }, { x: 600, y: 0 }]);
      let covered = 0;
      for (const d of dabs) covered += dabCoverage(d, Math.abs(d.x - 300)) * (1 - covered);
      expect(covered, `hardness ${hardness}`).toBeGreaterThan(0.45);
      expect(covered, `hardness ${hardness}`).toBeLessThan(0.55);
    }
  });
});
