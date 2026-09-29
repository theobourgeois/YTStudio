import fs from "node:fs/promises";
import path from "node:path";
import type { ImportMusicRequest, MediaAsset, MusicTrack } from "../shared/types.ts";
import { YTDLP } from "./config.ts";
import { isAbortError, run } from "./ffmpeg.ts";
import type { MediaLibrary } from "./media.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError } from "./storage.ts";

const SEARCH_RESULTS = 15;
const SEARCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;
const DOWNLOAD_CONCURRENCY = 2;
/** Longer uploads are mixes and "10 hour" loops, not songs. */
const MAX_TRACK_SECONDS = 20 * 60;
/** Every YouTube video id is 11 characters of base64url. */
const TRACK_ID_RE = /^[\w-]{11}$/;

/** Ignore the user's yt-dlp config so the output is always what we parse. */
const BASE_ARGS = ["--ignore-config", "--no-warnings"];

export const isTrackId = (id: unknown): id is string => typeof id === "string" && TRACK_ID_RE.test(id);

interface SearchEntry {
  id?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  live_status?: unknown;
  channel_is_verified?: unknown;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** yt-dlp's `--flat-playlist -J` search output -> tracks (skipping livestreams and long mixes). */
export function parseSearchResults(json: string): MusicTrack[] {
  const { entries } = JSON.parse(json) as { entries?: SearchEntry[] };
  const tracks = new Map<string, MusicTrack>();
  for (const e of entries ?? []) {
    if (!isTrackId(e.id) || tracks.has(e.id)) continue;
    if (e.live_status === "is_live" || e.live_status === "is_upcoming") continue;
    const duration = typeof e.duration === "number" ? e.duration : 0;
    if (!(duration > 0 && duration <= MAX_TRACK_SECONDS)) continue;
    tracks.set(e.id, {
      id: e.id,
      title: text(e.title) ?? "Untitled",
      channel: text(e.channel) ?? text(e.uploader) ?? "",
      duration,
      thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
      verified: e.channel_is_verified === true,
    });
  }
  return [...tracks.values()];
}

/** A yt-dlp failure as a message the user can act on. */
export function musicError(err: unknown, action: "search" | "download"): HttpError {
  if (err instanceof HttpError) return err;
  if (isAbortError(err)) return new HttpError(499, `The ${action} was cancelled.`);
  if ((err as { name?: unknown })?.name === "TimeoutError") {
    return new HttpError(504, "YouTube took too long to respond. Try again.");
  }
  const message = (err instanceof Error ? err.message : String(err))
    .replace(/ERROR:\s*|\[\w+\] [\w-]+: /g, "");
  if (message.endsWith("not found — is it installed?")) {
    return new HttpError(503, "yt-dlp isn't installed. Install it with `brew install yt-dlp`, then try again.");
  }
  if (/HTTP Error 403|Sign in to confirm|Requested format is not available|nsig|signature/i.test(message)) {
    return new HttpError(502, `YouTube blocked the ${action}. Updating yt-dlp usually fixes this: \`brew upgrade yt-dlp\``);
  }
  return new HttpError(502, `The ${action} failed: ${message}`);
}

/**
 * Songs from YouTube via yt-dlp. Downloads are cached in `data/music/` so previewing a
 * song and then adding it (or adding it to several projects) only downloads it once.
 */
export class MusicLibrary {
  private cached = new Map<string, string>();
  private downloads = new Map<string, Promise<string>>();
  private limit = createLimiter(DOWNLOAD_CONCURRENCY);
  private stopping = new AbortController();

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
    private ytdlp = YTDLP,
  ) {}

  async load(): Promise<void> {
    for (const entry of await fs.readdir(this.paths.music, { withFileTypes: true })) {
      const id = path.parse(entry.name).name;
      if (entry.isFile() && isTrackId(id)) this.cached.set(id, path.join(this.paths.music, entry.name));
    }
  }

  async search(query: string, signal: AbortSignal): Promise<MusicTrack[]> {
    const q = query.trim().replace(/\s+/g, " ");
    if (!q) throw new HttpError(400, "Type something to search for.");
    if (q.length > 200) throw new HttpError(400, "That search is too long.");
    try {
      const out = await run(this.ytdlp, [...BASE_ARGS, "--flat-playlist", "-J", `ytsearch${SEARCH_RESULTS}:${q}`], {
        signal: AbortSignal.any([signal, this.stopping.signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]),
      });
      return parseSearchResults(out);
    } catch (err) {
      throw musicError(err, "search");
    }
  }

  /** Path of a track's audio file, downloading it first if it isn't cached. */
  async audio(id: string): Promise<string> {
    if (!isTrackId(id)) throw new HttpError(400, "Invalid track id");
    const cached = this.cached.get(id);
    if (cached) {
      try {
        await fs.access(cached);
        return cached;
      } catch {
        this.cached.delete(id);
      }
    }
    let pending = this.downloads.get(id);
    if (!pending) {
      pending = this.limit(() => this.download(id)).finally(() => this.downloads.delete(id));
      this.downloads.set(id, pending);
    }
    return pending;
  }

  /** Add a track to a project's media (downloading it if needed). */
  async import(body: unknown, projectExists: (projectId: string) => boolean): Promise<MediaAsset> {
    const req = body as Partial<ImportMusicRequest> | null;
    if (!req || typeof req.projectId !== "string" || typeof req.trackId !== "string") {
      throw new HttpError(400, "Expected { projectId, trackId, title }.");
    }
    const { projectId, trackId } = req;
    const exists = () => projectExists(projectId);
    if (!exists()) throw new HttpError(404, "Project not found");

    const source = await this.audio(trackId);
    const ext = path.extname(source);
    // Titles like "AC/DC - Thunderstruck" aren't paths.
    const title = (text(req.title) ?? trackId).replace(/[\\/]/g, "-").slice(0, 150);
    const tmp = this.paths.tmpFile(ext);
    try {
      await fs.copyFile(source, tmp);
      return await this.library.add(tmp, `${title}${ext}`, projectId, exists);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /** Kill running downloads (server shutdown). */
  shutdown(): void {
    this.stopping.abort();
  }

  private async download(id: string): Promise<string> {
    const dir = this.paths.tmpFile(".ytdl");
    try {
      const out = await run(
        this.ytdlp,
        [
          ...BASE_ARGS,
          "--no-playlist",
          // AAC in MP4 plays everywhere; fall back to whatever audio there is (usually Opus).
          "-f", "bestaudio[ext=m4a]/bestaudio",
          "-P", dir,
          "-o", "%(id)s.%(ext)s",
          "--print", "after_move:filepath",
          `https://www.youtube.com/watch?v=${id}`,
        ],
        { signal: AbortSignal.any([this.stopping.signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) },
      );
      const file = out.trim().split("\n").pop();
      if (!file) throw new Error("yt-dlp didn't report the downloaded file.");
      const dest = path.join(this.paths.music, `${id}${path.extname(file)}`);
      await fs.rename(file, dest);
      this.cached.set(id, dest);
      return dest;
    } catch (err) {
      throw musicError(err, "download");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}
