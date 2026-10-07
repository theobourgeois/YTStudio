/** The subject filters' WGSL (shared/photo/effects/filters/subject.ts), mirroring `reference/filters/subject.ts`. */
import {
  AURA_MODES,
  AURA_TAPS,
  GLOW_LANES,
  GOLDEN_ANGLE,
  OUTLINE2_RINGS,
  OUTLINE_RINGS,
  POOL_TAPS,
  RAY_TAPS,
  RIM_LANES,
  RIM_STEPS,
  SHADOW_TAPS,
  STICKER_BACKGROUNDS,
  shadowShape,
  subjectCentre,
} from "@shared/photo/reference/filters/subject.ts";
import { dec3, hexEncoded } from "@shared/photo/reference/kernel.ts";
import { sceneOf } from "@shared/photo/scene.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

/** A float literal for WGSL. */
const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/** The reference's `blurredSubject` and `turnAt`: the subject map blurred over a disc, its spiral turned per pixel. */
const BLURRED = /* wgsl */ `
const GOLDEN: f32 = ${GOLDEN_ANGLE};
fn blurred_subject(p: vec2f, radius: f32, taps: i32, turn: f32) -> f32 {
  var sum = 0.0;
  var weights = 0.0;
  for (var i = 0; i < taps; i++) {
    let t = sqrt((f32(i) + 0.5) / f32(taps));
    let a = f32(i) * GOLDEN + turn;
    let w = exp(-3.0 * t * t);
    sum += w * scene_at(p + vec2f(cos(a), sin(a)) * t * radius).y;
    weights += w;
  }
  return sum / weights;
}
fn bayer2(u: i32, v: i32) -> i32 { return 2 * ((u ^ v) & 1) + (v & 1); }
fn turn_at(p: vec2f) -> f32 {
  let ix = i32(floor(p.x));
  let iy = i32(floor(p.y));
  return (f32(4 * bayer2(ix, iy) + bayer2(ix >> 1u, iy >> 1u)) + 0.5) / 16.0 * 2.0 * PI;
}`;

/** The glow's addLight: no pixel brighter than its coverage, up to white. */
const ADD_LIGHT = /* wgsl */ `
fn add_light(c: vec4f, light: vec3f) -> vec4f {
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let o = c.rgb + light;
  return vec4f(o, max(c.a + coverage * (1.0 - c.a), clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`;

