/**
 * Running the music suite's models (shared/music/models.ts): their downloads (the platform's `DownloadedModel`),
 * the process that runs them (`ml-worker.mjs`, a job a process), and the decoding ffmpeg does for it.
 */
import fs from "node:fs/promises";
import { MUSIC_MODELS, type MusicModelName } from "../../shared/music/models.ts";
import { FFMPEG } from "../config.ts";
import { FFMPEG_QUIET } from "../ffmpeg.ts";
import { DownloadedModel } from "../models.ts";
import { run } from "../process.ts";

export type MusicModels = Record<MusicModelName, DownloadedModel>;

/** Every music model, by name (`/api/music/models/<name>`). `standIn`: the tests', which download nothing. */
export const musicModels = (modelsDir: string, standIn: boolean): MusicModels => ({
  stems: new DownloadedModel(modelsDir, standIn, MUSIC_MODELS.stems),
  notes: new DownloadedModel(modelsDir, standIn, MUSIC_MODELS.notes),
});

/** A model's file to run, or an error the user (or the assistant) can act on. */
export async function modelFile(models: MusicModels, name: MusicModelName): Promise<string> {
  const file = await models[name].file();
  if (!file) throw new ModelMissing(name);
  return file;
}

/** A model isn't downloaded yet: the tab asks the user (`/api/music/models/<name>/setup` downloads it). */
export class ModelMissing extends Error {
  constructor(readonly model: MusicModelName) {
    super(`${MUSIC_MODELS[model].command}'s model isn't downloaded yet: download it first (POST /api/music/models/${model}/setup).`);
  }
}

/** A file's sound as raw float32 (interleaved) at a rate, written to `out`; resolves with its length in frames. */
export async function decodeRaw(file: string, out: string, format: { rate: number; channels: number }, signal?: AbortSignal): Promise<number> {
  // prettier-ignore
  await run(FFMPEG, [...FFMPEG_QUIET, "-y", "-i", file, "-vn", "-ac", String(format.channels), "-ar", String(format.rate), "-f", "f32le", out], { signal });
  const { size } = await fs.stat(out);
  return Math.floor(size / (4 * format.channels));
}

/** What the worker answers last. */
export interface WorkerResult {
  done: true;
  frames: number;
}

/** Runs a job in the worker process (`ml-worker.mjs`), hearing its progress (0..1); killed when `signal` aborts. */
export async function runWorker(worker: string, job: object, options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<WorkerResult> {
  let pending = "";
  let result: WorkerResult | null = null;
  await run(worker, [JSON.stringify(job)], {
    signal: options.signal,
    onStdout: (chunk) => {
      pending += chunk.toString("utf8");
      for (let at = pending.indexOf("\n"); at >= 0; at = pending.indexOf("\n")) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        try {
          const message = JSON.parse(line) as { progress?: unknown; done?: unknown };
          if (typeof message.progress === "number") options.onProgress?.(message.progress);
          if (message.done === true) result = message as WorkerResult;
        } catch {
          // Not ours (a library's print): skipped.
        }
      }
    },
  });
  if (!result) throw new Error("The model's process ended without an answer.");
  return result;
}
