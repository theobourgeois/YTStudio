/**
 * Serum's preset library, as the Serum player's browser lists it (`docs/serum/player.md` §3.2): every `.SerumPreset`
 * and `.fxp` in Serum 2's preset folder (and Serum 1's, when Serum links it), with Serum's own categories, tags and
 * ratings from its index (`System/presets.db`). Stars set here are written back there, so Serum shows them too.
 * Files are read once and again only when they change.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { type SerumPresetEntry, serumCategory } from "../../../shared/music/serum-presets.ts";
import { HttpError } from "../../storage.ts";
import { log } from "../../log.ts";

const logger = log("serum-library");
const EXTENSIONS = new Set([".serumpreset", ".fxp"]);

/** Where Serum 2 keeps its presets (the folder holding `Presets` and `System`), and Serum 1's folder if Serum links it. */
export interface SerumLibraryPlaces {
  /** Serum 2's preset folder ("Serum 2 Presets"), or null if Serum 2 isn't installed. */
  serum2: string | null;
  /** Serum 1's presets ("Serum Presets/Presets"), listed when Serum 2 links them and they're there. */
  serum1: string | null;
}

/** Serum 2's preferences file, where it keeps its preset folder. */
function preferencesFile(): string | null {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Preferences", "Serum2Prefs.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Xfer", "Serum 2", "Serum2Prefs.json");
  return null;
}

const isDirectory = (dir: string) => fs.stat(dir).then((s) => s.isDirectory(), () => false);

/** Where this computer's Serum keeps its presets, as its preferences say (else where it installs them). */
export async function findSerumLibrary(): Promise<SerumLibraryPlaces> {
  let prefs: Record<string, unknown> = {};
  const file = preferencesFile();
  if (file) {
    try {
      prefs = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      // A fresh install may have none yet.
    }
  }
  const candidates = [
    typeof prefs["Serum Presets Path"] === "string" ? prefs["Serum Presets Path"] : null,
    process.platform === "darwin" ? "/Library/Audio/Presets/Xfer Records/Serum 2 Presets" : null,
    process.platform === "win32" ? path.join(os.homedir(), "Documents", "Xfer", "Serum 2 Presets") : null,
  ].filter((dir): dir is string => Boolean(dir));
  let serum2: string | null = null;
  for (const dir of candidates) if (await isDirectory(path.join(dir, "Presets"))) {
    serum2 = dir;
    break;
  }
  // Serum 1's own folder, where Serum 2 looks for it when "Link to S1 Presets" is on (its default).
  const linked = prefs["Link to S1 Presets"] !== false;
  const serum1Dir = path.join(os.homedir(), "Documents", "Serum Presets", "Presets");
  return { serum2, serum1: linked && (await isDirectory(serum1Dir)) ? serum1Dir : null };
}

/** A `.SerumPreset`'s header (`XferJson\0`, a u64 length, then JSON), without its settings. */
async function readPresetHeader(file: string): Promise<Record<string, unknown>> {
  const handle = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(17);
    await handle.read(head, 0, 17, 0);
    if (head.subarray(0, 9).toString("latin1") !== "XferJson\0") throw new Error("not a Serum 2 preset");
    const length = Number(head.readBigUInt64LE(9));
    if (length <= 0 || length > 1 << 20) throw new Error("its header is too long");
    const json = Buffer.alloc(length);
    await handle.read(json, 0, length, 17);
    return JSON.parse(json.toString("utf8"));
  } finally {
    await handle.close();
  }
}

/**
 * What Serum keys a Serum 1 preset's rating by: the MD5 of the file's first N bytes, N being the length of its
 * compressed settings (the zlib stream at the start of its chunk). Checked against Serum 1's and Serum 2's indexes.
 */
export function serum1Hash(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 60 || buffer.subarray(0, 4).toString("latin1") !== "CcnK" || buffer.subarray(16, 20).toString("latin1") !== "XfsX")
    throw new Error("not a Serum 1 preset");
  const chunk = buffer.subarray(60, 60 + buffer.readUInt32BE(56));
  // Where the compressed stream ends: what's after it is left over once it's inflated.
  const { engine, buffer: _ } = inflateSync(chunk, { info: true }) as unknown as { engine: { bytesWritten: number }; buffer: Buffer };
  return createHash("md5").update(buffer.subarray(0, engine.bytesWritten)).digest("hex");
}

