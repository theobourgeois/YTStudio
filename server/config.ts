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
