/**
 * The photo lab (F0, docs/photo/foundations-prototype.md): image files uploaded for measuring, their decoded
 * tiles, the blob store and exports, in `data/photo-lab/`. F1 moves each piece into project packages (sources
 * become project media, blobs go in `photo/resources/`, decoded tiles in `photo/cache/`); their formats stay.
 */
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { createHash, randomBytes } from "node:crypto";
import type { CompareResult, ExportRequest, ExportResult, HelperStatus, SourceInfo, SourceLayout, TileSize } from "../../shared/photo/lab.ts";
import { HttpError, readJson, writeJson } from "../storage.ts";
import { BlobStore } from "./blobs.ts";
import { PhotoExports } from "./exports.ts";
import type { PhotoHelper } from "./helper.ts";
import { SourceDecoder } from "./sources.ts";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".avif"]);
const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const EXPORT_NAME = /^[\w.-]{1,80}\.(png|jpe?g)$/;

type ProbeResult = Omit<SourceInfo, "key" | "name" | "bytes">;

export class PhotoLab {
  readonly blobs: BlobStore;
  private sources: SourceInfo[] = [];
  private readonly decoder: SourceDecoder;
  private readonly exports: PhotoExports;

  constructor(
    readonly root: string,
    readonly helper: PhotoHelper,
  ) {
    this.blobs = new BlobStore(path.join(root, "blobs"));
    this.decoder = new SourceDecoder(helper);
    this.exports = new PhotoExports(helper, path.join(root, "exports"));
  }

  private get uploads() {
    return path.join(this.root, "uploads");
  }
  private get cache() {
    return path.join(this.root, "cache");
  }
  private get exportsDir() {
    return path.join(this.root, "exports");
  }
  private get indexFile() {
    return path.join(this.uploads, "index.json");
  }

  async init() {
    for (const dir of [this.uploads, this.cache, this.exportsDir]) await fs.mkdir(dir, { recursive: true });
    this.sources = (await readJson<SourceInfo[]>(this.indexFile)) ?? [];
  }

  list(): SourceInfo[] {
    return this.sources;
  }

  private find(key: string): SourceInfo {
    const source = this.sources.find((s) => s.key === key);
    if (!source) throw new HttpError(404, `No source ${key}: upload it first (POST /api/photo/lab/sources).`);
    return source;
  }

  private sourceFile(source: Pick<SourceInfo, "key" | "name">) {
    return path.join(this.uploads, `${source.key}${path.extname(source.name).toLowerCase()}`);
  }

  /** Stores an uploaded image file (once per content) and probes it. */
  async addSource(body: Readable, name: string): Promise<SourceInfo> {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) throw new HttpError(415, `Use one of ${[...IMAGE_EXTENSIONS].join(", ")}.`);
    const tmp = path.join(this.uploads, `upload-${randomBytes(6).toString("hex")}.tmp`);
    const hash = createHash("sha256");
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) return done(new HttpError(413, "That file is over 2 GB."));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(tmp));
      const key = hash.digest("hex");
      const existing = this.sources.find((s) => s.key === key);
      if (existing) return existing;
      const file = this.sourceFile({ key, name });
      await fs.rename(tmp, file);
      let probed: ProbeResult;
      try {
        probed = await this.helper.request<ProbeResult>("probe", { file });
      } catch (error) {
        await fs.rm(file, { force: true });
        throw new HttpError(415, `Couldn't read ${name}: ${(error as Error).message}`);
      }
      const source: SourceInfo = { ...probed, key, name, bytes };
      this.sources = [source, ...this.sources];
      await writeJson(this.indexFile, this.sources);
      return source;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private cacheBase(key: string, tile: TileSize) {
    return this.decoder.base(this.cache, key, tile);
  }

  /** The source decoded into tiles of `tile` (once per source, tile size and decoder version). */
  async layout(key: string, tile: TileSize): Promise<SourceLayout> {
    const source = this.find(key);
    return this.decoder.layout(this.sourceFile(source), await this.cacheBase(key, tile), key, tile);
  }

  async rawFile(key: string, tile: TileSize): Promise<string> {
    await this.layout(key, tile);
    return `${await this.cacheBase(key, tile)}.raw`;
  }

  async previewFile(key: string, tile: TileSize): Promise<string> {
    await this.layout(key, tile);
    return `${await this.cacheBase(key, tile)}.preview`;
  }

  /** Forgets every decoded source, so the next open measures a cold decode (the lab's bench). */
  async clearCache() {
    await fs.rm(this.cache, { recursive: true, force: true });
    await fs.mkdir(this.cache, { recursive: true });
  }

  /** Starts an export into `exports/<name>`: rows follow in bands (`exportRows`), then `finishExport` encodes. */
  async beginExport(request: ExportRequest): Promise<string> {
    if (!EXPORT_NAME.test(request.name)) throw new HttpError(400, "Name the export like name.png or name.jpg (letters, digits, - _ .).");
    return this.exports.begin(request, { destination: path.join(this.exportsDir, request.name) });
  }

  exportRows(id: string, from: number, samples: Buffer) {
    return this.exports.rows(id, from, samples);
  }

  async finishExport(id: string): Promise<ExportResult> {
    const { path: _path, ...result } = await this.exports.finish(id);
    return result;
  }

  cancelExport(id: string) {
    return this.exports.cancel(id);
  }

  /** An export's samples against a source's, both decoded by the helper the same way. */
  async compare(exportName: string, key: string): Promise<CompareResult> {
    if (!EXPORT_NAME.test(exportName)) throw new HttpError(400, "Unknown export name.");
    const source = this.find(key);
    return this.helper.request<CompareResult>("compare", { a: path.join(this.exportsDir, exportName), b: this.sourceFile(source) });
  }

  exportStream(name: string) {
    if (!EXPORT_NAME.test(name)) throw new HttpError(400, "Unknown export name.");
    return createReadStream(path.join(this.exportsDir, name));
  }

  async helperStatus(): Promise<HelperStatus> {
    let decoder: string | null = null;
    try {
      decoder = await this.helper.decoder();
    } catch {
      // not running, and couldn't start
    }
    return { running: this.helper.isRunning, decoder, restarts: this.helper.restarts };
  }
}