/** What Serum's index says of a preset (by its folder and name). */
interface IndexEntry {
  category: string;
  author: string;
  description: string;
  tags: string[];
}

type Database = import("node:sqlite").DatabaseSync;

async function openDatabase(file: string, readOnly: boolean): Promise<Database | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
    // Serum may be writing it (a Serum open in the engine or a DAW): wait for it rather than fail.
    db.exec("PRAGMA busy_timeout = 3000");
    return db;
  } catch {
    return null;
  }
}

interface CachedFile {
  mtimeMs: number;
  size: number;
  entry: Omit<SerumPresetEntry, "rating" | "category"> & { serumCategory: string | null };
}

export class SerumLibrary {
  private cache = new Map<string, CachedFile>();
  private places: Promise<SerumLibraryPlaces>;

  /** `places`: where to look (tests and e2e give their own); found as Serum's preferences say otherwise. */
  constructor(places?: SerumLibraryPlaces | Promise<SerumLibraryPlaces>) {
    this.places = places ? Promise.resolve(places) : findSerumLibrary();
  }

  /** The folders listed, each with whether its presets are Serum 1's. */
  private async roots(): Promise<{ dir: string; kind: SerumPresetEntry["kind"] }[]> {
    const { serum2, serum1 } = await this.places;
    return [...(serum2 ? [{ dir: path.join(serum2, "Presets"), kind: "serum2" as const }] : []), ...(serum1 ? [{ dir: serum1, kind: "serum1" as const }] : [])];
  }

  private async databaseFile(): Promise<string | null> {
    const { serum2 } = await this.places;
    return serum2 ? path.join(serum2, "System", "presets.db") : null;
  }

  /** Whether Serum's library is on this computer at all. */
  async available(): Promise<boolean> {
    return (await this.roots()).length > 0;
  }

  /** Every preset, with Serum's ratings as they are now. */
  async list(): Promise<SerumPresetEntry[]> {
    const files: { file: string; folder: string; root: string }[] = [];
    for (const { dir } of await this.roots()) await walk(dir, dir, files);
    const seen = new Set<string>();
    const entries: CachedFile["entry"][] = [];
    // A few at a time: a fresh index reads a thousand files.
    for (let i = 0; i < files.length; i += 32)
      for (const read of await Promise.all(files.slice(i, i + 32).map((f) => this.read(f.file, f.folder)))) if (read) entries.push(read);
    for (const f of files) seen.add(f.file);
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);

