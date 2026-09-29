import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImportWebMediaRequest, MediaAsset, WebClip, WebMediaKind } from "../shared/types.ts";
import { YTDLP } from "./config.ts";
import { isAbortError, run } from "./ffmpeg.ts";
import type { MediaLibrary } from "./media.ts";
import { createLimiter } from "./queue.ts";
import { type DataPaths, HttpError } from "./storage.ts";

const SEARCH_RESULTS = 15;
const SEARCH_TIMEOUT_MS = 30_000;
const RESOLVE_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS: Record<WebMediaKind, number> = { audio: 3 * 60_000, video: 10 * 60_000 };
const DOWNLOAD_CONCURRENCY = 2;
/** Longer search results are mixes and "10 hour" loops, not songs or clips. */
const MAX_SEARCH_SECONDS = 20 * 60;
const MAX_URL_LENGTH = 2048;
/** Every YouTube video id is 11 characters of base64url. */
const YOUTUBE_ID_RE = /^[\w-]{11}$/;
/** Cache keys: a YouTube id, or `x` + a URL hash for other sites. */
const CACHE_KEY_RE = /^([\w-]{11}|x[0-9a-f]{16})$/;

/** Ignore the user's yt-dlp config so the output is always what we parse. */
const BASE_ARGS = ["--ignore-config", "--no-warnings"];
/**
 * Up to 1080p (by the short side, so vertical clips count as 1080p too),
 * preferring H.264/AAC, which every browser decodes and seeks quickly.
 */
const VIDEO_FORMAT_ARGS = ["-f", "bv*+ba/b", "-S", "res:1080,vcodec:h264,acodec:aac", "--merge-output-format", "mp4"];
/** The best audio-only stream (AAC in MP4 when there is one), else the audio of the best file. */
const AUDIO_FORMAT_ARGS = ["-f", "bestaudio[ext=m4a]/bestaudio/best", "-x"];

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** The video id of a youtube.com / youtu.be link, or null. */
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null | undefined = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(url.pathname)?.[1];
  }
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

export interface WebLink {
  /** Canonical URL (YouTube links become their watch URL, dropping playlists and timestamps). */
  url: string;
  /** Cache key: the same video always gets the same key, whichever form of link it came from. */
  key: string;
}

/** Validate a link the user pasted (or a search result's URL). Throws `HttpError(400)`. */
export function parseLink(raw: unknown): WebLink {
  const input = text(raw);
  let url: URL | null = null;
  try {
    if (input && input.length <= MAX_URL_LENGTH) url = new URL(input);
  } catch {
    // Not a URL.
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new HttpError(400, "That isn't a web link.");
  }
  const id = youtubeId(url);
  if (id) return { url: youtubeWatchUrl(id), key: id };
  url.hash = "";
  const href = url.href;
  return { url: href, key: `x${createHash("sha256").update(href).digest("hex").slice(0, 16)}` };
}

interface InfoEntry {
  _type?: unknown;
  id?: unknown;
  title?: unknown;
  channel?: unknown;
  uploader?: unknown;
  duration?: unknown;
  live_status?: unknown;
  channel_is_verified?: unknown;
  thumbnail?: unknown;
  extractor_key?: unknown;
  webpage_url?: unknown;
}

const SITE_NAMES: Record<string, string> = { Youtube: "YouTube", Twitter: "X", TikTok: "TikTok", Instagram: "Instagram" };

/** yt-dlp's `--flat-playlist -J` search output -> clips (skipping livestreams and long mixes). */
export function parseSearchResults(json: string): WebClip[] {
  const { entries } = JSON.parse(json) as { entries?: InfoEntry[] };
  const clips = new Map<string, WebClip>();
  for (const e of entries ?? []) {
    if (typeof e.id !== "string" || !YOUTUBE_ID_RE.test(e.id) || clips.has(e.id)) continue;
    if (e.live_status === "is_live" || e.live_status === "is_upcoming") continue;
    const duration = typeof e.duration === "number" ? e.duration : 0;
    if (!(duration > 0 && duration <= MAX_SEARCH_SECONDS)) continue;
    clips.set(e.id, {
      url: youtubeWatchUrl(e.id),
      title: text(e.title) ?? "Untitled",
      channel: text(e.channel) ?? text(e.uploader) ?? "",
      duration,
      thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
      verified: e.channel_is_verified === true,
      site: "YouTube",
    });
  }
  return [...clips.values()];
}

