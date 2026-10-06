import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImportWebMediaRequest, MediaAsset, WebClip, WebDownloadProgress, WebMediaKind } from "../shared/types.ts";
import { errorMessage } from "../shared/errors.ts";
import { FFMPEG, YTDLP } from "./config.ts";
import { isAbortError, run } from "./process.ts";
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
/**
 * Audio the cache keeps as it came: what the page and the music suite's audio engine both read. Anything
 * else (Opus, WebM: the engine reads neither) is made a WAV first, so a song's sample plays like any other.
 */
const READ_EVERYWHERE = /\.(m4a|mp3|wav)$/i;

/**
 * Progress on stdout, next to the downloaded file's path: each stream's size before
 * downloading (a list when video and audio are separate streams, else empty), then
 * a line per update. Read by `DownloadProgress`.
 */
const PROGRESS_ARGS = [
  "--progress",
  "--newline",
  "--print", "before_dl:sizes %(requested_formats.:.filesize,filesize_approx)j",
  "--progress-template",
  "download:progress %(info.format_id)s %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s",
];

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

/**
 * One download's progress, from the lines `PROGRESS_ARGS` makes yt-dlp print. Separate
 * video and audio streams count as one download, weighted by their sizes when they're
 * known, so the bar doesn't start over for the audio. What it reports never goes backwards.
 */
export class DownloadProgress {
  /** Sizes of the streams to download, in order; null entries aren't known. */
  private planned: (number | null)[] = [];
  private streams = new Map<string, { done: number; total: number | null }>();
  private best = 0;

  /** Take a line of stdout; false if it isn't a progress line. */
  line(raw: string): boolean {
    const line = raw.trim();
    if (line.startsWith("sizes ")) {
      try {
        const sizes: unknown = JSON.parse(line.slice(6));
        if (Array.isArray(sizes)) this.planned = sizes.map((n) => (typeof n === "number" && n > 0 ? n : null));
      } catch {
        // "NA" when there's nothing to list.
      }
      return true;
    }
    if (!line.startsWith("progress ")) return false;
    const [, id, done, total] = line.split(" ");
    const bytes = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
    this.streams.set(id ?? "", { done: bytes(done) ?? 0, total: bytes(total) || null });
    return true;
  }

  get(): WebDownloadProgress {
    if (this.streams.size === 0) return { status: "waiting", progress: null };
    const seen = [...this.streams.values()];
    const count = Math.max(this.planned.length, seen.length, 1);
    const sizes = Array.from({ length: count }, (_, i) => this.planned[i] ?? seen[i]?.total ?? null);
    const known = sizes.every((n) => n !== null);
    const sum = known ? sizes.reduce<number>((a, n) => a + n!, 0) : 0;
    let progress = 0;
    for (let i = 0; i < count; i++) {
      const stream = seen[i];
      const fraction = stream?.total ? Math.min(1, stream.done / stream.total) : 0;
      progress += fraction * (known && sum > 0 ? sizes[i]! / sum : 1 / count);
    }
    // Merging, or turning it into audio.
    if (seen.length >= count && seen.every((st) => st.total !== null && st.done >= st.total)) {
      return { status: "processing", progress: 1 };
    }
    if (!seen.some((st) => st.total !== null)) return { status: "downloading", progress: null };
    this.best = Math.max(this.best, Math.min(progress, 0.999));
    return { status: "downloading", progress: this.best };
  }
}

