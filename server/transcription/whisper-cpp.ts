/**
 * Transcribing on this computer with whisper.cpp (`whisper-cli`), which runs
 * Whisper on the GPU (Metal on Apple silicon): free, private, offline, and
 * faster than real time. Setting it up is one click in the app: whisper.cpp
 * comes from Homebrew and the model is downloaded (and checked) into
 * `MODELS_DIR`, shared by every checkout of the app.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { TranscriptionEngineInfo } from "../../shared/types.ts";
import { errorMessage } from "../../shared/errors.ts";
import { WHISPER } from "../config.ts";
import { run } from "../process.ts";
import { wavFile, SAMPLE_RATE } from "./audio.ts";
import { ENGLISH_STYLE_PROMPT, type EngineResult, type TranscribeOptions, type TranscriptionEngine, wordsFromPieces } from "./engine.ts";

/** Whisper large-v3 turbo, 5-bit: close to large-v3's accuracy at a fraction of the size and time. */
export const WHISPER_MODEL = {
  file: "ggml-large-v3-turbo-q5_0.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
  size: 574_041_195,
  sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
};

const MB = 1_000_000;
const BINARIES = ["whisper-cli", "/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli"];
const BREWS = ["brew", "/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

/** The first of `candidates` that runs with `args`, or null. */
async function firstThatRuns(candidates: string[], args: string[]): Promise<string | null> {
  for (const c of candidates) {
    try {
      await run(c, args);
      return c;
    } catch {
      // not there
    }
  }
  return null;
}

interface SetupState {
  running: boolean;
  step: string | null;
  progress: number | null;
  error: string | null;
}

export class WhisperCppEngine implements TranscriptionEngine {
  readonly id = "local" as const;
  readonly model = `whisper.cpp/${WHISPER_MODEL.file}/1`;
  private setup: SetupState = { running: false, step: null, progress: null, error: null };

  constructor(private modelsDir: string) {}

  private get modelPath() {
    return path.join(this.modelsDir, WHISPER_MODEL.file);
  }

  private binary(): Promise<string | null> {
    return firstThatRuns(WHISPER ? [WHISPER] : BINARIES, ["--version"]);
  }

  private async hasModel(): Promise<boolean> {
    const stat = await fs.stat(this.modelPath).catch(() => null);
    return stat?.size === WHISPER_MODEL.size;
  }

  async info(): Promise<TranscriptionEngineInfo> {
    const base = {
      id: this.id,
      label: "On this Mac",
      description: "Whisper large-v3 turbo, running on this computer. Free, private and works offline.",
      kind: "local" as const,
    };
    if (this.setup.running) {
      return { ...base, status: "installing", message: this.setup.step, progress: this.setup.progress, canSetUp: true };
    }
    const [bin, model] = await Promise.all([this.binary(), this.hasModel()]);
    if (bin && model) return { ...base, status: "ready", message: null, progress: null, canSetUp: true };
    const brew = bin ? null : await firstThatRuns(BREWS, ["--version"]);
    const missing = [!bin && "whisper.cpp", !model && `a ${Math.round(WHISPER_MODEL.size / MB)} MB speech model`].filter(Boolean);
    const message =
      this.setup.error ??
      (!bin && !brew
        ? "Needs whisper.cpp. Install Homebrew (brew.sh) and try again, or install whisper.cpp yourself and set WHISPER_PATH."
        : `Needs ${missing.join(" and ")}, set up in one go.`);
    return { ...base, status: this.setup.error ? "error" : "missing", message, progress: null, canSetUp: !!(bin || brew) };
  }

  async setUp(): Promise<void> {
    if (this.setup.running) return;
    this.setup = { running: true, step: "Starting…", progress: null, error: null };
    void this.install().then(
      () => (this.setup = { running: false, step: null, progress: null, error: null }),
      (err) => {
        console.error("[transcription] setup failed:", err);
        this.setup = { running: false, step: null, progress: null, error: `Setup failed: ${errorMessage(err)}` };
      },
    );
  }

  private async install(): Promise<void> {
    if (!(await this.binary())) {
      const brew = await firstThatRuns(BREWS, ["--version"]);
      if (!brew) throw new Error("Homebrew isn't installed.");
      Object.assign(this.setup, { step: "Installing whisper.cpp with Homebrew…", progress: null });
      await run(brew, ["install", "whisper-cpp"], {
        env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1" },
      });
      if (!(await this.binary())) throw new Error("whisper.cpp was installed but can't be run.");
    }
    if (!(await this.hasModel())) await this.download();
    // The first run compiles the GPU kernels (several seconds); do it now rather than on the first real clip.
    Object.assign(this.setup, { step: "Getting ready…", progress: null });
    const silence = path.join(os.tmpdir(), `editor-warmup-${process.pid}.wav`);
    await fs.writeFile(silence, wavFile(new Int16Array(SAMPLE_RATE)));
    try {
      await run((await this.binary())!, ["-m", this.modelPath, "-f", silence, "-l", "en", "-np"]);
    } finally {
      await fs.rm(silence, { force: true });
    }
  }

  /** Download the model, checking its size and checksum before it's used. */
  private async download(): Promise<void> {
    Object.assign(this.setup, { step: "Downloading the speech model…", progress: 0 });
    await fs.mkdir(this.modelsDir, { recursive: true });
    const part = `${this.modelPath}.${process.pid}.part`;
    try {
      const res = await fetch(WHISPER_MODEL.url);
      if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`);
      const hash = createHash("sha256");
      let received = 0;
      const count = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          received += chunk.length;
          hash.update(chunk);
          this.setup.progress = Math.min(1, received / WHISPER_MODEL.size);
          done(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), count, createWriteStream(part));
      if (received !== WHISPER_MODEL.size || hash.digest("hex") !== WHISPER_MODEL.sha256) {
        throw new Error("The downloaded model is damaged. Try again.");
      }
      await fs.rename(part, this.modelPath);
    } finally {
      await fs.rm(part, { force: true });
    }
  }

  async transcribe(wav: string, { language, signal, onProgress, tmpFile }: TranscribeOptions): Promise<EngineResult> {
    const bin = await this.binary();
    if (!bin || !(await this.hasModel())) throw new Error("Transcribing on this Mac isn't set up yet.");
    const lang = language === "auto" ? ((await this.detectLanguage(bin, wav, signal)) ?? "auto") : language;
    const out = tmpFile("");
    const args = [
      "-m", this.modelPath, "-f", wav, "-l", lang,
      "-ojf", "-of", out, "-np", "-pp",
      // No "[Music]", "♪" or other non-speech tokens.
      "-sns",
      "-t", String(Math.min(8, os.availableParallelism())),
    ];
    if (lang === "en") args.push("--prompt", ENGLISH_STYLE_PROMPT);
    let tail = "";
    await run(bin, args, {
      signal,
      onStderr: (chunk) => {
        tail = (tail + chunk.toString("utf8")).slice(-200);
        const matches = [...tail.matchAll(/progress\s*=\s*(\d+)%/g)];
        const last = matches.at(-1);
        if (last) onProgress(Number(last[1]) / 100);
      },
    });
    try {
      const result = parseWhisperJson(JSON.parse(await fs.readFile(`${out}.json`, "utf8")));
      return { ...result, language: result.language ?? (lang === "auto" ? null : lang) };
    } finally {
      await fs.rm(`${out}.json`, { force: true });
    }
  }

  /** The spoken language, from a quick first pass (so English gets its prompt). */
  private async detectLanguage(bin: string, wav: string, signal: AbortSignal): Promise<string | null> {
    let stderr = "";
    await run(bin, ["-m", this.modelPath, "-f", wav, "-l", "auto", "-dl"], {
      signal,
      onStderr: (chunk) => (stderr += chunk.toString("utf8")),
    });
    return /auto-detected language:\s*([a-z]{2,3})\b/.exec(stderr)?.[1] ?? null;
  }
}

interface WhisperJson {
  result?: { language?: unknown };
  transcription?: { tokens?: { text?: unknown; offsets?: { from?: unknown; to?: unknown } }[] }[];
}

/** Words from whisper-cli's `--output-json-full` (token times are in ms; special tokens look like "[_BEG_]"). */
export function parseWhisperJson(json: WhisperJson): EngineResult {
  const pieces: { text: string; start: number; end: number }[] = [];
  for (const segment of json.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      if (typeof token.text !== "string" || token.text.startsWith("[_") || token.text.startsWith("<|")) continue;
      const from = Number(token.offsets?.from);
      const to = Number(token.offsets?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
      pieces.push({ text: token.text, start: from / 1000, end: to / 1000 });
    }
  }
  const language = typeof json.result?.language === "string" ? json.result.language : null;
  return { language, words: wordsFromPieces(pieces) };
}
