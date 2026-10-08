/**
 * Render files (Premiere's preview files, docs/render-files.md): a video's heavy segments rendered by the export's
 * renderer into `<package>/render/<key>.mp4`, which the Program monitor plays instead of drawing them live.
 * Segments and their keys are `shared/render-files.ts`'s, the same the tab works out.
 */
import { once } from "node:events";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { effectPasses } from "../shared/effect-gl.ts";
import { isTextClip } from "../shared/effects.ts";
import { errorMessage } from "../shared/errors.ts";
import { normalizeProject } from "../shared/normalize.ts";
import { RENDER_RESOLUTION, type RenderSegment, frameAt, renderSegments } from "../shared/render-files.ts";
import { allClips } from "../shared/sequences.ts";
import { clipEnd, createId, outputSize, sourceTime, trackClips, videoTracks } from "../shared/timeline.ts";
import type { Project, RenderFilesState, RenderJob, TextLayoutAt } from "../shared/types.ts";
import { FFMPEG } from "./config.ts";
import { FFMPEG_QUIET, ffmpegVersion } from "./ffmpeg.ts";
import { parseLayouts } from "./exports.ts";
import { drawFrames } from "./frame-render.ts";
import type { MediaLibrary } from "./media.ts";
import { spawnStreaming } from "./process.ts";
import type { ProjectStore } from "./projects.ts";
import { createLimiter } from "./queue.ts";
import { BT709 } from "./render.ts";
import { renderInputs } from "./render-inputs.ts";
import { HttpError, isValidId } from "./storage.ts";
import { elapsed, log } from "./log.ts";

const logger = log("render");

/** A video's render files may take this much room; past it the oldest go (the current ones last). */
const RENDER_BUDGET = 4 * 1024 ** 3;
/** A render file's key: `shared/render-files.ts`'s `hash`. */
const KEY = /^[0-9a-f]{27}$/;

interface JobState {
  job: RenderJob;
  project: Project;
  texts: Record<string, TextLayoutAt[]>;
  segments: RenderSegment[];
  controller: AbortController;
}

/** Render jobs (in memory), one at a time across every video, each a video's missing heavy segments. */
export class RenderFiles {
  private jobs = new Map<string, JobState>();
  /** Each video's latest job, by project id. */
  private latest = new Map<string, JobState>();
  private limit = createLimiter(1);

  constructor(
    private library: MediaLibrary,
    private projects: ProjectStore,
  ) {}

  /** The render files a video has, and its latest render. */
  async state(projectId: string): Promise<RenderFilesState> {
    const dir = this.dir(projectId);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const keys = names.filter((n) => n.endsWith(".mp4")).map((n) => n.slice(0, -4)).filter((k) => KEY.test(k));
    const latest = this.latest.get(projectId);
    return { keys, job: latest ? { ...latest.job, rendered: [...latest.job.rendered] } : null };
  }

  /** Render a video's heavy segments that have no render file yet (a render of it running is cancelled first). */
  async start(projectId: string, body: unknown): Promise<RenderJob> {
    this.dir(projectId);
    const req = body as { project?: unknown; texts?: Record<string, unknown> } | null;
    if (!req || typeof req !== "object" || !req.project || typeof req.project !== "object") throw new HttpError(400, "Expected { project, texts }.");
    if (!(await ffmpegVersion())) throw new HttpError(503, "ffmpeg isn't installed, so rendering is unavailable.");
    const assets = this.library.byId();
    let project: Project;
    try {
      project = normalizeProject(req.project as Project, assets);
    } catch {
      throw new HttpError(400, "The project is malformed.");
    }
    const texts: Record<string, TextLayoutAt[]> = {};
    for (const clip of allClips(project)) {
      if (!isTextClip(clip)) continue;
      const layouts = parseLayouts(req.texts?.[clip.id]);
      if (!layouts) throw new HttpError(400, "A text clip is missing its layout. Try rendering again.");
      texts[clip.id] = layouts;
    }
    const segments = renderSegments(project, Object.values(assets)).filter((s) => s.heavy);
    const dir = this.dir(projectId);
    const missing = segments.filter((s) => !existsSync(path.join(dir, `${s.key}.mp4`)));

    const running = this.latest.get(projectId);
    if (running) stop(running);
    const job: RenderJob = { id: createId("render"), projectId, status: "queued", progress: 0, segments: missing.length, rendered: [] };
    const state: JobState = { job, project, texts, segments: missing, controller: new AbortController() };
    this.jobs.set(job.id, state);
    this.latest.set(projectId, state);
    this.limit(() => this.render(state)).catch((err) => logger.error("a render job failed", err));
    return { ...job, rendered: [] };
  }

