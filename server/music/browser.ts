/**
 * The Browser's folders on the server (`docs/fl-studio/browser.md`): the folders the user added and their
 * favourites, the same for every project (`data/browser.json`), what's in a folder, and an index of every
 * audio file and folder under them for the search, kept up to date by watching the folders.
 *
 * Folders are referenced where they are, never copied. Every path asked about must be inside one of them:
 * this is how the tab reads the user's disk, so it reads nothing else.
 */
import { type FSWatcher, watch } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type BrowserItem,
  type BrowserRoot,
  type BrowserSearchResult,
  type BrowserState,
  type SearchEntry,
  isAudioName,
  searchEntries,
  searchEntry,
  sortItems,
} from "../../shared/music/browser.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { run } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId, readJson, writeJson } from "../storage.ts";

/** What's saved: only the user's choices. The index is made again at startup. */
interface SavedBrowser {
  roots: string[];
  favourites: string[];
}

/** No more than this many entries per folder added (a whole drive, by mistake, stops here). */
const MAX_ENTRIES = 500_000;
/** Changes in a folder are taken in once they've stopped for this long (a pack being unzipped). */
const RESCAN_DELAY_MS = 400;
const MAX_FAVOURITES = 5000;

/** Hidden files and folders, and what's inside a package (an app, a plugin): never a sample. */
const skipped = (name: string) => name.startsWith(".") || /\.(app|vst3|component|bundle|logicx)$/i.test(name);

interface IndexedRoot {
  entries: SearchEntry[];
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Bumped by every scan, so a slow one finishing after a newer one is dropped. */
  generation: number;
  scanning: boolean;
  missing: boolean;
}

/**
 * A project's media, as the Browser needs it (the app wires it to the projects' media library: this
 * suite doesn't import the video editor's).
 */
export interface BrowserMedia {
  /** Whether the project exists. */
  hasProject(projectId: string): boolean;
  /** The project's media copied from this origin, if it has one. */
  find(projectId: string, origin: string): MediaAsset | undefined;
  /** Copy a file into the project's media, remembering where it came from. */
  importFile(file: string, projectId: string, origin: string): Promise<MediaAsset>;
  /** An online clip's sound, downloaded (once) for the Online tab: where it is. */
  webAudio(url: unknown): Promise<string>;
  /** An online clip's sound in the project's media (the copy it has, if it has one). */
  importWeb(projectId: unknown, url: unknown, title: unknown): Promise<MediaAsset>;
}

export interface SampleBrowserOptions {
  /** Watch the folders for changes (default: true). */
  watch?: boolean;
}

export class SampleBrowser {
  private roots: string[] = [];
  private favourites: string[] = [];
  private index = new Map<string, IndexedRoot>();
  /** One save at a time, in order. */
  private saving: Promise<void> = Promise.resolve();
  private file: string;
  private watching: boolean;

  constructor(paths: DataPaths, options: SampleBrowserOptions = {}) {
    this.file = paths.browserFile;
    this.watching = options.watch ?? true;
  }

