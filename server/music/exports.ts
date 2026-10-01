/**
 * Song exports (`/api/music/exports`, `shared/music/export.ts`): the engine renders the song to 32-bit
 * float WAVs (the mix, and stems), then ffmpeg encodes each into every format asked for, several at
 * once, and the MIDI file is written here from the same compiled song. The files go where the save
 * dialog said (the desktop app), or stay in `data/exports/music/<id>` to be downloaded (a browser).
 * One at a time: the engine plays nothing else meanwhile.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createId } from "../../shared/ids.ts";
import { compileSong } from "../../shared/music/compile.ts";
import {
  type AudioFormat,
  type ExportFormat,
  type ExportSettings,
  type ExportedFile,
  type MusicExportJob,
  MAX_TAIL_SECONDS,
  encoderArgs,
  exportFileName,
  isAudioFormat,
  normalizeExportSettings,
  safeFileName,
} from "../../shared/music/export.ts";
import { midiFile } from "../../shared/music/midi.ts";
import { trackName } from "../../shared/music/mixer.ts";
import { normalizeMusicProject } from "../../shared/music/project.ts";
import type { MusicProject } from "../../shared/music/types.ts";
import { errorMessage } from "../../shared/errors.ts";
import { isFiniteNumber } from "../../shared/math.ts";
import { FFMPEG } from "../config.ts";
import { run } from "../process.ts";
import { type DataPaths, HttpError, isObject, isValidId } from "../storage.ts";
import type { AudioEngine, SamplePath } from "./engine.ts";

export interface MusicExportOptions {
  samplePath: SamplePath;
  ffmpeg?: string;
  /** Show a file in Finder (the default opens Finder; tests pass nothing that does). */
  reveal?: (file: string) => Promise<void>;
}

interface Job {
  view: MusicExportJob;
  abort: AbortController;
  /** Where its files are kept to be downloaded (a browser's export), else null. */
  folder: string | null;
}

/** Encodes run this many at once. */
const ENCODES_AT_ONCE = Math.max(1, Math.min(8, os.cpus().length));

export class MusicExports {
  private jobs = new Map<string, Job>();
  private encoders: Promise<Set<string>> | null = null;
  private readonly ffmpeg: string;
  private readonly revealFile: (file: string) => Promise<void>;

  constructor(
    private readonly paths: DataPaths,
    private readonly engine: AudioEngine,
    private readonly options: MusicExportOptions,
  ) {
    this.ffmpeg = options.ffmpeg ?? FFMPEG;
    this.revealFile = options.reveal ?? (async (file) => void (await run("open", ["-R", file]).catch(() => {})));
  }

  /** Start an export (`ExportSongRequest`); it runs on after the answer, which is the job as it starts. */
  async start(body: unknown): Promise<MusicExportJob> {
    if (!isObject(body) || !isValidId(body.projectId)) throw new HttpError(400, '"projectId" must be the song\'s project id.');
    const projectId = body.projectId;
    if (!isObject(body.song)) throw new HttpError(400, '"song" must be the song to export.');
    if ([...this.jobs.values()].some((j) => j.view.state === "rendering" || j.view.state === "encoding")) throw new HttpError(409, "A song is being exported already: wait for it, or stop it.");
    const settings = normalizeExportSettings(body.settings);
    const song = normalizeMusicProject(body.song, (id) => this.options.samplePath(projectId, id) !== null);
    const patternId = typeof body.patternId === "string" ? body.patternId : null;
    const selection = isObject(body.selection) && isFiniteNumber(body.selection.start) && isFiniteNumber(body.selection.end) && body.selection.end > body.selection.start ? { start: body.selection.start, end: body.selection.end } : null;

    // Where the files go: beside the save dialog's file, named after it; else kept here to download.
    const id = createId("mexp");
    let folder: string;
    let base: string;
    let kept: string | null = null;
    if (typeof body.destination === "string" && body.destination) {
      if (!path.isAbsolute(body.destination)) throw new HttpError(400, '"destination" must be an absolute path.');
      folder = path.dirname(body.destination);
      const stat = await fs.stat(folder).catch(() => null);
      if (!stat?.isDirectory()) throw new HttpError(400, `There's no folder ${folder}.`);
      base = safeFileName(path.basename(body.destination, path.extname(body.destination)));
    } else {
      kept = folder = path.join(this.paths.exports, "music", id);
      base = safeFileName(song.name || "Song");
      await fs.mkdir(folder, { recursive: true });
    }

    const view: MusicExportJob = { id, projectId, state: "rendering", rendered: 0, encoded: 0, toEncode: 0, files: [], missing: [], error: null, renderSeconds: null, seconds: null, length: null };
    const job: Job = { view, abort: new AbortController(), folder: kept };
    this.jobs.set(id, job);
    void this.run(job, { projectId, song, patternId, selection, settings, folder, base, keep: kept !== null });
    return { ...view };
  }

  get(id: string): MusicExportJob {
    return { ...this.job(id).view };
  }

  /** Stop it: the engine stops rendering, encoders are killed, and what it wrote is deleted. */
  async abort(id: string): Promise<MusicExportJob> {
    const job = this.job(id);
    if (job.view.state === "rendering" || job.view.state === "encoding") {
      job.abort.abort(new HttpError(409, "The export was stopped."));
      await this.engine.abortExport(id).catch(() => {});
    }
    return { ...job.view };
  }

  /** A file a browser's export made, to download. */
  file(id: string, name: unknown): string {
    const job = this.job(id);
    const file = job.view.files.find((f) => f.name === name);
    if (!file || !job.folder) throw new HttpError(404, "That export has no such file to download.");
    return path.join(job.folder, file.name);
  }

