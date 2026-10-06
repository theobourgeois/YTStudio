import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPixelLayer, setMask, setSurface } from "../../shared/photo/edits.ts";
import { createPhotoProject } from "../../shared/photo/project.ts";
import { canonicalJson, emptySurface, withTiles } from "../../shared/photo/surfaces.ts";
import { photoSuite } from "../suites/photo.ts";
import { BlobStore, sha256 } from "./blobs.ts";
import { resourcesOf } from "./service.ts";

let dir: string;
let blobs: BlobStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-gate-"));
  blobs = new BlobStore(resourcesOf(dir));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A one-tile surface stored in the package; its id. */
async function stored(seed: number) {
  const samples = new Uint8Array(256 * 256 * 2).map((_, i) => (i * 7 + seed) & 255);
  const hash = sha256(samples);
  await blobs.putTile(hash, samples);
  const manifest = withTiles(emptySurface("r16f", 256, [1]), [[0, 0, hash]]);
  const id = sha256(canonicalJson(manifest));
  await blobs.putManifest(id, manifest);
  return id;
}

describe("the publication gate", () => {
  it("refuses a document naming a surface the package hasn't got, and accepts one it has", async () => {
    const id = await stored(1);
    const doc = setMask(setSurface(addPixelLayer(createPhotoProject("Gate"), { id: "p" }), "p", id), "p", null);
    await expect(photoSuite.checkSave!(doc, dir)).resolves.toBeUndefined();
    const missing = setMask(doc, "p", "f".repeat(64));
    await expect(photoSuite.checkSave!(missing, dir)).rejects.toMatchObject({ status: 409 });
  });
});

describe("collection on opening", () => {
  it("keeps what the saved document names and deletes what only history did", async () => {
    const saved = await stored(1);
    const undone = await stored(2);
    const doc = setSurface(addPixelLayer(createPhotoProject("Gate"), { id: "p" }), "p", saved);
    await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(doc));
    // Blobs younger than the collection's start are kept (an upload in progress): age them.
    const old = new Date(Date.now() - 60_000);
    for await (const file of walk(resourcesOf(dir))) await fs.utimes(file, old, old);
    await photoSuite.opened!(doc, dir);
    expect(await blobs.hasManifest(saved)).toBe(true);
    expect(await blobs.hasManifest(undone)).toBe(false);
  });

  it("touches nothing in a package without its document", async () => {
    const id = await stored(3);
    await photoSuite.opened!(createPhotoProject("Absent"), dir);
    expect(await blobs.hasManifest(id)).toBe(true);
  });
});

async function* walk(root: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
