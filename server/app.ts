import path from "node:path";
import express, { type ErrorRequestHandler, type Express, type Response } from "express";
import type { HostWindow } from "../shared/music/engine.ts";
import type { HealthResponse } from "../shared/types.ts";
import { Bridge } from "./assistant/bridge.ts";
import { mcpHandler } from "./assistant/mcp.ts";
import { AssistantService } from "./assistant/service.ts";
import { config } from "./config.ts";
import { ExportManager } from "./exports.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import { listFonts } from "./fonts.ts";
import { LibraryStore } from "./library.ts";
import { MediaLibrary } from "./media.ts";
import { migrateLegacyData } from "./migrate.ts";
import { AudioEngine, type EngineOptions } from "./music/engine.ts";
import { SampleBrowser } from "./music/browser.ts";
import { browserRoutes, engineRoutes } from "./music/routes.ts";
import { ProjectStore } from "./projects.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { exportRoutes } from "./routes/exports.ts";
import { libraryRoutes } from "./routes/library.ts";
import { mediaRoutes } from "./routes/media.ts";
import { projectRoutes } from "./routes/projects.ts";
import { suiteBackend } from "./suites/index.ts";
import { transcriptionRoutes } from "./routes/transcription.ts";
import { webRoutes } from "./routes/web.ts";
import { DataPaths, HttpError } from "./storage.ts";
import { type TranscriptionOptions, TranscriptionService } from "./transcription/service.ts";
import { WebMediaLibrary } from "./web-media.ts";

export interface AppOptions {
  dataDir: string;
  /** Built web client to serve with an SPA fallback (production only). */
  clientDir?: string;
  /** yt-dlp binary (defaults to `YTDLP_PATH` or `yt-dlp` on the PATH). */
  ytdlpPath?: string;
  /** Transcription engines and where their models live (defaults: the real ones). */
  transcription?: TranscriptionOptions;
  /** The command that runs Claude Code for the assistant (default: found on this computer). */
  claudeCommand?: string;
  /** Codex's command (default: found on this computer). */
  codexCommand?: string;
  /** The music suite's audio engine (default: the one built in `engine/`). */
  engine?: EngineOptions;
}

export interface EditorApp {
  app: Express;
  /** Stop background processing and kill running renders. */
  shutdown(): void;
  /** The desktop app's window changed: the audio engine's plugin windows follow it (`HostWindow`). */
  setHostWindow(host: HostWindow): void;
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

export async function createApp({
  dataDir,
  clientDir,
  ytdlpPath,
  transcription: transcriptionOptions,
  claudeCommand,
  codexCommand,
  engine: engineOptions,
}: AppOptions): Promise<EditorApp> {
  const paths = new DataPaths(dataDir);
  await paths.init();
  const library = new MediaLibrary(paths);
  await library.load();
  const projects = new ProjectStore(paths, library);
  await projects.load();
  await migrateLegacyData(paths, library, projects);
  library.resume();
  const exports = new ExportManager(paths, library);
  const web = new WebMediaLibrary(paths, library, ytdlpPath);
  await web.load();
  const libraryMedia = new MediaLibrary(paths, { dir: paths.libraryMedia, url: "/files/library" });
  const shared = new LibraryStore(paths, libraryMedia, library, (id) => projects.has(id));
  await shared.load();
  const transcription = await TranscriptionService.create(paths, library, transcriptionOptions);
  // The port the assistant's agents reach the MCP server on: the one requests arrive on.
  let port = config.port;
  const bridge = new Bridge();
  const assistant = new AssistantService(paths, bridge, {
    commands: { claude: claudeCommand, codex: codexCommand },
    port: () => port,
    suiteOf: (id) => projects.suiteOf(id),
  });
  await assistant.init();
  const engine = new AudioEngine(paths, {
    samplePath(projectId, mediaId) {
      const asset = library.find(mediaId);
      return asset && asset.projectId === projectId && asset.hasAudio ? library.sourcePath(asset) : null;
    },
    ...engineOptions,
  });

  const browser = new SampleBrowser(paths);
  await browser.load();

  const app = express();
  app.disable("x-powered-by");

  app.get("/api/health", async (_req, res) => {
    const version = await ffmpegVersion();
    const body: HealthResponse = { ok: true, ffmpeg: { available: version !== null, version } };
    res.json(body);
  });

  app.use((req, _res, next) => {
    port = req.socket.localPort ?? port;
    next();
  });

  app.use("/api/projects", projectRoutes(projects, (id) => assistant.remove(id)));
  app.use("/api/media", mediaRoutes(library, projects));
  app.use("/api/web", webRoutes(web, projects));
  app.use("/api/library", libraryRoutes(shared));
  app.use("/api/exports", exportRoutes(exports));
  app.use("/api/transcription", transcriptionRoutes(transcription));
  app.use("/api/assistant", assistantRoutes(assistant, bridge));
  app.use("/api/engine", engineRoutes(engine));
  app.use("/api/browser", browserRoutes(browser, engine, {
      hasProject: (id) => projects.has(id),
      find: (projectId, origin) => library.list(projectId).find((a) => a.origin === origin),
      importFile: (file, projectId, origin) => library.importFile(file, projectId, () => projects.has(projectId), origin),
    }),);
  app.all(
    "/mcp",
    express.json({ limit: "4mb" }),
    mcpHandler({
      version: "1",
      suiteFor: (query) => assistant.suiteFor(query),
      instructions: (suite) => suiteBackend(suite).assistant.instructions,
      callTool: (call, query) => assistant.callTool(call, query),
    }),
  );
  app.get("/api/fonts", async (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.json(await listFonts());
  });

  app.use("/api", () => {
    throw new HttpError(404, "Not found");
  });

  const staticOptions = { index: false, dotfiles: "ignore", setHeaders: setFileHeaders } as const;
  app.use("/files/media", express.static(paths.media, staticOptions));
  app.use("/files/library", express.static(paths.libraryMedia, staticOptions));
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
    setHostWindow: (host) => engine.setHost(host),
    shutdown() {
      library.shutdown();
      libraryMedia.shutdown();
      exports.shutdown();
      web.shutdown();
      transcription.shutdown();
      assistant.shutdown();
      bridge.shutdown();
      engine.shutdown();
      browser.close();
    },
  };
}
