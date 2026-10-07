import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const SERVER_PORT = Number(process.env.EDITOR_SERVER_PORT) || 5311;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
