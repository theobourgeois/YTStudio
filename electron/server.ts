/**
 * The editor's server, run inside the desktop app's main process: the same Express app as `pnpm dev`, on
 * 127.0.0.1. Imported by main.ts only after it has set the environment (server/config.ts reads it on load).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { FFMPEG } from "../server/config.ts";
import { ffmpegVersion } from "../server/ffmpeg.ts";
import { setGlPageOpener } from "../server/gl-browser.ts";
import { openWindowPage } from "./gl-window.ts";

export interface ServerOptions {
  dataDir: string;
  /** The built web app to serve (packaged app); in development Vite serves it. */
  clientDir?: string;
  /** Ports to try in order; 0 means any free one. */
  ports: number[];
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

export async function startServer({ dataDir, clientDir, ports }: ServerOptions): Promise<RunningServer> {
  setGlPageOpener(openWindowPage);
  const version = await ffmpegVersion();
  if (version) console.log(`[desktop] using ffmpeg ${version}`);
  else console.warn(`[desktop] ffmpeg not found (tried "${FFMPEG}"): importing and exporting won't work.`);

  const { app, shutdown } = await createApp({ dataDir, clientDir });
  const server = http.createServer(app);
  for (const candidate of ports) {
    const port = await listen(server, candidate);
    if (port === null) continue;
    console.log(`[desktop] server on http://127.0.0.1:${port} (data: ${dataDir})`);
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
