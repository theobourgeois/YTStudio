/**
 * Transcription jobs for Auto captions. A job takes stretches of media files,
 * and for each one: decodes its sound, squeezes out the silences
 * (`audio.ts`), has an engine transcribe it, and maps the words back to
 * source time. Transcripts are cached next to their media, so captioning the
 * same clips again (in another length or style) doesn't transcribe again.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  MediaAsset,
  SetUpEngineRequest,
  TranscribeRequest,
  Transcript,
  TranscriptionEngineId,
  TranscriptionEngineInfo,
  TranscriptionJob,
} from "../../shared/types.ts";
import { isCaptionLanguage } from "../../shared/captions.ts";
import { errorMessage } from "../../shared/errors.ts";
import { roundTime } from "../../shared/math.ts";
import { createId } from "../../shared/timeline.ts";
import { GROQ_API_KEY, MODELS_DIR, OPENAI_API_KEY, TRANSCRIPTION_ENGINE } from "../config.ts";
import { ffmpegVersion } from "../ffmpeg.ts";
import type { MediaLibrary } from "../media.ts";
import { createLimiter } from "../queue.ts";
import { type DataPaths, HttpError, isValidId, readJson, writeJson } from "../storage.ts";
import { analyseSpeech, decodeSpeech, originalSpan, snapToSpeech, squeeze, wavFile } from "./audio.ts";
import type { TranscriptionEngine } from "./engine.ts";
import { FakeEngine } from "./fake.ts";
import { OpenAiCompatibleEngine } from "./openai.ts";
import { ApiKeyStore } from "./settings.ts";
import { WhisperCppEngine } from "./whisper-cpp.ts";
import { elapsed, log } from "../log.ts";

const logger = log("transcription");

/** Stretches of one file this close together are transcribed as one (a clip split in two). */
const JOIN_GAP = 1;
/** Most speech one job transcribes, in seconds. */
const MAX_TOTAL = 3 * 60 * 60;
/** Bump to stop using transcripts cached by an older version of this code. */
const CACHE_VERSION = 1;

interface Range {
  asset: MediaAsset;
  in: number;
  out: number;
}

interface JobState {
  job: TranscriptionJob;
  engine: TranscriptionEngine;
  language: string;
  ranges: Range[];
  controller: AbortController;
}

export interface TranscriptionOptions {
  /** Replaces the default engines (tests). */
  engines?: TranscriptionEngine[];
  modelsDir?: string;
}

/** The engines the app offers, in the order it shows them. */
function defaultEngines(keys: ApiKeyStore, modelsDir: string): TranscriptionEngine[] {
  return [
    TRANSCRIPTION_ENGINE === "fake" ? new FakeEngine() : new WhisperCppEngine(modelsDir),
    new OpenAiCompatibleEngine(
      {
        id: "openai",
        label: "OpenAI",
        description: "OpenAI's Whisper API. About $0.006 a minute of speech; audio is sent to OpenAI.",
        baseUrl: "https://api.openai.com/v1",
        model: "whisper-1",
        envKey: OPENAI_API_KEY,
        keyUrl: "https://platform.openai.com/api-keys",
      },
      keys,
    ),
    new OpenAiCompatibleEngine(
      {
        id: "groq",
        label: "Groq",
        description: "Whisper large-v3 turbo on Groq. Very fast, with a free tier; audio is sent to Groq.",
        baseUrl: "https://api.groq.com/openai/v1",
        model: "whisper-large-v3-turbo",
        envKey: GROQ_API_KEY,
        keyUrl: "https://console.groq.com/keys",
      },
      keys,
    ),
  ];
}

export class TranscriptionService {
  private jobs = new Map<string, JobState>();
  private limit = createLimiter(1);

