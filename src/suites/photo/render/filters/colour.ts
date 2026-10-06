/** The colour filters' WGSL (shared/photo/effects/filters/colour.ts), mirroring `reference/filters/colour.ts`. */
import { GRADIENT_TABLE_SIZE, gradientTable } from "@shared/photo/style/gradients.ts";
import type { Gradient } from "@shared/photo/types.ts";
import { type FilterKernel, packValues } from "../kernel.ts";

const GRADIENT_MAP: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { size: u32, p0: u32, p1: u32, p2: u32 }
fn effect(p: vec2f, c: vec4f) -> vec4f {
  if (!(c.a > 0.0)) { return c; }
  let rgb = unpremul(c);
  let g = table_at(enc(luma(rgb)), params.size);
  return premul(mix(rgb, dec3(g.rgb), g.a), c.a);
}`,
  pack: (p) => ({ uniform: packValues([{ u32: GRADIENT_TABLE_SIZE }]), table: gradientTable(p.gradient as Gradient, p.reverse as boolean) }),
};

export const COLOUR_KERNELS: Record<string, FilterKernel> = { "gradient-map": GRADIENT_MAP };
