/**
 * The photo lab's HTTP contract (`/api/photo/lab`): F0's development page, where the renderer, the helper
 * process and the blob store are measured before the photo suite exists (docs/photo/foundations-prototype.md).
 * Sources, layouts and blobs keep these shapes when F1 moves them into project packages.
 */

/** Edge length of a tile in pixels: the two sizes F0 compares. */
export type TileSize = 256 | 512;
export const TILE_SIZES: readonly TileSize[] = [256, 512];

/** An image file the lab has, identified by the SHA-256 of its bytes. */
export interface SourceInfo {
  key: string;
  name: string;
  /** Upright size: EXIF orientation already applied. */
  width: number;
  height: number;
  /** Bits per sample the file stores (what's decoded and sent to the page). */
  bits: 8 | 16;
  hasAlpha: boolean;
  format: string;
  /** EXIF orientation of the file (1 = none); the decoded pixels are upright whatever it is. */
  orientation: number;
  /** The embedded ICC profile, base64, or null when the file has none (sRGB is assumed then). */
  icc: string | null;
  bytes: number;
}

/**
 * A source decoded into a tile-major raw file: tile (tx, ty) is at byte `(ty * tilesX + tx) * tileBytes`,
 * each a `tile`×`tile` block of RGBA samples at `bits` (little-endian for 16), rows top to bottom,
 * edge tiles padded with zeros. The samples are the file's own, not colour-converted.
 */
export interface SourceLayout {
  key: string;
  /** The decoder that made it: part of the cache's identity, so a new one decodes again. */
  decoder: string;
  width: number;
  height: number;
  bits: 8 | 16;
  hasAlpha: boolean;
  tile: TileSize;
  tilesX: number;
  tilesY: number;
  /** Bytes per tile in the raw file. */
  tileBytes: number;
  icc: string | null;
  /** A small sRGB picture (RGBA8, sharp's own conversion: coarse and clipped) shown until tiles arrive. */
  preview: { width: number; height: number };
  /** How long the helper took to decode (0 when it came from the cache). */
  decodeMs: number;
}

export interface ExportRequest {
  name: string;
  width: number;
  height: number;
  bits: 8 | 16;
  format: "png" | "jpeg";
  quality?: number;
}

export interface ExportResult {
  name: string;
  bytes: number;
  encodeMs: number;
}

/** Two images' samples compared after decoding both the same way. */
export interface CompareResult {
  width: number;
  height: number;
  /** Samples (not pixels) that differ where either image has some alpha. */
  differing: number;
  maxDifference: number;
  /** Colour samples that differ under pixels transparent in both (premultiplied light keeps no colour there). */
  underTransparent: number;
}

export interface HelperStatus {
  running: boolean;
  decoder: string | null;
  restarts: number;
}
