import { constants as fsConstants, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createId } from "../shared/ids.ts";
import { normalizeImageInfo } from "../shared/media.ts";
import { SIGNALS_VERSION, signalsFileName } from "../shared/signals/format.ts";
import type { ImageInfo, MediaAsset, MediaSignals, ReversedMedia } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { makeFilmstrip, makePoster, makeReversed, makeStillPoster, makeWaveform } from "./derivatives.ts";
import { ffmpegVersion } from "./ffmpeg.ts";
import { isAbortError } from "./process.ts";
import { type ProbeResult, probeMedia } from "./probe.ts";
import { createLimiter } from "./queue.ts";
import { makeSignals } from "./signals.ts";
import { type DataPaths, HttpError, isValidId, readJson, writeJson } from "./storage.ts";
import { log } from "./log.ts";

const logger = log("media");

/** Background (filmstrip + waveform) jobs running at once. */
const JOB_CONCURRENCY = 2;
/** Reversed copies made at once (each is a full re-encode). */
const REVERSE_CONCURRENCY = 1;
/** Files' signals analysed at once (each keeps a core busy for a few seconds a song). */
const SIGNAL_CONCURRENCY = 1;

const MEDIA_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "aif", "aiff", "caf", "wma",
  "png", "jpg", "jpeg", "webp", "gif", "bmp",
]);

/** A safe extension for the stored source file (keeps browsers' MIME sniffing happy). */
function sourceExtension(name: string, formatName: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return ext;
  const formats = formatName.split(",");
  if (formats.includes("mp4")) return "mp4";
  if (formats.includes("jpeg_pipe")) return "jpg";
  const pipe = formats.find((f) => f.endsWith("_pipe"))?.replace(/_pipe$/, "");
  if (pipe && MEDIA_EXTENSIONS.has(pipe)) return pipe;
  if (formats.includes("webm")) return "webm";
  return formats.find((f) => MEDIA_EXTENSIONS.has(f)) ?? "bin";
}

function displayName(raw: string): string {
  const name = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").trim();
  return name.slice(0, 200) || "Untitled";
}


/** Where a `MediaLibrary` keeps its assets (`<dir>/<id>/`) and the URL they're served at. */
export interface MediaRoot {
  dir: string;
  url: string;
}

/** Where a project keeps its media (`<project>.vaudio/media`), or null if there's no such project. */
export type ProjectMediaDirs = (projectId: string) => string | null;

/** What an image prober says of a file: its size upright (after its EXIF orientation) and its samples. */
export interface ImageProbe extends ImageInfo {
  width: number;
  height: number;
}

export interface MediaLibraryOptions {
  /**
   * Reads what ffprobe can't of an image file (bit depth, alpha, ICC profile): the photo suite's helper,
   * given by `app.ts`. Without it, or when it fails, images import with ffprobe's reading alone.
   */
  probeImage?: (file: string) => Promise<ImageProbe>;
}

/** Each image probe failure is logged once (by message), so a missing helper doesn't log every import; this many at most. */
const MAX_PROBE_WARNINGS = 50;

/**
 * A saved asset (a meta.json, which anyone may have edited) with its optional fields checked: an invalid
 * `image` is dropped, and the asset still loads with what ffprobe said of it.
 */
export function savedAsset(asset: MediaAsset): MediaAsset {
  if (asset.image === undefined) return asset;
  const image = normalizeImageInfo(asset.image);
  if (image) return { ...asset, image };
  const next = { ...asset };
  delete next.image;
  return next;
}

/** Whether an asset's signals are made, by this version of the analysis. */
const hasSignals = (asset: MediaAsset) => asset.signals?.status === "ready" && asset.signals.version === SIGNALS_VERSION;

const isSize = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/**
 * Media files on disk plus background processing: every project's media, each in its own package
 * (`<project>.vaudio/media/<id>/`, through `projectDirs`; loaded with `loadProject`), and separately the
 * shared Library's (`data/library/media/<id>/`, with `projectId: null`). Either way an asset's files are
 * served at `<url>/<id>/...`, by id alone, so moving a project never changes them.
 */
