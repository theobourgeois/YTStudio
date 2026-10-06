/**
 * Camera Raw's GPU develop (docs/photo/camera-raw.md, "The renderer"): one function, `develop`, mirroring
 * `developPixel` (shared/photo/effects/camera-raw/develop.ts) step for step, read by both of Camera Raw's passes:
 * the kernel filter's (`CAMERA_RAW_FILTER`, a Smart Filter on a layer) and the adjustment's (`CAMERA_RAW_ADJUSTMENT`).
 * Both read the same table: the develop's curves (`developTable`), the darkening tone coordinate, the Color Mixer's
 * and Color Grading's numbers (`colourBlock`), then the analysis's grid and Glow's grid.
 */
import { GRADING_LEVELS, V_DARKEN } from "@shared/photo/effects/camera-raw/measured.ts";
import { COLOUR_BLOCK_SIZE, GRADING_SHAPE, MIXER_CENTRES, colourBlock } from "@shared/photo/effects/camera-raw/colour.ts";
import {
  DEVELOP_TABLE_CURVES,
  DEVELOP_TABLE_SIZE,
  GREY_WEIGHTS,
  PROPHOTO_TO_SRGB,
  SATURATION_PIVOT,
  SRGB_TO_PROPHOTO,
  LOCAL_RANGE,
  LOCAL_STRENGTH,
  VIGNETTE,
  VIGNETTE_GREY,
  GLOW_STRENGTH,
  ANALYSIS_PARAM,
  analysisOf,
  developSettings,
  developTable,
} from "@shared/photo/effects/camera-raw/develop.ts";
import { GRID_FLOATS } from "@shared/photo/effects/camera-raw/analysis.ts";
import type { EffectParamValue } from "@shared/photo/types.ts";
import type { AdjustmentKernel } from "./adjustments.ts";
import type { FilterKernel } from "./kernel.ts";

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
/** A 3 × 3 matrix as WGSL (column-major: `m * v` is the row-major matrix times v). */
const mat = (m: readonly (readonly number[])[]) => `mat3x3f(${[0, 1, 2].map((c) => [0, 1, 2].map((r) => f(m[r][c])).join(", ")).join(", ")})`;

/** The uniform's fields after any a pass puts first (all f32, in this order). */
const FIELDS = [
  "tone",
  "white_balance",
  "channels",
  "bw",
  "saturation",
  "vibrance",
  "vibrance_spare",
  "vibrance_pivot",
  "vignette",
  "vignette_style",
  "vignette_centre",
  "vignette_width",
  "vignette_exponent",
  "vignette_circle",
  "vignette_highlights",
  "grain",
  "grain_size",
  "grain_roughness",
  "canvas_w",
  "canvas_h",
  "local",
  "highlights",
  "shadows",
  "clarity",
  "texture",
  "dehaze",
  "grid_w",
  "grid_h",
  "grid_spacing",
  "range_low",
  "range_high",
  "air_r",
  "air_g",
  "air_b",
  "mixer",
  "grading",
  "grading_narrow_shadows",
  "grading_narrow_highlights",
  "grading_balance",
  "glow",
  "glow_style",
  "glow_r",
  "glow_g",
  "glow_b",
  "glow_at",
] as const;

