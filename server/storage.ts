import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Ids look like `media_0123456789ab` (see `createId` in shared/timeline.ts). */
const ID_RE = /^[a-z]{2,8}_[0-9a-f]{12}$/;

export const isValidId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

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
  /** Songs downloaded from YouTube, shared by every project (`<track id>.<ext>`). */
  get music() {
    return path.join(this.root, "music");
  }
  /** The single project saved before multi-project support (migrated on startup). */
  get legacyProject() {
    return path.join(this.root, "project.json");
  }

  mediaDir(id: string) {
    if (!isValidId(id)) throw new HttpError(400, "Invalid media id");
    return path.join(this.media, id);
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
    await Promise.all([this.media, this.projects, this.exports, this.music].map((d) => fs.mkdir(d, { recursive: true })));
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
