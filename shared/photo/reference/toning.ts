/**
 * Dodge, Burn and Sponge (docs/photo/tools/toning.md): what a toning stroke does to a pixel, given how much of it
 * the stroke has reached (`amount`, 0..1: the stroke's coverage times its Exposure, or its Flow's build-up). The CPU
 * reference the GPU's apply pass is held to (`render/brush-effects.ts`, `TONE_WGSL`): change both.
 *
 * Pixels are premultiplied linear light (the surfaces'); the tools work on straight sRGB-encoded colour, as
 * Photoshop's do on 8-bit RGB values. Masks are one grey value, as stored (`strokeColour`'s grey).
 */
import { linearToSrgb, srgbToLinear } from "../colour.ts";

export type ToneRange = "shadows" | "midtones" | "highlights";
export type SpongeMode = "desaturate" | "saturate";

/** What a toning stroke does, whatever its amount. */
export type ToneEffect =
  | { tool: "dodge" | "burn"; range: ToneRange; protect: boolean }
  | { tool: "sponge"; mode: SpongeMode; vibrance: boolean };

export type Rgba = [number, number, number, number];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The range's curve on an encoded value in [0, 1], `a` the amount (0..1). Without Protect Tones, GIMP's Dodge/Burn
 * (the published imitation of Photoshop's older tool); with it, the two that clip are replaced by curves that keep 0
 * and 1 where they are (Dodge Highlights, Burn Shadows). Every curve is monotonic for a in [0, 1].
 */
export function toneCurve(tool: "dodge" | "burn", range: ToneRange, protect: boolean, x: number, a: number): number {
  if (a <= 0) return x;
  if (tool === "dodge") {
    if (range === "shadows") return x + (a / 3) * (1 - x);
    if (range === "midtones") return Math.pow(x, 1 / (1 + a));
    return protect ? x + a * x * x * (1 - x) : x * (1 + a / 3);
  }
  if (range === "highlights") return x * (1 - a / 3);
  if (range === "midtones") return Math.pow(x, 1 + a / 3);
  if (protect) return x - a * x * (1 - x) * (1 - x);
  const c = a / 3;
  return x < c ? 0 : (x - c) / (1 - c);
}

/** A curve on any value: what's inside [0, 1] curved, what's outside (light past white, out-of-gamut colour) kept. */
const curved = (f: (x: number) => number, x: number) => {
  const c = clamp01(x);
  return f(c) + (x - c);
};

/** Rec. 709 luminance of linear light. */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Rec. 601 luma of encoded values: the grey Sponge moves colours to and from (as a mask's grey is made). */
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Dodge or Burn on straight linear colour (alpha aside). */
function toneColour(effect: Extract<ToneEffect, { tool: "dodge" | "burn" }>, c: [number, number, number], a: number): [number, number, number] {
  const f = (x: number) => toneCurve(effect.tool, effect.range, effect.protect, x, a);
  if (!effect.protect) return c.map((v) => srgbToLinear(curved(f, linearToSrgb(v)))) as [number, number, number];
  // Protect Tones: the curve moves the lightness; the colour keeps its chromaticity (scaled in linear light).
  const L = luminance(c[0], c[1], c[2]);
  const target = srgbToLinear(curved(f, linearToSrgb(L)));
  let out: [number, number, number] = L > 1e-6 ? [c[0] * (target / L), c[1] * (target / L), c[2] * (target / L)] : [c[0] + target - L, c[1] + target - L, c[2] + target - L];
  // A channel past white (and past where it was): desaturated towards the luminance just enough, so nothing clips.
  const limit = Math.max(1, c[0], c[1], c[2]);
  const m = Math.max(out[0], out[1], out[2]);
  if (m > limit && target < limit) {
    const t = (limit - target) / (m - target);
    out = [target + (out[0] - target) * t, target + (out[1] - target) * t, target + (out[2] - target) * t];
  }
  return out;
}

/** Sponge on straight encoded colour. */
function spongeColour(effect: Extract<ToneEffect, { tool: "sponge" }>, e: [number, number, number], a: number): [number, number, number] {
  const k = [clamp01(e[0]), clamp01(e[1]), clamp01(e[2])];
  const y = luma(k[0], k[1], k[2]);
  const max = Math.max(k[0], k[1], k[2]);
  const s = max > 0 ? (max - Math.min(k[0], k[1], k[2])) / max : 0;
  let factor: number;
  if (effect.mode === "desaturate") factor = 1 - a * (effect.vibrance ? (1 + s) / 2 : 1);
  else {
    factor = 1 + a * (effect.vibrance ? 1 - s : 1);
    if (effect.vibrance) {
      // No channel leaves [0, 1]: the most the colour can move away from its grey.
      for (const v of e) {
        const d = v - y;
        if (d > 1e-9) factor = Math.min(factor, Math.max(1, (1 - y) / d));
        else if (d < -1e-9) factor = Math.min(factor, Math.max(1, y / -d));
      }
    }
  }
  const out = e.map((v) => y + (v - y) * factor) as [number, number, number];
  return effect.mode === "saturate" && !effect.vibrance ? (out.map((v, i) => (e[i] >= 0 && e[i] <= 1 ? clamp01(v) : v)) as [number, number, number]) : out;
}

/** A pixel (premultiplied linear RGBA) toned by `amount` (0..1). Alpha never changes; a transparent pixel stays. */
export function tonePixel(effect: ToneEffect, pixel: Readonly<Rgba>, amount: number): Rgba {
  const alpha = pixel[3];
  const a = clamp01(amount);
  if (!(alpha > 0) || a <= 0) return [...pixel] as Rgba;
  const straight: [number, number, number] = [pixel[0] / alpha, pixel[1] / alpha, pixel[2] / alpha];
  let out: [number, number, number];
  if (effect.tool === "sponge") {
    const encoded = straight.map(linearToSrgb) as [number, number, number];
    out = spongeColour(effect, encoded, a).map(srgbToLinear) as [number, number, number];
  } else out = toneColour(effect, straight, a);
  return [out[0] * alpha, out[1] * alpha, out[2] * alpha, alpha];
}

/** A mask's value (its grey as stored) toned: Dodge and Burn by the range's curve, Sponge as contrast around 0.5. */
export function toneMask(effect: ToneEffect, value: number, amount: number): number {
  const a = clamp01(amount);
  if (a <= 0) return value;
  if (effect.tool === "sponge") return clamp01(0.5 + (value - 0.5) * (effect.mode === "saturate" ? 1 + a : 1 - a));
  return clamp01(toneCurve(effect.tool, effect.range, effect.protect, clamp01(value), a));
}

/** Dabs a toning stroke lays every this much of the brush's diameter (the Brush's spacing). */
export const TONE_SPACING = 0.1;

/**
 * What one dab adds to a stroke's coverage at full brush coverage, for a rate of `rate` per pass: a pixel under a
 * stroke's middle is reached by 1 / spacing dabs, each covering it by the brush's profile there, on average
 * `h + (1 − h)/2` for hardness `h` (the falloff is a smoothstep, half its band), so
 * `1 − (1 − rate)^(spacing / that)` makes one pass add `rate`, whatever the brush's hardness.
 */
export function dabRate(rate: number, hardness = 1, spacing = TONE_SPACING): number {
  const h = clamp01(hardness);
  return 1 - Math.pow(1 - clamp01(rate), spacing / (h + (1 - h) / 2));
}

/** Airbrush: what a single pass reaches of the Exposure (holding still builds the rest). */
export const AIRBRUSH_PASS = 0.5;

/** Airbrush's dabs laid where the pointer rests, a second. */
export const AIRBRUSH_RATE = 20;

/**
 * A stroke's dabs and ceiling, Photoshop's way: Dodge and Burn cap a stroke at their Exposure (each dab covers all it
 * reaches, so scrubbing adds nothing; Airbrush builds to it); Sponge's Flow is a rate, so a stroke keeps adding up to
 * the full change.
 */
export function strokeLaw(effect: ToneEffect, strength: number, airbrush: boolean, hardness = 1): { dab: number; cap: number } {
  const s = clamp01(strength);
  if (effect.tool === "sponge") return { dab: dabRate(s, hardness), cap: 1 };
  return { dab: airbrush ? dabRate(AIRBRUSH_PASS, hardness) : 1, cap: s };
}
