/**
 * The glow's CPU reference (`../effects/glow.ts`): the whole definition computed on one image in f64, its pixel
 * (0, 0) at document pixel (0, 0). The GPU's tiled, cached evaluation is tested against it.
 */
import { type GlowParams, addLight, bspline, contribution, glowLight, glowShape } from "../effects/glow.ts";

/** Premultiplied linear RGBA, row by row. */
export interface FloatImage {
  width: number;
  height: number;
  data: Float64Array | Float32Array;
}

/** RGB planes of one pyramid level. */
interface Plane {
  width: number;
  height: number;
  rgb: Float64Array;
}

/** The pyramid's 2 × 2 box (transparent past the edge), as `render/compositor.ts`'s `reduce`. */
export function reducePlane(p: Plane): Plane {
  const width = Math.ceil(p.width / 2);
  const height = Math.ceil(p.height / 2);
  const rgb = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const sx = 2 * x + dx;
          const sy = 2 * y + dy;
          if (sx < p.width && sy < p.height) sum += p.rgb[(sy * p.width + sx) * 3 + c];
        }
        rgb[(y * width + x) * 3 + c] = sum / 4;
      }
    }
  }
  return { width, height, rgb };
}

/** A Gaussian's taps, normalised over −taps..taps. */
export function gaussianWeights(texels: number, taps: number): number[] {
  const w = Array.from({ length: 2 * taps + 1 }, (_, i) => Math.exp(-((i - taps) ** 2) / (2 * texels * texels)));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

/** A separable Gaussian, transparent past the edge. */
export function blurPlane(p: Plane, texels: number, taps: number): Plane {
  const w = gaussianWeights(texels, taps);
  const pass = (src: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(src.length);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let i = -taps; i <= taps; i++) {
            const sx = horizontal ? x + i : x;
            const sy = horizontal ? y : y + i;
            if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) continue;
            sum += src[(sy * p.width + sx) * 3 + c] * w[i + taps];
          }
          out[(y * p.width + x) * 3 + c] = sum;
        }
      }
    }
    return out;
  };
  return { width: p.width, height: p.height, rgb: pass(pass(p.rgb, true), false) };
}

/** A plane of level `level` read at document point (x, y) by the cubic B-spline. */
export function sampleBspline(p: Plane, level: number, x: number, y: number): [number, number, number] {
  const s = 2 ** level;
  const u = x / s - 0.5;
  const v = y / s - 0.5;
  const out: [number, number, number] = [0, 0, 0];
  for (let j = Math.floor(v) - 1; j <= Math.floor(v) + 2; j++) {
    if (j < 0 || j >= p.height) continue;
    const wy = bspline(v - j);
    for (let i = Math.floor(u) - 1; i <= Math.floor(u) + 2; i++) {
      if (i < 0 || i >= p.width) continue;
      const w = wy * bspline(u - i);
      for (let c = 0; c < 3; c++) out[c] += p.rgb[(j * p.width + i) * 3 + c] * w;
    }
  }
  return out;
}

/** The glow's light alone at every pixel (premultiplied rgb), and the image with it added. */
export function glowReference(image: FloatImage, params: GlowParams): { light: Float64Array; out: Float64Array } {
  const shape = glowShape(params);
  const { width, height, data } = image;
  const c0 = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = contribution(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3], shape.threshold, shape.knee);
    c0.set([r, g, b], i * 3);
  }
  const levels: Plane[] = [{ width, height, rgb: c0 }];
  const deepest = Math.max(...shape.octaves.map((o) => o.level));
  while (levels.length <= deepest) levels.push(reducePlane(levels[levels.length - 1]));
  const blurred = shape.octaves.map((o) => blurPlane(levels[o.level], o.texels, o.taps));
  const light = new Float64Array(width * height * 3);
  const out = new Float64Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum: [number, number, number] = [0, 0, 0];
      shape.octaves.forEach((o, j) => {
        const s = sampleBspline(blurred[j], o.level, x + 0.5, y + 0.5);
        for (let c = 0; c < 3; c++) sum[c] += s[c] * o.weight;
      });
      const l = glowLight(sum, shape);
      const i = y * width + x;
      light.set(l, i * 3);
      out.set(addLight([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]], l), i * 4);
    }
  }
  return { light, out };
}
