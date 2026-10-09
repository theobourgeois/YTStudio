import { randomBytes } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errorMessage } from "../shared/errors.ts";
import type { SongHandoff } from "../shared/handoff.ts";
import { createId } from "../shared/ids.ts";
import { DEFAULT_PROJECT_NAME, DEFAULT_SUITE, type SuiteDocument, type SuiteId, isSuiteId, SUITE_IDS, suiteNoun } from "../shared/suites.ts";
import type { MediaAsset, ProjectLocation, ProjectSummary, ProjectTemplates } from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import { PROJECT_EXTENSION, fileName, fitsName, isInside, isPackageName, moveToTrash, movePath, namedAfter, packageName, relocated, samePath, uniquePackage } from "./packages.ts";
import { revealInFinder } from "./process.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, MAX_NAME_LENGTH, isObject, isValidId, parseName, readJson, writeJson, writeJsonDurably } from "./storage.ts";
import { type DocStats, suiteBackend } from "./suites/index.ts";
import { log } from "./log.ts";

const logger = log("projects");

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
  /** Its `project.json` is there but damaged: what to tell the user. It's never written over while this is set. */
  damaged?: string;
  /** The picture a tab drew of it for Home, if one has been saved. */
  cover?: Cover;
}

type CoverExtension = (typeof COVER_EXTENSIONS)[number];

/** `.preview/cover.<ext>`: remembered so summaries, built often, never look for it on disk. */
interface Cover {
  ext: CoverExtension;
  /** Changes when it's replaced (its URL's `v`, so a card never shows an old one from the cache). */
  version: number;
}

/** What a package's `project.json` turned out to be: a document (and what was saved), none at all, or a damaged one. */
type DocRead =
  | { doc: SuiteDocument; saved: Record<string, unknown> }
  | { absent: true }
  | { damaged: string; bytes: Buffer | null };

/** A project this computer has opened, as `data/projects.json` keeps it (with what was known of it, for when it's missing). */
interface Recent {
  id: string;
  path: string;
  openedAt: number;
  summary: ProjectSummary;
  /** Made by New and not touched since: its media's ids then (`ProjectStore.untouched`). */
  untouched?: string[];
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
/** Renditions of the project (`ProjectPreviews`) and its cover: remade, or redrawn by a tab. */
const PREVIEW_DIR = ".preview";
const COVER_EXTENSIONS = ["jpg", "png"] as const;
/** The largest cover a tab may save (`PUT /api/projects/:id/cover`). */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;
/** A damaged document's copy, kept beside it (`keepDamaged`). */
const DAMAGED_COPY = /^project\.corrupt-.+\.json$/;
/** Folders of rebuildable files inside a suite's own folders (`photo/cache/`): a copy of the package goes without them. */
const CACHE_DIR = "cache";

/** Which image a cover is, by its first bytes (JPEG's SOI marker, PNG's signature), or null for anything else. */
function coverExtension(bytes: Buffer): CoverExtension | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "png";
  return null;
}

/** The cover a tab saved in the package, if any (looked for when a package is loaded or made, not per summary). */
async function findCover(dir: string): Promise<Cover | undefined> {
  for (const ext of COVER_EXTENSIONS) {
    const stat = await fs.stat(path.join(dir, PREVIEW_DIR, `cover.${ext}`)).catch(() => null);
    if (stat?.isFile()) return { ext, version: Math.round(stat.mtimeMs) };
  }
  return undefined;
}

/**
 * Keep a damaged document's bytes beside it as `project.corrupt-<time>.json`, before anything could replace
 * them: once for each content (reading it again finds the copy already made). Returns the copy's path.
 */
