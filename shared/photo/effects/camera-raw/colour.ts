/**
 * Camera Raw's Color Mixer and Color Grading (docs/photo/camera-raw.md, "CR3"), as fitted to CR0's runs:
 * - the Mixer on HSV of encoded ProPhoto (Camera Raw's hue bands, centred at 0°, 30°, 60°, 120°, 180°, 240°, 270°,
 *   300°, a colour shared by its two nearest), hue turned and saturation scaled, then HSL lightness moved;
 * - Grading in stops of linear ProPhoto: a wheel's tint raises its hue's channels and lowers the others (HSV of its hue,
 *   by the same stops for every hue, as Camera Raw's do), its Luminance all three, by how much of the wheel's
 *   tones a pixel is (`GRADING_MASKS` over OKLab lightness, measured at Blending 100; Blending narrows them, Balance
 *   moves them).
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
const M2_L = [0.2104542553, 0.793617785, -0.0040720468] as const;

/** OKLab's lightness of linear sRGB (where the grading's masks are read). */
export function oklabLightness(rgb: readonly number[]): number {
  const lms = M1.map((row) => Math.cbrt(Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2])));
  return M2_L[0] * lms[0] + M2_L[1] * lms[1] + M2_L[2] * lms[2];
}

/**
 * Each wheel's tint (how much each channel is raised, `up`, and lowered, `down`: its hue's colour and the rest, times
 * the saturation), its Luminance (−1..1), and how Blending and Balance shape the masks.
 */
export interface Grading {
  wheels: { up: Rgb; down: Rgb; luminance: number }[];
  /** How much narrower than the measured masks (Blending 100) the shadows' and highlights' regions are (midtones' the mean). */
  narrowShadows: number;
  narrowHighlights: number;
  /** Balance (−1..1). */
  balance: number;
}

/**
 * How Blending and Balance shape the masks (fitted to Camera Raw's Blending 0 and Balance ±100 runs): Blending 0
 * narrows the shadows' and highlights' regions, Balance hands the tones to one of them: towards +100 the highlights'
 * region reaches down and strengthens while the shadows' fades (towards −100 the reverse).
 */
export const GRADING_SHAPE = { narrowShadows: 0.5, narrowHighlights: 1.75, shiftShadows: 0.15, shiftHighlights: 0.1, gainShadows: 0, gainHighlights: 0.75 } as const;

export function grading(p: Record<string, EffectParamValue>): Grading | null {
  const num = (k: string, d = 0) => (p[k] as number | undefined) ?? d;
  const wheels = GRADING_WHEELS.map((w) => {
    const sat = num(`${w}Saturation`) / 100;
    const colour = hsvToRgb([num(`${w}Hue`), 1, 1]);
    return { up: colour.map((c) => c * sat) as Rgb, down: colour.map((c) => (1 - c) * sat) as Rgb, luminance: num(`${w}Luminance`) / 100 };
  });
  if (wheels.every((w) => isNeutral(w))) return null;
  const balance = num("gradingBalance") / 100;
  const blend = 1 - num("gradingBlending", 50) / 100;
  return { wheels, narrowShadows: GRADING_SHAPE.narrowShadows * blend, narrowHighlights: GRADING_SHAPE.narrowHighlights * blend, balance };
}

const isNeutral = (w: Grading["wheels"][number]) => w.up.every((c) => c === 0) && w.down.every((c) => c === 0) && w.luminance === 0;

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
  if (w === 0) return L * (1 + g.narrowShadows) + GRADING_SHAPE.shiftShadows * g.balance;
  if (w === 1) return 0.6 + (L - 0.6) * (1 + (g.narrowShadows + g.narrowHighlights) / 2);
  if (w === 2) return 1 - (1 - L) * (1 + g.narrowHighlights) + GRADING_SHAPE.shiftHighlights * g.balance;
  return L;
}

/** How Balance weights a wheel: the side it's turned to gains, the other fades. */
export function wheelWeight(w: number, g: Grading): number {
  const b = g.balance;
  if (w === 0) return b > 0 ? 1 - b : 1 - GRADING_SHAPE.gainShadows * b;
  if (w === 2) return b < 0 ? 1 + b : 1 + GRADING_SHAPE.gainHighlights * b;
  return 1;
}

/** Color Grading on linear ProPhoto, its masks read at OKLab lightness L. */
export function grade(pp: Rgb, L: number, g: Grading): Rgb {
  const gain = [0, 0, 0];
  GRADING_WHEELS.forEach((name, w) => {
    const wheel = g.wheels[w];
    if (isNeutral(wheel)) return;
    const at = wheelLightness(w, L, g);
    const weight = wheelWeight(w, g);
    const masks = GRADING_MASKS[name];
    const up = maskAt(masks.up, at) * weight;
    const down = maskAt(masks.down, at) * weight;
    const lum = wheel.luminance === 0 ? 0 : Math.abs(wheel.luminance) * maskAt(wheel.luminance < 0 ? masks.darker : masks.lighter, at) * weight;
    for (let c = 0; c < 3; c++) gain[c] += wheel.up[c] * up - wheel.down[c] * down + lum;
  });
  return pp.map((v, c) => v * 2 ** gain[c]) as Rgb;
}

/**
 * The GPU's copy of these settings (and the measured masks), in the table: the Mixer's 24, then 8 per wheel (its
 * up's three channels, its down's, luminance, unused), then the levels and each wheel's four masks.
 */
export const COLOUR_BLOCK_SIZE = 24 + 32 + GRADING_LEVELS.length * 17;

export function colourBlock(p: Record<string, EffectParamValue>): Float32Array {
  const block = new Float32Array(COLOUR_BLOCK_SIZE);
  const bands = mixerBands(p);
  if (bands) block.set([...bands.hue, ...bands.saturation, ...bands.luminance], 0);
  const g = grading(p);
  if (g) g.wheels.forEach((w, i) => block.set([...w.up, ...w.down, w.luminance, 0], 24 + i * 8));
  let at = 56;
  block.set(GRADING_LEVELS, at);
  at += GRADING_LEVELS.length;
  for (const name of GRADING_WHEELS) {
    for (const table of [GRADING_MASKS[name].up, GRADING_MASKS[name].down, GRADING_MASKS[name].darker, GRADING_MASKS[name].lighter]) {
      block.set(table, at);
      at += table.length;
    }
  }
  return block;
}
