/**
 * Camera Raw's Color Mixer and Color Grading (docs/photo/camera-raw.md, "CR3"), as fitted to CR0's runs:
 * - the Mixer on HSV of encoded ProPhoto (Camera Raw's hue bands, centred at 0°, 30°, 60°, 120°, 180°, 240°, 270°,
 *   300°, a colour shared by its two nearest), hue turned and saturation scaled, then HSL lightness moved;
 * - Grading in OKLab: each wheel's tint a move of a and b along its hue, its Luminance one of L, by how much of the
 *   wheel's tones a pixel is (`GRADING_MASKS`, measured at Blending 100; Blending narrows them, Balance moves them).
 * The GPU reads the same numbers from its table (`colourBlock`).
 */
import type { EffectParamValue } from "../../types.ts";
import { GRADING_LEVELS, GRADING_MASKS, MIXER_STRENGTH } from "./measured.ts";
import { GRADING_WHEELS, MIXER_COLOURS } from "./params.ts";

export type Rgb = [number, number, number];

/** The Mixer's band centres (degrees of hue). */
export const MIXER_CENTRES = [0, 30, 60, 120, 180, 240, 270, 300] as const;

/** Each band's hue turn (degrees), saturation scale and lightness move, for these settings. */
export function mixerBands(p: Record<string, EffectParamValue>): { hue: number[]; saturation: number[]; luminance: number[] } | null {
  const at = (kind: "hue" | "saturation" | "luminance", i: number) => {
    const v = ((p[`${kind}${MIXER_COLOURS[i]}`] as number | undefined) ?? 0) / 100;
    const [down, up] = MIXER_STRENGTH[kind][i];
    return v * (v < 0 ? down : up);
  };
  const out = { hue: [] as number[], saturation: [] as number[], luminance: [] as number[] };
  for (let i = 0; i < 8; i++) {
    out.hue.push(at("hue", i));
    out.saturation.push(at("saturation", i));
    out.luminance.push(at("luminance", i));
  }
  return [...out.hue, ...out.saturation, ...out.luminance].some((v) => v !== 0) ? out : null;
}

/** A hue's two bands and their shares. */
function bandsOf(h: number): [number, number, number] {
  for (let i = 0; i < 8; i++) {
    const a = MIXER_CENTRES[i];
    const b = i === 7 ? 360 : MIXER_CENTRES[i + 1];
    if (h >= a && h < b) return [i, (i + 1) % 8, (h - a) / (b - a)];
  }
  return [0, 1, 0];
}

function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

function hsvToRgb([h, s, v]: Rgb): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const i = Math.floor(hh);
  const [r, g, b] = i === 0 ? [c, x, 0] : i === 1 ? [x, c, 0] : i === 2 ? [0, c, x] : i === 3 ? [0, x, c] : i === 4 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** The Mixer on encoded ProPhoto (0..1 inside; what's past it rides along). */
export function mix(e: Rgb, bands: { hue: number[]; saturation: number[]; luminance: number[] }): Rgb {
  const c = e.map((v) => Math.max(0, Math.min(1, v))) as Rgb;
  const [h, s, v] = rgbToHsv(c);
  const [i, j, t] = bandsOf(h);
  const share = (arr: number[]) => arr[i] * (1 - t) + arr[j] * t;
  let rgb = hsvToRgb([h + share(bands.hue), Math.max(0, Math.min(1, s * (1 + share(bands.saturation)))), v]);
  const dl = share(bands.luminance);
  if (dl !== 0) {
    // HSL lightness moved by the band's share, as much as the colour is saturated (greys don't move).
    const max = Math.max(...rgb);
    const min = Math.min(...rgb);
    const L = (max + min) / 2;
    const S = max === min ? 0 : L > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    const L2 = Math.max(0, Math.min(1, L + dl * S * 0.5));
    // The same hue and HSL saturation at the new lightness.
    const q = L2 < 0.5 ? L2 * (1 + S) : L2 + S - L2 * S;
    const p = 2 * L2 - q;
    const scale = max > min ? (q - p) / (max - min) : 0;
    rgb = max > min ? (rgb.map((x) => p + (x - min) * scale) as Rgb) : [L2, L2, L2];
  }
  return [rgb[0] + (e[0] - c[0]), rgb[1] + (e[1] - c[1]), rgb[2] + (e[2] - c[2])];
}

// --- grading ---

const M1 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const;
const M2 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
] as const;
const M2_INV = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
] as const;
const M1_INV = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;
const apply3 = (m: readonly (readonly number[])[], v: readonly number[]): Rgb => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]) as Rgb;

/** OKLab from linear sRGB, and back. */
export const toOklab = (rgb: readonly number[]): Rgb => apply3(M2, apply3(M1, rgb).map(Math.cbrt));
export const fromOklab = (lab: readonly number[]): Rgb => apply3(M1_INV, apply3(M2_INV, lab).map((v) => v * v * v));

