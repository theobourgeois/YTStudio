import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeProject } from "../shared/normalize.ts";
import { DEFAULT_PROJECT_NAME } from "../shared/suites.ts";
import { createDefaultProject, createId } from "../shared/timeline.ts";
import type { MediaAsset, Project } from "../shared/types.ts";
import { PROJECT_EXTENSION, movePath, uniquePackage } from "./packages.ts";
import { type DataPaths, isObject, isValidId, readJson, writeJson } from "./storage.ts";
import { log } from "./log.ts";

const logger = log("migrate");

/**
 * Bring older data folders up to date before anything loads (idempotent; never deletes user files):
 * 1. pre-project data (`migrateLegacyData`) becomes a project of the old layout;
 * 2. projects of the old layout (`data/projects/<id>/`, their media in `data/media/<id>/`) become packages
 *    (`migrateToPackages`): in `location`, or the data folder's `templates/` for a suite's starting point.
 */
export async function migrateData(paths: DataPaths, location: string): Promise<void> {
  await migrateLegacyData(paths, location);
  await migrateToPackages(paths, location);
}

/** The old layout's media (`data/media/<id>/meta.json`). */
async function oldMedia(paths: DataPaths): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  for (const entry of await fs.readdir(paths.media, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    const asset = await readJson<MediaAsset>(path.join(paths.media, entry.name, "meta.json"));
    if (asset?.id === entry.name) assets.push(asset);
  }
  return assets;
}

/** Where a project of the old layout is put together into its package (`.migrating-<id>`), so a crash can carry on. */
const partialDir = (parent: string, id: string) => path.join(parent, `.migrating-${id}`);

/** Old-layout projects: their folders, and packages half made by a migration that stopped. */
async function oldProjectIds(paths: DataPaths, location: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const entry of await fs.readdir(paths.projects, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && isValidId(entry.name)) ids.add(entry.name);
  }
  for (const parent of [location, paths.templates]) {
    for (const entry of await fs.readdir(parent, { withFileTypes: true }).catch(() => [])) {
      const id = entry.name.startsWith(".migrating-") ? entry.name.slice(".migrating-".length) : "";
      if (entry.isDirectory() && isValidId(id)) ids.add(id);
    }
  }
  return ids;
}

/**
 * Move pre-project data into a project of the old layout:
 * - a legacy `data/project.json` becomes a project dated by the file's mtime and
 *   is then renamed to `project.json.migrated`;
 * - media that doesn't belong to an existing project (saved before projects, or
 *   left over from an interrupted migration) is tagged with that project, or with
 *   a new "Imported media" project if there's no legacy file.
 */
async function migrateLegacyData(paths: DataPaths, location: string): Promise<void> {
  const legacy = await fs.stat(paths.legacyProject).catch(() => null);
  // Projects of the old layout, and ones half moved into their packages, which still own the media left to move.
  const owners = await oldProjectIds(paths, location);
  const unowned = (await oldMedia(paths)).filter((a) => !(a.projectId && owners.has(a.projectId)));
  if (!legacy && !unowned.length) return;

  let doc: Project = { ...createDefaultProject(), name: "Imported media" };
  if (legacy) {
    const saved = await readJson<Project>(paths.legacyProject);
    try {
      doc = normalizeProject(saved ?? createDefaultProject());
    } catch {
      doc = createDefaultProject();
    }
  }

  // Tag the media first, then commit the project (its meta.json last).
  const id = createId("project");
  for (const asset of unowned) await writeJson(path.join(paths.media, asset.id, "meta.json"), { ...asset, projectId: id });
  const dir = path.join(paths.projects, id);
  await fs.mkdir(dir, { recursive: true });
  const createdAt = legacy ? Math.round(legacy.mtimeMs) : Date.now();
  await writeJson(path.join(dir, "project.json"), doc);
  await writeJson(path.join(dir, "meta.json"), { id, suite: "video", createdAt, updatedAt: createdAt });
  if (legacy) {
    // Keep any earlier backup rather than overwriting it.
    const backup = `${paths.legacyProject}.migrated`;
    const taken = await fs.stat(backup).then(() => true, () => false);
    await fs.rename(paths.legacyProject, taken ? `${backup}-${Date.now()}` : backup);
  }
  logger.info(
    `moved ${legacy ? "project.json" : "untagged media"} into project ${id} ` +
      `(${unowned.length} media file${unowned.length === 1 ? "" : "s"})`,
  );
}

