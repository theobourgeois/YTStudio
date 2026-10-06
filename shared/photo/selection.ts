/**
 * Selections (docs/photo/ux.md, "Selections, masks and brushes"; docs/photo/selections.md): a rectangle in document
 * pixels, or a mask of each pixel's coverage, and how much of a pixel either covers. Coverage is fractional: a pixel
 * half inside a rectangle covers 0.5, so an edge between pixels is antialiased and whole-pixel edges are exact. The
 * GPU computes a rectangle's coverage itself (`render/kernels.ts`, `selection_coverage`) when it limits a stroke or
 * makes a mask, and is handed a mask's (`selectionCoverage`); this is its reference. Combining selections (the
 * options bar's modes), Inverse and the masks' boxes are here too. Pure.
 */
import type { Size } from "./geometry.ts";
import { type Affine, apply } from "./layers.ts";
import type { MaskSelection, PhotoSelection, RectSelection, SelectionMode } from "./types.ts";

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

/** The selection's box: nothing is selected outside it. */
export const selectionBox = (s: PhotoSelection): Box => ({ x0: s.x, y0: s.y, x1: s.x + s.width, y1: s.y + s.height });

/** A mask's coverage of document pixel (px, py), 0..1 (0 outside its box). */
function maskAt(s: MaskSelection, px: number, py: number): number {
  const x = px - s.x;
  const y = py - s.y;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return 0;
  return s.data[y * s.width + x] / 255;
}

/** How much of the box [x0, x1] × [y0, y1] the selection covers, as a share of the box's area. */
export function boxCoverage(s: PhotoSelection, box: Box): number {
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (area <= 0) return 0;
  if (s.kind === "rect") {
    const w = Math.max(0, Math.min(box.x1, s.x + s.width) - Math.max(box.x0, s.x));
    const h = Math.max(0, Math.min(box.y1, s.y + s.height) - Math.max(box.y0, s.y));
    return Math.min(1, (w * h) / area);
  }
  // Each pixel the box overlaps, weighted by how much of the box it is.
  const x0 = Math.max(s.x, Math.floor(box.x0));
  const y0 = Math.max(s.y, Math.floor(box.y0));
  const x1 = Math.min(s.x + s.width, Math.ceil(box.x1));
  const y1 = Math.min(s.y + s.height, Math.ceil(box.y1));
  let sum = 0;
  for (let py = y0; py < y1; py++) {
    const h = Math.min(box.y1, py + 1) - Math.max(box.y0, py);
    if (h <= 0) continue;
    const row = (py - s.y) * s.width - s.x;
    for (let px = x0; px < x1; px++) {
      const w = Math.min(box.x1, px + 1) - Math.max(box.x0, px);
      if (w > 0) sum += w * h * s.data[row + px];
    }
  }
  return Math.min(1, sum / 255 / area);
}

/** Document pixel (px, py)'s coverage: the share of the pixel's square inside the selection. */
export const pixelCoverage = (s: PhotoSelection, px: number, py: number) => (s.kind === "mask" ? maskAt(s, px, py) : boxCoverage(s, { x0: px, y0: py, x1: px + 1, y1: py + 1 }));

/** Samples a side across a pixel when a layer's pixel isn't an axis-aligned box in the document (it's turned). */
export const COVERAGE_SAMPLES = 8;

/** Whether a point of the document is inside (a rectangle), or how much its pixel is (a mask). */
function pointCoverage(s: PhotoSelection, x: number, y: number): number {
  if (s.kind === "rect") return x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height ? 1 : 0;
  return maskAt(s, Math.floor(x), Math.floor(y));
}

const rightAngled = (m: Affine) => (m[1] === 0 && m[2] === 0) || (m[0] === 0 && m[3] === 0);

/**
 * Layer pixel (u, v)'s coverage, for a layer placed by `matrix` (layer pixels → document): exact when the layer is
 * axis-aligned (its pixel lands on a box: the box's share inside), else the mean of an 8 × 8 grid of points across
 * the pixel. A mask made from a selection, and paint the selection limits, use it.
 */
