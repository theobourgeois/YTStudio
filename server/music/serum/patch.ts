/**
 * Everything in a preset the spec doesn't name is kept as a JSON merge patch (RFC 7396) on what the spec's
 * named fields make, so reading a preset and writing it back loses nothing. Serum never stores `null` as a
 * map's value (checked on 118 presets), so `null` can mean "remove this key" as the RFC has it; lists are
 * replaced whole.
 *
 * The patch is JSON, so CBOR's extras get a tagged form (`toJson`/`fromJson`): integers past 2^53
 * (`{"$int": "…"}`), byte strings (`{"$bytes": base64}`), non-finite floats (`{"$float": "NaN"}`) and long lists
 * of 32-bit floats, such as an embedded wavetable (`{"$f32": base64 of little-endian floats}`), which would
 * otherwise be megabytes of JSON.
 */
import { type CborMap, type CborValue, isFloat32, isPlainMap } from "./cbor.ts";

export type JsonValue = number | string | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function deepEqual(a: CborValue, b: CborValue): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainMap(a) && isPlainMap(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export function clone<T extends CborValue>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value instanceof Uint8Array) return value.slice() as T;
  if (isPlainMap(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

/** The merge patch that turns `from` into `to` (undefined if they're equal). */
export function diff(from: CborValue | undefined, to: CborValue): CborValue | undefined {
  if (from !== undefined && deepEqual(from, to)) return undefined;
  if (!isPlainMap(from) || !isPlainMap(to)) return clone(to);
  const patch: CborMap = {};
  for (const key of Object.keys(from)) if (!Object.hasOwn(to, key)) patch[key] = null;
  for (const [key, value] of Object.entries(to)) {
    const d = diff(Object.hasOwn(from, key) ? from[key] : undefined, value);
    if (d === undefined) continue;
    // A map patched onto a map that isn't one would be merged into nothing: say the whole map.
    patch[key] = isPlainMap(value) && !isPlainMap(from[key]) ? clone(value) : d;
  }
  return Object.keys(patch).length ? patch : undefined;
}

/** `patch` applied to `target` (RFC 7396): maps merge, `null` removes, anything else replaces. */
export function applyPatch(target: CborValue | undefined, patch: CborValue): CborValue {
  if (!isPlainMap(patch)) return clone(patch);
  const out: CborMap = isPlainMap(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = applyPatch(out[key], value);
  }
  return out;
}

const LONG_LIST = 16;

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

/** A CBOR value as JSON (see the tagged forms above). */
export function toJson(value: CborValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return { $int: value.toString() };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $float: "NaN" };
    if (!Number.isFinite(value)) return { $float: value > 0 ? "Infinity" : "-Infinity" };
    if (Object.is(value, -0)) return { $float: "-0" };
    return value;
  }
  if (value instanceof Uint8Array) return { $bytes: base64(value) };
  if (Array.isArray(value)) {
    const floats =
      value.length > LONG_LIST &&
      value.every((v) => typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0) && isFloat32(v));
    // Whole numbers are left as JSON: under an integer key they're integers, which a float list can't say.
    if (floats && value.some((v) => !Number.isInteger(v))) {
      const bytes = new Uint8Array(value.length * 4);
      const view = new DataView(bytes.buffer);
      value.forEach((v, i) => view.setFloat32(i * 4, v as number, true));
      return { $f32: base64(bytes) };
    }
    return value.map(toJson);
  }
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value)) out[k] = toJson(v);
  return out;
}

/** JSON as a CBOR value: the inverse of `toJson`. Throws on a tag it doesn't know. */
export function fromJson(value: JsonValue, path = ""): CborValue {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((v, i) => fromJson(v, `${path}[${i}]`));
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0].startsWith("$")) {
    const tag = keys[0];
    const inner = value[tag];
    if (typeof inner !== "string") throw new Error(`${path || "raw"}: ${tag} must be a string.`);
    if (tag === "$int") return BigInt(inner);
    if (tag === "$float") return inner === "-0" ? -0 : Number(inner);
    if (tag === "$bytes") return new Uint8Array(Buffer.from(inner, "base64"));
    if (tag === "$f32") {
      const bytes = Buffer.from(inner, "base64");
      if (bytes.length % 4) throw new Error(`${path || "raw"}: $f32 must be whole 4-byte floats.`);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true));
    }
    throw new Error(`${path || "raw"}: unknown tag ${tag}.`);
  }
  const out: CborMap = {};
  for (const [k, v] of Object.entries(value)) out[k] = fromJson(v, path ? `${path}.${k}` : k);
  return out;
}
