import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultEffects, textEffects } from "../shared/effects.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import type {
  Clip,
  ExportJob,
  Library,
  LibraryEntry,
  LibraryFolder,
  LibraryItem,
  UseLibraryItemResponse,
  MediaAsset,
  ParamValues,
  Project,
  ProjectSummary,
  WaveformData,
} from "../shared/types.ts";
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
    streams: { codec_type: string; width?: number; height?: number; color_space?: string; color_range?: string }[];
  };
}

/** A JPEG with an EXIF segment saying to show it rotated (orientation 6 = 90° clockwise), like a phone photo. */
function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  // Big-endian TIFF header, then IFD0 with one SHORT entry: 0x0112 Orientation.
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, payload, jpeg.subarray(2)]);
}

/** The RGB colour of one pixel of a video frame. */
function pixelAt(file: string, time: number, x: number, y: number): [number, number, number] {
  const out = execFileSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(time), "-i", file,
    "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [out[0], out[1], out[2]];
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
  /** `main` holds the fixtures used by most tests; `other` checks scoping and deletion. */
  const projects: Record<"main" | "other", ProjectSummary> = {} as never;

  const api = (p: string, init?: RequestInit) => fetch(base + p, init);
  const json = <T>(p: string, init?: RequestInit) => api(p, init).then((r) => r.json() as Promise<T>);
  const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;
  const upload = (file: string, projectId = projects.main.id, name = path.basename(file)) =>
    api(`/api/media?projectId=${projectId}&name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: readFileSync(file),
    });
  const sendJson = (method: string, p: string, body: unknown) =>
    api(p, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const clip = (asset: string, trackId: string, start: number, inPoint: number, out: number): Clip => ({
    id: `clip_${Math.random().toString(16).slice(2, 10)}`,
    assetId: assets[asset].id, trackId, start, in: inPoint, out, effects: defaultEffects(),
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
    // A solid red 2:1 image, easy to find in an export.
    ffmpeg("-f", "lavfi", "-i", "color=red:size=100x50", "-frames:v", "1", f("red.png"));
    ffmpeg("-f", "lavfi", "-i", "color=blue:size=100x50", "-frames:v", "1", f("blue.png"));
    // One colour (#3080c0) stored three ways: tagged BT.709, untagged HD (BT.709 by convention), untagged SD (BT.601).
    const teal = (size: string, matrix: string, tags: string[], file: string) =>
      ffmpeg("-f", "lavfi", "-i", `color=c=0x3080c0:size=${size}:rate=30:duration=1`,
        "-vf", `scale=out_color_matrix=${matrix}:out_range=tv,format=yuv420p`,
        "-c:v", "libx264", "-preset", "ultrafast", ...tags, f(file));
    teal("1280x720", "bt709", ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"], "teal-709.mp4");
    teal("1280x720", "bt709", [], "teal-hd.mp4");
    teal("320x240", "bt601", [], "teal-sd.mp4");
    // (Seeking into this one finds no frame, so stills must be read without seeking.)
    const jpeg = path.join(tmp, "plain.jpg");
    ffmpeg("-f", "lavfi", "-i", "mandelbrot=size=320x160", "-frames:v", "1", jpeg);
    writeFileSync(f("photo.jpg"), withExifOrientation(readFileSync(jpeg), 6));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=64x64:rate=10:duration=1", f("anim.gif"));
    ffmpeg("-f", "lavfi", "-i", "testsrc2=size=64x64", "-frames:v", "1", f("still.tiff"));
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

  it("starts without projects and without the legacy endpoint", async () => {
    expect(await json<ProjectSummary[]>("/api/projects")).toEqual([]);
    expect((await api("/api/project")).status).toBe(404);
  });

  it("creates projects", async () => {
    const res = await sendJson("POST", "/api/projects", {});
    expect(res.status).toBe(201);
    projects.main = (await res.json()) as ProjectSummary;
    expect(projects.main).toMatchObject({
      name: "Untitled", status: "active", settledAt: null,
      aspectRatio: "9:16", duration: 0, clipCount: 0, thumbnail: null,
    });
    expect(projects.main.id).toMatch(/^project_[0-9a-f]{12}$/);
    expect(projects.main.updatedAt).toBe(projects.main.createdAt);

    projects.other = (await (await sendJson("POST", "/api/projects", { name: "  B-roll\n " })).json()) as ProjectSummary;
    expect(projects.other.name).toBe("B-roll");
    expect((await api("/api/projects", { method: "POST" })).status).toBe(201); // body is optional

    const doc = await json<Project>(`/api/projects/${projects.other.id}`);
    expect(doc).toEqual({ ...createDefaultProject(), name: "B-roll" });

    for (const body of [{ name: 5 }, { name: "   " }, [1]]) {
      expect((await sendJson("POST", "/api/projects", body)).status).toBe(400);
    }
    const list = await json<ProjectSummary[]>("/api/projects");
    expect(list).toHaveLength(3);
    expect(list[1].id).toBe(projects.other.id); // newest first
    await api(`/api/projects/${list[0].id}`, { method: "DELETE" });
  });

  it("returns 404 for unknown projects", async () => {
    for (const id of ["project_000000000000", "..%2Fmedia"]) {
      for (const [method, body] of [["GET"], ["PUT", createDefaultProject()], ["PATCH", { name: "x" }], ["DELETE"]] as const) {
        const res = body ? await sendJson(method, `/api/projects/${id}`, body) : await api(`/api/projects/${id}`, { method });
        expect(res.status, `${method} ${id}`).toBe(404);
        expect(await errorOf(res)).toBe("Project not found");
      }
    }
  });

  it("ingests video and audio and probes them", async () => {
    for (const [key, file] of [["landscape", "landscape.mp4"], ["portrait", "portrait.mov"], ["tone", "tone.m4a"]]) {
      const res = await upload(fixtures[file]);
      expect(res.status).toBe(201);
      assets[key] = (await res.json()) as MediaAsset;
    }
    const { landscape, portrait, tone } = assets;

    expect(landscape).toMatchObject({
      projectId: projects.main.id,
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

    const list = await json<MediaAsset[]>(`/api/media?projectId=${projects.main.id}`);
    expect(list.map((a) => a.id)).toEqual([tone.id, portrait.id, landscape.id]);
  });

  it("scopes media to its project", async () => {
    const res = await upload(fixtures["tone.m4a"], projects.other.id, "other.m4a");
    expect(res.status).toBe(201);
    assets.other = (await res.json()) as MediaAsset;
    expect(assets.other.projectId).toBe(projects.other.id);

    const ids = async (projectId: string) =>
      (await json<MediaAsset[]>(`/api/media?projectId=${projectId}`)).map((a) => a.id);
    expect(await ids(projects.other.id)).toEqual([assets.other.id]);
    expect(await ids(projects.main.id)).not.toContain(assets.other.id);

    expect((await api("/api/media")).status).toBe(400);
    expect((await api("/api/media?projectId=project_000000000000")).status).toBe(404);
  });

  it("rejects uploads to unknown projects", async () => {
    for (const projectId of ["project_000000000000", ""]) {
      const res = await upload(fixtures["tone.m4a"], projectId);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toBe("Project not found");
    }
    expect(readdirSync(path.join(dataDir, "media"))).toHaveLength(4);
    await until(async () => (readdirSync(path.join(dataDir, "tmp")).length === 0 ? true : undefined), 5000);
  });

  it("imports still images, upright as they display", async () => {
    for (const [key, file] of [["still", "still.png"], ["red", "red.png"], ["blue", "blue.png"], ["photo", "photo.jpg"]]) {
      const res = await upload(fixtures[file]);
      expect(res.status).toBe(201);
      assets[key] = (await res.json()) as MediaAsset;
    }
    const { still, photo } = assets;
    // Nothing to generate in the background: the poster is the thumbnail.
    expect(still).toMatchObject({
      kind: "image", width: 64, height: 64, duration: 5, fps: null, hasVideo: true, hasAudio: false,
      status: "ready", filmstrip: null, waveform: null, poster: `/files/media/${still.id}/poster.png`,
    });
    expect(still.src).toBe(`/files/media/${still.id}/source.png`);
    // Stored 320x160, but EXIF says to show it turned a quarter (browsers and ffmpeg both do).
    expect(photo).toMatchObject({ kind: "image", width: 160, height: 320 });
    expect(photo.src.endsWith("/source.jpg")).toBe(true);
    expect((await api(still.poster!)).status).toBe(200);
  });

  it("rejects animated images, unsupported formats and codecs, and non-media with 415", async () => {
    const gif = await upload(fixtures["anim.gif"]);
    expect(gif.status).toBe(415);
    expect(await errorOf(gif)).toMatch(/Animated images aren't supported/);
    const tiff = await upload(fixtures["still.tiff"]);
    expect(tiff.status).toBe(415);
    expect(await errorOf(tiff)).toMatch(/Use PNG, JPEG or WebP/);
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
      const req = http.request({ port, host: "127.0.0.1", method: "POST", path: `/api/media?projectId=${projects.main.id}&name=x.mp4`, headers: { "Content-Length": "1000000" } });
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

  it("saves and normalises a project against its own media", async () => {
    const url = `/api/projects/${projects.main.id}`;
    expect((await json<Project>(url)).clips).toEqual([]);
    const saved = projectWith([
      clip("landscape", "main", 5, 0, 1),
      clip("portrait", "main", 9, 0, 99), // out past the source: clamped
      { ...clip("landscape", "main", 0, 0, 1), assetId: "media_000000000000" }, // unknown asset: dropped
      clip("other", "audio_1", 0, 0, 1), // another project's media: dropped
      clip("tone", "audio_1", 0.5, 0, 2),
    ]);
    const res = await sendJson("PUT", url, { ...saved, settings: { ...saved.settings, aspectRatio: "16:9" } });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as ProjectSummary;
    expect(summary).toMatchObject({
      id: projects.main.id, name: "Untitled", status: "active", aspectRatio: "16:9",
      clipCount: 3, thumbnail: assets.landscape.poster,
    });
    expect(summary.duration).toBeCloseTo(9 + assets.portrait.duration, 5);
    expect(summary.updatedAt).toBeGreaterThan(projects.main.updatedAt);
    projects.main = summary;

    const loaded = await json<Project>(url);
    // Clips keep their positions (gaps are allowed), in time order.
    expect(loaded.clips.map((c) => [c.trackId, c.start, c.in])).toEqual([
      ["audio_1", 0.5, 0],
      ["main", 5, 0],
      ["main", 9, 0],
    ]);
    expect(loaded.clips[2].out).toBeCloseTo(assets.portrait.duration, 5);
    expect((await sendJson("PUT", url, [1, 2])).status).toBe(400);
    const bad = await api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{nope" });
    expect(bad.status).toBe(400);
  });

  it("lists the most recently updated project first", async () => {
    const order = async () => (await json<ProjectSummary[]>("/api/projects")).map((p) => p.id);
    expect(await order()).toEqual([projects.main.id, projects.other.id]);
    const res = await sendJson("PUT", `/api/projects/${projects.other.id}`, projectWith([clip("other", "audio_1", 0, 0, 1)]));
    projects.other = (await res.json()) as ProjectSummary;
    expect(projects.other).toMatchObject({ clipCount: 1, thumbnail: null }); // nothing on a video track
    expect(await order()).toEqual([projects.other.id, projects.main.id]);
  });

  it("renames, settles and unsettles projects", async () => {
    const url = `/api/projects/${projects.main.id}`;
    const patch = async (body: unknown) => {
      const res = await sendJson("PATCH", url, body);
      expect(res.status).toBe(200);
      return (await res.json()) as ProjectSummary;
    };

    const renamed = await patch({ name: "Launch teaser" });
    expect(renamed.name).toBe("Launch teaser");
    expect(renamed.updatedAt).toBeGreaterThan(projects.main.updatedAt);
    expect((await json<Project>(url)).name).toBe("Launch teaser");

    const before = Date.now();
    const settled = await patch({ status: "settled" });
    expect(settled).toMatchObject({ status: "settled", updatedAt: renamed.updatedAt, clipCount: 3 });
    expect(settled.settledAt).toBeGreaterThanOrEqual(before);
    expect((await patch({ status: "settled" })).settledAt).toBe(settled.settledAt); // already settled

    const reopened = await patch({ status: "active" });
    expect(reopened).toMatchObject({ status: "active", settledAt: null, updatedAt: renamed.updatedAt });
    expect((await json<ProjectSummary[]>("/api/projects"))[0]).toEqual(reopened);

    for (const body of [{}, [], { status: "archived" }, { name: "" }, { name: 1 }, { name: "ok", status: "done" }]) {
      expect((await sendJson("PATCH", url, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await json<Project>(url)).name).toBe("Launch teaser");
  });

  it("duplicates a project with its own copy of the media", async () => {
    const res = await api(`/api/projects/${projects.main.id}/duplicate`, { method: "POST" });
    expect(res.status).toBe(201);
    const copy = (await res.json()) as ProjectSummary;
    expect(copy).toMatchObject({ name: "Launch teaser copy", status: "active", clipCount: 3, aspectRatio: "16:9" });
    expect(copy.id).not.toBe(projects.main.id);
    expect(copy.duration).toBeCloseTo(projects.main.duration, 5);
    expect((await json<ProjectSummary[]>("/api/projects"))[0].id).toBe(copy.id);

    const originals = await json<MediaAsset[]>(`/api/media?projectId=${projects.main.id}`);
    const copies = await json<MediaAsset[]>(`/api/media?projectId=${copy.id}`);
    expect(copies.map((a) => a.name)).toEqual(originals.map((a) => a.name));
    for (const asset of copies) {
      expect(originals.some((a) => a.id === asset.id)).toBe(false);
      for (const url of [asset.src, asset.poster, asset.waveform, asset.filmstrip?.urlPattern]) {
        if (url) expect(url.startsWith(`/files/media/${asset.id}/`), url).toBe(true);
      }
      expect((await api(asset.src)).status).toBe(200);
    }
    expect(copy.thumbnail?.startsWith(`/files/media/${copies.find((a) => a.name === "landscape.mp4")!.id}/`)).toBe(true);

    // The copy's clips point at its own media.
    const doc = await json<Project>(`/api/projects/${copy.id}`);
    expect(doc.clips).toHaveLength(3);
    for (const c of doc.clips) expect(copies.some((a) => a.id === c.assetId)).toBe(true);

    // Deleting the copy leaves the original alone.
    expect((await api(`/api/projects/${copy.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await json<MediaAsset[]>(`/api/media?projectId=${projects.main.id}`)).toEqual(originals);
    expect((await api(originals[0].src)).status).toBe(200);
    expect((await api("/api/projects/project_000000000000/duplicate", { method: "POST" })).status).toBe(404);
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

  it("exports stacked video tracks with gaps", async () => {
    // Top track: portrait from 0.5s; bottom track: landscape, a gap, then landscape again until 3s.
    const project: Project = {
      ...projectWith([
        clip("landscape", "main", 0, 0, 1),
        clip("landscape", "main", 2, 0, 1),
        clip("portrait", "top", 0.5, 0, 1),
      ]),
      tracks: [{ id: "top", kind: "video", name: "Video 2", muted: false }, ...createDefaultProject().tracks],
    };
    const res = await sendJson("POST", "/api/exports", { project, resolution: "720p" });
    expect(res.status).toBe(202);
    const queued = (await res.json()) as ExportJob;
    expect(queued.duration).toBe(3);
    const job = await waitForExport(queued.id);
    expect(job.status).toBe("done");
    const info = probe(path.join(dataDir, "exports", `${job.id}.mp4`));
    expect(Math.abs(Number(info.format.duration) - 3)).toBeLessThan(2 / 30);
  });

  it("exports stills and placed clips where the preview draws them", async () => {
    // 720x1280 canvas; the 100x50 red image fits at 720x360 (centre 360,640).
    const red = (start: number, motion: ParamValues, opacity = 1): Clip => ({
      ...clip("red", "main", start, 0, 1),
      effects: defaultEffects().map((e) =>
        e.type === "motion" ? { ...e, params: { ...e.params, ...motion } }
        : e.type === "opacity" ? { ...e, params: { opacity } }
        : e),
    });
    const project = projectWith([
      // Half size in the top-left quarter: x 0..360, y 230..410.
      red(0, { scale: 0.5, position: [0.25, 0.25] }),
      // Turned a quarter: x 180..540, y 280..1000.
      red(1, { rotation: 90 }),
      // Half transparent over the black canvas.
      red(2, {}, 0.5),
    ]);
    const queued = (await (await sendJson("POST", "/api/exports", { project, resolution: "720p" })).json()) as ExportJob;
    const job = await waitForExport(queued.id);
    expect(job.status).toBe("done");
    const output = path.join(dataDir, "exports", `${job.id}.mp4`);
    const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
    const isBlack = ([r, g, b]: number[]) => r < 30 && g < 30 && b < 30;

    expect(isRed(pixelAt(output, 0.5, 180, 320))).toBe(true);
    expect(isBlack(pixelAt(output, 0.5, 540, 320))).toBe(true);
    expect(isBlack(pixelAt(output, 0.5, 180, 640))).toBe(true);

    expect(isRed(pixelAt(output, 1.5, 360, 300))).toBe(true);
    expect(isBlack(pixelAt(output, 1.5, 100, 640))).toBe(true);

    const [r, g, b] = pixelAt(output, 2.5, 360, 640);
    expect(Math.abs(r - 128)).toBeLessThan(30);
    expect(g + b).toBeLessThan(60);
  });

  it("exports transitions drawn by their shaders", async () => {
    const project = projectWith([
      // Red, then blue with a 1 s cross dissolve centred on the cut at 2 s...
      { ...clip("red", "main", 0, 0, 2), transitionOut: { type: "cross-dissolve", duration: 1, alignment: "center", params: {} } },
      // ...fading into nothing (the black canvas) over its last second.
      { ...clip("blue", "main", 2, 0, 2), transitionOut: { type: "cross-dissolve", duration: 1, alignment: "center", params: {} } },
    ]);
    const queued = (await (await sendJson("POST", "/api/exports", { project, resolution: "720p" })).json()) as ExportJob;
    const job = await waitForExport(queued.id);
    expect(job.error).toBeUndefined();
    expect(job.status).toBe("done");
    const output = path.join(dataDir, "exports", `${job.id}.mp4`);
    const near = (actual: number[], expected: number[]) =>
      actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `${actual} vs ${expected}`).toBeLessThan(40));

    near(pixelAt(output, 1.2, 360, 640), [255, 0, 0]);
    near(pixelAt(output, 2.0, 360, 640), [128, 0, 128]);
    near(pixelAt(output, 2.7, 360, 640), [0, 0, 255]);
    near(pixelAt(output, 3.5, 360, 640), [0, 0, 128]);
    expect(probe(output).format.duration).toMatch(/^4\.0/);
    // The drawn transitions are cleaned up.
    expect(readdirSync(path.join(dataDir, "tmp")).filter((f) => f.endsWith(".mkv"))).toEqual([]);
  });

  it("exports video in its true colours, whatever matrix it's stored in", async () => {
    const ids: string[] = [];
    for (const file of ["teal-709.mp4", "teal-hd.mp4", "teal-sd.mp4"]) {
      const res = await upload(fixtures[file]);
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as MediaAsset).id);
    }
    const project = projectWith(
      ids.map((assetId, i) => ({ ...clip("landscape", "main", i, 0, 1), assetId, effects: defaultEffects() })),
    );
    const queued = (await (await sendJson("POST", "/api/exports", { project, resolution: "720p" })).json()) as ExportJob;
    const job = await waitForExport(queued.id);
    expect(job.error).toBeUndefined();
    const output = path.join(dataDir, "exports", `${job.id}.mp4`);
    expect(probe(output).streams.find((s) => s.codec_type === "video")).toMatchObject({ color_space: "bt709", color_range: "tv" });
    for (const t of [0.5, 1.5, 2.5]) {
      const actual = pixelAt(output, t, 360, 640);
      actual.forEach((v, i) => expect(Math.abs(v - [0x30, 0x80, 0xc0][i]), `${actual} at ${t}s`).toBeLessThanOrEqual(6));
    }
    for (const id of ids) expect((await api(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("exports keyframed motion and volume frame by frame", async () => {
    const key = (time: number, value: number | [number, number]) => ({ time, value, easing: "linear" as const });
    const red = clip("red", "main", 0, 0, 2);
    red.effects = red.effects.map((e) =>
      e.type === "motion" ? { ...e, keyframes: { position: [key(0, [0.25, 0.5]), key(2, [0.75, 0.5])] }, params: { ...e.params, scale: 0.25 } } : e,
    );
    const tone = clip("tone", "audio_1", 0, 0, 2);
    tone.effects = tone.effects.map((e) => (e.type === "volume" ? { ...e, keyframes: { level: [key(0, 0), key(2, 1)] } } : e));
    const queued = (await (await sendJson("POST", "/api/exports", { project: projectWith([red, tone]), resolution: "720p" })).json()) as ExportJob;
    const job = await waitForExport(queued.id);
    expect(job.error).toBeUndefined();
    const output = path.join(dataDir, "exports", `${job.id}.mp4`);
    const isRed = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
    // The quarter-size red box (180 px wide) travels from x = 180 to 540 on the 720 px canvas.
    expect(isRed(pixelAt(output, 0.25, 225, 640))).toBe(true);
    expect(isRed(pixelAt(output, 0.25, 495, 640))).toBe(false);
    expect(isRed(pixelAt(output, 1.75, 495, 640))).toBe(true);
    expect(isRed(pixelAt(output, 1.75, 225, 640))).toBe(false);
    // The tone fades in: its level follows the keyframes.
    const rms = (from: number) => {
      const raw = execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", String(from), "-t", "0.2", "-i", output, "-ac", "1", "-f", "f32le", "-"]);
      const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
      return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    };
    const [early, late] = [rms(0.2), rms(1.6)];
    // The sine (amplitude 1/8) has an RMS of ~0.088 × the gain: ~0.15 at 0.3 s, ~0.85 at 1.7 s.
    expect(late / early).toBeGreaterThan(4);
    expect(late).toBeCloseTo(0.088 * 0.85, 2);
  });

  it("exports without the audio tracks when asked", async () => {
    const project = projectWith([
      clip("landscape", "main", 0, 0, 2),
      clip("tone", "audio_1", 0, 0, 3),
    ]);
    const res = await sendJson("POST", "/api/exports", { project, resolution: "720p", excludeAudioTracks: true });
    expect(res.status).toBe(202);
    const queued = (await res.json()) as ExportJob;
    // The tone ran past the video; without it the export is just the video's 2s.
    expect(queued.duration).toBe(2);
    const job = await waitForExport(queued.id);
    expect(job.status).toBe("done");
    expect(Math.abs(Number(probe(path.join(dataDir, "exports", `${job.id}.mp4`)).format.duration) - 2)).toBeLessThan(2 / 30);

    const musicOnly = projectWith([clip("tone", "audio_1", 0, 0, 3)]);
    const empty = await sendJson("POST", "/api/exports", { project: musicOnly, resolution: "720p", excludeAudioTracks: true });
    expect(empty.status).toBe(400);
    expect(await errorOf(empty)).toMatch(/video track is empty/);
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

  it("deletes a project with its media", async () => {
    const { other } = assets;
    const url = `/api/projects/${projects.other.id}`;
    expect((await api(url, { method: "DELETE" })).status).toBe(204);
    expect((await api(url)).status).toBe(404);
    expect((await api(url, { method: "DELETE" })).status).toBe(404);
    expect((await api(`/api/media/${other.id}`)).status).toBe(404);
    expect(existsSync(path.join(dataDir, "media", other.id))).toBe(false);
    expect(existsSync(path.join(dataDir, "projects", projects.other.id))).toBe(false);
    expect((await json<ProjectSummary[]>("/api/projects")).map((p) => p.id)).toEqual([projects.main.id]);
    // The remaining project's media is untouched.
    expect((await json<MediaAsset[]>(`/api/media?projectId=${projects.main.id}`))).toHaveLength(7);
  });

  it("deletes media", async () => {
    const { id } = assets.tone;
    expect((await api(`/api/media/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/api/media/${id}`)).status).toBe(404);
    expect((await api(`/api/media/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await api("/api/media/..%2F..%2Fetc")).status).toBe(404);
    expect(existsSync(path.join(dataDir, "media", id))).toBe(false);
  });

  describe("library", () => {
    const folders: Record<string, LibraryFolder> = {};
    const items: Record<string, LibraryItem> = {};
    let project: ProjectSummary;
    let video: MediaAsset;
    const library = () => json<Library>("/api/library");
    const ready = (url: string) =>
      until(async () => {
        const a = await json<MediaAsset>(url);
        return a.status === "processing" ? undefined : a;
      });
    const useItem = async (id: string, projectId = project.id) => {
      const res = await sendJson("POST", `/api/library/items/${id}/use`, { projectId });
      expect(res.status).toBe(200);
      return (await res.json()) as UseLibraryItemResponse;
    };

    it("starts empty and organises folders", async () => {
      expect(await library()).toEqual({ folders: [], items: [], media: [] });
      const create = async (name: unknown, parentId?: string) =>
        sendJson("POST", "/api/library/folders", { name, parentId });

      let res = await create(" Sound effects ");
      expect(res.status).toBe(201);
      folders.sfx = (await res.json()) as LibraryFolder;
      expect(folders.sfx).toMatchObject({ name: "Sound effects", parentId: null });
      folders.whooshes = (await (await create("Whooshes", folders.sfx.id)).json()) as LibraryFolder;
      folders.logos = (await (await create("Logos")).json()) as LibraryFolder;

      expect((await create("")).status).toBe(400);
      expect((await create("x", "folder_000000000000")).status).toBe(404);

      res = await sendJson("PATCH", `/api/library/folders/${folders.sfx.id}`, { parentId: folders.whooshes.id });
      expect(res.status).toBe(400);
      res = await sendJson("PATCH", `/api/library/folders/${folders.logos.id}`, { name: "Brand" });
      expect(((await res.json()) as LibraryFolder).name).toBe("Brand");
      expect((await library()).folders).toHaveLength(3);
    });

    it("imports files into a folder, processed like project media", async () => {
      const res = await api(`/api/library/items?folderId=${folders.whooshes.id}&name=whoosh.m4a`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: readFileSync(fixtures["tone.m4a"]),
      });
      expect(res.status).toBe(201);
      const { item, media } = (await res.json()) as LibraryEntry;
      items.whoosh = item;
      expect(item).toMatchObject({ kind: "media", name: "whoosh.m4a", folderId: folders.whooshes.id, usedAt: null, favorite: false });
      expect(media[0]).toMatchObject({ projectId: null, kind: "audio" });
      expect(media[0].src).toBe(`/files/library/${media[0].id}/source.m4a`);
      expect((await api(media[0].src)).status).toBe(200);
      const done = await ready(`/api/library/media/${media[0].id}`);
      expect(done.waveform).toBe(`/files/library/${media[0].id}/waveform.json`);
      // Library files aren't anyone's project media.
      expect((await api(`/api/media/${media[0].id}`)).status).toBe(404);
    });

    it("adds project media to the Library once", async () => {
      project = (await (await sendJson("POST", "/api/projects", { name: "Library test" })).json()) as ProjectSummary;
      video = (await (await upload(fixtures["landscape.mp4"], project.id)).json()) as MediaAsset;
      video = await ready(`/api/media/${video.id}`);

      const res = await sendJson("POST", "/api/library/items/media", { assetId: video.id, folderId: folders.logos.id });
      expect(res.status).toBe(201);
      const { item, media } = (await res.json()) as LibraryEntry;
      items.video = item;
      expect(media[0]).toMatchObject({ projectId: null, origin: video.id, status: "ready", kind: "video" });
      // Its previews come along instead of being generated again.
      expect(media[0].filmstrip?.urlPattern).toBe(`/files/library/${media[0].id}/frames/{i}.jpg`);
      expect((await api(media[0].filmstrip!.urlPattern.replace("{i}", "001"))).status).toBe(200);
      expect((await api(media[0].poster!)).status).toBe(200);

      // Adding it again makes another item for the same file.
      const again = (await (await sendJson("POST", "/api/library/items/media", { assetId: video.id })).json()) as LibraryEntry;
      expect(again.item.id).not.toBe(item.id);
      expect(again.media[0].id).toBe(media[0].id);
      expect((await api(`/api/library/items/${again.item.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await api(media[0].src)).status).toBe(200); // still used by the first item

      expect((await sendJson("POST", "/api/library/items/media", { assetId: "media_000000000000" })).status).toBe(404);
    });

    it("copies an item's media into a project when it's used, once", async () => {
      // The video came from this project: its original is reused.
      let used = await useItem(items.video.id);
      expect(used.assets.map((a) => a.id)).toEqual([video.id]);
      expect(used.template).toBeNull();
      expect(used.item.usedAt).toBeGreaterThan(0);

      used = await useItem(items.whoosh.id);
      const copy = used.assets[0];
      expect(copy).toMatchObject({ projectId: project.id, name: "whoosh.m4a", status: "ready", kind: "audio" });
      expect(copy.waveform).toBe(`/files/media/${copy.id}/waveform.json`);
      expect((await api(copy.waveform!)).status).toBe(200);
      expect((await useItem(items.whoosh.id)).assets[0].id).toBe(copy.id);
      expect((await json<MediaAsset[]>(`/api/media?projectId=${project.id}`)).map((a) => a.id).sort()).toEqual(
        [copy.id, video.id].sort(),
      );

      expect((await sendJson("POST", `/api/library/items/${items.whoosh.id}/use`, { projectId: "project_000000000000" })).status).toBe(404);
      expect((await sendJson("POST", "/api/library/items/item_000000000000/use", { projectId: project.id })).status).toBe(404);
    });

    it("saves clips with their settings and puts them in another project", async () => {
      const title = { ...clip("landscape", "main", 5, 0, 2), assetId: "", effects: [...defaultEffects(), ...textEffects({ text: "Hi" })] };
      const shot = { ...clip("landscape", "main", 3, 0.5, 1.5), assetId: video.id };
      const top = { id: "top", kind: "video", name: "Video 2", muted: false };
      const body = {
        projectId: project.id,
        name: "Intro",
        folderId: folders.logos.id,
        tracks: [top, createDefaultProject().tracks[0]],
        clips: [{ ...title, trackId: "top" }, shot],
      };
      const res = await sendJson("POST", "/api/library/items/clips", body);
      expect(res.status).toBe(201);
      const { item, media } = (await res.json()) as LibraryEntry;
      items.intro = item;
      if (item.kind !== "clips") throw new Error("expected saved clips");
      expect(item.template.tracks.map((t) => t.id)).toEqual(["top", "main"]);
      expect(item.template.clips.map((c) => [c.start, c.in, c.out])).toEqual([[0, 0.5, 1.5], [2, 0, 2]]);
      // The media is the Library's copy (the one added before).
      expect(media.map((m) => m.id)).toEqual([(items.video as { mediaId: string }).mediaId]);
      expect(item.template.clips[0].assetId).toBe(media[0].id);

      const bad = (patch: object) => sendJson("POST", "/api/library/items/clips", { ...body, ...patch });
      expect((await bad({ clips: [] })).status).toBe(400);
      expect((await bad({ name: " " })).status).toBe(400);
      expect((await bad({ projectId: projects.main.id, clips: [shot] })).status).toBe(400); // not that project's media

      const other = (await (await sendJson("POST", "/api/projects", {})).json()) as ProjectSummary;
      const used = await useItem(item.id, other.id);
      expect(used.assets).toHaveLength(1);
      expect(used.assets[0]).toMatchObject({ projectId: other.id, name: "landscape.mp4" });
      expect(used.template?.clips.map((c) => c.assetId)).toEqual([used.assets[0].id, ""]);
      await api(`/api/projects/${other.id}`, { method: "DELETE" });
    });

    it("renames, moves and favourites items", async () => {
      const patch = (body: object) => sendJson("PATCH", `/api/library/items/${items.whoosh.id}`, body);
      const res = await patch({ name: "Whoosh", folderId: folders.sfx.id, favorite: true });
      expect(await res.json()).toMatchObject({ name: "Whoosh", folderId: folders.sfx.id, favorite: true });
      expect((await patch({ folderId: "folder_000000000000" })).status).toBe(404);
      expect((await patch({ favorite: "yes" })).status).toBe(400);
      items.whoosh = (await (await patch({ folderId: folders.whooshes.id })).json()) as LibraryItem;
    });

    it("keeps everything across restarts", async () => {
      const before = await library();
      const restarted = await createApp({ dataDir });
      const again = http.createServer(restarted.app);
      await new Promise<void>((resolve) => again.listen(0, "127.0.0.1", resolve));
      try {
        const res = await fetch(`http://127.0.0.1:${(again.address() as AddressInfo).port}/api/library`);
        expect(await res.json()).toEqual(before);
      } finally {
        restarted.shutdown();
        await new Promise((resolve) => again.close(resolve));
      }
    });

    it("deletes items and folders, and files no item uses; projects keep their copies", async () => {
      const whooshMedia = (items.whoosh as { mediaId: string }).mediaId;
      const videoMedia = (items.video as { mediaId: string }).mediaId;
      expect((await api(`/api/library/items/${items.video.id}`, { method: "DELETE" })).status).toBe(204);
      // Still used by the saved intro.
      expect(existsSync(path.join(dataDir, "library", "media", videoMedia))).toBe(true);

      expect((await api(`/api/library/folders/${folders.sfx.id}`, { method: "DELETE" })).status).toBe(204);
      const lib = await library();
      expect(lib.folders.map((f) => f.id)).toEqual([folders.logos.id]);
      expect(lib.items.map((i) => i.id)).toEqual([items.intro.id]);
      expect(lib.media.map((m) => m.id)).toEqual([videoMedia]);
      expect(existsSync(path.join(dataDir, "library", "media", whooshMedia))).toBe(false);
      // The project's copy of the whoosh is its own.
      expect(await json<MediaAsset[]>(`/api/media?projectId=${project.id}`)).toHaveLength(2);

      expect((await api(`/api/library/folders/${folders.logos.id}`, { method: "DELETE" })).status).toBe(204);
      expect(await library()).toEqual({ folders: [], items: [], media: [] });
      expect(readdirSync(path.join(dataDir, "library", "media"))).toEqual([]);
      expect((await api(`/api/library/items/${items.intro.id}`, { method: "DELETE" })).status).toBe(404);
    });
  });
});
