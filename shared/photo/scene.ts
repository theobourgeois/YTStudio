/**
 * Scene maps (docs/photo/effects/scene-maps.md): what a filter knows of the picture it's on besides its pixels, its
 * **depth** (how near each point is, from a monocular depth model, Depth Anything V2) and its **subject** (how much each
 * point is the main subject, from Select Subject's model). Both are worked out in the tab from a coarse render of the
 * filter's input, kept on a grid of document pixels (`SceneMaps`), and handed to the filter's kernel: the WGSL reads
 * them with `scene_at(p)`, the CPU reference with `env.scene(x, y)`, the same bilinear reads of the same floats.
 *
 * This is what's around the models: the grid, reading it, the depth model's input and its answer made a map. Pure.
 */
import { linearToSrgb } from "./colour.ts";
import type { Size } from "./geometry.ts";
import type { PixelSample } from "./pixel-sample.ts";

/** What a filter reads of the scene with its settings. */
export interface SceneReads {
  depth: boolean;
  subject: boolean;
}

/**
 * A picture's scene maps: `width` × `height` cells of `spacing` document pixels (cell (i, j)'s centre is at
 * ((i + ½)·spacing, (j + ½)·spacing)), each a depth (0 the farthest, 1 the nearest) and a subject (0..1). A map that
 * wasn't asked for, or whose model isn't there, is null (it reads 0).
 */
export interface SceneMaps {
  /** Which picture, which maps and where they're placed: part of every plan key that reads them. */
  id: string;
  /** Which grids (the floats the GPU is given; the same however they're placed): `id` when absent. */
  data?: string;
  /**
   * Where the maps are read for a document point now: an affine to where that point was when they were made (its
   * layer has moved, scaled or turned since). Absent: where they were made.
   */
  place?: Affine | null;
  width: number;
  height: number;
  spacing: number;
  depth: Float32Array | null;
  subject: Float32Array | null;
}

/** The parameter a filter's scene maps are handed in by (the plan's, never saved). */
export const SCENE_PARAM = "__scene";

/** `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f (layers.ts's). */
export type Affine = readonly [number, number, number, number, number, number];

/** The affine that changes nothing. */
export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** The affine undoing `m`. */
export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** `m` after `n`: a point through `n`, then `m`. */
export const composeAffine = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Where `maps` are read for the document point (x, y) now (their `place`). */
export function scenePoint(maps: SceneMaps, x: number, y: number): [number, number] {
  const m = maps.place;
  return m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] : [x, y];
}

/** A filter's scene maps from its drawn parameters (none while they're being made). */
export const sceneOf = (params: Record<string, unknown>): SceneMaps | null => (params[SCENE_PARAM] as SceneMaps | undefined) ?? null;

/** The grid's long side, at most: the models see less than this, and the maps are smooth between cells. */
export const SCENE_SIDE = 1024;

/** Document pixels a cell of a canvas's scene maps (a power of two, so cells line up with the renderer's levels). */
export function sceneSpacing(canvas: Size): number {
  const long = Math.max(canvas.width, canvas.height);
  return 2 ** Math.max(0, Math.ceil(Math.log2(long / SCENE_SIDE)));
}

/** The grid a canvas's maps are made on. */
export function sceneGrid(canvas: Size): { width: number; height: number; spacing: number } {
  const spacing = sceneSpacing(canvas);
  return { width: Math.max(1, Math.ceil(canvas.width / spacing)), height: Math.max(1, Math.ceil(canvas.height / spacing)), spacing };
}

/**
 * The maps at a document point: [depth, subject], bilinear between cell centres, held at the grid's edge, read where
 * the point was when they were made (`place`). WGSL's `scene_at` (render/kernel.ts) does the same arithmetic on the
 * same floats.
 */
