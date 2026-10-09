/**
 * Apple's binary property lists (`bplist00`), read and written: an Audio Unit's state is one (its ClassInfo), and
 * Serum 2's holds the same Xfer containers as its VST3 state does, under "Processor State" and "Controller State"
 * (`plugin-state.ts`). Read and written again it's the same document: dictionaries keep their order (a `Map`:
 * "0" and "2" are keys, not indexes), integers stay integers and reals reals (`PlistReal`), data stays bytes.
 */

/** A real number, kept apart from an integer of the same value (an Audio Unit's "version" is an integer). */
export class PlistReal {
  constructor(readonly value: number) {}
}

export type PlistValue = string | number | bigint | boolean | null | PlistReal | Date | Uint8Array | PlistValue[] | PlistDict;
export type PlistDict = Map<string, PlistValue>;

const MAGIC = "bplist00";
/** Seconds from 1970 to 2001, Apple's epoch for dates. */
const EPOCH = 978307200;

export function isBinaryPlist(bytes: Uint8Array): boolean {
  return bytes.length >= 40 && Buffer.from(bytes.subarray(0, 8)).toString("latin1") === MAGIC;
}

export function readPlist(bytes: Uint8Array): PlistValue {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isBinaryPlist(bytes)) throw new Error('Not a binary property list: it doesn\'t start with "bplist00".');
  const trailer = buf.length - 32;
  const offsetSize = buf[trailer + 6];
  const refSize = buf[trailer + 7];
  const count = Number(buf.readBigUInt64BE(trailer + 8));
  const top = Number(buf.readBigUInt64BE(trailer + 16));
  const table = Number(buf.readBigUInt64BE(trailer + 24));
  if (![1, 2, 4, 8].includes(offsetSize) || ![1, 2, 4, 8].includes(refSize) || table + count * offsetSize > trailer) throw new Error("The property list's trailer is damaged.");
  const uint = (at: number, size: number) => (size === 8 ? Number(buf.readBigUInt64BE(at)) : buf.readUIntBE(at, size));
  const offsets = Array.from({ length: count }, (_, i) => uint(table + i * offsetSize, offsetSize));
  const reading = new Set<number>();

  const object = (ref: number): PlistValue => {
    if (ref >= count) throw new Error("The property list refers to an object it doesn't have.");
    if (reading.has(ref)) throw new Error("The property list contains itself.");
    reading.add(ref);
    try {
      return parse(offsets[ref]);
    } finally {
      reading.delete(ref);
    }
  };
  /** A container's or data's length: the marker's low nibble, or an integer after it (0xF). */
  const lengthAt = (at: number): [number, number] => {
    const low = buf[at] & 0x0f;
    if (low !== 0x0f) return [low, at + 1];
    const marker = buf[at + 1];
    if (marker >> 4 !== 0x1) throw new Error("The property list's length isn't an integer.");
    const size = 1 << (marker & 0x0f);
    return [uint(at + 2, Math.min(size, 8)), at + 2 + size];
  };
  const parse = (at: number): PlistValue => {
    const marker = buf[at];
    const high = marker >> 4;
    const low = marker & 0x0f;
    switch (high) {
      case 0x0:
        if (marker === 0x00) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        throw new Error(`The property list has a marker it can't read (0x${marker.toString(16)}).`);
      case 0x1: {
        const size = 1 << low;
        if (size === 8) {
          const value = buf.readBigInt64BE(at + 1);
          return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
        }
        if (size === 16) return buf.readBigInt64BE(at + 9);
        return buf.readUIntBE(at + 1, size);
      }
      case 0x2:
        return new PlistReal(low === 2 ? buf.readFloatBE(at + 1) : buf.readDoubleBE(at + 1));
      case 0x3:
        return new Date((buf.readDoubleBE(at + 1) + EPOCH) * 1000);
      case 0x4: {
        const [length, start] = lengthAt(at);
        return new Uint8Array(buf.subarray(start, start + length));
      }
      case 0x5: {
        const [length, start] = lengthAt(at);
        return buf.subarray(start, start + length).toString("latin1");
      }
      case 0x6: {
        const [length, start] = lengthAt(at);
        const chars = Buffer.from(buf.subarray(start, start + length * 2));
        chars.swap16();
        return chars.toString("utf16le");
      }
      case 0xa: {
        const [length, start] = lengthAt(at);
        return Array.from({ length }, (_, i) => object(uint(start + i * refSize, refSize)));
      }
      case 0xd: {
        const [length, start] = lengthAt(at);
        const dict: PlistDict = new Map();
        for (let i = 0; i < length; i++) {
          const key = object(uint(start + i * refSize, refSize));
          if (typeof key !== "string") throw new Error("A key of the property list's dictionary isn't text.");
          dict.set(key, object(uint(start + (length + i) * refSize, refSize)));
        }
        return dict;
      }
      default:
        throw new Error(`The property list has a marker it can't read (0x${marker.toString(16)}).`);
    }
  };
  return object(top);
}

