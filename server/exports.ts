import fs from "node:fs/promises";
import { EXPORT_RESOLUTIONS, createId, outputSize, projectDuration, withoutAudioTracks } from "../shared/timeline.ts";
import { isTextClip } from "../shared/effects.ts";
import type { ExportJob, ExportRequest, ExportResolution, Project } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { FFMPEG } from "./config.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import type { MediaLibrary } from "./media.ts";
import { createLimiter } from "./queue.ts";
import { type RenderAsset, buildRenderArgs, planTransitions, runRender } from "./render.ts";
import { renderTransitions } from "./transition-render.ts";
import { type DataPaths, HttpError, isValidId } from "./storage.ts";

interface JobState {
  job: ExportJob;
  project: Project;
  /** The text clips drawn by the browser, by clip id. */
  texts: Map<string, DrawnText>;
  controller: AbortController;
}

interface DrawnText {
  png: Buffer;
  /** Pixel size of the image. */
  pixels: { width: number; height: number };
  /** Frame size at 100%, in output px. */
  frame: { width: number; height: number };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TEXT_PIXELS = 16_384;

/** A text image from an export request, or null when it isn't a sane PNG. */
function parseDrawnText(raw: unknown): DrawnText | null {
  const t = raw as { png?: unknown; width?: unknown; height?: unknown } | null;
  if (!t || typeof t.png !== "string") return null;
  const frame = { width: Number(t.width), height: Number(t.height) };
  if (!(frame.width > 0 && frame.height > 0 && Number.isFinite(frame.width) && Number.isFinite(frame.height))) return null;
  const png = Buffer.from(t.png, "base64");
  // The signature, then the IHDR chunk with the image's width and height.
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (!(pixels.width > 0 && pixels.height > 0 && pixels.width <= MAX_TEXT_PIXELS && pixels.height <= MAX_TEXT_PIXELS)) return null;
  return { png, pixels, frame };
}

/** Characters that are unsafe in file names on common OSes. */
function cleanFileName(raw: unknown, fallback: string): string {
  const name = String(raw ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\.mp4$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 120);
  return name || fallback;
}

/** Export jobs (in memory) rendered one at a time; outputs go to `data/exports/<id>.mp4`. */
export class ExportManager {
  private jobs = new Map<string, JobState>();
  private limit = createLimiter(1);

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
  ) {}

  async create(body: unknown): Promise<ExportJob> {
    const req = body as Partial<ExportRequest> | null;
    if (!req || typeof req !== "object" || !req.project || typeof req.project !== "object") {
      throw new HttpError(400, "Expected { project, resolution }.");
    }
    if (!EXPORT_RESOLUTIONS.includes(req.resolution as ExportResolution)) {
      throw new HttpError(400, `Resolution must be one of ${EXPORT_RESOLUTIONS.join(", ")}.`);
    }
    if (!(await ffmpegVersion())) throw new HttpError(503, "ffmpeg isn't installed, so exporting is unavailable.");

    const assets = this.library.byId();
    let project: Project;
    try {
      if (normalizeProject(req.project).clips.some((c) => !isTextClip(c) && !assets[c.assetId])) {
        throw new HttpError(400, "The timeline uses media that's no longer in the library.");
      }
      project = normalizeProject(req.project, assets);
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError(400, "The project is malformed.");
    }
    if (!project.clips.length) throw new HttpError(400, "Nothing to export — the timeline is empty.");
    if (req.excludeAudioTracks === true) {
      project = withoutAudioTracks(project);
      if (!project.clips.length) {
        throw new HttpError(400, "Nothing to export without the audio tracks — the video track is empty.");
      }
    }

    const texts = new Map<string, DrawnText>();
    for (const clip of project.clips) {
      if (!isTextClip(clip)) continue;
      const drawn = parseDrawnText(req.texts?.[clip.id]);
      if (!drawn) throw new HttpError(400, "A text clip is missing its image. Try exporting again.");
      texts.set(clip.id, drawn);
    }

    const { width, height } = outputSize(project.settings.aspectRatio, req.resolution as ExportResolution);
    const job: ExportJob = {
      id: createId("export"),
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
      width,
      height,
      duration: projectDuration(project),
      downloadUrl: null,
      url: null,
      fileName: cleanFileName(req.fileName, cleanFileName(project.name, "export")),
    };
    const state: JobState = { job, project, texts, controller: new AbortController() };
    this.jobs.set(job.id, state);
    this.limit(() => this.render(state)).catch((err) => console.error("[export]", err));
    return { ...job };
  }