export function sceneAt(maps: SceneMaps | null, px: number, py: number): [number, number] {
  if (!maps) return [0, 0];
  const [x, y] = scenePoint(maps, px, py);
  const u = x / maps.spacing - 0.5;
  const v = y / maps.spacing - 0.5;
  const fu = Math.floor(u);
  const fv = Math.floor(v);
  const fx = u - fu;
  const fy = v - fv;
  const i0 = Math.min(maps.width - 1, Math.max(0, fu));
  const i1 = Math.min(maps.width - 1, Math.max(0, fu + 1));
  const j0 = Math.min(maps.height - 1, Math.max(0, fv));
  const j1 = Math.min(maps.height - 1, Math.max(0, fv + 1));
  const read = (m: Float32Array | null) => {
    if (!m) return 0;
    const a = m[j0 * maps.width + i0];
    const b = m[j0 * maps.width + i1];
    const c = m[j1 * maps.width + i0];
    const d = m[j1 * maps.width + i1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  return [read(maps.depth), read(maps.subject)];
}

/** Floats before the cells in the GPU's buffer: width, height, spacing, which maps (1 depth, 2 subject). */
export const SCENE_HEADER = 4;

/** The maps as the GPU reads them: the header, then each cell's depth and subject. */
export function packScene(maps: SceneMaps): Float32Array {
  const n = maps.width * maps.height;
  const out = new Float32Array(SCENE_HEADER + 2 * n);
  out.set([maps.width, maps.height, maps.spacing, (maps.depth ? 1 : 0) + (maps.subject ? 2 : 0)]);
  for (let i = 0; i < n; i++) {
    out[SCENE_HEADER + 2 * i] = maps.depth ? maps.depth[i] : 0;
    out[SCENE_HEADER + 2 * i + 1] = maps.subject ? maps.subject[i] : 0;
  }
  return out;
}

/** A coarse render of a picture: premultiplied linear RGBA floats. */
export interface CoarsePicture {
  width: number;
  height: number;
  data: Float32Array;
}

/** A coarse render as 8-bit sRGB, the models' input (`scale`: its pixels per document pixel). */
export function pictureSample(picture: CoarsePicture, scale: number): PixelSample {
  const data = new Uint8ClampedArray(picture.width * picture.height * 4);
  for (let i = 0; i < picture.width * picture.height; i++) {
    const a = Math.min(1, Math.max(0, picture.data[i * 4 + 3]));
    for (let c = 0; c < 3; c++) data[i * 4 + c] = a > 0 ? Math.round(linearToSrgb(Math.min(1, Math.max(0, picture.data[i * 4 + c] / a))) * 255) : 0;
    data[i * 4 + 3] = Math.round(a * 255);
  }
  return { width: picture.width, height: picture.height, data, scale };
}

// --- the depth model ---

/**
 * Depth Anything V2 Small (Yang et al., 2024; Apache-2.0 weights), fp16 as ONNX: a picture in (any size, multiples of
 * 14), relative inverse depth out (larger is nearer), at the input's size.
 */
export const DEPTH_MODEL = {
  name: "Depth Anything V2 Small, fp16",
  file: "depth-anything-v2-small-fp16.onnx",
  url: "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx",
  size: 49_642_442,
  sha256: "2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04",
  input: "pixel_values",
  output: "predicted_depth",
};

/** The depth model's short side (as it was trained), and its patch: both sides are multiples of it. */
export const DEPTH_SIDE = 518;
const PATCH = 14;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** The depth model's input size for a picture: its short side 518, its long side as near its shape as patches allow. */
export function depthInputSize(width: number, height: number): Size {
  const long = (DEPTH_SIDE * Math.max(width, height)) / Math.max(1, Math.min(width, height));
  const l = Math.max(PATCH, Math.min(DEPTH_SIDE * 3, Math.round(long / PATCH) * PATCH));
  return width >= height ? { width: l, height: DEPTH_SIDE } : { width: DEPTH_SIDE, height: l };
}

/** A sample's encoded colour (0..1) at (x, y) between pixels, over mid-grey where it's transparent. */
function encodedAt(s: PixelSample, x: number, y: number, c: number): number {
  const x0 = Math.max(0, Math.min(s.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(s.height - 1, Math.floor(y)));
  const x1 = Math.min(s.width - 1, x0 + 1);
  const y1 = Math.min(s.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const v = (px: number, py: number) => {
    const i = (py * s.width + px) * 4;
    const a = s.data[i + 3] / 255;
    return (s.data[i + c] * a + 128 * (1 - a)) / 255;
  };
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
}

/** The depth model's input: the sample resized to `depthInputSize`, planar RGB normalised as it was trained. */
export function depthInput(sample: PixelSample): { data: Float32Array; width: number; height: number } {
  const { width, height } = depthInputSize(sample.width, sample.height);
  const out = new Float32Array(3 * width * height);
  const sx = sample.width / width;
  const sy = sample.height / height;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) * sx - 0.5;
      for (let c = 0; c < 3; c++) out[c * width * height + y * width + x] = (encodedAt(sample, u, v, c) - MEAN[c]) / STD[c];
    }
  }
  return { data: out, width, height };
}

/** `values` (`width` × `height`, filling the picture) read at the grid's cell centres, bilinear. */
export function resampleToGrid(values: Float32Array, width: number, height: number, grid: { width: number; height: number }): Float32Array {
  const out = new Float32Array(grid.width * grid.height);
  const at = (x: number, y: number) => values[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let j = 0; j < grid.height; j++) {
    const v = ((j + 0.5) * height) / grid.height - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let i = 0; i < grid.width; i++) {
      const u = ((i + 0.5) * width) / grid.width - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      out[j * grid.width + i] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}

/** Box means of `values` over (2r + 1)² cells, held at the edges (summed-area tables). */
function boxMean(values: Float64Array, width: number, height: number, r: number): Float64Array {
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += values[y * width + x];
      sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row;
    }
  }
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height, y + r + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width, x + r + 1);
      const sum = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** He's guided filter: `p` smoothed but for edges `guide` has, so a coarse map takes the picture's edges. */
