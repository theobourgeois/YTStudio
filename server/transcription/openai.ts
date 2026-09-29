/**
 * Cloud transcription through OpenAI's audio API, or anything speaking the
 * same protocol (Groq). The key is entered in the app (or set in the
 * environment); audio is sent as a small MP3 with the silences already
 * squeezed out, so it's quick and cheap.
 */
import { openAsBlob } from "node:fs";
import fs from "node:fs/promises";
import type { SetUpEngineRequest, TranscriptWord, TranscriptionEngineId, TranscriptionEngineInfo } from "../../shared/types.ts";
import { CAPTION_LANGUAGES } from "../../shared/captions.ts";
import { FFMPEG } from "../config.ts";
import { FFMPEG_QUIET } from "../ffmpeg.ts";
import { run } from "../process.ts";
import { HttpError } from "../storage.ts";
import type { EngineResult, TranscribeOptions, TranscriptionEngine } from "./engine.ts";
import type { ApiKeyStore } from "./settings.ts";

export interface CloudEngineConfig {
  id: Exclude<TranscriptionEngineId, "local">;
  label: string;
  description: string;
  baseUrl: string;
  model: string;
  /** A key from the environment, which wins over a saved one. */
  envKey: string | null;
  keyUrl: string;
}

/** OpenAI's upload limit is 25 MB; stay under it. */
const MAX_UPLOAD = 24 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 15_000;

export class OpenAiCompatibleEngine implements TranscriptionEngine {
  readonly id: CloudEngineConfig["id"];
  readonly model: string;

  constructor(
    private config: CloudEngineConfig,
    private keys: ApiKeyStore,
  ) {
    this.id = config.id;
    this.model = `${config.id}/${config.model}/1`;
  }

  private key(): string | null {
    return this.config.envKey ?? this.keys.get(this.id);
  }

  async info(): Promise<TranscriptionEngineInfo> {
    const ready = this.key() !== null;
    return {
      id: this.id,
      label: this.config.label,
      description: this.config.description,
      kind: "cloud",
      status: ready ? "ready" : "missing",
      message: ready ? null : `Add your ${this.config.label} API key.`,
      progress: null,
      canSetUp: true,
      keyFromEnv: this.config.envKey !== null,
      hasSavedKey: this.keys.get(this.id) !== null,
      keyUrl: this.config.keyUrl,
    };
  }

  /** Check the key with the API (listing models is free), then save it. */
  async setUp(body: SetUpEngineRequest): Promise<void> {
    const key = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!key || key.length > 500 || /\s/.test(key)) throw new HttpError(400, "Paste an API key.");
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch {
      throw new HttpError(502, `Couldn't reach ${this.config.label} to check the key. Are you online?`);
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(400, `${this.config.label} didn't accept that key.`);
    if (!res.ok) throw new HttpError(502, `Couldn't check the key with ${this.config.label} (HTTP ${res.status}).`);
    await this.keys.set(this.id, key);
  }

  async forget(): Promise<void> {
    await this.keys.set(this.id, null);
  }

  async transcribe(wav: string, { language, signal, onProgress, tmpFile }: TranscribeOptions): Promise<EngineResult> {
    const key = this.key();
    if (!key) throw new Error(`Add your ${this.config.label} API key first.`);
    const mp3 = tmpFile(".mp3");
    try {
      await run(FFMPEG, [...FFMPEG_QUIET, "-y", "-i", wav, "-ac", "1", "-b:a", "48k", mp3], { signal });
      const { size } = await fs.stat(mp3);
      if (size > MAX_UPLOAD) {
        throw new Error(`That's too much speech to send to ${this.config.label} at once. Caption fewer clips, or use this Mac.`);
      }
      onProgress(0.1);
      const form = new FormData();
      form.set("file", await openAsBlob(mp3, { type: "audio/mpeg" }), "speech.mp3");
      form.set("model", this.config.model);
      form.set("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      form.append("timestamp_granularities[]", "segment");
      if (language !== "auto") form.set("language", language);
      let res: Response;
      try {
        res = await fetch(`${this.config.baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: form,
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new Error(`Couldn't reach ${this.config.label}. Are you online?`);
      }
      const body = (await res.json().catch(() => null)) as VerboseJson | { error?: { message?: string } } | null;
      if (!res.ok) {
        const message = (body as { error?: { message?: string } } | null)?.error?.message;
        if (res.status === 401) throw new Error(`${this.config.label} rejected the API key. Add it again.`);
        throw new Error(`${this.config.label}: ${message ?? `HTTP ${res.status}`}`);
      }
      onProgress(1);
      return parseVerboseJson(body as VerboseJson);
    } finally {
      await fs.rm(mp3, { force: true });
    }
  }
}

export interface VerboseJson {
  language?: string;
  text?: string;
  words?: { word?: unknown; start?: unknown; end?: unknown }[];
}

const normal = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const LANGUAGE_CODES = new Map(CAPTION_LANGUAGES.map((l) => [l.label.toLowerCase(), l.code]));

/**
 * Words from a `verbose_json` transcription. Its words come without
 * punctuation or (sometimes) capitals, so each one takes its spelling from
 * the full text when they line up.
 */
export function parseVerboseJson(json: VerboseJson): EngineResult {
  const raw = (json.words ?? []).filter(
    (w): w is { word: string; start: number; end: number } =>
      typeof w.word === "string" && typeof w.start === "number" && typeof w.end === "number",
  );
  const spaced = /\s/.test((json.text ?? "").trim());
  const tokens = spaced ? (json.text ?? "").split(/\s+/).filter(Boolean) : [];
  let next = 0;
  const words: TranscriptWord[] = raw.map((w) => {
    const target = normal(w.word);
    let text = w.word.trim();
    for (let k = next; k < Math.min(tokens.length, next + 4); k++) {
      if (target && normal(tokens[k]) === target) {
        text = tokens[k];
        next = k + 1;
        break;
      }
    }
    return { text: spaced ? ` ${text}` : text, start: w.start, end: Math.max(w.start, w.end) };
  });
  const lang = json.language?.toLowerCase() ?? "";
  const language = LANGUAGE_CODES.get(lang) ?? (/^[a-z]{2}$/.test(lang) ? lang : null);
  return { language, words };
}
