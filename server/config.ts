import { loadEnvFile } from "node:process";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

// Local credentials stay on the server; existing environment variables take precedence.
try { loadEnvFile(path.join(REPO_ROOT, ".env")); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const dataDir = path.resolve(process.env.EDITOR_DATA_DIR || path.join(REPO_ROOT, "data"));

export const config = {
  dataDir,
  /**
   * Where new projects are saved (each a package, `Name.vaudio`) until the user picks another folder:
   * `~/Documents/Vaudio`, or, when a data folder is given (tests, throwaway setups), its `Documents/Vaudio` (as the real one, `~/Documents/Vaudio`), so
   * they never reach the user's Documents. The desktop app sets it for its own data folder.
   */
  projectsDir: path.resolve(
    process.env.EDITOR_PROJECTS_DIR ||
      (process.env.EDITOR_DATA_DIR ? path.join(dataDir, "Documents", "Vaudio") : path.join(os.homedir(), "Documents", "Vaudio")),
  ),
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
/** Codex's command line tool, which can run the in-app assistant instead (default: on the PATH, else its usual homes). */
export const CODEX = process.env.CODEX_PATH || null;
/**
 * The music suite's audio engine (`engine/`, built by `pnpm engine:build`), and extra folders it looks for
 * VST3 plugins in, separated by ":" (default: the engine's own test synth and test effect, when they've been built).
 */
const ENGINE_BUILD = path.join(REPO_ROOT, "engine", "build");
export const ENGINE =
  process.env.EDITOR_ENGINE_PATH ||
  path.join(ENGINE_BUILD, "VaudioEngine_artefacts", "Release", "Vaudio Engine.app", "Contents", "MacOS", "Vaudio Engine");
/** The engine's own source (a checkout's, not a packaged app's): an engine built before it last changed is out of date. */
export const ENGINE_SOURCE = path.join(REPO_ROOT, "engine");
export const ENGINE_PLUGIN_PATHS = process.env.EDITOR_PLUGIN_PATHS
  ? process.env.EDITOR_PLUGIN_PATHS.split(path.delimiter).filter(Boolean)
  : ["VaudioTestSynth", "VaudioTestEffect"].map((name) => path.join(ENGINE_BUILD, "test-plugin", `${name}_artefacts`, "Release", "VST3"));
