/**
 * Hue/Saturation's CPU reference (docs/photo/hue-saturation.md), in f64: what the GPU's passes
 * (`src/suites/photo/render/hue-saturation.ts`) are checked against, step for step, by `scripts/photo-sheet.ts
 * hue-saturation`. It works as Photoshop's does, on the sRGB-encoded colour in HSL terms: the hue turned (S and L
 * kept), then the saturation pushed out or pulled in around the lightness, then the lightness mixed towards white or
 * black. Light above white (or below black) is worked on held to [0, 1], and what was past keeps as it was.
 */
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { HUE_RANGES, RANGE_INNER, RANGE_OUTER, channelKeys } from "../effects/hue-saturation.ts";
import type { EffectParamValue } from "../types.ts";
import type { Pixel } from "./adjustments.ts";
import type { KernelReference, Rgb } from "./kernel.ts";

/**
 * Below this chroma (encoded) a colour's hue is mostly noise: the ranges' own settings fade out towards grey, so a
 * near-grey area doesn't take a range's lightness in blotches (a grey has no hue at all, so no range).
 */
export const NEUTRAL_CHROMA = 4 / 255;

/** The settings as the passes read them: hue in degrees, saturation and lightness in −1..1. */
export interface HueSaturationSettings {
  master: [number, number, number];
  /** One per `HUE_RANGES`, in order. */
  ranges: [number, number, number][];
  colorize: boolean;
  colorizeHue: number;
  colorizeSaturation: number;
}

export function hueSaturationSettings(params: Record<string, EffectParamValue>): HueSaturationSettings {
  const v = (key: string) => (params[key] as number | undefined) ?? 0;
  const three = (k: ReturnType<typeof channelKeys>): [number, number, number] => [v(k.hue), v(k.saturation) / 100, v(k.lightness) / 100];
  return {
    master: three(channelKeys("master")),
    ranges: HUE_RANGES.map((r) => three(channelKeys(r.id))),
    colorize: params.colorize === true,
    colorizeHue: v("colorizeHue"),
    colorizeSaturation: ((params.colorizeSaturation as number | undefined) ?? 25) / 100,
  };
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** How much a range (centred at `centre` degrees) takes a hue: 1 within 15°, falling to 0 at 45°. */
export function rangeWeight(hue: number, centre: number): number {
  const d = Math.abs((((hue - centre) % 360) + 540) % 360 - 180);
  return clamp((RANGE_OUTER - d) / (RANGE_OUTER - RANGE_INNER));
}

/** An encoded colour's HSL hue in degrees [0, 360) (0 for a grey). */
export function hueOf([r, g, b]: readonly number[]): number {
  const mx = Math.max(r, g, b);
  const c = mx - Math.min(r, g, b);
  if (!(c > 0)) return 0;
  let h: number;
  if (mx === r) h = (g - b) / c;
  else if (mx === g) h = (b - r) / c + 2;
  else h = (r - g) / c + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** HSL to RGB (hue in degrees, any; saturation and lightness 0..1). */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (k0: number) => {
    const k = (((k0 + h / 30) % 12) + 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Lightness: mixed towards white (positive) or black (negative). */
const lighten = (v: number, l: number) => (l > 0 ? v + (1 - v) * l : l < 0 ? v * (1 + l) : v);

/** Hue/Saturation on an encoded colour in [0, 1]. */
export function hueSaturationEncoded(v: Rgb, s: HueSaturationSettings): Rgb {
  const mx = Math.max(v[0], v[1], v[2]);
  const mn = Math.min(v[0], v[1], v[2]);
  const L = (mx + mn) / 2;
  if (s.colorize) {
    const c = hslToRgb(s.colorizeHue, s.colorizeSaturation, L);
    return [lighten(c[0], s.master[2]), lighten(c[1], s.master[2]), lighten(c[2], s.master[2])];
  }
  const chroma = mx - mn;
  const hue = hueOf(v);
  const fade = Math.min(1, chroma / NEUTRAL_CHROMA);
  let [dh, ds, dl] = s.master;
  for (let i = 0; i < HUE_RANGES.length; i++) {
    const w = rangeWeight(hue, HUE_RANGES[i].centre) * fade;
    dh += w * s.ranges[i][0];
    ds += w * s.ranges[i][1];
    dl += w * s.ranges[i][2];
  }
  ds = clamp(ds, -1, 1);
  dl = clamp(dl, -1, 1);
  const S = chroma > 0 ? chroma / (1 - Math.abs(2 * L - 1)) : 0;
  let out: Rgb = [v[0], v[1], v[2]];
  if (dh !== 0 && chroma > 0) out = hslToRgb(hue + dh, S, L);
  // Saturation (Photoshop's): out from the lightness, by as much as takes the colour to full saturation at +100;
  // in towards it, to grey at −100.
  if (ds > 0 && S > 0) {
    const k = 1 / (ds + S >= 1 ? S : 1 - ds) - 1;
    out = out.map((c) => c + (c - L) * k) as Rgb;
  } else if (ds < 0) out = out.map((c) => L + (c - L) * (1 + ds)) as Rgb;
  return [lighten(out[0], dl), lighten(out[1], dl), lighten(out[2], dl)];
}

/** Hue/Saturation on a straight linear colour: worked on held to [0, 1], what was past it added back. */
export function hueSaturationPixel(rgb: readonly number[], s: HueSaturationSettings): Rgb {
  const inside = rgb.map((c) => clamp(c));
  const e = hueSaturationEncoded(inside.map(linearToSrgb) as Rgb, s);
  return [0, 1, 2].map((i) => srgbToLinear(clamp(e[i])) + (rgb[i] - inside[i])) as Rgb;
}

/** As an adjustment's reference: one premultiplied pixel. */
export function hueSaturationFor(params: Record<string, EffectParamValue>): (pixel: Pixel) => Pixel {
  const s = hueSaturationSettings(params);
  return ([r, g, b, a]) => {
    if (!(a > 0)) return [r, g, b, a];
    const out = hueSaturationPixel([r / a, g / a, b / a], s);
    return [out[0] * a, out[1] * a, out[2] * a, a];
  };
}

/** As a kernel filter's reference (a Smart Filter on a layer). */
export const hueSaturationReference: KernelReference = (params) => {
  const f = hueSaturationFor(params);
  return (_p, c) => f(c);
};
