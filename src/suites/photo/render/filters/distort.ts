/** The distort filters' WGSL (shared/photo/effects/filters/distort.ts), mirroring `reference/filters/distort.ts`. */
import { type FilterKernel, packValues } from "../kernel.ts";

const WAVE: FilterKernel = {
  wgsl: /* wgsl */ `
struct Params { amplitude: f32, k: f32, scale: f32, liquid: u32, rows: u32, columns: u32, seed: u32 }
fn swirl(q: vec2f, seed: u32) -> f32 {
  return (vnoise(q, seed) + 0.5 * vnoise(vec2f(q.x * 2.03 + 3.7, q.y * 2.03 + 1.3), seed + 7u)) / 1.5;
}
fn effect(p: vec2f, c: vec4f) -> vec4f {
  var d = vec2f(0.0);
  if (params.liquid == 1u) {
    let q = p / params.scale;
    let r = vec2f(q.x + (vnoise(q, params.seed) - 0.5) * 2.0, q.y + (vnoise(q + vec2f(5.2, 1.3), params.seed) - 0.5) * 2.0);
    d = vec2f(swirl(r, params.seed + 1u) * 2.0 - 1.0, swirl(r + vec2f(9.1, 2.7), params.seed + 2u) * 2.0 - 1.0) * params.amplitude;
  } else {
    if (params.rows == 1u) { d.x = sin(p.y * params.k) * params.amplitude; }
    if (params.columns == 1u) { d.y = sin(p.x * params.k) * params.amplitude; }
  }
  // Held inside the canvas (grown to take in p), so the edges stretch rather than pull transparency in.
  return src(clamp(p + d, min(p, vec2f(0.5)), max(p, header.canvas - 0.5)));
}`,
  pack: (p) =>
    ({
      uniform: packValues([
        p.amplitude as number,
        (2 * Math.PI) / (p.wavelength as number),
        p.scale as number,
        { u32: p.type === "liquid" ? 1 : 0 },
        { u32: p.direction !== "vertical" ? 1 : 0 },
        { u32: p.direction !== "horizontal" ? 1 : 0 },
        { u32: p.seed as number },
      ]),
    }),
};

export const DISTORT_KERNELS: Record<string, FilterKernel> = { wave: WAVE };
