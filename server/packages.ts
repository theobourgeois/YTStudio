/**
 * A project is a folder of its own, a package (`Summer edit.vaudio/`): its document (`project.json`), what
 * kind it is (`meta.json`), its media (`media/<id>/`) and whatever its suite keeps beside them (a song's
 * `plugins/` and `recordings/`). Finder shows it as one file in the desktop app, which declares the type.
 * These are the file-level helpers: names, unique paths, moves across volumes and the Trash.
 */
import { constants as fsConstants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROJECT_NAME } from "../shared/suites.ts";

export const PROJECT_EXTENSION = ".vaudio";

/** Longest file name kept from a project's name (file systems allow 255 bytes, and " 2" may follow). */
const MAX_FILE_NAME = 120;

/** A project's name as a file name: no path separators (Finder shows ":" as "/"), no leading dot (hidden). */
export function fileName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[/\\:]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, MAX_FILE_NAME)
    .trim();
  return clean || DEFAULT_PROJECT_NAME;
}

/** The project's name as its folder says it ("Summer edit" for ".../Summer edit.vaudio"). */
export function packageName(dir: string): string {
  const base = path.basename(dir);
  return base.toLowerCase().endsWith(PROJECT_EXTENSION) ? base.slice(0, -PROJECT_EXTENSION.length) : base;
}

/** Whether a folder is named after a project, as `uniquePackage` names them ("Name", or "Name 2" if that was taken). */
export function namedAfter(dir: string, name: string): boolean {
  const base = packageName(dir);
  const wanted = fileName(name);
  if (base === wanted) return true;
  return base.startsWith(`${wanted} `) && /^\d+$/.test(base.slice(wanted.length + 1));
}

/** Two paths that name the same file here (macOS's disks don't tell case apart, by default). */
export function samePath(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === "darwin" || process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * A free path for a project called `name` in `parent`: `Name.vaudio`, else `Name 2.vaudio`... `except` is the
 * project's own folder, which it may keep (renaming it to the name it has).
 */
export function uniquePackage(parent: string, name: string, except?: string): string {
  const base = fileName(name);
  for (let n = 1; ; n++) {
    const candidate = path.join(parent, `${base}${n === 1 ? "" : ` ${n}`}${PROJECT_EXTENSION}`);
    if ((except && samePath(candidate, except)) || !existsSync(candidate)) return candidate;
  }
}

/** Move a file or folder, copying it (cloned where the disk can) when it goes to another volume. */
export async function movePath(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(from, to, { recursive: true, mode: fsConstants.COPYFILE_FICLONE, errorOnExist: true, force: false });
    await fs.rm(from, { recursive: true, force: true, maxRetries: 5 });
  }
}

/**
 * Put a project in the user's Trash (a Mac's `~/.Trash`; elsewhere it's deleted). The desktop app passes
 * Electron's own, which Finder's Put Back understands.
 */
export async function moveToTrash(target: string): Promise<void> {
  const trash = path.join(os.homedir(), ".Trash");
  if (process.platform !== "darwin" || !existsSync(trash)) {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5 });
    return;
  }
  const ext = path.extname(target);
  const stem = path.basename(target, ext);
  let destination = path.join(trash, path.basename(target));
  for (let n = 2; existsSync(destination); n++) destination = path.join(trash, `${stem} ${n}${ext}`);
  await movePath(target, destination);
}

/** Whether `child` is inside `parent` (or is it). */
export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
