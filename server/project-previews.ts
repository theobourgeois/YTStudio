/** Cached project renditions. Only requested/visible projects are queued; one renderer runs at a time. */
import fs from "node:fs/promises";
import path from "node:path";
import type { SuiteDocument, SuiteId } from "../shared/suites.ts";
import type { ProjectPreview, TextLayoutAt } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { createLimiter } from "./queue.ts";
import type { ProjectStore } from "./projects.ts";
import { DataPaths, HttpError, readJson, writeJson } from "./storage.ts";
import { log } from "./log.ts";

const logger = log("preview");

export interface PreviewInputs { texts?: Record<string, TextLayoutAt[]> }
export type PreviewInspector = (file: string, folder: string, suite: SuiteId, signal: AbortSignal) => Promise<Pick<ProjectPreview, "duration" | "peaks">>;
export type PreviewRenderer = (id: string, doc: SuiteDocument, folder: string, signal: AbortSignal, inputs: PreviewInputs) => Promise<string | null>;
interface CachedPreview extends ProjectPreview { version: number; fingerprint: string }
const VERSION = 2;

export class ProjectPreviews {
  private limit = createLimiter(1);
  private jobs = new Map<string, { view: ProjectPreview; fingerprint: string; controller: AbortController }>();
  private stopped = false;

  constructor(private paths: DataPaths, private projects: ProjectStore, private renderers: Record<SuiteId, PreviewRenderer>, private inspect: PreviewInspector) {}

  async get(id: string): Promise<ProjectPreview> {
    const summary = this.projects.summary(id);
    const fingerprint = await this.fingerprint(id);
    const job = this.jobs.get(id);
    if (job?.fingerprint === fingerprint && job.view.revision === summary.updatedAt) return { ...job.view };
    const cached = await readJson<CachedPreview>(path.join(this.projects.dir(id), ".preview", "preview.json"));
    if (cached?.version === VERSION && cached.revision === summary.updatedAt && cached.fingerprint === fingerprint) {
      const { version: _version, fingerprint: _fingerprint, ...view } = cached;
      if (cached.state === "empty") return view;
      const extension = summary.suite === "video" ? "mp4" : "m4a";
      if (await fs.stat(path.join(this.projects.dir(id), ".preview", `preview.${extension}`)).then((s) => s.size > 0, () => false)) {
        // Finder copies a package's cache too; URLs always belong to the current project id.
        const base = `/api/projects/${id}/preview`;
        return { ...view, src: `${base}/media?v=${summary.updatedAt}`,
          ...(summary.suite === "video" ? { poster: `${base}/poster?v=${summary.updatedAt}` } : {}),
        };
      }
    }
    return { state: "idle", revision: summary.updatedAt };
  }

  async ensure(id: string, revision: number, inputs: PreviewInputs = {}): Promise<ProjectPreview> {
    if (this.stopped) throw new HttpError(503, "Preview renderer is stopping.");
    const current = await this.get(id);
    if (current.revision !== revision) throw new HttpError(409, "The project changed. Refresh its preview.");
    if (["ready", "empty", "queued", "rendering"].includes(current.state)) return current;
    const fingerprint = await this.fingerprint(id);
    const previous = this.jobs.get(id);
    if (previous?.fingerprint === fingerprint && ["queued", "rendering"].includes(previous.view.state)) return { ...previous.view };
    previous?.controller.abort();
    const job = { view: { state: "queued", revision } as ProjectPreview, fingerprint, controller: new AbortController() };
    this.jobs.set(id, job);
    void this.limit(async () => {
      if (job.controller.signal.aborted) return;
      const folder = this.paths.tmpFile("-preview");
      const { signal } = job.controller;
      job.view.state = "rendering";
      // A crashed renderer must not occupy the queue indefinitely.
      const timeout = setTimeout(() => job.controller.abort(new Error("Preview generation timed out. Try again.")), 180_000);
      try {
        const summary = this.projects.summary(id);
        if (summary.updatedAt !== revision) return;
        await fs.mkdir(folder, { recursive: true });
        const doc = await this.projects.get(id);
        const file = await this.renderers[summary.suite](id, doc, folder, signal, inputs);
        signal.throwIfAborted();
        let view: CachedPreview = { version: VERSION, fingerprint, state: "empty", revision };
        const poster = path.join(folder, "poster.jpg");
        if (file) {
          const { duration, peaks } = await this.inspect(file, folder, summary.suite, signal);
          const base = `/api/projects/${id}/preview`;
          view = { version: VERSION, fingerprint, state: "ready", revision, duration, peaks,
            src: `${base}/media?v=${revision}`,
            ...(summary.suite === "video" ? { poster: `${base}/poster?v=${revision}` } : {}),
          };
        }
        signal.throwIfAborted();
        if (this.projects.summary(id).updatedAt !== revision || await this.fingerprint(id) !== fingerprint) return;
        // Resolve the package again: it may have been renamed while rendering.
        const destination = path.join(this.projects.dir(id), ".preview");
        await fs.mkdir(destination, { recursive: true });
        if (file) await fs.copyFile(file, path.join(destination, `preview.${summary.suite === "video" ? "mp4" : "m4a"}`));
        if (view.poster) await fs.copyFile(poster, path.join(destination, "poster.jpg"));
        signal.throwIfAborted();
        if (this.jobs.get(id) !== job) return;
        await writeJson(path.join(destination, "preview.json"), view);
        job.view = view;
        if (this.jobs.get(id) === job) this.jobs.delete(id);
      } catch (err) {
        if (!this.stopped && this.jobs.get(id) === job) job.view = { state: "error", revision, error: errorMessage(err) };
      } finally {
        clearTimeout(timeout);
        await fs.rm(folder, { recursive: true, force: true });
        // Superseded work cannot leave a permanent "rendering" status.
        if (this.jobs.get(id) === job && job.view.state === "rendering") this.jobs.delete(id);
      }
    }).catch((err) => logger.error("a cover failed", err));
    return { ...job.view };
  }

  /** Plugin settings are files of their own: a knob can change without changing the document. */
  private async fingerprint(id: string): Promise<string> {
    const summary = this.projects.summary(id);
    if (summary.suite !== "music") return String(summary.updatedAt);
    const folder = path.join(this.projects.dir(id), "plugins");
    const names = await fs.readdir(folder).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
      return [] as string[];
    });
    const states = await Promise.all(names.filter((n) => n.endsWith(".bin")).sort().map(async (name) => {
      const stat = await fs.stat(path.join(folder, name));
      return [name, stat.size, stat.mtimeMs];
    }));
    return JSON.stringify([summary.updatedAt, states]);
  }

  async file(id: string, poster: boolean): Promise<string> {
    const view = await this.get(id);
    if (view.state !== "ready") throw new HttpError(404, "No preview is available yet.");
    const extension = this.projects.suiteOf(id) === "video" ? "mp4" : "m4a";
    return path.join(this.projects.dir(id), ".preview", poster ? "poster.jpg" : `preview.${extension}`);
  }

  forget(id: string) { this.jobs.get(id)?.controller.abort(); this.jobs.delete(id); }
  shutdown() { this.stopped = true; for (const job of this.jobs.values()) job.controller.abort(); }
}
