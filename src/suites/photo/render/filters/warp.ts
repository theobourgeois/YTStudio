/** The warp filters' WGSL (shared/photo/effects/filters/warp.ts), mirroring `reference/filters/warp.ts`. */
import { PINCH_POWER } from "@shared/photo/effects/filters/warp.ts";
import { ZIGZAG_STYLES, warpCentre } from "@shared/photo/reference/filters/warp.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const RAD = Math.PI / 180;

/** A displaced read held inside the canvas's edge pixels unless p is off it: never farther from p than asked. */
const HELD_READ = /* wgsl */ `
fn held_read(q: vec2f, p: vec2f) -> vec4f { return src(clamp(q, min(p, vec2f(0.5 * px())), max(p, header.canvas - 0.5 * px()))); }`;

const TWIRL: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { centre: vec2f, angle: f32, radius: f32 }
${HELD_READ}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let d = p - params.centre;
  let r = length(d);
  if (!(r < params.radius)) { return c; }
  let t = 1.0 - r / params.radius;
  return held_read(params.centre + rotate(d, -params.angle * t * t), p);
}`,
  pack: (p, canvas) => ({ uniform: packValues([...warpCentre(p.centre, canvas), (p.angle as number) * RAD, p.radius as number]) }),
};

const PINCH: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { centre: vec2f, k: f32, radius: f32 }
${HELD_READ}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let d = p - params.centre;
  let r = length(d);
  if (!(r < params.radius)) { return c; }
  var scale = 1.0;
  if (r > 0.0) { scale = pow(sin(PI / 2.0 * (r / params.radius)), -params.k); }
  return held_read(params.centre + d * scale, p);
}`,
  pack: (p, canvas) => ({ uniform: packValues([...warpCentre(p.centre, canvas), ((p.amount as number) / 100) * PINCH_POWER, p.radius as number]) }),
};

const ZIGZAG: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { centre: vec2f, amount: f32, radius: f32, k: f32, ease: f32, style: u32, p0: f32 }
${HELD_READ}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  let d = p - params.centre;
  let r = length(d);
  if (!(r < params.radius) || !(r > 0.0)) { return c; }
  let wave = params.amount * (1.0 - smoothstep(0.0, 1.0, r / params.radius));
  let ripple = wave * sin(params.k * r);
  let across = 1.0 / sqrt(r * r + params.ease);
  var outward = 0.0;
  var around = 0.0;
  if (params.style != 2u) { outward = ripple / r; }
  if (params.style == 0u) { around = 0.5 * wave * cos(params.k * r) * across; } else if (params.style == 2u) { around = ripple * across; }
  // Along d by outward, across it (a quarter turn clockwise) by around.
  return held_read(vec2f(p.x + d.x * outward - d.y * around, p.y + d.y * outward + d.x * around), p);
}`,
  pack: (p, canvas) => {
    const wavelength = (p.radius as number) / (p.ridges as number);
    return {
      uniform: packValues([
        ...warpCentre(p.centre, canvas),
        p.amount as number,
        p.radius as number,
        (2 * Math.PI) / wavelength,
        (wavelength / 4) ** 2,
        { u32: ZIGZAG_STYLES[p.style as string] ?? 0 },
        0,
      ]),
    };
  },
};

export const WARP_KERNELS: Record<string, FilterKernel> = { twirl: TWIRL, pinch: PINCH, zigzag: ZIGZAG };
