import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset, ProjectSummary, WebClip, WebDownloadProgress, WebSearchPage } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";
import { FFMPEG, FFPROBE } from "./config.ts";
import { HttpError } from "./storage.ts";
import { DownloadProgress, parseLink, parseLinkInfo, parseSearchPage, parseSearchResults, webMediaError } from "./web-media.ts";

describe("parseSearchResults", () => {
  it("says a page has more after it when YouTube gave a full one, up to the last page", () => {
    const page = (n: number) => JSON.stringify({ entries: Array.from({ length: n }, (_, i) => ({ id: `abcdefghi${String(i).padStart(2, "0")}`, title: "Song", duration: 100 })) });
    expect(parseSearchPage(page(15), 0)).toMatchObject({ more: true });
    expect(parseSearchPage(page(15), 0).clips).toHaveLength(15);
    expect(parseSearchPage(page(9), 3)).toMatchObject({ more: false });
    expect(parseSearchPage(page(15), 9)).toMatchObject({ more: false });
  });

  it("maps yt-dlp's flat search output to clips", () => {
    const json = JSON.stringify({
      entries: [
        { id: "fHI8X4OXluQ", title: " The Weeknd - Blinding Lights ", channel: "The Weeknd", duration: 204, channel_is_verified: true },
        { id: "XwxLwG2_Sxk", title: "Lyrics", channel: null, uploader: "7clouds", duration: 200.5 },
      ],
    });
    expect(parseSearchResults(json)).toEqual<WebClip[]>([
      {
        url: "https://www.youtube.com/watch?v=fHI8X4OXluQ",
        title: "The Weeknd - Blinding Lights",
        channel: "The Weeknd",
        duration: 204,
        thumbnail: "https://i.ytimg.com/vi/fHI8X4OXluQ/mqdefault.jpg",
        verified: true,
        site: "YouTube",
      },
      {
        url: "https://www.youtube.com/watch?v=XwxLwG2_Sxk",
        title: "Lyrics",
        channel: "7clouds",
        duration: 200.5,
        thumbnail: "https://i.ytimg.com/vi/XwxLwG2_Sxk/mqdefault.jpg",
        verified: false,
        site: "YouTube",
      },
    ]);
  });

  it("skips livestreams, long mixes, bad ids and duplicates", () => {
    const json = JSON.stringify({
      entries: [
        { id: "aaaaaaaaaaa", title: "Live radio", duration: null, live_status: "is_live" },
        { id: "bbbbbbbbbbb", title: "Premiere", duration: 180, live_status: "is_upcoming" },
        { id: "ccccccccccc", title: "10 hour loop", duration: 36_000 },
        { id: "not-an-id", title: "Channel", duration: 100 },
        { id: "ddddddddddd", title: "Song", duration: 100 },
        { id: "ddddddddddd", title: "Song again", duration: 100 },
      ],
    });
    expect(parseSearchResults(json).map((t) => t.title)).toEqual(["Song"]);
    expect(parseSearchResults("{}")).toEqual([]);
  });
});

describe("parseLink", () => {
  it("canonicalises every form of YouTube link to one watch URL and cache key", () => {
    const watch = { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", key: "dQw4w9WgXcQ" };
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      " https://youtube.com/embed/dQw4w9WgXcQ ",
    ]) {
      expect(parseLink(link)).toEqual(watch);
    }
  });

  it("keys other sites by a hash of the URL (without the fragment)", () => {
    const a = parseLink("https://www.tiktok.com/@someone/video/7300000000000000000#comments");
    expect(a.url).toBe("https://www.tiktok.com/@someone/video/7300000000000000000");
    expect(a.key).toMatch(/^x[0-9a-f]{16}$/);
    expect(parseLink("https://www.tiktok.com/@someone/video/7300000000000000000").key).toBe(a.key);
    expect(parseLink("https://www.tiktok.com/@someone/video/7300000000000000001").key).not.toBe(a.key);
  });

  it("rejects anything that isn't an http(s) link", () => {
    for (const bad of ["", "never gonna", "--exec=rm", "file:///etc/passwd", "javascript:alert(1)", 42, `https://a.co/${"x".repeat(2100)}`]) {
      expect(() => parseLink(bad)).toThrow(HttpError);
    }
  });
});

