/**
 * WGSL shared by the photo kernels: reading atlas slots, reading a virtual image's pixels through its page table,
 * sRGB encoding, the dither hash and Mitchell's kernel. Each mirrors a CPU reference in shared/photo/ (output.ts,
 * geometry.ts, colour.ts) that the GPU is tested against.
 */
import { MAX_ARRAYS } from "./atlas.ts";

/** Group 0: the atlas's arrays (`a0`..`a7`) and where slots are (`atlas.perArray`). */
export const ATLAS = /* wgsl */ `
struct Atlas { perArray: u32, tile: u32, p0: u32, p1: u32 }
${Array.from({ length: MAX_ARRAYS }, (_, i) => `@group(0) @binding(${i}) var a${i}: texture_2d_array<f32>;`).join("\n")}
@group(0) @binding(${MAX_ARRAYS}) var<uniform> atlas: Atlas;

fn loadSlot(slot: u32, p: vec2i) -> vec4f {
  let layer = i32(slot % atlas.perArray);
  switch (slot / atlas.perArray) {
${Array.from({ length: MAX_ARRAYS - 1 }, (_, i) => `    case ${i}u: { return textureLoad(a${i}, p, layer, 0); }`).join("\n")}
    default: { return textureLoad(a${MAX_ARRAYS - 1}, p, layer, 0); }
  }
}
`;

export const IMAGE_STRUCTS = /* wgsl */ `
struct Level { w: u32, h: u32, tilesX: u32, tilesY: u32, offset: u32, p0: u32, p1: u32, p2: u32 }
struct Image { fill: vec4f, width: u32, height: u32, levels: u32, tile: u32, level: array<Level, 16> }
const PENDING: u32 = 0xffffffffu;
`;

/**
 * Reading virtual image `name` (bound at `group`): `entry_name`, `present_name` (is the tile under a pixel
 * resident?), `texel_name` (a pixel of a level: transparent outside it or while pending, the fill where there's
 * no tile).
 */
export function imageFunctions(name: string, group: number): string {
  return /* wgsl */ `
@group(${group}) @binding(0) var<storage, read> img_${name}: Image;
@group(${group}) @binding(1) var<storage, read> pages_${name}: array<u32>;

fn entry_${name}(level: u32, tx: i32, ty: i32) -> u32 {
  let l = img_${name}.level[level];
  if (tx < 0 || ty < 0 || tx >= i32(l.tilesX) || ty >= i32(l.tilesY)) { return 0u; }
  return pages_${name}[l.offset + u32(ty) * l.tilesX + u32(tx)];
}

fn present_${name}(level: u32, x: i32, y: i32) -> bool {
  let t = i32(img_${name}.tile);
  return entry_${name}(level, div_floor(x, t), div_floor(y, t)) != PENDING;
}

fn texel_${name}(level: u32, x: i32, y: i32) -> vec4f {
  let l = img_${name}.level[level];
  if (x < 0 || y < 0 || x >= i32(l.w) || y >= i32(l.h)) { return vec4f(0.0); }
  let t = i32(img_${name}.tile);
  let e = entry_${name}(level, x / t, y / t);
  if (e == 0u) { return img_${name}.fill; }
  if (e == PENDING) { return vec4f(0.0); }
  return loadSlot(e - 1u, vec2i(x % t, y % t));
}
`;
}

export const MATHS = /* wgsl */ `
fn div_floor(a: i32, b: i32) -> i32 {
  return select(a / b, (a - b + 1) / b, a < 0);
}

// sRGB's curve (IEC 61966-2-1), as shared/photo/colour.ts's linearToSrgb, for values in [0, 1].
fn linear_to_srgb(l: f32) -> f32 {
  if (l <= 0.0031308049535603713) { return l * 12.92; }
  return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

// shared/photo/output.ts's hash2: the same u32 arithmetic.
fn hash2(x: u32, y: u32) -> u32 {
  var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  return h ^ (h >> 15u);
}

fn dither_at(x: u32, y: u32, amplitude: f32) -> f32 {
  return f32(hash2(x, y) >> 8u) / 16777216.0 * 2.0 * amplitude - amplitude;
}

// Unpremultiplied, clipped to [0, 1] (SDR sRGB), encoded: shared/photo/output.ts's encodePixel.
fn encode_pixel(c: vec4f) -> vec4f {
  let a = clamp(c.a, 0.0, 1.0);
  var rgb = vec3f(0.0);
  if (a > 0.0) { rgb = clamp(c.rgb / a, vec3f(0.0), vec3f(1.0)); }
  return vec4f(linear_to_srgb(rgb.r), linear_to_srgb(rgb.g), linear_to_srgb(rgb.b), a);
}

// Mitchell–Netravali, B = C = 1/3 (shared/photo/geometry.ts's mitchell).
fn mitchell(x: f32) -> f32 {
  let t = abs(x);
  if (t < 1.0) { return (7.0 * t * t * t - 12.0 * t * t + 16.0 / 3.0) / 6.0; }
  if (t < 2.0) { return (-7.0 / 3.0 * t * t * t + 12.0 * t * t - 20.0 * t + 32.0 / 3.0) / 6.0; }
  return 0.0;
}
`;
