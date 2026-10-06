/** The light filters' WGSL (shared/photo/effects/filters/light.ts), mirroring `reference/filters/light.ts`. */
import { dec3, hexEncoded } from "@shared/photo/reference/kernel.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const LIGHT_LEAK: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { core: vec3f, angle: f32, outer: vec3f, gain: f32, reach: f32, wobble: f32, seed: u32, two: u32 }
fn leak(p: vec2f, angle: f32, seed: u32) -> vec3f {
  let u = vec2f(cos(angle), sin(angle));
  let h = header.canvas / 2.0;
  let diag = length(header.canvas);
  let edge = abs(u.x) * h.x + abs(u.y) * h.y;
  let d = p - h;
  let along = edge - (d.x * u.x + d.y * u.y);
  let lat = -d.x * u.y + d.y * u.x;
  let tongue = vnoise(vec2f(lat / params.reach * 1.1 + 3.1, f32(seed % 64u) * 5.7 + 0.5), seed) - 0.5;
  let r = rotate(p / params.reach, 0.7);
  let wisp = vnoise(vec2f(r.x * 2.6 + 5.3, r.y * 2.6 + 1.9), seed + 1u) - 0.5;
  let t = max(0.0, along + (tongue * 1.4 + wisp * 0.6) * params.wobble * params.reach) / params.reach;
  let fall = exp(-4.0 * t * t) * 0.85 + exp(-2.5 * t) * 0.15;
  let across = lat / (0.42 * diag);
  let span = exp(-across * across);
  let lobe = vnoise(vec2f(lat / params.reach * 2.3 + 7.7, f32(seed % 64u) * 3.1 + 0.5), seed + 2u);
  let shape = fall * span * mix(1.0, 0.25 + 1.1 * lobe, params.wobble);
  let hot = smoothstep(0.25, 0.95, shape);
  return mix(params.outer, params.core, hot) * shape;
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  var light = leak(p, params.angle, params.seed);
  if (params.two == 1u) { light = light + leak(p, params.angle + PI, params.seed + 97u) * 0.7; }
  light = light * params.gain;
  // The glow's addLight: no pixel brighter than its coverage, up to white.
  let coverage = clamp(max(light.r, max(light.g, light.b)), 0.0, 1.0);
  let o = c.rgb + light;
  return vec4f(o, max(c.a + coverage * (1.0 - c.a), clamp(max(o.r, max(o.g, o.b)), 0.0, 1.0)));
}`,
  pack: (p, canvas) => {
    const diag = Math.hypot(canvas.width, canvas.height);
    return {
      uniform: packValues([
        ...dec3(hexEncoded(p.colour as string)),
        ((p.angle as number) * Math.PI) / 180,
        ...dec3(hexEncoded(p.colour2 as string)),
        Math.pow(2, p.intensity as number),
        ((p.spread as number) / 100) * diag,
        (p.wobble as number) / 100,
        { u32: p.seed as number },
        { u32: p.double ? 1 : 0 },
      ]),
    };
  },
};

export const LIGHT_KERNELS: Record<string, FilterKernel> = { "light-leak": LIGHT_LEAK };
