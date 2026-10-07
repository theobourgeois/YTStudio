/** The atmosphere filters' WGSL (shared/photo/effects/filters/atmosphere.ts), mirroring `reference/filters/atmosphere.ts`. */
import { PARTICLE_KINDS } from "@shared/photo/effects/filters/atmosphere.ts";
import { dec3, hexEncoded, mix } from "@shared/photo/reference/kernel.ts";
import { DEPTH_SCALE } from "@shared/photo/reference/filters/atmosphere.ts";
import { warpCentre } from "@shared/photo/reference/filters/warp.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const FOG: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { tint: vec3f, density: f32, glowTint: vec3f, glow: f32, light: vec2f, start: f32, ground: f32, height: f32, wisps: f32, scale: f32, spread: f32, soften: f32, seed: u32 }
fn fbm(q0: vec2f, seed: u32) -> f32 {
  var sum = 0.0;
  var amp = 0.5;
  var q = q0;
  for (var k = 0u; k < 4u; k++) {
    sum += amp * vnoise(q, seed + k);
    q = rotate(q, 0.6) * 2.03 + vec2f(5.2, 1.3);
    amp *= 0.5;
  }
  return sum / 0.9375;
}
fn held(v: vec2f, at: vec2f) -> vec2f { return clamp(v, min(at, vec2f(0.5)), max(at, header.canvas - 0.5)); }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let depth = scene_at(p).x;
  let dist = clamp((params.start - depth) / params.start, 0.0, 1.0);
  let low = exp(-clamp((header.canvas.y - p.y) / header.canvas.y, 0.0, 1.0) / params.height);
  var w = 1.0;
  if (params.wisps > 0.0) {
    w = mix(1.0, 2.0 * smoothstep(0.2, 0.8, fbm(vec2f(p.x / params.scale, p.y / (params.scale * 0.5)), params.seed)), params.wisps);
  }
  let tau = (params.density * dist + params.ground * low * (0.3 + 0.7 * (1.0 - depth))) * w;
  let f = 1.0 - exp(-tau);
  var b = c;
  let r = params.soften * f;
  if (r > 0.5) {
    var sum = c;
    for (var k = 0; k < 8; k++) {
      let a = (f32(k) + 0.5) * PI / 4.0;
      var s = r;
      if (k % 2 == 1) { s = 0.5 * r; }
      sum += src(held(p + vec2f(cos(a), sin(a)) * s, p));
    }
    b = sum / 9.0;
  }
  let d = length(p - params.light) / params.spread;
  let g = params.glow * (0.7 * exp(-d * d) + 0.3 * exp(-2.0 * d));
  let lit = params.tint + params.glowTint * g;
  let o = vec4f(b.rgb * (1.0 - f) + lit * f, b.a * (1.0 - f) + f);
  // The glow's coverage rule: no pixel brighter than its coverage, up to white.
  return vec4f(o.rgb, max(o.a, clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`,
  pack: (p, canvas) => {
    const diag = Math.hypot(canvas.width, canvas.height);
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        ((p.density as number) / 100) * 4,
        ...dec3(hexEncoded(p.glowColour as string)),
        (p.glow as number) / 100,
        ...warpCentre(p.light, canvas),
        Math.max(1e-3, (p.start as number) / 100),
        ((p.ground as number) / 100) * 3,
        Math.max(0.01, (p.height as number) / 100),
        (p.wisps as number) / 100,
        Math.max(1, p.scale as number),
        Math.max(1, ((p.spread as number) / 100) * diag),
        p.soften as number,
        { u32: p.seed as number },
      ]),
    };
  },
};

const DEPTH_PARTICLES: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { tint: vec3f, gain: f32, tint2: vec3f, glow: f32, kind: u32, layers: u32, seed: u32, size: f32, far: f32, near: f32, focus: f32, blur: f32, ca: f32, sa: f32, streak: f32, spacing: f32, presence: f32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let ds = scene_at(p).x;
  let qa = p.x * params.ca - p.y * params.sa;
  let qb = p.x * params.sa + p.y * params.ca;
  let lum = enc(luma(unpremul(c)));
  let bokeh = params.kind == 4u;
  var ratio = 2.0;
  if (params.kind == 3u) { ratio = 4.0; }
  var o = c;
  var light = vec3f(0.0);
  let layers = min(params.layers, 6u);
  let n = f32(layers);
  for (var k = 0u; k < layers; k++) {
    let lo = mix(params.far, params.near, f32(k) / n);
    let hi = mix(params.far, params.near, f32(k + 1u) / n);
    let cw = max(3.0, params.size * exp2(3.0 * (max(lo, hi) - 1.0)) * 1.3 * params.spacing);
    let ch = cw * ratio;
    let ks = params.seed + 101u * (k + 1u);
    let ci = i32(floor(qa / cw));
    let cj = i32(floor(qb / ch));
    for (var dj = -1; dj <= 1; dj++) {
      for (var di = -1; di <= 1; di++) {
        let i = ci + di;
        let j = cj + dj;
        if (!(rand(i, j, ks) < params.presence)) { continue; }
        let pa = (f32(i) + rand(i, j, ks + 1u)) * cw;
        let pb = (f32(j) + rand(i, j, ks + 2u)) * ch;
        let dp = mix(lo, hi, rand(i, j, ks + 3u));
        let vis = clamp((dp - ds) / 0.03 + 1.0, 0.0, 1.0);
        if (!(vis > 0.0)) { continue; }
        let r = params.size * exp2(3.0 * (dp - 1.0)) * (0.6 + 0.7 * rand(i, j, ks + 4u));
        let bl = params.blur * abs(dp - params.focus) * params.size * 3.0;
        var R = r + bl;
        var e = max(px(), 0.4 * bl + 0.15 * r);
        if (bokeh) {
          R = r;
          e = max(px(), 0.06 * r + 0.5 * bl);
        }
        let Re = max(R, 0.5 * e);
        var ke = r / Re;
        if (bokeh) { ke = 1.0; }
        let outer = Re + 0.5 * e;
        var want = r * 8.0 * params.streak;
        if (params.kind == 3u) { want = r * (4.0 + 16.0 * params.streak); }
        let Lh = min(want, ch - cw);
        let dA = qa - pa;
        let dB = qb - pb;
        let dB2 = dB - clamp(dB, -Lh, Lh);
        let dist = sqrt(dA * dA + dB2 * dB2);
        if (!(dist < cw)) { continue; }
        var cov = 1.0 - smoothstep(Re - 0.5 * e, Re + 0.5 * e, dist);
        if (bokeh) { cov *= 0.55 + 0.45 * smoothstep(0.5 * Re, Re, dist); }
        let Hh = min(2.5 * outer, cw);
        let q = dist / Hh;
        var halo = 0.0;
        if (q < 1.0) { let t3 = 1.0 - q * q; halo = t3 * t3 * t3; }
        let col = mix(params.tint, params.tint2, rand(i, j, ks + 5u));
        let rv = rand(i, j, ks + 6u);
        let cv = cov * ke * vis;
        let h = params.glow * 0.3 * halo * vis * ke;
        if (params.kind == 0u) {
          let a = clamp(cv * 0.9 * (0.6 + 0.4 * rv) * params.gain, 0.0, 1.0);
          o = vec4f(o.rgb * (1.0 - a) + col * a, o.a * (1.0 - a) + a);
          light += col * h;
        } else {
          var br = params.gain * 0.6 * (0.3 + 0.7 * rv);
          if (params.kind == 1u) { br = params.gain * (0.15 + 0.85 * rv * rv) * (0.05 + 2.0 * lum * lum); }
          else if (params.kind == 2u) { br = params.gain * 1.5 * (0.35 + 0.65 * rv); }
          else if (params.kind == 3u) { br = params.gain * 0.4 * (0.4 + 0.6 * rv); }
          light += col * br * (cv + h);
        }
      }
    }
  }
  // The glow's addLight: no pixel brighter than its coverage, up to white.
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let lit = o.rgb + light;
  return vec4f(lit, max(o.a + coverage * (1.0 - o.a), clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0)));
}`,
  pack: (p) => {
    const kind = PARTICLE_KINDS[p.kind as string] ?? 0;
    const amount = (p.amount as number) / 100;
    const angle = ((p.angle as number) * Math.PI) / 180;
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        Math.pow(2, p.intensity as number),
        ...dec3(hexEncoded(p.colour2 as string)),
        (p.glow as number) / 100,
        { u32: kind },
        { u32: Math.max(1, Math.min(6, Math.round(p.layers as number))) },
        { u32: p.seed as number },
        p.size as number,
        (p.far as number) / 100,
        (p.near as number) / 100,
        (p.focus as number) / 100,
        (p.blur as number) / 100,
        Math.cos(angle),
        Math.sin(angle),
        (p.streak as number) / 100,
        mix(16, 5, amount) / Math.sqrt(kind === 3 ? 4 : 2),
        Math.min(1, amount * 2),
      ]),
    };
  },
};

