/**
 * Where a layer has something to show, for the Move tool's picking, marquee and smart guides: an image is its whole
 * box; a pixel layer is where it's painted, to the tile (a full-canvas paint layer would otherwise be picked
 * wherever the canvas is clicked). Pure: manifests come from the caller (known ones only; an unknown one counts as
 * its whole box).
 */
import type { Size } from "@shared/photo/geometry";
import { apply, bounds, invert, layerMatrix } from "@shared/photo/layers";
import { type SurfaceManifest, constantValues } from "@shared/photo/surfaces";
import type { PlacedLayer, SurfaceId } from "@shared/photo/types";
import type { Box } from "./snap";

/** Whether a manifest's tile shows nothing (no entry and a clear fill, or a clear constant). */
function clearTile(manifest: SurfaceManifest, tx: number, ty: number): boolean {
  const entry = manifest.tiles.find((e) => e[0] === tx && e[1] === ty);
  const values = entry ? constantValues(entry[2]) : manifest.fill;
  return values !== null && values[3] === 0;
}

/** The painted tiles of a pixel layer, in its own pixels (null: none; undefined: not known here). */
function paintedTiles(layer: PlacedLayer, manifest: (id: SurfaceId) => SurfaceManifest | null): { tx: number; ty: number }[] | null | undefined {
  if (layer.kind !== "pixel") return undefined;
  if (!layer.surface) return null;
  const m = manifest(layer.surface);
  if (!m) return undefined;
  const tiles = m.tiles.filter(([tx, ty]) => !clearTile(m, tx, ty)).map(([tx, ty]) => ({ tx, ty }));
  return tiles.length ? tiles : null;
}

/** The box around what a layer shows, in document pixels, or null when it shows nothing. */
export function contentBox(layer: PlacedLayer, size: Size, manifest: (id: SurfaceId) => SurfaceManifest | null, tile = 256): Box | null {
  const tiles = paintedTiles(layer, manifest);
  if (tiles === null) return null;
  if (tiles === undefined) return bounds(layer.transform, size);
  const m = layerMatrix(layer.transform, size);
  const points = tiles.flatMap(({ tx, ty }) => {
    const x0 = tx * tile;
    const y0 = ty * tile;
    const x1 = Math.min(size.width, x0 + tile);
    const y1 = Math.min(size.height, y0 + tile);
    return [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  });
  return {
    x0: Math.min(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    x1: Math.max(...points.map((p) => p.x)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

/** Whether document point (x, y) is on something the layer shows (a pixel layer: a painted tile). */
export function hitsContent(layer: PlacedLayer, size: Size, x: number, y: number, manifest: (id: SurfaceId) => SurfaceManifest | null, tile = 256): boolean {
  const p = apply(invert(layerMatrix(layer.transform, size)), x, y);
  if (p.x < 0 || p.y < 0 || p.x > size.width || p.y > size.height) return false;
  const tiles = paintedTiles(layer, manifest);
  if (tiles === null) return false;
  if (tiles === undefined) return true;
  const tx = Math.floor(p.x / tile);
  const ty = Math.floor(p.y / tile);
  return tiles.some((t) => t.tx === tx && t.ty === ty);
}
