/** The surface filters' WGSL (shared/photo/effects/filters/surface.ts), mirroring `reference/filters/surface.ts`. */
import { HOLO_PALETTES } from "@shared/photo/reference/filters/surface.ts";
import { GRADIENT_TABLE_SIZE, gradientTable } from "@shared/photo/style/gradients.ts";
import type { Gradient } from "@shared/photo/types.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** The surface's height and slope from a disc of reads (the reference's `surface`). */
const SURFACE = /* wgsl */ `
fn held(v: vec2f, at: vec2f) -> vec2f { return clamp(v, min(at, vec2f(0.5)), max(at, header.canvas - 0.5)); }
fn height(s: vec4f) -> f32 { return s.a * enc(luma(unpremul(s))); }
// (height, slope x, slope y): the height smoothed over a disc of r, its change across r.
fn surface(p: vec2f, c: vec4f, r: f32) -> vec3f {
  var sum = height(c);
  var inner = vec2f(0.0);
  var outer = vec2f(0.0);
  for (var k = 0; k < 8; k++) {
    let a = (f32(k) + 0.5) * PI / 4.0;
    let d = vec2f(cos(a), sin(a));
    let h = height(src(held(p + d * r * 0.5, p)));
    sum += h;
    inner += h * d;
  }
  for (var k = 0; k < 12; k++) {
    let a = f32(k) * PI / 6.0;
    let d = vec2f(cos(a), sin(a));
    let h = height(src(held(p + d * r, p)));
    sum += h;
    outer += h * d;
  }
  let slope = 0.5 * (outer / 6.0 + inner / 2.0);
  return vec3f(sum / 21.0, slope);
}`;

const CHROME: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { light: vec3f, bands: f32, r: f32, depth: f32, contrast: f32, size: u32 }
${SURFACE}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let s = surface(p, c, params.r);
  let n = vec3f(-s.y * params.depth, -s.z * params.depth, 1.0);
  let shade = dot(n, params.light) / length(n) - params.light.z;
  var v = 0.5 - 0.5 * cos(2.0 * PI * params.bands * (s.x + 0.35 * shade));
  v = clamp(v + 0.5 * shade, 0.0, 1.0);
  let s1 = v * v * (3.0 - 2.0 * v);
  v = mix(v, s1 * s1 * (3.0 - 2.0 * s1), params.contrast);
  let g = table_at(v, params.size);
  return premul(mix(unpremul(c), dec3(g.rgb), g.a), c.a);
}`,
  pack: (p) => {
    const angle = ((p.angle as number) * Math.PI) / 180;
    const elevation = (40 * Math.PI) / 180;
    return {
      uniform: packValues([
        Math.cos(angle) * Math.cos(elevation),
        Math.sin(angle) * Math.cos(elevation),
        Math.sin(elevation),
        p.reflections as number,
        p.smoothness as number,
        4 * ((p.relief as number) / 100),
        (p.contrast as number) / 100,
        { u32: GRADIENT_TABLE_SIZE },
      ]),
      table: gradientTable(p.environment as Gradient),
    };
  },
};

const HOLOGRAPHIC: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { pa: vec3f, amount: f32, pb: vec3f, bands: f32, pd: vec3f, tone: f32, u: vec2f, relief: f32, radius: f32, sparkle: f32, size: f32, seed: u32, foil: u32 }
${SURFACE}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let rgb = unpremul(c);
  let e = enc3(rgb);
  let l = enc(luma(rgb));
  var slope = vec2f(0.0);
  if (params.relief > 0.0) { slope = surface(p, c, params.radius).yz; }
  let q = p - header.canvas / 2.0;
  let phase = params.bands * (q.x * params.u.x + q.y * params.u.y) / length(header.canvas) + params.tone * l + 1.5 * params.relief * (slope.x * params.u.x + slope.y * params.u.y);
  let f = clamp(params.pa + params.pb * cos(2.0 * PI * (phase + params.pd)), vec3f(0.0), vec3f(1.0));
  var o: vec3f;
  if (params.foil == 1u) {
    o = clamp(f * (0.3 + 0.95 * l) + 0.25 * l * l, vec3f(0.0), vec3f(1.0));
  } else {
    let over = select(1.0 - 2.0 * (1.0 - e) * (1.0 - f), 2.0 * e * f, e < vec3f(0.5));
    let screen = 1.0 - (1.0 - e) * (1.0 - f);
    o = 0.5 * (over + screen);
  }
  let out = from_encoded(mix(e, o, params.amount), c.a);
  if (!(params.sparkle > 0.0)) { return out; }
  let ix = i32(floor(p.x / params.size));
  let iy = i32(floor(p.y / params.size));
  let flash = smoothstep(1.0 - 0.12 * params.sparkle, 1.0, rand(ix, iy, params.seed));
  if (!(flash > 0.0)) { return out; }
  // A diamond flake in its cell, its edge smoothed over a pixel evaluated.
  let fx = p.x / params.size - f32(ix) - 0.5;
  let fy = p.y / params.size - f32(iy) - 0.5;
  let mask = clamp((0.5 - abs(fx) - abs(fy)) * params.size / px() + 0.5, 0.0, 1.0);
  let twinkle = 0.5 + 0.5 * cos(2.0 * PI * (2.0 * phase + rand(ix, iy, params.seed + 1u)));
  let b = 4.0 * params.sparkle * flash * mask * (0.25 + 0.75 * twinkle) * c.a;
  let light = b * (0.5 + 0.5 * dec3(f));
  // The glow's addLight: no pixel brighter than its coverage, up to white.
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let lit = out.rgb + light;
  return vec4f(lit, max(out.a + coverage * (1.0 - out.a), clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0)));
}`,
  pack: (p) => {
    const pal = HOLO_PALETTES[p.palette as string] ?? HOLO_PALETTES.rainbow;
    const angle = ((p.angle as number) * Math.PI) / 180;
    return {
      uniform: packValues([
        ...pal.a,
        (p.amount as number) / 100,
        ...pal.b,
        p.bands as number,
        ...pal.d,
        (p.tone as number) / 100,
        Math.cos(angle),
        Math.sin(angle),
        (p.relief as number) / 100,
        p.radius as number,
        (p.sparkle as number) / 100,
        p.size as number,
        { u32: p.seed as number },
        { u32: p.mode === "foil" ? 1 : 0 },
      ]),
    };
  },
};

export const SURFACE_KERNELS: Record<string, FilterKernel> = { chrome: CHROME, holographic: HOLOGRAPHIC };
