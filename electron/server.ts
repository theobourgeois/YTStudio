/**
 * The editor's server, run inside the desktop app's main process: the same Express app as `pnpm dev`, on
 * 127.0.0.1. Imported by main.ts only after it has set the environment (server/config.ts reads it on load).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type AppOptions, type EditorApp, createApp } from "../server/app.ts";
import { FFMPEG } from "../server/config.ts";
import { ffmpegVersion } from "../server/ffmpeg.ts";
import { log } from "../server/log.ts";
import { setGlPageOpener } from "../server/gl-browser.ts";
import { openWindowPage } from "./gl-window.ts";

export interface ServerOptions {
  dataDir: string;
  /** The built web app to serve (packaged app); in development Vite serves it. */
  clientDir?: string;
  /** Ports to try in order; 0 means any free one. */
  ports: number[];
  /** Put a project's package in the Trash, show one in Finder (the system's own). */
  trash?: AppOptions["trash"];
  reveal?: AppOptions["reveal"];
}

export interface RunningServer {
  port: number;
  /** Stop background work and renders, and close the server. */
  close(): void;
  /** The app changed (in use or not, minimised, moved): plugin windows follow it. */
  setHostWindow: EditorApp["setHostWindow"];
  /** The engine's plugin windows took the focus from the app's, or gave it back, or one was used. */
  onEngineWindow: EditorApp["onEngineWindow"];
  raiseEngineWindow: EditorApp["raiseEngineWindow"];
  /** Close every plugin window. */
  closeEngineWindows: EditorApp["closeEngineWindows"];
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

export async function startServer({ dataDir, clientDir, ports, trash, reveal }: ServerOptions): Promise<RunningServer> {
  setGlPageOpener(openWindowPage);
  const version = await ffmpegVersion();
  const logger = log("desktop");
  if (version) logger.info(`using ffmpeg ${version}`);
  else logger.warn(`ffmpeg not found (tried "${FFMPEG}"): importing and exporting won't work.`);

  const { app, shutdown, setHostWindow, onEngineWindow, raiseEngineWindow, closeEngineWindows } = await createApp({ dataDir, clientDir, trash, reveal });
  const server = http.createServer(app);
  for (const candidate of ports) {
    const port = await listen(server, candidate);
    if (port === null) continue;
    logger.info(`server on http://127.0.0.1:${port} (data: ${dataDir})`);
    return {
      port,
      setHostWindow,
      onEngineWindow,
      raiseEngineWindow,
      closeEngineWindows,
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
