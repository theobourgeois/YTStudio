import { describe, expect, it } from "vitest";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { HUE_RANGES } from "../effects/hue-saturation.ts";
import { ADJUSTMENTS, FILTERS, effectDefinition, newEffect, usableAs, validateParams } from "../effects/index.ts";
import { hslToRgb, hueOf, hueSaturationEncoded, hueSaturationFor, hueSaturationPixel, hueSaturationSettings, rangeWeight } from "./hue-saturation.ts";
import type { Rgb } from "./kernel.ts";

const def = effectDefinition("hue-saturation")!;
const settings = (p: Record<string, number | boolean>) => hueSaturationSettings(validateParams(def, p).params);
const encoded = (v: Rgb, p: Record<string, number | boolean>) => hueSaturationEncoded(v, settings(p));
const close = (a: readonly number[], b: readonly number[], digits = 12) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("Hue/Saturation", () => {
  it("is a filter and an adjustment, at its defaults the identity, exactly", () => {
    expect(usableAs(def, "adjustment") && usableAs(def, "filter")).toBe(true);
    expect(ADJUSTMENTS.map((d) => d.type)).toContain("hue-saturation");
    expect(FILTERS.map((d) => d.type)).toContain("hue-saturation");
    const params = newEffect(def, "h").params;
    expect(def.isIdentity(params)).toBe(true);
    expect(def.summary(params)).toBe("no change");
    const px: [number, number, number, number] = [0.123, 0.456, 0.0789, 0.6];
    close(hueSaturationFor(params)(px), px, 14);
    // Colorize changes everything; its sliders change nothing while it's off.
    expect(def.isIdentity({ ...params, colorize: true })).toBe(false);
    expect(def.isIdentity({ ...params, colorizeHue: 200 })).toBe(true);
  });

  it("turns hues round the wheel, keeping saturation and lightness", () => {
    close(encoded([1, 0, 0], { hue: 180 }), [0, 1, 1]);
    close(encoded([1, 0, 0], { hue: 120 }), [0, 1, 0]);
    close(encoded([1, 0, 0], { hue: -120 }), [0, 0, 1]);
    const muted: Rgb = [0.7, 0.5, 0.4];
    const turned = encoded(muted, { hue: 90 });
    expect(Math.max(...turned) + Math.min(...turned)).toBeCloseTo(Math.max(...muted) + Math.min(...muted), 12);
    expect(Math.max(...turned) - Math.min(...turned)).toBeCloseTo(Math.max(...muted) - Math.min(...muted), 12);
    expect(hueOf(turned)).toBeCloseTo(hueOf(muted) + 90, 9);
    // A grey has no hue to turn.
    close(encoded([0.4, 0.4, 0.4], { hue: 77 }), [0.4, 0.4, 0.4]);
  });

  it("saturates as Photoshop's: −100 is grey at the lightness, +100 full saturation at the same hue and lightness", () => {
    close(encoded([1, 0.5, 0], { saturation: -100 }), [0.5, 0.5, 0.5]);
    close(encoded([0.6, 0.4, 0.4], { saturation: 100 }), [1, 0, 0]);
    const half = encoded([0.6, 0.4, 0.4], { saturation: 50 });
    // Out from the lightness by 1 / (1 − ½): twice as far.
    close(half, [0.7, 0.3, 0.3]);
    close(encoded([0.6, 0.4, 0.4], { saturation: -50 }), [0.55, 0.45, 0.45]);
  });

  it("mixes towards white or black with Lightness", () => {
    close(encoded([0.2, 0.6, 0.4], { lightness: 100 }), [1, 1, 1]);
    close(encoded([0.2, 0.6, 0.4], { lightness: -100 }), [0, 0, 0]);
    close(encoded([0.2, 0.6, 0.4], { lightness: 50 }), [0.6, 0.8, 0.7]);
    close(encoded([0.2, 0.6, 0.4], { lightness: -50 }), [0.1, 0.3, 0.2]);
  });

  it("has six ranges whose weights cross smoothly and add up to 1 at every hue", () => {
    for (let h = 0; h < 360; h += 0.5) expect(HUE_RANGES.reduce((sum, r) => sum + rangeWeight(h, r.centre), 0)).toBeCloseTo(1, 12);
    expect(rangeWeight(10, 0)).toBe(1);
    expect(rangeWeight(350, 0)).toBe(1);
    expect(rangeWeight(30, 0)).toBeCloseTo(0.5, 12);
    expect(rangeWeight(45, 0)).toBe(0);
    expect(rangeWeight(180, 0)).toBe(0);
  });

  it("changes one range alone: Reds' settings leave blues as they were, and orange halfway", () => {
    close(encoded([1, 0, 0], { redsSaturation: -100 }), [0.5, 0.5, 0.5]);
    close(encoded([0, 0, 1], { redsSaturation: -100 }), [0, 0, 1]);
    const orange = encoded([1, 0.5, 0], { redsSaturation: -100 });
    close(orange, [0.75, 0.5, 0.25]);
    // A range's settings add to Master's.
    close(encoded([0, 1, 0], { greensHue: 60, hue: 60 }), [0, 0, 1]);
    // They fade out towards grey, where hue is noise; Master's don't.
    close(encoded([0.5, 0.5, 0.5], { redsLightness: 100 }), [0.5, 0.5, 0.5]);
    const nearGrey = encoded([0.5 + 1 / 255, 0.5 - 1 / 255, 0.5 - 1 / 255], { redsLightness: 100 });
    expect(nearGrey[1]).toBeCloseTo(0.5 - 1 / 255 + (0.5 + 1 / 255) * 0.5, 9);
  });

  it("colorizes: one hue and saturation at each pixel's lightness, then Lightness", () => {
    const s = { colorize: true, colorizeHue: 35, colorizeSaturation: 25 };
    const red = encoded([1, 0, 0], s);
    close(red, hslToRgb(35, 0.25, 0.5));
    // Pure red and pure blue have the same HSL lightness, so they colorize alike (as in Photoshop).
    close(encoded([0, 0, 1], s), red);
    expect(hueOf(red)).toBeCloseTo(35, 9);
    close(encoded([0.3, 0.3, 0.3], { ...s, lightness: -100 }), [0, 0, 0]);
    // Master's hue and saturation don't apply while colorizing.
    close(encoded([1, 0, 0], { ...s, hue: 90, saturation: -100 }), red);
  });

  it("works on the encoded colour of linear light, keeps light past white as it was, and premultiplies", () => {
    const linear = [0.2, 0.05, 0.6];
    const out = hueSaturationPixel(linear, settings({ hue: 45 }));
    const expected = encoded(linear.map(linearToSrgb) as Rgb, { hue: 45 }).map(srgbToLinear);
    close(out, expected);
    // Above white: the part past 1 stays.
    const bright = hueSaturationPixel([2, 0.5, 0.5], settings({ saturation: -100 }));
    const grey = encoded([1, linearToSrgb(0.5), linearToSrgb(0.5)], { saturation: -100 });
    close(bright, [srgbToLinear(grey[0]) + 1, srgbToLinear(grey[1]), srgbToLinear(grey[2])]);
    const f = hueSaturationFor(validateParams(def, { hue: 45 }).params);
    close(f([0.1, 0.025, 0.3, 0.5]), [out[0] * 0.5, out[1] * 0.5, out[2] * 0.5, 0.5]);
    expect(f([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it("says what it does, and has Photoshop's presets", () => {
    expect(def.summary(validateParams(def, { saturation: 30, redsHue: -10 }).params)).toBe("saturation +30; Reds: hue -10°");
    expect(def.summary(validateParams(def, { colorize: true, colorizeHue: 35 }).params)).toBe("colorized 35°, saturation 25");
    expect(def.presets!.map((p) => p.id)).toContain("sepia");
    for (const preset of def.presets!) expect(validateParams(def, preset.params({ width: 100, height: 100 })).problems).toEqual([]);
  });
});
