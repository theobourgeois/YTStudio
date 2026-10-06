/**
 * Camera Raw's pointwise develop (docs/photo/camera-raw.md, "The pipeline"), built from what CR0 measured
 * (`measured.ts`): white balance, then one tone curve (Exposure, Blacks, Contrast, Whites, the parametric and the
 * point curve) applied keeping hue, then Vibrance, Saturation and B&W, the vignette and grain.
 *
 * Parameters become a table (`developTable`) and a few numbers (`developSettings`); `developPixel` evaluates a pixel
 * from them in f64. The GPU (`src/suites/photo/render/camera-raw.ts`) reads the same table with the same arithmetic,
 * so the two agree by construction.
 *
 * Domains: pixels arrive as straight linear sRGB. The tone works on ProPhoto primaries in sRGB-encoded values (what
 * CR0 found Camera Raw's hue-keeping to be in: `RefBaselineRGBTone` with the middle channel placed in proportion of
 * encoded values); colour sliders on linear ProPhoto; the vignette and grain on encoded sRGB, last.
 */
import { linearToSrgb, srgbToLinear } from "../../colour.ts";
import type { CurveSet, EffectParamValue } from "../../types.ts";
import { curveFunction, isIdentityCurve } from "../curve-math.ts";
import { TONE_RESPONSES, V_BRIGHTEN, V_DARKEN, WHITE_BALANCE_SHIFTS } from "./measured.ts";

export type Rgb = [number, number, number];
type M3 = [Rgb, Rgb, Rgb];

// --- colour spaces ---

