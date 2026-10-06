/** The colour filters' WGSL (shared/photo/effects/filters/colour.ts), mirroring `reference/filters/colour.ts`. */
import { GRADIENT_TABLE_SIZE, gradientTable } from "@shared/photo/style/gradients.ts";
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import type { Gradient } from "@shared/photo/types.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const GRADIENT_MAP: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: u32, p0: u32, p1: u32, p2: u32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let rgb = unpremul(c);
  let g = table_at(enc(luma(rgb)), params.size);
  return premul(mix(rgb, dec3(g.rgb), g.a), c.a);
}`,
  pack: (p) => ({ uniform: packValues([{ u32: GRADIENT_TABLE_SIZE }]), table: gradientTable(p.gradient as Gradient, p.reverse as boolean) }),
};

const COLOR_GRADE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { warm: f32, saturation: f32, contrast: f32, pivot: f32, sr: f32, sg: f32, sb: f32, toning: f32, hr: f32, hg: f32, hb: f32, fade: f32 }
fn soft_light(a: vec3f, b: vec3f) -> vec3f { return (1.0 - 2.0 * b) * a * a + 2.0 * b * a; }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let e = enc3(unpremul(c));
  var v = vec3f(clamp(e.r * (1.0 + params.warm), 0.0, 1.0), e.g, clamp(e.b * (1.0 - params.warm), 0.0, 1.0));
  let y = luma(v);
  v = clamp(vec3f(y) + (v - vec3f(y)) * params.saturation, vec3f(0.0), vec3f(1.0));
  if (params.contrast > 0.0) {
    v = mix(v, v * v * (3.0 - 2.0 * v), params.contrast);
  } else {
    v = mix(v, vec3f(0.5), -params.contrast * 0.5);
  }
  let l = luma(v);
  var q = 0.5 + 0.5 * (l - params.pivot) / (1.0 - params.pivot);
  if (l < params.pivot) { q = 0.5 * l / params.pivot; }
  let h = smoothstep(0.0, 1.0, q);
  let ws = (1.0 - h) * params.toning;
  let wh = h * params.toning;
  v = mix(v, soft_light(v, vec3f(params.sr, params.sg, params.sb)), ws);
  v = mix(v, soft_light(v, vec3f(params.hr, params.hg, params.hb)), wh);
  v = mix(v, 0.1 + 0.82 * v, params.fade);
  return from_encoded(v, c.a);
}`,
  pack: (p) => {
    const s = hexEncoded(p.shadows as string);
    const h = hexEncoded(p.highlights as string);
    const pivot = 0.5 - 0.4 * ((p.balance as number) / 100);
    return { uniform: packValues([((p.temperature as number) / 100) * 0.12, 1 + (p.saturation as number) / 100, (p.contrast as number) / 100, pivot, ...s, (p.toning as number) / 100, ...h, (p.fade as number) / 100]) };
  },
};

const POSTERIZE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { steps: f32, width: f32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let t = enc3(unpremul(c)) * params.steps;
  let i = floor(t);
  let w = params.width / 2.0;
  return from_encoded((i + smoothstep(vec3f(0.5 - w), vec3f(0.5 + w), t - i)) / params.steps, c.a);
}`,
  pack: (p) => ({ uniform: packValues([(p.levels as number) - 1, Math.max((p.smooth as number) / 100, 1e-3)]) }),
};

const PSYCHEDELIC: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { shift: f32, turns: f32, rainbow: f32, saturation: f32, solarize: f32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let rgb = unpremul(c);
  let e = enc3(rgb);
  let l = enc(luma(rgb));
  let add = params.rainbow * min(l, 1.0 - l);
  let v = e + add * vec3f(2.0 / 3.0, -1.0 / 3.0, -1.0 / 3.0);
  let angle = params.shift + params.turns * l;
  let cs = cos(angle);
  let sn = sin(angle);
  let m = (v.r + v.g + v.b) / 3.0;
  let k = 1.0 / sqrt(3.0);
  let cross = vec3f(v.b - v.g, v.r - v.b, v.g - v.r) * k;
  let turned = v * cs + cross * sn + m * (1.0 - cs);
  let s = clamp(vec3f(m) + (turned - vec3f(m)) * params.saturation, vec3f(0.0), vec3f(1.0));
  let solar = select(2.0 - 2.0 * s, 2.0 * s, s < vec3f(0.5));
  return from_encoded(mix(s, solar, params.solarize), c.a);
}`,
  pack: (p) => ({
    uniform: packValues([((p.shift as number) * Math.PI) / 180, (p.cycles as number) * 2 * Math.PI, (p.rainbow as number) / 100, (p.saturation as number) / 100, (p.solarize as number) / 100]),
  }),
};

export const COLOUR_KERNELS: Record<string, FilterKernel> = { "gradient-map": GRADIENT_MAP, "color-grade": COLOR_GRADE, posterize: POSTERIZE, psychedelic: PSYCHEDELIC };
