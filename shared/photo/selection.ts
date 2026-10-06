/**
 * Selections (docs/photo/ux.md, "Selections, masks and brushes"): a rectangle in document pixels, and how much of a
 * pixel it covers. Coverage is fractional: a pixel half inside covers 0.5, so an edge between pixels is
 * antialiased and whole-pixel edges are exact. The GPU computes the same coverage (`render/kernels.ts`,
 * `selection_coverage`) when it limits a stroke or makes a mask; this is its reference. Pure.
 */
import type { Size } from "./geometry.ts";
import { type Affine, apply } from "./layers.ts";
import type { PhotoSelection, RectSelection } from "./types.ts";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle from any two corners, clipped to the canvas; null when nothing of it is on the canvas. */
export function rectSelection(a: { x: number; y: number }, b: { x: number; y: number }, canvas: Size): RectSelection | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(canvas.width, Math.max(a.x, b.x));
  const y1 = Math.min(canvas.height, Math.max(a.y, b.y));
  if (!(x1 > x0 && y1 > y0)) return null;
  return { kind: "rect", x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The whole canvas (Select All, ⌘A). */
export const allSelection = (canvas: Size): RectSelection => ({ kind: "rect", x: 0, y: 0, width: canvas.width, height: canvas.height });

export const selectionBox = (s: PhotoSelection): Box => ({ x0: s.x, y0: s.y, x1: s.x + s.width, y1: s.y + s.height });

/** How much of the box [x0, x1] × [y0, y1] the selection covers, as a share of the box's area. */
export function boxCoverage(s: PhotoSelection, box: Box): number {
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (area <= 0) return 0;
  const w = Math.max(0, Math.min(box.x1, s.x + s.width) - Math.max(box.x0, s.x));
  const h = Math.max(0, Math.min(box.y1, s.y + s.height) - Math.max(box.y0, s.y));
  return Math.min(1, (w * h) / area);
}

/** Document pixel (px, py)'s coverage: the share of the pixel's square inside the selection. */
export const pixelCoverage = (s: PhotoSelection, px: number, py: number) => boxCoverage(s, { x0: px, y0: py, x1: px + 1, y1: py + 1 });

/** Samples a side across a pixel when a layer's pixel isn't an axis-aligned box in the document (it's turned). */
export const COVERAGE_SAMPLES = 8;

/**
 * Layer pixel (u, v)'s coverage, for a layer placed by `matrix` (layer pixels → document): exact when the layer is
 * axis-aligned (its pixel lands on a box: the box's share inside), else the mean of an 8 × 8 grid of points across
 * the pixel. A mask made from a selection, and paint the selection limits, use it.
 */
export function layerPixelCoverage(s: PhotoSelection, matrix: Affine, u: number, v: number): number {
  const [a, b, c, d] = matrix;
  // At a right angle a layer pixel lands on a box.
  if ((b === 0 && c === 0) || (a === 0 && d === 0)) {
    const p = apply(matrix, u, v);
    const q = apply(matrix, u + 1, v + 1);
    return boxCoverage(s, { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) });
  }
  let inside = 0;
  const n = COVERAGE_SAMPLES;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = apply(matrix, u + (i + 0.5) / n, v + (j + 0.5) / n);
      if (p.x >= s.x && p.x < s.x + s.width && p.y >= s.y && p.y < s.y + s.height) inside++;
    }
  }
  return inside / (n * n);
}

/** Whether a selection is the same rectangle (selecting it again is no undo step). */
export const sameSelection = (a: PhotoSelection | null, b: PhotoSelection | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