  /** Cancel a queued or running render (what it finished stays). */
  cancel(id: string): void {
    const state = isValidId(id) ? this.jobs.get(id) : undefined;
    if (!state) throw new HttpError(404, "Render not found");
    stop(state);
  }

  /** Delete Render Files: every one a video has (a render of it running is cancelled). */
  async remove(projectId: string): Promise<RenderFilesState> {
    const running = this.latest.get(projectId);
    if (running) stop(running);
    this.latest.delete(projectId);
    await fs.rm(this.dir(projectId), { recursive: true, force: true });
    return { keys: [], job: null };
  }

  /** A segment's render file. */
  file(projectId: string, key: string): string {
    if (!KEY.test(key)) throw new HttpError(404, "Render file not found");
    return path.join(this.dir(projectId), `${key}.mp4`);
  }

  shutdown(): void {
    for (const { controller } of this.jobs.values()) controller.abort();
  }

  private dir(projectId: string): string {
    if (!this.projects.has(projectId)) throw new HttpError(404, "Project not found");
    return path.join(this.projects.dir(projectId), "render");
  }

  private async render(state: JobState): Promise<void> {
    const { job, project, texts, segments, controller } = state;
    if (job.status !== "queued") return;
    job.status = "rendering";
    const began = performance.now();
    const { signal } = controller;
    const dir = this.dir(job.projectId);
    const temps = new Set<string>();
    try {
      await fs.mkdir(dir, { recursive: true });
      const { width, height } = outputSize(project.settings.aspectRatio, RENDER_RESOLUTION);
      const fps = project.settings.fps;
      const total = segments.reduce((n, s) => n + s.to - s.from, 0);
      let done = 0;
      // Contiguous segments are drawn in one go (one compositor page, decoders running on), each into its own file.
      for (const run of runs(segments)) {
        const start = preRoll(project, run[0].from, fps);
        const end = run.at(-1)!.to;
        const range = { from: start, to: end };
        const inputs = await renderInputs(this.library, project, texts, { width, height, fps, ffmpegPath: FFMPEG, range }, signal);
        if (!inputs) return;
        let current: { segment: RenderSegment; encoder: ReturnType<typeof spawnStreaming>; temp: string } | null = null;
        let next = 0;
        const frameSize = (width * height * 3) / 2;
        try {
          await drawFrames(inputs.plan, range, signal, { readback: "yuv420" }, async (f, data) => {
            if (f < run[0].from) return; // pre-roll: drawn for what time effects remember, not kept
            if (!current) {
              const segment = run[next++];
              const temp = path.join(dir, `.${segment.key}.${createId("part")}.mp4`);
              temps.add(temp);
              current = { segment, temp, encoder: spawnStreaming(encoderArgs(width, height, fps, segment.to - segment.from, temp), "pipe", "ignore") };
              current.encoder.child.stdin!.on("error", () => {}); // a failing encoder reports through `done`
            }
            const { encoder, segment, temp } = current;
            const stdin = encoder.child.stdin!;
            stdin.write(data);
            if (stdin.writableLength > frameSize * 3) await Promise.race([once(stdin, "drain"), encoder.done]);
            job.progress = Math.min(0.999, ++done / Math.max(1, total));
            if (f + 1 < segment.to) return;
            stdin.end();
            await encoder.done;
            await fs.rename(temp, path.join(dir, `${segment.key}.mp4`));
            temps.delete(temp);
            job.rendered.push(segment.key);
            current = null;
          });
        } finally {
          (current as { encoder: ReturnType<typeof spawnStreaming> } | null)?.encoder.child.kill("SIGKILL");
        }
      }
      Object.assign(job, { status: "done", progress: 1 });
      logger.info(`${job.id} done in ${elapsed(began)} (${segments.length} segment${segments.length === 1 ? "" : "s"})`);
      await prune(dir, new Set(segments.map((s) => s.key)));
    } catch (err) {
      if (signal.aborted) return; // cancelled (status already set) or shutting down
      job.status = "error";
      job.error = `Rendering failed: ${errorMessage(err)}`;
      logger.error(`${job.id} failed: ${job.error}`);
    } finally {
      for (const temp of temps) await fs.rm(temp, { force: true });
      this.jobs.delete(job.id);
    }
  }
}