/** A yt-dlp failure as a message the user can act on. */
export function webMediaError(err: unknown, action: Action): HttpError {
  if (err instanceof HttpError) return err;
  if (isAbortError(err)) return new HttpError(499, `The ${action} was cancelled.`);
  if ((err as { name?: unknown })?.name === "TimeoutError") {
    return new HttpError(504, "The site took too long to respond. Try again.");
  }
  const message = errorMessage(err)
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
  /** Downloads running now, by `progressKey`. */
  private running = new Map<string, DownloadProgress>();

  constructor(
    private paths: DataPaths,
    private library: MediaLibrary,
    private ytdlp = YTDLP,
  ) {}

  async load(): Promise<void> {
    for (const entry of await fs.readdir(this.paths.music, { withFileTypes: true })) {
      const key = path.parse(entry.name).name;
      if (!entry.isFile() || !CACHE_KEY_RE.test(key)) continue;
      const file = path.join(this.paths.music, entry.name);
      // Kept by an older version as it came: downloaded again when it's next wanted.
      if (!READ_EVERYWHERE.test(entry.name)) await fs.rm(file, { force: true });
      else this.cachedAudio.set(key, file);
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
  async resolve(rawUrl: unknown, signal: AbortSignal | null): Promise<WebClip> {
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
          let file = await this.download(url, key, "audio", dir);
          if (!READ_EVERYWHERE.test(file)) file = await toWav(file, path.join(dir, `${key}.wav`));
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

  /** How far a link's download has got (`waiting` when it's queued, or not downloading). */
  progress(rawUrl: unknown, kind: unknown): WebDownloadProgress {
    if (kind !== "audio" && kind !== "video") throw new HttpError(400, "Expected kind to be 'audio' or 'video'.");
    const { key } = parseLink(rawUrl);
    return this.running.get(progressKey(kind, key))?.get() ?? { status: "waiting", progress: null };
  }

  /**
   * Add a link's audio or video to a project's media (downloading it if needed). A project that has it
   * already gets the copy it has: trying the same link again doesn't fill its folder.
   */
  async import(body: unknown, projectExists: (projectId: string) => boolean): Promise<MediaAsset> {
    const req = body as Partial<ImportWebMediaRequest> | null;
    if (!req || typeof req.projectId !== "string" || (req.kind !== "audio" && req.kind !== "video")) {
      throw new HttpError(400, "Expected { projectId, url, kind: 'audio' | 'video', title? }.");
    }
    const { projectId, kind } = req;
    const link = parseLink(req.url);
    const exists = () => projectExists(projectId);
    if (!exists()) throw new HttpError(404, "Project not found");
    const origin = `web:${kind}:${link.key}`;
    const known = this.library.list(projectId).find((a) => a.origin === origin);
    if (known) return known;
    // Titles like "AC/DC - Thunderstruck" aren't paths.
    const named = text(req.title) ?? (await this.resolve(link.url, null).then((clip) => clip.title, () => undefined));
    const title = (named ?? "Download").replace(/[\\/]/g, "-").slice(0, 150);

    if (kind === "audio") {
      const source = await this.audio(link.url);
      const ext = path.extname(source);
      const tmp = this.paths.tmpFile(ext);
      try {
        await fs.copyFile(source, tmp);
        return await this.library.add(tmp, `${title}${ext}`, projectId, exists, origin);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }

    const dir = this.paths.tmpFile(".ytdl");
    try {
      const file = await this.limit(() => this.download(link.url, link.key, "video", dir));
      return await this.library.add(file, `${title}${path.extname(file)}`, projectId, exists, origin);
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
    const progress = new DownloadProgress();
    const running = progressKey(kind, key);
    this.running.set(running, progress);
    // stdout is progress lines, then the file's path.
    const other: string[] = [];
    let partial = "";
    const take = (line: string) => {
      if (!progress.line(line) && line.trim()) other.push(line.trim());
    };
    try {
      await run(
        this.ytdlp,
        [
          ...BASE_ARGS,
          "--no-playlist",
          ...(kind === "audio" ? AUDIO_FORMAT_ARGS : VIDEO_FORMAT_ARGS),
          ...(FFMPEG !== "ffmpeg" ? ["--ffmpeg-location", FFMPEG] : []),
          ...PROGRESS_ARGS,
          "-P", dir,
          "-o", `${key}.%(ext)s`,
          "--print", "after_move:filepath",
          "--",
          url,
        ],
        {
          signal: this.signal(null, DOWNLOAD_TIMEOUT_MS[kind]),
          onStdout: (chunk) => {
            const lines = (partial + chunk.toString("utf8")).split("\n");
            partial = lines.pop() ?? "";
            lines.forEach(take);
          },
        },
      );
      take(partial);
      const file = other.pop();
      if (!file) throw new Error("yt-dlp didn't report the downloaded file.");
      return file;
    } catch (err) {
      throw webMediaError(err, "download");
    } finally {
      this.running.delete(running);
    }
  }
}

const progressKey = (kind: WebMediaKind, key: string) => `${kind} ${key}`;

/** A sound file as a 16-bit WAV at `out` (its own rate and channels). */
async function toWav(file: string, out: string): Promise<string> {
  try {
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-c:a", "pcm_s16le", out], { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS.audio) });
    return out;
  } catch (err) {
    throw new HttpError(502, `The download couldn't be converted: ${errorMessage(err)}`);
  }
}
