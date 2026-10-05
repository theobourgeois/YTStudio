/**
 * Where things are: tile grids and levels (the pyramid for zoomed-out views), and the view's mapping between
 * device pixels and document pixels. Document coordinates have their origin at the top-left pixel *edge*,
 * x right, y down, so pixel (i, j) covers [i, i + 1) × [j, j + 1) and its centre is at (i + ½, j + ½).
 * Every conversion lives here (docs/photo/rendering.md, "Coordinates, units and bounds").
 */
import type { TileSize } from "./lab.ts";

export interface Size {
  width: number;
  height: number;
}

export interface TileGrid {
  tilesX: number;
  tilesY: number;
}

export const tileGrid = ({ width, height }: Size, tile: TileSize): TileGrid => ({
  tilesX: Math.max(1, Math.ceil(width / tile)),
  tilesY: Math.max(1, Math.ceil(height / tile)),
});

/** A level's size: each level halves the one before, rounding up, so its last pixel may cover only half. */
export function levelSize(size: Size, level: number): Size {
  const s = 2 ** level;
  return { width: Math.max(1, Math.ceil(size.width / s)), height: Math.max(1, Math.ceil(size.height / s)) };
}

/** How many levels an image has: down to the first that fits in one tile. */
export function levelCount(size: Size, tile: TileSize): number {
  let level = 0;
  while (true) {
    const { width, height } = levelSize(size, level);
    if (width <= tile && height <= tile) return level + 1;
    level++;
  }
}

/**
 * The level to sample for a view showing `scale` device pixels per document pixel: the smallest image whose
 * resolution is still at or above the view's (level L has 2^-L pixels per document pixel), so reducing never
 * reads less detail than it shows.
 */
export function levelForScale(scale: number, levels: number): number {
  if (!(scale > 0) || scale >= 1) return 0;
  return Math.min(levels - 1, Math.max(0, Math.floor(-Math.log2(scale) + 1e-9)));
}

/**
 * What the canvas shows: `zoom` device pixels per document pixel, and the document point at the canvas's
 * top-left corner. `width` and `height` are the canvas in device pixels.
 */
export interface View {
  zoom: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 1 / 256;
export const MAX_ZOOM = 64;

export const viewToDoc = (view: View, px: number, py: number) => ({ x: view.x + px / view.zoom, y: view.y + py / view.zoom });
export const docToView = (view: View, x: number, y: number) => ({ x: (x - view.x) * view.zoom, y: (y - view.y) * view.zoom });

/** The whole document centred in the canvas, with `margin` device pixels around it. */
export function fitView(doc: Size, width: number, height: number, margin = 24): View {
  const zoom = Math.min((width - 2 * margin) / doc.width, (height - 2 * margin) / doc.height);
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  return { zoom: z, x: doc.width / 2 - width / 2 / z, y: doc.height / 2 - height / 2 / z, width, height };
}

/** Zoomed by `factor` about the canvas point (px, py), which stays over the same document point. */
export function zoomAbout(view: View, px: number, py: number, factor: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  const at = viewToDoc(view, px, py);
  return { ...view, zoom, x: at.x - px / zoom, y: at.y - py / zoom };
}

/** Moved by a drag of (dx, dy) device pixels: the document follows the pointer. */
export const panBy = (view: View, dx: number, dy: number): View => ({ ...view, x: view.x - dx / view.zoom, y: view.y - dy / view.zoom });

/** The tiles of `level` the view shows, with `margin` tiles around them, clipped to the image. */
export function visibleTiles(view: View, image: Size, level: number, tile: TileSize, margin = 0): { tx: number; ty: number }[] {
  const s = 2 ** -level;
  const { tilesX, tilesY } = tileGrid(levelSize(image, level), tile);
  const x0 = Math.max(0, Math.floor((view.x * s) / tile) - margin);
  const y0 = Math.max(0, Math.floor((view.y * s) / tile) - margin);
  const x1 = Math.min(tilesX - 1, Math.floor(((view.x + view.width / view.zoom) * s) / tile) + margin);
  const y1 = Math.min(tilesY - 1, Math.floor(((view.y + view.height / view.zoom) * s) / tile) + margin);
  const out: { tx: number; ty: number }[] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push({ tx, ty });
  return out;
}

/**
 * Mitchell–Netravali's cubic (B = C = ⅓): the final-quality resampling kernel (rendering.md, "Resampling").
 * Support is [-2, 2]; its small negative lobes are why alpha is clamped after it.
 */
export function mitchell(x: number): number {
  const B = 1 / 3;
  const C = 1 / 3;
  const t = Math.abs(x);
  if (t < 1) return ((12 - 9 * B - 6 * C) * t ** 3 + (-18 + 12 * B + 6 * C) * t ** 2 + (6 - 2 * B)) / 6;
  if (t < 2) return ((-B - 6 * C) * t ** 3 + (6 * B + 30 * C) * t ** 2 + (-12 * B - 48 * C) * t + (8 * B + 24 * C)) / 6;
  return 0;
}
