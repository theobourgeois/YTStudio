import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createId } from "../shared/ids.ts";
import { DEFAULT_PROJECT_NAME, DEFAULT_SUITE, type SuiteDocument, type SuiteId, isSuiteId, suiteNoun } from "../shared/suites.ts";
import type { MediaAsset, ProjectLocation, ProjectSummary, ProjectTemplates } from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import { PROJECT_EXTENSION, fileName, isInside, moveToTrash, movePath, namedAfter, packageName, samePath, uniquePackage } from "./packages.ts";
import { run } from "./process.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, MAX_NAME_LENGTH, isObject, isValidId, parseName, readJson, writeJson } from "./storage.ts";
import { type DocStats, suiteBackend } from "./suites/index.ts";

/** `<package>/meta.json`: which project it is and what kind. Written after `project.json`, so it marks a committed one. */
interface ProjectMeta {
  id: string;
  suite: SuiteId;
  createdAt: number;
  updatedAt: number;
}

interface Entry {
  meta: ProjectMeta;
  stats: DocStats<SuiteId>;
  /** Its package. */
  dir: string;
  openedAt: number;
  /** A suite's starting point, a hidden copy in the data folder that's never listed. */
  template: boolean;
}

/** A project this computer has opened, as `data/projects.json` keeps it (with what was known of it, for when it's missing). */
interface Recent {
  id: string;
  path: string;
  openedAt: number;
  summary: ProjectSummary;
}

interface SavedRecents {
  /** Where new projects go, if the user picked a folder. */
  location?: string;
  recent: Recent[];
}

const COPY_SUFFIX = " copy";
const DOC_FILE = "project.json";
const META_FILE = "meta.json";
/** How long a package that's busy (media being added or made) waits before it's renamed again. */
const RENAME_RETRY_MS = 3000;

/** A package's meta.json (projects saved before suites have none: they're videos; `status` and `settledAt` are from before files). */
function parseMeta(v: unknown): ProjectMeta | null {
  if (!isObject(v)) return null;
  const valid =
    isValidId(v.id) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    (v.suite === undefined || isSuiteId(v.suite));
  if (!valid) return null;
  return {
    id: v.id as string,
    suite: (v.suite as SuiteId | undefined) ?? DEFAULT_SUITE,
    createdAt: v.createdAt as number,
    updatedAt: v.updatedAt as number,
  };
}

function parseRecents(v: unknown): SavedRecents {
  if (!isObject(v)) return { recent: [] };
  const recent = Array.isArray(v.recent)
    ? v.recent.filter(
        (r): r is Recent =>
          isObject(r) &&
          isValidId(r.id) &&
          typeof r.path === "string" &&
          path.isAbsolute(r.path) &&
          typeof r.openedAt === "number" &&
          isObject(r.summary) &&
          isSuiteId(r.summary.suite) &&
          typeof r.summary.name === "string",
      )
    : [];
  return { recent, ...(typeof v.location === "string" && path.isAbsolute(v.location) && { location: v.location }) };
}

/** A path typed or picked by the user: `~` is their home; it must be absolute. */
function userPath(raw: unknown, what: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new HttpError(400, `Expected { path }: the ${what}'s full path.`);
  const expanded = raw.trim().replace(/^~(?=$|[/\\])/, os.homedir());
  if (!path.isAbsolute(expanded)) throw new HttpError(400, `The ${what}'s path must be a full one (it starts with / or ~).`);
  return path.resolve(expanded);
}

export interface ProjectStoreOptions {
  /** Where new projects go unless the user picks another folder (`~/Documents/Vaudio`). */
  location: string;
  /** Put a package in the Trash (default: `moveToTrash`). Packages inside the data folder are deleted instead. */
  trash?: (dir: string) => Promise<void>;
  /** Show a package in Finder (default: `open -R` on a Mac). */
  reveal?: (dir: string) => Promise<void>;
  /** A package is about to move (the audio engine writes its plugins' settings into it first). */
  beforeMove?: (projectId: string) => Promise<void>;
}

/**
 * Every suite's projects, each a package on disk (`server/packages.ts`) wherever the user keeps it, and the
 * ones this computer has opened (its recents, `data/projects.json`), with their summaries cached in memory.
 * Documents are opaque here: their suite (`server/suites/`) makes, normalises (against the project's own
 * media) and summarises them.
 *
 * A package is named after its project. Renaming one that's open only renames its document: things are
 * writing into its folder (media being added, plugins' settings, recordings), so the folder follows when
 * it's closed (`closed`), or at the next startup.
 */
