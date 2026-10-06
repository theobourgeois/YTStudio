import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { CONTOUR_PRESETS, contourFunction } from "../style/contours.ts";
import { styleDefinition } from "../style/definitions.ts";
import { gradientAt, gradientLayout, gradientPosition } from "../style/gradients.ts";
import { newStyleEffect } from "../style/style.ts";
import type { Contour, EffectInstance, PixelLayer } from "../types.ts";
import fixtures from "./style-fixtures.json" with { type: "json" };
import { type LayerImage, edt, falloff, renderStyled, shadowOffset, signedDistance, strokeBand } from "./style.ts";

const code = (v: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);

/** A half-plane (opaque left of `edge`) `w` × `h`, and Photoshop's glow probe's profile across it. */
function halfPlane(w: number, h: number, edge: number) {
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < edge; x++) alpha[y * w + x] = 1;
  return alpha;
}

describe("shadows' and glows' falloff against Photoshop", () => {
  // Photoshop's probe: a white Normal glow over black, so a pixel is the glow's coverage, encoded.
  const profile = (size: number, spread: number, technique: "softer" | "precise") => {
    const edge = size + 8;
    const w = edge + size + 12;
    const h = 2 * size + 16;
    const alpha = halfPlane(w, h, edge);
    // Rows far from the strip's ends: the edge runs on past them in Photoshop's probe.
    const f = falloff(alpha, signedDistance(alpha, w, h), w, h, size, spread, technique, 0);
    const row = Math.floor(h / 2);
    // Over black, Normal: the encoded value is the coverage (mixing encoded values).
    return Array.from({ length: size + 4 }, (_, k) => Math.round(Math.min(1, f[row * w + edge + k]) * 255));
  };
  const cases: [string, number, number, "softer" | "precise"][] = [
    ["softMatte-s3", 3, 0, "softer"],
    ["softMatte-s20", 20, 0, "softer"],
    ["softMatte-s100", 100, 0, "softer"],
    ["preciseMatte-s5", 5, 0, "precise"],
    ["preciseMatte-s20", 20, 0, "precise"],
    ["preciseMatte-s100", 100, 0, "precise"],
    ["softMatte-s20-sp50", 20, 0.5, "softer"],
    ["preciseMatte-s20-sp25", 20, 0.25, "precise"],
  ];
  for (const [name, size, spread, technique] of cases) {
    it(`${technique}, Size ${size}, Spread ${spread * 100}%`, () => {
      const want = (fixtures.glow as Record<string, number[]>)[name];
      const got = profile(size, spread, technique);
      want.forEach((v, k) => expect(Math.abs(got[k] - v), `pixel ${k}: ${got[k]} vs Photoshop's ${v}`).toBeLessThanOrEqual(1));
    });
  }
});

describe("contours against Photoshop", () => {
  const curve = (points: [number, number, boolean][]): Contour => ({ name: "t", points: points.map(([x, y, corner]) => (corner ? { x, y, corner: true } : { x, y })) });
  // The probe: Precise, Size 250, Range 50, so the input at the k-th pixel out is the linear profile's (read off it).
  const lin = fixtures.contours.linear;
  const check = (name: keyof typeof fixtures.contours, c: Contour, tolerance: number) => {
    const f = contourFunction(c);
    const got = fixtures.contours[name];
    for (let k = 4; k < 246; k++) {
      // On a near-vertical part a pixel's input is all that matters: allow for the slope next to it.
      const slope = Math.max(Math.abs(got[k + 1] - got[k]), Math.abs(got[k] - got[k - 1]));
      expect(Math.abs(Math.round(f(lin[k] / 255) * 255) - got[k]), `${name} at ${k}`).toBeLessThanOrEqual(tolerance + slope);
    }
  };
  it("joins smooth points with a natural spline", () => {
    check("cone-smooth", curve([[0, 0, false], [128, 255, false], [255, 0, false]]), 3);
    check("five-smooth", curve([[0, 0, false], [64, 200, false], [128, 40, false], [192, 220, false], [255, 255, false]]), 3);
  });
  it("breaks at corners into straight lines and steps", () => {
    check("cone-corner", curve([[0, 0, false], [128, 255, true], [255, 0, false]]), 3);
    check("steps-corner", curve([[0, 0, false], [64, 0, true], [68, 128, true], [192, 128, true], [196, 255, true], [255, 255, false]]), 3);
  });
  it("has Photoshop's 12 presets, Linear first", () => {
    expect(CONTOUR_PRESETS.map((c) => c.name)).toEqual(["Linear", "Cone", "Cone - Inverted", "Cove - Deep", "Cove - Shallow", "Gaussian", "Half Round", "Ring", "Ring - Double", "Rolling Slope - Descending", "Rounded Steps", "Sawtooth 1"]);
    expect(contourFunction(CONTOUR_PRESETS[0])(0.3)).toBeCloseTo(0.3, 6);
  });
});

/** A layer with effects for the whole-layer reference. */
const styled = (effects: EffectInstance[], extra: Partial<PixelLayer> = {}): PixelLayer => ({
  id: "l",
  kind: "pixel",
  name: "l",
  visible: true,
  opacity: 1,
  surface: null,
  size: { width: 1, height: 1 },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  style: { enabled: true, effects },
  ...extra,
});
const effect = (type: string, params: Record<string, unknown> = {}, id = type) => newStyleEffect(type, id, params)!;
const image = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): LayerImage => {
  const pixels = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, pixels };
};
const black = (w: number, h: number) => image(w, h, () => [0, 0, 0, 1]);

