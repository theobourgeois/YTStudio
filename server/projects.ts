import fs from "node:fs/promises";
import path from "node:path";
import {
  createDefaultProject,
  createId,
  isOnVideoTrack,
  normalizeProject,
  projectDuration,
} from "../shared/timeline.ts";
import type { Project, ProjectStatus, ProjectSummary, UpdateProjectRequest } from "../shared/types.ts";
import type { MediaLibrary } from "./media.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, isValidId, readJson, writeJson } from "./storage.ts";

/** `data/projects/<id>/meta.json`. Written after `project.json`, so it marks a committed project. */
type ProjectMeta = Pick<ProjectSummary, "id" | "status" | "createdAt" | "updatedAt" | "settledAt">;

/** Summary fields derived from the project document (cached; refreshed on every write). */
interface DocStats {
  name: string;
  aspectRatio: ProjectSummary["aspectRatio"];
  duration: number;
  clipCount: number;
  /** Asset of the first main-track clip; its poster is the thumbnail. */
  coverAssetId: string | null;
}

interface Entry {
  meta: ProjectMeta;
  stats: DocStats;
}

const STATUSES: readonly ProjectStatus[] = ["active", "settled"];
const MAX_NAME_LENGTH = 200;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function isMeta(v: unknown, id: string): v is ProjectMeta {
  if (!isObject(v)) return false;
  return (
    v.id === id &&
    STATUSES.includes(v.status as ProjectStatus) &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number" &&
    (v.settledAt === null || typeof v.settledAt === "number")
  );
}

function parseName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "The name must be a string.");
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new HttpError(400, "The name can't be empty.");
  return name;
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

function statsOf(doc: Project): DocStats {
  return {
    name: doc.name,
    aspectRatio: doc.settings.aspectRatio,
    duration: projectDuration(doc),
    clipCount: doc.clips.length,
    coverAssetId: firstVideoClip(doc)?.assetId ?? null,
  };
}

/** The earliest clip on any video track (the bottom-most track wins a tie). */
function firstVideoClip(doc: Project) {
  const layer = (trackId: string) => doc.tracks.findIndex((t) => t.id === trackId);
  return doc.clips
    .filter((c) => isOnVideoTrack(doc, c))
    .sort((a, b) => a.start - b.start || layer(b.trackId) - layer(a.trackId))[0];
}

/**
 * Projects on disk under `data/projects/<id>/` (`project.json` + `meta.json`),
 * with their summaries cached in memory. Documents are always normalised
 * against the project's own media.
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
      const meta = await readJson<unknown>(this.metaFile(entry.name));
      if (!isMeta(meta, entry.name)) {
        console.warn(`[projects] skipping ${entry.name}: missing or invalid meta.json`);
        continue;
      }
      this.entries.set(meta.id, { meta, stats: statsOf(await this.readDoc(meta.id)) });
    }
  }

  has(id: string): boolean {
    return isValidId(id) && this.entries.has(id);
  }

  /** Most recently updated first. */
  list(): ProjectSummary[] {
    return [...this.entries.values()]
      .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
      .map((e) => this.toSummary(e));
  }

  summary(id: string): ProjectSummary {
    return this.toSummary(this.entry(id));
  }

  async get(id: string): Promise<Project> {
    this.entry(id);
    return this.readDoc(id);
  }

  async create(body: unknown): Promise<ProjectSummary> {
    const input = body ?? {};
    if (!isObject(input)) throw new HttpError(400, "Expected { name? }.");
    const name = input.name === undefined ? "Untitled" : parseName(input.name);
    return this.add(createId("project"), { ...createDefaultProject(), name }, this.now());
  }

  /** Commit a new project with the given document and timestamps (`updatedAt` = `createdAt`). */
  async add(id: string, doc: Project, createdAt: number): Promise<ProjectSummary> {
    const meta: ProjectMeta = { id, status: "active", createdAt, updatedAt: createdAt, settledAt: null };
    await this.writes(async () => {
      await fs.mkdir(this.paths.projectDir(id), { recursive: true });
      await writeJson(this.docFile(id), doc);
      await writeJson(this.metaFile(id), meta);
      this.entries.set(id, { meta, stats: statsOf(this.normalize(id, doc)) });
    });
    return this.summary(id);
  }

  /** Replace the document (normalised against the project's media). */
  async save(id: string, input: unknown): Promise<ProjectSummary> {
    this.entry(id);
    if (!isObject(input)) throw new HttpError(400, "Expected a project object.");
    let doc: Project;
    try {
      doc = this.normalize(id, input as unknown as Project);
    } catch {
      throw new HttpError(400, "The project is malformed.");
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
      const doc = name === undefined ? undefined : { ...(await this.readDoc(id)), name };
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
  private async write(id: string, { doc, patch }: { doc?: Project; patch?: Partial<ProjectMeta> }) {
    const current = this.entry(id);
    const meta: ProjectMeta = { ...current.meta, ...patch };
    if (doc) {
      meta.updatedAt = this.now();
      await writeJson(this.docFile(id), doc);
    }
    await writeJson(this.metaFile(id), meta);
    this.entries.set(id, { meta, stats: doc ? statsOf(doc) : current.stats });
  }

  private toSummary({ meta, stats: { coverAssetId, ...stats } }: Entry): ProjectSummary {
    const thumbnail = coverAssetId ? (this.library.find(coverAssetId)?.poster ?? null) : null;
    return { ...meta, ...stats, thumbnail };
  }

  private normalize(id: string, doc: Project): Project {
    return normalizeProject(doc, this.library.byId(id));
  }

  /** The saved document, normalised (a default one if it's missing or corrupt). */
  private async readDoc(id: string): Promise<Project> {
    const saved = await readJson<Project>(this.docFile(id));
    if (!isObject(saved)) return createDefaultProject();
    try {
      return this.normalize(id, saved);
    } catch {
      return createDefaultProject();
    }
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
