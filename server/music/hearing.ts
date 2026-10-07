/**
 * What Convert to notes hears in a file (shared/music/transcribe.ts): Basic Pitch's activations (the worker runs the
 * model) and the drum measurements (`drumFeatures`, here), for the tab to pick notes out of as its settings move.
 * Heard once a file: a few are remembered (by path and modification time), as a file's notes don't change.
 */
import fs from "node:fs/promises";
import { ANALYSIS_RATE, FRAME_SECONDS, type HeardAudio, type HeardAudioJson, KEYS, LOWEST_KEY, drumFeatures, heardToJson, packDrums } from "../../shared/music/transcribe.ts";
import { createLimiter } from "../queue.ts";
import { HttpError } from "../storage.ts";
import { type MusicModels, decodeRaw, modelFile, runWorker } from "./ml.ts";

/** How many files' hearing is kept. */
const REMEMBERED = 6;

export interface HearingOptions {
  worker: string;
  models: MusicModels;
  /** The tests' stand-in: a made-up melody instead of Basic Pitch's (drums are heard as ever: they need no model). */
  standIn: boolean;
  samplePath: (projectId: string, mediaId: string) => string | null;
  tmpFile: (suffix: string) => string;
}

export class NoteHearing {
  private readonly known = new Map<string, Promise<HeardAudioJson>>();
  private readonly limit = createLimiter(2);

  constructor(private readonly options: HearingOptions) {}

  /** `POST /api/music/notes`: what's heard in one of a song's files (404: not its audio; 409: no model yet). */
  async hear(body: unknown): Promise<HeardAudioJson> {
    const { projectId, sampleId } = (body ?? {}) as { projectId?: unknown; sampleId?: unknown };
    if (typeof projectId !== "string" || typeof sampleId !== "string") throw new HttpError(400, "projectId and sampleId (the media an audio clip's channel plays) are needed");
    const file = this.options.samplePath(projectId, sampleId);
    if (!file) throw new HttpError(404, `No audio ${sampleId} in this song: give the media id an audio clip's channel plays (its sampleId).`);
    if (!this.options.standIn && !(await this.options.models.notes.file()))
      throw new HttpError(409, "Convert to notes' model isn't downloaded yet: download it first (POST /api/music/models/notes/setup).");
    const key = `${file}|${(await fs.stat(file)).mtimeMs}`;
    let heard = this.known.get(key);
    if (!heard) {
      heard = this.limit(() => this.listen(file));
      this.known.set(key, heard);
      heard.catch(() => this.known.delete(key));
      while (this.known.size > REMEMBERED) this.known.delete(this.known.keys().next().value as string);
    }
    return heard;
  }

  private async listen(file: string): Promise<HeardAudioJson> {
    const raw = this.options.tmpFile(".f32");
    const activations = this.options.tmpFile(".act");
    try {
      const length = await decodeRaw(file, raw, { rate: ANALYSIS_RATE, channels: 1 }, undefined);
      const bytes = await fs.readFile(raw);
      // Copied so the samples are aligned for a Float32Array.
      const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + length * 4));
      const drums = drumFeatures(samples);
      let melodic: Pick<HeardAudio, "frames" | "notes" | "onsets">;
      if (this.options.standIn) melodic = standInMelody(length);
      else {
        const { frames } = await runWorker(this.options.worker, { cmd: "notes", model: await modelFile(this.options.models, "notes"), input: raw, output: activations });
        const out = await fs.readFile(activations);
        const all = new Uint16Array(out.buffer.slice(out.byteOffset, out.byteOffset + frames * KEYS * 4));
        melodic = { frames, notes: all.slice(0, frames * KEYS), onsets: all.slice(frames * KEYS) };
      }
      return heardToJson({ duration: length / ANALYSIS_RATE, ...melodic, drums: packDrums(drums.features, drums.frames), drumFrames: drums.frames });
    } finally {
      await Promise.all([raw, activations].map((f) => fs.rm(f, { force: true })));
    }
  }
}

/** The tests' melody: C, E and G in turn, a note every half second lasting 0.3 s (Basic Pitch's frames). */
function standInMelody(samples: number): Pick<HeardAudio, "frames" | "notes" | "onsets"> {
  const frames = Math.floor((samples * 86) / ANALYSIS_RATE);
  const notes = new Uint16Array(frames * KEYS);
  const onsets = new Uint16Array(frames * KEYS);
  for (let n = 0; (n * 0.5) / FRAME_SECONDS < frames; n++) {
    const key = [60, 64, 67][n % 3] - LOWEST_KEY;
    const from = Math.round((n * 0.5) / FRAME_SECONDS);
    const to = Math.min(frames, from + Math.round(0.3 / FRAME_SECONDS));
    for (let t = from; t < to; t++) notes[t * KEYS + key] = 52_000;
    if (from + 1 < frames) onsets[(from + 1) * KEYS + key] = 60_000;
  }
  return { frames, notes, onsets };
}
