/**
 * A text raster's coverage as tiles (docs/photo/tools/type.md, "Drawing it"), pure so it's tested: the levels of its
 * pyramid (each pixel the mean of the up to four below it that exist, as the `reduce` kernel builds a source's), and
 * one tile of a level as premultiplied linear light in the layer's colour, or null where nothing is covered.
 */
import { levelSize } from "@shared/photo/geometry";

export interface CoverageLevel {
  width: number;
  height: number;
  /** 0..1 a pixel, row by row. */
  data: Float32Array;
}

/** Level 0 (coverage from 8-bit alpha) and `count - 1` reductions of it. */
export function coveragePyramid(alpha: ArrayLike<number>, width: number, height: number, count: number): CoverageLevel[] {
  const base = new Float32Array(width * height);
  for (let i = 0; i < base.length; i++) base[i] = alpha[i] / 255;
  return meanPyramid(base, width, height, count);
}

/** Any one-channel level 0 and `count - 1` reductions of it. */
export function meanPyramid(base: Float32Array, width: number, height: number, count: number): CoverageLevel[] {
  const levels: CoverageLevel[] = [{ width, height, data: base }];
  for (let level = 1; level < count; level++) {
    const below = levels[level - 1];
    const { width: w, height: h } = levelSize({ width, height }, level);
    const data = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = 2 * x + dx;
            const sy = 2 * y + dy;
            if (sx < below.width && sy < below.height) {
              sum += below.data[sy * below.width + sx];
              n++;
            }
          }
        }
        data[y * w + x] = n ? sum / n : 0;
      }
    }
    levels.push({ width: w, height: h, data });
  }
  return levels;
}

/**
 * Tile (tx, ty) of a level as RGBA samples: `colour` (linear light) times the coverage, premultiplied, outside the
 * level transparent. Null when it covers nothing (the image's fill shows there: no slot).
 */
export function coverageTile(level: CoverageLevel, tx: number, ty: number, tile: number, colour: readonly [number, number, number]): Float32Array | null {
  const out = new Float32Array(tile * tile * 4);
  let any = false;
  const x0 = tx * tile;
  const y0 = ty * tile;
  for (let y = 0; y < tile; y++) {
    const sy = y0 + y;
    if (sy >= level.height) break;
    for (let x = 0; x < tile; x++) {
      const sx = x0 + x;
      if (sx >= level.width) break;
      const a = level.data[sy * level.width + sx];
      if (a <= 0) continue;
      any = true;
      const i = (y * tile + x) * 4;
      out[i] = colour[0] * a;
      out[i + 1] = colour[1] * a;
      out[i + 2] = colour[2] * a;
      out[i + 3] = a;
    }
  }
  return any ? out : null;
}
