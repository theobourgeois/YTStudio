/** The glass filters' WGSL (shared/photo/effects/filters/glass.ts), mirroring `reference/filters/glass.ts`. */
import { DISPERSION } from "@shared/photo/effects/filters/glass.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** What both share: held reads, Frost's seeded taps, the lens's slope, the glow's addLight. */
const GLASS_COMMON = /* wgsl */ `
fn held(v: vec2f, at: vec2f) -> vec2f { return clamp(v, min(at, vec2f(0.5)), max(at, header.canvas - 0.5)); }
fn frost_seed(seed: u32, k: u32) -> u32 { return seed ^ (0x5f3759dfu + k); }
// The picture through glass at p moved by o (red and blue 1 ± d times as far), averaged over Frost's seeded reads.
fn through(p: vec2f, o: vec2f, d: f32, frost: f32, seed: u32) -> vec4f {
  let ix = i32(floor(p.x));
  let iy = i32(floor(p.y));
  var taps = 1u;
  if (frost > 0.0) { taps = 8u; }
  var sum = vec4f(0.0);
  for (var k = 0u; k < taps; k++) {
    var j = vec2f(0.0);
    if (frost > 0.0) {
      j = vec2f(rand(ix, iy, frost_seed(seed, 2u * k)) * 2.0 - 1.0, rand(ix, iy, frost_seed(seed, 2u * k + 1u)) * 2.0 - 1.0) * frost;
    }
    if (d > 0.0) {
      let r = src(held(p + j + o * (1.0 + d), p));
      let g = src(held(p + j + o, p));
      let b = src(held(p + j + o * (1.0 - d), p));
      sum += vec4f(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
    } else {
      sum += src(held(p + j + o, p));
    }
  }
  return sum / f32(taps);
}
fn lens(t: f32) -> f32 { return t / sqrt(1.0 - 0.75 * t * t); }
fn sheen(s: f32, at: f32, w: f32) -> f32 { let z = (s - at) / w; return exp(-z * z); }
// The glow's addLight: no pixel brighter than its coverage, up to white.
fn add_light(c: vec4f, light: vec3f) -> vec4f {
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let o = c.rgb + light;
  return vec4f(o, max(c.a + coverage * (1.0 - c.a), clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`;