/** The OKLab a/b direction of a hue (Camera Raw's degrees: an HSV hue of sRGB). */
export function hueDirection(degrees: number): [number, number] {
  const [r, g, b] = hsvToRgb([degrees, 1, 1]);
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [, a, bb] = toOklab([lin(r), lin(g), lin(b)]);
  const n = Math.hypot(a, bb) || 1;
  return [a / n, bb / n];
}

/** Each wheel's tint (a, b move at full mask), its Luminance (−1..1), and how Blending and Balance shape the masks. */
export interface Grading {
  wheels: { a: number; b: number; luminance: number }[];
  /** How much narrower than the measured masks (Blending 100) each region is. */
  narrow: number;
  /** How far Balance moves the shadows' and highlights' masks along L, and how it weights them. */
  shift: number;
  balance: number;
}

export function grading(p: Record<string, EffectParamValue>): Grading | null {
  const num = (k: string, d = 0) => (p[k] as number | undefined) ?? d;
  const wheels = GRADING_WHEELS.map((w) => {
    const sat = num(`${w}Saturation`) / 100;
    const [a, b] = sat > 0 ? hueDirection(num(`${w}Hue`)) : [0, 0];
    return { a: a * sat, b: b * sat, luminance: num(`${w}Luminance`) / 100 };
  });
  if (wheels.every((w) => w.a === 0 && w.b === 0 && w.luminance === 0)) return null;
  const balance = num("gradingBalance") / 100;
  return { wheels, narrow: 0.5 * (1 - num("gradingBlending", 50) / 100), shift: -0.2 * balance, balance };
}

/** A measured table (over `GRADING_LEVELS`) at lightness L. */
function maskAt(table: readonly number[], L: number): number {
  const lv = GRADING_LEVELS;
  if (L <= lv[0]) return table[0];
  if (L >= lv[lv.length - 1]) return table[table.length - 1];
  let lo = 0;
  let hi = lv.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lv[mid] <= L) lo = mid;
    else hi = mid;
  }
  return table[lo] + ((table[hi] - table[lo]) * (L - lv[lo])) / (lv[hi] - lv[lo]);
}

/** Where wheel `w`'s measured masks are read for lightness L (Blending narrows them towards their region, Balance moves them). */
export function wheelLightness(w: number, L: number, g: Grading): number {
  const k = 1 + g.narrow;
  if (w === 0) return L * k - g.shift;
  if (w === 1) return 0.6 + (L - 0.6) * k;
  if (w === 2) return 1 - (1 - L) * k - g.shift;
  return L;
}

/** How Balance weights a wheel. */
export const wheelWeight = (w: number, g: Grading) => (w === 0 ? 1 - 0.5 * g.balance : w === 2 ? 1 + 0.5 * g.balance : 1);

/** Color Grading on linear sRGB. */
export function grade(rgb: Rgb, g: Grading): Rgb {
  const [L, a, b] = toOklab(rgb.map((v) => Math.max(0, v)));
  let [L2, a2, b2] = [L, a, b];
  GRADING_WHEELS.forEach((name, w) => {
    const wheel = g.wheels[w];
    if (wheel.a === 0 && wheel.b === 0 && wheel.luminance === 0) return;
    const at = wheelLightness(w, L, g);
    const weight = wheelWeight(w, g);
    const masks = GRADING_MASKS[name];
    const tint = maskAt(masks.tint, at) * weight;
    a2 += wheel.a * tint;
    b2 += wheel.b * tint;
    if (wheel.luminance !== 0) L2 += Math.abs(wheel.luminance) * maskAt(wheel.luminance < 0 ? masks.darker : masks.lighter, at) * weight;
  });
  return fromOklab([L2, a2, b2]);
}

/**
 * The GPU's copy of these settings (and the measured masks), in the table: the Mixer's 24, then 4 per wheel (a, b,
 * luminance, unused), then the levels and each wheel's three masks.
 */
export const COLOUR_BLOCK_SIZE = 24 + 16 + GRADING_LEVELS.length * 13;

export function colourBlock(p: Record<string, EffectParamValue>): Float32Array {
  const block = new Float32Array(COLOUR_BLOCK_SIZE);
  const bands = mixerBands(p);
  if (bands) block.set([...bands.hue, ...bands.saturation, ...bands.luminance], 0);
  const g = grading(p);
  if (g) g.wheels.forEach((w, i) => block.set([w.a, w.b, w.luminance, 0], 24 + i * 4));
  let at = 40;
  block.set(GRADING_LEVELS, at);
  at += GRADING_LEVELS.length;
  for (const name of GRADING_WHEELS) {
    for (const table of [GRADING_MASKS[name].tint, GRADING_MASKS[name].darker, GRADING_MASKS[name].lighter]) {
      block.set(table, at);
      at += table.length;
    }
  }
  return block;
}
