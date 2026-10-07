/** The wind filters' WGSL (shared/photo/effects/filters/wind.ts), mirroring `reference/filters/wind.ts`. */
import { BLUR_TAPS, EDGE_SPAN, STREAK_MODES, WIND_TAPS, windMethod } from "@shared/photo/reference/filters/wind.ts";
import { hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const RAD = Math.PI / 180;

/** Reads kept within the canvas's edge pixels as evaluated, unless p is off it (never farther from p than asked). */
const ON_CANVAS = /* wgsl */ `
fn on_canvas(q: vec2f, p: vec2f) -> vec2f { return clamp(q, min(p, vec2f(0.5 * px())), max(p, header.canvas - 0.5 * px())); }`;

const WIND: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { tint: vec3f, tint_amount: f32, cs: f32, sn: f32, len: f32, threshold: f32, thickness: f32, shortest: f32, power: f32, stagger: u32, mode: u32, seed: u32, p0: f32, p1: f32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
const TAPS: i32 = ${WIND_TAPS};
const EDGE_SPAN: f32 = ${EDGE_SPAN};
${ON_CANVAS}
fn brightness(s: vec4f) -> f32 { return s.a * enc(luma(unpremul(s))); }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let L = params.len;
  let stride = max(max(1.0, px()), L / f32(TAPS));
  let taps = min(TAPS, i32(floor(L / stride + 1e-3)));
  let gap = max(stride, L * EDGE_SPAN);
  let dir = vec2f(params.cs, params.sn);
  let u = params.cs * p.x + params.sn * p.y;
  let v = -params.sn * p.x + params.cs * p.y;
  let row = i32(floor(v / params.thickness));
  var row_length = L * mix(params.shortest, 1.0, rand(row, 0, params.seed));
  var shift = 0.0;
  if (params.stagger == 1u) {
    row_length = row_length * 0.55;
    shift = rand(row, 1, params.seed) * 0.45 * L;
  }
  var best = 0.0;
  var streak = c;
  for (var t = 1; t <= taps; t++) {
    let d = f32(t) * stride;
    let s = src(on_canvas(p - dir * d, p));
    let b = brightness(s);
    let downwind = brightness(src(on_canvas(p - dir * (d - gap), p)));
    var change = abs(b - downwind);
    if (params.mode == 0u) { change = b - downwind; } else if (params.mode == 1u) { change = downwind - b; }
    let strength = smoothstep(params.threshold, params.threshold + 0.12, change);
    if (strength > 0.0) {
      let len = row_length * mix(0.55, 1.0, vnoise(vec2f((u - d) / L * 4.0, f32(row)), params.seed + 1u));
      let along = d - shift;
      if (along >= 0.0 && along < len) {
        let w = strength * pow(1.0 - along / len, params.power);
        if (w > best) {
          best = w;
          streak = s;
        }
      }
    }
  }
  if (!(best > 0.0)) { return c; }
  if (params.tint_amount > 0.0) {
    // The tint at the streak's brightness: black stays black, white white, the middle the tint (a hard light).
    let e = enc3(unpremul(streak));
    let l = dot(W709, e);
    var hard = 1.0 - 2.0 * (1.0 - l) * (1.0 - params.tint);
    if (l < 0.5) { hard = 2.0 * l * params.tint; }
    streak = from_encoded(mix(e, hard, params.tint_amount), streak.a);
  }
  return mix(c, streak, best);
}`,
  pack: (p) => {
    const angle = (p.angle as number) * RAD;
    const L = p.length as number;
    const method = windMethod(p.method, L);
    const tint = hexEncoded(p.tint as string);
    return {
      uniform: packValues([
        tint[0],
        tint[1],
        tint[2],
        (p.tintAmount as number) / 100,
        Math.cos(angle),
        Math.sin(angle),
        L,
        (p.threshold as number) / 100,
        method.thickness,
        method.shortest,
        method.power,
        { u32: method.stagger ? 1 : 0 },
        { u32: STREAK_MODES[p.streaks as string] ?? 0 },
        { u32: p.seed as number },
        0,
        0,
      ]),
    };
  },
};

const MOTION_BLUR: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { cs: f32, sn: f32, distance: f32, trail: u32 }
const TAPS: i32 = ${BLUR_TAPS};
${ON_CANVAS}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let D = params.distance;
  let taps = min(TAPS, i32(ceil(D / max(1.0, px())))) + 1;
  var spacing = 0.0;
  if (taps > 1) { spacing = D / f32(taps - 1); }
  var start = -D / 2.0;
  if (params.trail == 1u) { start = 0.0; }
  let dir = vec2f(params.cs, params.sn);
  var sum = vec4f(0.0);
  var total = 0.0;
  for (var i = 0; i < taps; i++) {
    let s = start + f32(i) * spacing;
    var w = 1.0;
    if (params.trail == 1u) { w = 1.0 - f32(i) / f32(taps); }
    sum += src(on_canvas(p + dir * s, p)) * w;
    total += w;
  }
  return sum / total;
}`,
  pack: (p) => {
    const angle = (p.angle as number) * RAD;
    return { uniform: packValues([Math.cos(angle), Math.sin(angle), p.distance as number, { u32: p.shape === "trail" ? 1 : 0 }]) };
  },
};

export const WIND_KERNELS: Record<string, FilterKernel> = { wind: WIND, "motion-blur": MOTION_BLUR };