/**
 * Make each project of the old layout a package: its media, then its files (meta.json last) are moved into
 * `.migrating-<id>`, which is then given the project's name and added to the recents (`data/projects.json`,
 * opened when it was last saved). Settled projects are recents like the others.
 */
async function migrateToPackages(paths: DataPaths, location: string): Promise<void> {
  const ids = await oldProjectIds(paths, location);
  if (!ids.size) return;
  const media = await oldMedia(paths);
  const saved = await readJson<{ location?: unknown; recent?: unknown[] }>(paths.recentsFile);
  const recent: unknown[] = Array.isArray(saved?.recent) ? saved.recent : [];
  let moved = 0;

  for (const id of ids) {
    const oldDir = path.join(paths.projects, id);
    const meta = (await readJson<Record<string, unknown>>(path.join(oldDir, "meta.json"))) ?? null;
    const template = meta ? meta.template === true : existsSync(partialDir(paths.templates, id));
    const parent = template ? paths.templates : location;
    const partial = partialDir(parent, id);
    await fs.mkdir(path.join(partial, "media"), { recursive: true });
    for (const asset of media.filter((a) => a.projectId === id)) {
      const target = path.join(partial, "media", asset.id);
      if (!existsSync(target)) await movePath(path.join(paths.media, asset.id), target);
    }
    for (const file of await fs.readdir(oldDir).catch(() => [])) {
      if (file !== "meta.json") await movePath(path.join(oldDir, file), path.join(partial, file));
    }
    if (existsSync(path.join(oldDir, "meta.json"))) await movePath(path.join(oldDir, "meta.json"), path.join(partial, "meta.json"));
    await fs.rm(oldDir, { recursive: true, force: true });

    const committed = await readJson<Record<string, unknown>>(path.join(partial, "meta.json"));
    if (!isObject(committed)) {
      // Never committed (its project.json without a meta.json): nothing to keep but its files, left as they are.
      logger.warn(`${id} had no meta.json: its files are in ${partial}`);
      continue;
    }
    const { status: _status, settledAt: _settledAt, template: _template, ...rest } = committed;
    await writeJson(path.join(partial, "meta.json"), rest);
    const doc = await readJson<{ name?: unknown }>(path.join(partial, "project.json"));
    const name = typeof doc?.name === "string" ? doc.name : DEFAULT_PROJECT_NAME;
    const dir = template ? path.join(parent, `${id}${PROJECT_EXTENSION}`) : uniquePackage(parent, name);
    await fs.rename(partial, dir);
    if (!template) {
      const updatedAt = typeof rest.updatedAt === "number" ? rest.updatedAt : Date.now();
      // What's known of it (`ProjectStore` works out the rest when it loads it).
      const summary = { id, suite: rest.suite ?? "video", name, createdAt: rest.createdAt ?? updatedAt, updatedAt, openedAt: updatedAt, path: dir, duration: 0, thumbnail: null };
      recent.push({ id, path: dir, openedAt: updatedAt, summary });
      await writeJson(paths.recentsFile, { ...saved, recent });
    }
    moved++;
  }
  // The old layout's folders, if nothing else is in them.
  await fs.rmdir(paths.projects).catch(() => {});
  if (!(await oldMedia(paths)).length) await fs.rm(paths.media, { recursive: true, force: true }).catch(() => {});
  if (moved) logger.info(`made ${moved} project${moved === 1 ? "" : "s"} into packages in ${location}`);
}
