import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { MILKDROP_DIR, MILKDROP_PRESETS } from "./shared/milkdrop-presets.ts";

const SERVER_PORT = Number(process.env.EDITOR_SERVER_PORT) || 5311;

/**
 * MilkDrop's presets picked (shared/milkdrop-presets.ts), by name, as one module (`virtual:milkdrop-presets`): read from
 * `butterchurn-presets`' converted ones, a file each, so the bundle holds only those, loaded with Butterchurn.
 */
function milkdropPresets(): Plugin {
  const id = "virtual:milkdrop-presets";
  return {
    name: "milkdrop-presets",
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const dir = path.resolve(import.meta.dirname, "node_modules", MILKDROP_DIR);
      const presets = Object.fromEntries(MILKDROP_PRESETS.map((p) => [p.name, JSON.parse(fs.readFileSync(path.join(dir, `${p.name}.json`), "utf8"))]));
      // (No source map: it'd be several times the presets' size.)
      return { code: `export default ${JSON.stringify(presets)};`, map: { mappings: "" } };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), milkdropPresets()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@shared": path.resolve(import.meta.dirname, "./shared"),
    },
  },
  server: {
    port: Number(process.env.EDITOR_WEB_PORT) || 5310,
    strictPort: true,
    // Scripts that drive the page (photo-sheet.ts) turn reloads off: an edit elsewhere mustn't reload it mid-run.
    ...(process.env.EDITOR_NO_HMR ? { hmr: false } : {}),
    // Generated binaries can be locked while packaged on Windows; they are never frontend inputs.
    watch: { ignored: ["**/release/**", "**/engine/build/**", "**/build/**", "**/dist-electron/**", "**/data/**", "**/e2e/.data/**", "**/*.log"] },
    proxy: {
      "/api": `http://127.0.0.1:${SERVER_PORT}`,
      "/files": `http://127.0.0.1:${SERVER_PORT}`,
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    include: ["shared/**/*.test.ts", "src/**/*.test.{ts,tsx}", "server/**/*.test.ts", "electron/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
