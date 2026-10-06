/**
 * A photo's recovery (docs/photo/architecture.md, "Persistence and the package"). Every save keeps the document it
 * replaces as the checkpoint (`photo/recovery/previous.json`), which passed the publication gate when it was saved.
 * Opening checks that the saved document's pixels are all in the package; when some aren't (deleted or damaged
 * outside the app, a partial copy), the document is set aside in `photo/recovery/` and the checkpoint opens instead,
 * or, if it's no better, the document opens with only the lost pixels emptied. Every document in `photo/recovery/`
 * is a root of collection, so what's left of a set-aside one's pixels is kept.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { setMask, setSurface } from "../../shared/photo/edits.ts";
import { normalizePhotoProject } from "../../shared/photo/project.ts";
import { documentSurfaces } from "../../shared/photo/surfaces.ts";
import type { PhotoProject } from "../../shared/photo/types.ts";
import { renameRetrying, syncFolder, writeFileDurably } from "../storage.ts";
import { BlobStore, type IncompleteSurface } from "./blobs.ts";
import { resourcesOf } from "./service.ts";

const DOC_FILE = "project.json";
const CHECKPOINT = "previous.json";

/** Where a package keeps the documents it may be recovered from. */
export const recoveryOf = (dir: string) => path.join(dir, "photo", "recovery");

/**
 * Before a save replaces `project.json`: it becomes the checkpoint. Linked, not copied (the save renames a new file
 * over `project.json`, so the old one lives on as the checkpoint at no cost); copied where the disk can't link.
 */
export async function keepCheckpoint(dir: string): Promise<void> {
  const doc = path.join(dir, DOC_FILE);
  const folder = recoveryOf(dir);
  const checkpoint = path.join(folder, CHECKPOINT);
  const tmp = `${checkpoint}.${process.pid}.tmp`;
  await fs.mkdir(folder, { recursive: true });
  await fs.rm(tmp, { force: true });
  try {
    await fs.link(doc, tmp);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return; // nothing saved yet
    const bytes = await fs.readFile(doc);
    return writeFileDurably(checkpoint, bytes);
  }
  await renameRetrying(tmp, checkpoint);
  await syncFolder(folder);
}

/** A document kept in `photo/recovery/`, or null when it's absent or can't be read. */
async function readKept(file: string): Promise<PhotoProject | null> {
  try {
    return normalizePhotoProject(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return null;
  }
}

/** Every surface the documents in `photo/recovery/` name: collection keeps them. */
export async function recoverySurfaces(dir: string): Promise<string[]> {
  const folder = recoveryOf(dir);
  const names = await fs.readdir(folder).catch(() => [] as string[]);
  const ids: string[] = [];
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const doc = await readKept(path.join(folder, name));
    if (doc) ids.push(...documentSurfaces(doc));
  }
  return ids;
}

/** Keeps the saved document's bytes in `photo/recovery/` before it's replaced on opening. Returns its path. */
async function setAside(dir: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(recoveryOf(dir), `incomplete-${stamp}.json`);
  await writeFileDurably(file, await fs.readFile(path.join(dir, DOC_FILE)));
  return file;
}

/** The layers whose pixels or masks are among `lost`, by name, for the user. */
function layersNaming(doc: PhotoProject, lost: ReadonlySet<string>): string[] {
  return doc.layers.filter((l) => (l.kind === "pixel" && l.surface && lost.has(l.surface)) || (l.mask?.surface && lost.has(l.mask.surface))).map((l) => `"${l.name}"`);
}

const listed = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The check on opening: null when every pixel the document names is in the package. Otherwise the document to open
 * instead (the checkpoint, when all of its pixels are there, else this one with the lost pixels emptied: a pixel
 * layer empty, a mask revealing everything) and what to tell the user. The saved one is set aside first.
 */
export async function checkOnOpen(doc: PhotoProject, dir: string): Promise<{ doc: PhotoProject; notice: string } | null> {
  const blobs = new BlobStore(resourcesOf(dir));
  const incomplete = await blobs.inspect(documentSurfaces(doc));
  if (!incomplete.length) return null;
  const lost = new Set(incomplete.map((s) => s.id));
  const layers = listed(layersNaming(doc, lost));
  const why = describe(incomplete);
  const aside = path.relative(dir, await setAside(dir));
  const checkpoint = await readKept(path.join(recoveryOf(dir), CHECKPOINT));
  if (checkpoint && !(await blobs.inspect(documentSurfaces(checkpoint))).length) {
    return {
      // The name is the package's: the checkpoint's may be older.
      doc: { ...checkpoint, name: doc.name },
      notice: `Pixels of ${layers} were missing from the package (${why}), so the version saved before the last one was opened: the latest changes may be missing. The incomplete version is kept at ${aside}.`,
    };
  }
  let repaired = doc;
  for (const l of doc.layers) {
    if (l.kind === "pixel" && l.surface && lost.has(l.surface)) repaired = setSurface(repaired, l.id, null);
    if (l.mask?.surface && lost.has(l.mask.surface)) repaired = setMask(repaired, l.id, null);
  }
  return {
    doc: repaired,
    notice: `Pixels of ${layers} are missing from the package (${why}) and no earlier version has them, so they're empty now (a mask shows its whole layer). The version that named them is kept at ${aside}.`,
  };
}

function describe(incomplete: IncompleteSurface[]): string {
  const reasons = [...new Set(incomplete.map((s) => s.reason))];
  return reasons.length === 1 ? reasons[0] : reasons.join("; ");
}
