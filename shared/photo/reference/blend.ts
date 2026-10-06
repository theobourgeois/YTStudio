/**
 * Blend modes and Blending Options, the CPU reference (docs/photo/layer-style/README.md, phase L1). The GPU's blend
 * pass (`src/suites/photo/render/blend.ts`) runs the same steps and is tested against this; this is tested against
 * what Photoshop 27.11 rendered (`blend.test.ts`, from photoshop-measurements.md).
 *
 * A layer meets what's below it in the document's compositing: "photoshop" works on sRGB-encoded values, as
 * Photoshop does (measured: modes, opacity and soft edges alike), "linear" on linear light. Pixels in and out are
 * premultiplied linear light either way.
 */
import { SPECIAL_FILL } from "../blending.ts";
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import { hash2 } from "../output.ts";
import type { BlendIf, BlendMode, BlendRange, Compositing } from "../types.ts";

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

// --- the modes, on straight colour in the blend's domain ---

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lum = (c: Rgb) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColour(c: Rgb): Rgb {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / Math.max(l - n, 1e-12)) as Rgb;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / Math.max(x - l, 1e-12)) as Rgb;
  return out;
}

const setLum = (c: Rgb, l: number): Rgb => {
  const d = l - lum(c);
  return clipColour([c[0] + d, c[1] + d, c[2] + d]);
};

const sat = (c: Rgb) => Math.max(...c) - Math.min(...c);

function setSat(c: Rgb, s: number): Rgb {
  const mx = Math.max(...c);
  const mn = Math.min(...c);
  if (mx <= mn) return [0, 0, 0];
  // W3C's: the largest channel becomes s, the smallest 0, the middle one in proportion.
  return c.map((v) => (v === mx ? s : v === mn ? 0 : ((v - mn) * s) / (mx - mn))) as Rgb;
}

/**
 * How near 0 or 1 counts as there for the modes' special cases: values come back from encoding and decoding (and
 * f16 on the GPU) a hair off, and an 8-bit step is 4 × 10⁻³.
 */
export const EDGE = 1e-4;

const colorBurn = (b: number, s: number) => (b >= 1 - EDGE ? 1 : s <= EDGE ? 0 : 1 - Math.min(1, (1 - b) / s));
const colorDodge = (b: number, s: number) => (b <= EDGE ? 0 : s >= 1 - EDGE ? 1 : Math.min(1, b / (1 - s)));
const hardLight = (b: number, s: number) => (s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1)));

/** W3C's Soft Light (measured: Photoshop's is this one, not the formula usually quoted for it). */
function softLight(b: number, s: number) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

/** Vivid Light: a burn by 2s below ½, a dodge by 2s − 1 above; the layer's 0 and 1 win (measured). */
function vividLight(b: number, s: number) {
  if (s <= EDGE) return 0;
  if (s >= 1 - EDGE) return 1;
  return s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * s - 1);
}

/** How close to b + s = 1 Hard Mix's tie is (a quarter of an 8-bit step: values pass through f16 on the way). */
export const HARD_MIX_TIE = 0.25 / 255;

/** Hard Mix at 100%: white past the diagonal; on it, white only over a backdrop above ½ (measured). */
function hardMix(b: number, s: number) {
  const sum = b + s;
  if (Math.abs(sum - 1) < HARD_MIX_TIE) return b > 0.5 ? 1 : 0;
  return sum > 1 ? 1 : 0;
}

/** Modes that work on any value, so light above white and colours outside sRGB go through them unclamped. */
const UNBOUNDED: ReadonlySet<BlendMode> = new Set(["normal", "dissolve", "darken", "lighten", "multiply", "screen", "linear-dodge", "difference", "subtract", "darker-color", "lighter-color"]);

/**
 * A separable mode on one channel at Fill `fill` (it only matters for the special eight: their Fill pulls the
 * layer towards the mode's neutral first; measured).
 */
