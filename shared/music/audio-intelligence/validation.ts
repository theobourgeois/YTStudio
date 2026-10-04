/**
 * Reading untrusted records (a manifest off the disk, a tool's input). These records are evidence, so unlike
 * a song's `normalize*` they are never *repaired*: anything wrong is an error naming where, and the caller
 * refuses the record. Each validator builds a clean copy as it reads (unknown fields don't survive), so a
 * checked record is the canonical one its id was hashed from.
 */
import { hashJson } from "../hash.ts";

export type Obj = Record<string, unknown>;

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const isObject = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Collects what's wrong, each with the path it's at (`media[2].sha256`). */
export class Problems {
  readonly list: string[] = [];
  add(path: string, message: string) {
    this.list.push(path ? `${path}: ${message}` : message);
  }
  get any() {
    return this.list.length > 0;
  }
}

export function toValidation<T>(p: Problems, value: T): Validation<T> {
  return p.any ? { ok: false, errors: p.list } : { ok: true, value };
}

const HASH = /^[0-9a-f]{64}$/;
export const isHash = (v: unknown): v is string => typeof v === "string" && HASH.test(v);

export function object(v: unknown, path: string, p: Problems): Obj {
  if (isObject(v)) return v;
  p.add(path, "must be an object");
  return {};
}

export function string(v: unknown, path: string, p: Problems, options: { nonEmpty?: boolean; max?: number } = {}): string {
  if (typeof v !== "string") {
    p.add(path, "must be a string");
    return "";
  }
  if (options.nonEmpty && v.length === 0) p.add(path, "must not be empty");
  if (options.max !== undefined && v.length > options.max) p.add(path, `must be at most ${options.max} characters`);
  return v;
}

export const optionalString = (v: unknown, path: string, p: Problems): string | undefined => (v === undefined ? undefined : string(v, path, p));

export function hash(v: unknown, path: string, p: Problems): string {
  if (isHash(v)) return v;
  p.add(path, "must be a SHA-256 as 64 lower-case hex digits");
  return "";
}

export const nullableHash = (v: unknown, path: string, p: Problems): string | null => (v === null ? null : hash(v, path, p));

export function number(v: unknown, path: string, p: Problems, options: { min?: number; max?: number; int?: boolean } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    p.add(path, "must be a finite number");
    return 0;
  }
  if (options.int && !Number.isInteger(v)) p.add(path, "must be a whole number");
  if (options.min !== undefined && v < options.min) p.add(path, `must be at least ${options.min}`);
  if (options.max !== undefined && v > options.max) p.add(path, `must be at most ${options.max}`);
  return v;
}

export const nullableNumber = (v: unknown, path: string, p: Problems, options: { min?: number; max?: number; int?: boolean } = {}): number | null =>
  v === null ? null : number(v, path, p, options);

export function boolean(v: unknown, path: string, p: Problems): boolean {
  if (typeof v === "boolean") return v;
  p.add(path, "must be true or false");
  return false;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, p: Problems): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  p.add(path, `must be one of ${allowed.join(", ")}`);
  return allowed[0];
}

export function array(v: unknown, path: string, p: Problems, max = 100_000): unknown[] {
  if (!Array.isArray(v)) {
    p.add(path, "must be a list");
    return [];
  }
  if (v.length > max) {
    p.add(path, `has ${v.length} items; at most ${max}`);
    return [];
  }
  return v;
}

export function stringList(v: unknown, path: string, p: Problems, max = 10_000): string[] {
  return array(v, path, p, max).map((item, i) => string(item, `${path}[${i}]`, p));
}

/** Reports every value `key` of `items` that appears twice. */
export function unique<T>(items: readonly T[], key: (item: T) => string, path: string, p: Problems) {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) p.add(path, `"${k}" appears twice`);
    seen.add(k);
  }
}

/** `<prefix>_` and the first 20 digits of a hash: short enough to hand a model, long enough never to collide by chance (80 bits). */
export const shortId = (prefix: string, digest: string): string => `${prefix}_${digest.slice(0, 20)}`;

/** The id a record must carry: its prefix and the hash of its content, left out the fields that aren't identity. */
export function contentId(prefix: string, record: object, leaveOut: readonly string[]): string {
  const identity: Obj = { ...(record as Obj) };
  for (const key of ["id", ...leaveOut]) delete identity[key];
  return shortId(prefix, hashJson(identity));
}