function fieldValues(params: Record<string, EffectParamValue>, canvas: { width: number; height: number }): number[] {
  const s = developSettings(params, canvas);
  const values: Record<(typeof FIELDS)[number], number> = {
    tone: s.tone ? 1 : 0,
    white_balance: s.whiteBalance ? 1 : 0,
    channels: s.channels ? 1 : 0,
    bw: s.bw ? 1 : 0,
    saturation: s.saturation,
    vibrance: s.vibrance,
    vibrance_spare: s.vibranceSpare,
    vibrance_pivot: s.vibrancePivot,
    vignette: s.vignette,
    vignette_style: s.vignetteStyle,
    vignette_centre: s.vignetteCentre,
    vignette_width: s.vignetteWidth,
    vignette_exponent: s.vignetteExponent,
    vignette_circle: s.vignetteCircle,
    vignette_highlights: s.vignetteHighlights,
    grain: s.grain,
    grain_size: s.grainSize,
    grain_roughness: s.grainRoughness,
    canvas_w: canvas.width,
    canvas_h: canvas.height,
    local: s.analysis && (s.highlights || s.shadows || s.clarity || s.texture || s.dehaze) ? 1 : 0,
    highlights: s.highlights,
    shadows: s.shadows,
    clarity: s.clarity,
    texture: s.texture,
    dehaze: s.dehaze,
    grid_w: s.analysis?.width ?? 1,
    grid_h: s.analysis?.height ?? 1,
    grid_spacing: s.analysis?.spacing ?? 1,
    range_low: s.analysis?.low ?? 0,
    range_high: s.analysis?.high ?? 0,
    air_r: s.analysis?.airlight[0] ?? 1,
    air_g: s.analysis?.airlight[1] ?? 1,
    air_b: s.analysis?.airlight[2] ?? 1,
    mixer: s.mixer ? 1 : 0,
    grading: s.grading ? 1 : 0,
    grading_narrow_shadows: s.grading?.narrowShadows ?? 0,
    grading_narrow_highlights: s.grading?.narrowHighlights ?? 0,
    grading_balance: s.grading?.balance ?? 0,
    glow: s.glow,
    glow_style: s.glowStyle,
    glow_r: s.glowTint[0],
    glow_g: s.glowTint[1],
    glow_b: s.glowTint[2],
    glow_at: GRID_OFFSET + (s.analysis?.grid.length ?? 0),
  };
  return FIELDS.map((k) => values[k]);
}

/** The develop's table, the darkening tone coordinate after it, the colour block, then the analysis's grid and Glow's (if it reads them). */
function gpuTable(params: Record<string, EffectParamValue>, canvas: { width: number; height: number }): Float32Array {
  const curves = developTable(params);
  const grid = analysisOf(params)?.grid;
  const glow = developSettings(params, canvas).glowGrid;
  const table = new Float32Array(GRID_OFFSET + (grid?.length ?? 0) + (glow?.length ?? 0));
  table.set(curves);
  table.set(V_DARKEN, V_OFFSET);
  table.set(colourBlock(params), COLOUR_OFFSET);
  if (grid) table.set(grid, GRID_OFFSET);
  if (glow) table.set(glow, GRID_OFFSET + (grid?.length ?? 0));
  return table;
}

/** What the table is made from: the parameters (but the analysis) and the analysis's id. */
function tableKey(params: Record<string, EffectParamValue>, canvas: { width: number; height: number }): string {
  const { [ANALYSIS_PARAM]: _, ...own } = params;
  return `camera-raw|${analysisOf(params)?.id ?? ""}|${canvas.width}x${canvas.height}|${JSON.stringify(own)}`;
}

/** Packs `values` as f32s, padded to a multiple of 16 bytes. */
function packFloats(values: number[]): ArrayBuffer {
  const data = new ArrayBuffer(Math.ceil((values.length * 4) / 16) * 16);
  new Float32Array(data).set(values);
  return data;
}

const N = DEVELOP_TABLE_SIZE;
const V_OFFSET = DEVELOP_TABLE_CURVES * N;
const COLOUR_OFFSET = V_OFFSET + 256;
const GRID_OFFSET = COLOUR_OFFSET + COLOUR_BLOCK_SIZE;
const LEVELS = GRADING_LEVELS.length;

