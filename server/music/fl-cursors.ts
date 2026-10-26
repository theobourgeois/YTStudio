/**
 * FL Studio's mouse pointers, read out of the FL Studio installed on this computer (they're Image-Line's, so
 * the app doesn't ship them). They're cursor resources in its engine's DLL (`FLEngine_x64.dll`): this reads the
 * DLL's resource directory, decodes each cursor's bitmap and hands it to the tab as a PNG with its hot spot.
 * With no FL Studio (or `EDITOR_FL_STUDIO=none`) there are none, and the editor keeps its own.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { FL_CURSORS, type FlCursor, type FlCursorName, type FlCursorsResponse } from "../../shared/music/cursors.ts";
import { log } from "../log.ts";

const logger = log("fl-cursors");

const RT_CURSOR = 1;
const RT_GROUP_CURSOR = 12;

/** A cursor resource: its hot spot and its bitmap (a DIB, as in a .cur file, or a PNG). */
export interface CursorResource {
  x: number;
  y: number;
  image: Buffer;
}

/**
 * The cursors in a Windows module (an .exe or .dll), by resource name (a number's in decimal). Of a group
 * with several sizes, the largest is kept, the deepest of those.
 */
export function readCursorResources(file: Buffer): Map<string, CursorResource> {
  const peAt = file.readUInt32LE(0x3c);
  if (file.toString("latin1", peAt, peAt + 4) !== "PE\0\0") throw new Error("Not a Windows module.");
  const sections = file.readUInt16LE(peAt + 6);
  const optionalSize = file.readUInt16LE(peAt + 20);
  const optional = peAt + 24;
  const pe32Plus = file.readUInt16LE(optional) === 0x20b;
  const resourceRva = file.readUInt32LE(optional + (pe32Plus ? 112 : 96) + 2 * 8);
  const table: { rva: number; size: number; raw: number }[] = [];
  for (let i = 0, at = optional + optionalSize; i < sections; i++, at += 40) {
    table.push({ rva: file.readUInt32LE(at + 12), size: Math.max(file.readUInt32LE(at + 8), file.readUInt32LE(at + 16)), raw: file.readUInt32LE(at + 20) });
  }
  const offset = (rva: number) => {
    const section = table.find((s) => rva >= s.rva && rva < s.rva + s.size);
    if (!section) throw new Error("A resource outside the module's sections.");
    return rva - section.rva + section.raw;
  };
  const result = new Map<string, CursorResource>();
  if (!resourceRva) return result;
  const base = offset(resourceRva);

  type Entry = { name: string; pointer: number };
  const entries = (at: number): Entry[] => {
    const count = file.readUInt16LE(at + 12) + file.readUInt16LE(at + 14);
    return Array.from({ length: count }, (_, i) => {
      const id = file.readUInt32LE(at + 16 + 8 * i);
      const pointer = file.readUInt32LE(at + 20 + 8 * i);
      if (!(id & 0x80000000)) return { name: String(id), pointer };
      const nameAt = base + (id & 0x7fffffff);
      return { name: file.toString("utf16le", nameAt + 2, nameAt + 2 + 2 * file.readUInt16LE(nameAt)), pointer };
    });
  };
  /** A named resource's data (its first language). */
  const data = (pointer: number): Buffer => {
    while (pointer & 0x80000000) pointer = entries(base + (pointer & 0x7fffffff))[0]!.pointer;
    const rva = file.readUInt32LE(base + pointer);
    const at = offset(rva);
    return file.subarray(at, at + file.readUInt32LE(base + pointer + 4));
  };
  const ofType = (type: number) => {
    const entry = entries(base).find((e) => e.name === String(type));
    return entry ? entries(base + (entry.pointer & 0x7fffffff)) : [];
  };

  const cursors = new Map(ofType(RT_CURSOR).map((e) => [e.name, e.pointer]));
  for (const group of ofType(RT_GROUP_CURSOR)) {
    const dir = data(group.pointer);
    let best: { size: number; depth: number; id: string } | null = null;
    for (let i = 0; i < dir.readUInt16LE(4); i++) {
      const at = 6 + 14 * i;
      const size = dir.readUInt16LE(at);
      const depth = dir.readUInt16LE(at + 6);
      const id = String(dir.readUInt16LE(at + 12));
      if (cursors.has(id) && (!best || size > best.size || (size === best.size && depth > best.depth))) best = { size, depth, id };
    }
    if (!best) continue;
    const cursor = data(cursors.get(best.id)!);
    result.set(group.name, { x: cursor.readUInt16LE(0), y: cursor.readUInt16LE(2), image: cursor.subarray(4) });
  }
  return result;
}

