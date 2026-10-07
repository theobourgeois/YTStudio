import { describe, expect, it } from "vitest";
import { fromHalf, toHalf } from "@shared/photo/half";
import { IDENTITY, layerMatrix } from "@shared/photo/layers";
import { type SurfaceManifest, constantRef, emptySurface } from "@shared/photo/surfaces";
import type { MaskSelection } from "@shared/photo/types";
import { editSurface, tilesReached } from "./surface-edit";

/** Uploads in memory: tiles by a made-up hash, manifests by number. */
function fakeUploads(manifests: Record<string, SurfaceManifest> = {}, tiles: Record<string, ArrayBuffer> = {}) {
  let n = 0;
  const added: { manifest: SurfaceManifest; refs: string[] }[] = [];
  return {
    added,
    tiles,
    manifest: async (id: string) => manifests[id],
    tile: async (hash: string) => tiles[hash],
    hash: async (buffers: ArrayBuffer[]) => ({
      refs: buffers.map((b) => {
        const ref = `tile${n++}`;
        tiles[ref] = b;
        return ref;
      }),
      ms: 0,
    }),
    add: async (manifest: SurfaceManifest, refs: readonly string[]) => {
      added.push({ manifest, refs: [...refs] });
      manifests[`m${added.length}`] = manifest;
      return `m${added.length}`;
    },
  };
}

const mask = (x: number, y: number, width: number, height: number, value = 255): MaskSelection => ({ kind: "mask", x, y, width, height, data: new Uint8Array(width * height).fill(value) });

describe("tilesReached", () => {
  it("is the tiles under the region's box, in the surface's grid, through its place", () => {
    const target = { size: { width: 600, height: 300 }, matrix: IDENTITY };
    expect(tilesReached(mask(250, 10, 20, 20), target, 256)).toEqual([{ tx: 0, ty: 0 }, { tx: 1, ty: 0 }]);
    expect(tilesReached(mask(1000, 10, 20, 20), target, 256)).toEqual([]);
    // A layer at 50%: document pixel 200 is its pixel 400.
    const half = { size: { width: 600, height: 300 }, matrix: layerMatrix({ x: 150, y: 75, scaleX: 0.5, scaleY: 0.5, rotation: 0 }, { width: 600, height: 300 }) };
    expect(tilesReached(mask(140, 0, 10, 10), half, 256)).toEqual([{ tx: 1, ty: 0 }]);
  });
});

describe("editSurface", () => {
  it("composes the reached tiles of an empty pixel surface into a new manifest", async () => {
    const uploads = fakeUploads();
    const seen: { origin: { x: number; y: number }; cover: number | Float32Array }[] = [];
    const id = await editSurface(uploads, { surface: null, kind: "pixels", size: { width: 300, height: 100 }, matrix: IDENTITY }, mask(250, 0, 10, 10), (tile, size, origin, cover) => {
      seen.push({ origin, cover });
      expect(tile.length).toBe(size * size * 4);
      expect([...tile.slice(0, 4)]).toEqual([0, 0, 0, 0]);
      tile.fill(0.5);
      return true;
    });
    expect(id).toBe("m1");
    expect(seen.map((s) => s.origin)).toEqual([{ x: 0, y: 0 }, { x: 256, y: 0 }]);
    // Past the surface's edge (300 wide, 100 high) nothing is covered.
    const second = seen[1].cover as Float32Array;
    expect(second[0]).toBe(1);
    expect(second[50]).toBe(0);
    expect(second[256 * 100]).toBe(0);
    const { manifest } = uploads.added[0];
    expect(manifest.format).toBe("rgba16f");
    expect(manifest.tiles.map((e) => [e[0], e[1]])).toEqual([[0, 0], [1, 0]]);
    expect(fromHalf(new Uint16Array(uploads.tiles[manifest.tiles[0][2]])[0])).toBe(0.5);
  });

  it("reads a stored or constant tile, keeps the others, and changes nothing when compose doesn't", async () => {
    const stored = new Uint16Array(256 * 256).fill(toHalf(0.25));
    const before = { ...emptySurface("r16f", 256, [1]), tiles: [[0, 0, "old"], [1, 0, constantRef([0])], [2, 0, "kept"]] as [number, number, string][] };
    const uploads = fakeUploads({ s0: before }, { old: stored.buffer });
    const values: number[] = [];
    const id = await editSurface(uploads, { surface: "s0", kind: "mask", size: { width: 768, height: 256 }, matrix: IDENTITY }, mask(0, 0, 512, 10), (tile) => {
      values.push(tile[0]);
      tile[0] = 0;
      return true;
    });
    expect(values).toEqual([0.25, 0]);
    const after = uploads.added[0].manifest;
    expect(after.tiles.find((e) => e[0] === 2)![2]).toBe("kept");
    expect(after.tiles.find((e) => e[0] === 0)![2]).not.toBe("old");
    expect(id).toBe("m1");
    expect(await editSurface(uploads, { surface: "s0", kind: "mask", size: { width: 768, height: 256 }, matrix: IDENTITY }, mask(0, 0, 10, 10), () => false)).toBeNull();
    expect(await editSurface(uploads, { surface: "s0", kind: "mask", size: { width: 768, height: 256 }, matrix: IDENTITY }, mask(0, 0, 10, 10, 0), () => true)).toBeNull();
  });
});
