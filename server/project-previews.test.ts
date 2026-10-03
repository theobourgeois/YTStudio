import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPreviews, type PreviewRenderer } from "./project-previews.ts";
import { DataPaths } from "./storage.ts";
import type { ProjectStore } from "./projects.ts";
import type { ProjectSummary } from "../shared/types.ts";
import { createMusicProject } from "../shared/music/project.ts";

const id = "project_123456789abc";
describe("cached project previews", () => {
  let root: string;
  let paths: DataPaths;
  let directory: string;
  let revision: number;
  let projects: ProjectStore;
  let previews: ProjectPreviews;
  let render: ReturnType<typeof vi.fn<PreviewRenderer>>;
  const inspect = vi.fn(async () => ({ duration: 2, peaks: [0.2, 1, 0.4] }));

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "project-previews-"));
    paths = new DataPaths(root);
    await paths.init();
    directory = path.join(root, "Song.vaudio");
    await fs.mkdir(directory);
    revision = 100;
    projects = {
      summary: () => ({ id, suite: "music", updatedAt: revision } as ProjectSummary),
      dir: () => directory,
      suiteOf: () => "music",
      get: async () => createMusicProject("Song"),
    } as unknown as ProjectStore;
    render = vi.fn(async (_id, _doc, folder) => {
      const file = path.join(folder, "preview.m4a");
      await fs.writeFile(file, "rendered mix");
      return file;
    });
    previews = new ProjectPreviews(paths, projects, { music: render, video: render }, inspect);
  });
  afterEach(async () => { previews.shutdown(); await fs.rm(root, { recursive: true, force: true }); });
  const ready = () => expect.poll(async () => (await previews.get(id)).state).toBe("ready");

  it("renders once, persists the mix and waveform, and survives a server restart", async () => {
    expect(await previews.get(id)).toEqual({ state: "idle", revision });
    await previews.ensure(id, revision);
    await previews.ensure(id, revision);
    await ready();
    expect(render).toHaveBeenCalledTimes(1);
    const view = await previews.get(id);
    expect(view).toMatchObject({ state: "ready", duration: 2, peaks: [0.2, 1, 0.4] });
    expect(await fs.readFile(await previews.file(id, false), "utf8")).toBe("rendered mix");
    previews.shutdown();
    previews = new ProjectPreviews(paths, projects, { music: render, video: render }, inspect);
    await previews.ensure(id, revision);
    expect(await previews.get(id)).toEqual(view);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("invalidates edited projects and rejects layouts prepared for an older revision", async () => {
    await previews.ensure(id, revision);
    await ready();
    revision++;
    expect(await previews.get(id)).toEqual({ state: "idle", revision });
    await expect(previews.ensure(id, revision - 1)).rejects.toMatchObject({ status: 409 });
    await previews.ensure(id, revision);
    await ready();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("never publishes a render overtaken by an edit and resolves a renamed package at completion", async () => {
    let release!: () => void;
    render.mockImplementationOnce(async (_id, _doc, folder) => {
      await new Promise<void>((resolve) => { release = resolve; });
      const file = path.join(folder, "preview.m4a");
      await fs.writeFile(file, "old mix");
      return file;
    });
    await previews.ensure(id, revision);
    await expect.poll(() => !!release).toBe(true);
    revision++;
    release();
    await expect.poll(async () => (await fs.readdir(paths.tmp)).length).toBe(0);
    expect((await previews.get(id)).state).toBe("idle");
    const moved = path.join(root, "Renamed.vaudio");
    await fs.rename(directory, moved);
    directory = moved;
    await previews.ensure(id, revision);
    await ready();
    expect(await previews.file(id, false)).toContain("Renamed.vaudio");
  });

  it("caches empty songs, and lets failed renders be retried", async () => {
    render.mockResolvedValueOnce(null);
    await previews.ensure(id, revision);
    await expect.poll(async () => (await previews.get(id)).state).toBe("empty");
    await previews.ensure(id, revision);
    expect(render).toHaveBeenCalledTimes(1);
    revision++;
    render.mockRejectedValueOnce(new Error("Missing instrument"));
    await previews.ensure(id, revision);
    await expect.poll(async () => (await previews.get(id)).state).toBe("error");
    expect((await previews.get(id)).error).toBe("Missing instrument");
    await previews.ensure(id, revision);
    await ready();
  });

  it("refreshes a waveform when plugin state changes without a document edit", async () => {
    await previews.ensure(id, revision);
    await ready();
    await fs.mkdir(path.join(directory, "plugins"));
    await fs.writeFile(path.join(directory, "plugins", "chan.bin"), "new instrument settings");
    expect((await previews.get(id)).state).toBe("idle");
    await previews.ensure(id, revision);
    await ready();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("rebuilds a cache whose media file has been removed", async () => {
    await previews.ensure(id, revision);
    await ready();
    await fs.rm(await previews.file(id, false));
    expect((await previews.get(id)).state).toBe("idle");
    await previews.ensure(id, revision);
    await ready();
    expect(render).toHaveBeenCalledTimes(2);
  });
});
