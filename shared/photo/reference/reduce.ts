/**
 * CPU references for reducing: the pyramid's 2 × 2 box (rendering.md, "Resampling") and Mitchell sampling of a
 * level at a view's pixels, as the GPU does it (the compositor's `bicubic`). A refined view is a document's
 * full-resolution render through these; tests compare the GPU's with them.
 */
import { mitchell } from "../geometry.ts";

/** An RGBA float image: `data[(y * width + x) * 4 + c]`. */
export interface FloatImage {
  width: number;
  height: number;
  data: Float32Array | Float64Array;
}

/** The next level: each pixel the mean of the four below it (missing ones, past an odd edge, are transparent). */
export function boxReduce(image: FloatImage): FloatImage {
  const width = Math.max(1, Math.ceil(image.width / 2));
  const height = Math.max(1, Math.ceil(image.height / 2));
  const data = new Float64Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = 2 * x + dx;
          const sy = 2 * y + dy;
          if (sx >= image.width || sy >= image.height) continue;
          for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] += image.data[(sy * image.width + sx) * 4 + c] / 4;
        }
      }
    }
  }
  return { width, height, data };
}

/**
 * Mitchell at level-pixel position p (centres at half-integers), stretched by `stretch` (≥ 1, so reducing never
 * aliases): the weights normalised, alpha clamped to [0, 1]. Pixels outside the image are transparent.
 */
export function sampleMitchell(image: FloatImage, px: number, py: number, stretch: number): [number, number, number, number] {
  const fx = px - 0.5;
  const fy = py - 0.5;
  const reach = 2 * stretch;
  const out = [0, 0, 0, 0];
  let total = 0;
  for (let y = Math.ceil(fy - reach); y <= Math.floor(fy + reach); y++) {
    const wy = mitchell((y - fy) / stretch);
    for (let x = Math.ceil(fx - reach); x <= Math.floor(fx + reach); x++) {
      const w = wy * mitchell((x - fx) / stretch);
      total += w;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      for (let c = 0; c < 4; c++) out[c] += image.data[(y * image.width + x) * 4 + c] * w;
    }
  }
  const [r, g, b, a] = out.map((v) => v / total);
  return [r, g, b, Math.min(1, Math.max(0, a))];
}