describe("parseLinkInfo", () => {
  const tiktok = parseLink("https://www.tiktok.com/@someone/video/7300000000000000000");

  it("maps a single video's metadata", () => {
    const json = JSON.stringify({
      _type: "video",
      title: "a clip",
      uploader: "someone",
      duration: 12.4,
      thumbnail: "https://cdn.example/thumb.jpg",
      extractor_key: "TikTok",
    });
    expect(parseLinkInfo(json, tiktok)).toEqual<WebClip>({
      url: tiktok.url,
      title: "a clip",
      channel: "someone",
      duration: 12.4,
      thumbnail: "https://cdn.example/thumb.jpg",
      verified: false,
      site: "TikTok",
    });
    const generic = parseLinkInfo(JSON.stringify({ extractor_key: "Generic" }), parseLink("https://www.example.com/a.mp4"));
    expect(generic).toMatchObject({ title: "Untitled", duration: 0, thumbnail: null, site: "example.com" });
  });

  it("refuses playlists and livestreams", () => {
    expect(() => parseLinkInfo(JSON.stringify({ _type: "playlist" }), tiktok)).toThrow(/single video/);
    expect(() => parseLinkInfo(JSON.stringify({ live_status: "is_live" }), tiktok)).toThrow(/Livestreams/);
  });
});

describe("DownloadProgress", () => {
  const feed = (...lines: string[]) => {
    const p = new DownloadProgress();
    for (const line of lines) p.line(line);
    return p;
  };

  it("reads one stream's bytes, then reports processing (converting to audio)", () => {
    const p = new DownloadProgress();
    expect(p.get()).toEqual({ status: "waiting", progress: null });
    expect(p.line("sizes []")).toBe(true);
    expect(p.line("progress 140 250 1000")).toBe(true);
    expect(p.get()).toEqual({ status: "downloading", progress: 0.25 });
    p.line("progress 140 1000 1000");
    expect(p.get()).toEqual({ status: "processing", progress: 1 });
    // Anything else (the file's path) isn't ours.
    expect(p.line("/tmp/x/abc.m4a")).toBe(false);
  });

  it("weighs separate video and audio streams by size, so it doesn't start over", () => {
    const p = feed("sizes [900, 100]", "progress 137 450 900");
    expect(p.get().progress).toBeCloseTo(0.45);
    p.line("progress 137 900 900");
    expect(p.get()).toMatchObject({ status: "downloading", progress: 0.9 });
    p.line("progress 140 50 100");
    expect(p.get().progress).toBeCloseTo(0.95);
    p.line("progress 140 100 100");
    expect(p.get().status).toBe("processing");
  });

  it("splits evenly when the sizes aren't known up front, and never goes backwards", () => {
    const p = feed("sizes [null, null]", "progress 137 900 900");
    expect(p.get()).toMatchObject({ status: "downloading", progress: 0.5 });
    // The audio's size makes the video weigh 90%.
    p.line("progress 140 0 100");
    expect(p.get().progress).toBeCloseTo(0.9);
    // A growing estimate doesn't pull back what was reported.
    const q = feed("sizes NA", "progress 1 500 1000");
    expect(q.get().progress).toBe(0.5);
    q.line("progress 1 500 2000");
    expect(q.get().progress).toBe(0.5);
  });

  it("has no fraction until a size is known", () => {
    expect(feed("progress 1 4096 NA").get()).toEqual({ status: "downloading", progress: null });
  });
});

describe("webMediaError", () => {
  it("turns yt-dlp failures into actionable messages", () => {
    const blocked = webMediaError(new Error("ERROR: [youtube] abc: unable to download video data: HTTP Error 403: Forbidden"), "download");
    expect(blocked.status).toBe(502);
    expect(blocked.message).toMatch(/brew upgrade yt-dlp/);
    const bot = webMediaError(new Error("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser"), "download");
    expect(bot.message).toMatch(/blocked/);

    const login = webMediaError(new Error("ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required"), "link lookup");
    expect(login.status).toBe(403);
    expect(login.message).toMatch(/private or needs an account/);

    const unsupported = webMediaError(new Error("ERROR: Unsupported URL: https://example.com/"), "link lookup");
    expect(unsupported.status).toBe(400);

    const missing = webMediaError(new Error("/opt/bin/yt-dlp not found — is it installed?"), "search");
    expect(missing.status).toBe(503);
    expect(missing.message).toMatch(/brew install yt-dlp/);

    const unavailable = webMediaError(new Error("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable"), "download");
    expect(unavailable.message).toBe("The download failed: This video is unavailable");

    const timeout = webMediaError(new DOMException("timed out", "TimeoutError"), "search");
    expect(timeout.status).toBe(504);

    const own = new HttpError(400, "nope");
    expect(webMediaError(own, "search")).toBe(own);
  });
});

