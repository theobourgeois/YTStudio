/** The depth filters' WGSL (shared/photo/effects/filters/depth.ts), mirroring `reference/filters/depth.ts`. */
import { DEPTH_BLENDS, depthSpan } from "@shared/photo/reference/filters/depth.ts";
import { GRADIENT_TABLE_SIZE, gradientTable } from "@shared/photo/style/gradients.ts";
import type { Gradient } from "@shared/photo/types.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const DEPTH_GRADE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { far: f32, span: f32, mode: u32, size: u32 }
const W709 = vec3f(0.2126, 0.7152, 0.0722);
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let t = clamp((scene_at(p).x - params.far) / params.span, 0.0, 1.0);
  let g = table_at(t, params.size);
  let e = enc3(unpremul(c));
  var v = g.rgb;
  if (params.mode == 1u) {
    v = clamp(g.rgb + (dot(W709, e) - dot(W709, g.rgb)), vec3f(0.0), vec3f(1.0));
  } else if (params.mode == 2u) {
    v = (1.0 - 2.0 * g.rgb) * e * e + 2.0 * g.rgb * e;
  }
  return from_encoded(mix(e, v, g.a), c.a);
}`,
  pack: (p) => ({
    uniform: packValues([(p.far as number) / 100, depthSpan(p.far as number, p.near as number), { u32: DEPTH_BLENDS[p.blend as string] ?? 1 }, { u32: GRADIENT_TABLE_SIZE }]),
    table: gradientTable(p.gradient as Gradient),
  }),
};

export const DEPTH_KERNELS: Record<string, FilterKernel> = { "depth-grade": DEPTH_GRADE };
