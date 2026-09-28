import { createDefaultProject, normalizeProject } from "../shared/timeline.ts";
import type { MediaAsset, Project } from "../shared/types.ts";
import { createLimiter } from "./queue.ts";
import { HttpError, readJson, writeJson } from "./storage.ts";

/** The single saved project (`data/project.json`), always normalised against the library. */
export class ProjectStore {
  /** Serialise writes so an older save can never land after a newer one. */
  private writes = createLimiter(1);

  constructor(
    private file: string,
    private assets: () => Record<string, MediaAsset>,
  ) {}

  async load(): Promise<Project> {
    const saved = await readJson<Project>(this.file);
    if (!saved || typeof saved !== "object") return createDefaultProject();
    try {
      return normalizeProject(saved, this.assets());
    } catch {
      return createDefaultProject();
    }
  }

  async save(input: unknown): Promise<void> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new HttpError(400, "Expected a project object.");
    }
    let project: Project;
    try {
      project = normalizeProject(input as Project, this.assets());
    } catch {
      throw new HttpError(400, "The project is malformed.");
    }
    await this.writes(() => writeJson(this.file, project));
  }
}
