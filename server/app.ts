import { AudioIntelligence, AUDIO_SERVER_TOOLS } from "./music/audio-intelligence/service.ts";
import { audioIntelligenceRoutes } from "./music/audio-intelligence/routes.ts";
import { textResult } from "../shared/tool-spec.ts";
import { inspectPreview } from "./preview-media.ts";
import fs from "node:fs/promises";
import { ProjectPreviews } from "./project-previews.ts";
import { renderSongPreview } from "./music/project-preview.ts";
import type { MusicProject } from "../shared/music/types.ts";
import type { Project } from "../shared/types.ts";
import path from "node:path";
import express, { type ErrorRequestHandler, type Express, type Response } from "express";
import type { AppResponse, HealthResponse } from "../shared/types.ts";
import { type AppId, appInfo } from "../shared/apps.ts";
import { Bridge } from "./assistant/bridge.ts";
import { mcpHandler } from "./assistant/mcp.ts";
import { AssistantService } from "./assistant/service.ts";
import { ENGINE_CONNECT, GALLERY_DL, MODELS_DIR, MUSIC_MODELS, MUSIC_WORKER, NOW_PLAYING, ONLINE_ASSETS, PHOTO_HELPER, PHOTO_MODELS, SERUM_LIBRARY, VIBE_MODEL, config } from "./config.ts";
import { photoModels } from "./photo/models.ts";
import { ExportManager } from "./exports.ts";
import { RenderFiles } from "./render-files.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import { listFonts } from "./fonts.ts";
import { LibraryStore } from "./library.ts";
import { type ImageProbe, MediaLibrary } from "./media.ts";
import { adoptRecents, migrateData } from "./migrate.ts";
import { LookRatings } from "./look-ratings.ts";
import { NowPlaying, type Player, defaultPlayer } from "./now-playing.ts";
import { AudioEngine, type EngineOptions } from "./music/engine.ts";
import { SampleBrowser } from "./music/browser.ts";
import { type MusicExportOptions, MusicExports } from "./music/exports.ts";
import { SongVisualizers } from "./music/visualizer.ts";
import { NoteHearing } from "./music/hearing.ts";
import { musicModels } from "./music/ml.ts";
import { browserRoutes, engineRoutes, musicExportRoutes, musicModelRoutes, musicVisualizerRoutes, noteRoutes, stemRoutes } from "./music/routes.ts";
import { StemSeparator } from "./music/stems.ts";
import { mixerSetupRoutes } from "./music/mixer-setup.ts";
import { SerumLibrary } from "./music/serum/library.ts";
import { SerumPlayer, serumPlayerRoutes } from "./music/serum/player.ts";
import { standInSerum1Folder, standInSerumLibrary } from "./music/serum/stand-in.ts";
import { PhotoHelper } from "./photo/helper.ts";
import { PhotoLab } from "./photo/lab.ts";
import { photoLabRoutes, photoRoutes } from "./photo/routes.ts";
import { PhotoService } from "./photo/service.ts";
import { PhotoOnline } from "./photo/online.ts";
import { standInFetch, standInThumb } from "./photo/online-stand-in.ts";
import { ApiKeyStore } from "./transcription/settings.ts";
import { ProjectStore } from "./projects.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { exportRoutes } from "./routes/exports.ts";
import { logRequests, logRoutes, requestPath } from "./routes/log.ts";
import { renderFileRoutes } from "./routes/render-files.ts";
import { libraryRoutes } from "./routes/library.ts";
import { mediaRoutes } from "./routes/media.ts";
import { nowPlayingRoutes } from "./routes/now-playing.ts";
import { DownloadedModel } from "./models.ts";
import { VIBE_MODEL_SPEC } from "../shared/signals/vibe.ts";
import { projectRoutes } from "./routes/projects.ts";
import { suiteBackend } from "./suites/index.ts";
import { transcriptionRoutes } from "./routes/transcription.ts";
import { webRoutes } from "./routes/web.ts";
import { log } from "./log.ts";
import { revealInFinder } from "./process.ts";
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
  /** Song exports: how a file is shown in Finder (tests). */
  musicExports?: Partial<MusicExportOptions>;
  /**
   * Where new projects are saved until the user picks another folder (default: `config.projectsDir` for the
   * configured data folder, else the given data folder's `Documents/YTStudio`, so tests stay inside it).
   */
  projectsDir?: string;
  /** Put a project's package in the Trash (the desktop app's own; default: `moveToTrash`). */
  trash?: (dir: string) => Promise<void>;
  /** Show a project's package in Finder (default: `open -R`). */
  reveal?: (dir: string) => Promise<void>;
  /** Now Playing's music player (default: Spotify on a Mac, or what `EDITOR_NOW_PLAYING` says). */
  nowPlaying?: Player | null;
  /** Which of YTStudio's apps this is (`EDITOR_APP`, `shared/apps.ts`); null (the default) opens every suite. */
  app?: AppId | null;
  /** A data folder whose recents a new app's data folder starts with, its own suites' (`adoptRecents`). */
  recentsFrom?: string | null;
}

