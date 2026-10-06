/**
 * Glow (docs/photo/f4-light.md, "Glow"): a filter that adds a layer's bright light back to it, blurred at many
 * scales, in linear light. Version 1 is a definition in document pixels, the same wherever it's evaluated:
 *
 * 1. Contribution: each pixel's light, by a soft knee on its linear luminance (`contribution`).
 * 2. Six octaves, σⱼ = radius·2^−j / 2, weighted 0.8^j (normalised): octave j is the contribution box-reduced to
 *    level kⱼ of the document's pyramid (phase fixed at document pixel 0), blurred there by a Gaussian of
 *    σⱼ / 2^kⱼ texels (transparent outside), and read anywhere by a cubic B-spline on that level's grid.
 * 3. The light: 2^intensity × their sum, tinted, × mix, added to the layer; where the layer had no coverage the light
 *    gets `max(r, g, b)` (Unmult: D1), so it exports over any backdrop.
 *
 * The CPU reference is `../reference/glow.ts`; the GPU (`src/suites/photo/render/glow.ts`) follows these numbers.
 */
import { hexToLinear } from "../colour.ts";
import type { EffectParamValue } from "../types.ts";
import type { ColourParam, NumberParam, ParamSpec } from "./params.ts";

/** How many octaves. */
export const GLOW_OCTAVES = 6;
/** Each octave's weight is this times the one before (the video editor's Deep Glow falloff). */
export const GLOW_FALLOFF = 0.8;
/** An octave lives on the coarsest level where its σ is at least this many texels. */
export const GLOW_MIN_TEXELS = 1.5;
/** A Gaussian reaches this many σ. */
export const GLOW_SIGMAS = 3;
/** The B-spline's reach, in texels of its level. */
export const BSPLINE_REACH = 2;

export interface GlowParams {
  /** Document pixels. */
  radius: number;
  /** Stops. */
  intensity: number;
  /** Percent of white, in linear luminance. */
  threshold: number;
  /** Percent of the threshold the knee spans. */
  knee: number;
  /** sRGB "#rrggbb". */
  tint: string;
  /** Percent. */
  tintAmount: number;
  /** Percent. */
  mix: number;
}

export interface Octave {
  /** Its σ in document pixels. */
  sigma: number;
  /** The pyramid level it lives on. */
  level: number;
  /** Its σ in texels of that level. */
  texels: number;
  /** Its Gaussian's half-width in texels (taps at −taps..taps). */
  taps: number;
  /** Normalised: the weights sum to 1. */
  weight: number;
}

/** The octaves of a glow of `radius` document pixels. */
export function glowOctaves(radius: number): Octave[] {
  const raw = Array.from({ length: GLOW_OCTAVES }, (_, j) => GLOW_FALLOFF ** j);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w, j) => {
    const sigma = (radius * 2 ** -j) / 2;
    const level = Math.max(0, Math.floor(Math.log2(sigma / GLOW_MIN_TEXELS)));
    const texels = sigma / 2 ** level;
    return { sigma, level, texels, taps: Math.ceil(GLOW_SIGMAS * texels), weight: w / total };
  });
}

/** How far an octave reaches from a pixel of its input, in document pixels (its Gaussian, then the B-spline). */
export const octaveReach = (o: Octave) => (o.taps + BSPLINE_REACH + 1) * 2 ** o.level;

/** How far the glow reaches past its layer's pixels, in document pixels. */
export const glowReach = (radius: number) => Math.max(...glowOctaves(radius).map(octaveReach));