const AURA: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { near: vec3f, radius: f32, far: vec3f, gain: f32, centre: vec2f, wrap: f32, rays: f32, k: f32, seed: u32, mode: u32 }
${BLURRED}
${ADD_LIGHT}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let s = scene_at(p).y;
  let b = blurred_subject(p, params.radius, ${AURA_TAPS}, turn_at(p));
  let e = clamp(2.0 * b, 0.0, 1.0);
  let glow = e * (0.3 + 0.7 * e);
  var shape = glow;
  if (params.rays > 0.0) {
    let v = p - params.centre;
    let dist = length(v);
    var dir = vec2f(0.0);
    if (dist > 0.0) { dir = v / dist; }
    let span = min(dist, 2.0 * params.radius);
    let jitter = rand(i32(floor(p.x)), i32(floor(p.y)), params.seed + 2u);
    var lit = 0.0;
    var weights = 0.0;
    for (var j = 0; j < ${RAY_TAPS}; j++) {
      let u = (f32(j) + jitter) / ${f(RAY_TAPS)};
      let w = 1.0 - 0.8 * u;
      lit += w * scene_at(p - dir * span * u).y;
      weights += w;
    }
    let n1 = vnoise(vec2f(dir.x * params.k + 31.5, dir.y * params.k + 17.5), params.seed);
    let n2 = vnoise(vec2f(dir.x * params.k * 2.3 + 7.5, dir.y * params.k * 2.3 + 3.5), params.seed + 1u);
    let streak = smoothstep(0.3, 0.8, 0.65 * n1 + 0.35 * n2);
    shape = mix(shape, 1.5 * (lit / weights) * (0.1 + 0.9 * streak), params.rays);
  }
  let inner = clamp(2.0 - 2.0 * b, 0.0, 1.0);
  let amount = shape * (1.0 - s) + glow * s * params.wrap * inner * inner;
  let t = e * e * e;
  let col = mix(params.far, params.near, t);
  if (params.mode == 1u) {
    let o = clamp(amount * params.gain * 0.5, 0.0, 1.0);
    return vec4f(c.rgb * (1.0 - o) + col * o, c.a * (1.0 - o) + o);
  }
  return add_light(c, col * amount * params.gain);
}`,
  pack: (p, canvas) =>
    ({
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        Math.max(0.5, p.size as number),
        ...dec3(hexEncoded(p.colour2 as string)),
        Math.pow(2, p.intensity as number),
        ...subjectCentre(sceneOf(p), canvas),
        (p.wrap as number) / 100,
        (p.rays as number) / 100,
        (p.rayCount as number) / (2 * Math.PI),
        { u32: p.seed as number },
        { u32: AURA_MODES[p.mode as string] ?? 0 },
      ]),
    }),
};

const RIM_LIGHT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { one: vec3f, angle: f32, two: vec3f, width: f32, soft: f32, glow: f32, second: f32, glowWidth: f32 }
${ADD_LIGHT}
fn rim_at(p: vec2f, s: f32, angle: f32) -> vec2f {
  let l0 = vec2f(cos(angle), sin(angle));
  var acc = 0.0;
  for (var l = 0; l < ${RIM_LANES}; l++) {
    let d = rotate(l0, f32(l - ${(RIM_LANES - 1) / 2}) * (PI / 12.0));
    for (var j = 1; j <= ${RIM_STEPS}; j++) {
      let t = params.width * f32(j) / ${f(RIM_STEPS)};
      acc += 1.0 - scene_at(p + d * t).y;
    }
  }
  let band = s * smoothstep(0.0, params.soft, acc / ${f(RIM_LANES * RIM_STEPS)});
  var g = 0.0;
  var gw = 0.0;
  for (var l = 0; l < ${GLOW_LANES}; l++) {
    let d = rotate(l0, f32(l - ${(GLOW_LANES - 1) / 2}) * (PI / 9.0));
    for (var j = 0; j < ${RIM_STEPS}; j++) {
      let u = (f32(j) + 0.5) / ${f(RIM_STEPS)};
      let w = 1.0 - u;
      g += w * scene_at(p - d * params.glowWidth * u).y;
      gw += w;
    }
  }
  let halo = (1.0 - s) * (g / gw);
  return vec2f(band, halo * halo);
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let s = scene_at(p).y;
  let r1 = rim_at(p, s, params.angle);
  var light = params.one * (r1.x + params.glow * r1.y);
  if (params.second > 0.0) {
    let r2 = rim_at(p, s, params.angle + PI);
    light += params.two * (r2.x + params.glow * r2.y);
  }
  return add_light(c, light);
}`,
  pack: (p) => {
    const gain = Math.pow(2, p.intensity as number);
    const second = (p.second as number) / 100;
    const width = Math.max(0.5, p.width as number);
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)).map((v) => v * gain),
        ((p.angle as number) * Math.PI) / 180,
        ...dec3(hexEncoded(p.colour2 as string)).map((v) => v * gain * second),
        width,
        0.15 + (1 - 0.15) * ((p.softness as number) / 100),
        (p.glow as number) / 100,
        second,
        width * 2.5,
      ]),
    };
  },
};

/** The reference's `dilatedSubject` for one set of rings, as a WGSL function. */
const dilated = (name: string, rings: readonly (readonly [number, number])[]) => /* wgsl */ `
fn ${name}(p: vec2f, radius: f32, start: f32) -> f32 {
  var d = start;
${rings
  .map(
    ([share, taps], k) => `  for (var i = 0; i < ${taps}; i++) {
    let a = 2.0 * PI * (f32(i) + ${f(0.37 * k)}) / ${f(taps)};
    d = max(d, scene_at(p + vec2f(cos(a), sin(a)) * radius * ${f(share)}).y);
  }`,
  )
  .join("\n")}
  return d;
}`;

