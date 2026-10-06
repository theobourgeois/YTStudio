import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPixelLayer, setMask, setSurface } from "../../shared/photo/edits.ts";
import { createPhotoProject } from "../../shared/photo/project.ts";
import { canonicalJson, emptySurface, withTiles } from "../../shared/photo/surfaces.ts";
import type { PhotoProject } from "../../shared/photo/types.ts";
import { photoSuite } from "../suites/photo.ts";
import { BlobStore, sha256 } from "./blobs.ts";
import { recoveryOf } from "./recovery.ts";
import { resourcesOf } from "./service.ts";

let dir: string;
let blobs: BlobStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-recovery-"));
  blobs = new BlobStore(resourcesOf(dir));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** A one-tile surface stored in the package: its id and its tile's hash. */
async function stored(seed: number) {
  const samples = new Uint8Array(256 * 256 * 2).map((_, i) => (i * 13 + seed) & 255);
  const tile = sha256(samples);
  await blobs.putTile(tile, samples);
  const manifest = withTiles(emptySurface("r16f", 256, [1]), [[0, 0, tile]]);
  const id = sha256(canonicalJson(manifest));
  await blobs.putManifest(id, manifest);
  return { id, tile };
}

const tileFile = (hash: string) => path.join(resourcesOf(dir), "tiles", hash.slice(0, 2), hash);
const manifestFile = (hash: string) => path.join(resourcesOf(dir), "manifests", hash.slice(0, 2), `${hash}.json`);

/** A photo with a painted layer ("Paint") whose mask is `mask`. */
const photo = (surface: string, mask: string | null = null) =>
  setMask(setSurface(addPixelLayer(createPhotoProject("Night"), { id: "p", name: "Paint" }), "p", surface), "p", mask);

/** What the platform does on a save: the suite keeps the old document, then the new one is written. */
async function save(doc: PhotoProject) {
  await photoSuite.checkSave!(doc, dir);
  await photoSuite.keepPrevious!(dir);
  await fs.writeFile(path.join(dir, "project.json.tmp"), JSON.stringify(doc));
  await fs.rename(path.join(dir, "project.json.tmp"), path.join(dir, "project.json"));
}

const checkpoint = async () => JSON.parse(await fs.readFile(path.join(recoveryOf(dir), "previous.json"), "utf8")) as PhotoProject;

describe("the checkpoint", () => {
  it("is the document each save replaced", async () => {
    const first = await stored(1);
    const second = await stored(2);
    await save(photo(first.id));
    await expect(fs.stat(path.join(recoveryOf(dir), "previous.json"))).rejects.toThrow();
    await save(photo(second.id));
    expect((await checkpoint()).layers.find((l) => l.id === "p")).toMatchObject({ surface: first.id });
    // The saved one is a file of its own: replacing it didn't change the checkpoint.
    expect(JSON.parse(await fs.readFile(path.join(dir, "project.json"), "utf8")).layers.find((l: { id: string }) => l.id === "p").surface).toBe(second.id);
  });

  it("keeps its pixels when the project is next opened, as the saved document's", async () => {
    const first = await stored(3);
    const second = await stored(4);
    const undone = await stored(5);
    await save(photo(first.id));
    await save(photo(second.id));
    const old = new Date(Date.now() - 60_000);
    for (const file of [first, second, undone].flatMap((s) => [tileFile(s.tile), manifestFile(s.id)])) await fs.utimes(file, old, old);
    await photoSuite.opened!(photo(second.id), dir);
    expect(await blobs.hasManifest(first.id)).toBe(true);
    expect(await blobs.hasManifest(second.id)).toBe(true);
    expect(await blobs.hasManifest(undone.id)).toBe(false);
  });
});

describe("the check on opening", () => {
  it("leaves a whole photo alone", async () => {
    const s = await stored(6);
    await save(photo(s.id));
    expect(await photoSuite.check!(photo(s.id), dir)).toBeNull();
  });

  it("opens the checkpoint when the saved photo's pixels are missing, keeping it aside", async () => {
    const good = await stored(7);
    const lost = await stored(8);
    await save(photo(good.id));
    await save({ ...photo(lost.id), name: "Night, renamed" });
    await fs.rm(manifestFile(lost.id));
    const fixed = await photoSuite.check!({ ...photo(lost.id), name: "Night, renamed" }, dir);
    expect(fixed?.doc.layers.find((l) => l.id === "p")).toMatchObject({ surface: good.id });
    expect(fixed?.doc.name).toBe("Night, renamed");
    expect(fixed?.notice).toMatch(/Pixels of "Paint" were missing from the package \(its manifest is missing\), so the version saved before/);
    const aside = (await fs.readdir(recoveryOf(dir))).filter((n) => n.startsWith("incomplete-"));
    expect(aside).toHaveLength(1);
    expect(fixed?.notice).toContain(aside[0]);
  });

  it("empties only what's lost when the checkpoint is no better", async () => {
    const paint = await stored(9);
    const mask = await stored(10);
    await save(photo(paint.id, mask.id));
    await save(photo(paint.id, mask.id));
    await fs.rm(tileFile(mask.tile));
    const fixed = await photoSuite.check!(photo(paint.id, mask.id), dir);
    expect(fixed?.doc.layers.find((l) => l.id === "p")).toMatchObject({ surface: paint.id, mask: { surface: null } });
    expect(fixed?.notice).toMatch(/Pixels of "Paint" are missing from the package \(1 of its tiles is missing\) and no earlier version has them/);
    // The repaired photo can be saved: it names only what the package has.
    await expect(photoSuite.checkSave!(fixed!.doc, dir)).resolves.toBeUndefined();
  });

  it("treats a damaged manifest as lost", async () => {
    const s = await stored(11);
    await save(photo(s.id));
    await fs.writeFile(manifestFile(s.id), "{ broken");
    const fixed = await photoSuite.check!(photo(s.id), dir);
    expect(fixed?.notice).toContain("its manifest is damaged");
    expect(fixed?.doc.layers.find((l) => l.id === "p")).toMatchObject({ surface: null });
  });
});
