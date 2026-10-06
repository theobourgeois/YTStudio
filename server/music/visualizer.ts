/**
 * Make visualizer, the music side on the server (`/api/music/visualizer`, docs/visualizer/README.md V5):
 * the engine renders the song once, its mix and a stem per mixer track (as an export with stems does),
 * ffmpeg turns the chosen ones into FLAC, every file down by the same amount if the mix went over full
 * scale, and the song's notes, beat and arrangement are worked out from the document
 * (`shared/music/visualizer.ts`). That's a `SongHandoff`, which the app turns into a video project
 * (`handoff`, `ProjectStore.createFromHandoff`): this suite never builds a video document. One at a time
 * (the engine plays nothing else meanwhile).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../../shared/errors.ts";
import type { HandoffStem, SongHandoff } from "../../shared/handoff.ts";
import { createId } from "../../shared/ids.ts";
import { DEFAULT_EXPORT_SETTINGS, encoderArgs, exportGain } from "../../shared/music/export.ts";
import { normalizeMusicProject } from "../../shared/music/project.ts";
import { type VisualizerJob, chosenStems, normalizeVisualizerChoice, songBeats, songMarkers, songNotes, visualizerSources } from "../../shared/music/visualizer.ts";
import type { ProjectSummary } from "../../shared/types.ts";
import { FFMPEG } from "../config.ts";
import { run } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId } from "../storage.ts";
import type { AudioEngine, SamplePath } from "./engine.ts";

/** Seconds the song may ring on past its end (reverbs, long notes): the video's as long as it's heard. */
const MAX_TAIL = 8;

export interface SongVisualizerOptions {
  samplePath: SamplePath;
  /** Make the video project from a song handed over (the app wires it to the project store). */
  handoff: (handoff: SongHandoff, options: unknown) => Promise<ProjectSummary>;
  ffmpeg?: string;
}

interface Job {
  view: VisualizerJob;
  abort: AbortController;
}

export class SongVisualizers {
  private jobs = new Map<string, Job>();
  private readonly ffmpeg: string;

  constructor(
    private readonly paths: DataPaths,
    private readonly engine: AudioEngine,
    private readonly options: SongVisualizerOptions,
  ) {
    this.ffmpeg = options.ffmpeg ?? FFMPEG;
  }

  /** Start making one (`MakeVisualizerRequest`); it runs on after the answer, which is the job as it starts. */
  async start(body: unknown): Promise<VisualizerJob> {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    if (!isObject(body.song)) throw new HttpError(400, '"song" must be the song to make a video of.');
    if ([...this.jobs.values()].some((j) => j.view.state === "rendering" || j.view.state === "making")) throw new HttpError(409, "A visualizer is being made already: wait for it, or stop it.");
    const projectId = body.projectId;
    const song = normalizeMusicProject(body.song, (id) => this.options.samplePath(projectId, id) !== null);
    const patternId = typeof body.patternId === "string" ? body.patternId : null;
    const choice = normalizeVisualizerChoice(body.choice, song);
    const sources = visualizerSources(song, patternId);
    if (!sources.stems.length && !sources.channels.length && !song.playlist.clips.length) throw new HttpError(400, "The song is silent: there's nothing to make a visualizer of.");

    const view: VisualizerJob = { id: createId("mvis"), projectId, state: "rendering", rendered: 0, missing: [], error: null, project: null };
    const job: Job = { view, abort: new AbortController() };
    this.jobs.set(view.id, job);
    void this.run(job, async (temp) => {
      const result = await this.engine.renderExport(
        {
          id: view.id,
          projectId,
          song,
          patternId,
          mode: sources.mode,
          loop: null,
          resampling: "sinc",
          folder: temp,
          mix: true,
          stems: choice.stems.length > 0,
          tail: "ring",
          maxTail: MAX_TAIL,
        },
        (done, frames) => (view.rendered = frames > 0 ? done / frames : 0),
        job.abort.signal,
      );
      if (result.state === "aborted") throw job.abort.signal.reason ?? new HttpError(409, "Making the visualizer was stopped.");
      // What couldn't be heard, by name: a channel's, or an effect's plugin.
      const effects = new Map(song.mixer.tracks.flatMap((t) => t.effects.flatMap((e) => (e ? [[e.id, e.plugin.name] as const] : []))));
      view.missing = result.missing.map((id) => song.channels.find((c) => c.id === id)?.name ?? effects.get(id) ?? id);
      view.rendered = 1;
      view.state = "making";
      const mixFile = result.files.find((f) => f.id === "mix");
      if (!mixFile) throw new HttpError(500, "The engine rendered no mix.");

      // FLAC, every file turned down alike if the mix went over full scale (so the stems still add up to it).
      const gain = exportGain(Math.max(0, ...result.files.map((f) => f.peak)), DEFAULT_EXPORT_SETTINGS);
      const settings = { ...DEFAULT_EXPORT_SETTINGS, flacBits: 24 as const };
      const encode = async (source: string, name: string) => {
        const target = path.join(temp, `${name}.flac`);
        await run(this.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...encoderArgs("flac", settings, result.sampleRate, new Set(), gain), target], { signal: job.abort.signal });
        return target;
      };
      const stems: HandoffStem[] = [];
      for (const stem of chosenStems(sources, choice)) {
        const rendered = result.files.find((f) => f.id === stem.trackId);
        if (!rendered) continue;
        stems.push({ name: stem.name, color: stem.color, ...(stem.role && { role: stem.role }), file: await encode(rendered.file, `stem-${stem.trackId}`) });
      }
      const mix = { file: await encode(mixFile.file, "mix") };
      const length = result.frames / result.sampleRate;
      job.abort.signal.throwIfAborted();
      const handoff: SongHandoff = {
        kind: "song",
        name: song.name,
        length: sources.length,
        tempo: { bpm: song.settings.tempo, timeSignature: song.settings.timeSignature, beats: songBeats(song, sources.mode, length) },
        mix,
        stems,
        notes: songNotes(song, patternId, sources, choice),
        markers: songMarkers(song, sources.mode),
        origin: { projectId },
      };
      view.project = await this.options.handoff(handoff, choice.video);
    });
    return { ...view };
  }

  get(id: string): VisualizerJob {
    return { ...this.job(id).view };
  }

  /** Stop it: the engine stops rendering, and nothing is made. */
  async abort(id: string): Promise<VisualizerJob> {
    const job = this.job(id);
    // Once the project is being made, it's made.
    if (job.view.state === "rendering") {
      job.abort.abort(new HttpError(409, "Making the visualizer was stopped."));
      await this.engine.abortExport(id).catch(() => {});
    }
    return { ...job.view };
  }

  shutdown() {
    for (const job of this.jobs.values()) job.abort.abort(new HttpError(503, "The server stopped."));
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "No such visualizer being made.");
    return job;
  }

  private async run(job: Job, work: (temp: string) => Promise<void>) {
    const temp = path.join(this.paths.tmp, `visualizer-${job.view.id}`);
    try {
      await work(temp);
      job.view.state = "done";
    } catch (err) {
      const stopped = job.abort.signal.aborted;
      job.view.state = stopped ? "aborted" : "failed";
      job.view.error = stopped ? null : errorMessage(err);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}
