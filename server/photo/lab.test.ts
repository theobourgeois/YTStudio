/** The lab's sources and banded exports, with the real helper. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PhotoHelper } from "./helper.ts";
import { PhotoLab } from "./lab.ts";

let dir: string;
let lab: PhotoLab;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-lab-"));
  lab = new PhotoLab(dir, new PhotoHelper(path.join(import.meta.dirname, "helper-process.mjs")));
  await lab.init();
});
afterAll(async () => {
  lab.helper.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const width = 300;
const height = 70;
const pixels = Buffer.alloc(width * height * 4);
for (let i = 0; i < pixels.length; i++) pixels[i] = i % 4 === 3 ? 255 : (i * 7919) & 255;

describe("the photo lab", () => {
  it("stores an upload once, by its content", async () => {
    const png = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    const a = await lab.addSource(Readable.from(png), "one.png");
    const b = await lab.addSource(Readable.from(png), "again.png");
    expect(b.key).toBe(a.key);
    expect([a.width, a.height, a.bits]).toEqual([width, height, 8]);
    expect(lab.list()).toHaveLength(1);
    await expect(lab.addSource(Readable.from(Buffer.from("nope")), "notes.txt")).rejects.toMatchObject({ status: 415 });
  });

  it("decodes once per tile size, then from the cache", async () => {
    const [source] = lab.list();
    const first = await lab.layout(source.key, 256);
    expect(first.decodeMs).toBeGreaterThan(0);
    expect((await lab.layout(source.key, 256)).decodeMs).toBe(0);
    expect([first.tilesX, first.tilesY]).toEqual([2, 1]);
  });

  it("exports rows sent in bands, in any order, exactly", async () => {
    const [source] = lab.list();
    const id = await lab.beginExport({ name: "bands.png", width, height, bits: 8, format: "png" });
    const rowBytes = width * 4;
    await lab.exportRows(id, 40, pixels.subarray(40 * rowBytes));
    await lab.exportRows(id, 0, pixels.subarray(0, 40 * rowBytes));
    await lab.finishExport(id);
    expect(await lab.compare("bands.png", source.key)).toMatchObject({ differing: 0, underTransparent: 0 });
  });

  it("refuses rows outside the image, and an export missing rows", async () => {
    const id = await lab.beginExport({ name: "short.png", width, height, bits: 8, format: "png" });
    await expect(lab.exportRows(id, height - 1, pixels.subarray(0, 2 * width * 4))).rejects.toMatchObject({ status: 400 });
    await expect(lab.exportRows(id, 0, pixels.subarray(0, 10))).rejects.toMatchObject({ status: 400 });
    await lab.exportRows(id, 0, pixels.subarray(0, width * 4));
    await expect(lab.finishExport(id)).rejects.toThrow(/Only 1 of 70 rows/);
    await expect(lab.beginExport({ name: "../escape.png", width, height, bits: 8, format: "png" })).rejects.toMatchObject({ status: 400 });
  });
});
