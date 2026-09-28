import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDefaultProject } from "../shared/timeline.ts";
import type { Clip, ExportJob, MediaAsset, Project, WaveformData } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";
import { FFMPEG, FFPROBE } from "./config.ts";

const ffmpegAvailable =
  spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

const ffmpeg = (...args: string[]) =>
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args]);

function probe(file: string) {
  const out = execFileSync(FFPROBE, [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  return JSON.parse(out.toString()) as {
    format: { duration: string };
    streams: { codec_type: string; width?: number; height?: number }[];
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await sleep(100);
  }
}

describe.skipIf(!ffmpegAvailable)("server (integration)", () => {
  let tmp: string;
  let dataDir: string;
  let editor: EditorApp;
  let server: http.Server;
  let base: string;
  const fixtures: Record<string, string> = {};
  const assets: Record<string, MediaAsset> = {};

  const api = (p: string, init?: RequestInit) => fetch(base + p, init);
  const json = <T>(p: string, init?: RequestInit) => api(p, init).then((r) => r.json() as Promise<T>);
  const upload = (file: string, name = path.basename(file)) =>
    api(`/api/media?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: readFileSync(file),
    });
  const sendJson = (method: string, p: string, body: unknown) =>
    api(p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const clip = (asset: string, trackId: string, start: number, inPoint: number, out: number): Clip => ({
    id: `clip_${Math.random().toString(16).slice(2, 10)}`,
    assetId: assets[asset].id, trackId, start, in: inPoint, out, volume: 1, fit: "contain",
  });
  const projectWith = (clips: Clip[]): Project => ({ ...createDefaultProject(), clips });
  const waitForExport = (id: string) =>
    until(async () => {
      const job = await json<ExportJob>(`/api/exports/${id}`);
      return job.status === "queued" || job.status === "rendering" ? undefined : job;
    }, 40_000);

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-test-"));
    dataDir = path.join(tmp, "data");
    const f = (name: string) => (fixtures[name] = path.join(tmp, name));
    const tone = (hz: number, secs: number) => ["-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${secs}`];
    // 2s landscape with audio
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2", ...tone(440, 2),
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f("landscape.mp4"));
    // 1.5s, no audio, stored landscape but flagged as rotated 90° (like a phone clip)
    const plain = path.join(tmp, "plain.mp4");
    ffmpeg("-f", "lavfi", "-i", "smptebars=size=320x180:rate=25:duration=1.5",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", plain);
    ffmpeg("-display_rotation", "90", "-i", plain, "-c", "copy", f("portrait.mov"));
    // 3s audio only
    ffmpeg(...tone(660, 3), "-c:a", "aac", f("tone.m4a"));
    // Valid video that browsers can't play (MPEG-4 Part 2 in AVI)
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=1", "-c:v", "mpeg4", f("legacy.avi"));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=64x64", "-frames:v", "1", f("still.png"));
    writeFileSync(f("notes.txt"), "definitely not a video");

    editor = await createApp({ dataDir });
    server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    editor?.shutdown();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("reports ffmpeg in /api/health", async () => {
    const health = await json<{ ok: boolean; ffmpeg: { available: boolean; version: string } }>("/api/health");
    expect(health.ok).toBe(true);
    expect(health.ffmpeg.available).toBe(true);
    expect(health.ffmpeg.version).toMatch(/\d/);
  });

  it("ingests video and audio and probes them", async () => {
    for (const [key, file] of [["landscape", "landscape.mp4"], ["portrait", "portrait.mov"], ["tone", "tone.m4a"]]) {
      const res = await upload(fixtures[file]);
      expect(res.status).toBe(201);
      assets[key] = (await res.json()) as MediaAsset;
    }
    const { landscape, portrait, tone } = assets;

    expect(landscape).toMatchObject({
      name: "landscape.mp4", kind: "video", width: 320, height: 180, fps: 30,
      hasVideo: true, hasAudio: true, status: "processing", filmstrip: null, waveform: null,
    });
    expect(landscape.duration).toBeCloseTo(2, 1);
    expect(landscape.src).toBe(`/files/media/${landscape.id}/source.mp4`);
    expect(landscape.poster).toBe(`/files/media/${landscape.id}/poster.jpg`);

    // Rotation metadata is applied: the clip displays as portrait.
    expect(portrait).toMatchObject({ kind: "video", width: 180, height: 320, fps: 25, hasAudio: false });
    expect(portrait.src.endsWith("/source.mov")).toBe(true);

    expect(tone).toMatchObject({ kind: "audio", width: null, height: null, fps: null, hasVideo: false, hasAudio: true, poster: null });
    expect(tone.duration).toBeCloseTo(3, 1);

    const list = await json<MediaAsset[]>("/api/media");
    expect(list.map((a) => a.id)).toEqual([tone.id, portrait.id, landscape.id]);
  });

  it("rejects images, unpreviewable codecs and non-media with 415", async () => {
    const image = await upload(fixtures["still.png"]);
    expect(image.status).toBe(415);
    expect(((await image.json()) as { error: string }).error).toMatch(/Images aren't supported/);
    const legacy = await upload(fixtures["legacy.avi"]);
    expect(legacy.status).toBe(415);
    expect(((await legacy.json()) as { error: string }).error).toMatch(/preview can't play/);
    const text = await upload(fixtures["notes.txt"]);
    expect(text.status).toBe(415);
    expect(((await text.json()) as { error: string }).error).toBeTruthy();
  });

  it("cleans up after an aborted upload", async () => {
    const { port } = new URL(base);
    await new Promise<void>((resolve) => {
      const req = http.request({ port, host: "127.0.0.1", method: "POST", path: "/api/media?name=x.mp4", headers: { "Content-Length": "1000000" } });
      req.on("error", () => resolve());
      req.write(Buffer.alloc(1000), () => setTimeout(() => (req.destroy(), resolve()), 100));
    });
    await until(async () => (readdirSync(path.join(dataDir, "tmp")).length === 0 ? true : undefined), 5000);
  });

  it("generates filmstrips and waveforms in the background", async () => {
    for (const key of ["landscape", "portrait", "tone"]) {
      assets[key] = await until(async () => {
        const a = await json<MediaAsset>(`/api/media/${assets[key].id}`);
        return a.status === "processing" ? undefined : a;
      });
      expect(assets[key].status).toBe("ready");
    }
    const { landscape, portrait, tone } = assets;

    expect(landscape.filmstrip).toEqual({
      count: 2, width: 160, height: 90, urlPattern: `/files/media/${landscape.id}/frames/{i}.jpg`,
    });
    expect(portrait.filmstrip).toMatchObject({ count: 2, width: 50, height: 90 });
    expect(tone.filmstrip).toBeNull();
    expect(portrait.waveform).toBeNull();

    const frame = await api(landscape.filmstrip!.urlPattern.replace("{i}", "002"));
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");

    const wave = await json<WaveformData>(tone.waveform!);
    expect(wave.peaksPerSecond).toBe(50);
    expect(wave.peaks.length).toBeGreaterThanOrEqual(148);
    expect(wave.peaks.length).toBeLessThanOrEqual(152);
    expect(Math.max(...wave.peaks)).toBe(1);
    expect(wave.peaks.every((p) => p >= 0 && p <= 1)).toBe(true);
  });

  it("serves media with range support", async () => {
    const res = await api(assets.landscape.src, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    const mov = await api(assets.portrait.src, { method: "HEAD" });
    expect(mov.headers.get("content-type")).toBe("video/quicktime");
    expect((await api(`/files/media/${assets.tone.id}/meta.json`)).headers.get("cache-control")).toBe("no-cache");
    expect((await api("/files/project.json")).status).toBe(404);
    expect((await api("/files/media/../project.json")).status).toBe(404);
  });

  it("saves and normalises the project", async () => {
    expect((await json<Project>("/api/project")).clips).toEqual([]);
    const saved = projectWith([
      clip("landscape", "main", 5, 0, 1),
      clip("portrait", "main", 9, 0, 99), // out past the source: clamped
      { ...clip("landscape", "main", 0, 0, 1), assetId: "media_000000000000" }, // unknown asset: dropped
      clip("tone", "audio_1", 0.5, 0, 2),
    ]);
    expect((await sendJson("PUT", "/api/project", saved)).status).toBe(204);
    const loaded = await json<Project>("/api/project");
    expect(loaded.clips.map((c) => [c.trackId, c.start, c.in])).toEqual([
      ["main", 0, 0],
      ["main", 1, 0],
      ["audio_1", 0.5, 0],
    ]);
    expect(loaded.clips[1].out).toBeCloseTo(assets.portrait.duration, 5);
    expect((await sendJson("PUT", "/api/project", [1, 2])).status).toBe(400);
    const bad = await api("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("validates export requests", async () => {
    expect((await sendJson("POST", "/api/exports", { project: projectWith([]), resolution: "720p" })).status).toBe(400);
    expect((await sendJson("POST", "/api/exports", { project: projectWith([clip("landscape", "main", 0, 0, 1)]), resolution: "8k" })).status).toBe(400);
    const missing = { ...clip("landscape", "main", 0, 0, 1), assetId: "media_000000000000" };
    const res = await sendJson("POST", "/api/exports", { project: projectWith([missing]), resolution: "720p" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/no longer in the library/);
    expect((await api("/api/exports/export_000000000000")).status).toBe(404);
  });

  it("exports a timeline with trimmed, silent and audio-track clips", async () => {
    // main: landscape [0.5, 1.5) + portrait (no audio, 1.5s) = 2.5s; tone on an audio track runs to 4s.
    const project = projectWith([
      clip("landscape", "main", 0, 0.5, 1.5),
      clip("portrait", "main", 1, 0, assets.portrait.duration),
      clip("tone", "audio_1", 1, 0, 3),
    ]);
    const res = await sendJson("POST", "/api/exports", { project, resolution: "720p", fileName: "My: cut/1" });
    expect(res.status).toBe(202);
    const queued = (await res.json()) as ExportJob;
    expect(queued).toMatchObject({ width: 720, height: 1280, duration: 4, fileName: "My cut 1", url: null });

    const job = await waitForExport(queued.id);
    expect(job.status).toBe("done");
    expect(job.progress).toBe(1);
    expect(job.url).toBe(`/files/exports/${job.id}.mp4`);

    const output = path.join(dataDir, "exports", `${job.id}.mp4`);
    const info = probe(output);
    const video = info.streams.find((s) => s.codec_type === "video");
    expect(video).toMatchObject({ width: 720, height: 1280 });
    expect(info.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(Math.abs(Number(info.format.duration) - 4)).toBeLessThan(2 / 30);

    const download = await api(job.downloadUrl!);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="My cut 1\.mp4"/);
    await download.arrayBuffer();
  });

  it("cancels queued and running exports", async () => {
    const long = projectWith(
      Array.from({ length: 8 }, (_, i) => clip("landscape", "main", i * 2, 0, 2)),
    );
    const start = async () =>
      (await (await sendJson("POST", "/api/exports", { project: long, resolution: "4k" })).json()) as ExportJob;
    const running = await start();
    const queued = await start();
    // Wait until ffmpeg has reported progress, so cancelling really kills a live process.
    await until(async () => {
      const job = await json<ExportJob>(`/api/exports/${running.id}`);
      return job.status === "rendering" && job.progress > 0 ? true : undefined;
    });
    expect((await json<ExportJob>(`/api/exports/${queued.id}`)).status).toBe("queued");

    expect((await api(`/api/exports/${queued.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/exports/${running.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await json<ExportJob>(`/api/exports/${running.id}`)).status).toBe("cancelled");
    expect((await json<ExportJob>(`/api/exports/${queued.id}`)).status).toBe("cancelled");
    expect((await api(`/api/exports/${running.id}/download`)).status).toBe(409);

    await until(async () => (readdirSync(path.join(dataDir, "tmp")).length === 0 ? true : undefined), 5000);
    expect(existsSync(path.join(dataDir, "exports", `${running.id}.mp4`))).toBe(false);
  });

  it("deletes media", async () => {
    const { id } = assets.tone;
    expect((await api(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/media/${id}`)).status).toBe(404);
    expect((await api(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await api("/api/media/..%2F..%2Fetc")).status).toBe(404);
    expect(existsSync(path.join(dataDir, "media", id))).toBe(false);
  });
});
