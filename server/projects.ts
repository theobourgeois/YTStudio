import fs from "node:fs/promises";
import path from "node:path";
import { createId } from "../shared/ids.ts";
import { DEFAULT_PROJECT_NAME, DEFAULT_SUITE, type SuiteDocument, type SuiteId, isSuiteId, suiteNoun } from "../shared/suites.ts";
import type { ProjectStatus, ProjectSummary, ProjectTemplates, UpdateProjectRequest } from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, MAX_NAME_LENGTH, isObject, isValidId, parseName, readJson, writeJson } from "./storage.ts";
import { type DocStats, suiteBackend } from "./suites/index.ts";

/**
 * `data/projects/<id>/meta.json`. Written after `project.json`, so it marks a committed project.
 * `template`: it's its suite's starting point, a hidden copy that's never listed.
 */
type ProjectMeta = Pick<ProjectSummary, "id" | "suite" | "status" | "createdAt" | "updatedAt" | "settledAt"> & { template?: true };

interface Entry {
  meta: ProjectMeta;
  stats: DocStats<SuiteId>;
}

const STATUSES: readonly ProjectStatus[] = ["active", "settled"];
const COPY_SUFFIX = " copy";

/** A saved meta.json (projects saved before suites have none: they're videos). */
function parseMeta(v: unknown, id: string): ProjectMeta | null {
  if (!isObject(v)) return null;
  const valid =
    v.id === id &&
    STATUSES.includes(v.status as ProjectStatus) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    (v.settledAt === null || typeof v.settledAt === "number") &&
    (v.suite === undefined || isSuiteId(v.suite));
  if (!valid) return null;
  return {
    id,
    suite: (v.suite as SuiteId | undefined) ?? DEFAULT_SUITE,
    status: v.status as ProjectStatus,
    createdAt: v.createdAt as number,
    updatedAt: v.updatedAt as number,
    settledAt: v.settledAt as number | null,
    ...(v.template === true && { template: true as const }),
  };
}

function parseUpdate(body: unknown): UpdateProjectRequest {
  if (!isObject(body)) throw new HttpError(400, "Expected { name?, status? }.");
  const update: UpdateProjectRequest = {};
  if (body.name !== undefined) update.name = parseName(body.name);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as ProjectStatus)) {
      throw new HttpError(400, `Status must be one of ${STATUSES.join(", ")}.`);
    }
    update.status = body.status as ProjectStatus;
  }
  if (update.name === undefined && update.status === undefined) {
    throw new HttpError(400, "Nothing to update.");
  }
  return update;
}

/**
 * Projects of every suite on disk under `data/projects/<id>/` (`project.json` + `meta.json`,
 * which says the suite), with their summaries cached in memory. Documents are opaque here: their
 * suite (`server/suites/`) makes, normalises (against the project's own media) and summarises them.
 */
