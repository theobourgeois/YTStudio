/** The film filters' WGSL (shared/photo/effects/filters/film.ts), mirroring `reference/filters/film.ts`. */
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const GRAIN: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { amount: f32, size: f32, chroma: f32, response: f32, dust: f32, seed: u32 }
fn grain_noise(q: vec2f, seed: u32) -> f32 {
  return vnoise(q, seed) + vnoise(vec2f(q.x * 1.93 + 7.1, q.y * 1.93 + 3.3), seed + 11u) - 1.0;
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let v = enc3(unpremul(c));
  let q = p / params.size;
  let mono = grain_noise(q, params.seed);
  var g = vec3f(mono);
  if (params.chroma > 0.0) {
    g = vec3f(
      mix(mono, grain_noise(q + vec2f(31.7, 11.3), params.seed + 101u), params.chroma),
      mix(mono, grain_noise(q + vec2f(57.1, 23.9), params.seed + 202u), params.chroma),
      mix(mono, grain_noise(q + vec2f(83.3, 47.5), params.seed + 303u), params.chroma));
  }
  let y0 = clamp(luma(v), 0.0, 1.0);
  let weight = mix(1.0, 0.15 + 3.4 * y0 * (1.0 - y0), params.response);
  let k = params.amount * 0.45 * weight;
  var o = v + g * k;
  if (params.dust > 0.0) {
    let cell = params.size * 48.0;
    let cx = i32(floor(p.x / cell));
    let cy = i32(floor(p.y / cell));
    if (rand(cx, cy, params.seed + 500u) < params.dust * 0.3) {
      let r = params.size * (0.6 + 1.8 * rand(cx, cy, params.seed + 501u));
      let sx = (f32(cx) + 0.25 + 0.5 * rand(cx, cy, params.seed + 502u)) * cell;
      let sy = (f32(cy) + 0.25 + 0.5 * rand(cx, cy, params.seed + 503u)) * cell;
      let o2 = vec2f(p.x - sx, p.y - sy);
      let ragged = length(o2) / (0.7 + 0.6 * vnoise(vec2f(o2.x / r * 1.3 + 0.5, o2.y / r * 1.3 + 0.5), params.seed + 505u));
      let speck = 1.0 - smoothstep(r - 0.5 * px(), r + 0.5 * px(), ragged);
      let tone = select(0.05, 1.0, rand(cx, cy, params.seed + 504u) < 0.75);
      o = mix(o, vec3f(tone), speck * 0.85);
    }
    let band = params.size * 160.0;
    let bx = i32(floor(p.x / band));
    if (rand(bx, 0, params.seed + 600u) < params.dust * 0.45) {
      let sx = (f32(bx) + 0.2 + 0.6 * rand(bx, 1, params.seed + 600u)) * band + (vnoise(vec2f(p.y / (band * 1.5), f32(bx) * 7.0 + 0.5), params.seed + 601u) - 0.5) * band * 0.15;
      let hw = max(0.2 * params.size, 0.5 * px());
      let line = 1.0 - smoothstep(hw, hw + px(), abs(p.x - sx));
      let broken = smoothstep(0.4, 0.65, vnoise(vec2f(p.y / (params.size * 90.0), f32(bx) * 7.0 + 3.5), params.seed + 602u));
      o = mix(o, vec3f(0.95), line * broken * 0.6);
    }
  }
  return from_encoded(o, c.a);
}`,
  pack: (p) => ({
    uniform: packValues([(p.amount as number) / 100, p.size as number, (p.chroma as number) / 100, (p.response as number) / 100, (p.dust as number) / 100, { u32: p.seed as number }]),
  }),
};

const VIGNETTE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { edge: vec3f, strength: f32, extents: vec2f, power: f32, middle: f32, feather: f32, p0: f32, p1: f32, p2: f32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let v = enc3(unpremul(c));
  let h = header.canvas / 2.0;
  let d2 = abs(p - h) / params.extents + vec2f(1e-6);
  let d = pow(pow(d2.x, params.power) + pow(d2.y, params.power), 1.0 / params.power);
  let hw = 0.6 * params.feather + px() / min(params.extents.x, params.extents.y);
  let k = smoothstep(params.middle - hw, params.middle + hw, d) * params.strength;
  return from_encoded(mix(v, params.edge, k), c.a);
}`,
  pack: (p, canvas) => {
    const amount = (p.amount as number) / 100;
    const round = (p.roundness as number) / 100;
    const edge = amount < 0 ? hexEncoded(p.colour as string) : [1, 1, 1];
    const hx = canvas.width / 2;
    const hy = canvas.height / 2;
    const t = Math.max(0, round);
    const ex = hx + ((hx + hy) / 2 - hx) * t;
    const ey = hy + ((hx + hy) / 2 - hy) * t;
    return { uniform: packValues([...edge, Math.abs(amount), ex, ey, 2 + Math.max(0, -round) * 4, 0.25 + ((p.size as number) / 100) * 1.1, (p.feather as number) / 100, 0, 0, 0]) };
  },
};

export const FILM_KERNELS: Record<string, FilterKernel> = { grain: GRAIN, vignette: VIGNETTE };