const sizeFor = (max: number) => (max < 0x100 ? 1 : max < 0x10000 ? 2 : max < 0x100000000 ? 4 : 8);

function uintBytes(value: number, size: number): Buffer {
  const out = Buffer.alloc(size);
  if (size === 8) out.writeBigUInt64BE(BigInt(value));
  else out.writeUIntBE(value, 0, size);
  return out;
}

/** A value as a binary property list, laid out as Apple's are (every object once, in order, then the offsets). */
export function writePlist(value: PlistValue): Uint8Array {
  // Every object once, depth first, each numbered as it's met; a container keeps its items' numbers.
  const objects: PlistValue[] = [];
  const childRefs: number[][] = [];
  const number = (v: PlistValue): number => {
    const ref = objects.length;
    objects.push(v);
    if (Array.isArray(v)) childRefs[ref] = v.map(number);
    else if (v instanceof Map) {
      const keys = [...v.keys()].map(number);
      childRefs[ref] = [...keys, ...[...v.values()].map(number)];
    }
    return ref;
  };
  number(value);
  const refSize = sizeFor(objects.length);

  const length = (marker: number, n: number): Buffer =>
    n < 15 ? Buffer.from([marker | n]) : Buffer.concat([Buffer.from([marker | 0x0f]), integer(n)]);
  const integer = (n: number | bigint): Buffer => {
    if (typeof n === "bigint" || n < 0 || n > 0xffffffff) {
      const out = Buffer.alloc(9);
      out[0] = 0x13;
      out.writeBigInt64BE(BigInt(n), 1);
      return out;
    }
    const size = sizeFor(n);
    return Buffer.concat([Buffer.from([0x10 | Math.log2(size)]), uintBytes(n, size)]);
  };
  const encode = (v: PlistValue, ref: number): Buffer => {
    if (v === null) return Buffer.from([0x00]);
    if (v === false) return Buffer.from([0x08]);
    if (v === true) return Buffer.from([0x09]);
    if (typeof v === "number") {
      if (!Number.isInteger(v)) throw new Error(`${v} isn't an integer: give a real as a PlistReal.`);
      return integer(v);
    }
    if (typeof v === "bigint") return integer(v);
    if (v instanceof PlistReal) {
      const out = Buffer.alloc(9);
      out[0] = 0x23;
      out.writeDoubleBE(v.value, 1);
      return out;
    }
    if (v instanceof Date) {
      const out = Buffer.alloc(9);
      out[0] = 0x33;
      out.writeDoubleBE(v.getTime() / 1000 - EPOCH, 1);
      return out;
    }
    if (v instanceof Uint8Array) return Buffer.concat([length(0x40, v.length), Buffer.from(v)]);
    if (typeof v === "string") {
      if (/^[\x00-\x7f]*$/.test(v)) return Buffer.concat([length(0x50, v.length), Buffer.from(v, "latin1")]);
      const chars = Buffer.from(v, "utf16le");
      chars.swap16();
      return Buffer.concat([length(0x60, chars.length / 2), chars]);
    }
    const items = childRefs[ref];
    const marker = Array.isArray(v) ? 0xa0 : 0xd0;
    const n = Array.isArray(v) ? v.length : v.size;
    return Buffer.concat([length(marker, n), ...items.map((r) => uintBytes(r, refSize))]);
  };

  const parts: Buffer[] = [Buffer.from(MAGIC, "latin1")];
  const offsets: number[] = [];
  let at = 8;
  objects.forEach((v, ref) => {
    const encoded = encode(v, ref);
    offsets.push(at);
    parts.push(encoded);
    at += encoded.length;
  });
  const offsetSize = sizeFor(at);
  parts.push(...offsets.map((o) => uintBytes(o, offsetSize)));
  const trailer = Buffer.alloc(32);
  trailer[6] = offsetSize;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  parts.push(trailer);
  return new Uint8Array(Buffer.concat(parts));
}
