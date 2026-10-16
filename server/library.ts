import type { Readable } from "node:stream";
import { canMoveFolder, folderSubtree, itemMediaIds, normalizeTemplate, remapTemplateAssets } from "../shared/library.ts";
import { createId } from "../shared/timeline.ts";
import type {
  ClipTemplate,
  Library,
  LibraryEntry,
  LibraryFolder,
  LibraryClipsItem,
  LibraryItem,
  LibraryMediaItem,
  MediaAsset,
  UseLibraryItemResponse,
} from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import type { WebMediaLibrary } from "./web-media.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, isObject, isValidId, parseName, readJson, writeJson } from "./storage.ts";
import { log } from "./log.ts";

const logger = log("library");

/** `data/library/library.json`. */
interface LibraryFile {
  version: 1;
  folders: LibraryFolder[];
  items: LibraryItem[];
}

type Generated = "id" | "createdAt" | "usedAt" | "favorite";
/** What a new item is made of; the rest is filled in when it's added. */
type NewItem = Omit<LibraryMediaItem, Generated> | Omit<LibraryClipsItem, Generated>;

/** An optional folder id from a request: undefined when absent, null for the top level. */
function parseFolderId(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (!isValidId(raw)) throw new HttpError(400, "Invalid folder id");
  return raw;
}

/**
 * The Library shared by every project: folders and items in `library.json`,
 * files in their own `MediaLibrary` (`data/library/media`). Items never point
 * into a project: saving copies the media in, and using an item copies its
 * media into the project (reusing a copy that's already there).
 */
export class LibraryStore {
  private folders = new Map<string, LibraryFolder>();
  private items = new Map<string, LibraryItem>();
  /** Library media that requests in flight rely on, so a deletion meanwhile doesn't collect it. */
  private held = new Map<string, number>();
  private writes = createLimiter(1);

  constructor(
    private paths: DataPaths,
    /** The Library's own files. */
    private media: MediaLibrary,
    /** Every project's media. */
    private projectMedia: MediaLibrary,
    private projectExists: (id: string) => boolean,
  ) {}

  /** Load the Library, dropping anything invalid and files no item uses, then resume processing. */
  async load(): Promise<void> {
    await this.media.load();
    const saved = await readJson<Partial<LibraryFile>>(this.paths.libraryFile);
    for (const f of Array.isArray(saved?.folders) ? saved.folders : []) {
      if (!isObject(f) || !isValidId(f.id) || typeof f.name !== "string" || !f.name) continue;
      const parentId = isValidId(f.parentId) ? f.parentId : null;
      this.folders.set(f.id, { id: f.id, name: f.name, parentId, createdAt: Number(f.createdAt) || 0 });
    }
    // A missing parent (or a loop) puts the folder back at the top level.
    for (const f of this.folders.values()) {
      if (f.parentId && (!this.folders.has(f.parentId) || folderSubtree([...this.folders.values()], f.id).has(f.parentId))) {
        f.parentId = null;
      }
    }
    const media = this.media.byId();
    for (const raw of Array.isArray(saved?.items) ? saved.items : []) {
      const item = this.parseItem(raw, media);
      if (item) this.items.set(item.id, item);
    }
    await this.collect(Object.keys(media));
    this.media.resume();
  }

  snapshot(): Library {
    return { folders: [...this.folders.values()], items: [...this.items.values()], media: this.media.list() };
  }

