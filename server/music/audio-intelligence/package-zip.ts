/** Bounded ZIP32 reader for ordinary stored/deflated packages. No shell extraction. */
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { safePackagePath } from "../../../shared/music/audio-intelligence/datasets.ts";

export const PACKAGE_LIMITS = { files: 1000, fileBytes: 256 * 1024 * 1024, totalBytes: 512 * 1024 * 1024, archiveBytes: 256 * 1024 * 1024 };
const inflate = promisify(inflateRaw);
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let bit = 0; bit < 8; bit++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function packageCrc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
export interface ZipEntry { name: string; size: number; compressedSize: number; method: number; crc: number; body: number }
const invalid = (message: string): never => { throw new Error(`Unsupported or invalid ZIP: ${message}`); };
export function inventoryPackageZip(bytes: Buffer): ZipEntry[] {
  if (bytes.length > PACKAGE_LIMITS.archiveBytes || bytes.length < 22) invalid("archive size");
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) { end = at; break; }
  if (end < 0) invalid("missing end record");
  const count = bytes.readUInt16LE(end + 10), directorySize = bytes.readUInt32LE(end + 12), directory = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count === 0xffff || directorySize === 0xffffffff || directory === 0xffffffff) invalid("multi-disk/ZIP64 archives are not supported");
  if (count > PACKAGE_LIMITS.files * 2 || directory + directorySize !== end) invalid("directory size/count");
  const entries: ZipEntry[] = [], names = new Set<string>(), intervals: [number, number][] = [];
  let at = directory, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) invalid("central record");
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10), crc = bytes.readUInt32LE(at + 16), compressedSize = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28), extraLength = bytes.readUInt16LE(at + 30), commentLength = bytes.readUInt16LE(at + 32), offset = bytes.readUInt32LE(at + 42);
    const recordEnd = at + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > end || bytes.readUInt16LE(at + 34) || flags & ~0x080e || flags & 1 || ![0, 8].includes(method) || [size, compressedSize, offset].includes(0xffffffff)) invalid("encrypted, unsupported or truncated entry");
    const mode = (bytes.readUInt32LE(at + 38) >>> 16) & 0xf000;
    if (mode && mode !== 0x8000 && mode !== 0x4000) invalid("links/special files are not supported");
    let name: string;
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(at + 46, at + 46 + nameLength)); }
    catch { return invalid("filenames must use UTF-8"); }
    const isDirectory = name.endsWith("/");
    const safeName = isDirectory ? name.slice(0, -1) : name;
    if (!safePackagePath(safeName) || names.has(safeName.toLowerCase())) invalid("unsafe or duplicate filename");
    names.add(safeName.toLowerCase());
    if (offset + 30 > directory || bytes.readUInt32LE(offset) !== 0x04034b50) invalid("local entry");
    const localNameLength = bytes.readUInt16LE(offset + 26), localExtraLength = bytes.readUInt16LE(offset + 28), body = offset + 30 + localNameLength + localExtraLength;
    if (body + compressedSize > directory || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method || !bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(bytes.subarray(at + 46, at + 46 + nameLength))) invalid("local/central mismatch");
    if (!(flags & 8) && (bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== compressedSize || bytes.readUInt32LE(offset + 22) !== size)) invalid("local size/checksum mismatch");
    intervals.push([offset, body + compressedSize]);
    if (isDirectory) { if (size || compressedSize) invalid("directory has data"); }
    else {
      total += size;
      if (size > PACKAGE_LIMITS.fileBytes || total > PACKAGE_LIMITS.totalBytes || entries.length >= PACKAGE_LIMITS.files) invalid("expanded size/file count limit");
      entries.push({ name, size, compressedSize, method, crc, body });
    }
    at = recordEnd;
  }
  if (at !== end || !entries.length) invalid("empty or inconsistent directory");
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i++) if (intervals[i][0] < intervals[i - 1][1]) invalid("overlapping entries");
  return entries;
}
export async function readPackageZipEntry(bytes: Buffer, entry: ZipEntry, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const compressed = bytes.subarray(entry.body, entry.body + entry.compressedSize);
  const decoded = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: Math.max(1, entry.size) });
  signal.throwIfAborted();
  if (decoded.length !== entry.size || packageCrc32(decoded) !== entry.crc) invalid("decompressed size/checksum mismatch");
  return decoded;
}
