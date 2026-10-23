/**
 * The editor's server: the same Express app as `pnpm dev`, on 127.0.0.1. The desktop app runs it in a
 * process of its own (server-process.ts); imported only once the environment is set (server/config.ts reads
 * it on load). Nothing here may use Electron's main-process modules.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type AppOptions, createApp } from "../server/app.ts";
import { APP, FFMPEG, RECENTS_FROM } from "../server/config.ts";
import { ffmpegVersion } from "../server/ffmpeg.ts";
import { log } from "../server/log.ts";
import { type GlPageOpener, setGlPageOpener } from "../server/gl-browser.ts";

export interface ServerOptions {
  dataDir: string;
  /** The built web app to serve (packaged app); in development Vite serves it. */
  clientDir?: string;
  /** Ports to try in order; 0 means any free one. */
  ports: number[];
  /** Put a project's package in the Trash, show one in Finder (the system's own). */
  trash?: AppOptions["trash"];
  reveal?: AppOptions["reveal"];
  /** The export's drawing page, in the app's own Chromium (a hidden window of the main process's). */
  openGlPage?: GlPageOpener;
}

export interface RunningServer {
  port: number;
  /** Stop background work and renders, and close the server. */
  close(): void;
}

function listen(server: http.Server, port: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (err.code === "EADDRINUSE") resolve(null);
      else reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startServer({ dataDir, clientDir, ports, trash, reveal, openGlPage }: ServerOptions): Promise<RunningServer> {
  if (openGlPage) setGlPageOpener(openGlPage);
  const version = await ffmpegVersion();
  const logger = log("desktop");
  if (version) logger.info(`using ffmpeg ${version}`);
  else logger.warn(`ffmpeg not found (tried "${FFMPEG}"): importing and exporting won't work.`);

  const { app, shutdown } = await createApp({ dataDir, clientDir, trash, reveal, app: APP, recentsFrom: RECENTS_FROM });
  const server = http.createServer(app);
  for (const candidate of ports) {
    const port = await listen(server, candidate);
    if (port === null) continue;
    logger.info(`server on http://127.0.0.1:${port} (data: ${dataDir})`);
    return {
      port,
      close() {
        shutdown();
        server.close();
        server.closeAllConnections();
      },
    };
  }
  shutdown();
  throw new Error(`No free port for the editor's server (tried ${ports.join(", ")}).`);
}