/** yt-dlp's `-J` output for a single link -> clip. `link` is what was asked for. */
export function parseLinkInfo(json: string, link: WebLink): WebClip {
  const info = JSON.parse(json) as InfoEntry;
  if (info._type === "playlist" || info._type === "multi_video") {
    throw new HttpError(400, "That's a playlist or a post with several videos. Paste a link to a single video.");
  }
  if (info.live_status === "is_live" || info.live_status === "is_upcoming") {
    throw new HttpError(400, "Livestreams can't be downloaded. Try again once it has ended.");
  }
  const extractor = text(info.extractor_key) ?? "";
  const youtube = YOUTUBE_ID_RE.test(link.key);
  return {
    url: link.url,
    title: text(info.title) ?? "Untitled",
    channel: text(info.channel) ?? text(info.uploader) ?? "",
    duration: typeof info.duration === "number" && info.duration > 0 ? info.duration : 0,
    thumbnail: youtube ? `https://i.ytimg.com/vi/${link.key}/mqdefault.jpg` : (text(info.thumbnail) ?? null),
    verified: info.channel_is_verified === true,
    site: SITE_NAMES[extractor] ?? (extractor && extractor !== "Generic" ? extractor : new URL(link.url).hostname.replace(/^www\./, "")),
  };
}

type Action = "search" | "download" | "link lookup";

/** A yt-dlp failure as a message the user can act on. */
export function webMediaError(err: unknown, action: Action): HttpError {
  if (err instanceof HttpError) return err;
  if (isAbortError(err)) return new HttpError(499, `The ${action} was cancelled.`);
  if ((err as { name?: unknown })?.name === "TimeoutError") {
    return new HttpError(504, "The site took too long to respond. Try again.");
  }
  const message = (err instanceof Error ? err.message : String(err))
    .replace(/ERROR:\s*|\[[\w:]+\] [\w-]+: /g, "");
  if (message.endsWith("not found — is it installed?")) {
    return new HttpError(503, "yt-dlp isn't installed. Install it with `brew install yt-dlp`, then try again.");
  }
  if (/Unsupported URL/i.test(message)) {
    return new HttpError(400, "There's no video at that link, or the site isn't supported.");
  }
  if (/not a bot|HTTP Error 403|Requested format is not available|nsig|signature/i.test(message)) {
    return new HttpError(502, `The site blocked the ${action}. Updating yt-dlp usually fixes this: \`brew upgrade yt-dlp\``);
  }
  if (/private video|log ?in|logged-in|sign in|confirm your age|age-restricted|cookies/i.test(message)) {
    return new HttpError(403, "That video is private or needs an account to watch, so it can't be downloaded.");
  }
  return new HttpError(502, `The ${action} failed: ${message}`);
}

/**
 * Songs and clips from YouTube (search) or any site yt-dlp supports (pasted links).
 * Audio is cached in `data/music/` so previewing a clip and then adding it (or adding
 * it to several projects) only downloads it once. Videos are downloaded straight into
 * the project's media.
 */