async function keepDamaged(dir: string, bytes: Buffer): Promise<string> {
  for (const name of await fs.readdir(dir)) {
    if (!DAMAGED_COPY.test(name)) continue;
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile() && stat.size === bytes.length && (await fs.readFile(file)).equals(bytes)) return file;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let file = path.join(dir, `project.corrupt-${stamp}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `project.corrupt-${stamp}-${n}.json`);
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, bytes, { flag: "wx" });
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return file;
}

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
  /** Where new projects go unless the user picks another folder (`~/Documents/YTStudio`). */
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
  /**
   * Projects made by New that nothing was done to since (their media's ids then, a starting point's): closing
   * one's tab deletes it (`discardUntouched`). Kept with the recents, so one left open when the app quit is too.
   */
  private untouched = new Map<string, string[]>();
  /** Serialise writes so an older save can never land after a newer one. */
  private writes = createLimiter(1);
  private recentsWrites = createLimiter(1);
  /** One damaged document kept aside at a time, so two reads of it don't both make a copy. */
  private keeping = createLimiter(1);
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
    if (saved.location) this.location = relocated(saved.location);
    for (const entry of await fs.readdir(this.paths.templates, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && isPackageName(entry.name)) {
        await this.mount(path.join(this.paths.templates, entry.name), { template: true });
      }
    }
    for (const recent of saved.recent) {
      if (this.entries.has(recent.id) || this.missing.has(recent.id)) continue;
      const entry = await this.mount(relocated(recent.path), { openedAt: recent.openedAt, follow: "document" }).catch((err) => {
        logger.warn(`couldn't open ${recent.path}: ${err instanceof Error ? err.message : err}`);
        return null;
      });
      if (!entry) this.missing.set(recent.id, recent);
      else if (Array.isArray(recent.untouched)) this.untouched.set(entry.meta.id, recent.untouched.filter((m) => typeof m === "string"));
    }
    await this.saveRecents();
  }

  has(id: string): boolean {
    return isValidId(id) && this.entries.has(id);
  }

  /**
   * The recents, the latest saved first: opening one doesn't move it (starting points aren't projects to work on:
   * they're left out). One whose package has gone since (moved, renamed or deleted in Finder) is missing from now on.
   */
  list(): ProjectSummary[] {
    for (const entry of this.entries.values()) {
      if (!entry.template && !this.open.has(entry.meta.id) && !existsSync(entry.dir)) this.lose(entry);
    }
    const found = [...this.entries.values()].filter((e) => !e.template).map((e) => this.toSummary(e));
    const lost = [...this.missing.values()].map((r) => this.missingSummary(r));
    return [...found, ...lost].sort((a, b) => b.updatedAt - a.updatedAt);
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

  /**
   * The document a tab opens, after its suite's check on opening (`SuiteBackend.check`): one that can't be shown
   * as it was saved is replaced (and saved), and `notice` says why.
   */
  async openDoc(id: string): Promise<{ doc: SuiteDocument; notice?: string }> {
    const backend = suiteBackend(this.entry(id).meta.suite);
    if (!backend.check) return { doc: await this.get(id) };
    return this.writes(async () => {
      const entry = this.entry(id);
      const doc = await this.readDoc(entry);
      const fixed = await backend.check!(doc as never, entry.dir);
      if (!fixed) return { doc };
      await this.write(id, fixed.doc);
      logger.warn(`${entry.dir} was opened as it could be: ${fixed.notice}`);
      return { doc: fixed.doc, notice: fixed.notice };
    });
  }

  /** Where new projects go, and where they would by default. */
  getLocation(): ProjectLocation {
    return { path: this.location, default: this.defaultLocation };
  }

  /** New projects go in another folder (made if need be). */
  async setLocation(body: unknown): Promise<ProjectLocation> {
    const dir = userPath(isObject(body) ? body.path : undefined, "folder");
    if (isPackageName(dir)) throw new HttpError(400, "That's a project: pick the folder to keep projects in.");
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
    if (input.suite !== undefined && !isSuiteId(input.suite)) throw new HttpError(400, `Unknown suite: use ${SUITE_IDS.join(", ")}.`);
    const suite = (input.suite as SuiteId | undefined) ?? DEFAULT_SUITE;
    let template = input.blank === true ? null : this.templateId(suite);
    if (template && this.entries.get(template)?.damaged) {
      // Its copy can't be made: new projects start blank until the starting point is saved again.
      logger.warn(`the ${suite} starting point is damaged: starting blank`);
      template = null;
    }
    const backend = suiteBackend(suite);
    const adjust = (doc: SuiteDocument) => (backend.withOptions && input.options !== undefined ? backend.withOptions(doc as never, input.options) : doc);
    const summary = template
      ? await this.copy(template, { name, parent: this.location, adjust })
      : await this.add(createId("project"), suite, adjust(backend.create(name)), this.now(), { dir: uniquePackage(this.location, name) });
    this.untouched.set(summary.id, Object.keys(this.library.byId(summary.id)));
    await this.saveRecents();
    return summary;
  }

  /**
   * A new project of `suite` made from what another suite handed over (`shared/handoff.ts`): its package in
   * the location, the handoff's files moved into its media (they're gone from where they were, whatever
   * happens), then the document its suite makes of them (`SuiteBackend.fromHandoff`). Nothing is left of
   * it if any of that fails.
   */
  async createFromHandoff(suite: SuiteId, handoff: SongHandoff, options: unknown): Promise<ProjectSummary> {
    const backend = suiteBackend(suite);
    if (!backend.fromHandoff) throw new HttpError(400, `A ${suiteNoun(suite)} can't be made from a song.`);
    const name = parseName(handoff.name || DEFAULT_PROJECT_NAME);
    const id = createId("project");
    const dir = uniquePackage(this.location, name);
    this.pending.set(id, dir);
    const files = [handoff.mix.file, ...handoff.stems.map((s) => s.file)];
    try {
      await fs.mkdir(path.join(dir, "media"), { recursive: true });
      const making = () => this.pending.has(id);
      const fileName = (label: string, file: string) => `${label.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Stem"}${path.extname(file)}`;
      const mix = await this.library.add(handoff.mix.file, fileName(name, handoff.mix.file), id, making, `handoff:${handoff.origin.projectId}:mix`);
      const stems: MediaAsset[] = [];
      for (const stem of handoff.stems) stems.push(await this.library.add(stem.file, fileName(`${name} - ${stem.name}`, stem.file), id, making, `handoff:${handoff.origin.projectId}:${stem.name}`));
      const doc = backend.normalize(backend.fromHandoff(handoff, { mix, stems }, options), this.library.byId(id));
      return await this.add(id, suite, doc as never, this.now(), { dir });
    } catch (err) {
      this.library.forgetProject(id);
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
      throw err;
    } finally {
      this.pending.delete(id);
      await Promise.all(files.map((file) => fs.rm(file, { force: true })));
    }
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

  /** A tab opened the project: its package stays put until it's closed. */
  async opened(id: string): Promise<ProjectSummary> {
    const entry = this.entry(id);
    const backend = suiteBackend(entry.meta.suite);
    if (backend.opened && !this.open.has(id)) {
      // Before the tab writes anything into the package (it hasn't the project yet): it never races the suite.
      try {
        await this.writes(async () => {
          const current = this.entry(id);
          const doc = await this.readDoc(current);
          // A damaged document names nothing reliably: nothing is tidied after it.
          if (doc && !this.entry(id).damaged) await backend.opened!(doc as never, current.dir);
        });
      } catch (error) {
        logger.warn(`${entry.meta.suite} couldn't tidy ${entry.dir} on opening: ${errorMessage(error)}`);
      }
    }
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

  /**
   * Delete a project made by New that nothing was done to (its tab was closed): no edit, no media added or
   * removed. It was never more than a click, so it isn't kept (nor put in the Trash). False, and kept, if it was
   * touched, or a tab has it open again.
   */
  async discardUntouched(id: string): Promise<boolean> {
    if (!this.untouched.has(id)) return false;
    return this.writes(async () => {
      const media = this.untouched.get(id);
      const entry = this.entries.get(id);
      if (!media || !entry || this.open.has(id) || this.library.busy(id)) return false;
      const now = Object.keys(this.library.byId(id));
      if (now.length !== media.length || now.some((m) => !media.includes(m))) {
        this.untouched.delete(id);
        await this.saveRecents();
        return false;
      }
      this.entries.delete(id);
      this.untouched.delete(id);
      this.library.forgetProject(id);
      await fs.rm(entry.dir, { recursive: true, force: true, maxRetries: 5 });
      await this.saveRecents();
      logger.info(`${entry.dir} was made and left untouched: deleted`);
      return true;
    });
  }

  /** Show its package in Finder. */
  async reveal(id: string): Promise<void> {
    const { dir } = this.entry(id);
    await (this.options.reveal ?? revealInFinder)(dir);
  }

  /**
   * Keep the picture a tab drew of the project as its card's (`.preview/cover.<ext>`, replacing the last): a
   * suite whose look only the tab can render (the photo suite's composite, by WebGPU) gives Home one this way.
   */
  async saveCover(id: string, body: unknown): Promise<void> {
    this.entry(id);
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(415, "Send the cover as the bytes of a JPEG or PNG image.");
    if (body.length > MAX_COVER_BYTES) throw new HttpError(413, `A cover can be at most ${MAX_COVER_BYTES / 1024 / 1024} MB.`);
    const ext = coverExtension(body);
    if (!ext) throw new HttpError(415, "That isn't a JPEG or PNG image.");
    await this.writes(async () => {
      const folder = path.join(this.entry(id).dir, PREVIEW_DIR);
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, `cover.${ext}`);
      const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await fs.writeFile(tmp, body);
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      for (const other of COVER_EXTENSIONS) if (other !== ext) await fs.rm(path.join(folder, `cover.${other}`), { force: true });
      this.entries.set(id, { ...this.entry(id), cover: { ext, version: this.now() } });
    });
  }

  /** The file of the project's cover (404 if no tab has saved one). */
  coverFile(id: string): string {
    const { dir, cover } = this.entry(id);
    if (!cover) throw new HttpError(404, "This project has no cover.");
    return path.join(dir, PREVIEW_DIR, `cover.${cover.ext}`);
  }

  /** Commit a new project with the given document and timestamps (`updatedAt` = `createdAt`), in the package `dir`. */
  async add<S extends SuiteId>(id: string, suite: S, doc: SuiteDocument<S>, createdAt: number, { dir, template = false }: { dir: string; template?: boolean }): Promise<ProjectSummary> {
    const meta: ProjectMeta = { id, suite, createdAt, updatedAt: createdAt };
    await this.writes(async () => {
      await fs.mkdir(path.join(dir, "media"), { recursive: true });
      await writeJsonDurably(path.join(dir, DOC_FILE), doc);
      await writeJsonDurably(path.join(dir, META_FILE), meta);
      const cover = await findCover(dir);
      this.pending.delete(id);
      this.entries.set(id, { meta, stats: this.statsOf(suite, this.normalize(id, suite, doc)), dir, openedAt: createdAt, template, ...(cover && { cover }) });
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
    if (!isSuiteId(suite)) throw new HttpError(400, `Unknown suite: use ${SUITE_IDS.join(", ")}.`);
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
   * Files are cloned where the disk can (APFS: no space taken until one changes); rebuildable caches (a
   * suite folder's `cache/`, the renditions in `.preview/`) are left for the copy to make again.
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
        const from = path.join(original.dir, file);
        if (file === PREVIEW_DIR) {
          // Renditions are kept by revision, which the copy doesn't share, so they'd never be used; the cover
          // is only drawn by a tab, so it comes along.
          for (const ext of COVER_EXTENSIONS) {
            const cover = path.join(from, `cover.${ext}`);
            if (!existsSync(cover)) continue;
            await fs.mkdir(path.join(dir, PREVIEW_DIR), { recursive: true });
            await fs.copyFile(cover, path.join(dir, PREVIEW_DIR, `cover.${ext}`), fsConstants.COPYFILE_FICLONE);
          }
          continue;
        }
        await fs.cp(from, path.join(dir, file), {
          recursive: true,
          mode: fsConstants.COPYFILE_FICLONE,
          filter: (src) => !(path.basename(src) === CACHE_DIR && path.dirname(src) === from),
        });
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
      const entry = this.entry(id);
      // A damaged document is never written over: refused until it's mended (read again: maybe it is now).
      if (entry.damaged) await this.readDoc(entry);
      const backend = suiteBackend(meta.suite);
      await backend.checkSave?.(doc as never, entry.dir);
      await backend.keepPrevious?.(entry.dir);
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
      this.untouched.delete(id);
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
      this.untouched.delete(id);
      this.library.forgetProject(id);
      await this.saveRecents();
    });
  }

  /** A recent whose package isn't where it was: it's listed as missing until it's found (Open…) or forgotten. */
  private lose(entry: Entry): void {
    this.entries.delete(entry.meta.id);
    this.library.forgetProject(entry.meta.id);
    this.missing.set(entry.meta.id, { id: entry.meta.id, path: entry.dir, openedAt: entry.openedAt, summary: this.toSummary(entry) });
    void this.saveRecents();
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
   * (renamed in the app while open). Null if it isn't a project. One whose document is damaged is loaded
   * (Home lists it, saying so) but left exactly as it is, a copy of it kept beside it.
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

    // Moving the package leaves its document's bytes as they are, so a damaged one may move too.
    if (!template && follow === "document") {
      const saved = await readJson<unknown>(path.join(dir, DOC_FILE));
      const name = isObject(saved) && typeof saved.name === "string" ? saved.name : null;
      if (name !== null && !fitsName(dir, name)) {
        const target = uniquePackage(path.dirname(dir), name, dir);
        try {
          await movePath(dir, target);
          dir = target;
        } catch (err) {
          logger.warn(`couldn't rename ${dir}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    this.pending.set(meta.id, dir);
    try {
      await this.library.loadProject(meta.id, path.join(dir, "media"));
      const read = await this.inspectDoc(dir, meta.suite, this.library.byId(meta.id));
      let doc = "doc" in read ? read.doc : null;
      // The folder's name, as Finder shows it, is the document's (written only into a healthy one).
      if (doc && "saved" in read && !template && follow === "folder" && typeof read.saved.name === "string" && !namedAfter(dir, read.saved.name)) {
        const name = packageName(dir).slice(0, MAX_NAME_LENGTH);
        await writeJsonDurably(path.join(dir, DOC_FILE), { ...read.saved, name });
        doc = { ...doc, name };
      }
      const damaged = "damaged" in read ? await this.damage(dir, read) : undefined;
      // A damaged one's summary is what its folder says (its document can't say more).
      const stats = this.statsOf(meta.suite, doc ?? suiteBackend(meta.suite).create(fileName(packageName(dir))));
      const cover = await findCover(dir);
      const entry: Entry = { meta, stats, dir, openedAt: openedAt ?? meta.createdAt, template, ...(damaged && { damaged }), ...(cover && { cover }) };
      this.entries.set(meta.id, entry);
      return entry;
    } finally {
      this.pending.delete(meta.id);
    }
  }

  /**
   * Give a package (a copy, made in Finder, of a project that's here) a project id and media ids of its own.
   * One whose document is damaged is refused before anything in it changes (its document would be rewritten).
   */
  private async reId(dir: string, meta: ProjectMeta): Promise<ProjectMeta> {
    const id = createId("project");
    const mediaDir = path.join(dir, "media");
    const assets: Record<string, MediaAsset> = {};
    for (const entry of await fs.readdir(mediaDir, { withFileTypes: true }).catch(() => [])) {
      const asset = entry.isDirectory() && isValidId(entry.name) ? await readJson<MediaAsset>(path.join(mediaDir, entry.name, META_FILE)) : null;
      if (asset?.id === entry.name) assets[asset.id] = asset;
    }
    const ids = new Map(Object.keys(assets).map((old) => [old, createId("media")]));
    const backend = suiteBackend(meta.suite);
    const read = await this.inspectDoc(dir, meta.suite, assets);
    if ("damaged" in read) throw new HttpError(422, await this.damage(dir, read));
    const doc = "doc" in read ? read.doc : backend.create(packageName(dir));
    for (const [old, next] of ids) {
      await writeJsonDurably(path.join(mediaDir, old, META_FILE), this.library.renamed(assets[old], next, id));
      await fs.rename(path.join(mediaDir, old), path.join(mediaDir, next));
    }
    await writeJsonDurably(path.join(dir, DOC_FILE), backend.remapMedia(doc as never, ids));
    const next = { ...meta, id };
    await writeJsonDurably(path.join(dir, META_FILE), next);
    return next;
  }

  /** Rename a project's package after it, unless it's open or busy (then later). Run inside `writes`. */
  private async followName(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.template || this.open.has(id) || fitsName(entry.dir, entry.stats.name)) return;
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
      logger.warn(`couldn't rename ${entry.dir}: ${err instanceof Error ? err.message : err}`);
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

  /** Write a new document (bumps `updatedAt`; the project's been touched). Run inside `writes`. */
  private async write(id: string, doc: SuiteDocument) {
    const current = this.entry(id);
    const meta: ProjectMeta = { ...current.meta, updatedAt: this.now() };
    await writeJsonDurably(path.join(current.dir, DOC_FILE), doc);
    await writeJsonDurably(path.join(current.dir, META_FILE), meta);
    this.entries.set(id, { ...current, meta, stats: this.statsOf(meta.suite, doc) });
    if (this.untouched.delete(id)) await this.saveRecents();
  }

  /** Write the recents (and the location), as they are when the write's turn comes. */
  private saveRecents(): Promise<void> {
    return this.recentsWrites(async () => {
      const recent: Recent[] = [
        ...[...this.entries.values()]
          .filter((e) => !e.template)
          .map((e) => {
            const untouched = this.untouched.get(e.meta.id);
            return { id: e.meta.id, path: e.dir, openedAt: e.openedAt, summary: this.toSummary(e), ...(untouched && { untouched }) };
          }),
        ...this.missing.values(),
      ].sort((a, b) => b.openedAt - a.openedAt);
      const saved: SavedRecents = { ...(this.location !== this.defaultLocation && { location: this.location }), recent };
      await writeJson(this.paths.recentsFile, saved);
    });
  }

  private toSummary({ meta, stats: { coverAssetId, ...stats }, dir, openedAt, damaged, cover }: Entry): ProjectSummary {
    const poster = coverAssetId ? (this.library.find(coverAssetId)?.poster ?? null) : null;
    const thumbnail = poster ?? (cover ? `/api/projects/${meta.id}/cover?v=${cover.version}` : null);
    // Each suite's stats go with its own meta.
    return { ...meta, ...stats, openedAt, path: dir, thumbnail, ...(damaged && { damaged }) } as ProjectSummary;
  }

  private missingSummary({ summary, path: dir, openedAt }: Recent): ProjectSummary {
    // Whether it's damaged is known again once it's found.
    const { damaged: _damaged, ...known } = summary;
    return { ...known, openedAt, path: dir, thumbnail: null, missing: true };
  }

  private statsOf(suite: SuiteId, doc: SuiteDocument): DocStats<SuiteId> {
    return suiteBackend(suite).stats(doc as never);
  }

  private normalize(id: string, suite: SuiteId, doc: unknown): SuiteDocument {
    return suiteBackend(suite).normalize(doc, this.library.byId(id));
  }

  /**
   * The saved document, normalised (a new one if there's no `project.json` at all: nothing is lost by
   * making one). A damaged one is refused with a 422 and marked so (and unmarked once it reads again).
   */
  private async readDoc({ dir, meta }: Entry): Promise<SuiteDocument> {
    const read = await this.inspectDoc(dir, meta.suite, this.library.byId(meta.id));
    const damaged = "damaged" in read ? await this.damage(dir, read) : undefined;
    const doc = "doc" in read ? read.doc : "absent" in read ? suiteBackend(meta.suite).create(fileName(packageName(dir))) : null;
    const current = this.entries.get(meta.id);
    if (current && samePath(current.dir, dir) && current.damaged !== damaged) {
      const { damaged: _was, ...rest } = current;
      this.entries.set(meta.id, damaged ? { ...rest, damaged } : { ...rest, stats: this.statsOf(meta.suite, doc!) });
    }
    if (damaged || !doc) throw new HttpError(422, damaged ?? "The project can't be read.");
    return doc;
  }

  /**
   * What the package's `project.json` is. Anything there that isn't a document its suite can repair is
   * damaged (unreadable, not JSON, not an object, or refused by `normalize`), and must never be replaced.
   */
  private async inspectDoc(dir: string, suite: SuiteId, media: Record<string, MediaAsset>): Promise<DocRead> {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(path.join(dir, DOC_FILE));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { absent: true };
      return { damaged: `it can't be read (${errorMessage(err)})`, bytes: null };
    }
    let saved: unknown;
    try {
      saved = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { damaged: "it isn't valid JSON", bytes };
    }
    if (!isObject(saved)) return { damaged: `it isn't a ${suiteNoun(suite)}`, bytes };
    try {
      return { doc: suiteBackend(suite).normalize(saved, media), saved };
    } catch (err) {
      return { damaged: `it can't be repaired (${errorMessage(err)})`, bytes };
    }
  }

  /** Keep a damaged document aside (once for its content) and say what happened, for the user. */
  private async damage(dir: string, { damaged, bytes }: { damaged: string; bytes: Buffer | null }): Promise<string> {
    let kept: string | null = null;
    if (bytes) {
      kept = await this.keeping(() => keepDamaged(dir, bytes)).catch((err) => {
        logger.warn(`couldn't keep a copy of ${path.join(dir, DOC_FILE)}: ${errorMessage(err)}`);
        return null;
      });
    }
    return (
      `"${packageName(dir)}" can't be opened: its document (${DOC_FILE}) is damaged: ${damaged}. Nothing in it was changed` +
      (kept ? `, and a copy of it is kept at ${kept}.` : ".") +
      ` Replace ${DOC_FILE} in the package with a good copy (a backup) to open it again.`
    );
  }

  /** Strictly increasing epoch ms, so "most recently updated" never ties. */
  private now(): number {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }
}