const STICKER: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { one: vec3f, w1: f32, two: vec3f, w2: f32, shade: vec3f, opacity: f32, paper: vec3f, mode: u32, offset: vec2f, blur: f32, lo: f32, hi: f32 }
${BLURRED}
${dilated("dilated1", OUTLINE_RINGS)}
${dilated("dilated2", OUTLINE2_RINGS)}
fn over(base: vec4f, rgb: vec3f, a: f32) -> vec4f { return vec4f(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a); }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let s = scene_at(p).y;
  let m = smoothstep(0.1, 0.9, s);
  var base = c;
  if (params.mode == 1u) { base = vec4f(params.paper, 1.0); } else if (params.mode == 2u) { base = vec4f(0.0); }
  if (params.opacity > 0.0) {
    let b = blurred_subject(p - params.offset, params.blur, ${SHADOW_TAPS}, 0.0);
    base = over(base, params.shade, params.opacity * smoothstep(params.lo, params.hi, b));
  }
  var d1 = s;
  if (params.w1 > 0.0) { d1 = dilated1(p, params.w1, s); }
  if (params.w2 > 0.0) { base = over(base, params.two, smoothstep(0.3, 0.7, dilated2(p, params.w1 + params.w2, d1))); }
  if (params.w1 > 0.0) { base = over(base, params.one, smoothstep(0.3, 0.7, d1)); }
  return c * m + base * (1.0 - m);
}`,
  pack: (p) => {
    const w1 = p.width as number;
    const w2 = p.width2 as number;
    const angle = ((p.shadowAngle as number) * Math.PI) / 180;
    const distance = p.shadowDistance as number;
    const [blur, lo, hi] = shadowShape(w1 + w2, p.shadowSoftness as number);
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        w1,
        ...dec3(hexEncoded(p.colour2 as string)),
        w2,
        ...dec3(hexEncoded(p.shadowColour as string)),
        (p.shadow as number) / 100,
        ...dec3(hexEncoded(p.backgroundColour as string)),
        { u32: STICKER_BACKGROUNDS[p.background as string] ?? 0 },
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        blur,
        lo,
        hi,
      ]),
    };
  },
};

const SPOTLIGHT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { tint: vec3f, spread: f32, light: vec3f, amount: f32, desaturate: f32, tintAmount: f32, lift: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
${BLURRED}
${ADD_LIGHT}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let s = scene_at(p).y;
  let b = blurred_subject(p, params.spread, ${POOL_TAPS}, turn_at(p));
  let pool = max(s, smoothstep(0.0, 0.5, b));
  let e = enc3(unpremul(c));
  var v = mix(e, vec3f(dot(W709, e)), params.desaturate);
  let d = dot(W709, v) - dot(W709, params.tint);
  v = mix(v, clamp(params.tint + d, vec3f(0.0), vec3f(1.0)), params.tintAmount);
  let dim = from_encoded(v, c.a);
  let res = vec4f(mix(c.rgb, dim.rgb * (1.0 - params.amount), 1.0 - pool), c.a);
  return add_light(res, res.rgb * params.lift * pool * params.light);
}`,
  pack: (p) =>
    ({
      uniform: packValues([
        ...hexEncoded(p.tint as string),
        Math.max(0.5, p.spread as number),
        ...dec3(hexEncoded(p.light as string)),
        (p.amount as number) / 100,
        (p.desaturate as number) / 100,
        (p.tintAmount as number) / 100,
        (p.lift as number) / 100,
      ]),
    }),
};

export const SUBJECT_KERNELS: Record<string, FilterKernel> = { aura: AURA, "rim-light": RIM_LIGHT, sticker: STICKER, spotlight: SPOTLIGHT };
