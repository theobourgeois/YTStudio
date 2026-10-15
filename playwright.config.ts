import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The e2e suite runs its own server + web app on separate ports with a
// throwaway data dir, so it never touches your real ./data. E2E_WEB_PORT and
// E2E_SERVER_PORT move it, so two checkouts can run their suites at once.
const WEB_PORT = Number(process.env.E2E_WEB_PORT) || 5320;
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 5321;
const DATA_DIR = "e2e/.data";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  // The photo suite renders with WebGPU: headless Chromium has an adapter only with the GPU switched on (the export's
  // flags, server/gl-browser.ts).
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])] },
      },
    },
  ],
  webServer: [
    {
      command: "tsx scripts/e2e-server.ts",
      // Stand-ins for the transcription engine, Claude Code and Codex (and yt-dlp, below): the tests don't need whisper.cpp, an API key or a login.
      env: {
        // Never spend a real provider key loaded from local .env in browser tests.
        GEMINI_API_KEY: "e2e-not-a-real-key",
        EDITOR_DATA_DIR: DATA_DIR,
        EDITOR_SERVER_PORT: String(SERVER_PORT),
        EDITOR_TRANSCRIPTION_ENGINE: "fake",
        CLAUDE_PATH: path.resolve(import.meta.dirname, "e2e/fake-claude.mjs"),
        CODEX_PATH: path.resolve(import.meta.dirname, "e2e/fake-codex.mjs"),
        // And for the music suite's audio engine: no sound, no plugins of this computer.
        EDITOR_ENGINE_PATH: path.resolve(import.meta.dirname, "server/music/fake-engine.mjs"),
        // And for online media (the video editor's Online panel, the music Browser's Online tab): never the web.
        YTDLP_PATH: path.resolve(import.meta.dirname, "e2e/fake-ytdlp.mjs"),
        // And for the photo suite's Select Subject: no 88 MB model download.
        EDITOR_PHOTO_MODELS: "stand-in",
        // And for the music suite's Extract stems and Convert to notes: no model, each stem an even share of the file, a made-up melody.
        EDITOR_MUSIC_MODELS: "stand-in",
        // And for the Serum player's browser: a small library of made-up presets, not this computer's Serum.
        EDITOR_SERUM_LIBRARY: "stand-in",
        EDITOR_ONLINE_ASSETS: "stand-in",
        // And for Now Playing: made-up songs, never this computer's Spotify.
        EDITOR_NOW_PLAYING: "stand-in",
        EDITOR_VIBE_MODEL: "stand-in",
      },
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "vite",
      env: { EDITOR_SERVER_PORT: String(SERVER_PORT), EDITOR_WEB_PORT: String(WEB_PORT) },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