function channel(mode: BlendMode, b: number, s: number, fill: number): number {
  switch (mode) {
    case "darken":
      return Math.min(b, s);
    case "multiply":
      return b * s;
    case "color-burn":
      return colorBurn(b, 1 - fill * (1 - s));
    case "linear-burn":
      return b - fill * (1 - s);
    case "lighten":
      return Math.max(b, s);
    case "screen":
      return b + s - b * s;
    case "color-dodge":
      return colorDodge(b, fill * s);
    case "linear-dodge":
      return b + fill * s;
    case "overlay":
      return hardLight(s, b);
    case "soft-light":
      return softLight(b, s);
    case "hard-light":
      return hardLight(b, s);
    case "vivid-light":
      return vividLight(b, 0.5 + fill * (s - 0.5));
    case "linear-light":
      return b + fill * (2 * s - 1);
    case "pin-light":
      return s <= 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
    case "hard-mix":
      // Under Fill it's a ramp, steeper as Fill grows, that becomes the threshold at 100% (measured).
      return fill >= 1 ? hardMix(b, s) : clamp((b - fill * (1 - s)) / (1 - fill));
    case "difference":
      return Math.abs(b - fill * s);
    case "exclusion":
      return b + s - 2 * b * s;
    case "subtract":
      return b - s;
    case "divide":
      return s <= EDGE ? (b <= EDGE ? 0 : 1) : b / s;
    default:
      return s;
  }
}

/**
 * The mode's colour `B(b, s)` at Fill `fill`, on straight colour in the blend's domain. Its result never leaves
 * [0, 1] further than its inputs did: within sRGB it clamps as Photoshop's does; light above white stays light.
 */
export function blendColour(mode: BlendMode, backdrop: Rgb, layer: Rgb, fill = 1): Rgb {
  const bounded = !UNBOUNDED.has(mode);
  const b = bounded ? (backdrop.map((v) => clamp(v)) as Rgb) : backdrop;
  const s = bounded ? (layer.map((v) => clamp(v)) as Rgb) : layer;
  let out: Rgb;
  switch (mode) {
    case "hue":
      out = setLum(setSat(s, sat(b)), lum(b));
      break;
    case "saturation":
      out = setLum(setSat(b, sat(s)), lum(b));
      break;
    case "color":
      out = setLum(s, lum(b));
      break;
    case "luminosity":
      out = setLum(b, lum(s));
      break;
    case "darker-color":
      out = lum(s) < lum(b) ? s : b;
      break;
    case "lighter-color":
      out = lum(s) > lum(b) ? s : b;
      break;
    default:
      out = [0, 1, 2].map((i) => channel(mode, b[i], s[i], SPECIAL_FILL.has(mode) ? fill : 1)) as Rgb;
  }
  return out.map((v, i) => clamp(v, Math.min(0, b[i], s[i]), Math.max(1, b[i], s[i]))) as Rgb;
}

// --- Blend If ---

/** One range's pass on a 0..255 value: Photoshop's, both ends of a split handle inside the ramp (research: advanced-blending.md). */
export function rangePass(r: BlendRange, v: number): number {
  const [bl, bh, wl, wh] = r;
  const low = clamp((v - bl + 1) / (bh - bl + 1));
  const high = clamp((wh - v + 1) / (wh - wl + 1));
  return Math.min(low, high);
}

/** Blend If's values: a straight encoded colour as 0..255 numbers, Gray weighted as Photoshop's (0.299, 0.590, 0.111). */
function blendIfValues(c: Rgb): Record<"gray" | "red" | "green" | "blue", number> {
  const v = c.map((x) => clamp(x) * 255) as Rgb;
  return { gray: 0.299 * v[0] + 0.59 * v[1] + 0.111 * v[2], red: v[0], green: v[1], blue: v[2] };
}

/**
 * Blend If's gate on coverage: This Layer's ranges on the layer's straight colour, Underlying Layer's on the
 * backdrop's (whose transparent part always passes). Colours are encoded, whatever the compositing.
 */
export function blendIfGate(blendIf: BlendIf, layerEncoded: Rgb, backdropEncoded: Rgb, backdropAlpha: number): number {
  const s = blendIfValues(layerEncoded);
  const d = blendIfValues(backdropEncoded);
  let gThis = 1;
  let gUnder = 1;
  for (const entry of ["gray", "red", "green", "blue"] as const) {
    const e = blendIf[entry];
    if (!e) continue;
    gThis *= rangePass(e.layer, s[entry]);
    gUnder *= rangePass(e.underlying, d[entry]);
  }
  return gThis * (1 - backdropAlpha + backdropAlpha * gUnder);
}

// --- a layer onto what's below ---

export interface BlendParams {
  mode: BlendMode;
  /** 0..1. */
  opacity: number;
  fill: number;
  channels: { r: boolean; g: boolean; b: boolean };
  blendIf: BlendIf;
  compositing: Compositing;
  /** Dissolve's pixel and seed: its speckle is fixed in document pixels. Absent: Dissolve draws as Normal. */
  dissolveAt?: { x: number; y: number; seed: number };
}

const enc = (v: number) => linearToSrgb(v);
const dec = (v: number) => srgbToLinear(v);

