/**
 * The kernel filters' CPU references (`../effects/kernel.ts`): each filter's function of the document point, its
 * content there (`c`) and its content anywhere (`env.src`, bilinear between pixel centres, transparent past the
 * image), in f64. The helpers here have the same names and arithmetic as the WGSL ones in
 * `src/suites/photo/render/kernel.ts` (`KERNEL_PRELUDE`), so a filter reads the same in both.
 */
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import type { EffectParamValue } from "../types.ts";
import { hash2 } from "../output.ts";
import type { FloatImage } from "./glow.ts";
import { applyToCode } from "../effects/kernel.ts";
import { SCENE_PARAM, type SceneMaps, sceneAt } from "../scene.ts";

export type Pixel = [number, number, number, number];
export type Rgb = [number, number, number];

/** What a kernel reads besides its own pixel. */
export interface KernelEnv {
  canvas: { width: number; height: number };
  /** The content at a document point: bilinear between pixel centres, transparent past it. */
  src: (x: number, y: number) => Pixel;
  /** Document pixels per pixel evaluated (1 at full resolution): what edges are smoothed over. */
  px: number;
  /**
   * The picture's scene maps at a document point (`../scene.ts`): [depth (1 the nearest), subject (0..1)], 0 where the
   * filter reads none. WGSL's `scene_at`.
   */
  scene: (x: number, y: number) => [number, number];
}

/** A filter at a point: premultiplied linear light out, before Mix. */
export type KernelFn = (p: readonly [number, number], c: Pixel, env: KernelEnv) => Pixel;

/** A filter's reference: its function for these parameters (worked out once). */
export type KernelReference = (params: Record<string, EffectParamValue>, canvas: { width: number; height: number }) => KernelFn;

// --- the helpers (KERNEL_PRELUDE's) ---

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);
/** Linear-light luminance (Rec. 709). */
export const luma = (rgb: readonly number[]) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
/** sRGB-encoded from linear, held to [0, 1]. */
export const enc = (l: number) => linearToSrgb(clamp(l));
/** Linear from sRGB-encoded, held to [0, 1]. */
export const dec = (v: number) => srgbToLinear(clamp(v));
export const enc3 = (rgb: readonly number[]): Rgb => [enc(rgb[0]), enc(rgb[1]), enc(rgb[2])];
export const dec3 = (v: readonly number[]): Rgb => [dec(v[0]), dec(v[1]), dec(v[2])];
/** A premultiplied pixel's colour (0 where it has no coverage). */
export const unpremul = (c: Pixel): Rgb => (c[3] > 0 ? [c[0] / c[3], c[1] / c[3], c[2] / c[3]] : [0, 0, 0]);
/** Straight colour back to premultiplied with coverage `a`. */
export const premul = (rgb: readonly number[], a: number): Pixel => [rgb[0] * a, rgb[1] * a, rgb[2] * a, a];
/** A stylised result: its encoded colour back in linear light, at the pixel's coverage. */
export const fromEncoded = (v: readonly number[], a: number): Pixel => premul(dec3(v), a);

/** A uniform number in [0, 1) for an integer cell and a seed: WGSL's `rand`. */
export function rand(ix: number, iy: number, seed: number): number {
  return (hash2(ix | 0, ((iy | 0) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0) >>> 8) / 16777216;
}

/** Smooth value noise in [0, 1) on the integer lattice (smoothstep between cells): WGSL's `vnoise`. */
export function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = rand(ix, iy, seed);
  const b = rand(ix + 1, iy, seed);
  const c = rand(ix, iy + 1, seed);
  const d = rand(ix + 1, iy + 1, seed);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

/** A table of RGBA rows sampled linearly at t in [0, 1] (a gradient's: straight encoded RGB and opacity). */
export function tableAt(table: Float32Array, t: number): [number, number, number, number] {
  const size = table.length / 4;
  const x = clamp(t) * (size - 1);
  const i = Math.min(size - 1, Math.floor(x));
  const j = Math.min(size - 1, i + 1);
  const f = x - i;
  return [0, 1, 2, 3].map((k) => mix(table[i * 4 + k], table[j * 4 + k], f)) as [number, number, number, number];
}

/** An sRGB "#rrggbb" as encoded floats (0..1). */
export const hexEncoded = (hex: string): Rgb => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

/** Rotates a vector by `angle` radians. */
export const rotate = (x: number, y: number, angle: number): [number, number] => [Math.cos(angle) * x - Math.sin(angle) * y, Math.sin(angle) * x + Math.cos(angle) * y];

// --- running one ---

/** Bilinear reads of `image` (its pixel (0, 0) at document `origin`), transparent past it. */
export function sampler(image: FloatImage, origin = { x: 0, y: 0 }): (x: number, y: number) => Pixel {
  const at = (i: number, j: number): Pixel => {
    if (i < 0 || j < 0 || i >= image.width || j >= image.height) return [0, 0, 0, 0];
    const k = (j * image.width + i) * 4;
    return [image.data[k], image.data[k + 1], image.data[k + 2], image.data[k + 3]];
  };
  return (x, y) => {
    const u = x - origin.x - 0.5;
    const v = y - origin.y - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = u - i;
    const fy = v - j;
    const a = at(i, j);
    const b = at(i + 1, j);
    const c = at(i, j + 1);
    const d = at(i + 1, j + 1);
    return [0, 1, 2, 3].map((k) => mix(mix(a[k], b[k], fx), mix(c[k], d[k], fx), fy)) as Pixel;
  };
}

/**
 * Where Apply To lets a filter change the layer at a point, 0..1, from the subject there (`code`: 0 everywhere, 1 the
 * subject, 2 the background): WGSL's `apply_weight`.
 */
export const applyWeight = (code: number, subject: number) => (code === 1 ? subject : code === 2 ? 1 - subject : 1);

/**
 * A kernel filter over `image` (its pixel (0, 0) at document `origin`), at full resolution: each pixel's result
 * mixed with what it was by Mix, where Apply To lets it. `maps` are its picture's scene maps, when it reads them.
 */
export function applyKernel(reference: KernelReference, image: FloatImage, params: Record<string, EffectParamValue>, canvas: { width: number; height: number }, origin = { x: 0, y: 0 }, maps: SceneMaps | null = null): FloatImage {
  const drawn = maps ? { ...params, [SCENE_PARAM]: maps as unknown as EffectParamValue } : params;
  const fn = reference(drawn, canvas);
  const env: KernelEnv = { canvas, src: sampler(image, origin), px: 1, scene: (x, y) => sceneAt(maps, x, y) };
  const code = applyToCode(params);
  const mixed = ((params.mix as number | undefined) ?? 100) / 100;
  const out = new Float64Array(image.width * image.height * 4);
  for (let j = 0; j < image.height; j++) {
    for (let i = 0; i < image.width; i++) {
      const k = (j * image.width + i) * 4;
      const c: Pixel = [image.data[k], image.data[k + 1], image.data[k + 2], image.data[k + 3]];
      const x = origin.x + i + 0.5;
      const y = origin.y + j + 0.5;
      const f = fn([x, y], c, env);
      const amount = mixed * applyWeight(code, code ? env.scene(x, y)[1] : 0);
      for (let ch = 0; ch < 4; ch++) out[k + ch] = mix(c[ch], f[ch], amount);
    }
  }
  return { width: image.width, height: image.height, data: out };
}
