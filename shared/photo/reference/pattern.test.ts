import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { type PatternImage, patternCoord, patternLevel, patternMips, samplePattern } from "../style/patterns.ts";
import { newStyleEffect } from "../style/style.ts";
import type { EffectInstance, PixelLayer } from "../types.ts";
import fixtures from "./pattern-fixtures.json" with { type: "json" };
import { type LayerImage, renderStyled } from "./style.ts";

const code = (v: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
const grey = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): PatternImage => {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y).map((v) => v / 255), 1], (y * w + x) * 4);
  return { width: w, height: h, data };
};
/** The probe's patterns (scripts/photoshop-probes/fx_pattern.py), in its 8-bit values. */
const CODED = grey(16, 10, (x, y) => [x * 16 + 8, y * 25 + 12, 128]);
const SINE = grey(32, 32, (x) => {
  const v = Math.round((0.5 + 0.5 * Math.sin((2 * Math.PI * (x + 0.5)) / 32)) * 255);
  return [v, v, v];
});
const STEP = grey(16, 16, (x) => (x >= 8 ? [255, 255, 255] : [0, 0, 0]));
const PATTERNS: Record<string, PatternImage[]> = { coded: patternMips(CODED), sine: patternMips(SINE), step: patternMips(STEP) };

function layerImage(w: number, h: number, inside: (x: number, y: number) => boolean, value: number): LayerImage {
  const pixels = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) pixels.set([value, value, value, 1], (y * w + x) * 4);
  return { width: w, height: h, pixels };
}
const black = (w: number, h: number): LayerImage => ({ width: w, height: h, pixels: new Float32Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)) });
const layerWith = (w: number, effects: EffectInstance[]): PixelLayer => ({ id: "l", kind: "pixel", name: "l", visible: true, opacity: 1, surface: null, size: { width: w, height: w }, transform: { x: w / 2, y: w / 2, scaleX: 1, scaleY: 1, rotation: 0 }, style: { enabled: true, effects } });

describe("patterns are laid out and read as Photoshop's", () => {
  it("at 100% a pixel is a texel; Phase moves it by pixels; 200% mixes texels at their corners; 50% is the 2 × 2 box", () => {
    const at = (x: number, y: number, o: { phase?: [number, number]; scale?: number } = {}) => {
      const p = { origin: { x: 0, y: 0 }, phase: { x: o.phase?.[0] ?? 0, y: o.phase?.[1] ?? 0 }, angle: 0, scale: (o.scale ?? 100) / 100 };
      const { u, v } = patternCoord(x + 0.5, y + 0.5, p);
      const s = samplePattern(PATTERNS.coded, u, v, 1 / p.scale);
      return [(s[0] * 255 - 8) / 16, (s[1] * 255 - 12) / 25];
    };
    expect(at(40, 40)[0]).toBeCloseTo(8, 5);
    expect(at(40, 60, { phase: [5, 3] })[1]).toBeCloseTo(7, 5);
    expect(at(41, 60, { scale: 200 })[0]).toBeCloseTo(4.5, 6);
    expect(at(40, 60, { scale: 50 })[0]).toBeCloseTo(0.5, 6);
    expect(patternLevel(4, 2)).toBe(1);
    expect(patternLevel(4, 0.5)).toBe(0);
  });

  const W = 160;
  const square = layerImage(W, W, (x, y) => x >= 40 && x < 130 && y >= 40 && y < 120, 1);
  const cases: [string, Record<string, unknown>, number][] = [
    ["base", {}, 0],
    ["unaligned", { link: false }, 0],
    ["phase5-3", { phaseX: 5, phaseY: 3 }, 0],
    ["phase-frac", { phaseX: 2.5 }, 0],
    ["scale200", { scale: 200 }, 1],
    ["scale50", { scale: 50 }, 1],
    // Turned a quarter, Photoshop's repeats a texel and skips one where ours doesn't (a quirk of its resampling).
    ["angle90", { angle: 90 }, 0],
    // (Turned by 30°, Photoshop's is a fraction of a pixel off ours: its pivot isn't measured. Not compared.)
  ];
  for (const [name, params, tolerance] of cases) {
    it(`Pattern Overlay: ${name}`, () => {
      const effect = newStyleEffect("pattern-overlay", "p", { pattern: "coded", ...params })!;
      const out = renderStyled(layerWith(W, [effect]), { compositing: "photoshop" }, black(W, W), square, () => 0, { x0: 0, y0: 0, x1: W, y1: W }, () => 30, (id) => PATTERNS[id]);
      const want = (fixtures.overlay as Record<string, { row: number[][]; column: number[][] }>)[name];
      let worst = 0;
      let off = 0;
      for (let k = 0; k < 32; k++) {
        for (const [expected, x, y] of [
          [want.row[k], 40 + k, 60],
          [want.column[k], 60, 40 + k],
        ] as const) {
          const i = (y * W + x) * 4;
          const e = Math.max(Math.abs(code(out[i]) - expected[0]), Math.abs(code(out[i + 1]) - expected[1]));
          if (e > tolerance + 1) off++;
          worst = Math.max(worst, e);
        }
      }
      if (name === "angle90") expect(off).toBeLessThanOrEqual(2);
      else expect(worst).toBeLessThanOrEqual(tolerance + 1);
    });
  }
});

describe("Bevel's Texture against Photoshop's", () => {
  const W = 200;
  const g = srgbToLinear(128 / 255);
  const square = layerImage(W, W, (x, y) => x >= 20 && x < 180 && y >= 20 && y < 180, g);
  const cases: [string, Record<string, unknown>][] = [
    ["tex-sine", {}],
    ["tex-sine-d50", { textureDepth: 50 }],
    ["tex-sine-d200", { textureDepth: 200 }],
    ["tex-sine-inv", { invertTexture: true }],
    ["tex-sine-bdepth200", { depth: 200 }],
    ["tex-sine-size10", { size: 10 }],
    ["tex-sine-scale200", { textureScale: 200 }],
    ["tex-step", { texture: "step" }],
    ["tex-sine-emboss", { style: "emboss" }],
    ["tex-sine-angle0", { angle: 0 }],
  ];
  for (const [name, params] of cases) {
    it(name, () => {
      const effect = newStyleEffect("bevel-emboss", "b", {
        size: 20,
        globalLight: false,
        angle: 120,
        altitude: 30,
        highlightMode: "normal",
        highlightOpacity: 100,
        shadowMode: "normal",
        shadowOpacity: 100,
        useTexture: true,
        texture: "sine",
        ...params,
      })!;
      const out = renderStyled(layerWith(W, [effect]), { compositing: "photoshop" }, black(W, W), square, (e) => e.params.angle as number, { x0: 0, y0: 0, x1: W, y1: W }, (e) => e.params.altitude as number, (id) => PATTERNS[id]);
      const want = (fixtures.texture as Record<string, number[]>)[name];
      let worst = 0;
      let total = 0;
      want.forEach((expected, k) => {
        const e = Math.abs(code(out[(100 * W + 40 + k) * 4]) - expected);
        worst = Math.max(worst, e);
        total += e;
      });
      // (Emboss's own shading is the model's loosest: L3's fixtures have it within 10.)
      expect(worst, name).toBeLessThanOrEqual(name.includes("emboss") ? 10 : 4);
      expect(total / want.length).toBeLessThan(name.includes("emboss") ? 3 : 1.5);
    });
  }
});
