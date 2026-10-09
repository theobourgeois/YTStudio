/**
 * CBOR as Serum 2 writes its settings, read and written back byte for byte.
 *
 * What Serum does, measured on 118 presets and states (about 20 million floats): every map's keys are
 * text, sorted by their UTF-8 bytes; a float is a 32-bit float when the double is exactly one, else a
 * 64-bit one (never a half); integers are written as integers only under a fixed set of keys (an LFO's
 * `numPoints`, a mod slot's `source`...), and every other number is a float even when it's whole
 * (`kParamEnabled: 1.0`). JavaScript has one number type, so the encoder takes that set of keys
 * (`SERUM_INTEGER_KEYS`) rather than remembering how each number was written.
 */

/** A CBOR value as JSON-like data: maps are objects with text keys, integers past 2^53 are bigints. */
export type CborValue = number | bigint | string | boolean | null | Uint8Array | CborValue[] | CborMap;
export interface CborMap {
  [key: string]: CborValue;
}

/**
 * The keys whose numbers Serum writes as integers (in a list under one of them too: `source`, `scale`,
 * `types`, `paramIDs`, `activeClips`). Every one of them holds only integers in the presets measured, and the
 * controller's effect knob links (`fxID`, `paramIndex`) in its own state.
 */
export const SERUM_INTEGER_KEYS: ReadonlySet<string> = new Set([
  "activeClip",
  "activeClips",
  "baseNote",
  "boundary64",
  "busID",
  "ccNum",
  "channel",
  "destModuleID",
  "destModuleParamID",
  "edgeFadeMs",
  "fxID",
  "gridDivision",
  "interpolateAfterLoad",
  "lfoID",
  "lfoType",
  "loopback64",
  "loopbackPointNum",
  "mpeConfig",
  "mpePitchBendRange",
  "noteNum",
  "numChannels",
  "numFrames",
  "numPoints",
  "paramIDs",
  "paramIndex",
  "pointID",
  "sampleRate",
  "scale",
  "source",
  "subType",
  "target",
  "type",
  "types",
]);

export function isPlainMap(value: unknown): value is CborMap {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}

/** Decode one CBOR item that fills `bytes`. Throws on anything Serum doesn't write (tags, undefined, non-text keys). */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder("utf-8", { fatal: true });
  let p = 0;
  const need = (n: number) => {
    if (p + n > bytes.length) throw new Error(`CBOR ends early at byte ${p}.`);
  };
  const length = (info: number): number | bigint => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (size === 0) throw new Error(`Unsupported CBOR length (info ${info}) at byte ${p - 1}.`);
    need(size);
    let n: number | bigint;
    if (size === 1) n = bytes[p];
    else if (size === 2) n = view.getUint16(p);
    else if (size === 4) n = view.getUint32(p);
    else {
      const big = view.getBigUint64(p);
      n = big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
    }
    p += size;
    return n;
  };
  const count = (info: number): number => {
    const n = length(info);
    if (typeof n === "bigint") throw new Error(`A CBOR length too large at byte ${p}.`);
    return n;
  };
  const item = (): CborValue => {
    need(1);
    const head = bytes[p++];
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0:
        return length(info);
      case 1: {
        const n = length(info);
        if (typeof n === "bigint") return -1n - n;
        return n === Number.MAX_SAFE_INTEGER ? -1n - BigInt(n) : -1 - n;
      }
      case 2: {
        const n = count(info);
        need(n);
        const out = bytes.slice(p, p + n);
        p += n;
        return out;
      }
      case 3: {
        const n = count(info);
        need(n);
        const out = text.decode(bytes.subarray(p, p + n));
        p += n;
        return out;
      }
      case 4: {
        const n = count(info);
        const out: CborValue[] = new Array(n);
        for (let i = 0; i < n; i++) out[i] = item();
        return out;
      }
      case 5: {
        const n = count(info);
        const out: CborMap = {};
        for (let i = 0; i < n; i++) {
          const key = item();
          if (typeof key !== "string") throw new Error(`A CBOR map key that isn't text at byte ${p}.`);
          out[key] = item();
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 25) {
          need(2);
          const v = halfToNumber(view.getUint16(p));
          p += 2;
          return v;
        }
        if (info === 26) {
          need(4);
          const v = view.getFloat32(p);
          p += 4;
          return v;
        }
        if (info === 27) {
          need(8);
          const v = view.getFloat64(p);
          p += 8;
          return v;
        }
        throw new Error(`Unsupported CBOR simple value ${info} at byte ${p - 1}.`);
      default:
        throw new Error(`Unsupported CBOR major type ${major} at byte ${p - 1}.`);
    }
  };
  const value = item();
  if (p !== bytes.length) throw new Error(`${bytes.length - p} bytes after the CBOR item.`);
  return value;
}

