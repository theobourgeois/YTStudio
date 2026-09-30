import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Ids look like `media_0123456789ab` (see `createId` in shared/timeline.ts). */
const ID_RE = /^[a-z]{2,8}_[0-9a-f]{12}$/;

export const isValidId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const MAX_NAME_LENGTH = 200;

/** A user-given name (project, Library folder...): one line, trimmed. Throws `HttpError(400)`. */
export function parseName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "The name must be a string.");
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new HttpError(400, "The name can't be empty.");
  return name;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Filesystem layout of the data directory. */
export class DataPaths {
  constructor(readonly root: string) {}

  get media() {
    return path.join(this.root, "media");
  }
  get exports() {
    return path.join(this.root, "exports");
  }
  get tmp() {
    return path.join(this.root, "tmp");
  }
  get projects() {
    return path.join(this.root, "projects");
  }
  /** Audio downloaded from the web, shared by every project (`<cache key>.<ext>`, see web-media.ts). */
  get music() {
    return path.join(this.root, "music");
  }
  /** App settings that aren't part of a project (API keys). */
  get settingsFile() {
    return path.join(this.root, "settings.json");
  }
  /** The Library shared by every project: `library.json` (folders and items) and `media/<id>/`. */
  get library() {
    return path.join(this.root, "library");
  }
  get libraryMedia() {
    return path.join(this.library, "media");
  }
  get libraryFile() {
    return path.join(this.library, "library.json");
  }
  /** The audio engine's own files: the plugins it has found, and plugin states. */
  get engine() {
    return path.join(this.root, "engine");
  }
  /** The single project saved before multi-project support (migrated on startup). */
  get legacyProject() {
    return path.join(this.root, "project.json");
  }

  projectDir(id: string) {
    if (!isValidId(id)) throw new HttpError(400, "Invalid project id");
    return path.join(this.projects, id);
  }
  exportFile(id: string) {
    if (!isValidId(id)) throw new HttpError(400, "Invalid export id");
    return path.join(this.exports, `${id}.mp4`);
  }
  tmpFile(suffix: string) {
    return path.join(this.tmp, `${Date.now()}-${randomBytes(6).toString("hex")}${suffix}`);
  }

  async init() {
    await Promise.all([this.media, this.projects, this.exports, this.music, this.libraryMedia].map((d) => fs.mkdir(d, { recursive: true })));
    // Anything left in tmp belongs to an upload or render that died with the server.
    await fs.rm(this.tmp, { recursive: true, force: true });
    await fs.mkdir(this.tmp, { recursive: true });
  }
}

/** Write JSON atomically (temp file + rename) so readers never see a partial file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Parsed JSON, or `null` if the file is missing or corrupt. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}
