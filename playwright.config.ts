import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The e2e suite runs its own server + web app on separate ports with a
// throwaway data dir, so it never touches your real ./data.
const WEB_PORT = 5320;
const SERVER_PORT = 5321;
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `rm -rf ${DATA_DIR} && tsx scripts/make-samples.ts && tsx server/index.ts`,
      // Stand-ins for the transcription engine, Claude Code and Codex: the tests don't need whisper.cpp, an API key or a login.
      env: {
        EDITOR_DATA_DIR: DATA_DIR,
        EDITOR_SERVER_PORT: String(SERVER_PORT),
        EDITOR_TRANSCRIPTION_ENGINE: "fake",
        CLAUDE_PATH: path.resolve(import.meta.dirname, "e2e/fake-claude.mjs"),
        CODEX_PATH: path.resolve(import.meta.dirname, "e2e/fake-codex.mjs"),
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
