import { signalAssets, usesSignals } from "../shared/audio-signals.ts";
import type { SignalData } from "../shared/signals/format.ts";
import { readSignals } from "./signals.ts";
import fs from "node:fs/promises";
import { EXPORT_RESOLUTIONS, createId, outputSize, projectDuration, withoutAudioTracks } from "../shared/timeline.ts";
import { hasMedia, isTextClip } from "../shared/effects.ts";
import { sanitizeTextLayout } from "../shared/text-drawing.ts";
import type { ExportJob, ExportRequest, ExportResolution, Project, TextLayoutAt } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { allClips, isNestedClip } from "../shared/sequences.ts";
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
  /** The text clips' layouts, measured by the browser (in time order), by clip id. */
  texts: Map<string, TextLayoutAt[]>;
  controller: AbortController;
  preview?: boolean;
}

/** Most layouts of one animated text. */
const MAX_TEXT_LAYOUTS = 20_000;

/** A text clip's layouts from an export request (one, or several in time order), or null when they aren't sane. */
function parseLayouts(raw: unknown): TextLayoutAt[] | null {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (list.length === 0 || list.length > MAX_TEXT_LAYOUTS) return null;
  const layouts: TextLayoutAt[] = [];
  for (const item of list as Partial<TextLayoutAt>[]) {
    const layout = sanitizeTextLayout(item?.layout);
    if (!layout) return null;
    const from = item.from;
    layouts.push({ layout, ...(typeof from === "number" && Number.isFinite(from) ? { from } : {}) });
  }
  return layouts.sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
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

  create(body: unknown): Promise<ExportJob> {
    return this.start(body, false);
  }

  private async start(body: unknown, preview: boolean): Promise<ExportJob> {
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
      if (allClips(normalizeProject(req.project)).some((c) => hasMedia(c) && !isNestedClip(c) && !assets[c.assetId])) {
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

    const texts = new Map<string, TextLayoutAt[]>();
    // Texts in nested sequences too: every clip that could be drawn.
    for (const clip of allClips(project)) {
      if (!isTextClip(clip)) continue;
      const layouts = parseLayouts(req.texts?.[clip.id]);
      if (!layouts) throw new HttpError(400, "A text clip is missing its layout. Try exporting again.");
      texts.set(clip.id, layouts);
    }

    let { width, height } = outputSize(project.settings.aspectRatio, req.resolution as ExportResolution);
    if (preview) {
      width /= 2;
      height /= 2;
    }
    const job: ExportJob = {
      id: createId("export"),
      status: "queued",
      progress: 0,
      createdAt: Date.now(),
      width,
      height,
      duration: preview ? Math.min(30, projectDuration(project)) : projectDuration(project),
      downloadUrl: null,
      url: null,
      fileName: cleanFileName(req.fileName, cleanFileName(project.name, "export")),
    };
    const state: JobState = { job, project, texts, preview, controller: new AbortController() };
    this.jobs.set(job.id, state);
    this.limit(() => this.render(state)).catch((err) => console.error("[export]", err));
    return { ...job };
  }

  /** Small cached home-screen preview, using the same compositor as an export. */
  async preview(project: Project, texts: Record<string, TextLayoutAt[]>, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const job = await this.start({ project, texts, resolution: "720p" }, true);
    const cancel = () => this.cancel(job.id);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const current = this.get(job.id);
        if (current.status === "done") return this.output(job.id).file;
        if (current.status === "error") throw new Error(current.error);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) this.cancel(job.id);
      this.jobs.delete(job.id);
    }
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

  private async render({ job, project, texts, controller, preview }: JobState): Promise<void> {
    if (job.status !== "queued") return;
    job.status = "rendering";
    const tmp = this.paths.tmpFile(".mp4");
    const audio = this.paths.tmpFile(".flac");
    const { signal } = controller;
    try {
      const library = this.library.byId();
      const assets: Record<string, RenderAsset> = {};
      const drawn: Record<string, TextLayoutAt[]> = Object.fromEntries(texts);
      for (const clip of allClips(project)) {
        // Text, solids, shapes and adjustment layers are drawn by the compositor itself, and a nested sequence from its clips.
        if (!hasMedia(clip) || isNestedClip(clip)) continue;
        const asset = library[clip.assetId];
        if (!asset) throw new Error("Some media was deleted before the export started.");
        if (assets[asset.id]) continue;
        const path = this.library.sourcePath(asset);
        const colorSpace = asset.kind === "video" && asset.hasVideo ? await probeColorSpace(path) : null;
        assets[asset.id] = { ...asset, path, colorSpace };
      }
      // Clips played backwards play their media's reversed copy (made now if it isn't yet).
      for (const clip of project.clips) {
        const asset = assets[clip.assetId];
        if (clip.reversed && asset && !asset.reversedPath) asset.reversedPath = await this.library.reversedPath(clip.assetId);
        if (signal.aborted) return;
      }
      // What reacts to sound reads its files' signals (analysed now if they aren't yet).
      const signals = new Map<string, SignalData>();
      if (usesSignals(project)) {
        for (const id of signalAssets(project, (id) => !!assets[id]?.hasAudio)) {
          signals.set(id, await readSignals(await this.library.signalsPath(id)));
          if (signal.aborted) return;
        }
      }
      const opts = { width: job.width, height: job.height, fps: preview ? Math.min(15, project.settings.fps) : project.settings.fps, ffmpegPath: FFMPEG, signals };
      let plan = planRender(project, assets, opts, drawn);
      // Media shown backwards elsewhere (a remapped clip running back, a reversed nest) needs its reversed copy too.
      if (plan.needsReversed.length) {
        for (const id of plan.needsReversed) {
          assets[id].reversedPath = await this.library.reversedPath(id);
          if (signal.aborted) return;
        }
        plan = planRender(project, assets, opts, drawn);
      }

      if (preview) plan.frames = Math.min(plan.frames, Math.ceil(job.duration * opts.fps));

      // The sound first (quick), then every frame, drawn and encoded with it.
      const audioShare = 0.03;
      const soundArgs = audioArgs(project, assets, { ...opts, outputPath: audio });
      if (preview) soundArgs.splice(soundArgs.length - 1, 0, "-t", String(job.duration));
      await runWithProgress(
        soundArgs,
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