/** A cursor's bitmap as straight RGBA, top row first. */
export function decodeCursorImage(dib: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const headerSize = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  // The height counts the colour bitmap and the mask below it.
  const height = Math.abs(dib.readInt32LE(8)) / 2;
  const depth = dib.readUInt16LE(14);
  if (dib.readUInt32LE(16) !== 0 || ![1, 4, 8, 24, 32].includes(depth)) throw new Error(`A cursor bitmap this doesn't read (${depth} bits, compression ${dib.readUInt32LE(16)}).`);
  const colours = depth <= 8 ? dib.readUInt32LE(32) || 1 << depth : 0;
  const palette = headerSize;
  const pixels = palette + 4 * colours;
  const stride = Math.ceil((width * depth) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = pixels + stride * height;
  const rgba = new Uint8Array(width * height * 4);
  // A 32-bit cursor with no alpha at all (an old one) is cut out by its mask instead.
  let alpha = false;
  if (depth === 32) for (let i = pixels + 3; i < mask; i += 4) if (dib[i]) alpha = true;
  for (let y = 0; y < height; y++) {
    // Bottom row first.
    const row = pixels + (height - 1 - y) * stride;
    const maskRow = mask + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const masked = maskRow + (x >> 3) < dib.length && (dib[maskRow + (x >> 3)]! >> (7 - (x & 7))) & 1;
      let b: number, g: number, r: number;
      let a = 255;
      if (depth === 32 || depth === 24) {
        const at = row + x * (depth / 8);
        [b, g, r] = [dib[at]!, dib[at + 1]!, dib[at + 2]!];
        if (depth === 32 && alpha) a = dib[at + 3]!;
        else if (masked) a = 0;
      } else {
        const index = depth === 8 ? dib[row + x]! : depth === 4 ? (dib[row + (x >> 1)]! >> (x & 1 ? 0 : 4)) & 15 : (dib[row + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const at = palette + 4 * index;
        [b, g, r] = [dib[at]!, dib[at + 1]!, dib[at + 2]!];
        // Masked pixels are see-through, unless they invert what's under them: those are drawn black.
        if (masked) [r, g, b, a] = r || g || b ? [0, 0, 0, 255] : [0, 0, 0, 0];
      }
      rgba.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** RGBA as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const isPng = (image: Buffer) => image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

/** The editor's cursors out of FL Studio's module: those it has. */
export function flCursors(module: Buffer): FlCursorsResponse["cursors"] {
  const resources = readCursorResources(module);
  const cursors: FlCursorsResponse["cursors"] = {};
  for (const [name, resource] of Object.entries(FL_CURSORS) as [FlCursorName, string][]) {
    const found = resources.get(resource);
    if (!found) continue;
    try {
      let png = found.image;
      if (!isPng(png)) {
        const { width, height, rgba } = decodeCursorImage(found.image);
        png = encodePng(width, height, rgba);
      }
      cursors[name] = { url: `data:image/png;base64,${png.toString("base64")}`, x: found.x, y: found.y } satisfies FlCursor;
    } catch (error) {
      logger.warn(`FL Studio's ${resource} cursor isn't readable`, error);
    }
  }
  return cursors;
}

/** The FL Studio a version's folder name is, as a number to compare ("FL Studio 2025" is after "FL Studio 21"). */
const version = (folder: string) => Number(/(\d+)/.exec(folder)?.[1] ?? 0);

/**
 * FL Studio's engine module: `setting` (a folder of FL Studio's, or the module itself), else the newest FL Studio
 * in Image-Line's folder under Program Files. Only Windows': a Mac's FL Studio keeps its cursors otherwise.
 */
export async function findFlEngine(setting: string | null): Promise<string | null> {
  const exists = (file: string) =>
    fs.stat(file).then(
      (s) => s.isFile(),
      () => false,
    );
  const inFolder = async (folder: string) => {
    for (const name of ["FLEngine_x64.dll", "FLEngine.dll"]) if (await exists(path.join(folder, name))) return path.join(folder, name);
    return null;
  };
  if (setting === "none") return null;
  if (setting) return (await exists(setting)) ? setting : inFolder(setting);
  if (process.platform !== "win32") return null;
  for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (!root) continue;
    const imageLine = path.join(root, "Image-Line");
    const folders = await fs.readdir(imageLine).catch(() => [] as string[]);
    for (const folder of folders.filter((f) => /^FL Studio/i.test(f)).sort((a, b) => version(b) - version(a))) {
      const found = await inFolder(path.join(imageLine, folder));
      if (found) return found;
    }
  }
  return null;
}

/** This computer's FL Studio cursors, read once. */
export class FlStudioCursors {
  private loaded: Promise<FlCursorsResponse> | null = null;

  constructor(private readonly setting: string | null) {}

  get(): Promise<FlCursorsResponse> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  private async load(): Promise<FlCursorsResponse> {
    const module = await findFlEngine(this.setting);
    if (!module) return { cursors: {} };
    try {
      const cursors = flCursors(await fs.readFile(module));
      logger.info(`${Object.keys(cursors).length} cursors from ${module}`);
      return { cursors };
    } catch (error) {
      logger.warn(`FL Studio's cursors aren't readable in ${module}`, error);
      return { cursors: {} };
    }
  }
}
