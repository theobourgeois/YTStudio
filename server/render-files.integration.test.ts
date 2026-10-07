import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEffect, setParams, solidEffects } from "../shared/effects.ts";
import { renderSegments } from "../shared/render-files.ts";
import { MAIN_TRACK_ID, createDefaultProject } from "../shared/timeline.ts";
import type { Clip, ExportJob, Project, ProjectSummary, RenderFilesState, RenderJob } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";
import { FFMPEG, FFPROBE } from "./config.ts";

const ffmpegAvailable = spawnSync(FFMPEG, ["-version"]).status === 0 && spawnSync(FFPROBE, ["-version"]).status === 0;

/** A video's frame count and size, by decoding it. */
function frames(file: string): { count: number; width: number; height: number } {
  const out = execFileSync(FFPROBE, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "json", file]);
  const s = (JSON.parse(out.toString()) as { streams: { nb_read_frames: string; width: number; height: number }[] }).streams[0];
  return { count: Number(s.nb_read_frames), width: s.width, height: s.height };
}

/** One pixel's RGB in a video's frame at `time` (BT.709 limited range, as both files are tagged). */
function rgbAt(file: string, time: number, x: number, y: number): number[] {
  const out = execFileSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(time), "-i", file, "-frames:v", "1",
    "-vf", `scale=in_color_matrix=bt709:in_range=tv,format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [out[0], out[1], out[2]];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ffmpegAvailable)("render files (integration)", () => {
  let tmp: string;
  let editor: EditorApp;
  let server: http.Server;
  let base: string;
  let summary: ProjectSummary;

  const api = (p: string, init?: RequestInit) => fetch(base + p, init);
  const send = (method: string, p: string, body?: unknown) =>
    api(p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const state = async () => (await (await api(`/api/render-files/${summary.id}`)).json()) as RenderFilesState;
  /** Render a project's heavy segments and wait for it. */
  const render = async (project: Project): Promise<RenderJob> => {
    const res = await send("POST", `/api/render-files/${summary.id}`, { project });
    expect(res.status).toBe(202);
    const started = (await res.json()) as RenderJob;
    for (let i = 0; i < 600; i++) {
      const { job } = await state();
      if (job?.id === started.id && job.status !== "queued" && job.status !== "rendering") return job;
      await sleep(100);
    }
    throw new Error("The render didn't finish.");
  };

  const solid = (id: string, start: number, color: string, trackId = MAIN_TRACK_ID): Clip => ({
    id, assetId: "", trackId, start, in: 0, out: 1, effects: solidEffects({ color }),
  });
  /** Two inverted solids (heavy: an effect each), then a plain one (not worth rendering). */
  const base0 = (): Project => {
    const project: Project = { ...createDefaultProject(), settings: { aspectRatio: "16:9", fps: 30 }, clips: [solid("a", 0, "#ff0000"), solid("b", 1, "#0000ff"), solid("c", 2, "#00ff00")] };
    return addEffect(project, ["a", "b"], "invert").project;
  };

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-render-"));
    editor = await createApp({ dataDir: path.join(tmp, "data") });
    server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    summary = (await (await send("POST", "/api/projects", {})).json()) as ProjectSummary;
  });

  afterAll(async () => {
    editor?.shutdown();
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("renders the heavy segments, each a file of its frames, named as the tab names them", async () => {
    const project = base0();
    const heavy = renderSegments(project, []).filter((s) => s.heavy);
    expect(heavy.map((s) => [s.from, s.to])).toEqual([[0, 30], [30, 60]]);
    const job = await render(project);
    expect(job).toMatchObject({ status: "done", segments: 2, progress: 1 });
    expect(job.rendered.sort()).toEqual(heavy.map((s) => s.key).sort());
    expect((await state()).keys.sort()).toEqual(heavy.map((s) => s.key).sort());
    for (const s of heavy) {
      const file = path.join(summary.path, "render", `${s.key}.mp4`);
      expect(frames(file)).toEqual({ count: s.to - s.from, width: 1920, height: 1080 });
    }
  });

  it("draws what the export draws", async () => {
    const project = base0();
    const [first] = renderSegments(project, []);
    const res = await send("POST", "/api/exports", { project, resolution: "1080p" });
    let job = (await res.json()) as ExportJob;
    while (job.status === "queued" || job.status === "rendering") {
      await sleep(100);
      job = (await (await api(`/api/exports/${job.id}`)).json()) as ExportJob;
    }
    expect(job.status).toBe("done");
    const exported = path.join(tmp, "data", "exports", `${job.id}.mp4`);
    const rendered = path.join(summary.path, "render", `${first.key}.mp4`);
    const [a, b] = [rgbAt(rendered, 0.5, 960, 540), rgbAt(exported, 0.5, 960, 540)];
    // Inverted red: cyan.
    expect(a[0]).toBeLessThan(20);
    expect(a[1]).toBeGreaterThan(235);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(3);
  });

  it("serves a render file, seekable", async () => {
    const [first] = renderSegments(base0(), []);
    const res = await api(`/api/render-files/${summary.id}/${first.key}.mp4`, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect((await api(`/api/render-files/${summary.id}/not-a-key.mp4`)).status).toBe(404);
  });

  it("renders again only the segments an edit changed", async () => {
    const before = base0();
    const [a] = renderSegments(before, []);
    const fileA = path.join(summary.path, "render", `${a.key}.mp4`);
    const made = statSync(fileA).mtimeMs;
    const edited = setParams(before, "b", "solid", { color: "#ffff00" });
    const job = await render(edited);
    expect(job).toMatchObject({ status: "done", segments: 1 });
    expect(statSync(fileA).mtimeMs).toBe(made);
    // The old version's file stays (undo brings it back).
    expect((await state()).keys).toHaveLength(3);
  });

  it("deletes a video's render files", async () => {
    const res = await send("DELETE", `/api/render-files/${summary.id}`);
    expect(((await res.json()) as RenderFilesState).keys).toEqual([]);
    expect(existsSync(path.join(summary.path, "render"))).toBe(false);
    expect((await state()).keys).toEqual([]);
  });

  it("refuses an unknown project", async () => {
    expect((await api("/api/render-files/project_000000000000")).status).toBe(404);
  });
});
