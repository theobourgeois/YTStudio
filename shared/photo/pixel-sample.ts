/**
 * The pixels the selection tools look at (docs/photo/selections.md): the photo as shown (Sample All Layers) or one
 * layer, rendered by the tab as 8-bit sRGB with straight alpha, at most `MAX_SAMPLE_SIDE` a side (a bigger photo is
 * sampled reduced: the wand's and Quick Selection's edges then land between document pixels, which the way back up
 * smooths). And the way back: coverage at the sample's size made a selection of the document's pixels. Pure.
 */
import type { Size } from "./geometry.ts";
import { trimMask } from "./selection.ts";
import type { MaskSelection } from "./types.ts";

/** The longest side a sample has (a 4032 × 3024 phone photo is sampled whole). */
export const MAX_SAMPLE_SIDE = 4096;

export interface PixelSample {
  width: number;
  height: number;
  /** RGBA, 0..255, straight alpha, row by row. */
  data: Uint8Array | Uint8ClampedArray;
  /** Sample pixels per document pixel (1: the document's own pixels). */
  scale: number;
}

/** The scale a photo of this size is sampled at. */
export const sampleScale = (canvas: Size, maxSide = MAX_SAMPLE_SIDE) => Math.min(1, maxSide / Math.max(canvas.width, canvas.height));

/** The sample's size for a canvas at `scale` (what the renderer makes). */
export const sampleSize = (canvas: Size, scale: number): Size => ({ width: Math.max(1, Math.round(canvas.width * scale)), height: Math.max(1, Math.round(canvas.height * scale)) });

/** A sample at half the size: each pixel the mean of the 2 × 2 under it (fewer at an odd edge). */
export function halveSample(s: PixelSample): PixelSample {
  const width = Math.max(1, Math.ceil(s.width / 2));
  const height = Math.max(1, Math.ceil(s.height / 2));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = 2 * x + dx;
          const sy = 2 * y + dy;
          if (sx >= s.width || sy >= s.height) continue;
          const i = (sy * s.width + sx) * 4;
          for (let c = 0; c < 4; c++) sum[c] += s.data[i + c];
          n++;
        }
      }
      for (let c = 0; c < 4; c++) data[(y * width + x) * 4 + c] = Math.round(sum[c] / n);
    }
  }
  return { width, height, data, scale: (s.scale * width) / s.width };
}

/**
 * Coverage at a sample's size (0..255, `width × height`, `scale` sample pixels per document pixel) as a selection of
 * the document: the same pixels at scale 1, else read between the sample's pixels (bilinear), which leaves an edge as
 * soft as one sample pixel. Null when nothing is covered.
 */
export function coverageToSelection(values: Uint8Array, width: number, height: number, scale: number, canvas: Size): MaskSelection | null {
  // The box of what's covered, in the sample.
  let sx0 = width;
  let sy0 = height;
  let sx1 = -1;
  let sy1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!values[y * width + x]) continue;
      if (x < sx0) sx0 = x;
      if (x > sx1) sx1 = x;
      if (y < sy0) sy0 = y;
      if (y > sy1) sy1 = y;
    }
  }
  if (sx1 < 0) return null;
  if (scale === 1 && width === canvas.width && height === canvas.height) {
    return trimMask(0, 0, width, height, values);
  }
  // The document pixels whose centres fall within a sample pixel of that box.
  const x0 = Math.max(0, Math.floor((sx0 - 0.5) / scale));
  const y0 = Math.max(0, Math.floor((sy0 - 0.5) / scale));
  const x1 = Math.min(canvas.width, Math.ceil((sx1 + 1.5) / scale));
  const y1 = Math.min(canvas.height, Math.ceil((sy1 + 1.5) / scale));
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h);
  const at = (x: number, y: number) => values[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let j = 0; j < h; j++) {
    const v = (y0 + j + 0.5) * scale - 0.5;
    const vy = Math.floor(v);
    const fy = v - vy;
    for (let i = 0; i < w; i++) {
      const u = (x0 + i + 0.5) * scale - 0.5;
      const ux = Math.floor(u);
      const fx = u - ux;
      const top = at(ux, vy) * (1 - fx) + at(ux + 1, vy) * fx;
      const bottom = at(ux, vy + 1) * (1 - fx) + at(ux + 1, vy + 1) * fx;
      out[j * w + i] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return trimMask(x0, y0, w, h, out);
}

/** A selection's coverage read at a sample's pixels (each pixel's centre in the document), 0..255. */
export function selectionAtSample(cover: (px: number, py: number) => number, width: number, height: number, scale: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const py = Math.floor((y + 0.5) / scale);
    for (let x = 0; x < width; x++) out[y * width + x] = Math.round(cover(Math.floor((x + 0.5) / scale), py) * 255);
  }
  return out;
}
