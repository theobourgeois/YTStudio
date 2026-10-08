import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createApp } from "./app.ts";
import { FFMPEG, LOG_LEVEL, config } from "./config.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import { log, startLogging } from "./log.ts";

startLogging({ dir: path.join(config.dataDir, "logs"), level: LOG_LEVEL });
const logger = log("server");

const version = await ffmpegVersion();
if (version) {
  logger.info(`using ffmpeg ${version}`);
} else {
  logger.warn(
    `ffmpeg not found (tried "${FFMPEG}"). Importing and exporting media ` +
      "won't work. Install ffmpeg or set FFMPEG_PATH / FFPROBE_PATH.",
  );
}

let clientDir: string | undefined;
if (config.production) {
  if (existsSync(config.clientDir)) clientDir = config.clientDir;
  else logger.warn(`${config.clientDir} not found — run \`pnpm build\` to serve the app.`);
}

const { app, shutdown } = await createApp({ dataDir: config.dataDir, clientDir });
const server = http.createServer(app);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") logger.error(`port ${config.port} is already in use (set EDITOR_SERVER_PORT to change it).`);
  else logger.error("the server failed", err);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  logger.info(`listening on http://${config.host}:${config.port} (data: ${config.dataDir})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown();
    server.close();
    server.closeAllConnections();
    process.exit(0);
  });
}
