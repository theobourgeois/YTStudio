/**
 * Hue/Saturation's GPU passes (docs/photo/hue-saturation.md): one function, `hue_saturation`, mirroring
 * `hueSaturationPixel` (shared/photo/reference/hue-saturation.ts) step for step, read by both: the kernel filter's
 * (`HUE_SATURATION_FILTER`, a Smart Filter on a layer) and the adjustment's (`HUE_SATURATION_ADJUSTMENT`). Change
 * both sides together; `scripts/photo-sheet.ts hue-saturation` holds them to each other.
 */
import { HUE_RANGES, RANGE_INNER, RANGE_OUTER } from "@shared/photo/effects/hue-saturation.ts";
import { NEUTRAL_CHROMA, hueSaturationSettings } from "@shared/photo/reference/hue-saturation.ts";
import type { EffectParamValue } from "@shared/photo/types.ts";
import type { AdjustmentKernel } from "./adjustments.ts";
import type { FilterKernel } from "./kernel.ts";

/** The parameters' fields: Master (h, s, l, colorize), Colorize's hue and saturation, then each range's h, s, l and centre. */
const FIELDS = `master: vec4f, colorize: vec4f, ranges: array<vec4f, ${HUE_RANGES.length}>`;

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

const HUE_SATURATION = /* wgsl */ `
fn hs_hue(v: vec3f) -> f32 {
  let mx = max(v.r, max(v.g, v.b));
  let c = mx - min(v.r, min(v.g, v.b));
  if (!(c > 0.0)) { return 0.0; }
  var h: f32;
  if (mx == v.r) { h = (v.g - v.b) / c; } else if (mx == v.g) { h = (v.b - v.r) / c + 2.0; } else { h = (v.r - v.g) / c + 4.0; }
  h *= 60.0;
  if (h < 0.0) { h += 360.0; }
  return h;
}
fn hs_weight(hue: f32, centre: f32) -> f32 {
  let d = abs((((hue - centre) % 360.0) + 540.0) % 360.0 - 180.0);
  return clamp((${f(RANGE_OUTER)} - d) / ${f(RANGE_OUTER - RANGE_INNER)}, 0.0, 1.0);
}
fn hs_from_hsl(h: f32, s: f32, l: f32) -> vec3f {
  let a = s * min(l, 1.0 - l);
  let k0 = vec3f(0.0, 8.0, 4.0) + vec3f(h / 30.0);
  let k = ((k0 % vec3f(12.0)) + vec3f(12.0)) % vec3f(12.0);
  return vec3f(l) - a * max(vec3f(-1.0), min(min(k - 3.0, 9.0 - k), vec3f(1.0)));
}
fn hs_lighten(v: vec3f, l: f32) -> vec3f {
  if (l > 0.0) { return v + (1.0 - v) * l; }
  if (l < 0.0) { return v * (1.0 + l); }
  return v;
}
fn hs_encoded(v: vec3f) -> vec3f {
  let mx = max(v.r, max(v.g, v.b));
  let mn = min(v.r, min(v.g, v.b));
  let L = (mx + mn) / 2.0;
  if (params.master.w > 0.5) {
    return hs_lighten(hs_from_hsl(params.colorize.x, params.colorize.y, L), params.master.z);
  }
  let chroma = mx - mn;
  let hue = hs_hue(v);
  let fade = min(1.0, chroma / ${f(NEUTRAL_CHROMA)});
  var d = params.master.xyz;
  for (var i = 0u; i < ${HUE_RANGES.length}u; i++) {
    let r = params.ranges[i];
    d += hs_weight(hue, r.w) * fade * r.xyz;
  }
  let ds = clamp(d.y, -1.0, 1.0);
  let dl = clamp(d.z, -1.0, 1.0);
  var S = 0.0;
  if (chroma > 0.0) { S = chroma / (1.0 - abs(2.0 * L - 1.0)); }
  var out = v;
  if (d.x != 0.0 && chroma > 0.0) { out = hs_from_hsl(hue + d.x, S, L); }
  if (ds > 0.0 && S > 0.0) {
    var a = 1.0 - ds;
    if (ds + S >= 1.0) { a = S; }
    out = out + (out - vec3f(L)) * (1.0 / a - 1.0);
  } else if (ds < 0.0) {
    out = vec3f(L) + (out - vec3f(L)) * (1.0 + ds);
  }
  return hs_lighten(out, dl);
}
fn hue_saturation(rgb: vec3f) -> vec3f {
  let inside = clamp(rgb, vec3f(0.0), vec3f(1.0));
  let e = clamp(hs_encoded(vec3f(linear_to_srgb(inside.r), linear_to_srgb(inside.g), linear_to_srgb(inside.b))), vec3f(0.0), vec3f(1.0));
  return vec3f(srgb_to_linear(e.r), srgb_to_linear(e.g), srgb_to_linear(e.b)) + (rgb - inside);
}
`;

/** The fields' values, in `FIELDS`' order. */
function fieldValues(params: Record<string, EffectParamValue>): number[] {
  const s = hueSaturationSettings(params);
  return [...s.master, s.colorize ? 1 : 0, s.colorizeHue, s.colorizeSaturation, 0, 0, ...s.ranges.flatMap((r, i) => [...r, HUE_RANGES[i].centre])];
}

const packFloats = (values: number[]) => new Float32Array(values).buffer as ArrayBuffer;

/** As a kernel filter: the content at a point. */
export const HUE_SATURATION_FILTER: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { ${FIELDS} }
${HUE_SATURATION}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  return vec4f(hue_saturation(c.rgb / c.a) * c.a, c.a);
}`,
  pack: (params) => ({ uniform: packFloats(fieldValues(params)) }),
};

/** As an adjustment layer: what's below. */
export const HUE_SATURATION_ADJUSTMENT: AdjustmentKernel = {
  wgsl: /* wgsl */ `
struct Params { opacity: f32, p0: f32, p1: f32, p2: f32, ${FIELDS} }
${HUE_SATURATION}
fn adjust(c: vec4f, doc: vec2f) -> vec4f {
  if (c.a <= 0.0) { return c; }
  return vec4f(hue_saturation(c.rgb / c.a) * c.a, c.a);
}`,
  pack: (params, opacity) => ({ uniform: packFloats([opacity, 0, 0, 0, ...fieldValues(params)]) }),
};