  /** Show its files in Finder. */
  async reveal(id: string): Promise<void> {
    const first = this.job(id).view.files.find((f) => f.path);
    if (!first?.path) throw new HttpError(404, "That export's files aren't on this computer's disk.");
    await this.revealFile(first.path);
  }

  shutdown() {
    for (const job of this.jobs.values()) job.abort.abort(new HttpError(503, "The server stopped."));
  }

  private job(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "No such export.");
    return job;
  }

  /** The encoders this ffmpeg has (asked once). */
  private available(): Promise<Set<string>> {
    this.encoders ??= run(this.ffmpeg, ["-hide_banner", "-encoders"])
      .then((out) => new Set(out.split("\n").map((line) => line.trim().split(/\s+/)[1]).filter(Boolean)))
      .catch(() => new Set<string>());
    return this.encoders;
  }

  private async run(job: Job, plan: { projectId: string; song: MusicProject; patternId: string | null; selection: { start: number; end: number } | null; settings: ExportSettings; folder: string; base: string; keep: boolean }) {
    const { song, settings, folder, base } = plan;
    const view = job.view;
    const began = performance.now();
    const temp = path.join(this.paths.tmp, `export-${view.id}`);
    /** Every file it has begun to write, to delete if it doesn't finish. */
    const written = new Set<string>();
    try {
      const audio = settings.formats.filter(isAudioFormat);
      let rendered: { files: { id: string; file: string }[]; sampleRate: number } = { files: [], sampleRate: 48000 };
      if (audio.length) {
        const result = await this.engine.renderExport(
          {
            id: view.id,
            projectId: plan.projectId,
            song,
            patternId: plan.patternId,
            mode: settings.mode,
            loop: plan.selection,
            resampling: settings.resampling,
            folder: temp,
            mix: !settings.stems || settings.includeMix,
            stems: settings.stems,
            tail: settings.tail,
            maxTail: MAX_TAIL_SECONDS,
          },
          (done, frames) => (view.rendered = frames > 0 ? done / frames : 0),
        );
        view.missing = this.names(song, result.missing);
        if (result.state === "aborted") throw job.abort.signal.reason ?? new HttpError(409, "The export was stopped.");
        view.rendered = 1;
        view.renderSeconds = result.seconds;
        view.length = result.frames / result.sampleRate;
        rendered = result;
      }
      job.abort.signal.throwIfAborted();

      // Every file in every format, several at once.
      view.state = "encoding";
      const encoders = await this.available();
      const tasks: { source: string; format: AudioFormat; track: string | null }[] = rendered.files.flatMap((file) =>
        audio.map((format) => ({ source: file.file, format, track: file.id === "mix" ? null : trackName(song, file.id) })),
      );
      view.toEncode = tasks.length + (settings.formats.includes("mid") ? 1 : 0);
      const add = async (name: string, format: ExportFormat, track: string | null) => {
        const target = path.join(folder, name);
        written.add(target);
        const { size } = await fs.stat(target);
        const file: ExportedFile = { name, format, track, bytes: size, path: plan.keep ? null : target };
        view.files.push(file);
        view.encoded++;
      };
      if (settings.formats.includes("mid")) {
        const compiled = compileSong(song, plan.patternId, plan.selection, settings.mode);
        const name = exportFileName(base, null, "mid");
        await fs.writeFile(path.join(folder, name), midiFile(compiled, song.name || base, song.settings.timeSignature));
        await add(name, "mid", null);
      }
      let next = 0;
      const worker = async () => {
        while (next < tasks.length) {
          const task = tasks[next++];
          const name = exportFileName(base, task.track, task.format);
          const target = path.join(folder, name);
          written.add(target);
          await run(this.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", task.source, ...encoderArgs(task.format, settings, rendered.sampleRate, encoders), target], {
            signal: job.abort.signal,
          }).catch((err) => {
            if (job.abort.signal.aborted) throw job.abort.signal.reason;
            throw new HttpError(500, `Couldn't make ${name}: ${errorMessage(err)}`);
          });
          await add(name, task.format, task.track);
        }
      };
      await Promise.all(Array.from({ length: Math.min(ENCODES_AT_ONCE, tasks.length) }, worker));
      // In the order asked for: the mix first, then the stems, each in every format.
      view.files.sort((a, b) => (a.track === null ? 0 : 1) - (b.track === null ? 0 : 1) || (a.track ?? "").localeCompare(b.track ?? "") || settings.formats.indexOf(a.format) - settings.formats.indexOf(b.format));
      view.state = "done";
      view.seconds = (performance.now() - began) / 1000;
      if (settings.reveal && !plan.keep && view.files[0]?.path) await this.revealFile(view.files[0].path);
    } catch (err) {
      const stopped = job.abort.signal.aborted;
      view.state = stopped ? "aborted" : "failed";
      view.error = stopped ? null : errorMessage(err);
      view.files = [];
      await Promise.all([...written].map((file) => fs.rm(file, { force: true })));
      if (plan.keep) await fs.rm(folder, { recursive: true, force: true });
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }

  /** The names of what the engine couldn't play: a channel's, or an effect's plugin and its track's. */
  private names(song: MusicProject, ids: string[]): string[] {
    return ids.map((id) => {
      const channel = song.channels.find((c) => c.id === id);
      if (channel) return channel.name;
      for (const track of song.mixer.tracks)
        for (const effect of track.effects) if (effect?.id === id) return `${effect.plugin.name} on ${trackName(song, track.id)}`;
      return id;
    });
  }
}
