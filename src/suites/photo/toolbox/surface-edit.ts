/**
 * A surface edited on the CPU, tile by tile (docs/photo/tools/paint-bucket.md, "How"): the Paint Bucket's fills and
 * the Magic Eraser's erasing. The tiles a region reaches are read from the surface's manifest (the bytes this tab
 * holds, else the server's), handed to `compose` as floats with the region's coverage of each of their pixels,
 * hashed and listed in a new manifest, uploaded as a stroke's are (`uploads.ts`, the publication gate). The renderer
 * shows the new surface as it shows an undo. Only the tiles that change are stored again.
 */
import { fromHalf, toHalf } from "@shared/photo/half";
import { type Affine, apply, invert } from "@shared/photo/layers";
import { selectionBox, selectionCoverage } from "@shared/photo/selection";
import { type SurfaceManifest, type TileEntry, constantValues, emptySurface, withTiles } from "@shared/photo/surfaces";
import type { PhotoSelection, SurfaceId } from "@shared/photo/types";
import type { SurfaceUploads } from "../uploads";

/** A pixel layer's colour (`rgba16f`, premultiplied linear) or a mask's coverage (`r16f`). */
export type SurfaceKind = "pixels" | "mask";

/** The tile side a new surface gets (the renderer's). */
const TILE = 256;

const KINDS = {
  pixels: { format: "rgba16f", channels: 4, fill: [0, 0, 0, 0] },
  mask: { format: "r16f", channels: 1, fill: [1] },
} as const;

export interface SurfaceTarget {
  /** What it shows now (null: nothing painted, all fill). */
  surface: SurfaceId | null;
  kind: SurfaceKind;
  /** Its pixels. */
  size: { width: number; height: number };
  /** Its pixels → document pixels. */
  matrix: Affine;
}

/**
 * Changes a tile in place: `tile` holds `channels` floats a pixel, `size × size` of them (its top-left pixel at
 * `origin` of the surface); `cover` is how much the region covers each (0 past the surface's edge), or one number
 * for all. True when it changed something.
 */
export type ComposeTile = (tile: Float32Array, size: number, origin: { x: number; y: number }, cover: Float32Array | number) => boolean;

type Uploads = Pick<SurfaceUploads, "manifest" | "tile" | "hash" | "add">;

/** The tiles of a surface's grid that a document region can reach. */
export function tilesReached(region: PhotoSelection, target: Pick<SurfaceTarget, "size" | "matrix">, tile: number): { tx: number; ty: number }[] {
  const box = selectionBox(region);
  const inv = invert(target.matrix);
  const corners = [apply(inv, box.x0, box.y0), apply(inv, box.x1, box.y0), apply(inv, box.x0, box.y1), apply(inv, box.x1, box.y1)];
  const tilesX = Math.ceil(target.size.width / tile);
  const tilesY = Math.ceil(target.size.height / tile);
  const tx0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) / tile));
  const ty0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) / tile));
  const tx1 = Math.min(tilesX - 1, Math.floor(Math.max(...corners.map((p) => p.x)) / tile));
  const ty1 = Math.min(tilesY - 1, Math.floor(Math.max(...corners.map((p) => p.y)) / tile));
  const out: { tx: number; ty: number }[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) out.push({ tx, ty });
  return out;
}

/** A tile's samples as floats: a stored one's halves, a constant's value, or the fill. */
async function readTile(uploads: Uploads, manifest: SurfaceManifest, entry: TileEntry | undefined, channels: number): Promise<Float32Array> {
  const texels = manifest.tile * manifest.tile;
  const out = new Float32Array(texels * channels);
  const constant = entry ? constantValues(entry[2]) : manifest.fill;
  if (constant) {
    for (let i = 0; i < texels; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = constant[c];
    return out;
  }
  const halves = new Uint16Array(await uploads.tile(entry![2]));
  for (let i = 0; i < out.length; i++) out[i] = fromHalf(halves[i]);
  return out;
}

/** A frame's worth of work at a time, so a big fill doesn't freeze the page. */
const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

/**
 * Edits the tiles `region` reaches with `compose`, as a new surface. Resolves with its id, or null when nothing
 * changed (the region misses the surface, or compose left it as it was).
 */
export async function editSurface(uploads: Uploads, target: SurfaceTarget, region: PhotoSelection, compose: ComposeTile): Promise<SurfaceId | null> {
  const kind = KINDS[target.kind];
  const manifest = target.surface ? await uploads.manifest(target.surface) : emptySurface(kind.format, TILE, [...kind.fill]);
  const tile = manifest.tile;
  const listed = new Map(manifest.tiles.map((e) => [`${e[0]},${e[1]}`, e]));
  const changed: { tx: number; ty: number; bytes: ArrayBuffer }[] = [];
  let started = performance.now();
  for (const { tx, ty } of tilesReached(region, target, tile)) {
    const x0 = tx * tile;
    const y0 = ty * tile;
    let cover = selectionCoverage(region, target.matrix, x0, y0, tile, tile);
    if (cover === 0) continue;
    // Past the surface's edge there are no pixels to change.
    const w = Math.min(tile, target.size.width - x0);
    const h = Math.min(tile, target.size.height - y0);
    if (w < tile || h < tile) {
      const full = typeof cover === "number" ? new Float32Array(tile * tile).fill(cover) : cover;
      for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) if (x >= w || y >= h) full[y * tile + x] = 0;
      cover = full;
    }
    const data = await readTile(uploads, manifest, listed.get(`${tx},${ty}`), kind.channels);
    if (!compose(data, tile, { x: x0, y: y0 }, cover)) continue;
    const halves = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) halves[i] = toHalf(data[i]);
    changed.push({ tx, ty, bytes: halves.buffer });
    if (performance.now() - started > 30) {
      await yieldToPage();
      started = performance.now();
    }
  }
  if (!changed.length) return null;
  const { refs } = await uploads.hash(
    changed.map((t) => t.bytes),
    kind.channels,
  );
  const next = withTiles(
    manifest,
    changed.map((t, i): TileEntry => [t.tx, t.ty, refs[i]]),
  );
  if (next === manifest && target.surface) return target.surface;
  return uploads.add(next, refs);
}
