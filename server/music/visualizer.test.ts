/**
 * Make visualizer on the server, through the app: the stand-in engine (`fake-engine.mjs`) "renders" a tone
 * as long as the song for the mix and each stem, ffmpeg makes them FLAC, and the video project is made of
 * them (`ProjectStore.createFromHandoff`, the video suite's `fromHandoff`). Needs ffmpeg.
 */
import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addChannels, setSteps } from "../../shared/music/edits.ts";
import { routeChannels } from "../../shared/music/mixer.ts";
import { FIRST_PATTERN_ID, createMusicProject } from "../../shared/music/project.ts";
import type { MakeVisualizerRequest, VisualizerJob } from "../../shared/music/visualizer.ts";
import type { MediaAsset, Project, ProjectSummary } from "../../shared/types.ts";
import { createApp, type EditorApp } from "../app.ts";

const FAKE = [process.execPath, path.join(import.meta.dirname, "fake-engine.mjs")];
const P = FIRST_PATTERN_ID;

/** One bar at 120 BPM (two seconds): a kick on its own insert, a hat straight into the master. */
const song = () => {
  let s = addChannels(createMusicProject("Night drive", 120), [
    { id: "chan_kick", name: "Kick", sampleId: null },
    { id: "chan_hat", name: "Hat", sampleId: null },
  ]);
  s = setSteps(setSteps(s, P, "chan_kick", [0, 4, 8, 12], true), P, "chan_hat", [2, 6, 10, 14], true);
  return routeChannels(s, ["chan_kick"], "insert_1");
};

describe("Make visualizer", () => {
  let dir: string;
  let editor: EditorApp;
  let server: ReturnType<EditorApp["app"]["listen"]>;
  let base: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "make-visualizer-"));
    editor = await createApp({ dataDir: dir, engine: { command: FAKE, pluginPaths: [] } });
    server = editor.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterEach(async () => {
    server.close();
    editor.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const send = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };

  async function finished(id: string): Promise<VisualizerJob> {
    for (;;) {
      const { body: job } = await send<VisualizerJob>("GET", `/music/visualizer/${id}`);
      if (job.state !== "rendering" && job.state !== "making") return job;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("renders the song and makes a video project of it: the mix, the kick's stem muted, the notes, the beat, a look", async () => {
    const { body: musicProject } = await send<ProjectSummary>("POST", "/projects", { suite: "music", name: "Night drive" });
    const request: MakeVisualizerRequest = {
      projectId: musicProject.id,
      song: song(),
      patternId: P,
      choice: { stems: ["insert_1"], channels: ["chan_kick", "chan_hat"], roles: {}, video: { look: "bars", aspectRatio: "16:9", fps: 60 } },
    };
    const { status, body: started } = await send<VisualizerJob>("POST", "/music/visualizer", request);
    expect(status).toBe(200);
    expect(started.state).toBe("rendering");
    const job = await finished(started.id);
    expect(job).toMatchObject({ state: "done", error: null, rendered: 1 });
    const summary = job.project!;
    expect(summary).toMatchObject({ suite: "video", name: "Night drive" });

    const { body: video } = await send<Project>("GET", `/projects/${summary.id}`);
    expect(video.settings).toEqual({ aspectRatio: "16:9", fps: 60 });
    expect(video.tracks.filter((t) => t.kind === "audio").map((t) => [t.name, t.muted])).toEqual([
      ["Mix", false],
      ["Insert 1", true],
    ]);
    expect(video.signals?.map((s) => [s.name, s.role, s.kind === "events" ? s.events.length : 0])).toEqual([
      ["Kick", "kick", 4],
      ["Hat", "hats", 4],
    ]);
    expect(video.tempo?.beats.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
    expect(video.clips.some((c) => c.effects.some((e) => e.type === "audio-bars"))).toBe(true);

    // Its media: the mix and the stem as FLAC, in the new project's own package.
    const { body: media } = await send<MediaAsset[]>("GET", `/media?projectId=${summary.id}`);
    expect(media.map((m) => [m.name, m.kind, m.hasAudio]).sort()).toEqual([
      ["Night drive - Insert 1.flac", "audio", true],
      ["Night drive.flac", "audio", true],
    ]);
    expect(media.every((m) => Math.abs((m.duration ?? 0) - 2) < 0.05)).toBe(true);
    expect(video.tempo?.assetIds.sort()).toEqual(media.map((m) => m.id).sort());
    // Nothing left behind.
    expect(readdirSync(path.join(dir, "tmp")).filter((f) => f.startsWith("visualizer-"))).toEqual([]);
    expect(existsSync(path.join(summary.path, "media"))).toBe(true);
  });

  it("refuses a silent song and a second one at once", async () => {
    const { body: musicProject } = await send<ProjectSummary>("POST", "/projects", { suite: "music", name: "Quiet" });
    const silent = await send<{ error: string }>("POST", "/music/visualizer", { projectId: musicProject.id, song: createMusicProject("Quiet", 120), patternId: P, choice: {} });
    expect(silent.status).toBe(400);
    const first = await send<VisualizerJob>("POST", "/music/visualizer", { projectId: musicProject.id, song: song(), patternId: P, choice: {} });
    const second = await send<{ error: string }>("POST", "/music/visualizer", { projectId: musicProject.id, song: song(), patternId: P, choice: {} });
    expect(second.status).toBe(409);
    const stopped = await send<VisualizerJob>("POST", `/music/visualizer/${first.body.id}/abort`);
    expect(["rendering", "aborted"]).toContain(stopped.body.state);
    expect((await finished(first.body.id)).state).toBe("aborted");
  });
});
