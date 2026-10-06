import { describe, expect, it } from "vitest";
import { hexToLinear } from "../colour.ts";
import { FLARE_ELEMENT_TYPES, FLARE_PRESETS, flareElementType, flarePreset, flareShape } from "../effects/flare.ts";
import { newElement } from "../effects/params.ts";
import type { EffectElement } from "../types.ts";
import { elementCentre, elementProfile, flareLight, polygonDistance } from "./flare.ts";

const element = (type: string, values: Record<string, number | string | boolean> = {}): EffectElement => ({ ...newElement(flareElementType(type)!, "x"), ...values });

/** The sum of an element's red over a square of document pixels, sampled at pixel centres with this footprint. */
function energy(e: EffectElement, half: number, step: number): number {
  let sum = 0;
  for (let y = -half + step / 2; y < half; y += step) for (let x = -half + step / 2; x < half; x += step) sum += elementProfile(e, x, y, step)[0] * step * step;
  return sum;
}

describe("the lens flare (version 1)", () => {
  it("places elements on the line from the source through the optical centre", () => {
    const shape = { source: [300, 100] as [number, number], centre: [100, 100] as [number, number], gain: [1, 1, 1] as [number, number, number], elements: [] };
    expect(elementCentre(shape, element("ghost", { position: 1 }))).toEqual([300, 100]);
    expect(elementCentre(shape, element("ghost", { position: 0 }))).toEqual([100, 100]);
    expect(elementCentre(shape, element("ghost", { position: -0.5 }))).toEqual([0, 100]);
    // Offset goes to the side (+90° from the axis, y down).
    expect(elementCentre(shape, element("ghost", { position: 0, offset: 20 }))).toEqual([100, 120]);
  });

  it("measures distance to a regular polygon: zero on its corners, negative inside", () => {
    // A hexagon of circumradius 10 has a corner straight up (sdRegularPolygon's convention) and an inradius of 10·cos 30°.
    expect(polygonDistance(0, 10, 10, 6)).toBeCloseTo(0, 9);
    expect(polygonDistance(0, 0, 10, 6)).toBeCloseTo(-10 * Math.cos(Math.PI / 6), 9);
    expect(polygonDistance(0, 20, 10, 6)).toBeCloseTo(10, 9);
  });

  it("splits a ghost's rim into colours, red outside blue", () => {
    const e = element("ghost", { size: 50, chroma: 10, rim: 100, softness: 0 });
    let red = 0;
    let blue = 0;
    for (let r = 40; r < 60; r += 0.25) {
      const [pr, , pb] = elementProfile(e, r, 0, 1);
      red += pr * r;
      blue += pb * r;
    }
    // Weighted mean radius of each channel's rim.
    const mean = (c: 0 | 2) => {
      let s = 0;
      let w = 0;
      for (let r = 40; r < 60; r += 0.25) {
        const v = elementProfile(e, r, 0, 1)[c];
        s += v * r;
        w += v;
      }
      return s / w;
    };
    expect(red).toBeGreaterThan(0);
    expect(blue).toBeGreaterThan(0);
    expect(mean(0)).toBeGreaterThan(mean(2) + 5);
  });

  it("is symmetric about a disc's centre and fades monotonically from a source glow", () => {
    const g = element("glow", { size: 30, core: 0 });
    for (const r of [5, 17, 60]) {
      const a = elementProfile(g, r, 0, 1)[0];
      expect(elementProfile(g, 0, r, 1)[0]).toBeCloseTo(a, 12);
      expect(elementProfile(g, -r * Math.SQRT1_2, r * Math.SQRT1_2, 1)[0]).toBeCloseTo(a, 12);
    }
    let last = Infinity;
    for (let r = 0; r < 400; r += 3) {
      const v = elementProfile(g, r, 0, 1)[0];
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it("keeps thin features' energy at any footprint, so a reduced view matches level 0 reduced", () => {
    for (const [e, half] of [
      [element("halo", { size: 60, thickness: 2 }), 100],
      [element("streak", { size: 40, thickness: 0.5, haze: 0 }), 128],
      [element("ghost", { size: 40, rim: 100, softness: 0, chroma: 0 }), 64],
    ] as const) {
      const fine = energy(e, half, 1);
      for (const step of [2, 4, 8]) expect(energy(e, half, step) / fine).toBeCloseTo(1, 1);
    }
  });

  it("scales presets to the canvas, with unique ids, and sums its elements' light", () => {
    const small = flarePreset("classic", 1080, 1920);
    const big = flarePreset("classic", 4320, 7680);
    expect(new Set(small.map((e) => e.id)).size).toBe(small.length);
    expect((big[2].size as number) / (small[2].size as number)).toBeCloseTo(4, 1);
    for (const preset of FLARE_PRESETS) {
      for (const e of flarePreset(preset.id, 1000, 1000)) {
        const type = FLARE_ELEMENT_TYPES.find((t) => t.type === e.type)!;
        for (const p of type.params) expect(e[p.key], `${preset.id} ${e.type} ${p.key}`).toBeDefined();
      }
    }
    const shape = flareShape({ source: [200, 200], centre: null, intensity: 1, colour: "#ffffff", elements: [element("glow", { size: 10, core: 0 })] }, { width: 400, height: 400 }, hexToLinear);
    expect(shape.centre).toEqual([200, 200]);
    // At the source, a glow's peak is 1 × its tint (white) × 2^1 (dimmed a little by a pixel's footprint).
    expect(flareLight(shape, 200, 200, 1, hexToLinear)[0]).toBeCloseTo(2, 1);
    const off = flareShape({ source: [200, 200], centre: null, intensity: 0, colour: "#ffffff", elements: [element("glow", { enabled: false })] }, { width: 400, height: 400 }, hexToLinear);
    expect(flareLight(off, 200, 200, 1, hexToLinear)).toEqual([0, 0, 0]);
  });
});