  private constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
    private engines: Map<TranscriptionEngineId, TranscriptionEngine>,
  ) {}

  static async create(paths: DataPaths, library: MediaLibrary, opts: TranscriptionOptions = {}): Promise<TranscriptionService> {
    const keys = new ApiKeyStore(paths.settingsFile);
    await keys.load();
    const engines = opts.engines ?? defaultEngines(keys, opts.modelsDir ?? MODELS_DIR);
    return new TranscriptionService(paths, library, new Map(engines.map((e) => [e.id, e])));
  }

  listEngines(): Promise<TranscriptionEngineInfo[]> {
    return Promise.all([...this.engines.values()].map((e) => e.info()));
  }

  async setUp(id: string, body: unknown): Promise<TranscriptionEngineInfo> {
    const engine = this.engine(id);
    await engine.setUp((body ?? {}) as SetUpEngineRequest);
    return engine.info();
  }

  async forget(id: string): Promise<TranscriptionEngineInfo> {
    const engine = this.engine(id);
    await engine.forget?.();
    return engine.info();
  }

  async create(body: unknown): Promise<TranscriptionJob> {
    const req = body as Partial<TranscribeRequest> | null;
    if (!req || typeof req !== "object" || !Array.isArray(req.sources)) {
      throw new HttpError(400, "Expected { engine, language, sources }.");
    }
    const engine = this.engine(String(req.engine));
    const language = typeof req.language === "string" ? req.language : "";
    if (!isCaptionLanguage(language)) throw new HttpError(400, "Unknown language.");
    if (!(await ffmpegVersion())) throw new HttpError(503, "ffmpeg isn't installed, so speech can't be read.");
    if ((await engine.info()).status !== "ready") throw new HttpError(409, "That transcription engine isn't set up yet.");
    const ranges = this.ranges(req.sources);
    if (ranges.length === 0) throw new HttpError(400, "None of those clips have sound.");
    if (ranges.reduce((n, r) => n + r.out - r.in, 0) > MAX_TOTAL) throw new HttpError(400, "That's over 3 hours of sound.");

    const job: TranscriptionJob = { id: createId("trans"), status: "queued", progress: 0, transcripts: null };
    const state: JobState = { job, engine, language, ranges, controller: new AbortController() };
    this.jobs.set(job.id, state);
    this.limit(() => this.run(state)).catch((err) => logger.error("a transcription job failed", err));
    return { ...job };
  }

  get(id: string): TranscriptionJob {
    return { ...this.state(id).job };
  }

  cancel(id: string): void {
    const { job, controller } = this.state(id);
    if (job.status !== "queued" && job.status !== "running") return;
    job.status = "cancelled";
    controller.abort();
  }

  shutdown(): void {
    for (const { controller } of this.jobs.values()) controller.abort();
  }

  private engine(id: string): TranscriptionEngine {
    const engine = this.engines.get(id as TranscriptionEngineId);
    if (!engine) throw new HttpError(404, "Unknown transcription engine");
    return engine;
  }

  private state(id: string): JobState {
    const state = isValidId(id) ? this.jobs.get(id) : undefined;
    if (!state) throw new HttpError(404, "Transcription not found");
    return state;
  }

  /** Valid sources, clamped to their media, with overlapping (or nearly touching) ones of a file merged. */
  private ranges(sources: unknown[]): Range[] {
    const byAsset = new Map<string, Range[]>();
    for (const raw of sources) {
      const s = raw as { assetId?: unknown; in?: unknown; out?: unknown } | null;
      const asset = typeof s?.assetId === "string" ? this.library.find(s.assetId) : undefined;
      if (!asset?.hasAudio || asset.status === "error") continue;
      const from = Math.max(0, Number(s!.in));
      const to = Math.min(asset.duration, Number(s!.out));
      if (!Number.isFinite(from) || !Number.isFinite(to) || to - from < 0.05) continue;
      byAsset.set(asset.id, [...(byAsset.get(asset.id) ?? []), { asset, in: from, out: to }]);
    }
    const merged: Range[] = [];
    for (const list of byAsset.values()) {
      list.sort((a, b) => a.in - b.in);
      for (const r of list) {
        const last = merged.at(-1);
        if (last && last.asset === r.asset && r.in <= last.out + JOIN_GAP) last.out = Math.max(last.out, r.out);
        else merged.push({ ...r });
      }
    }
    return merged;
  }

  private async run(state: JobState): Promise<void> {
    const { job, engine, language, ranges, controller } = state;
    if (job.status !== "queued") return;
    job.status = "running";
    const began = performance.now();
    const total = ranges.reduce((n, r) => n + r.out - r.in, 0);
    let done = 0;
    const transcripts: Transcript[] = [];
    try {
      for (const range of ranges) {
        const length = range.out - range.in;
        transcripts.push(
          await this.transcribe(engine, range, language, controller.signal, (f) => {
            job.progress = Math.min(0.99, (done + f * length) / total);
          }),
        );
        done += length;
        job.progress = Math.min(0.99, done / total);
      }
      if (controller.signal.aborted) return;
      Object.assign(job, { status: "done", progress: 1, transcripts });
      logger.info(`${job.id} done in ${elapsed(began)} (${engine.id}, ${Math.round(total)} s of sound)`);
    } catch (err) {
      if (controller.signal.aborted) return; // cancelled (status already set) or shutting down
      job.status = "error";
      job.error = errorMessage(err);
      logger.error(`${job.id} failed: ${job.error}`);
    }
  }

  /** One stretch of a file, from the cache when it was transcribed the same way before. */
  private async transcribe(
    engine: TranscriptionEngine,
    range: Range,
    language: string,
    signal: AbortSignal,
    onProgress: (fraction: number) => void,
  ): Promise<Transcript> {
    const key = createHash("sha256")
      .update(JSON.stringify([CACHE_VERSION, engine.model, language, roundTime(range.in), roundTime(range.out)]))
      .digest("hex")
      .slice(0, 20);
    const dir = this.library.transcriptsDir(range.asset.id);
    const cacheFile = path.join(dir, `${key}.json`);
    const cached = await readJson<Transcript>(cacheFile);
    if (cached && Array.isArray(cached.words)) return cached;

    const base = { assetId: range.asset.id, in: range.in, out: range.out };
    const pcm = await decodeSpeech(this.library.sourcePath(range.asset), range.in, range.out, signal);
    const { regions, voiced } = analyseSpeech(pcm);
    let transcript: Transcript = { ...base, language: language === "auto" ? null : language, words: [] };
    if (regions.length) {
      const squeezed = squeeze(pcm, regions);
      const wav = this.paths.tmpFile(".wav");
      const temps = [wav];
      try {
        await fs.writeFile(wav, wavFile(squeezed.pcm));
        const result = await engine.transcribe(wav, {
          language,
          signal,
          onProgress,
          tmpFile: (suffix) => {
            const file = this.paths.tmpFile(suffix);
            temps.push(file);
            return file;
          },
        });
        const timed = result.words.map((w) => ({ text: w.text, ...originalSpan(squeezed.segments, w.start, w.end) }));
        const words = snapToSpeech(timed, voiced).map((w) => ({
          text: w.text,
          start: roundTime(range.in + w.start),
          end: roundTime(range.in + w.end),
        }));
        transcript = { ...base, language: result.language ?? transcript.language, words };
      } finally {
        await Promise.all(temps.map((f) => fs.rm(f, { force: true })));
      }
    }
    // The media may have been deleted meanwhile; then there's nothing to cache for.
    if (this.library.find(range.asset.id)) {
      await fs.mkdir(dir, { recursive: true });
      await writeJson(cacheFile, transcript).catch(() => {});
    }
    return transcript;
  }
}