export class ProjectStore {
  private entries = new Map<string, Entry>();
  /** Recents that aren't where they were last seen. */
  private missing = new Map<string, Recent>();
  /** Packages being made (a copy's media is copied into it before it's a project). */
  private pending = new Map<string, string>();
  /** Projects a tab has open now. */
  private open = new Set<string>();
  /** Serialise writes so an older save can never land after a newer one. */
  private writes = createLimiter(1);
  private recentsWrites = createLimiter(1);
  private retries = new Set<NodeJS.Timeout>();
  private lastTimestamp = 0;
  private location: string;
  private readonly defaultLocation: string;

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
    private options: ProjectStoreOptions,
  ) {
    this.defaultLocation = path.resolve(options.location);
    this.location = this.defaultLocation;
  }

  /** Load the starting points and the recents (a package found where it was is loaded; one that isn't is `missing`). */
  async load(): Promise<void> {
    const saved = parseRecents(await readJson<unknown>(this.paths.recentsFile));
    if (saved.location) this.location = saved.location;
    for (const entry of await fs.readdir(this.paths.templates, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && entry.name.endsWith(PROJECT_EXTENSION)) {
        await this.mount(path.join(this.paths.templates, entry.name), { template: true });
      }
    }
    for (const recent of saved.recent) {
      if (this.entries.has(recent.id) || this.missing.has(recent.id)) continue;
      const entry = await this.mount(recent.path, { openedAt: recent.openedAt, follow: "document" }).catch((err) => {
        console.warn(`[projects] couldn't open ${recent.path}: ${err instanceof Error ? err.message : err}`);
        return null;
      });
      if (!entry) this.missing.set(recent.id, recent);
    }
    await this.saveRecents();
  }

  has(id: string): boolean {
    return isValidId(id) && this.entries.has(id);
  }

  /** The recents, the latest opened or saved first (starting points aren't projects to work on: they're left out). */
  list(): ProjectSummary[] {
    const found = [...this.entries.values()].filter((e) => !e.template).map((e) => this.toSummary(e));
    const lost = [...this.missing.values()].map((r) => this.missingSummary(r));
    const latest = (p: ProjectSummary) => Math.max(p.openedAt, p.updatedAt);
    return [...found, ...lost].sort((a, b) => latest(b) - latest(a));
  }

  summary(id: string): ProjectSummary {
    return this.toSummary(this.entry(id));
  }

  /** Which suite a project belongs to (null if there's no such project). */
  suiteOf(id: string): SuiteId | null {
    return (isValidId(id) && this.entries.get(id)?.meta.suite) || null;
  }

  /** A project's package (where its suite keeps files of its own: a song's plugins' settings, its recordings). */
  dir(id: string): string {
    return this.entry(id).dir;
  }

  /** Where a project's media are (`MediaLibrary`'s `projectDirs`), also while it's being made. */
  mediaDir(id: string): string | null {
    const dir = this.entries.get(id)?.dir ?? this.pending.get(id);
    return dir ? path.join(dir, "media") : null;
  }

  async get(id: string): Promise<SuiteDocument> {
    return this.readDoc(this.entry(id));
  }

  /** Where new projects go, and where they would by default. */
  getLocation(): ProjectLocation {
    return { path: this.location, default: this.defaultLocation };
  }

  /** New projects go in another folder (made if need be). */
  async setLocation(body: unknown): Promise<ProjectLocation> {
    const dir = userPath(isObject(body) ? body.path : undefined, "folder");
    if (dir.toLowerCase().endsWith(PROJECT_EXTENSION)) throw new HttpError(400, "That's a project: pick the folder to keep projects in.");
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      throw new HttpError(400, `${dir} can't be made: pick another folder.`);
    }
    if (!(await fs.stat(dir)).isDirectory()) throw new HttpError(400, `${dir} is a file: pick a folder.`);
    this.location = dir;
    await this.saveRecents();
    return this.getLocation();
  }

  async create(body: unknown): Promise<ProjectSummary> {
    const input = body ?? {};
    if (!isObject(input)) throw new HttpError(400, "Expected { name?, suite? }.");
    const name = input.name === undefined ? DEFAULT_PROJECT_NAME : parseName(input.name);
    if (input.suite !== undefined && !isSuiteId(input.suite)) throw new HttpError(400, "Unknown suite: use video or music.");
    const suite = (input.suite as SuiteId | undefined) ?? DEFAULT_SUITE;
    const template = input.blank === true ? null : this.templateId(suite);
    const backend = suiteBackend(suite);
    const adjust = (doc: SuiteDocument) => (backend.withOptions && input.options !== undefined ? backend.withOptions(doc as never, input.options) : doc);
    if (template) return this.copy(template, { name, parent: this.location, adjust });
    const id = createId("project");
    return this.add(id, suite, adjust(backend.create(name)), this.now(), { dir: uniquePackage(this.location, name) });
  }

  /**
   * Open a package from anywhere on this computer (`OpenProjectRequest`) and add it to the recents. One
   * that's a recent's new place (moved in Finder) takes its place; a copy of one that's open here (made in
   * Finder) gets ids of its own, so both can be open. Its name is its folder's, if that was renamed.
   */
  async openPath(body: unknown): Promise<ProjectSummary> {
    let dir = userPath(isObject(body) ? body.path : undefined, "project");
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat) throw new HttpError(404, `There's nothing at ${dir}.`);
    if (stat.isFile()) dir = path.dirname(dir);
    if (!existsSync(path.join(dir, META_FILE))) throw new HttpError(400, `${path.basename(dir)} isn't a project (it has no ${META_FILE}).`);
    if (isInside(dir, this.paths.templates)) throw new HttpError(400, "That's a starting point, not a project.");
    return this.writes(async () => {
      const known = [...this.entries.values()].find((e) => samePath(e.dir, dir));
      if (known && !known.template) {
        this.entries.set(known.meta.id, { ...known, openedAt: this.now() });
        await this.saveRecents();
        return this.summary(known.meta.id);
      }
      const entry = await this.mount(dir, { openedAt: this.now(), follow: "folder" });
      if (!entry) throw new HttpError(400, `${path.basename(dir)} couldn't be read: its ${META_FILE} is damaged.`);
      await this.saveRecents();
      return this.toSummary(entry);
    });
  }

  /** A tab opened the project: it's the latest, and its package stays put until it's closed. */
  async opened(id: string): Promise<ProjectSummary> {
    const entry = this.entry(id);
    this.open.add(id);
    this.entries.set(id, { ...entry, openedAt: this.now() });
    await this.saveRecents();
    return this.summary(id);
  }

  /** A tab closed the project: its package takes its name, if it was renamed meanwhile. */
  async closed(id: string): Promise<ProjectSummary> {
    this.entry(id);
    this.open.delete(id);
    await this.writes(() => this.followName(id));
    return this.summary(id);
  }

  /** Show its package in Finder. */
  async reveal(id: string): Promise<void> {
    const { dir } = this.entry(id);
    const reveal = this.options.reveal ?? (async (target: string) => void (process.platform === "darwin" && (await run("open", ["-R", target]))));
    await reveal(dir);
  }

  /** Commit a new project with the given document and timestamps (`updatedAt` = `createdAt`), in the package `dir`. */
  async add<S extends SuiteId>(id: string, suite: S, doc: SuiteDocument<S>, createdAt: number, { dir, template = false }: { dir: string; template?: boolean }): Promise<ProjectSummary> {
    const meta: ProjectMeta = { id, suite, createdAt, updatedAt: createdAt };
    await this.writes(async () => {
      await fs.mkdir(path.join(dir, "media"), { recursive: true });
      await writeJson(path.join(dir, DOC_FILE), doc);
      await writeJson(path.join(dir, META_FILE), meta);
      this.pending.delete(id);
      this.entries.set(id, { meta, stats: this.statsOf(suite, this.normalize(id, suite, doc)), dir, openedAt: createdAt, template });
      if (!template) await this.saveRecents();
    });
    return this.summary(id);
  }

  /** Copy a project and its media into a new one beside it, named "<name> copy". */
  async duplicate(id: string): Promise<ProjectSummary> {
    const name = (await this.get(id)).name;
    return this.copy(id, { name: `${name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}` });
  }

  /** Each suite's starting point, if it has one. */
  templates(): ProjectTemplates {
    const templates: ProjectTemplates = {};
    for (const { meta, stats, template } of this.entries.values()) if (template) templates[meta.suite] = { name: stats.name, savedAt: meta.createdAt };
    return templates;
  }

  /** Make a copy of the project, as it's saved now, its suite's starting point (replacing the last one). */
  async saveTemplate(id: string): Promise<ProjectTemplates> {
    const { meta, template } = this.entry(id);
    if (template) throw new HttpError(400, "That's a starting point already.");
    const old = this.templateId(meta.suite);
    await this.copy(id, { name: (await this.get(id)).name, template: true });
    if (old) await this.remove(old);
    return this.templates();
  }

  /** New projects of the suite start blank again. */
  async clearTemplate(suite: unknown): Promise<ProjectTemplates> {
    if (!isSuiteId(suite)) throw new HttpError(400, "Unknown suite: use video or music.");
    const old = this.templateId(suite);
    if (old) await this.remove(old);
    return this.templates();
  }

  private templateId(suite: SuiteId): string | null {
    for (const { meta, template } of this.entries.values()) if (template && meta.suite === suite) return meta.id;
    return null;
  }

  /**
   * A new project copied from another: its document (its media remapped to their copies), its media and
   * the files beside its document (a music project's plugin settings, by channel id, which the copy keeps).
   * It's made in `parent` (default: beside the original); a starting point is made in the data folder.
   */
  private async copy(
    id: string,
    { name, parent, template = false, adjust = (doc) => doc }: { name: string; parent?: string; template?: boolean; adjust?: (doc: SuiteDocument) => SuiteDocument },
  ): Promise<ProjectSummary> {
    const original = this.entry(id);
    const source = await this.readDoc(original);
    const copyId = createId("project");
    const dir = template ? path.join(this.paths.templates, `${copyId}${PROJECT_EXTENSION}`) : uniquePackage(parent ?? path.dirname(original.dir), name);
    this.pending.set(copyId, dir);
    try {
      await fs.mkdir(path.join(dir, "media"), { recursive: true });
      const assetIds = await this.library.copyProject(id, copyId);
      const copy = suiteBackend(original.meta.suite).remapMedia(source as never, assetIds);
      for (const file of await fs.readdir(original.dir)) {
        if (file === DOC_FILE || file === META_FILE || file === "media") continue;
        await fs.cp(path.join(original.dir, file), path.join(dir, file), { recursive: true });
      }
      return await this.add(copyId, original.meta.suite, adjust({ ...copy, name }), this.now(), { dir, template });
    } catch (err) {
      this.library.forgetProject(copyId);
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
      // Deleted while its media was being copied.
      if (!this.has(id)) throw new HttpError(404, "Project not found");
      throw err;
    } finally {
      this.pending.delete(copyId);
    }
  }

  /** Replace the document (normalised by its suite, against the project's media). */
  async save(id: string, input: unknown): Promise<ProjectSummary> {
    const { meta } = this.entry(id);
    if (!isObject(input)) throw new HttpError(400, "Expected a project object.");
    let doc: SuiteDocument;
    try {
      doc = this.normalize(id, meta.suite, input);
    } catch {
      throw new HttpError(400, `The ${suiteNoun(meta.suite)} is malformed.`);
    }
    await this.writes(async () => {
      await this.write(id, doc);
      // Renamed while no tab has it open (the assistant working on it in the background).
      if (!this.open.has(id)) await this.followName(id);
    });
    return this.summary(id);
  }

  /** Rename a project (`UpdateProjectRequest`), and its package unless it's open. */
  async update(id: string, body: unknown): Promise<ProjectSummary> {
    this.entry(id);
    if (!isObject(body) || body.name === undefined) throw new HttpError(400, "Expected { name }.");
    const name = parseName(body.name);
    await this.writes(async () => {
      const entry = this.entry(id);
      await this.write(id, { ...(await this.readDoc(entry)), name });
      if (!this.open.has(id)) await this.followName(id);
    });
    return this.summary(id);
  }

  /**
   * Put a project's package in the Trash (one in the data folder, a starting point or a test's, is deleted).
   * A missing one is only forgotten.
   */
  async remove(id: string): Promise<void> {
    if (this.missing.has(id)) return this.forget(id);
    this.entry(id);
    await this.writes(async () => {
      const entry = this.entry(id);
      // Forget the project before touching the media so no new upload can land in it.
      this.entries.delete(id);
      this.open.delete(id);
      this.library.forgetProject(id);
      if (entry.template || isInside(entry.dir, this.paths.root)) await fs.rm(entry.dir, { recursive: true, force: true, maxRetries: 5 });
      else await (this.options.trash ?? moveToTrash)(entry.dir);
      if (!entry.template) await this.saveRecents();
    });
  }

  /** Remove a project from the recents; its package stays where it is (Open… brings it back). */
  async forget(id: string): Promise<void> {
    const entry = isValidId(id) ? this.entries.get(id) : undefined;
    if (!entry?.template && this.missing.delete(id)) return void (await this.saveRecents());
    if (!entry || entry.template) throw new HttpError(404, "Project not found");
    await this.writes(async () => {
      this.entries.delete(id);
      this.open.delete(id);
      this.library.forgetProject(id);
      await this.saveRecents();
    });
  }

  /** Stop renaming packages later (server shutdown). */
  shutdown(): void {
    for (const timer of this.retries) clearTimeout(timer);
    this.retries.clear();
  }

  /**
   * Load the package at `dir`. A copy of a project that's here already (its folder still there) gets ids of
   * its own; a project whose folder is gone is found here instead. Its name and its folder's are made the
   * same: the folder's wins when the user picked it (renamed in Finder), the document's when it's a recent
   * (renamed in the app while open). Null if it isn't a project.
   */
  private async mount(dir: string, { openedAt, follow, template = false }: { openedAt?: number; follow?: "folder" | "document"; template?: boolean }): Promise<Entry | null> {
    let meta = parseMeta(await readJson<unknown>(path.join(dir, META_FILE)));
    if (!meta) return null;
    const known = this.entries.get(meta.id) ?? (this.pending.has(meta.id) ? ({ dir: this.pending.get(meta.id)! } as Entry) : undefined);
    if (known && !samePath(known.dir, dir)) {
      if (existsSync(known.dir)) meta = await this.reId(dir, meta);
      else {
        this.entries.delete(meta.id);
        this.library.forgetProject(meta.id);
      }
    }
    this.missing.delete(meta.id);

    if (!template && follow) {
      const saved = await readJson<unknown>(path.join(dir, DOC_FILE));
      const name = isObject(saved) && typeof saved.name === "string" ? saved.name : null;
      if (name !== null && !namedAfter(dir, name)) {
        if (follow === "folder") await writeJson(path.join(dir, DOC_FILE), { ...(saved as Record<string, unknown>), name: packageName(dir).slice(0, MAX_NAME_LENGTH) });
        else {
          const target = uniquePackage(path.dirname(dir), name, dir);
          try {
            await movePath(dir, target);
            dir = target;
          } catch (err) {
            console.warn(`[projects] couldn't rename ${dir}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }

    this.pending.set(meta.id, dir);
    try {
      await this.library.loadProject(meta.id, path.join(dir, "media"));
      const entry: Entry = { meta, stats: this.statsOf(meta.suite, await this.readDocAt(dir, meta)), dir, openedAt: openedAt ?? meta.createdAt, template };
      this.entries.set(meta.id, entry);
      return entry;
    } finally {
      this.pending.delete(meta.id);
    }
  }

  /** Give a package (a copy, made in Finder, of a project that's here) a project id and media ids of its own. */
  private async reId(dir: string, meta: ProjectMeta): Promise<ProjectMeta> {
    const id = createId("project");
    const mediaDir = path.join(dir, "media");
    const assets: Record<string, MediaAsset> = {};
    for (const entry of await fs.readdir(mediaDir, { withFileTypes: true }).catch(() => [])) {
      const asset = entry.isDirectory() && isValidId(entry.name) ? await readJson<MediaAsset>(path.join(mediaDir, entry.name, META_FILE)) : null;
      if (asset?.id === entry.name) assets[asset.id] = asset;
    }
    const ids = new Map(Object.keys(assets).map((old) => [old, createId("media")]));
    const saved = await readJson<unknown>(path.join(dir, DOC_FILE));
    const backend = suiteBackend(meta.suite);
    let doc: SuiteDocument;
    try {
      doc = backend.normalize(saved, assets);
    } catch {
      doc = backend.create(packageName(dir));
    }
    for (const [old, next] of ids) {
      await writeJson(path.join(mediaDir, old, META_FILE), this.library.renamed(assets[old], next, id));
      await fs.rename(path.join(mediaDir, old), path.join(mediaDir, next));
    }
    await writeJson(path.join(dir, DOC_FILE), backend.remapMedia(doc as never, ids));
    const next = { ...meta, id };
    await writeJson(path.join(dir, META_FILE), next);
    return next;
  }

  /** Rename a project's package after it, unless it's open or busy (then later). Run inside `writes`. */
  private async followName(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.template || this.open.has(id) || namedAfter(entry.dir, entry.stats.name)) return;
    if (this.library.busy(id)) {
      const timer = setTimeout(() => {
        this.retries.delete(timer);
        void this.writes(() => this.followName(id)).catch(() => {});
      }, RENAME_RETRY_MS);
      timer.unref();
      this.retries.add(timer);
      return;
    }
    const target = uniquePackage(path.dirname(entry.dir), entry.stats.name, entry.dir);
    try {
      await this.options.beforeMove?.(id);
      await movePath(entry.dir, target);
    } catch (err) {
      console.warn(`[projects] couldn't rename ${entry.dir}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    this.entries.set(id, { ...this.entries.get(id)!, dir: target });
    await this.saveRecents();
  }

  private entry(id: string): Entry {
    const entry = isValidId(id) ? this.entries.get(id) : undefined;
    if (!entry) throw new HttpError(404, this.missing.has(id) ? "That project isn't where it was: open it where it is now." : "Project not found");
    return entry;
  }

  /** Write a new document (bumps `updatedAt`). Run inside `writes`. */
  private async write(id: string, doc: SuiteDocument) {
    const current = this.entry(id);
    const meta: ProjectMeta = { ...current.meta, updatedAt: this.now() };
    await writeJson(path.join(current.dir, DOC_FILE), doc);
    await writeJson(path.join(current.dir, META_FILE), meta);
    this.entries.set(id, { ...current, meta, stats: this.statsOf(meta.suite, doc) });
  }

  /** Write the recents (and the location), as they are when the write's turn comes. */
  private saveRecents(): Promise<void> {
    return this.recentsWrites(async () => {
      const recent: Recent[] = [
        ...[...this.entries.values()].filter((e) => !e.template).map((e) => ({ id: e.meta.id, path: e.dir, openedAt: e.openedAt, summary: this.toSummary(e) })),
        ...this.missing.values(),
      ].sort((a, b) => b.openedAt - a.openedAt);
      const saved: SavedRecents = { ...(this.location !== this.defaultLocation && { location: this.location }), recent };
      await writeJson(this.paths.recentsFile, saved);
    });
  }

  private toSummary({ meta, stats: { coverAssetId, ...stats }, dir, openedAt }: Entry): ProjectSummary {
    const thumbnail = coverAssetId ? (this.library.find(coverAssetId)?.poster ?? null) : null;
    // Each suite's stats go with its own meta.
    return { ...meta, ...stats, openedAt, path: dir, thumbnail } as ProjectSummary;
  }

  private missingSummary({ summary, path: dir, openedAt }: Recent): ProjectSummary {
    return { ...summary, openedAt, path: dir, thumbnail: null, missing: true };
  }

  private statsOf(suite: SuiteId, doc: SuiteDocument): DocStats<SuiteId> {
    return suiteBackend(suite).stats(doc as never);
  }

  private normalize(id: string, suite: SuiteId, doc: unknown): SuiteDocument {
    return suiteBackend(suite).normalize(doc, this.library.byId(id));
  }

  private readDoc(entry: Entry): Promise<SuiteDocument> {
    return this.readDocAt(entry.dir, entry.meta);
  }

  /** The saved document, normalised (a new one if it's missing or corrupt). */
  private async readDocAt(dir: string, meta: ProjectMeta): Promise<SuiteDocument> {
    const saved = await readJson<unknown>(path.join(dir, DOC_FILE));
    try {
      if (isObject(saved)) return this.normalize(meta.id, meta.suite, saved);
    } catch {
      // Beyond repair: start again.
    }
    return suiteBackend(meta.suite).create(fileName(packageName(dir)));
  }

  /** Strictly increasing epoch ms, so "most recently updated" never ties. */
  private now(): number {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }
}