export class ProjectStore {
  private entries = new Map<string, Entry>();
  /** Serialise writes so an older save can never land after a newer one. */
  private writes = createLimiter(1);
  private lastTimestamp = 0;

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
  ) {}

  /** Load every committed project (call after the media library has loaded). */
  async load(): Promise<void> {
    for (const entry of await fs.readdir(this.paths.projects, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue;
      const meta = parseMeta(await readJson<unknown>(this.metaFile(entry.name)), entry.name);
      if (!meta) {
        console.warn(`[projects] skipping ${entry.name}: missing or invalid meta.json`);
        continue;
      }
      this.entries.set(meta.id, { meta, stats: this.statsOf(meta.suite, await this.readDoc(meta.id, meta.suite)) });
    }
  }

  has(id: string): boolean {
    return isValidId(id) && this.entries.has(id);
  }

  /** Most recently updated first (starting points aren't projects to work on: they're left out). */
  list(): ProjectSummary[] {
    return [...this.entries.values()]
      .filter((e) => !e.meta.template)
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
      .map((e) => this.toSummary(e));
  }

  summary(id: string): ProjectSummary {
    return this.toSummary(this.entry(id));
  }

  /** Which suite a project belongs to (null if there's no such project). */
  suiteOf(id: string): SuiteId | null {
    return (isValidId(id) && this.entries.get(id)?.meta.suite) || null;
  }

  async get(id: string): Promise<SuiteDocument> {
    const { meta } = this.entry(id);
    return this.readDoc(id, meta.suite);
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
    if (template) return this.copy(template, { name, adjust });
    return this.add(createId("project"), suite, adjust(backend.create(name)), this.now());
  }

  /** Commit a new project with the given document and timestamps (`updatedAt` = `createdAt`). */
  async add<S extends SuiteId>(id: string, suite: S, doc: SuiteDocument<S>, createdAt: number, template = false): Promise<ProjectSummary> {
    const meta: ProjectMeta = { id, suite, status: "active", createdAt, updatedAt: createdAt, settledAt: null, ...(template && { template: true as const }) };
    await this.writes(async () => {
      await fs.mkdir(this.paths.projectDir(id), { recursive: true });
      await writeJson(this.docFile(id), doc);
      await writeJson(this.metaFile(id), meta);
      this.entries.set(id, { meta, stats: this.statsOf(suite, this.normalize(id, suite, doc)) });
    });
    return this.summary(id);
  }

  /** Copy a project and its media into a new active project named "<name> copy". */
  async duplicate(id: string): Promise<ProjectSummary> {
    const name = (await this.get(id)).name;
    return this.copy(id, { name: `${name.slice(0, MAX_NAME_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}` });
  }

  /** Each suite's starting point, if it has one. */
  templates(): ProjectTemplates {
    const templates: ProjectTemplates = {};
    for (const { meta, stats } of this.entries.values()) if (meta.template) templates[meta.suite] = { name: stats.name, savedAt: meta.createdAt };
    return templates;
  }

  /** Make a copy of the project, as it's saved now, its suite's starting point (replacing the last one). */
  async saveTemplate(id: string): Promise<ProjectTemplates> {
    const { meta } = this.entry(id);
    if (meta.template) throw new HttpError(400, "That's a starting point already.");
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
    for (const { meta } of this.entries.values()) if (meta.template && meta.suite === suite) return meta.id;
    return null;
  }

  /**
   * A new project copied from another: its document (its media remapped to their copies), its media and
   * the files beside its document (a music project's plugin settings, by channel id, which the copy keeps).
   */
  private async copy(id: string, { name, template = false, adjust = (doc) => doc }: { name: string; template?: boolean; adjust?: (doc: SuiteDocument) => SuiteDocument }): Promise<ProjectSummary> {
    const { suite } = this.entry(id).meta;
    const source = await this.readDoc(id, suite);
    const copyId = createId("project");
    try {
      const assetIds = await this.library.copyProject(id, copyId);
      const copy = suiteBackend(suite).remapMedia(source as never, assetIds);
      await fs.mkdir(this.paths.projectDir(copyId), { recursive: true });
      for (const file of await fs.readdir(this.paths.projectDir(id))) {
        if (file === "project.json" || file === "meta.json") continue;
        await fs.cp(path.join(this.paths.projectDir(id), file), path.join(this.paths.projectDir(copyId), file), { recursive: true });
      }
      return await this.add(copyId, suite, adjust({ ...copy, name }), this.now(), template);
    } catch (err) {
      await this.library.removeProject(copyId);
      await fs.rm(this.paths.projectDir(copyId), { recursive: true, force: true, maxRetries: 5 });
      // Deleted while its media was being copied.
      if (!this.has(id)) throw new HttpError(404, "Project not found");
      throw err;
    }
  }

  /** Replace the document (normalised by its suite, against the project's media). */
  async save(id: string, input: unknown): Promise<ProjectSummary> {
    const { suite } = this.entry(id).meta;
    if (!isObject(input)) throw new HttpError(400, "Expected a project object.");
    let doc: SuiteDocument;
    try {
      doc = this.normalize(id, suite, input);
    } catch {
      throw new HttpError(400, `The ${suiteNoun(suite)} is malformed.`);
    }
    await this.writes(() => this.write(id, { doc }));
    return this.summary(id);
  }

  /** Rename and/or settle/unsettle. Only renaming counts as an update. */
  async update(id: string, body: unknown): Promise<ProjectSummary> {
    this.entry(id);
    const { name, status } = parseUpdate(body);
    await this.writes(async () => {
      const { meta } = this.entry(id);
      const patch: Partial<ProjectMeta> = {};
      if (status && status !== meta.status) {
        patch.status = status;
        patch.settledAt = status === "settled" ? Date.now() : null;
      }
      const doc = name === undefined ? undefined : { ...(await this.readDoc(id, meta.suite)), name };
      await this.write(id, { doc, patch });
    });
    return this.summary(id);
  }

  /** Delete the project and all of its media. */
  async remove(id: string): Promise<void> {
    this.entry(id);
    await this.writes(async () => {
      this.entry(id);
      // Forget the project before touching the media so no new upload can land in it.
      this.entries.delete(id);
      await this.library.removeProject(id);
      await fs.rm(this.paths.projectDir(id), { recursive: true, force: true, maxRetries: 5 });
    });
  }

  private entry(id: string): Entry {
    const entry = isValidId(id) ? this.entries.get(id) : undefined;
    if (!entry) throw new HttpError(404, "Project not found");
    return entry;
  }

  /** Write a new document (bumps `updatedAt`) and/or meta changes. Run inside `writes`. */
  private async write(id: string, { doc, patch }: { doc?: SuiteDocument; patch?: Partial<ProjectMeta> }) {
    const current = this.entry(id);
    const meta: ProjectMeta = { ...current.meta, ...patch };
    if (doc) {
      meta.updatedAt = this.now();
      await writeJson(this.docFile(id), doc);
    }
    await writeJson(this.metaFile(id), meta);
    this.entries.set(id, { meta, stats: doc ? this.statsOf(meta.suite, doc) : current.stats });
  }

  private toSummary({ meta, stats: { coverAssetId, ...stats } }: Entry): ProjectSummary {
    const thumbnail = coverAssetId ? (this.library.find(coverAssetId)?.poster ?? null) : null;
    const { template: _, ...shown } = meta;
    // Each suite's stats go with its own meta.
    return { ...shown, ...stats, thumbnail } as ProjectSummary;
  }

  private statsOf(suite: SuiteId, doc: SuiteDocument): DocStats<SuiteId> {
    return suiteBackend(suite).stats(doc as never);
  }

  private normalize(id: string, suite: SuiteId, doc: unknown): SuiteDocument {
    return suiteBackend(suite).normalize(doc, this.library.byId(id));
  }

  /** The saved document, normalised (a new one if it's missing or corrupt). */
  private async readDoc(id: string, suite: SuiteId): Promise<SuiteDocument> {
    const saved = await readJson<unknown>(this.docFile(id));
    try {
      if (isObject(saved)) return this.normalize(id, suite, saved);
    } catch {
      // Beyond repair: start again.
    }
    return suiteBackend(suite).create(DEFAULT_PROJECT_NAME);
  }

  /** Strictly increasing epoch ms, so "most recently updated" never ties. */
  private now(): number {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1);
    return this.lastTimestamp;
  }

  private docFile(id: string) {
    return path.join(this.paths.projectDir(id), "project.json");
  }

  private metaFile(id: string) {
    return path.join(this.paths.projectDir(id), "meta.json");
  }
}
