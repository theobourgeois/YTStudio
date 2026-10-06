/**
 * The content-addressed blob store (docs/photo/architecture.md, "Resources"): tiles by the SHA-256 of their raw
 * samples, manifests by the SHA-256 of their canonical JSON. Everything sent is verified (the hash, a manifest's
 * shape and that its tiles exist), written to a temporary file, flushed and renamed, its folder flushed, so a blob
 * is whole or absent and there once it's acknowledged. Writing one that exists is a no-op that succeeds: retries and
 * duplicates are harmless by construction (one damaged on disk is written again). Tiles are kept deflated; their
 * identity doesn't depend on it. What's read is checked against its name: damage is reported, never served.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { type SurfaceManifest, canonicalJson, isHash, tileHashes, validateManifest } from "../../shared/photo/surfaces.ts";
import { HttpError, writeFileDurably } from "../storage.ts";

const deflate = promisify(zlib.deflateRaw);
const inflate = promisify(zlib.inflateRaw);

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Largest tile: 512² × RGBA f32. */
export const MAX_TILE_BYTES = 512 * 512 * 16;

/** Why a surface can't be drawn from the package: its manifest is missing or damaged, or tiles it lists are. */
export interface IncompleteSurface {
  id: string;
  reason: string;
}

/** A blob's file is there but isn't what its name says (changed outside the app, a failing disk). */
const damaged = (what: string, hash: string) => new HttpError(500, `The ${what} ${hash} is damaged in the project's package.`);

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
    if (await exists(file)) {
      const kept = await this.getTile(hash).catch(() => null);
      if (kept) return false;
    }
    await writeFileDurably(file, await deflate(samples, { level: 1 }));
    return true;
  }

  /** A tile's samples, checked against its hash (404 if it isn't here, 500 if it's damaged). */
  async getTile(hash: string): Promise<Buffer> {
    BlobStore.checkHash(hash);
    let stored: Buffer;
    try {
      stored = await fs.readFile(this.tilePath(hash));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `No tile ${hash}.`);
      throw error;
    }
    const samples = await inflate(stored).catch(() => null);
    if (!samples || sha256(samples) !== hash) throw damaged("tile", hash);
    return samples;
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
    if ((await fs.readFile(file, "utf8").catch(() => null)) === text) return false;
    await writeFileDurably(file, text);
    return true;
  }

  async hasManifest(hash: string): Promise<boolean> {
    return isHash(hash) && exists(this.manifestPath(hash));
  }

  /**
   * Which of `surfaces` (manifest ids) can't be drawn from the package: the check on opening a photo. A manifest
   * must be here, whole and valid, and every tile it lists here (tiles aren't read: that's what drawing does, and a
   * damaged one is refused then).
   */
  async inspect(surfaces: readonly string[]): Promise<IncompleteSurface[]> {
    const incomplete: IncompleteSurface[] = [];
    for (const id of new Set(surfaces)) {
      let manifest: SurfaceManifest;
      try {
        manifest = await this.getManifest(id);
      } catch (error) {
        incomplete.push({ id, reason: error instanceof HttpError && error.status === 404 ? "its manifest is missing" : "its manifest is damaged" });
        continue;
      }
      let missing = 0;
      for (const tile of new Set(tileHashes(manifest))) if (!(await this.hasTile(tile))) missing++;
      if (missing) incomplete.push({ id, reason: `${missing} of its tiles ${missing === 1 ? "is" : "are"} missing` });
    }
    return incomplete;
  }

  /**
   * Deletes every blob nothing reachable from `roots` (manifest ids) needs: what's left after edits that were undone
   * or overwritten (docs/photo/architecture.md, "Garbage"). Marks first, then deletes, so a crash midway loses
   * nothing reachable; a root that's missing keeps nothing (and is reported). Blobs written since `since` (ms) are
   * kept whatever they are: they may be an upload in progress whose document hasn't been saved yet. Temporary files
   * from before `since` are what interrupted writes left: they go too.
   */
  async collect(roots: readonly string[], since = Date.now()): Promise<{ tiles: number; manifests: number; missing: string[] }> {
    const manifests = new Set<string>();
    const tiles = new Set<string>();
    const missing: string[] = [];
    for (const root of roots) {
      if (!isHash(root) || manifests.has(root)) continue;
      try {
        const manifest = await this.getManifest(root);
        manifests.add(root);
        for (const tile of tileHashes(manifest)) tiles.add(tile);
      } catch {
        missing.push(root);
      }
    }
    const sweep = async (kind: "tiles" | "manifests", keep: Set<string>) => {
      let deleted = 0;
      const dir = path.join(this.root, kind);
      for (const shard of await list(dir)) {
        for (const name of await list(path.join(dir, shard))) {
          const hash = name.replace(/\.json$/, "");
          if (keep.has(hash) && !name.endsWith(".tmp")) continue;
          const file = path.join(dir, shard, name);
          const stat = await fs.stat(file).catch(() => null);
          if (!stat || stat.mtimeMs >= since) continue;
          await fs.rm(file, { force: true });
          deleted++;
        }
      }
      return deleted;
    };
    return { manifests: await sweep("manifests", manifests), tiles: await sweep("tiles", tiles), missing };
  }

  /** A manifest, checked against its hash (404 if it isn't here, 500 if it's damaged). */
  async getManifest(hash: string): Promise<SurfaceManifest> {
    BlobStore.checkHash(hash);
    let text: string;
    try {
      text = await fs.readFile(this.manifestPath(hash), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `No manifest ${hash}.`);
      throw error;
    }
    let manifest: SurfaceManifest | string;
    try {
      manifest = validateManifest(JSON.parse(text));
    } catch {
      throw damaged("manifest", hash);
    }
    if (typeof manifest === "string" || sha256(canonicalJson(manifest)) !== hash) throw damaged("manifest", hash);
    return manifest;
  }
}

async function list(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
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
