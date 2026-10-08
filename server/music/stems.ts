/**
 * Extract stems on the server (shared/music/stems.ts): one of a song's files split by HTDemucs into the stems asked
 * for, each a WAV that becomes the project's media. A job the tab polls (`/api/music/stems`), cancelled by killing
 * its process; one runs at a time (a separation takes a couple of gigabytes and every core). A stem already made of
 * the same file the same way is the project's media already, and is reused.
 */
import fs from "node:fs/promises";
import { createId } from "../../shared/ids.ts";
import { errorMessage } from "../../shared/errors.ts";
import { STEM_NAMES, type Stem, type StemJob, stemOrigin, stemRequest, stemSources } from "../../shared/music/stems.ts";
import type { MediaAsset } from "../../shared/types.ts";
import { isAbortError } from "../process.ts";
import { createLimiter } from "../queue.ts";
import { HttpError } from "../storage.ts";
import { type MusicModels, decodeRaw, modelFile, runWorker } from "./ml.ts";
import { writeWavChannels } from "./wav.ts";
import { log } from "../log.ts";

const logger = log("stems");

/** The rate HTDemucs separates at. */
const STEM_RATE = 44_100;
/** Shares of a job's progress: decoding, separating, then handing the files over. */
const DECODED = 0.04;
const SEPARATED = 0.97;

export interface StemOptions {
  /** The worker process (`MUSIC_WORKER`). */
  worker: string;
  models: MusicModels;
  /** The tests' stand-in: each stem an even share of the song, no model. */
  standIn: boolean;
  /** A project's media's file on disk (the sounds it may split), or null. */
  samplePath: (projectId: string, mediaId: string) => string | null;
  /** A project's media's name ("Beat.wav"), for the stems' names. */
  mediaName: (projectId: string, mediaId: string) => string | null;
  /** The project's media made from `origin` before, if any. */
  find: (projectId: string, origin: string) => MediaAsset | undefined;
  /** A file moved into the project's media (named `<name>.wav`). */
  adopt: (projectId: string, file: string, name: string, origin: string) => Promise<MediaAsset>;
  tmpFile: (suffix: string) => string;
}

interface Running {
  view: StemJob;
  abort: AbortController;
}

export class StemSeparator {
  private readonly jobs = new Map<string, Running>();
  private readonly limit = createLimiter(1);

  constructor(private readonly options: StemOptions) {}

  /** Starts a split (400: a bad request; 404: not the song's audio; 409: the model isn't downloaded). */
  async start(body: unknown): Promise<StemJob> {
    const request = stemRequest(body);
    if (typeof request === "string") throw new HttpError(400, request);
    const file = this.options.samplePath(request.projectId, request.sampleId);
    if (!file) throw new HttpError(404, `No audio ${request.sampleId} in this song: give the media id an audio clip's channel plays (its sampleId).`);
    if (!this.options.standIn && !(await this.options.models.stems.file()))
      throw new HttpError(409, "Extract stems' model isn't downloaded yet: download it first (POST /api/music/models/stems/setup).");
    const view: StemJob = { id: createId("stems"), ...request, state: "running", progress: 0, error: null, media: {} };
    const state: Running = { view, abort: new AbortController() };
    this.jobs.set(view.id, state);
    void this.limit(() => this.run(state, file));
    return { ...view };
  }

  get(id: string): StemJob {
    const state = this.jobs.get(id);
    if (!state) throw new HttpError(404, `No stem job ${id}`);
    return { ...state.view, media: { ...state.view.media } };
  }

  cancel(id: string): StemJob {
    const state = this.jobs.get(id);
    if (!state) throw new HttpError(404, `No stem job ${id}`);
    if (state.view.state === "running") {
      state.view.state = "cancelled";
      state.abort.abort();
    }
    return this.get(id);
  }

  shutdown() {
    for (const state of this.jobs.values()) state.abort.abort();
  }

  private async run(state: Running, file: string) {
    const { view, abort } = state;
    const { projectId, sampleId } = view;
    const temporary: string[] = [];
    try {
      if (abort.signal.aborted) return;
      const groups = stemSources(view.stems);
      const name = (this.options.mediaName(projectId, sampleId) ?? "Audio").replace(/\.[^.]+$/, "");
      // Stems made of this file the same way before are reused; the rest are made.
      const wanted: { stem: Stem; sources: Stem[]; origin: string; file: string }[] = [];
      for (const stem of view.stems) {
        const sources = groups[stem] ?? [stem];
        const origin = stemOrigin(sampleId, stem, sources);
        const made = this.options.find(projectId, origin);
        if (made) view.media[stem] = made;
        else wanted.push({ stem, sources, origin, file: this.options.tmpFile(`-${stem}.wav`) });
      }
      if (wanted.length) {
        const raw = this.options.tmpFile(".f32");
        temporary.push(raw, ...wanted.map((w) => w.file));
        const frames = await decodeRaw(file, raw, { rate: STEM_RATE, channels: 2 }, abort.signal);
        view.progress = DECODED;
        if (this.options.standIn) await standInStems(raw, frames, wanted);
        else
          await runWorker(
            this.options.worker,
            { cmd: "stems", model: await modelFile(this.options.models, "stems"), input: raw, frames, outputs: wanted.map((w) => ({ file: w.file, sources: w.sources })) },
            { signal: abort.signal, onProgress: (p) => (view.progress = DECODED + p * (SEPARATED - DECODED)) },
          );
        view.progress = SEPARATED;
        for (const w of wanted) {
          if (abort.signal.aborted) return;
          view.media[w.stem] = await this.options.adopt(projectId, w.file, `${name} - ${STEM_NAMES[w.stem]}`, w.origin);
        }
      }
      if (view.state === "running") {
        view.progress = 1;
        view.state = "done";
      }
    } catch (error) {
      if (view.state === "cancelled" || isAbortError(error) || abort.signal.aborted) view.state = "cancelled";
      else {
        logger.error("the split failed", error);
        view.state = "failed";
        view.error = errorMessage(error);
      }
    } finally {
      // Files adopted were moved away; whatever's left was never handed over.
      await Promise.all(temporary.map((f) => fs.rm(f, { force: true })));
    }
  }
}

/** The tests' stems: each an even share of the song (so they add up to it), written as the worker would. */
async function standInStems(raw: string, frames: number, wanted: readonly { file: string }[]) {
  const bytes = await fs.readFile(raw);
  // Copied so the samples are aligned for a Float32Array.
  const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + frames * 8));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = samples[2 * i] / wanted.length;
    right[i] = samples[2 * i + 1] / wanted.length;
  }
  for (const w of wanted) await writeWavChannels(w.file, [left, right], STEM_RATE);
}
