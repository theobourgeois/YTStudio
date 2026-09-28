import { existsSync } from "node:fs";
import http from "node:http";
import { createApp } from "./app.ts";
import { FFMPEG, config } from "./config.ts";
import { ffmpegVersion } from "./ffmpeg.ts";

const version = await ffmpegVersion();
if (version) {
  console.log(`[server] using ffmpeg ${version}`);
} else {
  console.warn(
    `[server] WARNING: ffmpeg not found (tried "${FFMPEG}"). Importing and exporting media ` +
      "won't work. Install ffmpeg or set FFMPEG_PATH / FFPROBE_PATH.",
  );
}

let clientDir: string | undefined;
if (config.production) {
  if (existsSync(config.clientDir)) clientDir = config.clientDir;
  else console.warn(`[server] ${config.clientDir} not found — run \`pnpm build\` to serve the app.`);
}

const { app, shutdown } = await createApp({ dataDir: config.dataDir, clientDir });
const server = http.createServer(app);

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(
    err.code === "EADDRINUSE"
      ? `[server] port ${config.port} is already in use (set EDITOR_SERVER_PORT to change it).`
      : err,
  );
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown();
    server.close();
    server.closeAllConnections();
    process.exit(0);
  });
}