export function layerPixelCoverage(s: PhotoSelection, matrix: Affine, u: number, v: number, samples = COVERAGE_SAMPLES): number {
  // At a right angle a layer pixel lands on a box.
  if (rightAngled(matrix)) {
    const p = apply(matrix, u, v);
    const q = apply(matrix, u + 1, v + 1);
    return boxCoverage(s, { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) });
  }
  let inside = 0;
  const n = samples;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = apply(matrix, u + (i + 0.5) / n, v + (j + 0.5) / n);
      inside += pointCoverage(s, p.x, p.y);
    }
  }
  return inside / (n * n);
}

/**
 * A region of a surface's pixels (`x0, y0`, `width × height`, placed by `matrix`) as the selection covers them, row by
 * row, or one number when it's the same everywhere (a tile wholly inside or outside): what the GPU is handed for a
 * mask selection (a stroke's limit, a mask made from it). A turned layer samples 4 × 4 points a pixel.
 */
export function selectionCoverage(s: PhotoSelection, matrix: Affine, x0: number, y0: number, width: number, height: number): Float32Array | number {
  // The region's box in the document: outside the selection's box it's 0.
  const corners = [apply(matrix, x0, y0), apply(matrix, x0 + width, y0), apply(matrix, x0, y0 + height), apply(matrix, x0 + width, y0 + height)];
  const bx0 = Math.min(...corners.map((p) => p.x));
  const by0 = Math.min(...corners.map((p) => p.y));
  const bx1 = Math.max(...corners.map((p) => p.x));
  const by1 = Math.max(...corners.map((p) => p.y));
  if (bx1 <= s.x || by1 <= s.y || bx0 >= s.x + s.width || by0 >= s.y + s.height) return 0;
  const out = new Float32Array(width * height);
  const samples = rightAngled(matrix) ? COVERAGE_SAMPLES : 4;
  let first = -1;
  let uniform = true;
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const c = layerPixelCoverage(s, matrix, x0 + u, y0 + v, samples);
      out[v * width + u] = c;
      if (first < 0) first = c;
      else if (c !== first) uniform = false;
    }
  }
  return uniform ? first : out;
}

/** Whether a selection is the same (selecting it again is no undo step). */
export function sameSelection(a: PhotoSelection | null, b: PhotoSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false;
  if (a.kind === "rect" || b.kind === "rect") return true;
  if (a.data === b.data) return true;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** A mask of the box `x, y, width × height` (whole pixels), cut down to where anything is selected; null when nothing is. */
export function trimMask(x: number, y: number, width: number, height: number, data: Uint8Array): MaskSelection | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < height; j++) {
    const row = j * width;
    let first = -1;
    let last = -1;
    for (let i = 0; i < width; i++) {
      if (data[row + i]) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) continue;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (j < y0) y0 = j;
    y1 = j;
  }
  if (x1 < 0) return null;
  if (x0 === 0 && y0 === 0 && x1 === width - 1 && y1 === height - 1) return { kind: "mask", x, y, width, height, data };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) out.set(data.subarray((y0 + j) * width + x0, (y0 + j) * width + x0 + w), j * w);
  return { kind: "mask", x: x + x0, y: y + y0, width: w, height: h, data: out };
}

/** A selection's coverage over the whole-pixel box `b` (inside the canvas), 0..255 row by row. */
export function coverageIn(s: PhotoSelection | null, b: { x: number; y: number; width: number; height: number }): Uint8Array {
  const out = new Uint8Array(b.width * b.height);
  if (!s) return out;
  const x0 = Math.max(b.x, Math.floor(s.x));
  const y0 = Math.max(b.y, Math.floor(s.y));
  const x1 = Math.min(b.x + b.width, Math.ceil(s.x + s.width));
  const y1 = Math.min(b.y + b.height, Math.ceil(s.y + s.height));
  if (x1 <= x0) return out;
  for (let py = y0; py < y1; py++) {
    const row = (py - b.y) * b.width - b.x;
    if (s.kind === "mask") {
      const from = (py - s.y) * s.width - s.x;
      out.set(s.data.subarray(from + x0, from + x1), row + x0);
      continue;
    }
    const h = Math.min(py + 1, s.y + s.height) - Math.max(py, s.y);
    for (let px = x0; px < x1; px++) {
      const w = Math.min(px + 1, s.x + s.width) - Math.max(px, s.x);
      out[row + px] = Math.round(Math.max(0, Math.min(1, w * h)) * 255);
    }
  }
  return out;
}

