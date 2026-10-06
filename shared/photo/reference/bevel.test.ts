import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { newStyleEffect } from "../style/style.ts";
import type { EffectInstance, PixelLayer } from "../types.ts";
import fixtures from "./bevel-fixtures.json" with { type: "json" };
import { type LayerImage, bevelHeight, renderStyled, signedDistance, strokeEmbossBand } from "./style.ts";

const W = 320;
const code = (v: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);

/** Photoshop's probe: a grey 128 square (90..230) or a disc of radius 80 at (160, 160), its coverage in 8 bits. */
function shape(kind: "disc" | "square"): LayerImage {
  const grey = srgbToLinear(128 / 255);
  const pixels = new Float32Array(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const cover = kind === "disc" ? Math.min(1, Math.max(0, 80 - Math.hypot(x + 0.5 - 160, y + 0.5 - 160) + 0.5)) : x >= 90 && x < 230 && y >= 90 && y < 230 ? 1 : 0;
      const a = Math.round(cover * 255) / 255;
      pixels.set([grey * a, grey * a, grey * a, a], (y * W + x) * 4);
    }
  return { width: W, height: W, pixels };
}
const black: LayerImage = { width: W, height: W, pixels: new Float32Array(W * W * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)) };
const layerWith = (effects: EffectInstance[]): PixelLayer => ({ id: "l", kind: "pixel", name: "l", visible: true, opacity: 1, surface: null, size: { width: W, height: W }, transform: { x: W / 2, y: W / 2, scaleX: 1, scaleY: 1, rotation: 0 }, style: { enabled: true, effects } });

const STYLES: Record<string, string> = { outerBevel: "outer-bevel", innerBevel: "inner-bevel", emboss: "emboss", pillowEmboss: "pillow-emboss" };
const TECHNIQUES: Record<string, string> = { softMatte: "smooth", preciseMatte: "chisel-hard", slopeLimitMatte: "chisel-soft" };
/** Where the model is furthest from Photoshop (8-bit levels): Emboss's and Pillow's Smooth shadows and a Size 40 chisel's inner end. */
const LOOSER: Record<string, number> = { "bevel-emboss-softMatte-disc": 10, "bevel-emboss-softMatte-square": 10, "bevel-pillowEmboss-softMatte-disc": 10, "bevel-pillowEmboss-softMatte-square": 10, "bevel-innerBevel-preciseMatte-disc-size40": 10, "bevel-innerBevel-slopeLimitMatte-disc-size40": 10 };

describe("Bevel & Emboss and Satin against Photoshop's renders", () => {
  const rows = fixtures.rows as Record<string, { row: number[]; column: number[] }>;
  for (const [key, want] of Object.entries(rows)) {
    it(key, () => {
      const kind = key.includes("disc") ? "disc" : "square";
      let effect: EffectInstance;
      if (key.startsWith("bevel-")) {
        const [, style, technique, , extra] = key.split("-");
        const num = (name: string, fallback: number) => (extra?.startsWith(name) ? Number(extra.slice(name.length)) : fallback);
        effect = newStyleEffect("bevel-emboss", "b", {
          style: STYLES[style],
          technique: TECHNIQUES[technique],
          size: num("size", 20),
          depth: num("depth", 100),
          soften: num("soften", 0),
          globalLight: false,
          angle: 120,
          altitude: 30,
          highlightMode: "normal",
          highlightOpacity: 100,
          shadowMode: "normal",
          shadowOpacity: 100,
        })!;
      } else effect = newStyleEffect("satin", "s", { mode: "normal", colour: "#ff0000", opacity: 100, angle: 19, distance: 11, size: 14, invert: key.includes("invert") })!;
      const out = renderStyled(layerWith([effect]), { compositing: "photoshop" }, black, shape(kind), (e) => e.params.angle as number, { x0: 0, y0: 0, x1: W, y1: W }, (e) => e.params.altitude as number);
      let worst = 0;
      let total = 0;
      for (let k = 0; k < 221; k++) {
        for (const [expected, x, y] of [
          [want.row[k], 50 + k, 160],
          [want.column[k], 160, 50 + k],
        ]) {
          const e = Math.abs(code(out[(y * W + x) * 4]) - expected);
          worst = Math.max(worst, e);
          total += e;
        }
      }
      expect(worst).toBeLessThanOrEqual(LOOSER[key] ?? 6);
      expect(total / 442).toBeLessThan(1);
    });
  }
});

describe("the bevel's height", () => {
  it("Stroke Emboss's band is the strokes' together, and none without one", () => {
    const strokes = [newStyleEffect("stroke", "a", { size: 6 })!, newStyleEffect("stroke", "b", { size: 4, position: "inside" })!];
    expect(strokeEmbossBand(strokes)).toEqual([-4, 6]);
    expect(strokeEmbossBand([{ ...strokes[0], enabled: false }])).toBeNull();
  });
  it("Soften blurs it; a chisel's facet is flat past its width", () => {
    const alpha = new Float32Array(64 * 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) alpha[y * 64 + x] = 1;
    const sd = signedDistance(alpha, 64, 8);
    const hard = bevelHeight(alpha, sd, 64, 8, { style: "inner-bevel", technique: "chisel-hard", size: 10, soften: 0 });
    expect(hard[4 * 64 + 5]).toBe(hard[4 * 64 + 2]);
    expect(hard[4 * 64 + 30] - hard[4 * 64 + 31]).toBeCloseTo(hard[4 * 64 + 25] - hard[4 * 64 + 26], 6);
    const soft = bevelHeight(alpha, sd, 64, 8, { style: "inner-bevel", technique: "chisel-hard", size: 10, soften: 4 });
    expect(Math.abs(soft[4 * 64 + 21] - hard[4 * 64 + 21])).toBeGreaterThan(1e-3);
  });
});
