/**
 * The content-addressed blob store (docs/photo/architecture.md, "Resources"): tiles by the SHA-256 of their raw
 * samples, manifests by the SHA-256 of their canonical JSON. Everything sent is verified (the hash, a manifest's
 * shape and that its tiles exist), written to a temporary file, flushed and renamed, so a blob is whole or absent.
 * Writing one that exists is a no-op that succeeds: retries and duplicates are harmless by construction.
 * Tiles are kept deflated; their identity doesn't depend on it.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { type SurfaceManifest, canonicalJson, isHash, tileHashes, validateManifest } from "../../shared/photo/surfaces.ts";
import { HttpError } from "../storage.ts";

const deflate = promisify(zlib.deflateRaw);
const inflate = promisify(zlib.inflateRaw);

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Largest tile: 512² × RGBA f32. */
export const MAX_TILE_BYTES = 512 * 512 * 16;

export class BlobStore {
  constructor(readonly root: string) {}

  private tilePath(hash: string) {
    return path.join(this.root, "tiles", hash.slice(0, 2), hash);
  }

  private manifestPath(hash: string) {
    return path.join(this.root, "manifests", hash.slice(0, 2), `${hash}.json`);
  }

  private static checkHash(hash: string) {
    if (!isHash(hash)) throw new HttpError(400, "A blob is named by its SHA-256, in lowercase hex.");
  }

  async hasTile(hash: string): Promise<boolean> {
    return exists(this.tilePath(hash));
  }

  /** Stores a tile's raw samples under their hash. Returns false when it was already there. */
  async putTile(hash: string, samples: Uint8Array): Promise<boolean> {
    BlobStore.checkHash(hash);
    if (samples.length === 0 || samples.length > MAX_TILE_BYTES) throw new HttpError(400, `A tile is 1 to ${MAX_TILE_BYTES} bytes.`);
    const actual = sha256(samples);
    if (actual !== hash) throw new HttpError(400, `The tile's samples hash to ${actual}, not ${hash}.`);
    const file = this.tilePath(hash);
    if (await exists(file)) return false;
    await writeDurably(file, await deflate(samples, { level: 1 }));
    return true;
  }

  async getTile(hash: string): Promise<Buffer> {
    BlobStore.checkHash(hash);
    try {
      return await inflate(await fs.readFile(this.tilePath(hash)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `No tile ${hash}.`);
      throw error;
    }
  }

  /**
   * Stores a manifest under its hash, after checking its shape, that `hash` is its canonical JSON's, and that
   * every tile it lists is here (so a saved document can't reference pixels the store doesn't have).
   */
  async putManifest(hash: string, value: unknown): Promise<boolean> {
    BlobStore.checkHash(hash);
    const manifest = validateManifest(value);
    if (typeof manifest === "string") throw new HttpError(400, manifest);
    const text = canonicalJson(manifest);
    const actual = sha256(text);
    if (actual !== hash) throw new HttpError(400, `The manifest's canonical JSON hashes to ${actual}, not ${hash}.`);
    const missing = [];
    for (const tile of tileHashes(manifest)) if (!(await this.hasTile(tile))) missing.push(tile);
    if (missing.length) throw new HttpError(409, `Upload these tiles first: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}.`);
    const file = this.manifestPath(hash);
    if (await exists(file)) return false;
    await writeDurably(file, Buffer.from(text));
    return true;
  }

  async getManifest(hash: string): Promise<SurfaceManifest> {
    BlobStore.checkHash(hash);
    try {
      return JSON.parse(await fs.readFile(this.manifestPath(hash), "utf8")) as SurfaceManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `No manifest ${hash}.`);
      throw error;
    }
  }
}

async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Written to a temporary file, flushed, then renamed into place: whole or absent, even after a crash. */
export async function writeDurably(file: string, data: Uint8Array) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}