const REEDED_GLASS: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { u: vec2f, width: f32, k: f32, d: f32, frost: f32, light: f32, profile: u32, seed: u32 }
${GLASS_COMMON}
fn rib(p: vec2f, s: f32, i: f32) -> vec4f {
  let t = clamp(2.0 * s, -1.0, 1.0);
  var h = 0.5 * t;
  if (params.profile == 0u) { h = -0.5 * lens(t); } else if (params.profile == 1u) { h = 0.5 * lens(t); }
  let o = through(p, params.u * params.k * h, params.d, params.frost, params.seed);
  let w = max(0.04, 0.6 * px() / params.width);
  let a = abs(s);
  var spec: f32;
  var dark: f32;
  if (params.profile == 0u) {
    spec = sheen(s, -0.22, w) + 0.35 * sheen(s, 0.34, w * 0.7);
    dark = smoothstep(0.3, 0.5, a);
  } else if (params.profile == 1u) {
    spec = sheen(a, 0.5, w) + 0.25 * sheen(s, 0.0, w * 3.0);
    dark = (1.0 - smoothstep(0.0, 0.35, a)) * 0.6;
  } else {
    spec = sheen(s, 0.4, w);
    dark = 1.0 - smoothstep(-0.5, 0.1, s);
  }
  // The sheen catches the light unevenly along each rib, as real glass does.
  let q = p - header.canvas / 2.0;
  let along = (-q.x * params.u.y + q.y * params.u.x) / (6.0 * params.width);
  let uneven = 0.35 + 0.9 * vnoise(vec2f(along, i * 3.1), params.seed + 9u);
  let keep = 1.0 - 0.45 * params.light * dark;
  let l = 0.3 * params.light * spec * uneven * o.a;
  return add_light(vec4f(o.rgb * keep, o.a), vec3f(l));
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let q = p - header.canvas / 2.0;
  let u = (q.x * params.u.x + q.y * params.u.y) / params.width + 0.5;
  let s = u - floor(u) - 0.5;
  let i = floor(u);
  let out = rib(p, s, i);
  // The neighbouring rib's share near a seam: half at it, none a pixel away.
  let w = 0.5 * (1.0 - smoothstep(0.0, px(), (0.5 - abs(s)) * params.width));
  if (!(w > 0.0)) { return out; }
  if (s > 0.0) { return mix(out, rib(p, s - 1.0, i + 1.0), w); }
  return mix(out, rib(p, s + 1.0, i - 1.0), w);
}`,
  pack: (p) => {
    const angle = ((p.angle as number) * Math.PI) / 180;
    const width = p.width as number;
    const profile = p.profile === "fluted" ? 1 : p.profile === "prism" ? 2 : 0;
    return {
      uniform: packValues([
        Math.cos(angle),
        Math.sin(angle),
        width,
        ((p.refraction as number) / 100) * width,
        DISPERSION * ((p.dispersion as number) / 100),
        p.frost as number,
        (p.highlight as number) / 100,
        { u32: profile },
        { u32: p.seed as number },
      ]),
    };
  },
};

const GLASS: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { amount: f32, scale: f32, frost: f32, texture: u32, seed: u32 }
${GLASS_COMMON}
// Value noise and its slope on the lattice: (value, d/dx, d/dy).
fn noise_slope(x: f32, y: f32, seed: u32) -> vec3f {
  let ix = i32(floor(x));
  let iy = i32(floor(y));
  let fx = x - floor(x);
  let fy = y - floor(y);
  let ux = fx * fx * (3.0 - 2.0 * fx);
  let uy = fy * fy * (3.0 - 2.0 * fy);
  let dx = 6.0 * fx * (1.0 - fx);
  let dy = 6.0 * fy * (1.0 - fy);
  let a = rand(ix, iy, seed);
  let b = rand(ix + 1, iy, seed);
  let c = rand(ix, iy + 1, seed);
  let e = rand(ix + 1, iy + 1, seed);
  let k = a - b - c + e;
  return vec3f(a + (b - a) * ux + (c - a) * uy + k * ux * uy, dx * (b - a + k * uy), dy * (c - a + k * ux));
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let scale = params.scale;
  let seed = params.seed;
  let qx = p.x / scale;
  let qy = p.y / scale;
  let aa = px();
  var g = vec2f(0.0);
  var dark = 0.0;
  var clear = 0.0;
  var spec = 0.0;
  if (params.texture == 0u) {
    let a = noise_slope(qx, qy, seed);
    let b = noise_slope(qx * 2.03 + 3.7, qy * 2.03 + 1.3, seed + 1u);
    g = vec2f((a.y + 1.015 * b.y) / 1.5, (a.z + 1.015 * b.z) / 1.5);
  } else if (params.texture == 1u) {
    let i = i32(floor(qx));
    let j = i32(floor(qy));
    let tx = (qx - floor(qx)) * 2.0 - 1.0;
    let ty = (qy - floor(qy)) * 2.0 - 1.0;
    let edge = min(1.0 - abs(tx), 1.0 - abs(ty)) * scale / 2.0;
    let fade = smoothstep(0.0, aa, edge);
    let w = noise_slope(qx * 2.5, qy * 2.5, seed + 2u);
    g = vec2f(-0.5 * lens(tx) + 0.2 * (rand(i, j, seed) * 2.0 - 1.0) + 0.4 * w.y, -0.5 * lens(ty) + 0.2 * (rand(i, j, seed + 1u) * 2.0 - 1.0) + 0.4 * w.z) * fade;
    dark = 0.55 * (1.0 - smoothstep(0.0, max(aa, 0.03 * scale), edge));
  } else if (params.texture == 2u) {
    let d = vec2f(qx - floor(qx), qy - floor(qy)) * 2.0 - 1.0;
    let r = min(length(d), 1.0);
    let fade = smoothstep(0.0, aa, (1.0 - r) * scale / 2.0);
    g = d * (-0.5 * fade / sqrt(1.0 - 0.75 * r * r));
    dark = 0.3 * smoothstep(0.7, 1.0, r) * fade;
  } else if (params.texture == 3u) {
    let n = noise_slope(qx * 0.5, qy * 0.5, seed);
    let phase = qy + 0.8 * n.x;
    let w = 0.6 * cos(2.0 * PI * phase);
    g = vec2f(w * 0.4 * n.y, w * (1.0 + 0.4 * n.z));
  } else {
    let i = i32(floor(qx));
    let j = i32(floor(qy));
    if (rand(i, j, seed + 3u) < 0.6) {
      let r = 0.16 + 0.28 * rand(i, j, seed + 4u);
      let d = vec2f(qx - (f32(i) + r + (1.0 - 2.0 * r) * rand(i, j, seed + 5u)), qy - (f32(j) + r + (1.0 - 2.0 * r) * rand(i, j, seed + 6u))) / r;
      let rho = min(length(d), 1.0);
      clear = smoothstep(0.0, aa, (1.0 - rho) * r * scale);
      g = d * (-0.6 * clear / sqrt(1.0 - 0.75 * rho * rho));
      dark = 0.55 * smoothstep(0.5, 1.0, rho) * clear;
      let h = d + vec2f(0.35, 0.4);
      spec = clear * exp(-dot(h, h) / 0.03);
    }
  }
  let o_off = clamp(g * params.amount, vec2f(-params.amount), vec2f(params.amount));
  var o: vec4f;
  if (params.texture != 4u) {
    o = through(p, o_off, 0.0, params.frost, seed);
  } else {
    o = vec4f(0.0);
    if (clear < 1.0) { o = through(p, vec2f(0.0), 0.0, params.frost, seed); }
    if (clear > 0.0) { o = mix(o, through(p, o_off, 0.0, 0.0, seed), clear); }
  }
  let l = 1.2 * spec * o.a;
  return add_light(vec4f(o.rgb * (1.0 - dark), o.a), vec3f(l));
}`,
  pack: (p) => ({
    uniform: packValues([
      p.distortion as number,
      p.scale as number,
      p.frost as number,
      { u32: ["frosted", "blocks", "lens", "rippled", "drops"].indexOf(p.texture as string) },
      { u32: p.seed as number },
    ]),
  }),
};

export const GLASS_KERNELS: Record<string, FilterKernel> = { "reeded-glass": REEDED_GLASS, glass: GLASS };
