import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createId } from "../shared/timeline.ts";
import type { MediaAsset } from "../shared/types.ts";
import { makeFilmstrip, makePoster, makeWaveform } from "./derivatives.ts";
import { ffmpegVersion, isAbortError } from "./ffmpeg.ts";
import { type ProbeResult, probeMedia } from "./probe.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError, isValidId, readJson, writeJson } from "./storage.ts";

/** Background (filmstrip + waveform) jobs running at once. */
const JOB_CONCURRENCY = 2;

const MEDIA_EXTENSIONS = new Set([
  "mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "mts", "m2ts", "3gp",
  "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "aif", "aiff", "caf", "wma",
]);

/** A safe extension for the stored source file (keeps browsers' MIME sniffing happy). */
function sourceExtension(name: string, formatName: string): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (MEDIA_EXTENSIONS.has(ext)) return ext;
  const formats = formatName.split(",");
  if (formats.includes("mp4")) return "mp4";
  if (formats.includes("webm")) return "webm";
  return formats.find((f) => MEDIA_EXTENSIONS.has(f)) ?? "bin";
}

function displayName(raw: string): string {
  const name = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").trim();
  return name.slice(0, 200) || "Untitled";
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The media library: assets on disk under `data/media/<id>/` plus background processing. */
export class MediaLibrary {
  private assets = new Map<string, MediaAsset>();
  private jobs = new Map<string, AbortController>();
  private limit = createLimiter(JOB_CONCURRENCY);

  constructor(private paths: DataPaths) {}

  /** Load every asset; finish processing interrupted by a restart. */
  async load(): Promise<void> {
    for (const entry of await fs.readdir(this.paths.media, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue;
      const asset = await readJson<MediaAsset>(this.metaFile(entry.name));
      if (!asset || asset.id !== entry.name) {
        // Ingest died before the asset was committed.
        await fs.rm(this.paths.mediaDir(entry.name), { recursive: true, force: true });
        continue;
      }
      this.assets.set(asset.id, asset);
      if (asset.status === "processing") this.enqueue(asset.id);
    }
  }

  list(): MediaAsset[] {
    return [...this.assets.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): MediaAsset {
    const asset = isValidId(id) ? this.assets.get(id) : undefined;
    if (!asset) throw new HttpError(404, "Media not found");
    return asset;
  }

  byId(): Record<string, MediaAsset> {
    return Object.fromEntries(this.assets);
  }

  /** Absolute path of an asset's original file. */
  sourcePath(asset: MediaAsset): string {
    return path.join(this.paths.mediaDir(asset.id), path.basename(asset.src));
  }

  /** Stream an upload to disk, probe it and add it to the library. */
  async ingest(body: Readable, rawName: string): Promise<MediaAsset> {
    const tmp = this.paths.tmpFile(".upload");
    try {
      // Always consume the body first: replying mid-upload makes browsers report a network error.
      try {
        await pipeline(body, createWriteStream(tmp));
      } catch {
        throw new HttpError(400, "The upload was interrupted.");
      }
      if (!(await ffmpegVersion())) {
        throw new HttpError(503, "ffmpeg isn't installed, so media can't be imported.");
      }
      const { size } = await fs.stat(tmp);
      if (size === 0) throw new HttpError(400, "The file is empty.");
      const probe = await probeMedia(tmp);
      return await this.commit(tmp, displayName(rawName), size, probe);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  private async commit(
    tmp: string,
    name: string,
    size: number,
    probe: ProbeResult,
  ): Promise<MediaAsset> {
    const id = createId("media");
    const dir = this.paths.mediaDir(id);
    const sourceName = `source.${sourceExtension(name, probe.formatName)}`;
    const url = (file: string) => `/files/media/${id}/${file}`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.rename(tmp, path.join(dir, sourceName));

      let poster: string | null = null;
      if (probe.hasVideo) {
        try {
          await makePoster(path.join(dir, sourceName), path.join(dir, "poster.jpg"), probe.duration);
          poster = url("poster.jpg");
        } catch (err) {
          console.warn(`[media] poster failed for ${name}: ${errorMessage(err)}`);
        }
      }

      const asset: MediaAsset = {
        id,
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
        status: "processing",
        src: url(sourceName),
        poster,
        filmstrip: null,
        waveform: null,
      };
      await writeJson(this.metaFile(id), asset);
      this.assets.set(id, asset);
      this.enqueue(id);
      return asset;
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    this.assets.delete(id);
    this.jobs.get(id)?.abort();
    await fs.rm(this.paths.mediaDir(id), { recursive: true, force: true, maxRetries: 5 });
  }

  /** Stop all background work (server shutdown). */
  shutdown(): void {
    for (const controller of this.jobs.values()) controller.abort();
  }

  private metaFile(id: string) {
    return path.join(this.paths.mediaDir(id), "meta.json");
  }

  private enqueue(id: string): void {
    const controller = new AbortController();
    this.jobs.set(id, controller);
    this.limit(() => this.process(id, controller.signal))
      .catch((err) => {
        if (!isAbortError(err)) console.error(`[media] processing ${id} failed:`, err);
      })
      .finally(() => {
        if (this.jobs.get(id) === controller) this.jobs.delete(id);
      });
  }

  /** Generate the filmstrip and waveform, then mark the asset ready (or errored). */
  private async process(id: string, signal: AbortSignal): Promise<void> {
    const asset = this.assets.get(id);
    if (!asset || signal.aborted) return;
    const dir = this.paths.mediaDir(id);
    const src = this.sourcePath(asset);
    const patch: Partial<MediaAsset> = {};
    const problems: string[] = [];

    if (asset.hasVideo && asset.width && asset.height) {
      try {
        const strip = await makeFilmstrip(
          src,
          path.join(dir, "frames"),
          { duration: asset.duration, width: asset.width, height: asset.height },
          signal,
        );
        patch.filmstrip = { ...strip, urlPattern: `/files/media/${id}/frames/{i}.jpg` };
      } catch (err) {
        if (signal.aborted) throw err;
        problems.push(`thumbnails: ${errorMessage(err)}`);
      }
    }
    if (asset.hasAudio) {
      try {
        await makeWaveform(src, path.join(dir, "waveform.json"), signal);
        patch.waveform = `/files/media/${id}/waveform.json`;
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
  }
}