  getMedia(id: string): MediaAsset {
    return this.media.get(id);
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  async createFolder(body: unknown): Promise<LibraryFolder> {
    if (!isObject(body)) throw new HttpError(400, "Expected { name, parentId? }.");
    const parentId = parseFolderId(body.parentId) ?? null;
    this.folder(parentId);
    const folder: LibraryFolder = { id: createId("folder"), name: parseName(body.name), parentId, createdAt: Date.now() };
    this.folders.set(folder.id, folder);
    await this.persist();
    return folder;
  }

  async updateFolder(id: string, body: unknown): Promise<LibraryFolder> {
    const current = this.folder(id)!;
    if (!isObject(body)) throw new HttpError(400, "Expected { name?, parentId? }.");
    const next = { ...current };
    if (body.name !== undefined) next.name = parseName(body.name);
    const parentId = parseFolderId(body.parentId);
    if (parentId !== undefined) {
      this.folder(parentId);
      if (!canMoveFolder([...this.folders.values()], id, parentId)) {
        throw new HttpError(400, "A folder can't go inside itself.");
      }
      next.parentId = parentId;
    }
    this.folders.set(id, next);
    await this.persist();
    return next;
  }

  /** Delete a folder with its subfolders and items. */
  async removeFolder(id: string): Promise<void> {
    this.folder(id);
    const doomed = folderSubtree([...this.folders.values()], id);
    const media: string[] = [];
    for (const item of this.items.values()) {
      if (item.folderId && doomed.has(item.folderId)) {
        this.items.delete(item.id);
        media.push(...itemMediaIds(item));
      }
    }
    for (const folderId of doomed) this.folders.delete(folderId);
    await this.persist();
    await this.collect(media);
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  /** Import an uploaded file into a folder. */
  async upload(body: Readable, rawName: string, rawFolderId: unknown): Promise<LibraryEntry> {
    const folderId = parseFolderId(rawFolderId) ?? null;
    this.folder(folderId);
    const asset = await this.media.ingest(body, rawName, null, () => true);
    return this.addItem({ kind: "media", mediaId: asset.id, name: asset.name, folderId }, [asset]);
  }

  /**
   * A link's video into a folder (the visualizer's clips: docs/now-playing.md, "Your media"), downloaded (`web`); one
   * the Library has from the same link already is that one, put in the folder if it isn't. `most`: only a long video's
   * first so many seconds.
   */
  async addFromWeb(body: unknown, web: WebMediaLibrary): Promise<LibraryEntry> {
    if (!isObject(body)) throw new HttpError(400, "Expected { url, folderId?, title?, most? }.");
    const folderId = parseFolderId(body.folderId) ?? null;
    this.folder(folderId);
    const origin = web.videoOrigin(body.url);
    const known = this.media.list().find((m) => m.origin === origin);
    if (known) {
      const item = [...this.items.values()].find((i) => i.kind === "media" && i.mediaId === known.id && i.folderId === folderId);
      return item ? { item, media: [known] } : this.addItem({ kind: "media", mediaId: known.id, name: known.name, folderId }, [known]);
    }
    const most = typeof body.most === "number" && Number.isFinite(body.most) && body.most > 0 ? Math.min(3600, body.most) : undefined;
    const download = await web.downloadVideo(body.url, { title: body.title, most });
    try {
      const asset = await this.media.add(download.file, download.name, null, () => true, origin);
      return await this.addItem({ kind: "media", mediaId: asset.id, name: asset.name, folderId }, [asset]);
    } finally {
      await download.done();
    }
  }

  /** Add a project's media file to the Library. */
  async addMedia(body: unknown): Promise<LibraryEntry> {
    if (!isObject(body)) throw new HttpError(400, "Expected { assetId, folderId?, name? }.");
    const asset = this.projectMedia.get(String(body.assetId));
    const folderId = parseFolderId(body.folderId) ?? null;
    this.folder(folderId);
    const name = body.name === undefined ? asset.name : parseName(body.name);
    const [copy, release] = await this.libraryCopy(asset);
    try {
      return await this.addItem({ kind: "media", mediaId: copy.id, name, folderId }, [copy]);
    } finally {
      release();
    }
  }

  /** Save timeline clips, with their media, to the Library. */
  async addClips(body: unknown): Promise<LibraryEntry> {
    if (!isObject(body)) throw new HttpError(400, "Expected { projectId, name, folderId?, tracks, clips }.");
    const projectId = String(body.projectId);
    if (!this.projectExists(projectId)) throw new HttpError(404, "Project not found");
    const name = parseName(body.name);
    const folderId = parseFolderId(body.folderId) ?? null;
    this.folder(folderId);
    const input = { tracks: body.tracks, clips: body.clips } as ClipTemplate;
    const template = normalizeTemplate(input, this.projectMedia.byId(projectId));
    if (!template) throw new HttpError(400, "There are no clips to save.");

    const copies = new Map<string, MediaAsset>();
    const releases: (() => void)[] = [];
    try {
      for (const assetId of new Set(template.clips.map((c) => c.assetId).filter(Boolean))) {
        const [copy, release] = await this.libraryCopy(this.projectMedia.get(assetId));
        copies.set(assetId, copy);
        releases.push(release);
      }
      const ids = new Map([...copies].map(([from, copy]) => [from, copy.id]));
      return await this.addItem(
        { kind: "clips", template: remapTemplateAssets(template, ids), name, folderId },
        [...copies.values()],
      );
    } finally {
      for (const release of releases) release();
    }
  }

  async updateItem(id: string, body: unknown): Promise<LibraryItem> {
    const current = this.item(id);
    if (!isObject(body)) throw new HttpError(400, "Expected { name?, folderId?, favorite? }.");
    const next = { ...current };
    if (body.name !== undefined) next.name = parseName(body.name);
    const folderId = parseFolderId(body.folderId);
    if (folderId !== undefined) {
      this.folder(folderId);
      next.folderId = folderId;
    }
    if (body.favorite !== undefined) {
      if (typeof body.favorite !== "boolean") throw new HttpError(400, "favorite must be true or false.");
      next.favorite = body.favorite;
    }
    this.items.set(id, next);
    await this.persist();
    return next;
  }

  /** Delete an item. Projects that used it keep their own copies of its media. */
  async removeItem(id: string): Promise<void> {
    const item = this.item(id);
    this.items.delete(id);
    await this.persist();
    await this.collect(itemMediaIds(item));
  }

  /** Copy an item's media into a project (or find the copies already there), for the client to place. */
  async use(id: string, body: unknown): Promise<UseLibraryItemResponse> {
    const item = this.item(id);
    const projectId = isObject(body) ? String(body.projectId) : "";
    if (!this.projectExists(projectId)) throw new HttpError(404, "Project not found");
    const exists = () => this.projectExists(projectId);
    const release = this.hold(itemMediaIds(item));
    try {
      const assets: MediaAsset[] = [];
      const ids = new Map<string, string>();
      for (const mediaId of itemMediaIds(item)) {
        const source = this.media.get(mediaId);
        const inProject = this.projectMedia.list(projectId);
        let asset = inProject.find((a) => a.origin === source.id || a.id === source.origin);
        if (!asset) {
          const name = item.kind === "media" ? item.name : undefined;
          asset = await this.projectMedia.copyFrom(this.media, source, { projectId, name, exists });
        }
        assets.push(asset);
        ids.set(mediaId, asset.id);
      }
      const used = { ...(this.items.get(id) ?? item), usedAt: Date.now() };
      // Deleted meanwhile: the project still gets what it asked for.
      if (this.items.has(id)) {
        this.items.set(id, used);
        await this.persist();
      }
      const template = item.kind === "clips" ? remapTemplateAssets(item.template, ids) : null;
      return { assets, template, item: used };
    } finally {
      release();
    }
  }

  // -------------------------------------------------------------------------

  /** A folder by id; null is the top level. Throws 404. */
  private folder(id: string | null): LibraryFolder | null {
    if (id === null) return null;
    const folder = this.folders.get(id);
    if (!folder) throw new HttpError(404, "Folder not found");
    return folder;
  }

  private item(id: string): LibraryItem {
    const item = isValidId(id) ? this.items.get(id) : undefined;
    if (!item) throw new HttpError(404, "Library item not found");
    return item;
  }

  private async addItem(
    fields: NewItem,
    media: MediaAsset[],
  ): Promise<LibraryEntry> {
    // The folder may have been deleted while the file was uploading.
    const folderId = fields.folderId && this.folders.has(fields.folderId) ? fields.folderId : null;
    const item = { ...fields, folderId, id: createId("item"), createdAt: Date.now(), usedAt: null, favorite: false } as LibraryItem;
    this.items.set(item.id, item);
    await this.persist();
    return { item, media };
  }

  /**
   * The Library's copy of a project file: the Library media it came from, one
   * added from it before, or a new copy. Held until `release` is called.
   */
  private async libraryCopy(asset: MediaAsset): Promise<[MediaAsset, () => void]> {
    const existing =
      (asset.origin ? this.media.find(asset.origin) : undefined) ?? this.media.list().find((m) => m.origin === asset.id);
    if (existing) return [existing, this.hold([existing.id])];
    const copy = await this.media.copyFrom(this.projectMedia, asset, { projectId: null });
    return [copy, this.hold([copy.id])];
  }

  private hold(ids: string[]): () => void {
    for (const id of ids) this.held.set(id, (this.held.get(id) ?? 0) + 1);
    return () => {
      for (const id of ids) {
        const n = (this.held.get(id) ?? 1) - 1;
        if (n > 0) this.held.set(id, n);
        else this.held.delete(id);
      }
      void this.collect(ids);
    };
  }

  /** Delete these Library files unless an item uses them or a request holds them. */
  private async collect(ids: Iterable<string>): Promise<void> {
    const used = new Set([...this.items.values()].flatMap(itemMediaIds));
    for (const id of new Set(ids)) {
      if (used.has(id) || this.held.has(id) || !this.media.find(id)) continue;
      await this.media.remove(id).catch((err) => logger.warn(`couldn't delete ${id}`, err));
    }
  }

  private parseItem(raw: unknown, media: Record<string, MediaAsset>): LibraryItem | null {
    if (!isObject(raw) || !isValidId(raw.id) || typeof raw.name !== "string" || !raw.name) return null;
    const base = {
      id: raw.id,
      name: raw.name,
      folderId: isValidId(raw.folderId) && this.folders.has(raw.folderId) ? raw.folderId : null,
      createdAt: Number(raw.createdAt) || 0,
      usedAt: typeof raw.usedAt === "number" ? raw.usedAt : null,
      favorite: raw.favorite === true,
    };
    if (raw.kind === "media") {
      return isValidId(raw.mediaId) && media[raw.mediaId] ? { ...base, kind: "media", mediaId: raw.mediaId } : null;
    }
    if (raw.kind === "clips") {
      const template = normalizeTemplate(raw.template as ClipTemplate, media);
      return template ? { ...base, kind: "clips", template } : null;
    }
    return null;
  }

  /** Write the current state (serialised, so the file always ends up with the latest). */
  private persist(): Promise<void> {
    return this.writes(() =>
      writeJson(this.paths.libraryFile, {
        version: 1,
        folders: [...this.folders.values()],
        items: [...this.items.values()],
      } satisfies LibraryFile),
    );
  }
}