/** Cancel a render if it's queued or running (what it finished stays). */
function stop({ job, controller }: JobState): void {
  if (job.status !== "queued" && job.status !== "rendering") return;
  job.status = "cancelled";
  controller.abort();
}

/** Segments in runs of contiguous ones. */
function runs(segments: readonly RenderSegment[]): RenderSegment[][] {
  const out: RenderSegment[][] = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (last && last.at(-1)!.to === s.from) last.push(s);
    else out.push([s]);
  }
  return out;
}

/**
 * Where to start drawing a run that starts at frame `from`: earlier when a clip showing then has a time effect,
 * so what it remembers (Echo's echoes, Trails) is there on the first frame kept, as it is in an export. (Simulations
 * step up from their clip's start by themselves: `planRender`'s warm-ups.)
 */
function preRoll(project: Project, from: number, fps: number): number {
  const t = from / fps;
  let start = from;
  for (const track of videoTracks(project)) {
    for (const clip of trackClips(project, track.id)) {
      if (!(clip.start <= t && clipEnd(clip) > t)) continue;
      const reach = Math.max(0, ...effectPasses(clip, sourceTime(clip, t), fps).map((p) => p.history?.reach ?? 0));
      if (reach > 0) start = Math.min(start, Math.max(frameAt(clip.start, fps), from - Math.ceil(reach * fps) - 1));
    }
  }
  return start;
}

/**
 * The encoder of one segment's render file: H.264 at a high quality, a keyframe every few frames and no B-frames
 * (the monitor seeks in it as it scrubs), no sound (the sound is mixed live).
 */
function encoderArgs(width: number, height: number, fps: number, frames: number, output: string): string[] {
  return [
    FFMPEG, ...FFMPEG_QUIET,
    "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${width}x${height}`, "-framerate", String(fps), ...BT709, "-i", "pipe:0",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", String(Math.max(1, Math.round(fps / 3))), "-bf", "0",
    "-pix_fmt", "yuv420p", "-r", String(fps), ...BT709,
    "-an", "-movflags", "+faststart", "-frames:v", String(frames), "-f", "mp4", "-y", output,
  ];
}

/** Keep a video's render files within `RENDER_BUDGET`: the oldest go first, the current segments' last. */
async function prune(dir: string, current: ReadonlySet<string>): Promise<void> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".mp4") && !n.startsWith("."));
  const files = await Promise.all(names.map(async (name) => ({ name, ...(await fs.stat(path.join(dir, name))) })));
  let total = files.reduce((n, f) => n + f.size, 0);
  const order = files.sort((a, b) => Number(current.has(a.name.slice(0, -4))) - Number(current.has(b.name.slice(0, -4))) || a.mtimeMs - b.mtimeMs);
  for (const file of order) {
    if (total <= RENDER_BUDGET) break;
    await fs.rm(path.join(dir, file.name), { force: true });
    total -= file.size;
  }
}