/** The develop's WGSL, after a `struct Params` holding `FIELDS` and `table` are declared. */
const DEVELOP = /* wgsl */ `
const CR_N: u32 = ${N}u;
const CR_V: u32 = ${V_OFFSET}u;
const CR_COLOUR: u32 = ${COLOUR_OFFSET}u;
const CR_LEVELS: u32 = ${LEVELS}u;
const CR_GRID: u32 = ${GRID_OFFSET}u;
const CR_GRID_FLOATS: u32 = ${GRID_FLOATS}u;
const CR_TO_PROPHOTO = ${mat(SRGB_TO_PROPHOTO)};
const CR_TO_SRGB = ${mat(PROPHOTO_TO_SRGB)};

fn cr_encode(l: f32) -> f32 {
  let a = abs(l);
  var v = 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  if (a <= 0.0031308049535603713) { v = a * 12.92; }
  return select(v, -v, l < 0.0);
}
fn cr_decode(e: f32) -> f32 {
  let a = abs(e);
  var v = pow((a + 0.055) / 1.055, 2.4);
  if (a <= 0.04045) { v = a / 12.92; }
  return select(v, -v, e < 0.0);
}
fn cr_encode3(l: vec3f) -> vec3f { return vec3f(cr_encode(l.r), cr_encode(l.g), cr_encode(l.b)); }
fn cr_decode3(e: vec3f) -> vec3f { return vec3f(cr_decode(e.r), cr_decode(e.g), cr_decode(e.b)); }

// A curve of the table at an encoded value: linear between entries, extended straight past 0 and 1.
fn cr_table(curve: u32, e: f32) -> f32 {
  let base = curve * CR_N;
  let last = base + CR_N - 1u;
  if (e >= 1.0) { return table[last] + (e - 1.0) * (table[last] - table[last - 1u]) * f32(CR_N - 1u); }
  if (e <= 0.0) { return table[base] + e * (table[base + 1u] - table[base]) * f32(CR_N - 1u); }
  let x = e * f32(CR_N - 1u);
  let i = min(CR_N - 2u, u32(floor(x)));
  return table[base + i] + (table[base + i + 1u] - table[base + i]) * (x - f32(i));
}

// The darkening tone coordinate at an 8-bit code, and its inverse (develop.ts's vAt and codeAt on V_DARKEN).
fn cr_v(code: f32) -> f32 {
  if (code >= 255.0) { return table[CR_V + 255u] + log2(max(cr_decode(code / 255.0), 1.0)); }
  if (code <= 0.0) { return table[CR_V] - 30.0; }
  let i = min(254u, u32(floor(code)));
  return table[CR_V + i] + (table[CR_V + i + 1u] - table[CR_V + i]) * (code - f32(i));
}
fn cr_code(v: f32) -> f32 {
  if (v >= table[CR_V + 255u]) { return 255.0 * cr_encode(exp2(v - table[CR_V + 255u])); }
  if (v <= table[CR_V]) { return 0.0; }
  var lo = 0u;
  var hi = 255u;
  loop {
    if (hi - lo <= 1u) { break; }
    let mid = (lo + hi) / 2u;
    if (table[CR_V + mid] <= v) { lo = mid; } else { hi = mid; }
  }
  return f32(lo) + (v - table[CR_V + lo]) / (table[CR_V + hi] - table[CR_V + lo]);
}

// The tone curve applied keeping hue (Adobe's RefBaselineRGBTone).
fn cr_keep_hue(e: vec3f) -> vec3f {
  let hi = max(e.r, max(e.g, e.b));
  let lo = min(e.r, min(e.g, e.b));
  let fhi = cr_table(0u, hi);
  if (hi == lo) { return vec3f(fhi); }
  let flo = cr_table(0u, lo);
  let mid = flo + (fhi - flo) * (e - vec3f(lo)) / (hi - lo);
  return select(select(mid, vec3f(flo), e == vec3f(lo)), vec3f(fhi), e == vec3f(hi));
}

fn cr_smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

fn cr_vignette_at(p: vec2f) -> f32 {
  let w = params.canvas_w;
  let h = params.canvas_h;
  let u = abs(p.x / w - 0.5) * 2.0;
  let v = abs(p.y / h - 0.5) * 2.0;
  let q = params.vignette_exponent;
  let ellipse = pow((pow(u, q) + pow(v, q)) / 2.0, 1.0 / q);
  let circle = sqrt((u * u * w * w + v * v * h * h) / (w * w + h * h));
  let d = ellipse + (circle - ellipse) * params.vignette_circle;
  return cr_smoothstep(params.vignette_centre - params.vignette_width / 2.0, params.vignette_centre + params.vignette_width / 2.0, d);
}

fn cr_vignette(v: vec3f, t: f32) -> vec3f {
  let a = params.vignette;
  if (t <= 0.0) { return v; }
  if (params.vignette_style == 2.0) {
    let k = t * abs(a) * 0.85;
    return v + (vec3f(select(1.0, 0.0, a < 0.0)) - v) * k;
  }
  if (a < 0.0) {
    var f = pow(1.0 - t * -a, ${f(VIGNETTE.darken)});
    let y0 = dot(v, vec3f(0.2126, 0.7152, 0.0722));
    if (params.vignette_style == 0.0 && params.vignette_highlights > 0.0) { f += (1.0 - f) * params.vignette_highlights * cr_smoothstep(0.5, 1.0, y0); }
    if (params.vignette_style == 1.0) {
      let ly = cr_decode(max(0.0, y0));
      var scale = f;
      if (ly > 0.0) { scale = cr_decode(max(0.0, y0) * f) / ly; }
      return cr_encode3(cr_decode3(v) * scale);
    }
    let stops = cr_v(${f(VIGNETTE_GREY)} * f) - cr_v(${f(VIGNETTE_GREY)});
    if (stops == 0.0) { return v; }
    return vec3f(cr_code(cr_v(v.r * 255.0) + stops), cr_code(cr_v(v.g * 255.0) + stops), cr_code(cr_v(v.b * 255.0) + stops)) / 255.0;
  }
  let f = pow(1.0 - t * a, ${f(VIGNETTE.lighten)});
  return vec3f(1.0) - (vec3f(1.0) - v) * f;
}

// The kernels' rand (shared/photo/reference/kernel.ts) and value noise, for the grain.
fn cr_rand(ix: i32, iy: i32, seed: u32) -> f32 {
  return f32(hash2(bitcast<u32>(ix), bitcast<u32>(iy) ^ (seed * 0x9e3779b9u)) >> 8u) / 16777216.0;
}
fn cr_noise(x: f32, y: f32, seed: u32) -> f32 {
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let fx = x - floor(x);
  let fy = y - floor(y);
  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uy = fy * fy * (3.0 - 2.0 * fy);
  let a = cr_rand(ix, iy, seed);
  let b = cr_rand(ix + 1, iy, seed);
  let c = cr_rand(ix, iy + 1, seed);
  let d = cr_rand(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
fn cr_grain_at(p: vec2f) -> f32 {
  let q = p / params.grain_size;
  let sm = cr_noise(q.x, q.y, 7u) + cr_noise(q.x * 1.93 + 7.1, q.y * 1.93 + 3.3, 18u) - 1.0;
  let rough = cr_noise(q.x * 2.7 + 1.3, q.y * 2.7 + 5.9, 29u) - 0.5;
  return sm + (rough - sm * 0.5) * params.grain_roughness;
}

// The analysis's grid at a document point: bilinear between cell centres, held at the edges (analysis.ts's gridAt).
fn cr_grid(p: vec2f, out: ptr<function, array<f32, ${GRID_FLOATS}>>) {
  let w = u32(params.grid_w);
  let h = u32(params.grid_h);
  let gx = clamp(p.x / params.grid_spacing - 0.5, 0.0, f32(w - 1u));
  let gy = clamp(p.y / params.grid_spacing - 0.5, 0.0, f32(h - 1u));
  let x0 = u32(floor(gx));
  let y0 = u32(floor(gy));
  let x1 = min(x0 + 1u, w - 1u);
  let y1 = min(y0 + 1u, h - 1u);
  let fx = gx - f32(x0);
  let fy = gy - f32(y0);
  for (var k = 0u; k < CR_GRID_FLOATS; k++) {
    let a = table[CR_GRID + (y0 * w + x0) * CR_GRID_FLOATS + k];
    let b = table[CR_GRID + (y0 * w + x1) * CR_GRID_FLOATS + k];
    let c = table[CR_GRID + (y1 * w + x0) * CR_GRID_FLOATS + k];
    let d = table[CR_GRID + (y1 * w + x1) * CR_GRID_FLOATS + k];
    let top = a + (b - a) * fx;
    let bottom = c + (d - c) * fx;
    (*out)[k] = top + (bottom - top) * fy;
  }
}

fn cr_lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// The local sliders (develop.ts's local), on straight linear sRGB, first.
fn cr_local(input: vec3f, p: vec2f) -> vec3f {
  var g: array<f32, ${GRID_FLOATS}>;
  cr_grid(p, &g);
  var c = input;
  if (params.dehaze != 0.0) {
    let air = vec3f(params.air_r, params.air_g, params.air_b);
    if (params.dehaze > 0.0) {
      let d = clamp(g[6] * log2(max(cr_lum(c), ${f(2 ** -20)})) + g[7], 0.0, 1.0);
      let t = max(0.1, 1.0 - 0.95 * params.dehaze * d);
      c = max((c - air) / t + air, vec3f(0.0));
    } else {
      let k = -params.dehaze * ${f(LOCAL_STRENGTH.dehazeDown)};
      c = c + (air - c) * k;
    }
  }
  let L = log2(max(cr_lum(c), ${f(2 ** -20)}));
  let base = g[0] * L + g[1];
  let range = max(0.0, params.range_high - params.range_low);
  var u = 0.5;
  if (range > 0.001) { u = clamp((base - params.range_low) / range, 0.0, 1.0); }
  let scale = min(range, ${f(LOCAL_RANGE)}) / ${f(LOCAL_RANGE)};
  var gain = 0.0;
  if (params.highlights != 0.0) {
    gain += params.highlights * select(${f(LOCAL_STRENGTH.highlightsUp)}, ${f(LOCAL_STRENGTH.highlightsDown)}, params.highlights < 0.0) * cr_smoothstep(0.4, 1.0, u) * scale;
  }
  if (params.shadows != 0.0) {
    gain += params.shadows * select(${f(LOCAL_STRENGTH.shadowsDown)}, ${f(LOCAL_STRENGTH.shadowsUp)}, params.shadows > 0.0) * (1.0 - cr_smoothstep(0.05, 0.8, u)) * scale;
  }
  if (params.texture != 0.0) { gain += params.texture * ${f(LOCAL_STRENGTH.texture)} * (L - (g[4] * L + g[5])); }
  if (params.clarity > 0.0) {
    let band = g[9] * L + g[10] - (g[2] * L + g[3]);
    let midtones = 1.0 - 0.5 * (2.0 * u - 1.0) * (2.0 * u - 1.0);
    gain += clamp(params.clarity * ${f(LOCAL_STRENGTH.clarityUp)} * band * midtones, -${f(LOCAL_STRENGTH.maxClarity)}, ${f(LOCAL_STRENGTH.maxClarity)});
  } else if (params.clarity < 0.0) {
    gain += -params.clarity * ${f(LOCAL_STRENGTH.clarityDown)} * (g[8] - L);
  }
  return c * exp2(gain);
}

// --- the Color Mixer (colour.ts's mix), on encoded ProPhoto ---

const CR_CENTRES = array<f32, 9>(${[...MIXER_CENTRES, 360].map(f).join(", ")});

fn cr_hsv(c: vec3f) -> vec3f {
  let hi = max(c.r, max(c.g, c.b));
  let lo = min(c.r, min(c.g, c.b));
  let d = hi - lo;
  var h = 0.0;
  if (d > 0.0) {
    if (hi == c.r) { h = (c.g - c.b) / d; } else if (hi == c.g) { h = (c.b - c.r) / d + 2.0; } else { h = (c.r - c.g) / d + 4.0; }
    h *= 60.0;
    if (h < 0.0) { h += 360.0; }
  }
  return vec3f(h, select(0.0, d / hi, hi > 0.0), hi);
}

fn cr_from_hsv(hsv: vec3f) -> vec3f {
  let hh = (hsv.x - 360.0 * floor(hsv.x / 360.0)) / 60.0;
  let c = hsv.z * hsv.y;
  let x = c * (1.0 - abs(hh - 2.0 * floor(hh / 2.0) - 1.0));
  let i = floor(hh);
  var rgb = vec3f(c, 0.0, x);
  if (i == 0.0) { rgb = vec3f(c, x, 0.0); } else if (i == 1.0) { rgb = vec3f(x, c, 0.0); } else if (i == 2.0) { rgb = vec3f(0.0, c, x); } else if (i == 3.0) { rgb = vec3f(0.0, x, c); } else if (i == 4.0) { rgb = vec3f(x, 0.0, c); }
  return rgb + vec3f(hsv.z - c);
}

// A band's setting (0 hue, 1 saturation, 2 luminance) shared between a hue's two bands.
fn cr_band(kind: u32, h: f32) -> f32 {
  var i = 0u;
  for (var k = 0u; k < 8u; k++) { if (h >= CR_CENTRES[k] && h < CR_CENTRES[k + 1u]) { i = k; } }
  let t = clamp((h - CR_CENTRES[i]) / (CR_CENTRES[i + 1u] - CR_CENTRES[i]), 0.0, 1.0);
  let base = CR_COLOUR + kind * 8u;
  return table[base + i] * (1.0 - t) + table[base + (i + 1u) % 8u] * t;
}

fn cr_mix(e: vec3f) -> vec3f {
  let c = clamp(e, vec3f(0.0), vec3f(1.0));
  let hsv = cr_hsv(c);
  var rgb = cr_from_hsv(vec3f(hsv.x + cr_band(0u, hsv.x), clamp(hsv.y * (1.0 + cr_band(1u, hsv.x)), 0.0, 1.0), hsv.z));
  let dl = cr_band(2u, hsv.x);
  if (dl != 0.0) {
    let hi = max(rgb.r, max(rgb.g, rgb.b));
    let lo = min(rgb.r, min(rgb.g, rgb.b));
    let L = (hi + lo) / 2.0;
    var S = 0.0;
    if (hi != lo) { S = select((hi - lo) / (hi + lo), (hi - lo) / (2.0 - hi - lo), L > 0.5); }
    let L2 = clamp(L + dl * S * 0.5, 0.0, 1.0);
    let q = select(L2 + S - L2 * S, L2 * (1.0 + S), L2 < 0.5);
    let p = 2.0 * L2 - q;
    if (hi > lo) { rgb = vec3f(p) + (rgb - vec3f(lo)) * ((q - p) / (hi - lo)); } else { rgb = vec3f(L2); }
  }
  return rgb + (e - c);
}

// --- Color Grading (colour.ts's grade), in stops of linear ProPhoto ---

const CR_OK_M1 = ${mat([[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]])};

fn cr_cbrt(v: f32) -> f32 { return sign(v) * pow(abs(v), 1.0 / 3.0); }

// A measured mask (table k of the colour block's) at lightness L, linear between levels.
fn cr_mask(k: u32, L: f32) -> f32 {
  let levels = CR_COLOUR + 56u;
  let m = levels + CR_LEVELS * (1u + k);
  if (L <= table[levels]) { return table[m]; }
  if (L >= table[levels + CR_LEVELS - 1u]) { return table[m + CR_LEVELS - 1u]; }
  var lo = 0u;
  var hi = CR_LEVELS - 1u;
  loop {
    if (hi - lo <= 1u) { break; }
    let mid = (lo + hi) / 2u;
    if (table[levels + mid] <= L) { lo = mid; } else { hi = mid; }
  }
  return table[m + lo] + (table[m + hi] - table[m + lo]) * (L - table[levels + lo]) / (table[levels + hi] - table[levels + lo]);
}

fn cr_grade(pp: vec3f) -> vec3f {
  let lms = max(CR_OK_M1 * (CR_TO_SRGB * pp), vec3f(0.0));
  let L = dot(vec3f(cr_cbrt(lms.x), cr_cbrt(lms.y), cr_cbrt(lms.z)), vec3f(0.2104542553, 0.793617785, -0.0040720468));
  var gain = vec3f(0.0);
  let b = params.grading_balance;
  for (var w = 0u; w < 4u; w++) {
    let base = CR_COLOUR + 24u + w * 8u;
    let up = vec3f(table[base], table[base + 1u], table[base + 2u]);
    let down = vec3f(table[base + 3u], table[base + 4u], table[base + 5u]);
    let lum = table[base + 6u];
    if (all(up == vec3f(0.0)) && all(down == vec3f(0.0)) && lum == 0.0) { continue; }
    var at = L;
    var weight = 1.0;
    if (w == 0u) {
      at = L * (1.0 + params.grading_narrow_shadows) + ${f(GRADING_SHAPE.shiftShadows)} * b;
      weight = select(1.0 - ${f(GRADING_SHAPE.gainShadows)} * b, 1.0 - b, b > 0.0);
    }
    if (w == 1u) { at = 0.6 + (L - 0.6) * (1.0 + (params.grading_narrow_shadows + params.grading_narrow_highlights) / 2.0); }
    if (w == 2u) {
      at = 1.0 - (1.0 - L) * (1.0 + params.grading_narrow_highlights) + ${f(GRADING_SHAPE.shiftHighlights)} * b;
      weight = select(1.0 + ${f(GRADING_SHAPE.gainHighlights)} * b, 1.0 + b, b < 0.0);
    }
    gain += up * (cr_mask(w * 4u, at) * weight) - down * (cr_mask(w * 4u + 1u, at) * weight);
    if (lum != 0.0) { gain += vec3f(abs(lum) * cr_mask(w * 4u + select(3u, 2u, lum < 0.0), at) * weight); }
  }
  return pp * exp2(gain);
}

// --- Glow (develop.ts), from the glow grid ---

fn cr_glow_at(p: vec2f) -> vec3f {
  let w = u32(params.grid_w);
  let h = u32(params.grid_h);
  let at = u32(params.glow_at);
  let gx = clamp(p.x / params.grid_spacing - 0.5, 0.0, f32(w - 1u));
  let gy = clamp(p.y / params.grid_spacing - 0.5, 0.0, f32(h - 1u));
  let x0 = u32(floor(gx));
  let y0 = u32(floor(gy));
  let x1 = min(x0 + 1u, w - 1u);
  let y1 = min(y0 + 1u, h - 1u);
  let fx = gx - f32(x0);
  let fy = gy - f32(y0);
  let i00 = at + (y0 * w + x0) * 3u;
  let i10 = at + (y0 * w + x1) * 3u;
  let i01 = at + (y1 * w + x0) * 3u;
  let i11 = at + (y1 * w + x1) * 3u;
  let a = vec3f(table[i00], table[i00 + 1u], table[i00 + 2u]);
  let b = vec3f(table[i10], table[i10 + 1u], table[i10 + 2u]);
  let c = vec3f(table[i01], table[i01 + 1u], table[i01 + 2u]);
  let d = vec3f(table[i11], table[i11 + 1u], table[i11 + 2u]);
  let top = a + (b - a) * fx;
  let bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

fn cr_glow(out: vec3f, p: vec2f) -> vec3f {
  let g = cr_glow_at(p);
  let tint = vec3f(params.glow_r, params.glow_g, params.glow_b);
  if (params.glow_style == 0.0) {
    let k = params.glow * ${f(GLOW_STRENGTH.diffusion)} * sqrt(clamp(cr_lum(out), 0.0, 1.0));
    return out + (g * tint - out) * k;
  }
  let k = params.glow * select(${f(GLOW_STRENGTH.halation)}, ${f(GLOW_STRENGTH.bloom)}, params.glow_style == 1.0);
  return out + g * tint * k;
}

// One pixel: straight linear sRGB in and out, at document point p.
fn develop(input: vec3f, p: vec2f) -> vec3f {
  var rgb = input;
  if (params.local == 1.0) { rgb = cr_local(input, p); }
  let top = max(1.0, max(rgb.r, max(rgb.g, rgb.b)));
  var e = cr_encode3(CR_TO_PROPHOTO * rgb);
  if (params.white_balance == 1.0) { e = vec3f(cr_table(1u, e.r), cr_table(2u, e.g), cr_table(3u, e.b)); }
  if (params.tone == 1.0) { e = cr_keep_hue(e); }
  if (params.channels == 1.0) { e = vec3f(cr_table(4u, e.r), cr_table(5u, e.g), cr_table(6u, e.b)); }
  if (params.mixer == 1.0) { e = cr_mix(e); }
  var l = cr_decode3(e);
  if (params.grading == 1.0) { l = cr_grade(l); }
  if (params.vibrance != 1.0) {
    let hi = max(l.r, max(l.g, l.b));
    let lo = min(l.r, min(l.g, l.b));
    var sat = 0.0;
    if (hi > 0.0) { sat = clamp((hi - lo) / hi, 0.0, 1.0); }
    let k = 1.0 + (params.vibrance - 1.0) * pow(1.0 - sat, params.vibrance_spare);
    let pivot = params.vibrance_pivot * hi + (1.0 - params.vibrance_pivot) * lo;
    l = vec3f(pivot) + (l - vec3f(pivot)) * k;
  }
  if (params.saturation != 1.0) {
    let pivot = dot(l, vec3f(${SATURATION_PIVOT.map(f).join(", ")}));
    l = vec3f(pivot) + (l - vec3f(pivot)) * params.saturation;
  }
  if (params.bw == 1.0) { l = vec3f(dot(l, vec3f(${GREY_WEIGHTS.map(f).join(", ")}))); }
  var out = clamp(CR_TO_SRGB * l, vec3f(0.0), vec3f(top));
  if (params.glow > 0.0) { out = cr_glow(out, p); }
  if (params.vignette != 0.0 || params.grain > 0.0) {
    var v = cr_encode3(out);
    if (params.vignette != 0.0) { v = cr_vignette(v, cr_vignette_at(p)); }
    if (params.grain > 0.0) {
      let g = cr_grain_at(p);
      let y0 = clamp(dot(v, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      v += g * params.grain * 0.5 * (0.15 + 3.4 * y0 * (1.0 - y0));
    }
    out = cr_decode3(v);
  }
  return out;
}
`;

const PARAMS_BODY = FIELDS.map((k) => `${k}: f32`).join(", ");

/** Camera Raw as a kernel filter: the content at a point, developed. */
export const CAMERA_RAW_FILTER: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { ${PARAMS_BODY} }
${DEVELOP}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  return vec4f(develop(c.rgb / c.a, p) * c.a, c.a);
}`,
  pack: (params, canvas) => ({ uniform: packFloats(fieldValues(params, canvas)), table: gpuTable(params, canvas), tableKey: tableKey(params, canvas) }),
};

/** Camera Raw as an adjustment layer: what's below, developed. */
export const CAMERA_RAW_ADJUSTMENT: AdjustmentKernel = {
  wgsl: /* wgsl */ `
struct Params { opacity: f32, p0: f32, p1: f32, p2: f32, ${PARAMS_BODY} }
${DEVELOP}
fn adjust(c: vec4f, doc: vec2f) -> vec4f {
  if (c.a <= 0.0) { return c; }
  return vec4f(develop(c.rgb / c.a, doc) * c.a, c.a);
}`,
  pack: (params, opacity, canvas) => ({ uniform: packFloats([opacity, 0, 0, 0, ...fieldValues(params, canvas)]), table: gpuTable(params, canvas) }),
};
