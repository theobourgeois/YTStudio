/**
 * Writes a ZIP of files on disk, as a PNG sequence's export is downloaded (one file, which a browser can take).
 * Entries are stored, not deflated: what goes in (PNGs, a WAV) is compressed already or barely compresses, and
 * storing is as fast as copying. ZIP64 records are written only when something passes the classic format's limits
 * (4 GB, 65,535 entries), which a long 4K sequence soon does; every unzip in use reads them.
 */
import fs from "node:fs/promises";
import { crc32 } from "node:zlib";

export interface ZipSource {
  /** Its name in the archive (forward slashes). */
  name: string;
  /** Where it is on disk. */
  path: string;
}

export interface ZipOptions {
  signal?: AbortSignal;
  /** Remove each file once it's in the archive (a sequence's frames in `tmp`, so the disk holds them once). */
  removeAfter?: boolean;
  /** Called after each entry, with how many are in. */
  onEntry?: (count: number) => void;
  /** ZIP64 records for every entry and the end, whatever the sizes (tests use it on small archives). */
  zip64?: boolean;
  /** The entries' modification time (default: now). */
  date?: Date;
}

const MAX32 = 0xffff_ffff;
const MAX16 = 0xffff;
/** Version 4.5 (ZIP64), else 2.0. */
const version = (zip64: boolean) => (zip64 ? 45 : 20);
/** Bit 11: the names are UTF-8. */
const UTF8 = 0x0800;

/** A date as MS-DOS's time and date words (2-second steps, from 1980). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

interface Written {
  name: Buffer;
  crc: number;
  size: number;
  offset: number;
}

/** Write `entries` into a new ZIP at `output` (replacing it), one file at a time. */
export async function writeZip(output: string, entries: Iterable<ZipSource>, options: ZipOptions = {}): Promise<void> {
  const { signal, removeAfter = false, onEntry, zip64: forced = false } = options;
  const when = dosDateTime(options.date ?? new Date());
  const handle = await fs.open(output, "w");
  let offset = 0;
  const write = async (buffer: Buffer) => {
    await handle.write(buffer, 0, buffer.length, offset);
    offset += buffer.length;
  };
  const written: Written[] = [];
  try {
    for (const entry of entries) {
      signal?.throwIfAborted();
      const data = await fs.readFile(entry.path);
      const name = Buffer.from(entry.name, "utf8");
      const crc = crc32(data);
      const big = forced || data.length >= MAX32;
      const extra = big ? zip64Extra([data.length, data.length]) : Buffer.alloc(0);
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(version(big), 4);
      head.writeUInt16LE(UTF8, 6);
      head.writeUInt16LE(0, 8); // stored
      head.writeUInt16LE(when.time, 10);
      head.writeUInt16LE(when.date, 12);
      head.writeUInt32LE(crc, 14);
      head.writeUInt32LE(big ? MAX32 : data.length, 18);
      head.writeUInt32LE(big ? MAX32 : data.length, 22);
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(extra.length, 28);
      written.push({ name, crc, size: data.length, offset });
      await write(Buffer.concat([head, name, extra]));
      await write(data);
      if (removeAfter) await fs.rm(entry.path, { force: true });
      onEntry?.(written.length);
    }

    // The central directory.
    const start = offset;
    for (const { name, crc, size, offset: at } of written) {
      const bigSize = forced || size >= MAX32;
      const bigOffset = forced || at >= MAX32;
      const extra = bigSize || bigOffset ? zip64Extra([...(bigSize ? [size, size] : []), ...(bigOffset ? [at] : [])]) : Buffer.alloc(0);
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE((3 << 8) | version(bigSize || bigOffset), 4); // made by Unix, so the mode below is read
      head.writeUInt16LE(version(bigSize || bigOffset), 6);
      head.writeUInt16LE(UTF8, 8);
      head.writeUInt16LE(0, 10);
      head.writeUInt16LE(when.time, 12);
      head.writeUInt16LE(when.date, 14);
      head.writeUInt32LE(crc, 16);
      head.writeUInt32LE(bigSize ? MAX32 : size, 20);
      head.writeUInt32LE(bigSize ? MAX32 : size, 24);
      head.writeUInt16LE(name.length, 28);
      head.writeUInt16LE(extra.length, 30);
      // Comment length, disk, internal attributes: 0.
      head.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
      head.writeUInt32LE(bigOffset ? MAX32 : at, 42);
      await write(Buffer.concat([head, name, extra]));
    }
    const size = offset - start;

    const count = written.length;
    if (forced || count >= MAX16 || start >= MAX32 || size >= MAX32) {
      const record = offset;
      const end64 = Buffer.alloc(56);
      end64.writeUInt32LE(0x06064b50, 0);
      end64.writeBigUInt64LE(44n, 4); // the size of what follows
      end64.writeUInt16LE((3 << 8) | 45, 12);
      end64.writeUInt16LE(45, 14);
      // This disk, the directory's disk: 0.
      end64.writeBigUInt64LE(BigInt(count), 24);
      end64.writeBigUInt64LE(BigInt(count), 32);
      end64.writeBigUInt64LE(BigInt(size), 40);
      end64.writeBigUInt64LE(BigInt(start), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeBigUInt64LE(BigInt(record), 8);
      locator.writeUInt32LE(1, 16);
      await write(Buffer.concat([end64, locator]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(count, MAX16), 8);
    end.writeUInt16LE(Math.min(count, MAX16), 10);
    end.writeUInt32LE(Math.min(size, MAX32), 12);
    end.writeUInt32LE(forced ? MAX32 : Math.min(start, MAX32), 16);
    await write(end);
  } finally {
    await handle.close();
  }
}

/** A ZIP64 extended information field holding `values` (8 bytes each, in the order the format says). */
function zip64Extra(values: number[]): Buffer {
  const extra = Buffer.alloc(4 + 8 * values.length);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(8 * values.length, 2);
  values.forEach((v, i) => extra.writeBigUInt64LE(BigInt(v), 4 + 8 * i));
  return extra;
}