export function guidedFilter(guide: Float64Array, p: Float64Array, width: number, height: number, r: number, eps: number): Float64Array {
  const mean = (v: Float64Array) => boxMean(v, width, height, r);
  const mI = mean(guide);
  const mP = mean(p);
  const mII = mean(guide.map((v) => v * v));
  const mIP = mean(guide.map((v, i) => v * p[i]));
  const a = new Float64Array(width * height);
  const b = new Float64Array(width * height);
  for (let i = 0; i < a.length; i++) {
    a[i] = (mIP[i] - mI[i] * mP[i]) / (mII[i] - mI[i] * mI[i] + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const mA = mean(a);
  const mB = mean(b);
  return guide.map((v, i) => mA[i] * v + mB[i]);
}

/** The q quantile of `values` (sorted copy). */
function quantile(values: ArrayLike<number>, q: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

/**
 * The depth model's answer (`width` × `height` inverse depths) as the grid's depth map: read at its cells, its range
 * (the 2nd to the 98th percentile of what the picture covers: a cut-out's empty surroundings aren't scenery) made 0..1
 * with 1 the nearest, then given the picture's own edges (a guided filter on its encoded luminance), so a blur or fog
 * by depth stops at the subject's outline rather than a little past it.
 */
export function depthMap(values: Float32Array, width: number, height: number, picture: PixelSample, grid: { width: number; height: number }): Float32Array {
  const raw = resampleToGrid(values, width, height, grid);
  const guide = new Float64Array(grid.width * grid.height);
  const covered: number[] = [];
  for (let j = 0; j < grid.height; j++) {
    for (let i = 0; i < grid.width; i++) {
      const x = Math.min(picture.width - 1, Math.floor(((i + 0.5) * picture.width) / grid.width));
      const y = Math.min(picture.height - 1, Math.floor(((j + 0.5) * picture.height) / grid.height));
      const k = (y * picture.width + x) * 4;
      guide[j * grid.width + i] = (0.2126 * picture.data[k] + 0.7152 * picture.data[k + 1] + 0.0722 * picture.data[k + 2]) / 255;
      if (picture.data[k + 3] >= 128) covered.push(raw[j * grid.width + i]);
    }
  }
  const range = covered.length >= 16 ? covered : raw;
  const lo = quantile(range, 0.02);
  const hi = quantile(range, 0.98);
  const span = Math.max(1e-6, hi - lo);
  const depth = Float64Array.from(raw, (v) => Math.min(1, Math.max(0, (v - lo) / span)));
  const r = Math.max(2, Math.round(Math.max(grid.width, grid.height) / 192));
  const refined = guidedFilter(guide, depth, grid.width, grid.height, r, 4e-3);
  return Float32Array.from(refined, (v) => Math.min(1, Math.max(0, v)));
}

/**
 * The tests' stand-in for the depth model (no download, no GPU): nearer lower down the picture, as the ground is in
 * most photos, and nearer still where the subject (`subject`, the stand-in's) is. Inverse depths, as the model's.
 */
export function standInDepth(grid: { width: number; height: number }, subject: Float32Array | null): { values: Float32Array; width: number; height: number } {
  const values = new Float32Array(grid.width * grid.height);
  for (let j = 0; j < grid.height; j++) {
    for (let i = 0; i < grid.width; i++) values[j * grid.width + i] = 0.1 + 0.6 * ((j + 0.5) / grid.height) + 0.3 * (subject?.[j * grid.width + i] ?? 0);
  }
  return { values, width: grid.width, height: grid.height };
}