const ffmpegAvailable =
  spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

/**
 * Stands in for yt-dlp: searches return two songs, link lookups describe a TikTok
 * video (or fail for "unsupported" links), downloads copy a fixture tone or video,
 * and the id `blocked0000` fails like YouTube blocking the download. Logs its argv.
 */
const FAKE_YTDLP = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--flat-playlist")) {
  process.stdout.write(JSON.stringify({ entries: [
    { id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up", channel: "Rick Astley", duration: 213, channel_is_verified: true },
    { id: "liveliveliv", title: "Lofi radio", duration: null, live_status: "is_live" },
  ] }));
  process.exit(0);
}
const url = args[args.length - 1];
if (args[args.length - 2] !== "--") process.exit(2);
if (url.includes("unsupported")) {
  console.error("ERROR: Unsupported URL: " + url);
  process.exit(1);
}
if (args.includes("-J")) {
  process.stdout.write(JSON.stringify({ _type: "video", title: "dance", uploader: "someone", duration: 2, extractor_key: "TikTok" }));
  process.exit(0);
}
if (url.includes("slow")) {
  // Half the video's bytes, then the rest once the test creates FAKE_RELEASE.
  console.log("sizes [300, 100]");
  console.log("progress 137 150 300");
  const wait = setInterval(() => {
    if (!fs.existsSync(process.env.FAKE_RELEASE)) return;
    clearInterval(wait);
    console.log("progress 137 300 300");
    console.log("progress 140 100 100");
    const dir = args[args.indexOf("-P") + 1];
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, args[args.indexOf("-o") + 1].replace("%(ext)s", "mp4"));
    fs.copyFileSync(process.env.FAKE_VIDEO, out);
    console.log(out);
  }, 20);
  return;
}
if (url.endsWith("blocked0000")) {
  console.error("ERROR: [youtube] blocked0000: unable to download video data: HTTP Error 403: Forbidden");
  process.exit(1);
}
const video = args.includes("--merge-output-format");
const dir = args[args.indexOf("-P") + 1];
fs.mkdirSync(dir, { recursive: true });
// A link with "webm" in it comes as WebM audio (the engine can't read it): the bytes are the fixture's, which ffmpeg reads anyway.
const out = path.join(dir, args[args.indexOf("-o") + 1].replace("%(ext)s", video ? "mp4" : url.includes("webm") ? "webm" : "m4a"));
fs.copyFileSync(video ? process.env.FAKE_VIDEO : process.env.FAKE_FIXTURE, out);
console.log(out);
`;

describe.skipIf(!ffmpegAvailable)("web media routes (fake yt-dlp)", () => {
  let tmp: string;
  let dataDir: string;
  let log: string;
  let editor: EditorApp;
  let server: http.Server;
  let base: string;
  let project: ProjectSummary;

  const RICK = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const TIKTOK = "https://www.tiktok.com/@someone/video/7300000000000000000";
  const q = encodeURIComponent;
  const api = (p: string, init?: RequestInit) => fetch(base + p, init);
  const post = (p: string, body: unknown) =>
    api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
  /** yt-dlp runs so far, as argv arrays. */
  const runs = () =>
    readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
  const downloads = () => runs().filter((argv) => !argv.includes("--flat-playlist") && !argv.includes("-J"));

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-web-media-test-"));
    dataDir = path.join(tmp, "data");
    log = path.join(tmp, "ytdlp.log");
    writeFileSync(log, "");
    const ff = (...args: string[]) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    const fixture = path.join(tmp, "song.m4a");
    ff("-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", fixture);
    const video = path.join(tmp, "clip.mp4");
    ff("-f", "lavfi", "-i", "testsrc=size=180x320:rate=30:duration=2", "-f", "lavfi", "-i", "sine=duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video);
    const fake = path.join(tmp, "yt-dlp.cjs");
    writeFileSync(fake, FAKE_YTDLP);
    chmodSync(fake, 0o755);
    process.env.FAKE_LOG = log;
    process.env.FAKE_FIXTURE = fixture;
    process.env.FAKE_VIDEO = video;
    process.env.FAKE_RELEASE = path.join(tmp, "release");

    editor = await createApp({ dataDir, ytdlpPath: fake });
    server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    project = (await (await post("/api/projects", {})).json()) as ProjectSummary;
  });

  afterAll(async () => {
    editor?.shutdown();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("searches", async () => {
    const res = await api("/api/web/search?q=%20never%20%20gonna%20");
    expect(res.status).toBe(200);
    const { clips, more } = (await res.json()) as WebSearchPage;
    expect(clips.map((t) => t.url)).toEqual([RICK]);
    // Two entries aren't a full page: there's nothing after them.
    expect(more).toBe(false);
    // The query goes to yt-dlp as one normalised argument, never a flag.
    expect(runs().at(-1)?.at(-1)).toBe("ytsearch15:never gonna");

    // A later page: the results up to its end, and only its own taken.
    expect((await api("/api/web/search?q=never%20gonna&page=2")).status).toBe(200);
    expect(runs().at(-1)?.slice(-3)).toEqual(["-I", "31:45", "ytsearch45:never gonna"]);
    for (const page of ["-1", "1.5", "10", "x"]) expect((await api(`/api/web/search?q=a&page=${page}`)).status).toBe(400);

    expect((await api("/api/web/search?q=%20")).status).toBe(400);
    expect((await api(`/api/web/search?q=${"a".repeat(201)}`)).status).toBe(400);
  });

  it("looks up a pasted link", async () => {
    const res = await api(`/api/web/resolve?url=${q(TIKTOK)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: TIKTOK, title: "dance", channel: "someone", site: "TikTok" });
    // The link comes after "--", so it can never be read as a flag.
    expect(runs().at(-1)?.slice(-2)).toEqual(["--", TIKTOK]);

    const unsupported = await api(`/api/web/resolve?url=${q("https://example.com/unsupported")}`);
    expect(unsupported.status).toBe(400);
    expect(await errorOf(unsupported)).toMatch(/isn't supported/);
    expect((await api("/api/web/resolve?url=not%20a%20link")).status).toBe(400);
  });

  it("downloads a clip's audio once and serves it with range support", async () => {
    // A different form of the same YouTube link shares the download.
    for (const link of [RICK, "https://youtu.be/dQw4w9WgXcQ"]) {
      const res = await api(`/api/web/audio?url=${q(link)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mp4");
      await res.arrayBuffer();
    }

    const partial = await api(`/api/web/audio?url=${q(RICK)}`, { headers: { Range: "bytes=0-9" } });
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(10);

    expect(downloads()).toHaveLength(1);
    expect(readdirSync(path.join(dataDir, "music"))).toEqual(["dQw4w9WgXcQ.m4a"]);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });

  it("imports a clip's audio into a project's media from the cache", async () => {
    const res = await post("/api/web/import", { projectId: project.id, url: RICK, title: "AC/DC - Thunderstruck", kind: "audio" });
    expect(res.status).toBe(201);
    const asset = (await res.json()) as MediaAsset;
    expect(asset).toMatchObject({
      projectId: project.id,
      name: "AC-DC - Thunderstruck.m4a",
      kind: "audio",
      hasAudio: true,
      hasVideo: false,
    });
    expect(asset.duration).toBeGreaterThan(1.9);
    expect(downloads()).toHaveLength(1);

    const media = (await (await api(`/api/media?projectId=${project.id}`)).json()) as MediaAsset[];
    expect(media.map((a) => a.id)).toEqual([asset.id]);
    // The cached copy stays for next time.
    expect(readdirSync(path.join(dataDir, "music"))).toEqual(["dQw4w9WgXcQ.m4a"]);
  });

  it("imports a whole video straight into a project's media", async () => {
    const res = await post("/api/web/import", { projectId: project.id, url: TIKTOK, title: "dance", kind: "video" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "dance.mp4", kind: "video", hasVideo: true, hasAudio: true, width: 180, height: 320 });
    const argv = downloads().at(-1)!;
    expect(argv).toContain("--merge-output-format");
    expect(argv.slice(-2)).toEqual(["--", TIKTOK]);
    // Videos aren't cached.
    expect(readdirSync(path.join(dataDir, "music"))).toEqual(["dQw4w9WgXcQ.m4a"]);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });

  it("downloads a link's picture into a Library folder (the visualizer's), once", async () => {
    const folder = (await (await post("/api/library/folders", { name: "Visualizer" })).json()) as { id: string };
    const url = "https://www.tiktok.com/@someone/video/7300000000000000009";
    const res = await post("/api/library/items/web", { url, folderId: folder.id, title: "dance" });
    expect(res.status).toBe(201);
    const { item, media } = (await res.json()) as { item: { id: string; folderId: string; mediaId: string }; media: MediaAsset[] };
    expect(item.folderId).toBe(folder.id);
    expect(media[0]).toMatchObject({ id: item.mediaId, kind: "video", hasVideo: true });
    expect(media[0].origin).toMatch(/^web:video:x[0-9a-f]{16}$/);
    // The picture only, up to 720p: it plays muted, drawn at 720p.
    const argv = downloads().at(-1)!;
    expect(argv.join(" ")).toContain("bv*/b");
    expect(argv.join(" ")).toContain("res:720");
    expect(argv).not.toContain("--download-sections");
    // Again: the one it has, no download.
    const count = downloads().length;
    const again = (await (await post("/api/library/items/web", { url, folderId: folder.id })).json()) as { item: { id: string } };
    expect(again.item.id).toBe(item.id);
    expect(downloads().length).toBe(count);
    // A long one: only its first minutes.
    await post("/api/library/items/web", { url: url.replace(/9$/, "8"), folderId: folder.id, most: 240 });
    const long = downloads().at(-1)!;
    expect(long.slice(long.indexOf("--download-sections"), long.indexOf("--download-sections") + 2)).toEqual(["--download-sections", "*0-240"]);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
    expect((await post("/api/library/items/web", { url: "nope", folderId: folder.id })).status).toBe(400);
  });

  it("reports a download's progress while it runs", async () => {
    const url = "https://www.tiktok.com/@someone/video/7300000000000000001?slow=1";
    const progress = async () =>
      (await (await api(`/api/web/progress?url=${q(url)}&kind=video`)).json()) as WebDownloadProgress;
    expect(await progress()).toEqual({ status: "waiting", progress: null });

    const importing = post("/api/web/import", { projectId: project.id, url, title: "slow", kind: "video" });
    await expect.poll(progress).toEqual({ status: "downloading", progress: 150 / 400 });
    // Another kind of the same link isn't this download.
    expect(await (await api(`/api/web/progress?url=${q(url)}&kind=audio`)).json()).toEqual({ status: "waiting", progress: null });

    writeFileSync(process.env.FAKE_RELEASE!, "");
    expect((await importing).status).toBe(201);
    expect(await progress()).toEqual({ status: "waiting", progress: null });
    expect((await api(`/api/web/progress?url=${q(url)}&kind=gif`)).status).toBe(400);
  });

  it("downloads concurrent requests for the same audio once", async () => {
    const url = "https://www.youtube.com/watch?v=oHg5SJYRHA0";
    const results = await Promise.all(
      [0, 1, 2].map(() => post("/api/web/import", { projectId: project.id, url, title: "Song", kind: "audio" })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(downloads().filter((argv) => argv.at(-1) === url)).toHaveLength(1);
  });

  it("rejects bad requests and reports download failures", async () => {
    expect((await api("/api/web/audio?url=nope")).status).toBe(400);
    expect((await post("/api/web/import", { url: RICK, kind: "audio" })).status).toBe(400);
    expect((await post("/api/web/import", { projectId: project.id, url: RICK, kind: "gif" })).status).toBe(400);
    expect((await post("/api/web/import", { projectId: project.id, url: "file:///etc/passwd", kind: "video" })).status).toBe(400);
    expect(
      (await post("/api/web/import", { projectId: "project_000000000000", url: RICK, title: "x", kind: "audio" })).status,
    ).toBe(404);

    const blocked = await post("/api/web/import", {
      projectId: project.id,
      url: "https://www.youtube.com/watch?v=blocked0000",
      title: "x",
      kind: "video",
    });
    expect(blocked.status).toBe(502);
    expect(await errorOf(blocked)).toMatch(/blocked the download.*brew upgrade yt-dlp/);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });

  it("gives a project the copy it has of a link's audio, rather than another", async () => {
    const media = async () => (await (await api(`/api/media?projectId=${project.id}`)).json()) as MediaAsset[];
    const before = (await media()).length;
    const again = await post("/api/web/import", { projectId: project.id, url: "https://youtu.be/dQw4w9WgXcQ", title: "Another name", kind: "audio" });
    expect(again.status).toBe(201);
    expect(((await again.json()) as MediaAsset).name).toBe("AC-DC - Thunderstruck.m4a");
    expect((await media()).length).toBe(before);
  });

  it("names media after its link's title when none is given, and keeps audio the engine can't read as a WAV", async () => {
    const res = await post("/api/web/import", { projectId: project.id, url: "https://www.youtube.com/watch?v=webmwebmweb", kind: "audio" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "dance.wav", kind: "audio", hasAudio: true });
    expect(readdirSync(path.join(dataDir, "music"))).toContain("webmwebmweb.wav");
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });
});
