import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MediaAsset, MusicTrack, ProjectSummary } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";
import { FFMPEG, FFPROBE } from "./config.ts";
import { musicError, parseSearchResults } from "./music.ts";
import { HttpError } from "./storage.ts";

describe("parseSearchResults", () => {
  it("maps yt-dlp's flat search output to tracks", () => {
    const json = JSON.stringify({
      entries: [
        { id: "fHI8X4OXluQ", title: " The Weeknd - Blinding Lights ", channel: "The Weeknd", duration: 204, channel_is_verified: true },
        { id: "XwxLwG2_Sxk", title: "Lyrics", channel: null, uploader: "7clouds", duration: 200.5 },
      ],
    });
    expect(parseSearchResults(json)).toEqual<MusicTrack[]>([
      {
        id: "fHI8X4OXluQ",
        title: "The Weeknd - Blinding Lights",
        channel: "The Weeknd",
        duration: 204,
        thumbnail: "https://i.ytimg.com/vi/fHI8X4OXluQ/mqdefault.jpg",
        verified: true,
      },
      {
        id: "XwxLwG2_Sxk",
        title: "Lyrics",
        channel: "7clouds",
        duration: 200.5,
        thumbnail: "https://i.ytimg.com/vi/XwxLwG2_Sxk/mqdefault.jpg",
        verified: false,
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

describe("musicError", () => {
  it("turns yt-dlp failures into actionable messages", () => {
    const blocked = musicError(new Error("ERROR: [youtube] abc: unable to download video data: HTTP Error 403: Forbidden"), "download");
    expect(blocked.status).toBe(502);
    expect(blocked.message).toMatch(/brew upgrade yt-dlp/);

    const missing = musicError(new Error("/opt/bin/yt-dlp not found — is it installed?"), "search");
    expect(missing.status).toBe(503);
    expect(missing.message).toMatch(/brew install yt-dlp/);

    const unavailable = musicError(new Error("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable"), "download");
    expect(unavailable.message).toBe("The download failed: This video is unavailable");

    const timeout = musicError(new DOMException("timed out", "TimeoutError"), "search");
    expect(timeout.status).toBe(504);

    const own = new HttpError(400, "nope");
    expect(musicError(own, "search")).toBe(own);
  });
});

const ffmpegAvailable =
  spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

/**
 * Stands in for yt-dlp: searches return two songs, downloads copy a fixture tone,
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
const id = args[args.length - 1].split("v=")[1];
if (id === "blocked0000") {
  console.error("ERROR: [youtube] blocked0000: unable to download video data: HTTP Error 403: Forbidden");
  process.exit(1);
}
const dir = args[args.indexOf("-P") + 1];
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, id + ".m4a");
fs.copyFileSync(process.env.FAKE_FIXTURE, out);
console.log(out);
`;

describe.skipIf(!ffmpegAvailable)("music routes (fake yt-dlp)", () => {
  let tmp: string;
  let dataDir: string;
  let log: string;
  let editor: EditorApp;
  let server: http.Server;
  let base: string;
  let project: ProjectSummary;

  const api = (p: string, init?: RequestInit) => fetch(base + p, init);
  const post = (p: string, body: unknown) =>
    api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
  /** yt-dlp runs so far, as argv arrays. */
  const runs = () =>
    readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
  const downloads = () => runs().filter((argv) => !argv.includes("--flat-playlist"));

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-music-test-"));
    dataDir = path.join(tmp, "data");
    log = path.join(tmp, "ytdlp.log");
    writeFileSync(log, "");
    const fixture = path.join(tmp, "song.m4a");
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", fixture]);
    const fake = path.join(tmp, "yt-dlp");
    writeFileSync(fake, FAKE_YTDLP);
    chmodSync(fake, 0o755);
    process.env.FAKE_LOG = log;
    process.env.FAKE_FIXTURE = fixture;

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
    const res = await api("/api/music/search?q=%20never%20%20gonna%20");
    expect(res.status).toBe(200);
    const tracks = (await res.json()) as MusicTrack[];
    expect(tracks.map((t) => t.id)).toEqual(["dQw4w9WgXcQ"]);
    // The query goes to yt-dlp as one normalised argument, never a flag.
    expect(runs().at(-1)?.at(-1)).toBe("ytsearch15:never gonna");

    expect((await api("/api/music/search?q=%20")).status).toBe(400);
    expect((await api(`/api/music/search?q=${"a".repeat(201)}`)).status).toBe(400);
  });

  it("downloads a track once and serves it with range support", async () => {
    const res = await api("/api/music/dQw4w9WgXcQ/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mp4");
    await res.arrayBuffer();

    const partial = await api("/api/music/dQw4w9WgXcQ/audio", { headers: { Range: "bytes=0-9" } });
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(10);

    expect(downloads()).toHaveLength(1);
    expect(readdirSync(path.join(dataDir, "music"))).toEqual(["dQw4w9WgXcQ.m4a"]);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });

  it("imports a track into a project's media from the cache", async () => {
    const res = await post("/api/music/import", {
      projectId: project.id,
      trackId: "dQw4w9WgXcQ",
      title: "AC/DC - Thunderstruck",
    });
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

  it("downloads concurrent requests for the same track once", async () => {
    const results = await Promise.all(
      [0, 1, 2].map(() => post("/api/music/import", { projectId: project.id, trackId: "oHg5SJYRHA0", title: "Song" })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(downloads().filter((argv) => argv.at(-1)?.endsWith("oHg5SJYRHA0"))).toHaveLength(1);
  });

  it("rejects bad requests and reports download failures", async () => {
    expect((await api("/api/music/nope/audio")).status).toBe(400);
    expect((await post("/api/music/import", { trackId: "dQw4w9WgXcQ" })).status).toBe(400);
    expect(
      (await post("/api/music/import", { projectId: "project_000000000000", trackId: "dQw4w9WgXcQ", title: "x" })).status,
    ).toBe(404);

    const blocked = await post("/api/music/import", { projectId: project.id, trackId: "blocked0000", title: "x" });
    expect(blocked.status).toBe(502);
    expect(await errorOf(blocked)).toMatch(/YouTube blocked the download.*brew upgrade yt-dlp/);
    expect(readdirSync(path.join(dataDir, "tmp"))).toEqual([]);
  });
});
