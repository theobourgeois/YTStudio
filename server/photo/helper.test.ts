/**
 * The photo helper with the real sharp: what it decodes (stored samples, upright, at their depth), what it
 * encodes (exactly), and how its supervisor copes when it dies.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompareResult, SourceLayout } from "../../shared/photo/lab.ts";
import { PhotoHelper } from "./helper.ts";

const HELPER = path.join(import.meta.dirname, "helper-process.mjs");
let dir: string;
let helper: PhotoHelper;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-helper-"));
  helper = new PhotoHelper(HELPER);
});
afterAll(async () => {
  helper.close();
  await fs.rm(dir, { recursive: true, force: true });
});

type Decoded = Omit<SourceLayout, "key">;

async function decode(file: string, tile = 256) {
  const layout = await helper.request<Decoded>("decode", { file, out: `${file}.raw`, preview: `${file}.preview`, tile });
  const raw = await fs.readFile(`${file}.raw`);
  /** The RGBA samples of pixel (x, y), read from the tile-major file. */
  const at = (x: number, y: number) => {
    const tx = Math.floor(x / tile);
    const ty = Math.floor(y / tile);
    const per = layout.bits / 8;
    const offset = (ty * layout.tilesX + tx) * layout.tileBytes + ((y % tile) * tile + (x % tile)) * 4 * per;
    return [0, 1, 2, 3].map((c) => (per === 2 ? raw.readUInt16LE(offset + c * 2) : raw[offset + c]));
  };
  return { layout, raw, at };
}

describe("decoding", () => {
  it("decodes upright, padding edge tiles with zeros", async () => {
    const file = path.join(dir, "oriented.jpg");
    // A 300×200 picture with a red block at its top-left, stored with orientation 6 (shown turned 90° clockwise).
    await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .composite([{ input: { create: { width: 50, height: 40, channels: 3, background: { r: 255, g: 0, b: 0 } } }, left: 0, top: 0 }])
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toFile(file);
    const { layout, raw, at } = await decode(file);
    expect([layout.width, layout.height, layout.tilesX, layout.tilesY, layout.bits]).toEqual([200, 300, 1, 2, 8]);
    expect(raw.length).toBe(2 * 256 * 256 * 4);
    expect(at(195, 5)[0]).toBeGreaterThan(240); // the red block is now top-right
    expect(at(5, 5).slice(0, 3)).toEqual([10, 20, 30]);
    expect(raw.readUInt32LE(256 * 4 * 10 + 4 * 220)).toBe(0); // past the right edge
    expect(layout.preview).toEqual({ width: 200, height: 300 });
  });

  it("keeps 16-bit samples", async () => {
    const file = path.join(dir, "ramp16.png");
    const samples = new Uint16Array(512 * 2 * 3);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.floor(i / 3) * 63 + 5;
    await sharp(samples, { raw: { width: 512, height: 2, channels: 3 } }).toColourspace("rgb16").png().toFile(file);
    const { layout, at } = await decode(file);
    expect(layout.bits).toBe(16);
    expect(at(0, 0)).toEqual([5, 5, 5, 65535]);
    expect(at(300, 1)).toEqual([812 * 63 + 5, 812 * 63 + 5, 812 * 63 + 5, 65535]);
  });

  it("returns the stored samples and the profile, never converting colour", async () => {
    const file = path.join(dir, "p3.png");
    // sRGB (200, 100, 50) converted into Display P3: the file stores P3 numbers and a P3 profile.
    await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 100, b: 50 } } }).withIccProfile("p3").png().toFile(file);
    const stored = await sharp(file, { ignoreIcc: true }).raw().toBuffer();
    const { layout, at } = await decode(file);
    expect(at(1, 1).slice(0, 3)).toEqual([...stored.subarray(0, 3)]);
    expect(at(1, 1).slice(0, 3)).not.toEqual([200, 100, 50]);
    expect(Buffer.from(layout.icc!, "base64")).toEqual((await sharp(file).metadata()).icc);
  });

  it("keeps alpha as stored, unpremultiplied", async () => {
    const file = path.join(dir, "alpha.png");
    const pixels = Buffer.from([255, 128, 0, 0, 10, 20, 30, 1, 200, 100, 50, 128, 1, 2, 3, 255]);
    await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toFile(file);
    const { layout, at } = await decode(file);
    expect(layout.hasAlpha).toBe(true);
    expect([at(0, 0), at(1, 0), at(0, 1), at(1, 1)]).toEqual([[255, 128, 0, 0], [10, 20, 30, 1], [200, 100, 50, 128], [1, 2, 3, 255]]);
  });

  it("says what's wrong with a file it can't read, and carries on", async () => {
    const file = path.join(dir, "broken.png");
    await fs.writeFile(file, "not a png at all");
    await expect(helper.request("probe", { file })).rejects.toThrow(/unsupported image format|Input file/i);
    expect((await helper.request<{ decoder: string }>("version")).decoder).toMatch(/^sharp /);
  });
});

