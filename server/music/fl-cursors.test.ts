import fs from "node:fs";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { FL_CURSORS } from "../../shared/music/cursors.ts";
import { decodeCursorImage, encodePng, findFlEngine, flCursors, readCursorResources } from "./fl-cursors.ts";

/** A cursor bitmap as Windows keeps one: a header, a palette, the colour rows bottom first, then the mask's. */
function dib(width: number, height: number, depth: number, palette: number[][], rows: number[][], mask: number[][]): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(depth, 14);
  header.writeUInt32LE(palette.length, 32);
  const stride = Math.ceil((width * depth) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const pixels = Buffer.alloc(stride * height);
  const masks = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y++) {
    const at = (height - 1 - y) * stride;
    rows[y]!.forEach((v, x) => {
      if (depth === 32) pixels.writeUInt32LE(v >>> 0, at + 4 * x);
      else if (depth === 1) pixels[at + (x >> 3)]! |= v << (7 - (x & 7));
    });
    mask[y]!.forEach((v, x) => (masks[(height - 1 - y) * maskStride + (x >> 3)]! |= v << (7 - (x & 7))));
  }
  return Buffer.concat([header, Buffer.from(palette.flatMap(([r, g, b]) => [b!, g!, r!, 0])), pixels, masks]);
}

/** A PE32+ module with one cursor group, `name`, of one cursor: just enough of one to read its resources. */
function module(name: string, x: number, y: number, image: Buffer): Buffer {
  const raw = 0x200;
  const rva = 0x1000;
  const res = Buffer.alloc(0x100 + 4 + image.length);
  const dir = (at: number, named: number, ids: number, entries: [number, number][]) => {
    res.writeUInt16LE(named, at + 12);
    res.writeUInt16LE(ids, at + 14);
    entries.forEach(([id, pointer], i) => {
      res.writeUInt32LE(id >>> 0, at + 16 + 8 * i);
      res.writeUInt32LE(pointer >>> 0, at + 20 + 8 * i);
    });
  };
  const sub = 0x80000000;
  dir(0x00, 0, 2, [
    [1, sub | 0x20],
    [12, sub | 0x40],
  ]);
  dir(0x20, 0, 1, [[1, sub | 0x60]]);
  dir(0x40, 1, 0, [[sub | 0xe0, sub | 0x80]]);
  dir(0x60, 0, 1, [[0x409, 0xa0]]);
  dir(0x80, 0, 1, [[0x409, 0xb0]]);
  res.writeUInt32LE(rva + 0x100, 0xa0);
  res.writeUInt32LE(4 + image.length, 0xa4);
  res.writeUInt32LE(rva + 0xc0, 0xb0);
  res.writeUInt32LE(20, 0xb4);
  // The group: one entry (32 px, 32 bits, cursor 1).
  res.writeUInt16LE(2, 0xc2);
  res.writeUInt16LE(1, 0xc4);
  res.writeUInt16LE(32, 0xc6);
  res.writeUInt16LE(32, 0xc8);
  res.writeUInt16LE(1, 0xca);
  res.writeUInt16LE(32, 0xcc);
  res.writeUInt32LE(4 + image.length, 0xce);
  res.writeUInt16LE(1, 0xd2);
  res.writeUInt16LE(name.length, 0xe0);
  res.write(name, 0xe2, "utf16le");
  res.writeUInt16LE(x, 0x100);
  res.writeUInt16LE(y, 0x102);
  image.copy(res, 0x104);

  const head = Buffer.alloc(raw);
  head.writeUInt32LE(0x40, 0x3c);
  head.write("PE\0\0", 0x40, "latin1");
  const pe = 0x40;
  head.writeUInt16LE(1, pe + 6);
  head.writeUInt16LE(240, pe + 20);
  const optional = pe + 24;
  head.writeUInt16LE(0x20b, optional);
  head.writeUInt32LE(rva, optional + 112 + 16);
  head.writeUInt32LE(res.length, optional + 112 + 20);
  const section = optional + 240;
  head.write(".rsrc", section, "latin1");
  head.writeUInt32LE(res.length, section + 8);
  head.writeUInt32LE(rva, section + 12);
  head.writeUInt32LE(res.length, section + 16);
  head.writeUInt32LE(raw, section + 20);
  return Buffer.concat([head, res]);
}

