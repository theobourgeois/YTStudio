/**
 * Selections drawn as shapes (docs/photo/selections.md): the Lasso's and the Polygonal Lasso's outlines and the
 * Elliptical Marquee, filled by the nonzero rule (a loop drawn over itself stays selected, as Photoshop's), and
 * Feather. Anti-aliased, a shape's edge pixels are covered by how much of them is inside: four rows of samples a
 * pixel, each crossing exact along the row. Without it a pixel is in when its centre is. Pure.
 */
import type { Size } from "./geometry.ts";
import { coverageIn, maskOf, trimMask } from "./selection.ts";
import type { MaskSelection, PhotoSelection } from "./types.ts";

export interface Point {
  x: number;
  y: number;
}

/** Sub-rows of samples a pixel when anti-aliased. */
const ROWS = 4;

/**
 * A closed outline (the last point joins the first) as a selection, clipped to the canvas; null when it covers
 * nothing (fewer than three points, no area, or off the canvas).
 */
export function polygonSelection(points: readonly Point[], canvas: Size, antiAlias = true): MaskSelection | null {
  if (points.length < 3) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(canvas.height, Math.ceil(Math.max(...ys)));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;
  const edges: { ax: number; ay: number; bx: number; by: number; dir: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y === b.y) continue;
    edges.push(a.y < b.y ? { ax: a.x, ay: a.y, bx: b.x, by: b.y, dir: 1 } : { ax: b.x, ay: b.y, bx: a.x, by: a.y, dir: -1 });
  }
  const data = new Uint8Array(width * height);
  const row = new Float32Array(width);
  const rows = antiAlias ? ROWS : 1;
  const crossings: { x: number; dir: number }[] = [];
  for (let j = 0; j < height; j++) {
    row.fill(0);
    for (let r = 0; r < rows; r++) {
      const y = y0 + j + (r + 0.5) / rows;
      crossings.length = 0;
      for (const e of edges) {
        if (y < e.ay || y >= e.by) continue;
        crossings.push({ x: e.ax + ((y - e.ay) / (e.by - e.ay)) * (e.bx - e.ax), dir: e.dir });
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a.x - b.x);
      // Spans where the winding number isn't 0.
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k].dir;
        if (winding === 0) continue;
        const from = crossings[k].x - x0;
        const to = crossings[k + 1].x - x0;
        if (antiAlias) addSpan(row, from, to, 1 / rows);
        else addCentres(row, from, to);
      }
    }
    for (let i = 0; i < width; i++) data[j * width + i] = Math.round(Math.min(1, row[i]) * 255);
  }
  return trimMask(x0, y0, width, height, data);
}

/** Adds `weight` × how much of each pixel [i, i + 1) the span [from, to) covers. */
function addSpan(row: Float32Array, from: number, to: number, weight: number) {
  const a = Math.max(0, from);
  const b = Math.min(row.length, to);
  if (b <= a) return;
  const first = Math.floor(a);
  const last = Math.min(row.length - 1, Math.ceil(b) - 1);
  for (let i = first; i <= last; i++) row[i] += weight * (Math.min(b, i + 1) - Math.max(a, i));
}

/** Pixels whose centre the span [from, to) holds. */
function addCentres(row: Float32Array, from: number, to: number) {
  const first = Math.max(0, Math.ceil(from - 0.5));
  const last = Math.min(row.length - 1, Math.ceil(to - 0.5) - 1);
  for (let i = first; i <= last; i++) row[i] = 1;
}

/** The ellipse inside the box from `a` to `b` (the Elliptical Marquee), as an outline fine enough to look round. */
export function ellipsePoints(a: Point, b: Point): Point[] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  // A segment every ~2 px of its edge (a chord's sag stays well under a hundredth of a pixel), at least 32.
  const n = Math.max(32, Math.min(4096, Math.ceil((Math.PI * (rx + ry)) / 2)));
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

export const ellipseSelection = (a: Point, b: Point, canvas: Size, antiAlias = true) => polygonSelection(ellipsePoints(a, b), canvas, antiAlias);

/**
 * Feather (Photoshop's, by a radius in pixels): the selection's coverage blurred, about as a Gaussian of that
 * radius's sigma (three box blurs), grown by the blur's reach and kept inside the canvas.
 */
export function featherSelection(s: PhotoSelection, radius: number, canvas: Size): MaskSelection | null {
  const r = Math.max(0, radius);
  if (r < 0.1) return maskOf(s);
  const x = Math.floor(s.x);
  const y = Math.floor(s.y);
  const boxes = boxesForGauss(r, 3);
  const reach = boxes.reduce((sum, b) => sum + b, 0);
  const x0 = Math.max(0, x - reach);
  const y0 = Math.max(0, y - reach);
  const x1 = Math.min(canvas.width, Math.ceil(s.x + s.width) + reach);
  const y1 = Math.min(canvas.height, Math.ceil(s.y + s.height) + reach);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;
  const a = Float32Array.from(coverageIn(s, { x: x0, y: y0, width, height }));
  const b = new Float32Array(a.length);
  for (const half of boxes) {
    boxBlur(a, b, width, height, half, true);
    boxBlur(b, a, width, height, half, false);
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i]);
  return trimMask(x0, y0, width, height, out);
}

/** Half-widths of `n` box blurs that together are about a Gaussian of `sigma` (Kovesi's). */
function boxesForGauss(sigma: number, n: number): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** One box blur of half-width `r` along rows (`horizontal`) or columns, zero outside, from `src` into `dst`. */
function boxBlur(src: Float32Array, dst: Float32Array, width: number, height: number, r: number, horizontal: boolean) {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const scale = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const start = horizontal ? l * width : l;
    let sum = 0;
    for (let k = 0; k <= Math.min(r, length - 1); k++) sum += src[start + k * step];
    for (let k = 0; k < length; k++) {
      dst[start + k * step] = sum * scale;
      const add = k + r + 1;
      const drop = k - r;
      if (add < length) sum += src[start + add * step];
      if (drop >= 0) sum -= src[start + drop * step];
    }
  }
}