/** Linear-light luminance (sRGB / Rec. 709 weights). */
export const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** How much of a pixel glows: 0 below the knee, 1 from the threshold, smoothstep between, on linear luminance. */
export function contributionWeight(y: number, threshold: number, knee: number): number {
  const hi = threshold;
  const lo = threshold * (1 - knee);
  if (y >= hi) return 1;
  if (y <= lo) return 0;
  const t = (y - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

/** A premultiplied pixel's contribution (premultiplied rgb): its light where its unassociated colour is bright enough. */
export function contribution(r: number, g: number, b: number, a: number, threshold: number, knee: number): [number, number, number] {
  if (!(a > 0)) return [0, 0, 0];
  const k = contributionWeight(luminance(r / a, g / a, b / a), threshold, knee);
  return [r * k, g * k, b * k];
}

/** The cubic B-spline's weight at distance `x` (in texels): smooth, positive, summing to 1. */
export function bspline(x: number): number {
  const t = Math.abs(x);
  if (t < 1) return (4 - 6 * t * t + 3 * t * t * t) / 6;
  if (t < 2) return ((2 - t) ** 3) / 6;
  return 0;
}

/** The glow's numbers, as the GPU and the reference use them. */
export interface GlowShape {
  octaves: Octave[];
  threshold: number;
  knee: number;
  /** 2^intensity × mix. */
  gain: number;
  /** The tint, linear, normalised to its largest channel. */
  tint: [number, number, number];
  tintAmount: number;
}

export function glowShape(p: GlowParams): GlowShape {
  const lin = hexToLinear(p.tint);
  const top = Math.max(...lin, 1e-6);
  return {
    octaves: glowOctaves(p.radius),
    threshold: p.threshold / 100,
    knee: p.knee / 100,
    gain: 2 ** p.intensity * (p.mix / 100),
    tint: [lin[0] / top, lin[1] / top, lin[2] / top],
    tintAmount: p.tintAmount / 100,
  };
}

/** The light from the octaves' weighted sum `s` (premultiplied rgb): tinted and scaled. */
export function glowLight(s: readonly [number, number, number], shape: GlowShape): [number, number, number] {
  const y = luminance(s[0], s[1], s[2]);
  const t = shape.tintAmount;
  return [0, 1, 2].map((c) => (s[c] * (1 - t) + shape.tint[c] * y * t) * shape.gain) as [number, number, number];
}

/** The layer's pixel with light added: rgb added, and the light's coverage (`max`, held to 1) where it had none. */
export function addLight(pixel: readonly [number, number, number, number], light: readonly [number, number, number]): [number, number, number, number] {
  const [r, g, b, a] = pixel;
  const coverage = Math.min(1, Math.max(0, light[0], light[1], light[2]));
  return [r + light[0], g + light[1], b + light[2], a + coverage * (1 - a)];
}

const n = (params: Record<string, EffectParamValue>, key: string) => params[key] as number;

export const glowParamsOf = (params: Record<string, EffectParamValue>): GlowParams => ({
  radius: n(params, "radius"),
  intensity: n(params, "intensity"),
  threshold: n(params, "threshold"),
  knee: n(params, "knee"),
  tint: params.tint as string,
  tintAmount: n(params, "tintAmount"),
  mix: n(params, "mix"),
});

const number = (key: string, label: string, unit: string, min: number, max: number, step: number, decimals: number, def: number, description: string): NumberParam => ({
  kind: "number",
  key,
  label,
  unit,
  min,
  max,
  step,
  decimals,
  default: def,
  description,
});

const tint: ColourParam = { kind: "colour", key: "tint", label: "Tint", default: "#ffb070", description: "The colour the glow takes as Tint Amount rises (its brightness is kept)." };

export const GLOW_PARAMS: readonly ParamSpec[] = [
  number("radius", "Radius", "px", 1, 4000, 1, 0, 60, "How far the light spreads, in document pixels: the widest of its six scales. Large radii make a soft haze; small ones a tight bloom."),
  number("intensity", "Intensity", "stops", -6, 6, 0.01, 2, 0, "How bright the glow is, in stops: each one doubles it."),
  number("threshold", "Threshold", "%", 0, 400, 1, 0, 75, "How bright light must be to glow, as a percentage of white in linear light (above 100%: only light brighter than white, from Exposure or another glow)."),
  number("knee", "Knee", "%", 0, 100, 1, 0, 25, "How softly light starts to glow below the threshold: 0 is a hard cut, 100% fades in from black."),
  tint,
  number("tintAmount", "Tint Amount", "%", 0, 100, 1, 0, 0, "How much the glow takes the tint's colour instead of the light's own."),
  number("mix", "Mix", "%", 0, 100, 1, 0, 100, "How much of the glow is added: 0 adds none."),
];