export class MediaLibrary {
  private assets = new Map<string, MediaAsset>();
  private jobs = new Map<string, AbortController>();
  private limit = createLimiter(JOB_CONCURRENCY);
  /** Reversed copies being made, by asset id. */
  private reversing = new Map<string, { done: Promise<void>; controller: AbortController }>();
  private reverseLimit = createLimiter(REVERSE_CONCURRENCY);
  /** Signals being analysed, by asset id. */
  private signalling = new Map<string, { done: Promise<void>; controller: AbortController }>();
  private signalLimit = createLimiter(SIGNAL_CONCURRENCY);
  /** Files being added to each project right now (by project id): its package mustn't move meanwhile. */
  private adding = new Map<string, number>();
  private root: MediaRoot;
  private probeWarnings = new Set<string>();

  constructor(
    private paths: DataPaths,
    root?: MediaRoot,
    private projectDirs?: ProjectMediaDirs,
    private options: MediaLibraryOptions = {},
  ) {
    this.root = root ?? { dir: paths.media, url: "/files/media" };
  }

  /** Load every asset under the root (the Library's; call `resume()` then). */
  async load(): Promise<void> {
    for (const asset of await this.read(this.root.dir)) this.assets.set(asset.id, asset);
  }

  /**
   * Load a project's media from its package (`dir`), as `projectId`'s (an asset saved under another id, a
   * copy made in Finder, is told it's this one's), and finish what a restart interrupted.
   */
  async loadProject(projectId: string, dir: string): Promise<MediaAsset[]> {
    const loaded: MediaAsset[] = [];
    for (const saved of await this.read(dir)) {
      const asset = saved.projectId === projectId ? saved : { ...saved, projectId };
      if (asset !== saved) await writeJson(path.join(dir, asset.id, "meta.json"), asset);
      this.assets.set(asset.id, asset);
      loaded.push(asset);
    }
    for (const asset of loaded) this.resumeAsset(asset);
    return loaded;
  }

  /** Assets saved in `dir` (`<id>/meta.json`); what an ingest that died left is removed. */
  private async read(dir: string): Promise<MediaAsset[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const assets: MediaAsset[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue;
      const asset = await readJson<MediaAsset>(path.join(dir, entry.name, "meta.json"));
      if (!asset || asset.id !== entry.name) {
        // Ingest died before the asset was committed.
        await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
        continue;
      }
      assets.push(savedAsset(asset));
    }
    return assets;
  }

  /** Finish processing interrupted by a restart. */
  resume(): void {
    for (const asset of this.assets.values()) this.resumeAsset(asset);
  }

  private resumeAsset(asset: MediaAsset): void {
    if (asset.status === "processing" && !this.jobs.has(asset.id)) this.enqueue(asset.id);
    if (asset.reversed?.status === "processing") void this.startReversing(asset.id);
    if (asset.signals?.status === "processing") void this.startSignals(asset.id);
  }