/** A premultiplied linear pixel as straight colour in the compositing's domain, and its alpha. */
function toDomain(p: Rgba, encoded: boolean): { c: Rgb; a: number } {
  const a = clamp(p[3]);
  if (a <= 0) return { c: [0, 0, 0], a: 0 };
  const c = [p[0] / a, p[1] / a, p[2] / a] as Rgb;
  return { c: encoded ? (c.map(enc) as Rgb) : c, a };
}

function fromDomain(c: Rgb, a: number, encoded: boolean): Rgba {
  if (a <= 0) return [0, 0, 0, 0];
  const lin = encoded ? c.map(dec) : c;
  return [lin[0] * a, lin[1] * a, lin[2] * a, a];
}

/** Dissolve's threshold at a document pixel: uniform in [0, 1), the output dither's hash salted by the layer. */
export function dissolveThreshold(x: number, y: number, seed: number): number {
  return (hash2(x, (y ^ seed) >>> 0) >>> 8) / 16777216;
}

/**
 * A layer's pixel onto the backdrop's (both premultiplied linear; the layer's alpha already has its mask): Blend
 * If gates its coverage, Fill and Opacity weigh it (Fill inside the mode for the special eight), the mode makes
 * the colour where there's backdrop (W3C's mixing), excluded channels keep the backdrop's. Returns premultiplied
 * linear.
 */
export function compositePixel(backdrop: Rgba, layer: Rgba, p: BlendParams): Rgba {
  const encoded = p.compositing === "photoshop";
  const B = toDomain(backdrop, encoded);
  const S = toDomain(layer, encoded);
  const gate = Object.keys(p.blendIf).length ? blendIfGate(p.blendIf, encoded ? S.c : (S.c.map(enc) as Rgb), encoded ? B.c : (B.c.map(enc) as Rgb), B.a) : 1;
  let mode = p.mode;
  let coverage = S.a * gate;
  let opacity = p.opacity;
  let fill = p.fill;
  if (mode === "dissolve") {
    mode = "normal";
    if (p.dissolveAt) {
      const kept = dissolveThreshold(p.dissolveAt.x, p.dissolveAt.y, p.dissolveAt.seed) < coverage * fill * opacity;
      coverage = kept ? 1 : 0;
      opacity = 1;
      fill = 1;
    }
  }
  const special = SPECIAL_FILL.has(mode);
  // The colour where there's backdrop; the layer's own where there isn't.
  const mixed = blendColour(mode, B.c, S.c, special ? fill : 1);
  const weight = coverage * opacity * (special ? 1 : fill);
  const added = coverage * fill * opacity;
  const alpha = added + B.a * (1 - added);
  const premult = [0, 1, 2].map((i) => S.c[i] * added * (1 - B.a) + mixed[i] * weight * B.a + B.c[i] * B.a * (1 - weight));
  const keep = [p.channels.r, p.channels.g, p.channels.b];
  for (let i = 0; i < 3; i++) if (!keep[i]) premult[i] = B.c[i] * B.a;
  if (alpha <= 0) return [0, 0, 0, 0];
  return fromDomain([premult[0] / alpha, premult[1] / alpha, premult[2] / alpha], alpha, encoded);
}

/**
 * An adjustment layer's result onto what it adjusted: it never changes alpha. Its mode blends the adjusted colour
 * with the original (Curves in Luminosity, say); its mask, Opacity and Blend If (This Layer on the adjusted colour,
 * Underlying on the original) say how much.
 */
export function compositeAdjustment(original: Rgba, adjusted: Rgba, mask: number, p: BlendParams): Rgba {
  const encoded = p.compositing === "photoshop";
  const B = toDomain(original, encoded);
  if (B.a <= 0) return original;
  const S = toDomain([adjusted[0], adjusted[1], adjusted[2], original[3]], encoded);
  const gate = Object.keys(p.blendIf).length ? blendIfGate(p.blendIf, encoded ? S.c : (S.c.map(enc) as Rgb), encoded ? B.c : (B.c.map(enc) as Rgb), 1) : 1;
  const mode = p.mode === "dissolve" ? "normal" : p.mode;
  const special = SPECIAL_FILL.has(mode);
  const mixed = blendColour(mode, B.c, S.c, special ? p.fill : 1);
  const k = clamp(mask * gate * p.opacity * (special ? 1 : p.fill));
  const keep = [p.channels.r, p.channels.g, p.channels.b];
  const c = [0, 1, 2].map((i) => (keep[i] ? B.c[i] + (mixed[i] - B.c[i]) * k : B.c[i])) as Rgb;
  return fromDomain(c, B.a, encoded);
}
