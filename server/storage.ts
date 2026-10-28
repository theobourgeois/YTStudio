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

  /** Where project media lived before projects were files (`<id>/`): migrated into their packages on startup. */
  get media() {
    return path.join(this.root, "media");
  }
  get exports() {
    return path.join(this.root, "exports");
  }
  get tmp() {
    return path.join(this.root, "tmp");
  }
  /** Where projects lived before they were files of their own (`<id>/`): migrated on startup (`migrate.ts`). */
  get projects() {
    return path.join(this.root, "projects");
  }
  /** The projects this computer has opened (`ProjectStore`): their paths, newest first, and where new ones go. */
  get recentsFile() {
    return path.join(this.root, "projects.json");
  }
  /** Each suite's starting point, a hidden project package (`<id>.ytvid/`, its suite's extension). */
  get templates() {
    return path.join(this.root, "templates");
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
  /** The music suite's Browser: the sample folders added to it and their favourites, for every project. */
  get browserFile() {
    return path.join(this.root, "browser.json");
  }
  /** The visualizer's model search's keys (Poly Pizza's, Sketchfab's), as entered in the app: `ModelSearch`. */
  get modelKeysFile() {
    return path.join(this.root, "model-keys.json");
  }
  /** The Serum player's library: the preset folders added to it (Settings › Music), for every project. */
  get serumLibraryFile() {
    return path.join(this.root, "serum-library.json");
  }
  /** Now Playing's visualizer: the looks rated (loved, binned, skipped), every rating in the order given. */
  get lookRatingsFile() {
    return path.join(this.root, "look-ratings.json");
  }
  /** The audio engine's own files: the plugins it has found, and plugin states. */
  get engine() {
    return path.join(this.root, "engine");
  }
  /** The single project saved before multi-project support (migrated on startup). */
  get legacyProject() {
    return path.join(this.root, "project.json");
  }

  /** A project's folder in the old layout (migration, and the audio engine on its own in tests). */
  projectDir(id: string) {
    if (!isValidId(id)) throw new HttpError(400, "Invalid project id");
    return path.join(this.projects, id);
  }
  /** An export's file: `<id>.<extension>` (mp4, mov or zip). */
  exportFile(id: string, extension = "mp4") {
    if (!isValidId(id)) throw new HttpError(400, "Invalid export id");
    if (!/^[a-z0-9]+$/.test(extension)) throw new HttpError(400, "Invalid export file type");
    return path.join(this.exports, `${id}.${extension}`);
  }
  tmpFile(suffix: string) {
    return path.join(this.tmp, `${Date.now()}-${randomBytes(6).toString("hex")}${suffix}`);
  }

  async init() {
    await Promise.all([this.exports, this.music, this.libraryMedia, this.templates].map((d) => fs.mkdir(d, { recursive: true })));
    // Anything left in tmp belongs to an upload or render that died with the server.
    await fs.rm(this.tmp, { recursive: true, force: true });
    await fs.mkdir(this.tmp, { recursive: true });
  }
}

/** Errors Windows gives a rename onto a file someone has open for a moment (Defender, the indexer, a reader). */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * `fs.rename`, tried again for up to about a second while Windows says the target is in use: replacing a
 * file that's being scanned or read fails there, where macOS just replaces it. (graceful-fs does the same.)
 */
export async function renameRetrying(from: string, to: string, rename: (a: string, b: string) => Promise<void> = fs.rename): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !code || !TRANSIENT.has(code) || attempt >= 10) throw err;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

/** Write JSON atomically (temp file + rename) so readers never see a partial file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await renameRetrying(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** Errors that say the disk (or the user's quota on it) is full. */
const FULL = new Set(["ENOSPC", "EDQUOT"]);

/**
 * A write that failed because the disk is full, as a 507 the tab can show (what was there before is intact);
 * anything else as it was.
 */
export function diskError(err: unknown, file: string): unknown {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (!code || !FULL.has(code)) return err;
  return new HttpError(507, `The disk is full: ${path.basename(file)} couldn't be written. Free some space and it will be saved; nothing saved before was changed.`);
}

/**
 * Flushes a folder's entries (a file renamed into it) to the disk. POSIX only: Windows can't open a folder, and
 * NTFS journals renames itself.
 */
export async function syncFolder(dir: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await fs.open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Written to a temporary file, flushed, renamed into place and its folder flushed (and the folders made for it):
 * whole or absent even after a crash or a power loss, and there once this resolves. A full disk is a 507.
 */
export async function writeFileDurably(file: string, data: Uint8Array | string): Promise<void> {
  const dir = path.dirname(file);
  const made = await fs.mkdir(dir, { recursive: true }).catch((err) => {
    throw diskError(err, file);
  });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameRetrying(tmp, file);
    await syncFolder(dir);
    // New folders are entries in their parents: flushed too, from the first one made.
    if (made) {
      const top = path.dirname(made);
      for (let folder = path.dirname(dir); ; folder = path.dirname(folder)) {
        await syncFolder(folder);
        if (folder === top || folder === path.dirname(folder)) break;
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw diskError(err, file);
  }
}

/** `writeJson`, durably (`writeFileDurably`): for documents that promise they're on the disk once saved. */
export const writeJsonDurably = (file: string, data: unknown) => writeFileDurably(file, JSON.stringify(data));

/** Parsed JSON, or `null` if the file is missing or corrupt. */
export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}
