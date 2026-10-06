/**
 * Patterns (docs/photo/layer-style/README.md, phase L4): the built-in set, made by code, and how a pattern is laid on
 * the canvas and read, as measured in Photoshop 27.11 (photoshop-measurements.md, "Patterns"):
 *
 * - a pixel shows the texel at (pixel − origin − phase), its corner, rotated by Angle and divided by Scale: Phase is
 *   in pixels, the origin is the canvas's (or, with Link with Layer, the layer's top-left);
 * - at 100% a pixel is exactly a texel; enlarged, texels are mixed linearly (texel i at coordinate i); reduced, the
 *   pattern's mip level for the footprint is read (50%: the 2 × 2 box, as Photoshop does).
 *
 * Patterns are held as premultiplied encoded RGBA (Photoshop reduces and mixes them on encoded values). A Pattern
 * Overlay paints a pattern's colour; Bevel's Texture reads its luminance (`textureHeight`). The GPU's `render/style.ts`
 * does the same arithmetic in WGSL.
 */
import { linearToSrgb } from "../colour.ts";
import type { PhotoPattern, PhotoProject } from "../types.ts";

/** The largest side a pattern can have (Define Pattern refuses a bigger selection). */
export const MAX_PATTERN_SIDE = 1024;

/** A pattern's pixels: premultiplied encoded RGBA, row by row. */
export interface PatternImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** A built-in pattern: made by code, never stored. */
export interface BuiltInPattern {
  id: `builtin:${string}`;
  name: string;
  make: () => PatternImage;
}

const image = (width: number, height: number, grey: (x: number, y: number) => number | [number, number, number]): PatternImage => {
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const g = grey(x, y);
      const [r, gg, b] = typeof g === "number" ? [g, g, g] : g;
      data.set([r, gg, b, 1], (y * width + x) * 4);
    }
  return { width, height, data };
};

