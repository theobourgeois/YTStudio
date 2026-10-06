/**
 * The adjustments' GPU passes (docs/photo/effects/system.md, "Definition and instance"): each a fragment shader
 * that reads what's below at its own pixel and writes the adjusted result, faded by the layer's opacity. They
 * mirror the CPU references in `shared/photo/reference/adjustments.ts`, which they're tested against.
 *
 * Every shader has the same bindings: group 0 the texture below; group 1 the parameters (a uniform whose first
 * value is the opacity) and a table (Curves' curves; a placeholder for the others).
 */
import { CURVE_TABLE_SIZE, curveTable, identityChannels } from "@shared/photo/effects/curve-math.ts";
import type { CurveSet, EffectParamValue } from "@shared/photo/types.ts";
import { ROUND_FOR_STORE, type StorageFormat } from "./kernels.ts";
import { MATHS } from "./wgsl.ts";

export interface AdjustmentKernel {
  /** WGSL defining `struct Params` (opacity first) and `fn adjust(c: vec4f) -> vec4f` on premultiplied light. */
  wgsl: string;
  /** The uniform's bytes (up to 256) and the table, if it reads one, for these parameters. */
  pack: (params: Record<string, EffectParamValue>, opacity: number) => { uniform: ArrayBuffer; table?: Float32Array };
}

const EXPOSURE: AdjustmentKernel = {
  wgsl: /* wgsl */ `
struct Params { opacity: f32, gain: f32, offset: f32, power: f32, shaped: u32, p0: u32, p1: u32, p2: u32 }
fn adjust(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return c; }
  if (params.shaped == 0u) {
    // Linear in premultiplied light: × 2^stops, + offset × alpha.
    return vec4f(c.rgb * params.gain + vec3f(params.offset * c.a), c.a);
  }
  let v = c.rgb / c.a * params.gain + vec3f(params.offset);
  return vec4f(sign(v) * pow(abs(v), vec3f(params.power)) * c.a, c.a);
}`,
  pack(params, opacity) {
    const uniform = new ArrayBuffer(32);
    const gamma = params.gamma as number;
    new Float32Array(uniform, 0, 4).set([opacity, 2 ** (params.exposure as number), params.offset as number, 1 / gamma]);
    new Uint32Array(uniform, 16, 1)[0] = gamma === 1 ? 0 : 1;
    return { uniform };
  },
};

const CURVES: AdjustmentKernel = {
  wgsl: /* wgsl */ `
struct Params { opacity: f32, size: u32, idR: u32, idG: u32, idB: u32, p0: u32, p1: u32, p2: u32 }
fn lookup(ch: u32, e: f32) -> f32 {
  let x = clamp(e, 0.0, 1.0) * f32(params.size - 1u);
  let i = min(u32(floor(x)), params.size - 1u);
  let j = min(i + 1u, params.size - 1u);
  return mix(table[ch * params.size + i], table[ch * params.size + j], x - f32(i));
}
// One channel: encoded, through its curves, back to linear. Outside [0, 1] it passes, as does an untouched channel.
fn curve(ch: u32, c: f32, a: f32, identity: u32) -> f32 {
  if (identity == 1u) { return c; }
  let v = c / a;
  if (v < 0.0 || v > 1.0) { return c; }
  return srgb_to_linear(lookup(ch, linear_to_srgb(v))) * a;
}
fn adjust(c: vec4f) -> vec4f {
  if (c.a <= 0.0) { return c; }
  return vec4f(curve(0u, c.r, c.a, params.idR), curve(1u, c.g, c.a, params.idG), curve(2u, c.b, c.a, params.idB), c.a);
}`,
  pack(params, opacity) {
    const set = params.curves as CurveSet;
    const uniform = new ArrayBuffer(32);
    new Float32Array(uniform, 0, 1)[0] = opacity;
    new Uint32Array(uniform, 4, 4).set([CURVE_TABLE_SIZE, ...identityChannels(set).map((b) => (b ? 1 : 0))]);
    return { uniform, table: curveTable(set) };
  },
};

export const ADJUSTMENT_KERNELS: Record<string, AdjustmentKernel> = { exposure: EXPOSURE, curves: CURVES };

/**
 * The whole shader for an adjustment writing a target of `format`. `mask` is the compositor's WGSL for groups 2
 * and 3 (the adjustment's mask, in document pixels), defining `adjustment_mask(pos)`.
 */
export function adjustmentShader(kernel: AdjustmentKernel, format: StorageFormat, mask: string): string {
  return /* wgsl */ `
${ROUND_FOR_STORE(format)}
${MATHS}
${mask}
@group(0) @binding(0) var below: texture_2d<f32>;
${kernel.wgsl.replace("fn adjust", "@group(1) @binding(0) var<uniform> params: Params;\n@group(1) @binding(1) var<storage, read> table: array<f32>;\nfn adjust")}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let c = textureLoad(below, vec2i(pos.xy), 0);
  let adjusted = adjust(c);
  // Its opacity and its mask say how much it changes this pixel.
  let k = params.opacity * adjustment_mask(pos.xy);
  if (k >= 1.0) { return round_for_store(adjusted); }
  return round_for_store(mix(c, adjusted, k));
}
`;
}