    const { index, ratings } = await this.readDatabase();
    return entries.map(({ serumCategory: own, ...entry }) => {
      const indexed = index.get(indexKey(entry.folder, entry.name, entry.kind));
      return {
        ...entry,
        author: entry.author || indexed?.author || "",
        description: entry.description || indexed?.description || "",
        tags: entry.tags.length ? entry.tags : (indexed?.tags ?? []),
        category: serumCategory(entry.name, indexed?.category || own, entry.folder),
        rating: ratings.get(entry.hash) ?? 0,
      };
    });
  }

  /** One file's entry, from the cache while it hasn't changed. Null (and logged) if it can't be read. */
  private async read(file: string, folder: string): Promise<CachedFile["entry"] | null> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return null;
    }
    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entry;
    try {
      const entry = file.toLowerCase().endsWith(".fxp") ? await readSerum1(file, folder) : await readSerum2(file, folder);
      this.cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
      return entry;
    } catch (error) {
      logger.debug("unreadable preset", { file, error: String(error) });
      return null;
    }
  }

  /** Serum's index: what it says of each preset, and its ratings by hash. Empty if there's none. */
  private async readDatabase(): Promise<{ index: Map<string, IndexEntry>; ratings: Map<string, number> }> {
    const index = new Map<string, IndexEntry>();
    const ratings = new Map<string, number>();
    const file = await this.databaseFile();
    const db = file ? await openDatabase(file, true) : null;
    if (!db) return { index, ratings };
    try {
      const tags = new Map<number, string[]>();
      for (const row of db.prepare("SELECT pt.preset_id AS id, t.name AS name FROM Presets_Tags pt JOIN Tags t ON t.tag_id = pt.tag_id").all())
        tags.set(Number(row.id), [...(tags.get(Number(row.id)) ?? []), String(row.name)]);
      for (const row of db.prepare("SELECT p.preset_id AS id, p.name AS name, p.file_ext AS ext, p.category AS category, p.author AS author, p.description AS description, l.location AS location FROM Presets p JOIN Locations l ON l.location_id = p.location_id").all())
        index.set(indexKey(String(row.location ?? ""), String(row.name ?? ""), String(row.ext ?? "").toLowerCase() === "fxp" ? "serum1" : "serum2"), {
          category: String(row.category ?? ""),
          author: String(row.author ?? ""),
          description: String(row.description ?? ""),
          tags: (tags.get(Number(row.id)) ?? []).filter((t) => !["S1", "S2", "Preview"].includes(t)),
        });
      for (const row of db.prepare("SELECT hash, rating FROM UserData").all()) if (typeof row.hash === "string") ratings.set(row.hash, Number(row.rating) || 0);
    } catch (error) {
      logger.warn("Serum's preset index couldn't be read", { file, error: String(error) });
    } finally {
      db.close();
    }
    return { index, ratings };
  }

  /** Give a preset Serum's stars (0 takes them away), in Serum's own index so Serum shows them too. */
  async setRating(hash: string, rating: number): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(hash)) throw new HttpError(400, '"hash" must be a preset\'s hash, as the preset list gives it.');
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new HttpError(400, '"rating" must be a whole number of stars from 0 to 5.');
    const file = await this.databaseFile();
    if (!file) throw new HttpError(404, "Serum 2's preset folder isn't on this computer.");
    const db = await openDatabase(file, false);
    if (!db) throw new HttpError(503, "Serum's preset index couldn't be opened. Try again.");
    try {
      // Serum's own table, made as Serum makes it if there's none yet.
      db.exec("CREATE TABLE IF NOT EXISTS UserData ( hash TEXT NOT NULL UNIQUE, rating INTEGER)");
      if (rating === 0) db.prepare("DELETE FROM UserData WHERE hash = ?").run(hash);
      else db.prepare("INSERT INTO UserData (hash, rating) VALUES (?, ?) ON CONFLICT(hash) DO UPDATE SET rating = excluded.rating").run(hash, rating);
    } catch (error) {
      throw new HttpError(503, `Serum's preset index couldn't be written: ${String(error)}`);
    } finally {
      db.close();
    }
  }

  /** A preset file of the library's, checked: never a path outside its folders, nor anything but a preset. */
  async resolve(file: unknown): Promise<string> {
    if (typeof file !== "string" || !path.isAbsolute(file)) throw new HttpError(400, '"path" must be a preset\'s path, as the preset list gives it.');
    const resolved = path.resolve(file);
    const inside = (await this.roots()).some(({ dir }) => resolved.startsWith(path.resolve(dir) + path.sep));
    if (!inside || !EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new HttpError(400, "That isn't a preset in Serum's preset folder.");
    if (!(await fs.stat(resolved).then((s) => s.isFile(), () => false))) throw new HttpError(404, "That preset isn't there any more.");
    return resolved;
  }
}

/** The key a preset is found by in Serum's index: its folder in the library, its name, its kind. */
const indexKey = (folder: string, name: string, kind: string) => `${folder}\n${name}\n${kind}`.toLowerCase();

/** Every preset file under `dir`, with its folder relative to `root`. Hidden files and folders are skipped. */
async function walk(dir: string, root: string, out: { file: string; folder: string; root: string }[]): Promise<void> {
  let items;
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full, root, out);
    else if (item.isFile() && EXTENSIONS.has(path.extname(item.name).toLowerCase()))
      out.push({ file: full, folder: path.relative(root, dir).split(path.sep).join("/"), root });
  }
}

async function readSerum2(file: string, folder: string): Promise<CachedFile["entry"]> {
  const meta = await readPresetHeader(file);
  if (typeof meta.hash !== "string") throw new Error("its header has no hash");
  const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string).trim() : "");
  return {
    path: file,
    // Serum lists a preset by its file's name (its index too), whatever the preset calls itself.
    name: path.basename(file, path.extname(file)),
    author: text("presetAuthor"),
    description: text("presetDescription"),
    tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string" && !["S1", "S2", "Preview"].includes(t)) : [],
    folder,
    kind: "serum2",
    hash: meta.hash,
    serumCategory: null,
  };
}

async function readSerum1(file: string, folder: string): Promise<CachedFile["entry"]> {
  const bytes = await fs.readFile(file);
  return {
    path: file,
    name: path.basename(file, path.extname(file)),
    author: "",
    description: "",
    tags: [],
    folder,
    kind: "serum1",
    hash: serum1Hash(bytes),
    serumCategory: null,
  };
}
