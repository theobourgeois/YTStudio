/**
 * Surfaces: pixels in a tile grid (a pixel layer's colour, a mask's coverage, a selection), stored as
 * immutable content-addressed tiles listed by a manifest (docs/photo/architecture.md, "Resources").
 * A document references a manifest by its hash; an edit makes new tiles and a new manifest, and undo
 * switches the hash back. Everything here is pure: hashing is the caller's (WebCrypto in the tab,
 * node:crypto on the server).
 */
import type { TileSize } from "./lab.ts";
import type { PhotoProject, SurfaceId } from "./types.ts";

export type SurfaceFormat = "rgba16f" | "r16f" | "rgba32f";

/** Channels and bytes per channel of each format. */
export const FORMAT_INFO: Record<SurfaceFormat, { channels: number; bytesPerChannel: number }> = {
  rgba16f: { channels: 4, bytesPerChannel: 2 },
  r16f: { channels: 1, bytesPerChannel: 2 },
  rgba32f: { channels: 4, bytesPerChannel: 4 },
};

/** A tile's entry: its tile coordinates and a tile hash, or `c:` and the value of every sample when constant. */
export type TileEntry = [x: number, y: number, ref: string];

export interface SurfaceManifest {
  v: 1;
  format: SurfaceFormat;
  tile: TileSize;
  /** The value of every tile not listed (one number per channel). */
  fill: number[];
  /** Sorted by y then x; no duplicates. */
  tiles: TileEntry[];
}

const HASH = /^[0-9a-f]{64}$/;
/** A SHA-256 in lowercase hex: what tiles and manifests are called. */
export const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);

/** The constant-tile reference for these channel values. */
export const constantRef = (values: readonly number[]) => `c:${values.join(",")}`;

/** The values a constant reference stands for, or null when it's a tile hash. */
export function constantValues(ref: string): number[] | null {
  if (!ref.startsWith("c:")) return null;
  return ref.slice(2).split(",").map(Number);
}

export function tileBytes(format: SurfaceFormat, tile: TileSize): number {
  const { channels, bytesPerChannel } = FORMAT_INFO[format];
  return tile * tile * channels * bytesPerChannel;
}

const byPosition = (a: TileEntry, b: TileEntry) => a[1] - b[1] || a[0] - b[0];

/**
 * The manifest with `entries` replacing (or adding) the tiles at their coordinates. An entry whose ref is
 * the fill's constant removes the tile instead. Returns the same instance when nothing changes.
 */
export function withTiles(manifest: SurfaceManifest, entries: readonly TileEntry[]): SurfaceManifest {
  if (!entries.length) return manifest;
  const fillRef = constantRef(manifest.fill);
  const map = new Map<string, TileEntry>(manifest.tiles.map((e) => [`${e[0]},${e[1]}`, e]));
  let changed = false;
  for (const [x, y, ref] of entries) {
    const key = `${x},${y}`;
    const old = map.get(key);
    if (ref === fillRef) {
      if (old) {
        map.delete(key);
        changed = true;
      }
    } else if (!old || old[2] !== ref) {
      map.set(key, [x, y, ref]);
      changed = true;
    }
  }
  if (!changed) return manifest;
  return { ...manifest, tiles: [...map.values()].sort(byPosition) };
}

/** An empty surface: every tile is `fill`. */
export function emptySurface(format: SurfaceFormat, tile: TileSize, fill: number[]): SurfaceManifest {
  return { v: 1, format, tile, fill, tiles: [] };
}

/**
 * Checks an untrusted manifest. Returns it typed, or a message saying what's wrong (sent back to the
 * client, so it names the field).
 */
export function validateManifest(value: unknown): SurfaceManifest | string {
  if (!value || typeof value !== "object") return "A manifest must be an object.";
  const m = value as Record<string, unknown>;
  if (m.v !== 1) return "Unknown manifest version (expected v: 1).";
  if (typeof m.format !== "string" || !(m.format in FORMAT_INFO)) return `Unknown format: use ${Object.keys(FORMAT_INFO).join(", ")}.`;
  const format = m.format as SurfaceFormat;
  if (m.tile !== 256 && m.tile !== 512) return "tile must be 256 or 512.";
  const channels = FORMAT_INFO[format].channels;
  const isValues = (v: unknown): v is number[] => Array.isArray(v) && v.length === channels && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!isValues(m.fill)) return `fill must be ${channels} finite numbers.`;
  if (!Array.isArray(m.tiles)) return "tiles must be an array.";
  const seen = new Set<string>();
  let previous: TileEntry | null = null;
  for (const entry of m.tiles as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 3) return "Each tile must be [x, y, ref].";
    const [x, y, ref] = entry as unknown[];
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x as number) > 1e6 || Math.abs(y as number) > 1e6) return "Tile coordinates must be integers.";
    if (typeof ref !== "string") return "A tile's ref must be a string.";
    const constant = constantValues(ref);
    if (constant ? !isValues(constant) : !isHash(ref)) return `Bad tile ref at ${x},${y}: a SHA-256 in hex, or c: and ${channels} numbers.`;
    const key = `${x},${y}`;
    if (seen.has(key)) return `Tile ${key} is listed twice.`;
    seen.add(key);
    const typed = entry as TileEntry;
    if (previous && byPosition(previous, typed) > 0) return "Tiles must be sorted by y, then x.";
    previous = typed;
  }
  return { v: 1, format, tile: m.tile, fill: m.fill, tiles: m.tiles as TileEntry[] };
}

/** The hashes of the stored tiles a manifest needs (constant tiles need none). */
export const tileHashes = (manifest: SurfaceManifest) => manifest.tiles.map((e) => e[2]).filter(isHash);

/**
 * JSON with object keys sorted and no whitespace: the bytes a manifest's hash is taken over, so the same
 * manifest always has the same id whoever wrote it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter((k) => object[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(object[k])}`).join(",")}}`;
}

/** Every surface a document names (pixel layers' pixels and masks), once each: what a save needs the server to have. */
export function documentSurfaces(doc: PhotoProject): SurfaceId[] {
  const ids = new Set<SurfaceId>();
  for (const l of doc.layers) {
    if (l.kind === "pixel" && l.surface) ids.add(l.surface);
    if (l.mask?.surface) ids.add(l.mask.surface);
  }
  return [...ids];
}
