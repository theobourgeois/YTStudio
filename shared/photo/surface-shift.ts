/**
 * A surface moved by whole pixels (a canvas crop moves the masks that are in document pixels:
 * docs/photo/tools/crop.md). Nothing is resampled: each new tile is the old samples, exactly. A move by a whole number
 * of tiles only renumbers the manifest's tiles; any other is made from the (up to) four old tiles under each new one,
 * by the caller, which has their bytes (`composeShiftedTile`). Pure.
 */
import type { Size } from "./geometry.ts";
import { tileGrid } from "./geometry.ts";
import { toHalf } from "./half.ts";
import { FORMAT_INFO, type SurfaceManifest, type TileEntry, constantRef, constantValues, withTiles } from "./surfaces.ts";

/** Where a new tile's samples come from: an old tile's place, and where its top-left lands in the new tile. */
export interface ShiftSource {
  tx: number;
  ty: number;
  /** The old tile's top-left, in the new tile's pixels (between −tile and tile). */
  ox: number;
  oy: number;
  /** The old tile's entry, or null where it's the fill. */
  ref: string | null;
}

/** A new tile to make from old ones. */
export interface ShiftedTile {
  tx: number;
  ty: number;
  sources: ShiftSource[];
}

/**
 * How a surface moves by (dx, dy) whole pixels (its samples land dx right and dy down) onto a grid of `size`: the
 * manifest at once when the move is whole tiles, else the tiles to make (only those under something listed; the
 * others are the fill). Tiles past the grid are left out: they were never shown.
 */
export function planShift(m: SurfaceManifest, dx: number, dy: number, size: Size): { manifest: SurfaceManifest } | { tiles: ShiftedTile[] } {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error("A surface moves by whole pixels.");
  const T = m.tile;
  const { tilesX, tilesY } = tileGrid(size, T);
  const inGrid = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < tilesX && ty < tilesY;
  if (dx % T === 0 && dy % T === 0) {
    const kx = dx / T;
    const ky = dy / T;
    const tiles = m.tiles.map(([tx, ty, ref]): TileEntry => [tx + kx, ty + ky, ref]).filter(([tx, ty]) => inGrid(tx, ty));
    return { manifest: { ...m, tiles: tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]) } };
  }
  const listed = new Map(m.tiles.map((e) => [`${e[0]},${e[1]}`, e[2]]));
  // Every new tile that an old listed tile reaches.
  const wanted = new Set<string>();
  for (const [tx, ty] of m.tiles) {
    const x0 = Math.floor((tx * T + dx) / T);
    const y0 = Math.floor((ty * T + dy) / T);
    for (let y = y0; y <= Math.floor((ty * T + dy + T - 1) / T); y++)
      for (let x = x0; x <= Math.floor((tx * T + dx + T - 1) / T); x++) if (inGrid(x, y)) wanted.add(`${x},${y}`);
  }
  const tiles: ShiftedTile[] = [];
  for (const key of wanted) {
    const [tx, ty] = key.split(",").map(Number);
    // The old pixels under this tile: [tx·T − dx, +T) across.
    const sx0 = Math.floor((tx * T - dx) / T);
    const sy0 = Math.floor((ty * T - dy) / T);
    const sources: ShiftSource[] = [];
    for (let sy = sy0; sy <= Math.floor((ty * T - dy + T - 1) / T); sy++)
      for (let sx = sx0; sx <= Math.floor((tx * T - dx + T - 1) / T); sx++)
        sources.push({ tx: sx, ty: sy, ox: sx * T + dx - tx * T, oy: sy * T + dy - ty * T, ref: listed.get(`${sx},${sy}`) ?? null });
    tiles.push({ tx, ty, sources });
  }
  tiles.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  return { tiles };
}

/**
 * A new tile's samples (half floats, `channels` a texel) from its sources: each old tile's samples where it lands
 * (`samples(ref)`: a stored tile's bytes), a constant's value, or the fill.
 */
export function composeShiftedTile(m: SurfaceManifest, tile: ShiftedTile, samples: (ref: string) => Uint16Array): Uint16Array {
  const T = m.tile;
  const channels = FORMAT_INFO[m.format].channels;
  const out = new Uint16Array(T * T * channels);
  for (const s of tile.sources) {
    const constant = s.ref === null ? m.fill : constantValues(s.ref);
    const halves = constant ? constant.map(toHalf) : null;
    const bytes = constant ? null : samples(s.ref!);
    const x0 = Math.max(0, s.ox);
    const x1 = Math.min(T, s.ox + T);
    const y0 = Math.max(0, s.oy);
    const y1 = Math.min(T, s.oy + T);
    for (let y = y0; y < y1; y++) {
      const row = y * T;
      const from = (y - s.oy) * T - s.ox;
      if (bytes) out.set(bytes.subarray((from + x0) * channels, (from + x1) * channels), (row + x0) * channels);
      else for (let x = x0; x < x1; x++) for (let c = 0; c < channels; c++) out[(row + x) * channels + c] = halves![c];
    }
  }
  return out;
}

/** The moved surface's manifest from the made tiles' refs (a constant's `c:`, the fill's left out). */
export function shiftedManifest(m: SurfaceManifest, tiles: readonly ShiftedTile[], refs: readonly string[]): SurfaceManifest {
  const fill = constantRef(m.fill);
  return withTiles({ ...m, tiles: [] }, tiles.map((t, i): TileEntry => [t.tx, t.ty, refs[i]]).filter((e) => e[2] !== fill));
}