const mul = (m: M3, v: readonly number[]): Rgb => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const mm = (a: M3, b: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as M3;
function inverse(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
/** Linear sRGB → XYZ (D50, Bradford-adapted), and linear ProPhoto → XYZ (D50): ICC's. */
const SRGB_XYZ: M3 = [
  [0.4360747, 0.3850649, 0.1430804],
  [0.2225045, 0.7168786, 0.0606169],
  [0.0139322, 0.0971045, 0.7141733],
];
const PROPHOTO_XYZ: M3 = [
  [0.7976749, 0.1351917, 0.0313534],
  [0.2880402, 0.7118741, 0.0000857],
  [0, 0, 0.82521],
];
/** Linear sRGB to linear ProPhoto, and back. */
export const SRGB_TO_PROPHOTO = mm(inverse(PROPHOTO_XYZ), SRGB_XYZ);
export const PROPHOTO_TO_SRGB = inverse(SRGB_TO_PROPHOTO);

/** sRGB's encoding, extended: linear past 0 (odd) and by the curve's own formula past 1. */
export const encode = (l: number) => (l < 0 ? -linearToSrgb(-l) : l <= 1 ? linearToSrgb(l) : 1.055 * l ** (1 / 2.4) - 0.055);
export const decode = (e: number) => (e < 0 ? -srgbToLinear(-e) : e <= 1 ? srgbToLinear(e) : ((e + 0.055) / 1.055) ** 2.4);

// --- the tone coordinate (CR0 2) ---

/** V at an 8-bit code (interpolated; past white one stop a stop of light, below black ever darker). */
function vAt(table: readonly number[], code: number): number {
  if (code >= 255) return table[255] + Math.log2(Math.max(decode(code / 255), 1));
  if (code <= 0) return table[0] - 30;
  const i = Math.floor(code);
  return table[i] + (table[i + 1] - table[i]) * (code - i);
}
/** The 8-bit code at V (the inverse of `vAt`). */
function codeAt(table: readonly number[], v: number): number {
  if (v >= table[255]) return 255 * encode(2 ** (v - table[255]));
  if (v <= table[0]) return 0;
  let lo = 0;
  let hi = 255;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo + (v - table[lo]) / (table[hi] - table[lo]);
}
/** A code moved by `stops` in the tone coordinate (brightening and darkening each by their own fit). */
export const shiftCode = (code: number, stops: number) => {
  if (stops === 0) return code;
  const t = stops > 0 ? V_BRIGHTEN : V_DARKEN;
  return codeAt(t, vAt(t, code) + stops);
};

// --- measured responses between the measured values ---

/** A slider's measured response at `value` (between the values measured, linearly; 0 is the identity). */
function response(kind: string, value: number): ((code: number) => number) | null {
  if (value === 0) return null;
  const by = TONE_RESPONSES[kind];
  const at = (s: number) => (s === 0 ? null : by[s]);
  const steps = [-100, -50, 0, 50, 100];
  const v = Math.max(-100, Math.min(100, value));
  const i = Math.min(3, Math.max(0, Math.floor((v + 100) / 50)));
  const s0 = steps[i];
  const s1 = steps[i + 1];
  const t = (v - s0) / (s1 - s0);
  const a = at(s0);
  const b = at(s1);
  const curve = (c: readonly number[] | null, code: number) => {
    if (!c) return code;
    if (code >= 255) return code + c[255] - 255;
    if (code <= 0) return code + c[0];
    const j = Math.floor(code);
    return c[j] + (c[j + 1] - c[j]) * (code - j);
  };
  return (code) => curve(a, code) * (1 - t) + curve(b, code) * t;
}

/** Linear interpolation of a value measured at −100, −50, 0, 50 and 100. */
function between(value: number, at: readonly [number, number, number, number, number]): number {
  const v = Math.max(-100, Math.min(100, value));
  const i = Math.min(3, Math.max(0, Math.floor((v + 100) / 50)));
  const t = (v + 100 - i * 50) / 50;
  return at[i] + (at[i + 1] - at[i]) * t;
}

// --- the settings a pixel is developed with ---

/** Entries in each of the table's curves (over encoded 0..1). */
export const DEVELOP_TABLE_SIZE = 1024;
/** The table's curves, in order: the tone curve, white balance's three channels, the point curve's three channels. */
export const TABLE_TONE = 0;
export const TABLE_WHITE_BALANCE = 1;
export const TABLE_CHANNELS = 4;
export const DEVELOP_TABLE_CURVES = 7;

/** Saturation's chroma scale at −100, −50, 0, 50, 100 and its pivot's weights on linear ProPhoto (fitted to CR0's runs). */
const SATURATION_SCALE = [0, 0.493, 1, 1.683, 2.363] as const;
export const SATURATION_PIVOT: Rgb = [0.204, 0.819, -0.023];
/** Vibrance's scale, how much it spares saturated colours, and its pivot between the min and max channel (fitted). */
const VIBRANCE_SCALE = [0.203, 0.461, 1, 1.467, 2.041] as const;
const VIBRANCE_SPARE = [0.1, 0.167, 0.167, 0.668, 0.719] as const;
const VIBRANCE_PIVOT = [0.628, 0.694, 0.694, 0.73, 0.768] as const;
/** B&W's grey: weights on linear ProPhoto (fitted to Camera Raw's default mix). */
export const GREY_WEIGHTS: Rgb = [0.248, 0.673, 0.079];
/** The vignette's falloff (fitted to CR0's runs on grey): Midpoint and Feather move its centre and width. */
/** The grey CR0's vignette runs were measured on (an 8-bit code). */
export const VIGNETTE_GREY = 118;
export const VIGNETTE = { centre: [0.4537, 0.9449], width: [0.0357, 0.9708], darken: 1.5134, lighten: 1.0689, exponent: 1.962 } as const;

/** The develop's numbers besides its table, in the order the GPU's uniform holds them. */
export interface DevelopSettings {
  /** Whether the tone curve, white balance and the channel curves are identities (skipped). */
  tone: boolean;
  whiteBalance: boolean;
  channels: boolean;
  saturation: number;
  vibrance: number;
  vibranceSpare: number;
  vibrancePivot: number;
  bw: boolean;
  vignette: number;
  /** 0 highlight priority, 1 colour priority, 2 paint overlay. */
  vignetteStyle: number;
  vignetteCentre: number;
  vignetteWidth: number;
  /** The shape's exponent (2 an ellipse, more towards the rectangle) and how far towards a circle. */
  vignetteExponent: number;
  vignetteCircle: number;
  vignetteHighlights: number;
  grain: number;
  /** Grain's cell in document pixels, and how much of its rough octave is mixed in. */
  grainSize: number;
  grainRoughness: number;
  canvas: { width: number; height: number };
}

const num = (p: Record<string, EffectParamValue>, k: string) => (p[k] as number | undefined) ?? 0;

/** The tone curve: an 8-bit code in, out (Exposure, Blacks, Contrast, Whites, the parametric curve, the point curve). */
export function toneFunction(p: Record<string, EffectParamValue>): ((code: number) => number) | null {
  const exposure = num(p, "exposure");
  const steps = [response("blacks", num(p, "blacks")), response("contrast", num(p, "contrast")), response("whites", num(p, "whites"))].filter((f) => f !== null);
  // The parametric curve's regions, each measured at the default splits. Each split shapes only its own regions
  // (CR0: Shadow Split moves Shadows alone, Midtone Split Darks and Lights, Highlight Split Highlights alone), so a
  // region reads its response with its split moved back to where it was measured.
  const pct = (k: string, d: number) => (((p[k] as number | undefined) ?? d) * 255) / 100;
  /** A piecewise-linear warp through knots [from, to] (0 and 255 fixed). */
  const warpThrough = (knots: [number, number][]) => {
    const pts = [[0, 0] as [number, number], ...knots, [255, 255] as [number, number]];
    return (x: number) => {
      if (x <= 0 || x >= 255) return x;
      let i = 0;
      while (x > pts[i + 1][0]) i++;
      return pts[i][1] + ((x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])) * (pts[i + 1][1] - pts[i][1]);
    };
  };
  const shadowSplit = pct("curveShadowSplit", 25);
  const midSplit = pct("curveMidtoneSplit", 50);
  const highlightSplit = pct("curveHighlightSplit", 75);
  const regions = (
    [
      ["pshadows", "curveShadows", warpThrough([[shadowSplit, 63.75]])],
      // Darks and Lights follow the Midtone Split, held at the quarter on their far side (CR0: Darks at 100 with the
      // split at 30% within 1 level of this).
      ["pdarks", "curveDarks", warpThrough([[Math.min(63.75, midSplit / 2), Math.min(63.75, midSplit / 2)], [midSplit, 127.5]])],
      ["plights", "curveLights", warpThrough([[midSplit, 127.5], [Math.max(191.25, (midSplit + 255) / 2), Math.max(191.25, (midSplit + 255) / 2)]])],
      ["phighlights", "curveHighlights", warpThrough([[highlightSplit, 191.25]])],
    ] as const
  )
    .map(([kind, key, warp]) => {
      const f = response(kind, num(p, key));
      return f && ((x: number) => x + f(warp(x)) - warp(x));
    })
    .filter((f) => f !== null);
  const point = (p.pointCurve as CurveSet | undefined)?.rgb;
  const pointFn = point && !isIdentityCurve(point) ? curveFunction(point) : null;
  if (exposure === 0 && !steps.length && !regions.length && !pointFn) return null;
  return (code) => {
    let c = shiftCode(code, exposure);
    for (const f of steps) c = f(c);
    if (regions.length) {
      // Regions together are neither their sum nor one after another: Camera Raw's lies between (CR0: their mean
      // is within 3 levels of Darks and Lights both at 100).
      let sum = c;
      let composed = c;
      for (const f of regions) {
        sum += f(c) - c;
        composed = f(composed);
      }
      c = regions.length === 1 ? composed : Math.min((sum + composed) / 2, Math.max(sum, composed, 255));
    }
    if (pointFn) c = c >= 255 ? c - 255 + pointFn(1) * 255 : c <= 0 ? c + pointFn(0) * 255 : pointFn(c / 255) * 255;
    return c;
  };
}

/** White balance: each ProPhoto channel's shift in the tone coordinate (stops). */
export function whiteBalanceShifts(p: Record<string, EffectParamValue>): Rgb | null {
  const t = num(p, "temperature");
  const g = num(p, "tint");
  if (t === 0 && g === 0) return null;
  const one = (kind: string, v: number, c: number) => {
    const m = WHITE_BALANCE_SHIFTS[kind];
    return between(v, [m[-100][c], m[-50][c], 0, m[50][c], m[100][c]]);
  };
  return [0, 1, 2].map((c) => one("temperature", t, c) + one("tint", g, c)) as Rgb;
}

/** The table the develop reads: `DEVELOP_TABLE_CURVES` curves of `DEVELOP_TABLE_SIZE` entries over encoded 0..1. */
export function developTable(p: Record<string, EffectParamValue>): Float32Array {
  const n = DEVELOP_TABLE_SIZE;
  const table = new Float32Array(DEVELOP_TABLE_CURVES * n);
  const fill = (curve: number, f: ((e: number) => number) | null) => {
    for (let i = 0; i < n; i++) table[curve * n + i] = f ? f(i / (n - 1)) : i / (n - 1);
  };
  const tone = toneFunction(p);
  fill(TABLE_TONE, tone && ((e) => tone(e * 255) / 255));
  const wb = whiteBalanceShifts(p);
  // A channel white balance pushes past white stays at white, in ProPhoto, as Camera Raw's does (CR0: temperature
  // −100's blues).
  for (let c = 0; c < 3; c++) fill(TABLE_WHITE_BALANCE + c, wb && ((e) => Math.min(1, shiftCode(e * 255, wb[c]) / 255)));
  const set = p.pointCurve as CurveSet | undefined;
  const channels = set ? [set.red, set.green, set.blue] : [];
  for (let c = 0; c < 3; c++) {
    const pts = channels[c];
    fill(TABLE_CHANNELS + c, pts && !isIdentityCurve(pts) ? curveFunction(pts) : null);
  }
  return table;
}

/** The develop's numbers for these parameters on this canvas. */
export function developSettings(p: Record<string, EffectParamValue>, canvas: { width: number; height: number }): DevelopSettings {
  const set = p.pointCurve as CurveSet | undefined;
  const vib = num(p, "vibrance");
  const roundness = num(p, "vignetteRoundness");
  const style = p.vignetteStyle === "color" ? 1 : p.vignetteStyle === "paint" ? 2 : 0;
  const diagonal = Math.hypot(canvas.width, canvas.height);
  return {
    tone: toneFunction(p) !== null,
    whiteBalance: whiteBalanceShifts(p) !== null,
    channels: !!set && !(isIdentityCurve(set.red) && isIdentityCurve(set.green) && isIdentityCurve(set.blue)),
    saturation: between(num(p, "saturation"), SATURATION_SCALE),
    vibrance: between(vib, VIBRANCE_SCALE),
    vibranceSpare: between(vib, VIBRANCE_SPARE),
    vibrancePivot: between(vib, VIBRANCE_PIVOT),
    bw: p.treatment === "bw",
    vignette: num(p, "vignette") / 100,
    vignetteStyle: style,
    vignetteCentre: VIGNETTE.centre[0] + ((VIGNETTE.centre[1] - VIGNETTE.centre[0]) * ((p.vignetteMidpoint as number | undefined) ?? 50)) / 100,
    vignetteWidth: VIGNETTE.width[0] + ((VIGNETTE.width[1] - VIGNETTE.width[0]) * ((p.vignetteFeather as number | undefined) ?? 50)) / 100,
    vignetteExponent: VIGNETTE.exponent * 4 ** (Math.max(0, -roundness) / 100),
    vignetteCircle: roundness > 0 ? roundness / 100 : 0,
    vignetteHighlights: num(p, "vignetteHighlights") / 100,
    grain: num(p, "grain") / 100,
    // A grain of ~0.12% of the diagonal at Size 25 (Camera Raw's default), growing with Size.
    grainSize: Math.max(0.5, diagonal * 0.0004 * (1 + ((p.grainSize as number | undefined) ?? 25) / 12.5)),
    grainRoughness: ((p.grainRoughness as number | undefined) ?? 50) / 100,
    canvas,
  };
}

// --- one pixel ---

/** A curve of the table at an encoded value: linear between entries, extended straight past 0 and 1. */
export function tableAt(table: Float32Array, curve: number, e: number): number {
  const n = DEVELOP_TABLE_SIZE;
  const base = curve * n;
  if (e >= 1) return table[base + n - 1] + (e - 1) * (table[base + n - 1] - table[base + n - 2]) * (n - 1);
  if (e <= 0) return table[base] + e * (table[base + 1] - table[base]) * (n - 1);
  const x = e * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  return table[base + i] + (table[base + i + 1] - table[base + i]) * f;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** The vignette's amount at a document point: 0 in the middle, 1 at the corners (CR0's fit). */
export function vignetteAt(s: DevelopSettings, x: number, y: number): number {
  const { width, height } = s.canvas;
  const u = Math.abs(x / width - 0.5) * 2;
  const v = Math.abs(y / height - 0.5) * 2;
  const q = s.vignetteExponent;
  const ellipse = ((u ** q + v ** q) / 2) ** (1 / q);
  const circle = Math.sqrt((u * u * width * width + v * v * height * height) / (width * width + height * height));
  const d = ellipse + (circle - ellipse) * s.vignetteCircle;
  return smoothstep(s.vignetteCentre - s.vignetteWidth / 2, s.vignetteCentre + s.vignetteWidth / 2, d);
}

/** A hash to [0, 1) for an integer cell (WGSL's `hash2` through `rand`: the same numbers). */
export type Rand = (ix: number, iy: number, seed: number) => number;

/** Smooth value noise in [0, 1) (the kernels' `vnoise`), from `rand`. */
function noise(rand: Rand, x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = rand(ix, iy, seed);
  const b = rand(ix + 1, iy, seed);
  const c = rand(ix, iy + 1, seed);
  const d = rand(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Camera Raw's grain at a document point: centred on 0, mostly within ±0.5. */
export function grainAt(s: DevelopSettings, rand: Rand, x: number, y: number): number {
  const qx = x / s.grainSize;
  const qy = y / s.grainSize;
  const smooth = noise(rand, qx, qy, 7) + noise(rand, qx * 1.93 + 7.1, qy * 1.93 + 3.3, 18) - 1;
  const rough = noise(rand, qx * 2.7 + 1.3, qy * 2.7 + 5.9, 29) - 0.5;
  return smooth + (rough - smooth * 0.5) * s.grainRoughness;
}

/**
 * One pixel: straight linear sRGB in (any range), out, at document point (x, y). `rand` is the kernels' hash
 * (shared/photo/reference/kernel.ts), passed in so this module needs nothing of the renderer's.
 */
export function developPixel(rgb: readonly number[], x: number, y: number, table: Float32Array, s: DevelopSettings, rand: Rand): Rgb {
  const top = Math.max(1, rgb[0], rgb[1], rgb[2]);
  let e = mul(SRGB_TO_PROPHOTO, rgb).map(encode) as Rgb;
  if (s.whiteBalance) e = [tableAt(table, TABLE_WHITE_BALANCE, e[0]), tableAt(table, TABLE_WHITE_BALANCE + 1, e[1]), tableAt(table, TABLE_WHITE_BALANCE + 2, e[2])];
  if (s.tone) e = keepingHue(e, (v) => tableAt(table, TABLE_TONE, v));
  if (s.channels) e = [tableAt(table, TABLE_CHANNELS, e[0]), tableAt(table, TABLE_CHANNELS + 1, e[1]), tableAt(table, TABLE_CHANNELS + 2, e[2])];
  let l = e.map(decode) as Rgb;
  if (s.vibrance !== 1) {
    const hi = Math.max(l[0], l[1], l[2]);
    const lo = Math.min(l[0], l[1], l[2]);
    const sat = hi > 0 ? Math.max(0, Math.min(1, (hi - lo) / hi)) : 0;
    const k = 1 + (s.vibrance - 1) * (1 - sat) ** s.vibranceSpare;
    const pivot = s.vibrancePivot * hi + (1 - s.vibrancePivot) * lo;
    l = l.map((c) => pivot + (c - pivot) * k) as Rgb;
  }
  if (s.saturation !== 1) {
    const pivot = SATURATION_PIVOT[0] * l[0] + SATURATION_PIVOT[1] * l[1] + SATURATION_PIVOT[2] * l[2];
    l = l.map((c) => pivot + (c - pivot) * s.saturation) as Rgb;
  }
  if (s.bw) {
    const grey = GREY_WEIGHTS[0] * l[0] + GREY_WEIGHTS[1] * l[1] + GREY_WEIGHTS[2] * l[2];
    l = [grey, grey, grey];
  }
  // Back to sRGB, held in gamut as Camera Raw's result is (light above white that was there stays).
  let out = mul(PROPHOTO_TO_SRGB, l).map((c) => Math.max(0, Math.min(top, c))) as Rgb;
  if (s.vignette !== 0 || s.grain > 0) {
    let v = out.map(encode) as Rgb;
    if (s.vignette !== 0) v = vignette(v, vignetteAt(s, x, y), s);
    if (s.grain > 0) {
      const g = grainAt(s, rand, x, y);
      const y0 = Math.max(0, Math.min(1, 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]));
      const k = s.grain * 0.5 * (0.15 + 3.4 * y0 * (1 - y0));
      v = v.map((c) => c + g * k) as Rgb;
    }
    out = v.map(decode) as Rgb;
  }
  return out;
}

/**
 * A tone curve applied keeping hue (Adobe's `RefBaselineRGBTone`): the curve on the largest and smallest channel,
 * the middle one placed between them in the proportion it had.
 */
export function keepingHue(e: Rgb, f: (v: number) => number): Rgb {
  const [r, g, b] = e;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const fhi = f(hi);
  const flo = hi === lo ? fhi : f(lo);
  const mid = (c: number) => (c === hi ? fhi : c === lo ? flo : flo + ((fhi - flo) * (c - lo)) / (hi - lo));
  return [mid(r), mid(g), mid(b)];
}

/** The vignette on encoded colour, `t` of the way in. */
function vignette(v: Rgb, t: number, s: DevelopSettings): Rgb {
  const a = s.vignette;
  if (t <= 0) return v;
  if (s.vignetteStyle === 2) {
    // Paint Overlay: black or white mixed in.
    const k = t * Math.abs(a) * 0.85;
    return v.map((c) => c + ((a < 0 ? 0 : 1) - c) * k) as Rgb;
  }
  if (a < 0) {
    let f = (1 - t * -a) ** VIGNETTE.darken;
    const y0 = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    // Highlights (with Highlight Priority): bright parts keep their light.
    if (s.vignetteStyle === 0 && s.vignetteHighlights > 0) f += (1 - f) * s.vignetteHighlights * smoothstep(0.5, 1, y0);
    if (s.vignetteStyle === 1) {
      // Colour Priority: the luminance darkened, every channel scaled with it, so the colour keeps its proportions.
      const ly = decode(Math.max(0, y0));
      const scale = ly > 0 ? decode(Math.max(0, y0) * f) / ly : f;
      return v.map((c) => encode(decode(c) * scale)) as Rgb;
    }
    // Highlight Priority darkens as Exposure does: what it does to a mid grey, as stops, moves every channel
    // (CR0: bright tones in the corners keep more of their light than a plain scale would leave them).
    const stops = vAt(V_DARKEN, VIGNETTE_GREY * f) - vAt(V_DARKEN, VIGNETTE_GREY);
    return v.map((c) => shiftCode(c * 255, stops) / 255) as Rgb;
  }
  const f = (1 - t * a) ** VIGNETTE.lighten;
  return v.map((c) => 1 - (1 - c) * f) as Rgb;
}

/**
 * White balance's eyedropper: the Temperature and Tint (whole numbers in ±100) that make `rgb` (straight linear
 * sRGB, as it is before Camera Raw) neutral, as near as they can: its ProPhoto channels equal after white balance.
 */
export function neutralWhiteBalance(rgb: readonly number[]): { temperature: number; tint: number } {
  const e = mul(SRGB_TO_PROPHOTO, rgb).map(encode);
  const cast = (temperature: number, tint: number) => {
    const wb = whiteBalanceShifts({ temperature, tint });
    const [r, g, b] = wb ? e.map((v, c) => shiftCode(v * 255, wb[c])) : e.map((v) => v * 255);
    return (r - g) ** 2 + (b - g) ** 2;
  };
  let best = { temperature: 0, tint: 0 };
  let score = cast(0, 0);
  // Coarse to fine over the whole square.
  for (const step of [20, 5, 1]) {
    const around = { ...best };
    for (let t = around.temperature - 4 * step; t <= around.temperature + 4 * step; t += step) {
      for (let g = around.tint - 4 * step; g <= around.tint + 4 * step; g += step) {
        if (Math.abs(t) > 100 || Math.abs(g) > 100) continue;
        const s = cast(t, g);
        if (s < score) {
          score = s;
          best = { temperature: t, tint: g };
        }
      }
    }
  }
  return best;
}