export interface EditorApp {
  app: Express;
  /** Stop background processing and kill running renders. */
  shutdown(): void;
  /** The server is listening at `url`: the music app's window shows it (nothing elsewhere). */
  listening(url: string): void;
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
  musicExports: musicExportOptions,
  projectsDir,
  trash,
  reveal,
  nowPlaying: player,
  app: appId = null,
  recentsFrom = null,
}: AppOptions): Promise<EditorApp> {
  const thisApp = appInfo(appId);
  // Asked now (and cached) so the first import doesn't wait for ffmpeg to start (half a second on Windows).
  void ffmpegVersion();
  const paths = new DataPaths(dataDir);
  await paths.init();
  const location = projectsDir ?? (path.resolve(dataDir) === config.dataDir ? config.projectsDir : path.join(dataDir, "Documents", "YTStudio"));
  if (recentsFrom) await adoptRecents(paths, new DataPaths(recentsFrom), thisApp.suites);
  await migrateData(paths, location);
  // The photo suite's helper process (the only code that parses image files), started on its first request.
  const photoHelper = new PhotoHelper(PHOTO_HELPER);
  // It reads what ffprobe can't of imported images (bit depth, ICC profile), for every suite's media.
  const mediaOptions = { probeImage: (file: string) => photoHelper.request<ImageProbe>("probe", { file }) };
  // Each project's media is in its package (loaded with it), served by id whatever its package is called.
  const library = new MediaLibrary(paths, undefined, (id) => projects.mediaDir(id), mediaOptions);
  // The engine writes what's changed in a song's plugins before its package moves.
  let saveStates: () => Promise<void> = async () => {};
  // The music app: its engine is the app, and the Trash and Finder (or Explorer) are its to use.
  if (ENGINE_CONNECT) {
    trash ??= (dir) => engine.askApp("host.trash", { path: dir }).then(() => {});
    reveal ??= (dir) => engine.askApp("host.reveal", { path: dir }).then(() => {});
  }
  const projects = new ProjectStore(paths, library, { location, trash, reveal, beforeMove: () => saveStates(), suites: thisApp.suites });
  await projects.load();
  const exports = new ExportManager(paths, library);
  const renders = new RenderFiles(library, projects);
  const web = new WebMediaLibrary(paths, library, ytdlpPath);
  await web.load();
  const libraryMedia = new MediaLibrary(paths, { dir: paths.libraryMedia, url: "/files/library" }, undefined, mediaOptions);
  const shared = new LibraryStore(paths, libraryMedia, library, (id) => projects.has(id));
  await shared.load();
  const transcription = await TranscriptionService.create(paths, library, transcriptionOptions);
  // The port the assistant's agents reach the MCP server on: the one requests arrive on.
  let port = config.port;
  const bridge = new Bridge();
  let audioIntelligence: AudioIntelligence;
  const assistant = new AssistantService(paths, bridge, {
    commands: { claude: claudeCommand, codex: codexCommand },
    port: () => port,
    suiteOf: (id) => projects.suiteOf(id),
    serverTool: async (suite, projectId, name, input) => {
      if (suite !== "music" || !(AUDIO_SERVER_TOOLS as readonly string[]).includes(name)) return null;
      return textResult(JSON.stringify(await audioIntelligence.tool(projectId, name, input)));
    },
  });
  await assistant.init();
  const samplePath = (projectId: string, mediaId: string) => {
    const asset = library.find(mediaId);
    return asset && asset.projectId === projectId && asset.hasAudio ? library.sourcePath(asset) : null;
  };
  // A take recorded is moved into the project's media (the music suite doesn't reach into the media library itself).
  const adoptTake = (projectId: string, file: string, name: string, origin: string) => library.add(file, `${name}.wav`, projectId, () => projects.has(projectId), origin);
  const engine = new AudioEngine(paths, {
    samplePath,
    adoptTake,
    projectDir: (id) => projects.dir(id),
    // The music app: the engine is the app and started the server, which goes when it does.
    ...(ENGINE_CONNECT ? { connect: ENGINE_CONNECT, onAppQuit: () => process.emit("SIGTERM", "SIGTERM") } : {}),
    ...engineOptions,
  });
  if (ENGINE_CONNECT) void engine.command("status", {}).catch(() => {});
  saveStates = () => engine.saveStates().catch(() => {});
  const musicExports = new MusicExports(paths, engine, { samplePath: engineOptions?.samplePath ?? samplePath, adopt: adoptTake, ...musicExportOptions });
  // Make visualizer: a song handed over to the video suite as a project of its own.
  const visualizers = new SongVisualizers(paths, engine, {
    samplePath: engineOptions?.samplePath ?? samplePath,
    handoff: (handoff, options) => projects.createFromHandoff("video", handoff, options),
  });

  // Extract stems and Convert to notes: models run on this computer, in a process of their own.
  const musicModelSet = musicModels(MODELS_DIR, MUSIC_MODELS === "stand-in");
  const ml = { worker: MUSIC_WORKER, models: musicModelSet, standIn: MUSIC_MODELS === "stand-in", samplePath: engineOptions?.samplePath ?? samplePath, tmpFile: (suffix: string) => paths.tmpFile(suffix) };
  const stems = new StemSeparator({
    ...ml,
    mediaName: (projectId, mediaId) => {
      const asset = library.find(mediaId);
      return asset && asset.projectId === projectId ? asset.name : null;
    },
    find: (projectId, origin) => library.list(projectId).find((a) => a.origin === origin),
    adopt: adoptTake,
  });
  const hearing = new NoteHearing(ml);

  audioIntelligence = new AudioIntelligence({ root: path.join(paths.root, "audio-intelligence"), engine,
    projectDir: id => projects.dir(id), samplePath: engineOptions?.samplePath ?? samplePath,
    isMusicProject: id => projects.suiteOf(id) === "music" });
  await audioIntelligence.init();

  const previews = new ProjectPreviews(paths, projects, {
    video: async (_id, doc, folder, signal, inputs) => {
      const project = doc as Project;
      if (!project.clips.length) return null;
      const rendered = await exports.preview(project, inputs.texts ?? {}, signal);
      const file = path.join(folder, "preview.mp4");
      try { await fs.copyFile(rendered, file); } finally { await fs.rm(rendered, { force: true }); }
      return file;
    },
    music: (id, doc, folder, signal) => renderSongPreview(paths, {
      samplePath, projectDir: (projectId) => projects.dir(projectId), ...engineOptions,
    }, id, doc as MusicProject, folder, signal),
    // A photo's cover is a still the tab renders (PUT /api/projects/:id/cover); it has nothing to play.
    photo: async () => null,
  }, inspectPreview);

  const browser = new SampleBrowser(paths);
  await browser.load();

  // The photo suite's F0 lab: the helper (made above, with the media) and the blob store.
  const photoLab = new PhotoLab(path.join(paths.root, "photo-lab"), photoHelper);
  await photoLab.init();
  const photo = new PhotoService(photoHelper, {
    projectDir: (id) => projects.dir(id),
    sourcePath: (projectId, mediaId) => {
      const asset = library.find(mediaId);
      return asset && asset.projectId === projectId && asset.kind === "image" ? library.sourcePath(asset) : null;
    },
    exportsFolder: path.join(paths.exports, "photo"),
    adoptImage: (projectId, file, name) => library.add(file, name, projectId, () => projects.has(projectId)),
  });
  const standIn = ONLINE_ASSETS === "stand-in";
  const photoOnline = new PhotoOnline(photoHelper, {
    tmpFile: (suffix) => paths.tmpFile(suffix),
    // A result placed again is the copy already in the project.
    adopt: async (projectId, file, name, origin) =>
      library.list(projectId).find((a) => a.origin === origin && a.kind === "image") ?? library.add(file, name, projectId, () => projects.has(projectId), origin),
    galleryDl: standIn ? null : GALLERY_DL,
    ...(standIn ? { fetch: standInFetch, thumb: standInThumb } : {}),
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(logRequests());

  app.get("/api/health", async (_req, res) => {
    const version = await ffmpegVersion();
    const body: HealthResponse = { ok: true, ffmpeg: { available: version !== null, version } };
    res.json(body);
  });

  app.get("/api/app", (_req, res) => {
    const body: AppResponse = { app: appId };
    res.json(body);
  });

  app.use((req, _res, next) => {
    port = req.socket.localPort ?? port;
    next();
  });

  app.use("/api/log", logRoutes(reveal ?? revealInFinder));
  app.use("/api/projects", projectRoutes(projects, previews, (id) => assistant.remove(id), (id) => assistant.hasMessages(id)));
  app.use("/api/media", mediaRoutes(library, projects));
  app.use("/api/web", webRoutes(web, projects));
  const vibeModel = new DownloadedModel(MODELS_DIR, VIBE_MODEL === "stand-in", VIBE_MODEL_SPEC);
  const lookRatings = new LookRatings(paths.lookRatingsFile);
  app.use("/api/now-playing", nowPlayingRoutes(new NowPlaying(player === undefined ? defaultPlayer(NOW_PLAYING) : player), vibeModel, lookRatings));
  app.use("/api/library", libraryRoutes(shared, web));
  app.use("/api/exports", exportRoutes(exports));
  app.use("/api/render-files", renderFileRoutes(renders));
  app.use("/api/transcription", transcriptionRoutes(transcription));
  app.use("/api/assistant", assistantRoutes(assistant, bridge));
  app.use("/api/engine", engineRoutes(engine));
  app.use("/api/music/audio", audioIntelligenceRoutes(audioIntelligence));
  app.use("/api/music/exports", musicExportRoutes(musicExports));
  app.use("/api/music/visualizer", (req, _res, next) => {
    // What it makes is a video: an app that doesn't open them couldn't show it.
    if (req.method === "POST" && !thisApp.suites.includes("video")) throw new HttpError(400, `Make visualizer makes a video, which ${thisApp.name} doesn't open.`);
    next();
  });
  app.use("/api/music/visualizer", musicVisualizerRoutes(visualizers));
  app.use("/api/music/models", musicModelRoutes(musicModelSet));
  app.use("/api/music/stems", stemRoutes(stems));
  app.use("/api/music/notes", noteRoutes(hearing));
  app.use("/api/photo/lab", photoLabRoutes(photoLab));
  app.use("/api/photo", photoRoutes(photo, photoModels(MODELS_DIR, PHOTO_MODELS === "stand-in"), photoOnline));
  const mixerKeys = new ApiKeyStore(path.join(paths.root, "music-jev-settings.json"));
  await mixerKeys.load();
  const serumStandIn = SERUM_LIBRARY === "stand-in";
  const serumLibrary = new SerumLibrary(
    serumStandIn ? standInSerumLibrary(path.join(paths.root, "serum-stand-in")) : SERUM_LIBRARY ? { serum2: SERUM_LIBRARY, serum1: null } : undefined,
    {
      file: paths.serumLibraryFile,
      // The stand-in's Serum 1 library "in iCloud Drive", for the e2e tests; never this computer's own.
      ...(serumStandIn && { suggestions: [{ path: await standInSerum1Folder(path.join(paths.root, "serum-stand-in-s1")), label: "Serum 1's presets in iCloud Drive" }] }),
    },
  );
  app.use("/api/music/serum", serumPlayerRoutes(new SerumPlayer({ library: serumLibrary, engine, hasProject: (id) => projects.has(id) })));
  app.use("/api/music/mixer-setup", mixerSetupRoutes({ engine, keys: mixerKeys, hasProject: (id) => projects.has(id), assets: (id) => library.list(id) }));
  app.use("/api/browser", browserRoutes(browser, engine, {
      hasProject: (id) => projects.has(id),
      find: (projectId, origin) => library.list(projectId).find((a) => a.origin === origin),
      importFile: (file, projectId, origin) => library.importFile(file, projectId, () => projects.has(projectId), origin),
      webAudio: (url) => web.audio(url),
      importWeb: (projectId, url, title) => web.import({ projectId, url, title, kind: "audio" }, (id) => projects.has(id)),
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
  // A project's media, wherever its package is: by the asset's id.
  const servers = new Map<string, ReturnType<typeof express.static>>();
  app.use("/files/media/:id", (req, res, next) => {
    const dir = library.filesDir(req.params.id as string);
    if (!dir) return next();
    let serve = servers.get(dir);
    if (!serve) {
      serve = express.static(dir, staticOptions);
      servers.set(dir, serve);
    }
    serve(req, res, next);
  });
  app.use("/files/library", express.static(paths.libraryMedia, staticOptions));
  app.use("/files/exports", express.static(paths.exports, staticOptions));
  app.use("/files", () => {
    throw new HttpError(404, "File not found");
  });

  if (clientDir) {
    app.use(express.static(clientDir));
    // Any other page is the app (`/p/<id>`): its index.html, read once. (Streamed with sendFile it was a 404 from
    // inside the desktop app's archive, so a reload on a project there showed nothing.)
    const index = await fs.readFile(path.join(clientDir, "index.html"), "utf8");
    app.get("/{*path}", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(index);
    });
  }

  const httpLog = log("http");
  const onError: ErrorRequestHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: number; statusCode?: number; expose?: boolean; message?: string };
    const status = err instanceof HttpError ? err.status : (e.status ?? e.statusCode ?? 500);
    // A 5xx the code chose (the engine isn't built) is news; one it didn't is a bug, with its stack.
    if (status >= 500) {
      if (err instanceof HttpError) httpLog.info(`${req.method} ${requestPath(req)} ${status}: ${err.message}`);
      else httpLog.error(`${req.method} ${requestPath(req)} failed`, err);
    }
    const message =
      err instanceof HttpError || e.expose ? (e.message ?? "Request failed") : "Internal server error";
    res.status(status).setHeader("Cache-Control", "no-store").json({ error: message });
  };
  app.use(onError);

  return {
    app,
    listening: (url) => {
      if (ENGINE_CONNECT) engine.askApp("page", { url }).catch((err: Error) => log("server").error(`couldn't show the page: ${err.message}`));
    },
    shutdown() {
      photoHelper.close();
      previews.shutdown();
      projects.shutdown();
      library.shutdown();
      libraryMedia.shutdown();
      exports.shutdown();
      renders.shutdown();
      web.shutdown();
      transcription.shutdown();
      assistant.shutdown();
      bridge.shutdown();
      audioIntelligence.shutdown();
      musicExports.shutdown();
      visualizers.shutdown();
      stems.shutdown();
      engine.shutdown();
      browser.close();
    },
  };
}
