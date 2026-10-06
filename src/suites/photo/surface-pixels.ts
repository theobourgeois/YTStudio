/**
 * A small surface's pixels on the CPU, and back (patterns: docs/photo/layer-style/README.md, phase L4): read from its
 * manifest and tiles (a pattern for the style pass, its swatch, a style preset that carries it), or made into a
 * surface (a preset's pattern brought into a photo). `rgba16f` surfaces, premultiplied linear light.
 */
import { fromHalf, toHalf } from "@shared/photo/half";
import { constantValues, emptySurface, withTiles } from "@shared/photo/surfaces";
import type { SurfaceId } from "@shared/photo/types";
import type { SurfaceUploads } from "./uploads";

/** A surface's first `width` × `height` pixels, premultiplied linear RGBA. */
export async function readSurface(uploads: SurfaceUploads, id: SurfaceId, width: number, height: number): Promise<Float32Array> {
  const manifest = await uploads.manifest(id);
  const out = new Float32Array(width * height * 4);
  const tile = manifest.tile;
  const fill = manifest.fill;
  for (let i = 0; i < width * height; i++) out.set(fill.slice(0, 4), i * 4);
  await Promise.all(
    manifest.tiles.map(async ([tx, ty, ref]) => {
      const x0 = tx * tile;
      const y0 = ty * tile;
      if (x0 >= width || y0 >= height) return;
      const constant = constantValues(ref);
      const halves = constant ? null : new Uint16Array(await uploads.tile(ref));
      for (let y = y0; y < Math.min(height, y0 + tile); y++)
        for (let x = x0; x < Math.min(width, x0 + tile); x++) {
          const o = (y * width + x) * 4;
          if (constant) out.set(constant.slice(0, 4), o);
          else {
            const t = ((y - y0) * tile + (x - x0)) * 4;
            for (let c = 0; c < 4; c++) out[o + c] = fromHalf(halves![t + c]);
          }
        }
    }),
  );
  return out;
}

/** A surface of these pixels (premultiplied linear RGBA, `width` × `height`), uploaded: its id. */
export async function surfaceFromPixels(uploads: SurfaceUploads, width: number, height: number, linear: ArrayLike<number>): Promise<SurfaceId> {
  const TILE = 256;
  const tiles: ArrayBuffer[] = [];
  const at: [number, number][] = [];
  for (let ty = 0; ty * TILE < height; ty++)
    for (let tx = 0; tx * TILE < width; tx++) {
      const halves = new Uint16Array(TILE * TILE * 4);
      for (let y = 0; y < TILE && ty * TILE + y < height; y++)
        for (let x = 0; x < TILE && tx * TILE + x < width; x++) {
          const s = ((ty * TILE + y) * width + tx * TILE + x) * 4;
          for (let c = 0; c < 4; c++) halves[(y * TILE + x) * 4 + c] = toHalf(linear[s + c]);
        }
      tiles.push(halves.buffer);
      at.push([tx, ty]);
    }
  const { refs } = await uploads.hash(tiles, 4);
  const entries = at.map(([tx, ty], i): [number, number, string] => [tx, ty, refs[i]]);
  return uploads.add(withTiles(emptySurface("rgba16f", TILE, [0, 0, 0, 0]), entries), entries.map((e) => e[2]));
}
