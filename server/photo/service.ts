/**
 * The photo suite on the server (`/api/photo`): a project's images decoded into tiles in its package's
 * `photo/cache/sources/` (rebuildable, never copied with the package), and exports the tab renders in bands. The
 * suite doesn't reach into the platform's stores: app.ts hands it what it needs (a project's folder, an image's
 * file).
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { CompareResult, ExportRequest, SourceLayout, TileSize } from "../../shared/photo/lab.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { HttpError } from "../storage.ts";
import { BlobStore } from "./blobs.ts";
import { PhotoExports } from "./exports.ts";
import type { PhotoHelper } from "./helper.ts";
import { SourceDecoder } from "./sources.ts";

export interface PhotoServiceOptions {
  /** A project's package folder (throws for a project that isn't there). */
  projectDir(projectId: string): string;
  /** The file of one of a project's images, or null when it isn't one of them. */
  sourcePath(projectId: string, mediaId: string): string | null;
  /** Where exports with no destination wait to be downloaded. */
  exportsFolder: string;
  /** Moves an image file into a project's media (merged layers become the project's images this way). */
  adoptImage(projectId: string, file: string, name: string): Promise<MediaAsset>;
}

export interface ExportStart extends ExportRequest {
  projectId: string;
  /** An absolute path from the desktop app's save dialog; otherwise the file is kept to download. */
  destination?: string | null;
}

export class PhotoService {
  readonly exports: PhotoExports;
  private readonly decoder: SourceDecoder;

  constructor(
    readonly helper: PhotoHelper,
    private readonly options: PhotoServiceOptions,
  ) {
    this.decoder = new SourceDecoder(helper);
    this.exports = new PhotoExports(helper, options.exportsFolder);
  }

  private source(projectId: string, mediaId: string): string {
    const file = this.options.sourcePath(projectId, mediaId);
    if (!file) throw new HttpError(404, `The project has no image ${mediaId}.`);
    if (!existsSync(file)) throw new HttpError(404, `The image ${path.basename(file)} is missing from the project's package (media/${mediaId}): its layer shows as missing until the file is put back.`);
    return file;
  }

  private async base(projectId: string, mediaId: string, tile: TileSize) {
    const folder = path.join(this.options.projectDir(projectId), "photo", "cache", "sources");
    await fs.mkdir(folder, { recursive: true });
    return this.decoder.base(folder, mediaId, tile);
  }

  /** One of the project's images, decoded into tiles (once per image, tile size and decoder). */
  async layout(projectId: string, mediaId: string, tile: TileSize): Promise<SourceLayout> {
    const file = this.source(projectId, mediaId);
    try {
      return await this.decoder.layout(file, await this.base(projectId, mediaId, tile), mediaId, tile);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, `Couldn't decode that image: ${(error as Error).message}`);
    }
  }

  async rawFile(projectId: string, mediaId: string, tile: TileSize) {
    await this.layout(projectId, mediaId, tile);
    return `${await this.base(projectId, mediaId, tile)}.raw`;
  }

  async previewFile(projectId: string, mediaId: string, tile: TileSize) {
    await this.layout(projectId, mediaId, tile);
    return `${await this.base(projectId, mediaId, tile)}.preview`;
  }

  /** A project's pixels: its surfaces' tiles and manifests, in its package (`photo/resources`). */
  blobs(projectId: string): BlobStore {
    return new BlobStore(resourcesOf(this.options.projectDir(projectId)));
  }

  beginExport(start: ExportStart): Promise<string> {
    this.options.projectDir(start.projectId);
    const { projectId, destination, ...request } = start;
    return this.exports.begin(request, { destination, owner: projectId });
  }

  /**
   * A finished export kept to download, made one of its project's images instead (a merge's render): the file
   * moves into the project's media.
   */
  async adoptExport(exportId: string, projectId: string): Promise<MediaAsset> {
    const done = this.exports.file(exportId);
    if (done.owner !== projectId) throw new HttpError(404, "No such export for this project.");
    const asset = await this.options.adoptImage(projectId, done.file, done.name);
    this.exports.forget(exportId);
    return asset;
  }

  /** A finished export's samples against one of the project's images (decoded the same way): the round-trip check. */
  compare(exportId: string, projectId: string, mediaId: string): Promise<CompareResult> {
    const done = this.exports.file(exportId);
    if (done.owner !== projectId) throw new HttpError(404, "No such export for this project.");
    return this.helper.request<CompareResult>("compare", { a: done.file, b: this.source(projectId, mediaId) });
  }
}

/** Where a package keeps its authored pixels (never rebuildable, copied with the package). */
export const resourcesOf = (packageDir: string) => path.join(packageDir, "photo", "resources");
