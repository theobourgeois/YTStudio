import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, constantRef, emptySurface, withTiles } from "../../shared/photo/surfaces.ts";
import { BlobStore, sha256 } from "./blobs.ts";

let dir: string;
let store: BlobStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-blobs-"));
  store = new BlobStore(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const tile = (seed: number) => {
  const bytes = new Uint8Array(256 * 256 * 8);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + seed) & 255;
  return bytes;
};

describe("tiles", () => {
  it("stores a tile under its hash and gives the same samples back", async () => {
    const samples = tile(1);
    const hash = sha256(samples);
    expect(await store.putTile(hash, samples)).toBe(true);
    expect(new Uint8Array(await store.getTile(hash))).toEqual(samples);
  });

  it("treats a second upload as done", async () => {
    const samples = tile(2);
    const hash = sha256(samples);
    await store.putTile(hash, samples);
    expect(await store.putTile(hash, samples)).toBe(false);
  });

  it("refuses samples that don't match their name", async () => {
    await expect(store.putTile(sha256(tile(3)), tile(4))).rejects.toMatchObject({ status: 400 });
    await expect(store.putTile("not-a-hash", tile(4))).rejects.toMatchObject({ status: 400 });
    await expect(store.getTile(sha256(tile(5)))).rejects.toMatchObject({ status: 404 });
  });

  it("leaves no temporary files behind", async () => {
    const samples = tile(6);
    await store.putTile(sha256(samples), samples);
    const files = await fs.readdir(path.join(dir, "tiles", sha256(samples).slice(0, 2)));
    expect(files).toEqual([sha256(samples)]);
  });
});

describe("manifests", () => {
  it("stores a manifest whose tiles are all here, under its canonical hash", async () => {
    const samples = tile(7);
    const hash = sha256(samples);
    await store.putTile(hash, samples);
    const manifest = withTiles(emptySurface("rgba16f", 256, [0, 0, 0, 0]), [[0, 0, hash], [1, 0, constantRef([1, 1, 1, 1])]]);
    const id = sha256(canonicalJson(manifest));
    expect(await store.putManifest(id, manifest)).toBe(true);
    expect(await store.getManifest(id)).toEqual(manifest);
  });

  it("refuses one that lists a tile it doesn't have", async () => {
    const missing = sha256(tile(8));
    const manifest = withTiles(emptySurface("rgba16f", 256, [0, 0, 0, 0]), [[0, 0, missing]]);
    await expect(store.putManifest(sha256(canonicalJson(manifest)), manifest)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a malformed manifest or a wrong hash", async () => {
    const manifest = emptySurface("r16f", 512, [1]);
    await expect(store.putManifest(sha256("something else"), manifest)).rejects.toMatchObject({ status: 400 });
    await expect(store.putManifest(sha256("x"), { ...manifest, tile: 300 })).rejects.toMatchObject({ status: 400 });
  });
});