describe("strokes against Photoshop", () => {
  // A white disc of radius 70 at (160, 160), a red 10 px stroke, over black: row 160, red minus green.
  const disc = image(320, 320, (x, y) => {
    const a = Math.min(1, Math.max(0, 70 - Math.hypot(x + 0.5 - 160, y + 0.5 - 160) + 0.5));
    return [a, a, a, a];
  });
  for (const position of ["outside", "inside", "center"] as const) {
    it(`draws the ${position} band`, () => {
      const layer = styled([effect("stroke", { size: 10, position, colour: "#ff0000" })]);
      const out = renderStyled(layer, { compositing: "photoshop" }, black(320, 320), disc, () => 120, { x0: 0, y0: 0, x1: 320, y1: 320 });
      const want = fixtures.stroke[position];
      let total = 0;
      for (let x = 60; x < 260; x++) {
        const i = (160 * 320 + x) * 4;
        const got = code(out[i] / out[i + 3]) * out[i + 3] - code(out[i + 1] / out[i + 3]) * out[i + 3];
        total += Math.abs(got - want[x]);
        expect(Math.abs(got - want[x]), `x ${x}`).toBeLessThanOrEqual(70);
      }
      expect(total / 200).toBeLessThan(2);
    });
  }
  it("bands by distance, anti-aliased over a pixel", () => {
    expect(strokeBand(5, 10, "outside")).toBe(1);
    expect(strokeBand(10.5, 10, "outside")).toBe(0);
    expect(strokeBand(10, 10, "outside")).toBe(0.5);
    expect(strokeBand(-3, 10, "center")).toBe(1);
  });
});

describe("inner glows against Photoshop", () => {
  // A white square 100..220 in 320 × 320 with a red Normal 100% Inner Glow, Size 20, over black: row 160 from x 100.
  const square = image(320, 320, (x, y) => (x >= 100 && x < 220 && y >= 100 && y < 220 ? [1, 1, 1, 1] : [0, 0, 0, 0]));
  const cases: [string, Record<string, unknown>][] = [
    ["innerglow-edge", {}],
    ["innerglow-center", { source: "center" }],
    ["innerglow-edge-precise", { technique: "precise" }],
    ["innerglow-edge-choke50", { choke: 50 }],
  ];
  for (const [name, params] of cases) {
    it(name, () => {
      const layer = styled([effect("inner-glow", { mode: "normal", colour: "#ff0000", opacity: 100, size: 20, range: 100, ...params })]);
      const out = renderStyled(layer, { compositing: "photoshop" }, black(320, 320), square, () => 120, { x0: 100, y0: 100, x1: 220, y1: 220 });
      const want = (fixtures.innerGlow as Record<string, number[]>)[name];
      for (let k = 0; k < 30; k++) {
        const i = (160 * 320 + 100 + k) * 4;
        const got = code(out[i]) - code(out[i + 1]);
        expect(Math.abs(got - want[k]), `${name} pixel ${k}: ${got} vs ${want[k]}`).toBeLessThanOrEqual(2);
      }
    });
  }
});

describe("shadows", () => {
  it("fall away from the light: 120° is right and down", () => {
    const o = shadowOffset(120, 20);
    expect(o.x).toBeCloseTo(10, 6);
    expect(o.y).toBeCloseTo(17.32, 2);
  });
  it("multiply encoded values: 35% black over grey 128 is 83, as Photoshop's", () => {
    const grey = srgbToLinear(128 / 255);
    const square = image(64, 64, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [1, 1, 1, 1] : [0, 0, 0, 0]));
    const backdrop = image(64, 64, () => [grey, grey, grey, 1]);
    const layer = styled([effect("drop-shadow", { opacity: 35, distance: 20, size: 0, angle: 135, globalLight: false })]);
    const out = renderStyled(layer, { compositing: "photoshop" }, backdrop, square, (e) => e.params.angle as number, { x0: 0, y0: 0, x1: 64, y1: 64 });
    const i = (40 * 64 + 40) * 4;
    expect(code(out[i])).toBe(fixtures.multiplyShadow);
  });
});

describe("the distance transform", () => {
  it("is Euclidean, to pixel centres", () => {
    const d = edt((i) => i === 0, 5, 5);
    expect(d[4 * 5 + 3]).toBe(25);
    expect(d[1]).toBe(1);
  });
});

describe("gradients", () => {
  it("mix Classic halfway between a line and smoothstep (measured)", () => {
    const g = { name: "bw", method: "classic" as const, colours: [{ at: 0, colour: "#000000" }, { at: 1, colour: "#ffffff" }], opacities: [{ at: 0, opacity: 1 }, { at: 1, opacity: 1 }] };
    // Photoshop's row every 14 px of 140: 0, 16, 39, 66, 96, 128, 159, 189, 216, 239.
    [0, 16, 39, 66, 96, 128, 159, 189, 216, 239].forEach((v, k) => expect(Math.abs(Math.round(gradientAt(g, (k * 14) / 140)[0] * 255) - v)).toBeLessThanOrEqual(1));
  });
  it("lay out linear from the box's bottom at 90°", () => {
    const layout = gradientLayout({ x0: 0, y0: 0, x1: 100, y1: 100 }, 90, 100, { x: 0, y: 0 });
    expect(gradientPosition("linear", layout, 50, 99.5)).toBeCloseTo(0.005, 3);
    expect(gradientPosition("linear", layout, 50, 0.5)).toBeCloseTo(0.995, 3);
    expect(gradientPosition("radial", layout, 50, 50)).toBe(0);
  });
  it("say how far each effect reaches", () => {
    expect(styleDefinition("drop-shadow")!.reach(effect("drop-shadow").params)).toBe(14);
  });
});