const RELIGHT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { tint: vec3f, gain: f32, ambient: vec3f, falloff: f32, rimTint: vec3f, rim: f32, light: vec2f, lift: f32, relief: f32, r: f32, depthScale: f32 }
fn depth_at(p: vec2f, i: f32, j: f32) -> f32 { return scene_at(p + vec2f(i, j) * params.r).x; }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let d0 = scene_at(p).x;
  let mm = depth_at(p, -1.0, -1.0);
  let zm = depth_at(p, 0.0, -1.0);
  let pm = depth_at(p, 1.0, -1.0);
  let mz = depth_at(p, -1.0, 0.0);
  let pz = depth_at(p, 1.0, 0.0);
  let mp = depth_at(p, -1.0, 1.0);
  let zp = depth_at(p, 0.0, 1.0);
  let pp = depth_at(p, 1.0, 1.0);
  let gx = (pm + 2.0 * pz + pp - (mm + 2.0 * mz + mp)) / (8.0 * params.r);
  let gy = (mp + 2.0 * zp + pp - (mm + 2.0 * zm + pm)) / (8.0 * params.r);
  let mean = (mm + zm + pm + mz + pz + mp + zp + pp) / 8.0;
  // The far side of an edge keeps its own slope: what's in front isn't its shape.
  let side = clamp((d0 - mean) / 0.01 + 1.0, 0.0, 1.0);
  let nn = normalize(vec3f(-gx * params.relief * side, -gy * params.relief * side, 1.0));
  let v = vec3f(params.light - p, params.depthScale + params.lift - d0 * params.depthScale);
  let dist = max(1.0, length(v));
  let lambert = max(0.0, dot(nn, v) / dist);
  let atten = min(4.0, pow(max(1.0, params.lift) / dist, params.falloff));
  let k = params.gain * lambert * atten;
  let shade = params.ambient + params.tint * k;
  let lit = vec4f(c.rgb * shade, c.a);
  var added = 0.0;
  if (params.rim > 0.0) {
    let hl = length(nn.xy);
    let al = length(v.xy);
    var away = 0.0;
    if (hl > 1e-6 && al > 1e-6) { away = -dot(nn.xy, v.xy) / (hl * al); }
    let nearer = clamp((d0 - mean) / 0.02 + 0.5, 0.0, 1.0);
    added = params.rim * 1.2 * pow(max(0.0, 1.0 - nn.z), 1.5) * (0.25 + 0.75 * max(0.0, away)) * nearer * c.a;
  }
  // The glow's addLight: no pixel brighter than its coverage, up to white.
  let light = params.rimTint * added;
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let o = lit.rgb + light;
  return vec4f(o, max(lit.a + coverage * (1.0 - lit.a), clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`,
  pack: (p, canvas) => {
    const diag = Math.hypot(canvas.width, canvas.height);
    const ambient = (p.ambient as number) / 100;
    const ambientTint = dec3(hexEncoded(p.ambientColour as string));
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        Math.pow(2, p.intensity as number),
        ambient * ambientTint[0],
        ambient * ambientTint[1],
        ambient * ambientTint[2],
        ((p.falloff as number) / 100) * 2,
        ...dec3(hexEncoded(p.rimColour as string)),
        (p.rim as number) / 100,
        ...warpCentre(p.light, canvas),
        ((p.height as number) / 100) * diag,
        ((p.relief as number) / 100) * 0.5 * diag,
        Math.max(1, p.smoothness as number),
        DEPTH_SCALE * diag,
      ]),
    };
  },
};

export const ATMOSPHERE_KERNELS: Record<string, FilterKernel> = { fog: FOG, "depth-particles": DEPTH_PARTICLES, relight: RELIGHT };
