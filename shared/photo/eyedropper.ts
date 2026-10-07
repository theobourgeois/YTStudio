/**
 * The Eyedropper (docs/photo/tools/eyedropper.md): the colour under a point, averaged over Photoshop's Sample Size
 * square. Pure: the tab renders the square's pixels (`eyedropperBox` says which), this reads them.
 */
import type { Size } from "./geometry.ts";
import type { PixelSample } from "./pixel-sample.ts";

/** The document pixels a sample of `size` (1: the pixel alone) at `at` reads, inside the canvas: null off it. */
export function eyedropperBox(at: { x: number; y: number }, size: number, canvas: Size): { x: number; y: number; width: number; height: number } | null {
  if (!(at.x >= 0 && at.y >= 0 && at.x < canvas.width && at.y < canvas.height)) return null;
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.y);
  const half = Math.floor((Math.max(1, Math.round(size)) - 1) / 2);
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const x1 = Math.min(canvas.width, cx + half + 1);
  const y1 = Math.min(canvas.height, cy + half + 1);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const hex2 = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

/**
 * A sample's pixels averaged as "#rrggbb", each weighted by its alpha (straight alpha: a half-transparent pixel's
 * colour counts half), or null when they're all transparent: there's no colour there to pick, as in Photoshop.
 */
export function averageColour(sample: Pick<PixelSample, "width" | "height" | "data">): string | null {
  const { data } = sample;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let i = 0; i < sample.width * sample.height * 4; i += 4) {
    const w = data[i + 3];
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    a += w;
  }
  return a === 0 ? null : `#${hex2(r / a)}${hex2(g / a)}${hex2(b / a)}`;
}