/** A tileable lattice noise (value noise on a torus): repeatable, seeded. */
function latticeNoise(size: number, cells: number, seed: number) {
  const lattice = new Float32Array(cells * cells);
  let s = seed >>> 0;
  for (let i = 0; i < lattice.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    lattice[i] = ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  }
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = ((x + 0.5) / size) * cells;
    const fy = ((y + 0.5) / size) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const at = (i: number, j: number) => lattice[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const BUILT_IN_PATTERNS: readonly BuiltInPattern[] = [
  { id: "builtin:checkerboard", name: "Checkerboard", make: () => image(16, 16, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? 0.55 : 0.85) },
  { id: "builtin:stripes", name: "Diagonal Stripes", make: () => image(16, 16, (x, y) => ((x + y) & 15) < 8 ? 0.3 : 0.8) },
  {
    id: "builtin:dots",
    name: "Dots",
    make: () => image(16, 16, (x, y) => 0.85 - 0.6 * clamp01(5 - Math.hypot(x + 0.5 - 8, y + 0.5 - 8) + 0.5)),
  },
  { id: "builtin:grid", name: "Grid", make: () => image(16, 16, (x, y) => (x === 0 || y === 0 ? 0.35 : 0.9)) },
  {
    id: "builtin:bricks",
    name: "Bricks",
    make: () =>
      image(64, 32, (x, y) => {
        const row = y >> 4;
        const xx = (x + (row % 2) * 16) & 63;
        const mortar = y % 16 === 0 || xx % 32 === 0;
        return mortar ? [0.82, 0.8, 0.76] : [0.62, 0.32, 0.24];
      }),
  },
  { id: "builtin:noise", name: "Noise", make: () => image(64, 64, latticeNoise(64, 64, 7)) },
  {
    id: "builtin:clouds",
    name: "Clouds",
    make: () => {
      const octaves = [latticeNoise(128, 4, 11), latticeNoise(128, 8, 12), latticeNoise(128, 16, 13), latticeNoise(128, 32, 14)];
      return image(128, 128, (x, y) => clamp01(0.5 * octaves[0](x, y) + 0.25 * octaves[1](x, y) + 0.15 * octaves[2](x, y) + 0.1 * octaves[3](x, y)));
    },
  },
  {
    id: "builtin:canvas",
    name: "Canvas",
    make: () => {
      const grain = latticeNoise(32, 32, 21);
      return image(32, 32, (x, y) => {
        const warp = ((x >> 2) + (y >> 2)) % 2 === 0;
        const thread = 0.5 + 0.5 * Math.sin(((warp ? x : y) + 0.5) * (Math.PI / 2));
        return 0.55 + 0.25 * thread + 0.12 * grain(x, y);
      });
    },
  },
  { id: "builtin:crosshatch", name: "Crosshatch", make: () => image(16, 16, (x, y) => ((x + y) % 8 === 0 || (x - y + 16) % 8 === 0 ? 0.25 : 0.88)) },
  { id: "builtin:waves", name: "Waves", make: () => image(64, 32, (x, y) => 0.55 + 0.35 * Math.sin(((y + 0.5) / 32) * 2 * Math.PI + Math.sin(((x + 0.5) / 64) * 2 * Math.PI) * 1.5)) },
];

const builtInLevels = new Map<string, PatternImage[]>();

/** A built-in pattern's levels (made once). */
export function builtInPatternLevels(id: string): PatternImage[] | null {
  let levels = builtInLevels.get(id);
  if (!levels) {
    const p = builtInPattern(id);
    if (!p) return null;
    levels = patternMips(p.make());
    builtInLevels.set(id, levels);
  }
  return levels;
}

/** The pattern effects start with. */
export const DEFAULT_PATTERN = BUILT_IN_PATTERNS[0].id;

export const builtInPattern = (id: string) => BUILT_IN_PATTERNS.find((p) => p.id === id);

/** A pattern by id: the document's, or a built-in one; undefined when it's neither. */
export const findPattern = (doc: Pick<PhotoProject, "patterns">, id: string): PhotoPattern | BuiltInPattern | undefined => builtInPattern(id) ?? doc.patterns?.find((p) => p.id === id);

/** A pattern's name for people and the model ("missing" when it's gone). */
export const patternName = (doc: Pick<PhotoProject, "patterns">, id: string) => findPattern(doc, id)?.name ?? `missing pattern ${id}`;

/**
 * A pattern from premultiplied linear-light pixels (a surface's, `rgba16f`): encoded, still premultiplied, which is
 * how patterns are read.
 */
export function patternFromLinear(width: number, height: number, linear: ArrayLike<number>): PatternImage {
  const data = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = clamp01(linear[i * 4 + 3]);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = linearToSrgb(clamp01(linear[i * 4 + c] / a)) * a;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

/** A pattern's levels: itself, then each the 2 × 2 box of the last, while both sides halve evenly. */
export function patternMips(base: PatternImage): PatternImage[] {
  const levels = [base];
  for (let l = base; l.width % 2 === 0 && l.height % 2 === 0 && Math.max(l.width, l.height) > 1; ) {
    const w = l.width / 2;
    const h = l.height / 2;
    const data = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          const at = (xx: number, yy: number) => l.data[(yy * l.width + xx) * 4 + c];
          data[(y * w + x) * 4 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
        }
    l = { width: w, height: h, data };
    levels.push(l);
  }
  return levels;
}

/** Where a pattern lies: its origin (document pixels), Phase (pixels), Angle (degrees anticlockwise) and Scale (1 = 100%). */
export interface PatternPlacement {
  origin: { x: number; y: number };
  phase: { x: number; y: number };
  angle: number;
  scale: number;
}

/**
 * Where an effect's pattern lies, from its parameters (`keys`: which ones, `PatternKeys`): its origin is the layer's
 * top-left with Link with Layer, else the canvas's.
 */
export function placementOf(params: Record<string, unknown>, keys: { angle: string; scale: string; link: string; phaseX: string; phaseY: string }, layerOrigin: { x: number; y: number }): PatternPlacement {
  const num = (k: string, fallback: number) => (typeof params[k] === "number" ? (params[k] as number) : fallback);
  return {
    origin: params[keys.link] === false ? { x: 0, y: 0 } : layerOrigin,
    // Photoshop moves a pattern by whole pixels (a phase of 2.5 lands as 3).
    phase: { x: Math.round(num(keys.phaseX, 0)), y: Math.round(num(keys.phaseY, 0)) },
    angle: num(keys.angle, 0),
    scale: Math.max(0.01, num(keys.scale, 100) / 100),
  };
}

/** An angle's cosine and sine, exact at quarter turns (so a turned pattern's texels stay whole). */
export function turn(degrees: number): [number, number] {
  const q = ((degrees % 360) + 360) % 360;
  if (q === 0) return [1, 0];
  if (q === 90) return [0, 1];
  if (q === 180) return [-1, 0];
  if (q === 270) return [0, -1];
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** A coordinate held to 1/4096 of a texel, so arithmetic's last bits never move a sample across a texel. */
const snap = (v: number) => Math.round(v * 4096) / 4096;

/**
 * The pattern coordinate (level-0 texels, texel i at i) at a document point (a pixel's centre: x + ½). Photoshop's
 * turned patterns are within a fraction of a pixel of this (where it pivots isn't measured).
 */
export function patternCoord(x: number, y: number, p: PatternPlacement): { u: number; v: number } {
  const [c, s] = turn(p.angle);
  const dx = x - p.origin.x - p.phase.x;
  const dy = y - p.origin.y - p.phase.y;
  return { u: snap((c * dx - s * dy - 0.5) / p.scale), v: snap((s * dx + c * dy - 0.5) / p.scale) };
}

/** The level read for a footprint of `footprint` level-0 texels a pixel. */
export const patternLevel = (levels: number, footprint: number) => Math.max(0, Math.min(levels - 1, Math.floor(Math.log2(Math.max(1, footprint)) + 1e-9)));

/** A pattern's premultiplied encoded RGBA at (u, v), tiled, read at the level for `footprint`. */
export function samplePattern(levels: readonly PatternImage[], u: number, v: number, footprint: number): [number, number, number, number] {
  const L = patternLevel(levels.length, footprint);
  const img = levels[L];
  const x = u / 2 ** L;
  const y = v / 2 ** L;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const at = (xx: number, yy: number, c: number) => img.data[((((yy % img.height) + img.height) % img.height) * img.width + (((xx % img.width) + img.width) % img.width)) * 4 + c];
  for (let c = 0; c < 4; c++) {
    const top = at(x0, y0, c) + (at(x0 + 1, y0, c) - at(x0, y0, c)) * tx;
    const bottom = at(x0, y0 + 1, c) + (at(x0 + 1, y0 + 1, c) - at(x0, y0 + 1, c)) * tx;
    out[c] = top + (bottom - top) * ty;
  }
  return out;
}

/** Photoshop's grey of a premultiplied encoded pixel (its Texture's height: dark is raised). */
export const patternLuminance = (p: readonly number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

/**
 * Bevel's Texture at a point (measured: the height added is Texture Depth × (1 − luminance), no smoothing, Invert
 * raising light texels instead; it's lit through the bevel's own Depth and Size, as the bevel's slopes are).
 */
export function textureHeight(levels: readonly PatternImage[], u: number, v: number, footprint: number, depth: number, invert: boolean): number {
  const y = patternLuminance(samplePattern(levels, u, v, footprint));
  return depth * (invert ? y : 1 - y);
}