export class WebMediaLibrary {
  private cachedAudio = new Map<string, string>();
  private audioDownloads = new Map<string, Promise<string>>();
  private limit = createLimiter(DOWNLOAD_CONCURRENCY);
  private stopping = new AbortController();

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
    private ytdlp = YTDLP,
    private ffmpegPath = process.env.FFMPEG_PATH,
  ) {}

  async load(): Promise<void> {
    for (const entry of await fs.readdir(this.paths.music, { withFileTypes: true })) {
      const key = path.parse(entry.name).name;
      if (entry.isFile() && CACHE_KEY_RE.test(key)) this.cachedAudio.set(key, path.join(this.paths.music, entry.name));
    }
  }

  async search(query: string, signal: AbortSignal): Promise<WebClip[]> {
    const q = query.trim().replace(/\s+/g, " ");
    if (!q) throw new HttpError(400, "Type something to search for.");
    if (q.length > 200) throw new HttpError(400, "That search is too long.");
    try {
      const out = await run(this.ytdlp, [...BASE_ARGS, "--flat-playlist", "-J", `ytsearch${SEARCH_RESULTS}:${q}`], {
        signal: this.signal(signal, SEARCH_TIMEOUT_MS),
      });
      return parseSearchResults(out);
    } catch (err) {
      throw webMediaError(err, "search");
    }
  }

  /** Look up a pasted link: title, uploader, duration... (nothing is downloaded). */
  async resolve(rawUrl: unknown, signal: AbortSignal): Promise<WebClip> {
    const link = parseLink(rawUrl);
    try {
      const out = await run(this.ytdlp, [...BASE_ARGS, "--no-playlist", "-J", "--", link.url], {
        signal: this.signal(signal, RESOLVE_TIMEOUT_MS),
      });
      return parseLinkInfo(out, link);
    } catch (err) {
      throw webMediaError(err, "link lookup");
    }
  }

  /** Path of a link's audio, downloading it first if it isn't cached. */
  async audio(rawUrl: unknown): Promise<string> {
    const { url, key } = parseLink(rawUrl);
    const cached = this.cachedAudio.get(key);
    if (cached) {
      try {
        await fs.access(cached);
        return cached;
      } catch {
        this.cachedAudio.delete(key);
      }
    }
    let pending = this.audioDownloads.get(key);
    if (!pending) {
      pending = this.limit(async () => {
        const dir = this.paths.tmpFile(".ytdl");
        try {
          const file = await this.download(url, key, "audio", dir);
          const dest = path.join(this.paths.music, `${key}${path.extname(file)}`);
          await fs.rename(file, dest);
          this.cachedAudio.set(key, dest);
          return dest;
        } finally {
          await fs.rm(dir, { recursive: true, force: true });
        }
      }).finally(() => this.audioDownloads.delete(key));
      this.audioDownloads.set(key, pending);
    }
    return pending;
  }

  /** Add a link's audio or video to a project's media (downloading it if needed). */
  async import(body: unknown, projectExists: (projectId: string) => boolean): Promise<MediaAsset> {
    const req = body as Partial<ImportWebMediaRequest> | null;
    if (!req || typeof req.projectId !== "string" || (req.kind !== "audio" && req.kind !== "video")) {
      throw new HttpError(400, "Expected { projectId, url, title, kind: 'audio' | 'video' }.");
    }
    const { projectId, kind } = req;
    const link = parseLink(req.url);
    const exists = () => projectExists(projectId);
    if (!exists()) throw new HttpError(404, "Project not found");
    // Titles like "AC/DC - Thunderstruck" aren't paths.
    const title = (text(req.title) ?? "Download").replace(/[\\/]/g, "-").slice(0, 150);

    if (kind === "audio") {
      const source = await this.audio(link.url);
      const ext = path.extname(source);
      const tmp = this.paths.tmpFile(ext);
      try {
        await fs.copyFile(source, tmp);
        return await this.library.add(tmp, `${title}${ext}`, projectId, exists);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }

    const dir = this.paths.tmpFile(".ytdl");
    try {
      const file = await this.limit(() => this.download(link.url, link.key, "video", dir));
      return await this.library.add(file, `${title}${path.extname(file)}`, projectId, exists);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  /** Kill running downloads (server shutdown). */
  shutdown(): void {
    this.stopping.abort();
  }

  private signal(request: AbortSignal | null, timeoutMs: number) {
    return AbortSignal.any([...(request ? [request] : []), this.stopping.signal, AbortSignal.timeout(timeoutMs)]);
  }

  /** Download into `dir` and return the file's path. */
  private async download(url: string, key: string, kind: WebMediaKind, dir: string): Promise<string> {
    try {
      const out = await run(
        this.ytdlp,
        [
          ...BASE_ARGS,
          "--no-playlist",
          ...(kind === "audio" ? AUDIO_FORMAT_ARGS : VIDEO_FORMAT_ARGS),
          ...(this.ffmpegPath ? ["--ffmpeg-location", this.ffmpegPath] : []),
          "-P", dir,
          "-o", `${key}.%(ext)s`,
          "--print", "after_move:filepath",
          "--",
          url,
        ],
        { signal: this.signal(null, DOWNLOAD_TIMEOUT_MS[kind]) },
      );
      const file = out.trim().split("\n").pop();
      if (!file) throw new Error("yt-dlp didn't report the downloaded file.");
      return file;
    } catch (err) {
      throw webMediaError(err, "download");
    }
  }
}
