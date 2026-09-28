import path from "node:path";
import express, { type ErrorRequestHandler, type Express, type Response } from "express";
import type { HealthResponse } from "../shared/types.ts";
import { ExportManager } from "./exports.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import { MediaLibrary } from "./media.ts";
import { ProjectStore } from "./project.ts";
import { DataPaths, HttpError } from "./storage.ts";

export interface AppOptions {
  dataDir: string;
  /** Built web client to serve with an SPA fallback (production only). */
  clientDir?: string;
}

export interface EditorApp {
  app: Express;
  /** Stop background processing and kill running renders. */
  shutdown(): void;
}

/** Content types `mime-types` gets wrong (or too exotic) for browsers. */
const CONTENT_TYPE_OVERRIDES: Record<string, string> = {
  ".m4v": "video/mp4",
  ".flac": "audio/flac",
};

function setFileHeaders(res: Response, file: string) {
  const ext = path.extname(file).toLowerCase();
  const type = CONTENT_TYPE_OVERRIDES[ext];
  if (type) res.setHeader("Content-Type", type);
  // Everything under an id is write-once, except JSON documents which get updated.
  res.setHeader("Cache-Control", ext === ".json" ? "no-cache" : "public, max-age=31536000, immutable");
}

export async function createApp({ dataDir, clientDir }: AppOptions): Promise<EditorApp> {
  const paths = new DataPaths(dataDir);
  await paths.init();
  const library = new MediaLibrary(paths);
  await library.load();
  const projects = new ProjectStore(paths.project, () => library.byId());
  const renders = new ExportManager(paths, library);

  const app = express();
  app.disable("x-powered-by");
  const json = express.json({ limit: "10mb" });

  app.get("/api/health", async (_req, res) => {
    const version = await ffmpegVersion();
    const body: HealthResponse = { ok: true, ffmpeg: { available: version !== null, version } };
    res.json(body);
  });

  app.get("/api/media", (_req, res) => {
    res.json(library.list());
  });
  // The body is the raw file; no body parser runs on this route.
  app.post("/api/media", async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    res.status(201).json(await library.ingest(req, name));
  });
  app.get("/api/media/:id", (req, res) => {
    res.json(library.get(req.params.id));
  });
  app.delete("/api/media/:id", async (req, res) => {
    await library.remove(req.params.id);
    res.sendStatus(204);
  });

  app.get("/api/project", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await projects.load());
  });
  app.put("/api/project", json, async (req, res) => {
    await projects.save(req.body);
    res.sendStatus(204);
  });

  app.post("/api/exports", json, async (req, res) => {
    res.status(202).json(await renders.create(req.body));
  });
  app.get("/api/exports/:id", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(renders.get(req.params.id));
  });
  app.delete("/api/exports/:id", (req, res) => {
    renders.cancel(req.params.id);
    res.sendStatus(204);
  });
  app.get("/api/exports/:id/download", (req, res, next) => {
    const { file, name } = renders.output(req.params.id);
    res.download(file, name, (err) => {
      if (err && !res.headersSent) next(new HttpError(410, "The exported file is gone."));
    });
  });

  app.use("/api", () => {
    throw new HttpError(404, "Not found");
  });

  const staticOptions = { index: false, dotfiles: "ignore", setHeaders: setFileHeaders } as const;
  app.use("/files/media", express.static(paths.media, staticOptions));
  app.use("/files/exports", express.static(paths.exports, staticOptions));
  app.use("/files", () => {
    throw new HttpError(404, "File not found");
  });

  if (clientDir) {
    app.use(express.static(clientDir));
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; expose?: boolean; message?: string };
    const status = err instanceof HttpError ? err.status : (e.status ?? e.statusCode ?? 500);
    if (!(err instanceof HttpError) && status >= 500) console.error(err);
    const message =
      err instanceof HttpError || e.expose ? (e.message ?? "Request failed") : "Internal server error";
    res.status(status).setHeader("Cache-Control", "no-store").json({ error: message });
  };
  app.use(onError);

  return {
    app,
    shutdown() {
      library.shutdown();
      renders.shutdown();
    },
  };
}
