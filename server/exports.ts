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
import { renderVideo } from "./frame-render.ts";
import { probeColorSpace } from "./probe.ts";
import { type RenderAsset, audioArgs, encoderArgs, planRender, runWithProgress } from "./render.ts";
import { type DataPaths, HttpError, isValidId } from "./storage.ts";

interface JobState {
  job: ExportJob;
  project: Project;
  /** The text clips drawn by the browser (one drawing per look, in time order), by clip id. */
  texts: Map<string, DrawnText[]>;
  controller: AbortController;
}

interface DrawnText {
  png: Buffer;
  /** Pixel size of the image. */
  pixels: { width: number; height: number };
  /** Frame size at 100%, in output px. */
  frame: { width: number; height: number };
  /** Source time it's shown from (see `TextRaster.from`). */
  from?: number;
}

/** Most drawings of one animated text. */
const MAX_TEXT_DRAWINGS = 20_000;

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
  const from = (raw as { from?: unknown }).from;
  return { png, pixels, frame, ...(typeof from === "number" && Number.isFinite(from) ? { from } : {}) };
}

/** A text clip's drawings from an export request (one, or several in time order), or null when they aren't sane. */
function parseDrawings(raw: unknown): DrawnText[] | null {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length === 0 || list.length > MAX_TEXT_DRAWINGS) return null;
  const drawings: DrawnText[] = [];
  for (const item of list) {
    const drawn = parseDrawnText(item);
    if (!drawn) return null;
    drawings.push(drawn);
  }
  return drawings.sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
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

    const texts = new Map<string, DrawnText[]>();
    for (const clip of project.clips) {
      if (!isTextClip(clip)) continue;
      const drawn = parseDrawings(req.texts?.[clip.id]);
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
    const audio = this.paths.tmpFile(".flac");
    const { signal } = controller;
    try {
      const library = this.library.byId();
      const assets: Record<string, RenderAsset> = {};
      const drawn: Record<string, RenderAsset[]> = {};
      for (const clip of project.clips) {
        const text = texts.get(clip.id);
        if (text) {
          drawn[clip.id] = text.map((d) => ({
            kind: "image", hasAudio: false, hasVideo: true, duration: 0, ...d.pixels, frame: d.frame, path: "", png: d.png, from: d.from,
          }));
          continue;
        }
        const asset = library[clip.assetId];
        if (!asset) throw new Error("Some media was deleted before the export started.");
        if (assets[asset.id]) continue;
        const path = this.library.sourcePath(asset);
        const colorSpace = asset.kind === "video" && asset.hasVideo ? await probeColorSpace(path) : null;
        assets[asset.id] = { ...asset, path, colorSpace };
      }
      const opts = { width: job.width, height: job.height, fps: project.settings.fps, ffmpegPath: FFMPEG };
      const plan = planRender(project, assets, opts, drawn);

      // The sound first (quick), then every frame, drawn and encoded with it.
      const audioShare = 0.03;
      await runWithProgress(
        audioArgs(project, assets, { ...opts, outputPath: audio }, drawn),
        job.duration,
        (p) => (job.progress = audioShare * p),
        signal,
      );
      let framesDrawn = 0;
      await renderVideo(plan, encoderArgs(plan, { ...opts, audioPath: audio, outputPath: tmp }), signal, () => {
        job.progress = audioShare + ((1 - audioShare) * ++framesDrawn) / plan.frames;
      });
      await fs.rename(tmp, this.paths.exportFile(job.id));
      // Cancelled while the file was being moved: the job stays cancelled.
      if (signal.aborted) {
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
      if (signal.aborted) return; // cancelled (status already set) or shutting down
      job.status = "error";
      job.error = `Export failed: ${errorMessage(err)}`;
      console.error(`[export] ${job.id} failed: ${job.error}`);
    } finally {
      await fs.rm(audio, { force: true });
      texts.clear();
    }
  }
}
