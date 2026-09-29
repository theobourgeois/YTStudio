import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export const config = {
  dataDir: path.resolve(process.env.EDITOR_DATA_DIR || path.join(REPO_ROOT, "data")),
  port: Number(process.env.EDITOR_SERVER_PORT) || 5311,
  host: "127.0.0.1",
  production: process.env.NODE_ENV === "production",
  clientDir: path.join(REPO_ROOT, "dist"),
};

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
export const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
/** Chromium or Chrome for rendering transitions (default: Playwright's, else the installed Google Chrome). */
export const CHROMIUM = process.env.CHROMIUM_PATH || null;
/** whisper.cpp's command line tool, for transcribing on this computer (default: on the PATH, else Homebrew's). */
export const WHISPER = process.env.WHISPER_PATH || null;
/** Speech models, shared by every data dir (they're big): downloaded once per computer. */
export const MODELS_DIR = path.resolve(process.env.EDITOR_MODELS_DIR || path.join(os.homedir(), ".cache", "editor", "models"));
/** API keys for cloud transcription; otherwise they're entered in the app (and saved in the data dir). */
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
export const GROQ_API_KEY = process.env.GROQ_API_KEY || null;
/** Claude Code's command line tool, which runs the in-app assistant (default: on the PATH, else its usual homes). */
export const CLAUDE = process.env.CLAUDE_PATH || null;
/** "fake" swaps the local transcription engine for one that makes words up (the e2e tests). */
export const TRANSCRIPTION_ENGINE = process.env.EDITOR_TRANSCRIPTION_ENGINE || null;
