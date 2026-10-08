/**
 * Xfer's container, the same for a `.SerumPreset` file and for Serum 2's plugin state:
 *
 *   "XferJson\0"  u64 LE: the JSON's length  JSON metadata  u32 LE: the settings' size  u32 LE: 2  zstd(settings)
 *
 * The settings are CBOR (`cbor.ts`). The metadata's `hash` is the MD5 (hex) of the zstd bytes. Serum writes the
 * JSON compact with its keys sorted and whole numbers as `4.0` (nlohmann::json's way), which `metadataJson` copies.
 */
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const MAGIC = Buffer.from("XferJson\0", "latin1");
/** The payload's format number: every preset and state measured has 2. */
export const PAYLOAD_VERSION = 2;

export type XferMetadata = Record<string, string | number | boolean | string[]>;

export interface XferContainer {
  meta: XferMetadata;
  /** The settings, decompressed (CBOR). */
  settings: Uint8Array;
  /** The payload's format number (`PAYLOAD_VERSION`). */
  version: number;
  /** The zstd bytes as they were in the file. */
  compressed: Uint8Array;
}

export function isXferContainer(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function readXfer(bytes: Uint8Array): XferContainer {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isXferContainer(buf)) throw new Error('Not an Xfer container: it doesn\'t start with "XferJson".');
  const jsonLength = Number(buf.readBigUInt64LE(MAGIC.length));
  const jsonStart = MAGIC.length + 8;
  if (jsonStart + jsonLength + 8 > buf.length) throw new Error("The container's metadata runs past its end.");
  const meta = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLength).toString("utf8")) as XferMetadata;
  const payload = jsonStart + jsonLength;
  const size = buf.readUInt32LE(payload);
  const version = buf.readUInt32LE(payload + 4);
  const compressed = buf.subarray(payload + 8);
  const settings = zlib.zstdDecompressSync(compressed);
  if (settings.length !== size) throw new Error(`The settings are ${settings.length} bytes; the container says ${size}.`);
  return { meta, settings: new Uint8Array(settings), version, compressed: new Uint8Array(compressed) };
}

/** A JSON value as nlohmann::json dumps it: compact, keys sorted, whole floats with ".0", text as UTF-8. */
function json(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }
  if (typeof value === "string" || typeof value === "boolean" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(json).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${json((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  throw new Error(`Can't write ${typeof value} in the metadata.`);
}

export function metadataJson(meta: XferMetadata): string {
  return json(meta);
}

/** zstd at a high level: presets are small, and Serum's own files are as tight. */
export function compressSettings(settings: Uint8Array): Uint8Array {
  return new Uint8Array(
    zlib.zstdCompressSync(settings, {
      params: { [zlib.constants.ZSTD_c_compressionLevel]: 19, [zlib.constants.ZSTD_c_checksumFlag]: 0 },
    }),
  );
}

/** A container of these settings (CBOR) under this metadata: its `hash` is worked out here. */
export function writeXfer(meta: XferMetadata, settings: Uint8Array, compressed = compressSettings(settings)): Uint8Array {
  const hash = createHash("md5").update(compressed).digest("hex");
  const head = Buffer.from(metadataJson({ ...meta, hash }), "utf8");
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(settings.length, 0);
  sizes.writeUInt32LE(PAYLOAD_VERSION, 4);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(head.length));
  return new Uint8Array(Buffer.concat([MAGIC, length, head, sizes, compressed]));
}