  async load(): Promise<void> {
    const saved = await readJson<unknown>(this.file);
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && path.isAbsolute(s)) : []);
    if (isObject(saved)) {
      this.roots = [...new Set(strings(saved.roots).map((p) => path.resolve(p)))];
      this.favourites = [...new Set(strings(saved.favourites).map((p) => path.resolve(p)))].slice(0, MAX_FAVOURITES);
    }
    for (const root of this.roots) this.startIndexing(root);
  }

  /** Stop watching (the server is shutting down, or a test is done). */
  close(): void {
    for (const root of this.index.values()) {
      root.watcher?.close();
      if (root.timer) clearTimeout(root.timer);
    }
    this.index.clear();
  }

  state(): BrowserState {
    const roots: BrowserRoot[] = this.roots.map((p) => ({ path: p, name: path.basename(p) || p, missing: this.index.get(p)?.missing ?? false }));
    let indexed = 0;
    let indexing = false;
    for (const root of this.index.values()) {
      indexed += root.entries.length;
      indexing ||= root.scanning;
    }
    return { roots, favourites: [...this.favourites], indexed, indexing };
  }

  /** Resolves once every folder has been read (tests, and the assistant's first search). */
  async ready(): Promise<void> {
    while ([...this.index.values()].some((r) => r.scanning || r.timer)) await new Promise((r) => setTimeout(r, 20));
  }

  // --- Folders ---------------------------------------------------------------------------------------

  async addRoot(raw: unknown): Promise<BrowserState> {
    // "~/Music/Samples", as people (and the assistant) write it.
    const folder = this.absolute(typeof raw === "string" ? raw.trim().replace(/^~(?=$|\/)/, os.homedir()) : raw);
    const stat = await fs.stat(folder).catch(() => null);
    if (!stat?.isDirectory()) throw new HttpError(400, `"${folder}" isn't a folder.`);
    if (path.dirname(folder) === folder) throw new HttpError(400, "A whole drive is too big to add: add the folders with your samples in them.");
    const inside = this.rootOf(folder);
    if (inside) throw new HttpError(409, `"${path.basename(folder)}" is already in the Browser, inside "${path.basename(inside)}".`);
    // A folder holding folders already added takes their place.
    for (const root of this.roots.filter((r) => isInside(r, folder))) this.dropRoot(root);
    this.roots.push(folder);
    this.startIndexing(folder);
    await this.save();
    return this.state();
  }

  async removeRoot(raw: unknown): Promise<BrowserState> {
    const folder = this.absolute(raw);
    if (!this.roots.includes(folder)) throw new HttpError(404, "That folder isn't in the Browser.");
    this.dropRoot(folder);
    this.favourites = this.favourites.filter((f) => !isInside(f, folder));
    await this.save();
    return this.state();
  }

  async setFavourite(rawPath: unknown, favourite: unknown): Promise<BrowserState> {
    if (typeof favourite !== "boolean") throw new HttpError(400, "favourite must be true or false.");
    const target = this.inRoots(rawPath);
    const has = this.favourites.includes(target);
    if (favourite && !has) {
      if (this.favourites.length >= MAX_FAVOURITES) throw new HttpError(400, "There are too many favourites: unstar some first.");
      this.favourites.push(target);
    } else if (!favourite && has) {
      this.favourites = this.favourites.filter((f) => f !== target);
    } else {
      return this.state();
    }
    await this.save();
    return this.state();
  }

  /** Read every folder again now (Ctrl+R), rather than waiting for the watcher. */
  async rescan(): Promise<BrowserState> {
    for (const root of this.roots) this.startIndexing(root);
    await this.ready();
    return this.state();
  }

  // --- Reading ---------------------------------------------------------------------------------------

  /** A folder's subfolders and audio files, folders first, in Finder's order. */
  async list(rawPath: unknown): Promise<BrowserItem[]> {
    const folder = this.inRoots(rawPath);
    const dirents = await fs.readdir(folder, { withFileTypes: true }).catch(() => {
      throw new HttpError(404, `"${path.basename(folder)}" can't be read (was it moved?).`);
    });
    const items: BrowserItem[] = [];
    for (const d of dirents) {
      if (skipped(d.name)) continue;
      const kind = await kindOf(folder, d);
      if (kind) items.push({ path: path.join(folder, d.name), name: d.name, kind });
    }
    return sortItems(items);
  }

  search(query: unknown, limit?: unknown): BrowserSearchResult {
    if (typeof query !== "string") throw new HttpError(400, "q must be a string.");
    const max = Number(limit);
    const all: SearchEntry[] = [];
    for (const root of this.roots) for (const e of this.index.get(root)?.entries ?? []) all.push(e);
    return searchEntries(all, query.slice(0, 200), {
      limit: Number.isFinite(max) && max > 0 ? Math.min(max, 2000) : 200,
      favourites: new Set(this.favourites),
    });
  }

  /** The absolute path of an audio file in the Browser's folders (to send it, or play it). */
  async audioFile(rawPath: unknown): Promise<string> {
    const file = this.inRoots(rawPath);
    if (!isAudioName(file)) throw new HttpError(400, `"${path.basename(file)}" isn't an audio file.`);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new HttpError(404, `"${path.basename(file)}" isn't there any more.`);
    return file;
  }

  /**
   * One of the Browser's audio files as a project's media: the copy made last time if the file hasn't
   * changed since (so trying samples one after another doesn't copy one twice), else a new copy.
   */
  async use(projectId: unknown, rawPath: unknown, media: BrowserMedia): Promise<MediaAsset> {
    if (!isValidId(projectId) || !media.hasProject(projectId)) throw new HttpError(404, "Project not found");
    const file = await this.audioFile(rawPath);
    const stat = await fs.stat(file);
    const origin = `file:${file}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    return media.find(projectId, origin) ?? (await media.importFile(file, projectId, origin));
  }

  /** Show a file or folder of the Browser's in Finder (Explorer, or the file manager), selected. */
  async reveal(rawPath: unknown): Promise<void> {
    const target = this.inRoots(rawPath);
    if (process.platform === "darwin") await run("open", ["-R", target]);
    else if (process.platform === "win32") await run("explorer", [`/select,${target}`]).catch(() => {});
    else await run("xdg-open", [path.dirname(target)]);
  }

  // --- Inside ----------------------------------------------------------------------------------------

  private absolute(raw: unknown): string {
    if (typeof raw !== "string" || !path.isAbsolute(raw)) throw new HttpError(400, "path must be an absolute path.");
    return path.resolve(raw);
  }

  /** `raw` as an absolute path, refused unless it's one of the folders or inside one. */
  private inRoots(raw: unknown): string {
    const p = this.absolute(raw);
    if (!this.rootOf(p)) throw new HttpError(403, "That isn't in one of the Browser's folders.");
    return p;
  }

  private rootOf(p: string): string | undefined {
    return this.roots.find((root) => isInside(p, root));
  }

  private dropRoot(folder: string): void {
    this.roots = this.roots.filter((r) => r !== folder);
    const indexed = this.index.get(folder);
    indexed?.watcher?.close();
    if (indexed?.timer) clearTimeout(indexed.timer);
    this.index.delete(folder);
  }

  private save(): Promise<void> {
    const data: SavedBrowser = { roots: this.roots, favourites: this.favourites };
    this.saving = this.saving.catch(() => {}).then(() => writeJson(this.file, data));
    return this.saving;
  }

  private startIndexing(root: string): void {
    let indexed = this.index.get(root);
    if (!indexed) {
      indexed = { entries: [], watcher: null, timer: null, generation: 0, scanning: false, missing: false };
      this.index.set(root, indexed);
    }
    if (this.watching && !indexed.watcher) {
      try {
        const target = indexed;
        target.watcher = watch(root, { recursive: true }, () => this.scheduleScan(root, target));
        target.watcher.on("error", () => {
          target.watcher?.close();
          target.watcher = null;
        });
      } catch {
        // Missing, or not watchable: Ctrl+R still reads it.
      }
    }
    void this.scan(root, indexed);
  }

  private scheduleScan(root: string, indexed: IndexedRoot): void {
    if (this.index.get(root) !== indexed) return;
    if (indexed.timer) clearTimeout(indexed.timer);
    indexed.timer = setTimeout(() => {
      indexed.timer = null;
      void this.scan(root, indexed);
    }, RESCAN_DELAY_MS);
  }

  private async scan(root: string, indexed: IndexedRoot): Promise<void> {
    const generation = ++indexed.generation;
    indexed.scanning = true;
    try {
      const entries = await walk(root);
      if (indexed.generation !== generation) return;
      indexed.entries = entries ?? [];
      indexed.missing = entries === null;
    } finally {
      if (indexed.generation === generation) indexed.scanning = false;
    }
  }
}

function isInside(p: string, folder: string): boolean {
  return p === folder || p.startsWith(folder.endsWith(path.sep) ? folder : folder + path.sep);
}

/** A folder, an audio file, or nothing to show. Links are followed to see which. */
async function kindOf(folder: string, d: { name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }) {
  if (d.isDirectory()) return "folder" as const;
  if (d.isFile()) return isAudioName(d.name) ? ("file" as const) : null;
  if (d.isSymbolicLink()) {
    const stat = await fs.stat(path.join(folder, d.name)).catch(() => null);
    if (stat?.isDirectory()) return "folder" as const;
    if (stat?.isFile() && isAudioName(d.name)) return "file" as const;
  }
  return null;
}

/**
 * Every folder and audio file under `root`, ready to search (null when it can't be read). Breadth
 * first, one folder at a time, so a big library doesn't open thousands of files at once. Links to
 * folders aren't followed (they could loop).
 */
async function walk(root: string): Promise<SearchEntry[] | null> {
  const rootName = path.basename(root) || root;
  const entries: SearchEntry[] = [];
  const queue: { dir: string; folder: string }[] = [{ dir: root, folder: rootName }];
  let first = true;
  while (queue.length && entries.length < MAX_ENTRIES) {
    const { dir, folder } = queue.shift()!;
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      if (first) return null;
      continue;
    }
    first = false;
    for (const d of dirents) {
      if (skipped(d.name)) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        entries.push(searchEntry({ path: full, name: d.name, kind: "folder" }, folder));
        queue.push({ dir: full, folder: `${folder}/${d.name}` });
      } else if ((d.isFile() || d.isSymbolicLink()) && isAudioName(d.name)) {
        entries.push(searchEntry({ path: full, name: d.name, kind: "file" }, folder));
      }
    }
  }
  return entries;
}