/** A PNG's size and pixels (filter 0 rows only, as `encodePng` writes them). */
function readPng(png: Buffer) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let at = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    expect(png.readUInt32BE(at + 8 + length)).toBe(zlib.crc32(png.subarray(at + 4, at + 8 + length)));
    if (type === "IHDR") [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const rows = zlib.inflateSync(Buffer.concat(data));
  const rgba: number[] = [];
  for (let y = 0; y < height; y++) rgba.push(...rows.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)));
  return { width, height, rgba };
}

/** This computer's FL Studio, if it has one (only Windows' is looked for). */
const installed = process.platform === "win32" ? await findFlEngine(null) : null;

const RED = 0xffff0000;
const SEE_THROUGH_GREEN = 0x0000ff00;
const HALF_BLUE = 0x800000ff;

describe("FL Studio's cursors", () => {
  it("decodes a 32-bit cursor by its alpha, top row first", () => {
    const image = decodeCursorImage(dib(2, 2, 32, [], [[RED, SEE_THROUGH_GREEN], [HALF_BLUE, RED]], [[0, 0], [0, 0]]));
    expect(image).toMatchObject({ width: 2, height: 2 });
    expect([...image.rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 0, 0, 255]);
  });

  it("cuts a 32-bit cursor with no alpha out by its mask", () => {
    const image = decodeCursorImage(dib(2, 1, 32, [], [[0x00ff0000, 0x00ff0000]], [[0, 1]]));
    expect([...image.rgba]).toEqual([255, 0, 0, 255, 255, 0, 0, 0]);
  });

  it("decodes a 1-bit cursor: masked pixels see-through, or black where they'd invert", () => {
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const image = decodeCursorImage(dib(2, 2, 1, palette, [[1, 0], [1, 0]], [[0, 1], [1, 0]]));
    expect([...image.rgba]).toEqual([255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it("writes a PNG that reads back", () => {
    const rgba = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(readPng(encodePng(3, 1, rgba))).toEqual({ width: 3, height: 1, rgba: [...rgba] });
  });

  it("reads a module's cursor groups by name, with their hot spots", () => {
    const image = dib(2, 2, 32, [], [[RED, RED], [RED, RED]], [[0, 0], [0, 0]]);
    const resources = readCursorResources(module("EEPEN", 1, 30, image));
    expect([...resources.keys()]).toEqual(["EEPEN"]);
    expect(resources.get("EEPEN")).toMatchObject({ x: 1, y: 30 });
    expect(resources.get("EEPEN")!.image).toEqual(image);

    const { pen, ...others } = flCursors(module("EEPEN", 1, 30, image));
    expect(others).toEqual({});
    expect(pen).toMatchObject({ x: 1, y: 30 });
    expect(readPng(Buffer.from(pen!.url.replace("data:image/png;base64,", ""), "base64"))).toMatchObject({ width: 2, height: 2 });
  });

  it("finds none when told there's none, and a module it's given", async () => {
    expect(await findFlEngine("none")).toBeNull();
    expect(await findFlEngine(import.meta.filename)).toBe(import.meta.filename);
  });

  it.skipIf(!installed)("reads every one the editor uses out of this computer's FL Studio", () => {
    const cursors = flCursors(fs.readFileSync(installed!));
    expect(Object.keys(cursors).sort()).toEqual(Object.keys(FL_CURSORS).sort());
    for (const cursor of Object.values(cursors)) {
      const png = readPng(Buffer.from(cursor.url.replace("data:image/png;base64,", ""), "base64"));
      expect(cursor.x).toBeLessThan(png.width);
      expect(cursor.y).toBeLessThan(png.height);
      // Something of it shows.
      expect(png.rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });
});
