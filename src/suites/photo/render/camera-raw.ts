/**
 * Camera Raw's GPU develop (docs/photo/camera-raw.md, "The renderer"): one function, `develop`, mirroring
 * `developPixel` (shared/photo/effects/camera-raw/develop.ts) step for step, read by both of Camera Raw's passes:
 * the kernel filter's (`CAMERA_RAW_FILTER`, a Smart Filter on a layer) and the adjustment's (`CAMERA_RAW_ADJUSTMENT`).
 * Both read the same table: the develop's curves (`developTable`), then the darkening tone coordinate.
 */
import { V_DARKEN } from "@shared/photo/effects/camera-raw/measured.ts";
import {
  DEVELOP_TABLE_CURVES,
  DEVELOP_TABLE_SIZE,
  GREY_WEIGHTS,
  PROPHOTO_TO_SRGB,
  SATURATION_PIVOT,
  SRGB_TO_PROPHOTO,
  VIGNETTE,
  VIGNETTE_GREY,
  developSettings,
  developTable,
} from "@shared/photo/effects/camera-raw/develop.ts";
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
  };
  return FIELDS.map((k) => values[k]);
}

/** The develop's table and the darkening tone coordinate after it. */
function gpuTable(params: Record<string, EffectParamValue>): Float32Array {
  const curves = developTable(params);
  const table = new Float32Array(curves.length + 256);
  table.set(curves);
  table.set(V_DARKEN, curves.length);
  return table;
}

/** Packs `values` as f32s, padded to a multiple of 16 bytes. */
function packFloats(values: number[]): ArrayBuffer {
  const data = new ArrayBuffer(Math.ceil((values.length * 4) / 16) * 16);
  new Float32Array(data).set(values);
  return data;
}

const N = DEVELOP_TABLE_SIZE;
const V_OFFSET = DEVELOP_TABLE_CURVES * N;

/** The develop's WGSL, after a `struct Params` holding `FIELDS` and `table` are declared. */
const DEVELOP = /* wgsl */ `
const CR_N: u32 = ${N}u;
const CR_V: u32 = ${V_OFFSET}u;
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

// One pixel: straight linear sRGB in and out, at document point p.
fn develop(rgb: vec3f, p: vec2f) -> vec3f {
  let top = max(1.0, max(rgb.r, max(rgb.g, rgb.b)));
  var e = cr_encode3(CR_TO_PROPHOTO * rgb);
  if (params.white_balance == 1.0) { e = vec3f(cr_table(1u, e.r), cr_table(2u, e.g), cr_table(3u, e.b)); }
  if (params.tone == 1.0) { e = cr_keep_hue(e); }
  if (params.channels == 1.0) { e = vec3f(cr_table(4u, e.r), cr_table(5u, e.g), cr_table(6u, e.b)); }
  var l = cr_decode3(e);
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
  pack: (params, canvas) => ({ uniform: packFloats(fieldValues(params, canvas)), table: gpuTable(params) }),
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
  pack: (params, opacity, canvas) => ({ uniform: packFloats([opacity, 0, 0, 0, ...fieldValues(params, canvas)]), table: gpuTable(params) }),
};
