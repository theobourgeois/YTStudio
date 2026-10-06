/**
 * The kernel filters' pass (shared/photo/effects/kernel.ts): one fragment shader per filter, run by `Isolation` on
 * its layer's content. The input is that content (its earlier filters run) on the target's grid, grown by the
 * filter's reach so every point it reads is there; the output is the target's size. Each filter's WGSL defines
 * `struct Params` and `fn effect(p: vec2f, c: vec4f) -> vec4f`: the document point of the pixel's centre and the
 * content there, premultiplied linear light in and out; it reads elsewhere with `src(doc point)`. The prelude's
 * helpers have the same names and arithmetic as the CPU reference's (`shared/photo/reference/kernel.ts`).
 *
 * Bindings (group 0): the input, the header, the filter's own uniform, a table (a gradient's; a placeholder for others).
 */
import type { EffectParamValue } from "@shared/photo/types.ts";
import { ROUND_FOR_STORE, type StorageFormat } from "./kernels.ts";
import { MATHS } from "./wgsl.ts";

export interface FilterKernel {
  /** WGSL defining `struct Params` (at least one field) and `fn effect(p: vec2f, c: vec4f) -> vec4f`. */
  wgsl: string;
  /**
   * The uniform's bytes (up to 256, a multiple of 16) and the table, if it reads one, for these parameters on this
   * canvas; a `tableKey` says the table is the same for every draw that gives it (kept on the GPU, not sent again).
   */
  pack: (params: Record<string, EffectParamValue>, canvas: { width: number; height: number }) => { uniform: ArrayBuffer; table?: Float32Array; tableKey?: string };
}

/** The header's bytes: where the target and its input are, Mix, the canvas. */
export const HEADER_BYTES = 48;

/** WGSL every kernel can use (mirrored by `shared/photo/reference/kernel.ts`). */
export const KERNEL_PRELUDE = /* wgsl */ `
${MATHS}
struct Header { origin: vec2f, zoom: f32, mix: f32, inOrigin: vec2f, inSize: vec2f, canvas: vec2f, grow: f32, p0: f32 }
@group(0) @binding(0) var content_in: texture_2d<f32>;
@group(0) @binding(1) var<uniform> header: Header;
@group(0) @binding(3) var<storage, read> table: array<f32>;

const PI: f32 = 3.141592653589793;

// The input's texel (i, j): transparent past it.
fn texel(i: i32, j: i32) -> vec4f {
  if (i < 0 || j < 0 || f32(i) >= header.inSize.x || f32(j) >= header.inSize.y) { return vec4f(0.0); }
  return textureLoad(content_in, vec2i(i, j), 0);
}
// The content at a document point: bilinear between pixel centres.
fn src(d: vec2f) -> vec4f {
  let u = (d - header.inOrigin) * header.zoom - 0.5;
  let i = vec2i(floor(u));
  let f = u - floor(u);
  return mix(mix(texel(i.x, i.y), texel(i.x + 1, i.y), f.x), mix(texel(i.x, i.y + 1), texel(i.x + 1, i.y + 1), f.x), f.y);
}
// Document pixels per pixel evaluated: what edges are smoothed over.
fn px() -> f32 { return 1.0 / header.zoom; }
fn luma(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
fn enc(l: f32) -> f32 { return linear_to_srgb(clamp(l, 0.0, 1.0)); }
fn dec(v: f32) -> f32 { return srgb_to_linear(clamp(v, 0.0, 1.0)); }
fn enc3(rgb: vec3f) -> vec3f { return vec3f(enc(rgb.r), enc(rgb.g), enc(rgb.b)); }
fn dec3(v: vec3f) -> vec3f { return vec3f(dec(v.r), dec(v.g), dec(v.b)); }
fn unpremul(c: vec4f) -> vec3f { if (c.a > 0.0) { return c.rgb / c.a; } return vec3f(0.0); }
fn premul(rgb: vec3f, a: f32) -> vec4f { return vec4f(rgb * a, a); }
fn from_encoded(v: vec3f, a: f32) -> vec4f { return premul(dec3(v), a); }
fn rand(ix: i32, iy: i32, seed: u32) -> f32 {
  return f32(hash2(bitcast<u32>(ix), bitcast<u32>(iy) ^ (seed * 0x9e3779b9u)) >> 8u) / 16777216.0;
}
fn vnoise(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = p - floor(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = rand(i.x, i.y, seed);
  let b = rand(i.x + 1, i.y, seed);
  let c = rand(i.x, i.y + 1, seed);
  let d = rand(i.x + 1, i.y + 1, seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// A table of RGBA rows (\`size\` of them) sampled linearly at t in [0, 1].
fn table_at(t: f32, size: u32) -> vec4f {
  let x = clamp(t, 0.0, 1.0) * f32(size - 1u);
  let i = min(u32(floor(x)), size - 1u);
  let j = min(i + 1u, size - 1u);
  let f = x - f32(i);
  let a = vec4f(table[i * 4u], table[i * 4u + 1u], table[i * 4u + 2u], table[i * 4u + 3u]);
  let b = vec4f(table[j * 4u], table[j * 4u + 1u], table[j * 4u + 2u], table[j * 4u + 3u]);
  return mix(a, b, f);
}
fn rotate(v: vec2f, angle: f32) -> vec2f { let c = cos(angle); let s = sin(angle); return vec2f(c * v.x - s * v.y, s * v.x + c * v.y); }
`;

/** A filter's whole shader, writing a target of `format`. */
export function kernelShader(kernel: FilterKernel, format: StorageFormat): string {
  return /* wgsl */ `
${ROUND_FOR_STORE(format)}
${KERNEL_PRELUDE}
${kernel.wgsl.replace(/(struct Params\s*\{[^}]*\})/, "$1\n@group(0) @binding(2) var<uniform> params: Params;")}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return full_screen(i); }

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let g = i32(header.grow);
  let at = vec2i(floor(pos.xy));
  let c = texel(at.x + g, at.y + g);
  let p = header.origin + pos.xy / header.zoom;
  return round_for_store(mix(c, effect(p, c), header.mix));
}
`;
}

/** The header for a target `view` and its input grown by `grow` of its pixels. */
export function kernelHeader(view: { x: number; y: number; zoom: number; width: number; height: number }, grow: number, mix: number, canvas: { width: number; height: number }): ArrayBuffer {
  const data = new ArrayBuffer(HEADER_BYTES);
  new Float32Array(data).set([view.x, view.y, view.zoom, mix, view.x - grow / view.zoom, view.y - grow / view.zoom, view.width + 2 * grow, view.height + 2 * grow, canvas.width, canvas.height, grow, 0]);
  return data;
}

/** Packing helpers: floats and u32s laid out in order, padded to 16 bytes. */
export function packValues(values: (number | { u32: number })[]): ArrayBuffer {
  const data = new ArrayBuffer(Math.max(16, Math.ceil((values.length * 4) / 16) * 16));
  const f = new Float32Array(data);
  const u = new Uint32Array(data);
  values.forEach((v, i) => {
    if (typeof v === "number") f[i] = v;
    else u[i] = v.u32 >>> 0;
  });
  return data;
}
