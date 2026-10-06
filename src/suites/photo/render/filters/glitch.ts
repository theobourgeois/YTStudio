/** The glitch filters' WGSL (shared/photo/effects/filters/glitch.ts), mirroring `reference/filters/glitch.ts`. */
import { type FilterKernel, packValues } from "../kernel.ts";

const RGB_SPLIT: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { distance: f32, angle: f32, radial: u32, anaglyph: u32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  var d = vec2f(cos(params.angle), sin(params.angle)) * params.distance;
  if (params.radial == 1u) {
    d = (p - header.canvas / 2.0) / (length(header.canvas) / 2.0) * params.distance;
  }
  let r = src(p - d);
  let b = src(p + d);
  if (params.anaglyph == 1u) { return vec4f(r.r, b.g, b.b, max(r.a, b.a)); }
  return vec4f(r.r, c.g, b.b, max(r.a, max(c.a, b.a)));
}`,
  pack: (p) => ({ uniform: packValues([p.distance as number, ((p.angle as number) * Math.PI) / 180, { u32: p.mode === "radial" ? 1 : 0 }, { u32: p.pair === "anaglyph" ? 1 : 0 }]) }),
};

export const GLITCH_KERNELS: Record<string, FilterKernel> = { "rgb-split": RGB_SPLIT };