function halfToNumber(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

const f32 = new Float32Array(1);
/** Whether a double survives being a 32-bit float: then Serum writes it as one. */
export function isFloat32(value: number): boolean {
  f32[0] = value;
  return f32[0] === value || Number.isNaN(value);
}

const encoder = new TextEncoder();

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** A growable byte buffer. */
class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  byte(b: number) {
    this.room(1);
    this.buf[this.length++] = b;
  }
  bytes(b: Uint8Array) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  head(major: number, n: number | bigint) {
    if (typeof n === "bigint") {
      this.room(9);
      this.buf[this.length++] = (major << 5) | 27;
      this.view.setBigUint64(this.length, n);
      this.length += 8;
      return;
    }
    if (n < 24) this.byte((major << 5) | n);
    else if (n < 0x100) {
      this.byte((major << 5) | 24);
      this.byte(n);
    } else if (n < 0x10000) {
      this.room(3);
      this.buf[this.length++] = (major << 5) | 25;
      this.view.setUint16(this.length, n);
      this.length += 2;
    } else if (n < 0x100000000) {
      this.room(5);
      this.buf[this.length++] = (major << 5) | 26;
      this.view.setUint32(this.length, n);
      this.length += 4;
    } else {
      this.room(9);
      this.buf[this.length++] = (major << 5) | 27;
      this.view.setBigUint64(this.length, BigInt(n));
      this.length += 8;
    }
  }
  float(v: number) {
    if (isFloat32(v)) {
      this.room(5);
      this.buf[this.length++] = 0xfa;
      this.view.setFloat32(this.length, v);
      this.length += 4;
    } else {
      this.room(9);
      this.buf[this.length++] = 0xfb;
      this.view.setFloat64(this.length, v);
      this.length += 8;
    }
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/**
 * Encode as Serum does: map keys sorted by their bytes, floats as 32-bit when exact, and a number as an
 * integer only under one of `integerKeys` (the key of the map entry it's in, or of the list it's in).
 */
export function encodeCbor(value: CborValue, integerKeys: ReadonlySet<string> = SERUM_INTEGER_KEYS): Uint8Array {
  const out = new Writer();
  const write = (v: CborValue, key: string | null, path: string) => {
    if (v === null) return out.byte(0xf6);
    if (v === true) return out.byte(0xf5);
    if (v === false) return out.byte(0xf4);
    if (typeof v === "bigint") {
      if (v >= 0n) return out.head(0, v);
      return out.head(1, -1n - v);
    }
    if (typeof v === "number") {
      if (key !== null && integerKeys.has(key)) {
        if (!Number.isSafeInteger(v)) throw new Error(`${path} must be a whole number (it's ${v}).`);
        return v >= 0 ? out.head(0, v) : out.head(1, -1 - v);
      }
      return out.float(v);
    }
    if (typeof v === "string") {
      const b = encoder.encode(v);
      out.head(3, b.length);
      return out.bytes(b);
    }
    if (v instanceof Uint8Array) {
      out.head(2, v.length);
      return out.bytes(v);
    }
    if (Array.isArray(v)) {
      out.head(4, v.length);
      v.forEach((x, i) => write(x, key, `${path}[${i}]`));
      return;
    }
    const entries = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => [encoder.encode(k), k, x] as const)
      .sort((a, b) => compareBytes(a[0], b[0]));
    out.head(5, entries.length);
    for (const [bytes, k, x] of entries) {
      out.head(3, bytes.length);
      out.bytes(bytes);
      write(x, k, path ? `${path}.${k}` : k);
    }
  };
  write(value, null, "");
  return out.result();
}
