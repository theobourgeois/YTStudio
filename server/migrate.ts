import fs from "node:fs/promises";
import { createDefaultProject, createId } from "../shared/timeline.ts";
import type { Project } from "../shared/types.ts";
import { normalizeProject } from "../shared/normalize.ts";
import type { MediaLibrary } from "./media.ts";
import type { ProjectStore } from "./projects.ts";
import { type DataPaths, readJson } from "./storage.ts";

/**
 * Move pre-project data into a project (idempotent; never deletes user files):
 * - a legacy `data/project.json` becomes a project dated by the file's mtime and
 *   is then renamed to `project.json.migrated`;
 * - media that doesn't belong to an existing project (saved before projects, or
 *   left over from an interrupted migration) is tagged with that project, or with
 *   a new "Imported media" project if there's no legacy file.
 */
export async function migrateLegacyData(
  paths: DataPaths,
  library: MediaLibrary,
  projects: ProjectStore,
): Promise<void> {
  const legacy = await fs.stat(paths.legacyProject).catch(() => null);
  const unowned = library.list().filter((a) => !(a.projectId && projects.has(a.projectId)));
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

  // Tag the media first so the new project's summary sees its clips' assets.
  const id = createId("project");
  await library.assign(unowned.map((a) => a.id), id);
  await projects.add(id, "video", doc, legacy ? Math.round(legacy.mtimeMs) : Date.now());
  if (legacy) {
    // Keep any earlier backup rather than overwriting it.
    const backup = `${paths.legacyProject}.migrated`;
    const taken = await fs.stat(backup).then(() => true, () => false);
    await fs.rename(paths.legacyProject, taken ? `${backup}-${Date.now()}` : backup);
  }
  console.log(
    `[migrate] moved ${legacy ? "project.json" : "untagged media"} into project ${id} ` +
      `(${unowned.length} media file${unowned.length === 1 ? "" : "s"})`,
  );
}