  get(id: string): ExportJob {
    return { ...this.state(id).job };
  }

  /** Cancel a queued or running export (no-op once it has finished). */
  cancel(id: string): void {
    const { job, controller } = this.state(id);
    if (job.status !== "queued" && job.status !== "rendering") return;
    job.status = "cancelled";
    controller.abort();
  }

  /** Path + download name of a finished export. */
  output(id: string): { file: string; name: string } {
    const { job } = this.state(id);
    if (job.status !== "done") throw new HttpError(409, "This export isn't finished.");
    return { file: this.paths.exportFile(id), name: `${job.fileName}.mp4` };
  }

  shutdown(): void {
    for (const { controller } of this.jobs.values()) controller.abort();
  }

  private state(id: string): JobState {
    const state = isValidId(id) ? this.jobs.get(id) : undefined;
    if (!state) throw new HttpError(404, "Export not found");
    return state;
  }

  private async render({ job, project, texts, controller }: JobState): Promise<void> {
    if (job.status !== "queued") return;
    job.status = "rendering";
    const tmp = this.paths.tmpFile(".mp4");
    const textFiles: string[] = [];
    let transitionFiles: Record<string, string> = {};
    try {
      const library = this.library.byId();
      const assets: Record<string, RenderAsset> = {};
      const drawn: Record<string, RenderAsset> = {};
      for (const clip of project.clips) {
        const text = texts.get(clip.id);
        if (text) {
          const file = this.paths.tmpFile(".png");
          textFiles.push(file);
          await fs.writeFile(file, text.png);
          drawn[clip.id] = { kind: "image", hasAudio: false, hasVideo: true, duration: 0, ...text.pixels, frame: text.frame, path: file };
          continue;
        }
        const asset = library[clip.assetId];
        if (!asset) throw new Error("Some media was deleted before the export started.");
        assets[asset.id] = { ...asset, path: this.library.sourcePath(asset) };
      }
      const opts = { width: job.width, height: job.height, fps: project.settings.fps, ffmpegPath: FFMPEG };

      // Transitions are drawn first; each of their frames costs a few of the main render's.
      const transitions = planTransitions(project, assets, opts, drawn);
      const transitionFrames = transitions.reduce((n, t) => n + t.progress.length, 0);
      const mainFrames = Math.max(1, job.duration * opts.fps);
      const share = transitionFrames ? (transitionFrames * 4) / (transitionFrames * 4 + mainFrames) : 0;
      let framesDrawn = 0;
      transitionFiles = await renderTransitions(transitions, (ext) => this.paths.tmpFile(ext), controller.signal, () => {
        job.progress = (share * ++framesDrawn) / transitionFrames;
      });

      const argv = buildRenderArgs(project, assets, { ...opts, outputPath: tmp, transitions: transitionFiles }, drawn);
      await runRender(argv, job.duration, (p) => (job.progress = share + (1 - share) * p), controller.signal);
      await fs.rename(tmp, this.paths.exportFile(job.id));
      // Cancelled while the file was being moved: the job stays cancelled.
      if (controller.signal.aborted) {
        await fs.rm(this.paths.exportFile(job.id), { force: true });
        return;
      }
      Object.assign(job, {
        status: "done",
        progress: 1,
        url: `/files/exports/${job.id}.mp4`,
        downloadUrl: `/api/exports/${job.id}/download`,
      });
    } catch (err) {
      await fs.rm(tmp, { force: true });
      if (controller.signal.aborted) return; // cancelled (status already set) or shutting down
      job.status = "error";
      job.error = `Export failed: ${errorMessage(err)}`;
      console.error(`[export] ${job.id} failed: ${job.error}`);
    } finally {
      await Promise.all([...textFiles, ...Object.values(transitionFiles)].map((f) => fs.rm(f, { force: true })));
      texts.clear();
    }
  }
}