describe("encoding", () => {
  async function roundTrip(bits: 8 | 16, format: "png" | "jpeg") {
    const width = 97;
    const height = 31;
    const samples = bits === 16 ? new Uint16Array(width * height * 4) : new Uint8Array(width * height * 4);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 4 === 3 ? (bits === 16 ? 65535 : 255) : (i * 2654435761) >>> (bits === 16 ? 16 : 24);
    const raw = path.join(dir, `samples-${bits}-${format}.raw`);
    await fs.writeFile(raw, new Uint8Array(samples.buffer));
    const out = path.join(dir, `out-${bits}.${format}`);
    const result = await helper.request<{ bytes: number }>("encode", { raw, out, width, height, channels: 4, bits, format });
    expect(result.bytes).toBeGreaterThan(0);
    // Its own decoding of a file holding exactly those samples.
    const truth = path.join(dir, `truth-${bits}.png`);
    let image = sharp(samples, { raw: { width, height, channels: 4 } });
    if (bits === 16) image = image.toColourspace("rgb16");
    await image.png().toFile(truth);
    return { out, truth };
  }

  it("writes 8-bit PNG samples exactly, tagged sRGB", async () => {
    const { out, truth } = await roundTrip(8, "png");
    expect(await helper.request<CompareResult>("compare", { a: out, b: truth })).toMatchObject({ differing: 0 });
    expect((await sharp(out).metadata()).icc?.length).toBeGreaterThan(0);
  });

  it("writes 16-bit PNG samples exactly", async () => {
    const { out, truth } = await roundTrip(16, "png");
    expect(await helper.request<CompareResult>("compare", { a: out, b: truth })).toMatchObject({ differing: 0 });
    expect((await sharp(out).metadata()).depth).toBe("ushort");
  });

  it("writes JPEG without alpha", async () => {
    const { out } = await roundTrip(8, "jpeg");
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.hasAlpha]).toEqual(["jpeg", false]);
  });

  it("refuses samples that don't match the size", async () => {
    const raw = path.join(dir, "short.raw");
    await fs.writeFile(raw, Buffer.alloc(10));
    await expect(helper.request("encode", { raw, out: path.join(dir, "x.png"), width: 4, height: 4, channels: 4, bits: 8, format: "png" })).rejects.toThrow(/Expected 64 bytes/);
  });
});

describe("supervision", () => {
  it("restarts after a crash, retrying what was in flight once", async () => {
    const restarts = helper.restarts;
    const crash = helper.request("crash");
    const other = helper.request<{ decoder: string }>("version");
    await expect(crash).rejects.toThrow(/crashed/);
    expect((await other).decoder).toMatch(/^sharp /);
    expect(helper.restarts).toBeGreaterThan(restarts);
    expect((await helper.request<{ decoder: string }>("version")).decoder).toMatch(/^sharp /);
  });
});