  /** Every asset (or one project's), newest first. */
  list(projectId?: string | null): MediaAsset[] {
    return [...this.assets.values()]
      .filter((a) => projectId === undefined || a.projectId === projectId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  find(id: string): MediaAsset | undefined {
    return isValidId(id) ? this.assets.get(id) : undefined;
  }

  get(id: string): MediaAsset {
    const asset = this.find(id);
    if (!asset) throw new HttpError(404, "Media not found");
    return asset;
  }

  /** Every asset (or one project's) keyed by id. */
  byId(projectId?: string | null): Record<string, MediaAsset> {
    return Object.fromEntries(this.list(projectId).map((a) => [a.id, a]));
  }

  /** Absolute path of an asset's original file. */
  sourcePath(asset: MediaAsset): string {
    return path.join(this.dir(asset.id), path.basename(asset.src));
  }

  /**
   * Stream an upload to disk, probe it and add it to `projectId`'s media (null: the Library's).
   * `projectExists` is checked once the body is consumed and again at commit,
   * so an upload racing a project deletion never leaves an orphaned asset.
   */
  async ingest(
    body: Readable,
    rawName: string,
    projectId: string | null,
    projectExists: () => boolean,
  ): Promise<MediaAsset> {
    const tmp = this.paths.tmpFile(".upload");
    try {
      // Always consume the body first: replying mid-upload makes browsers report a network error.
      try {
        await pipeline(body, createWriteStream(tmp));
      } catch {
        throw new HttpError(400, "The upload was interrupted.");
      }
      return await this.add(tmp, rawName, projectId, projectExists);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /**
   * Import a file from anywhere on this computer (the assistant's `import_media`, the music Browser) into
   * `projectId`'s media. The file is copied; the original stays where it is. `origin` is kept on the
   * asset, to find the copy again rather than copy twice.
   */
  async importFile(rawPath: unknown, projectId: string, projectExists: () => boolean, origin?: string): Promise<MediaAsset> {
    if (typeof rawPath !== "string" || !rawPath.trim()) throw new HttpError(400, "Expected { projectId, path }.");
    const expanded = rawPath.trim().replace(/^~(?=$|\/)/, os.homedir());
    if (!path.isAbsolute(expanded)) throw new HttpError(400, "The path must be absolute.");
    const stat = await fs.stat(expanded).catch(() => null);
    if (!stat?.isFile()) throw new HttpError(404, `There's no file at ${expanded}.`);
    const tmp = this.paths.tmpFile(path.extname(expanded));
    try {
      await fs.copyFile(expanded, tmp, fsConstants.COPYFILE_FICLONE);
      return await this.add(tmp, path.basename(expanded), projectId, projectExists, origin);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /**
   * Probe a file on disk and add it to `projectId`'s media. The file is moved into
   * the library on success; on failure it's left for the caller to clean up.
   */
  async add(
    file: string,
    rawName: string,
    projectId: string | null,
    projectExists: () => boolean,
    origin?: string,
  ): Promise<MediaAsset> {
    if (!projectExists()) throw new HttpError(404, "Project not found");
    if (!(await ffmpegVersion())) {
      throw new HttpError(503, "ffmpeg isn't installed, so media can't be imported.");
    }
    const { size } = await fs.stat(file);
    if (size === 0) throw new HttpError(400, "The file is empty.");
    const name = displayName(rawName);
    let probe = await probeMedia(file);
    let image: ImageInfo | undefined;
    const read = probe.kind === "image" ? await this.probeImage(file, name) : null;
    if (read) {
      const { width, height, ...info } = read;
      probe = { ...probe, width, height };
      image = info;
    }
    return await this.adds(projectId, () => this.commit(file, { name, projectId, size, probe, image, origin }, projectExists));
  }

  /** The image prober's reading of `file`, or null when there's no prober or it failed (ffprobe's reading stands). */
  private async probeImage(file: string, name: string): Promise<ImageProbe | null> {
    if (!this.options.probeImage) return null;
    try {
      const raw = await this.options.probeImage(file);
      const info = normalizeImageInfo(raw);
      if (!info || !isSize(raw.width) || !isSize(raw.height)) throw new Error("its answer isn't an image's description");
      return { ...info, width: raw.width, height: raw.height };
    } catch (err) {
      const message = errorMessage(err);
      if (!this.probeWarnings.has(message) && this.probeWarnings.size < MAX_PROBE_WARNINGS) {
        this.probeWarnings.add(message);
        logger.warn(`couldn't probe ${name} as an image, imported with ffprobe's reading alone: ${message}`);
      }
      return null;
    }
  }

  /** Run an addition to a project, counted while it lasts (`busy`). */
  private async adds<T>(projectId: string | null, run: () => Promise<T>): Promise<T> {
    if (projectId === null) return run();
    this.adding.set(projectId, (this.adding.get(projectId) ?? 0) + 1);
    try {
      return await run();
    } finally {
      const left = (this.adding.get(projectId) ?? 1) - 1;
      if (left > 0) this.adding.set(projectId, left);
      else this.adding.delete(projectId);
    }
  }

  /**
   * Whether anything is writing into a project's media now (a file being added, a filmstrip or reversed
   * copy being made): its package can't be renamed or moved until it's done.
   */
  busy(projectId: string): boolean {
    if (this.adding.has(projectId)) return true;
    return this.list(projectId).some((a) => this.jobs.has(a.id) || this.reversing.has(a.id) || this.signalling.has(a.id));
  }

  private async commit(
    tmp: string,
    {
      name,
      projectId,
      size,
      probe,
      image,
      origin,
    }: { name: string; projectId: string | null; size: number; probe: ProbeResult; image?: ImageInfo; origin?: string },
    projectExists: () => boolean,
  ): Promise<MediaAsset> {
    const id = createId("media");
    const dir = this.dirFor(projectId, id);
    const sourceName = `source.${sourceExtension(name, probe.formatName)}`;
    const url = (file: string) => `${this.root.url}/${id}/${file}`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.rename(tmp, path.join(dir, sourceName));

      const still = probe.kind === "image";
      let poster: string | null = null;
      if (probe.hasVideo) {
        try {
          // PNG for stills, so transparent images stay transparent.
          const posterName = still ? "poster.png" : "poster.jpg";
          const [source, target] = [path.join(dir, sourceName), path.join(dir, posterName)];
          await (still ? makeStillPoster(source, target) : makePoster(source, target, probe.duration));
          poster = url(posterName);
        } catch (err) {
          // An image ffmpeg can't decode couldn't be exported either.
          if (still) throw new HttpError(415, "This image couldn't be read. Try saving it as PNG or JPEG.");
          logger.warn(`poster failed for ${name}: ${errorMessage(err)}`);
        }
      }

      const asset: MediaAsset = {
        id,
        projectId,
        name,
        kind: probe.kind,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasVideo: probe.hasVideo,
        hasAudio: probe.hasAudio,
        size,
        createdAt: Date.now(),
        // A still has nothing more to generate: its poster is its thumbnail.
        status: still ? "ready" : "processing",
        src: url(sourceName),
        poster,
        filmstrip: null,
        waveform: null,
        ...(origin ? { origin } : {}),
        ...(image ? { image } : {}),
      };
      await writeJson(path.join(dir, "meta.json"), asset);
      // No await between this check and `set`: a concurrent project deletion either
      // happened already (we clean up) or will see and remove this asset.
      if (!projectExists()) throw new HttpError(404, "Project not found");
      this.assets.set(id, asset);
      if (!still) this.enqueue(id);
      return asset;
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Copy an asset of another `MediaLibrary` (the Library's into a project, or the
   * other way round), or of this one (duplicating a project), with its poster,
   * filmstrip and waveform, so nothing is generated again. Files are cloned where
   * the filesystem can (APFS, Btrfs...). A `duplicate` is the same media in another
   * project: it keeps the original's `origin` and date.
   */
  async copyFrom(
    source: MediaLibrary,
    asset: MediaAsset,
    options: { projectId: string | null; name?: string; exists?: () => boolean; duplicate?: boolean },
  ): Promise<MediaAsset> {
    return this.adds(options.projectId, () => this.copyAsset(source, asset, options));
  }

  private async copyAsset(
    source: MediaLibrary,
    asset: MediaAsset,
    {
      projectId,
      name,
      exists = () => true,
      duplicate = false,
    }: { projectId: string | null; name?: string; exists?: () => boolean; duplicate?: boolean },
  ): Promise<MediaAsset> {
    const id = createId("media");
    const dir = this.dirFor(projectId, id);
    const rebase = (url: string) => url.replace(`${source.root.url}/${asset.id}/`, `${this.root.url}/${id}/`);
    try {
      await fs.cp(source.dir(asset.id), dir, {
        recursive: true,
        mode: fsConstants.COPYFILE_FICLONE,
        // Not the metadata, nor a file still being written (signals being analysed write `*.tmp`, then rename it).
        filter: (file) => path.basename(file) !== "meta.json" && !file.endsWith(".tmp"),
      });
      // Still being generated: start over here rather than copy half a filmstrip.
      const processing = asset.status === "processing";
      const copy: MediaAsset = {
        ...asset,
        id,
        projectId,
        name: name ? displayName(name) : asset.name,
        origin: duplicate ? asset.origin : asset.id,
        createdAt: duplicate ? asset.createdAt : Date.now(),
        src: rebase(asset.src),
        poster: asset.poster && rebase(asset.poster),
        filmstrip: !processing && asset.filmstrip ? { ...asset.filmstrip, urlPattern: rebase(asset.filmstrip.urlPattern) } : null,
        waveform: !processing && asset.waveform ? rebase(asset.waveform) : null,
      };
      // A reversed copy still being made (or that failed) is made again when it's needed.
      if (asset.reversed?.status === "ready") copy.reversed = { status: "ready", src: rebase(asset.reversed.src) };
      else delete copy.reversed;
      // Signals too (analysed again when they're needed, or when the copy is processed).
      if (asset.signals?.status === "ready") copy.signals = { ...asset.signals, src: rebase(asset.signals.src) };
      else delete copy.signals;
      await writeJson(path.join(dir, "meta.json"), copy);
      if (!exists()) throw new HttpError(404, "Project not found");
      this.assets.set(id, copy);
      if (processing) this.enqueue(id);
      return copy;
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      if (err instanceof HttpError) throw err;
      // The source was deleted meanwhile.
      if (!source.find(asset.id)) throw new HttpError(404, "Media not found");
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const dir = this.dir(this.get(id).id);
    this.forget(id);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }

  /** Delete all of a project's media, cancelling its background jobs. */
  async removeProject(projectId: string): Promise<void> {
    // `remove` forgets each asset synchronously, so they're all gone before the first await.
    await Promise.all(this.list(projectId).map((a) => this.remove(a.id)));
  }

  /** Stop knowing a project's media (its package is closed, or goes to the Trash whole): its files stay. */
  forgetProject(projectId: string): void {
    for (const asset of this.list(projectId)) this.forget(asset.id);
  }

  private forget(id: string): void {
    this.assets.delete(id);
    this.jobs.get(id)?.abort();
    this.reversing.get(id)?.controller.abort();
    this.signalling.get(id)?.controller.abort();
  }

  /**
   * An asset saved under `id` instead (a copy of a project opened beside it gets media ids of its own): its
   * URLs follow, so the files it names are its own folder's once that's renamed `id`.
   */
  renamed(asset: MediaAsset, id: string, projectId: string): MediaAsset {
    const from = `${this.root.url}/${asset.id}/`;
    const to = `${this.root.url}/${id}/`;
    const rebase = (url: string) => (url.startsWith(from) ? to + url.slice(from.length) : url);
    return {
      ...asset,
      id,
      projectId,
      src: rebase(asset.src),
      poster: asset.poster && rebase(asset.poster),
      filmstrip: asset.filmstrip && { ...asset.filmstrip, urlPattern: rebase(asset.filmstrip.urlPattern) },
      waveform: asset.waveform && rebase(asset.waveform),
      ...(asset.reversed?.status === "ready" && { reversed: { ...asset.reversed, src: rebase(asset.reversed.src) } }),
      ...(asset.signals?.status === "ready" && { signals: { ...asset.signals, src: rebase(asset.signals.src) } }),
    };
  }

  /** The folder an asset's files are served from (`<url>/<id>/...`), if it's one of these. */
  filesDir(id: string): string | null {
    return this.find(id) ? this.dir(id) : null;
  }

  /**
   * Copy all of `fromProject`'s media into `toProject` under new ids (files are
   * cloned where the filesystem supports it). Returns old id → new id. On failure
   * the copies made so far are left for the caller to remove with `removeProject`.
   */
  async copyProject(fromProject: string, toProject: string): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const asset of this.list(fromProject)) {
      ids.set(asset.id, (await this.copyFrom(this, asset, { projectId: toProject, duplicate: true })).id);
    }
    return ids;
  }

  /** Stop all background work (server shutdown). */
  shutdown(): void {
    for (const controller of this.jobs.values()) controller.abort();
    for (const { controller } of this.reversing.values()) controller.abort();
    for (const { controller } of this.signalling.values()) controller.abort();
  }

  /**
   * Start making an asset's reversed copy (for clips played backwards), unless
   * it's made or being made already. A failed one is tried again.
   */
  async reverse(id: string): Promise<MediaAsset> {
    const asset = this.get(id);
    if (asset.kind === "image") throw new HttpError(400, "A still image can't play backwards.");
    if (asset.reversed?.status === "ready" || this.reversing.has(id)) return asset;
    await this.setReversed(id, { status: "processing" });
    void this.startReversing(id);
    return this.get(id);
  }

  /** The path of an asset's reversed copy, made first if need be (the export waits for it). */
  async reversedPath(id: string): Promise<string> {
    if (this.get(id).reversed?.status !== "ready") {
      await this.reverse(id);
      await this.reversing.get(id)?.done;
    }
    const reversed = this.get(id).reversed;
    if (reversed?.status !== "ready") {
      throw new Error(`Couldn't play ${this.get(id).name} backwards${reversed?.status === "error" ? `: ${reversed.error}` : ""}`);
    }
    return path.join(this.dir(id), path.basename(reversed.src));
  }

  /**
   * Start analysing an asset's signals (what its sound does over time), unless they're made (by this
   * version of the analysis) or being made. Failed ones are tried again.
   */
  async analyseSignals(id: string): Promise<MediaAsset> {
    const asset = this.get(id);
    if (!asset.hasAudio) throw new HttpError(400, "That file has no sound.");
    if (hasSignals(asset) || this.signalling.has(id)) return asset;
    await this.setSignals(id, { status: "processing" });
    void this.startSignals(id);
    return this.get(id);
  }

  /** The path of an asset's signals, analysed first if need be (the export waits for them). */
  async signalsPath(id: string): Promise<string> {
    if (!hasSignals(this.get(id))) {
      await this.analyseSignals(id);
      await this.signalling.get(id)?.done;
    }
    const signals = this.get(id).signals;
    if (signals?.status !== "ready") {
      throw new Error(`Couldn't analyse the sound of ${this.get(id).name}${signals?.status === "error" ? `: ${signals.error}` : ""}`);
    }
    return path.join(this.dir(id), path.basename(signals.src));
  }

  /** Cached transcripts of an asset (see `transcription/service.ts`), removed with it. */
  transcriptsDir(id: string) {
    return path.join(this.dir(id), "transcripts");
  }

  /** An asset's directory (throws 400 for an invalid id). */
  private dir(id: string) {
    return this.dirFor(this.assets.get(id)?.projectId ?? null, id);
  }

  /** Where an asset of `projectId` (null: the root's) keeps its files. */
  private dirFor(projectId: string | null, id: string) {
    if (!isValidId(id)) throw new HttpError(400, "Invalid media id");
    if (projectId === null || !this.projectDirs) return path.join(this.root.dir, id);
    const dir = this.projectDirs(projectId);
    if (!dir) throw new HttpError(404, "Project not found");
    return path.join(dir, id);
  }

  private metaFile(id: string) {
    return path.join(this.dir(id), "meta.json");
  }

  /** Save an asset's reversed-copy state (unless it's been deleted meanwhile). */
  private async setReversed(id: string, reversed: ReversedMedia): Promise<void> {
    const current = this.assets.get(id);
    if (!current) return;
    const next: MediaAsset = { ...current, reversed };
    await writeJson(this.metaFile(id), next);
    if (this.assets.has(id)) this.assets.set(id, { ...this.assets.get(id)!, reversed });
  }

  /** Save an asset's signals' state (unless it's been deleted meanwhile). */
  private async setSignals(id: string, signals: MediaSignals): Promise<void> {
    const current = this.assets.get(id);
    if (!current) return;
    await writeJson(this.metaFile(id), { ...current, signals });
    if (this.assets.has(id)) this.assets.set(id, { ...this.assets.get(id)!, signals });
  }

  /** Analyse an asset's signals in the background (one job per asset). */
  private startSignals(id: string): Promise<void> {
    const running = this.signalling.get(id);
    if (running) return running.done;
    const controller = new AbortController();
    const { signal } = controller;
    const done = this.signalLimit(async () => {
      const asset = this.assets.get(id);
      if (!asset || signal.aborted) return;
      const before = asset.signals?.status === "ready" ? path.basename(asset.signals.src) : null;
      const name = signalsFileName();
      let signals: MediaSignals;
      try {
        await makeSignals(this.sourcePath(asset), path.join(this.dir(id), name), asset.duration, signal);
        signals = { status: "ready", src: `${this.root.url}/${id}/${name}`, version: SIGNALS_VERSION };
      } catch (err) {
        if (signal.aborted) return;
        logger.warn(`analysing the sound of ${asset.name} failed: ${errorMessage(err)}`);
        signals = { status: "error", error: errorMessage(err) };
      }
      if (signal.aborted) return;
      await this.setSignals(id, signals);
      // An older analysis's file isn't needed any more.
      if (before && before !== name) await fs.rm(path.join(this.dir(id), before), { force: true });
    })
      .catch((err) => {
        if (!isAbortError(err)) logger.error(`analysing ${id} failed`, err);
      })
      .finally(() => {
        if (this.signalling.get(id)?.controller === controller) this.signalling.delete(id);
      });
    this.signalling.set(id, { done, controller });
    return done;
  }

  /** Make an asset's reversed copy in the background (one job per asset). */
  private startReversing(id: string): Promise<void> {
    const running = this.reversing.get(id);
    if (running) return running.done;
    const controller = new AbortController();
    const { signal } = controller;
    const done = this.reverseLimit(async () => {
      const asset = this.assets.get(id);
      if (!asset || signal.aborted) return;
      const name = asset.hasVideo ? "reversed.mp4" : "reversed.m4a";
      let reversed: ReversedMedia;
      try {
        await makeReversed(this.sourcePath(asset), path.join(this.dir(id), name), asset, path.join(this.dir(id), "reversing"), signal);
        reversed = { status: "ready", src: `${this.root.url}/${id}/${name}` };
      } catch (err) {
        if (signal.aborted) return;
        logger.warn(`reversing ${asset.name} failed: ${errorMessage(err)}`);
        reversed = { status: "error", error: errorMessage(err) };
      }
      if (!signal.aborted) await this.setReversed(id, reversed);
    })
      .catch((err) => {
        if (!isAbortError(err)) logger.error(`reversing ${id} failed`, err);
      })
      .finally(() => {
        if (this.reversing.get(id)?.controller === controller) this.reversing.delete(id);
      });
    this.reversing.set(id, { done, controller });
    return done;
  }

  private enqueue(id: string): void {
    const controller = new AbortController();
    this.jobs.set(id, controller);
    this.limit(() => this.process(id, controller.signal))
      .catch((err) => {
        if (!isAbortError(err)) logger.error(`processing ${id} failed`, err);
      })
      .finally(() => {
        if (this.jobs.get(id) === controller) this.jobs.delete(id);
      });
  }

  /** Generate the filmstrip and waveform, then mark the asset ready (or errored). */
  private async process(id: string, signal: AbortSignal): Promise<void> {
    const asset = this.assets.get(id);
    if (!asset || signal.aborted) return;
    const dir = this.dir(id);
    const src = this.sourcePath(asset);
    const patch: Partial<MediaAsset> = {};
    const problems: string[] = [];

    if (asset.kind === "video" && asset.width && asset.height) {
      try {
        const strip = await makeFilmstrip(
          src,
          path.join(dir, "frames"),
          { duration: asset.duration, width: asset.width, height: asset.height },
          signal,
        );
        patch.filmstrip = { ...strip, urlPattern: `${this.root.url}/${id}/frames/{i}.jpg` };
      } catch (err) {
        if (signal.aborted) throw err;
        problems.push(`thumbnails: ${errorMessage(err)}`);
      }
    }
    if (asset.hasAudio) {
      try {
        await makeWaveform(src, path.join(dir, "waveform.json"), signal);
        patch.waveform = `${this.root.url}/${id}/waveform.json`;
      } catch (err) {
        if (signal.aborted) throw err;
        problems.push(`waveform: ${errorMessage(err)}`);
      }
    }

    const current = this.assets.get(id);
    if (!current || signal.aborted) return;
    const next: MediaAsset = { ...current, ...patch, status: problems.length ? "error" : "ready" };
    if (problems.length) next.error = `Couldn't generate ${problems.join("; ")}`;
    else delete next.error;
    await writeJson(this.metaFile(id), next);
    // The asset may have been deleted while the metadata was being written.
    if (signal.aborted || !this.assets.has(id)) return;
    this.assets.set(id, next);
    // Then what its sound does over time, for pictures that react to it.
    if (next.hasAudio && !hasSignals(next) && !this.signalling.has(id)) await this.analyseSignals(id).catch(() => {});
  }
}