/** The whole-pixel box around a selection. */
function pixelBox(s: PhotoSelection) {
  const x = Math.floor(s.x);
  const y = Math.floor(s.y);
  return { x, y, width: Math.ceil(s.x + s.width) - x, height: Math.ceil(s.y + s.height) - y };
}

/** A selection as a mask (a rectangle's fractional edges as coverage). */
export function maskOf(s: PhotoSelection): MaskSelection | null {
  if (s.kind === "mask") return s;
  const b = pixelBox(s);
  return trimMask(b.x, b.y, b.width, b.height, coverageIn(s, b));
}

/**
 * A new selection `shape` meeting the one there (`base`), Photoshop's way: New replaces it, Add keeps the more
 * covered of the two, Subtract takes the shape's coverage out, Intersect keeps what both cover (multiplied). Null
 * when nothing is left selected. Two rectangles intersect as a rectangle.
 */
export function combineSelections(base: PhotoSelection | null, shape: PhotoSelection | null, mode: SelectionMode): PhotoSelection | null {
  if (mode === "new") return shape;
  // Nothing selected: adding is selecting; taking from (or meeting) nothing leaves nothing.
  if (!base) return mode === "add" ? shape : null;
  if (!shape) return mode === "intersect" ? null : base;
  if (mode === "intersect" && base.kind === "rect" && shape.kind === "rect") {
    const x0 = Math.max(base.x, shape.x);
    const y0 = Math.max(base.y, shape.y);
    const x1 = Math.min(base.x + base.width, shape.x + shape.width);
    const y1 = Math.min(base.y + base.height, shape.y + shape.height);
    return x1 > x0 && y1 > y0 ? { kind: "rect", x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }
  const a = pixelBox(base);
  const b = pixelBox(shape);
  const box =
    mode === "add"
      ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x1: Math.max(a.x + a.width, b.x + b.width), y1: Math.max(a.y + a.height, b.y + b.height) }
      : mode === "subtract"
        ? { x: a.x, y: a.y, x1: a.x + a.width, y1: a.y + a.height }
        : { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), x1: Math.min(a.x + a.width, b.x + b.width), y1: Math.min(a.y + a.height, b.y + b.height) };
  const region = { x: box.x, y: box.y, width: box.x1 - box.x, height: box.y1 - box.y };
  if (region.width <= 0 || region.height <= 0) return null;
  const p = coverageIn(base, region);
  const q = coverageIn(shape, region);
  const out = new Uint8Array(p.length);
  for (let i = 0; i < out.length; i++) {
    out[i] = mode === "add" ? Math.max(p[i], q[i]) : mode === "subtract" ? Math.round((p[i] * (255 - q[i])) / 255) : Math.round((p[i] * q[i]) / 255);
  }
  return trimMask(region.x, region.y, region.width, region.height, out);
}

/** Select › Inverse (⇧⌘I): what wasn't selected, over the whole canvas; null when everything was. */
export function invertSelection(s: PhotoSelection, canvas: Size): PhotoSelection | null {
  const all = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const c = coverageIn(s, all);
  for (let i = 0; i < c.length; i++) c[i] = 255 - c[i];
  return trimMask(0, 0, canvas.width, canvas.height, c);
}

/** How many pixels' worth a selection covers (its coverage summed). */
export function selectedArea(s: PhotoSelection): number {
  if (s.kind === "rect") return s.width * s.height;
  let sum = 0;
  for (let i = 0; i < s.data.length; i++) sum += s.data[i];
  return sum / 255;
}

/** The mode a press with these keys gives (Photoshop's: Shift adds, Alt subtracts, both intersect), else the option's. */
export function modeFor(e: { shiftKey: boolean; altKey: boolean }, option: SelectionMode): SelectionMode {
  if (e.shiftKey && e.altKey) return "intersect";
  if (e.shiftKey) return "add";
  if (e.altKey) return "subtract";
  return option;
}
