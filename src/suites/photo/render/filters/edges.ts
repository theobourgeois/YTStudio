/** The edge filters' WGSL (shared/photo/effects/filters/edges.ts), mirroring `reference/filters/edges.ts`. */
import { crunchLevels } from "@shared/photo/reference/filters/edges.ts";
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const DEEP_FRY: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { amount: f32, radius: f32, saturation: f32, contrast: f32, warmth: f32, noise: f32, levels: f32, p0: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let r = params.radius;
  var sum = c;
  for (var k = 0; k < 8; k++) {
    let a = (f32(k) + 0.5) * PI / 4.0;
    sum += src(vec2f(p.x + cos(a) * r * 0.5, p.y + sin(a) * r * 0.5));
  }
  for (var k = 0; k < 12; k++) {
    let a = f32(k) * PI / 6.0;
    sum += src(vec2f(p.x + cos(a) * r, p.y + sin(a) * r));
  }
  let b = enc3(unpremul(sum));
  let e = enc3(unpremul(c));
  var v = clamp(e + params.amount * (e - b), vec3f(0.0), vec3f(1.0));
  let l = dot(W709, v);
  v = clamp(l + (v - l) * params.saturation, vec3f(0.0), vec3f(1.0));
  let w = params.warmth;
  v = vec3f(clamp(v.r * (1.0 + 0.5 * w) + 0.04 * w, 0.0, 1.0), clamp(v.g * (1.0 + 0.1 * w), 0.0, 1.0), clamp(v.b * (1.0 - 0.6 * w), 0.0, 1.0));
  v = clamp((v - 0.5) * params.contrast + 0.5, vec3f(0.0), vec3f(1.0));
  let ix = i32(floor(p.x));
  let iy = i32(floor(p.y));
  let grain = vec3f(rand(ix, iy, 11u), rand(ix, iy, 12u), rand(ix, iy, 13u));
  v = clamp(v + (grain - 0.5) * params.noise * 0.6, vec3f(0.0), vec3f(1.0));
  if (params.levels > 0.0) { v = clamp(floor(v * params.levels + 0.5) / params.levels, vec3f(0.0), vec3f(1.0)); }
  return from_encoded(v, c.a);
}`,
  pack: (p) =>
    ({
      uniform: packValues([
        (p.sharpen as number) / 100,
        p.radius as number,
        (p.saturation as number) / 100,
        1 + 3 * ((p.contrast as number) / 100),
        (p.warmth as number) / 100,
        (p.noise as number) / 100,
        crunchLevels(p.crunch as number),
      ]),
    }),
};

const NEON_EDGES: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { width: f32, gain: f32, mode: u32, background: u32, tint: vec3f, p0: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
var<private> sum: vec4f;
var<private> a_max: f32;
fn lum(p: vec2f, d: vec2f) -> f32 {
  let s = src(clamp(p + d * params.width, min(p, vec2f(0.5 * px())), max(p, header.canvas - 0.5 * px())));
  sum += s;
  a_max = max(a_max, s.a);
  return s.a * (0.2 + 0.8 * enc(luma(unpremul(s))));
}
fn hue(h: f32) -> vec3f {
  return clamp(abs(fract(h + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  sum = c;
  a_max = c.a;
  let tl = lum(p, vec2f(-1.0, -1.0));
  let t = lum(p, vec2f(0.0, -1.0));
  let tr = lum(p, vec2f(1.0, -1.0));
  let l = lum(p, vec2f(-1.0, 0.0));
  let r = lum(p, vec2f(1.0, 0.0));
  let bl = lum(p, vec2f(-1.0, 1.0));
  let b = lum(p, vec2f(0.0, 1.0));
  let br = lum(p, vec2f(1.0, 1.0));
  let gx = tr + 2.0 * r + br - (tl + 2.0 * l + bl);
  let gy = bl + 2.0 * b + br - (tl + 2.0 * t + tr);
  let e = smoothstep(0.02, 0.2, length(vec2f(gx, gy)) / 4.0) * params.gain;
  var ink = params.tint;
  if (params.mode == 0u) {
    let v = enc3(unpremul(sum));
    let m = max(max(v.r, max(v.g, v.b)), 0.05);
    let s = v / m;
    let ls = dot(W709, s);
    ink = clamp(ls + (s - ls) * 1.5, vec3f(0.0), vec3f(1.0));
  } else if (params.mode == 2u) {
    ink = hue(atan2(gy, gx) / PI + 1.0);
  }
  let line = min(e, 1.0);
  let a = max(c.a, line * a_max);
  if (params.background == 2u) { return from_encoded(1.0 + (ink - 1.0) * line, a); }
  let light = dec3(ink) * e * a_max;
  var keep = 0.0;
  if (params.background == 1u) { keep = 1.0 - 0.5 * line; }
  return vec4f(c.rgb * keep + light, a);
}`,
  pack: (p) => {
    const tint = hexEncoded(p.tint as string);
    const mode = p.colouring === "tint" ? 1 : p.colouring === "rainbow" ? 2 : 0;
    const background = p.background === "image" ? 1 : p.background === "paper" ? 2 : 0;
    return { uniform: packValues([p.width as number, (p.brightness as number) / 100, { u32: mode }, { u32: background }, tint[0], tint[1], tint[2], 0]) };
  },
};

export const EDGES_KERNELS: Record<string, FilterKernel> = { "deep-fry": DEEP_FRY, edges: NEON_EDGES };
