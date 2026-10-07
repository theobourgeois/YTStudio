/**
 * A surface in document pixels flipped or turned with the canvas (Image › Image Rotation moves the masks that are in
 * document pixels, as a canvas crop shifts them: `surface-shift.ts`). Nothing is resampled: each new pixel is an old
 * one (`pixelSource`). A new tile that only the fill reaches stays the fill, one that a single constant tile covers
 * keeps that constant; the others are made from the old tiles' samples by the caller, which has their bytes. Pure.
 */
import { type Size, tileGrid } from "./geometry.ts";
import { toHalf } from "./half.ts";
import { type Orientation, orientedSize, pixelSource } from "./orient.ts";
import { FORMAT_INFO, type SurfaceManifest, type TileEntry, constantRef, constantValues, withTiles } from "./surfaces.ts";

/** How a surface on a canvas of `size` orients: the entries known at once (constants), and the tiles to make. */
export interface OrientPlan {
  /** The new grid's size. */
  size: Size;
  entries: TileEntry[];
  /** New tiles to make, each with the old tiles' hashes it reads. */
  tiles: { tx: number; ty: number; reads: string[] }[];
}

/** The old tiles' refs (null: the fill) under each new tile. */
export function planOrient(m: SurfaceManifest, o: Orientation, size: Size): OrientPlan {
  const T = m.tile;
  const next = orientedSize(size, o);
  const src = pixelSource(o, size);
  const old = tileGrid(size, T);
  const listed = new Map(m.tiles.map((e) => [`${e[0]},${e[1]}`, e[2]]));
  const fill = constantRef(m.fill);
  const { tilesX, tilesY } = tileGrid(next, T);
  const entries: TileEntry[] = [];
  const tiles: OrientPlan["tiles"] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      // The old pixels under the tile's corners (the map takes a box to a box).
      const x0 = tx * T;
      const y0 = ty * T;
      const x1 = Math.min(next.width, x0 + T) - 1;
      const y1 = Math.min(next.height, y0 + T) - 1;
      const xs = [src.ax * x0 + src.bx * y0 + src.cx, src.ax * x1 + src.bx * y1 + src.cx];
      const ys = [src.ay * x0 + src.by * y0 + src.cy, src.ay * x1 + src.by * y1 + src.cy];
      const refs = new Set<string>();
      for (let sy = Math.floor(Math.min(...ys) / T); sy <= Math.floor(Math.max(...ys) / T); sy++)
        for (let sx = Math.floor(Math.min(...xs) / T); sx <= Math.floor(Math.max(...xs) / T); sx++)
          refs.add(sx >= 0 && sy >= 0 && sx < old.tilesX && sy < old.tilesY ? (listed.get(`${sx},${sy}`) ?? fill) : fill);
      // The pixels past the canvas in an edge tile are the fill too: a constant other than it is made, not kept.
      const partial = x1 - x0 + 1 < T || y1 - y0 + 1 < T;
      if (refs.size === 1) {
        const [ref] = refs;
        if (ref === fill) continue;
        if (constantValues(ref) && !partial) {
          entries.push([tx, ty, ref]);
          continue;
        }
      }
      tiles.push({ tx, ty, reads: [...refs].filter((r) => !constantValues(r)) });
    }
  }
  return { size: next, entries, tiles };
}

/** A new tile's samples (half floats): each pixel the old one it comes from (`samples(ref)`: a stored tile's bytes), past the canvas the fill. */
export function orientedTile(m: SurfaceManifest, o: Orientation, size: Size, tx: number, ty: number, samples: (ref: string) => Uint16Array): Uint16Array {
  const T = m.tile;
  const channels = FORMAT_INFO[m.format].channels;
  const next = orientedSize(size, o);
  const src = pixelSource(o, size);
  const old = tileGrid(size, T);
  // Each old tile's samples by its index (a constant's and the fill's: one texel), fetched once.
  const inGrid = m.tiles.filter(([x, y]) => x >= 0 && y >= 0 && x < old.tilesX && y < old.tilesY);
  const listed = new Map(inGrid.map((e) => [e[1] * old.tilesX + e[0], e[2]]));
  const toHalves = (values: number[]) => Uint16Array.from(values.map(toHalf));
  const fill = toHalves(m.fill);
  const byIndex = new Map<number, Uint16Array>();
  const valuesAt = (index: number): Uint16Array => {
    let v = byIndex.get(index);
    if (!v) {
      const ref = listed.get(index);
      const constant = ref === undefined ? null : constantValues(ref);
      v = ref === undefined ? fill : constant ? toHalves(constant) : samples(ref);
      byIndex.set(index, v);
    }
    return v;
  };
  const out = new Uint16Array(T * T * channels);
  for (let y = 0; y < T; y++) {
    const ny = ty * T + y;
    for (let x = 0; x < T; x++) {
      const nx = tx * T + x;
      const at = (y * T + x) * channels;
      const ox = src.ax * nx + src.bx * ny + src.cx;
      const oy = src.ay * nx + src.by * ny + src.cy;
      const outside = nx >= next.width || ny >= next.height || ox < 0 || oy < 0 || ox >= size.width || oy >= size.height;
      const values = outside ? fill : valuesAt(Math.floor(oy / T) * old.tilesX + Math.floor(ox / T));
      const from = values.length === channels ? 0 : ((oy % T) * T + (ox % T)) * channels;
      for (let c = 0; c < channels; c++) out[at + c] = values[from + c];
    }
  }
  return out;
}

/** The oriented surface's manifest: the plan's entries and the made tiles' refs (the fill's left out). */
export function orientedManifest(m: SurfaceManifest, plan: OrientPlan, refs: readonly string[]): SurfaceManifest {
  const fill = constantRef(m.fill);
  const made = plan.tiles.map((t, i): TileEntry => [t.tx, t.ty, refs[i]]);
  return withTiles({ ...m, tiles: [] }, [...plan.entries, ...made].filter((e) => e[2] !== fill));
}
