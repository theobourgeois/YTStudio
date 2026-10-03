import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMusicProject } from "../shared/music/project.ts";
import { MUSIC_TOOLS } from "../shared/music/tools.ts";
import type { MusicProject } from "../shared/music/types.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import type { Project, ProjectSummary } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";

/** Projects of every suite through the API: each keeps its own kind of document. */
describe("suites", () => {
  let dataDir: string;
  let running: { editor: EditorApp; server: http.Server } | undefined;
  let base = "";

  async function start() {
    const editor = await createApp({ dataDir });
    const server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    running = { editor, server };
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function stop() {
    if (!running) return;
    running.editor.shutdown();
    await new Promise<void>((resolve) => running!.server.close(() => resolve()));
    running = undefined;
  }
  const send = async <T>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T };
  };
  const mcp = async (query: string, method: string) =>
    (await send<{ result: { tools?: { name: string }[]; instructions?: string } }>("POST", `/mcp${query}`, { jsonrpc: "2.0", id: 1, method, params: {} })).body.result;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "editor-suites-"));
  });
  afterEach(async () => {
    await stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("makes, saves, renames and copies songs", async () => {
    await start();
    const created = await send<ProjectSummary>("POST", "/api/projects", { suite: "music", name: "Demo" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ suite: "music", name: "Demo", tempo: 140, duration: 0, thumbnail: null });
    const id = created.body.id;
    expect((await send<MusicProject>("GET", `/api/projects/${id}`)).body).toEqual(createMusicProject("Demo"));

    // Saved through its own normalisation (not a video's).
    const saved = await send<ProjectSummary>("PUT", `/api/projects/${id}`, { version: 1, name: "Demo", settings: { tempo: 5000, timeSignature: [6, 8] } });
    expect(saved.body).toMatchObject({ suite: "music", tempo: 999 });
    expect((await send<MusicProject>("GET", `/api/projects/${id}`)).body.settings).toEqual({ tempo: 999, timeSignature: [6, 8], swing: 0, volume: 0.78 });

    await send("PATCH", `/api/projects/${id}`, { name: "Anthem" });
    expect((await send<MusicProject>("GET", `/api/projects/${id}`)).body.name).toBe("Anthem");
    const copy = await send<ProjectSummary>("POST", `/api/projects/${id}/duplicate`);
    expect(copy.body).toMatchObject({ suite: "music", name: "Anthem copy", tempo: 999 });

    // Kept across restarts.
    await stop();
    await start();
    const list = (await send<ProjectSummary[]>("GET", "/api/projects")).body;
    expect(list.map((p) => [p.name, p.suite])).toEqual([["Anthem copy", "music"], ["Anthem", "music"]]);
  });

  it("starts new projects from their suite's starting point, a hidden copy", async () => {
    await start();
    const beat = (await send<ProjectSummary>("POST", "/api/projects", { suite: "music", name: "My setup" })).body;
    await send("PUT", `/api/projects/${beat.id}`, { ...createMusicProject("My setup"), settings: { tempo: 142, timeSignature: [4, 4], swing: 0 } });
    // A plugin's settings beside the document go with it.
    mkdirSync(path.join(beat.path, "plugins"), { recursive: true });
    writeFileSync(path.join(beat.path, "plugins", "chan_serum.bin"), "state");

    expect((await send("GET", "/api/projects/templates")).body).toEqual({});
    const templates = (await send<Record<string, { name: string }>>("POST", `/api/projects/${beat.id}/template`)).body;
    expect(templates).toMatchObject({ music: { name: "My setup" } });
    // Changing the project afterwards doesn't change its starting point.
    await send("PUT", `/api/projects/${beat.id}`, { ...createMusicProject("My setup"), settings: { tempo: 90, timeSignature: [4, 4], swing: 0 } });

    const next = (await send<ProjectSummary>("POST", "/api/projects", { suite: "music" })).body;
    expect(next).toMatchObject({ suite: "music", name: "Untitled", tempo: 142 });
    expect(readFileSync(path.join(next.path, "plugins", "chan_serum.bin"), "utf8")).toBe("state");
    expect((await send<ProjectSummary>("POST", "/api/projects", { suite: "music", blank: true })).body).toMatchObject({ tempo: 140 });
    // The tempo set as the default (the tab's) goes over the starting point's, and into blank songs.
    expect((await send<ProjectSummary>("POST", "/api/projects", { suite: "music", options: { tempo: 96 } })).body).toMatchObject({ tempo: 96 });
    expect((await send<ProjectSummary>("POST", "/api/projects", { suite: "music", blank: true, options: { tempo: 100 } })).body).toMatchObject({ tempo: 100 });
    // Other suites start blank; the starting point itself isn't listed.
    expect((await send<ProjectSummary>("POST", "/api/projects", { suite: "video" })).body).toMatchObject({ suite: "video", clipCount: 0 });
    const list = (await send<ProjectSummary[]>("GET", "/api/projects")).body;
    expect(list).toHaveLength(6);

    // Saving another replaces it; clearing it, and new ones start blank.
    await send("POST", `/api/projects/${next.id}/template`);
    expect(Object.keys((await send<object>("GET", "/api/projects/templates")).body)).toEqual(["music"]);
    await stop();
    await start();
    expect((await send("GET", "/api/projects/templates")).body).toMatchObject({ music: { name: "Untitled" } });
    expect((await send("DELETE", "/api/projects/templates/music")).body).toEqual({});
    expect((await send<ProjectSummary>("POST", "/api/projects", { suite: "music" })).body).toMatchObject({ tempo: 140 });
    expect((await send("DELETE", "/api/projects/templates/spreadsheet")).status).toBe(400);
  });

  it("refuses unknown suites, and makes videos by default", async () => {
    await start();
    expect((await send("POST", "/api/projects", { suite: "spreadsheet" })).status).toBe(400);
    const video = await send<ProjectSummary>("POST", "/api/projects", {});
    expect(video.body).toMatchObject({ suite: "video", clipCount: 0, aspectRatio: "9:16" });
  });

  it("treats projects saved before suites as videos", async () => {
    const id = "project_0123456789ab";
    const dir = path.join(dataDir, "projects", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "project.json"), JSON.stringify({ ...createDefaultProject(), name: "Old one" }));
    // (In the layout before packages, which is migrated into one.)
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, status: "active", createdAt: 1, updatedAt: 2, settledAt: null }));
    await start();
    const [summary] = (await send<ProjectSummary[]>("GET", "/api/projects")).body;
    expect(summary).toMatchObject({ id, suite: "video", name: "Old one" });
    expect((await send<Project>("GET", `/api/projects/${id}`)).body.tracks.length).toBe(2);
  });

  it("gives each chat its suite's tools and instructions over MCP", async () => {
    await start();
    const song = (await send<ProjectSummary>("POST", "/api/projects", { suite: "music" })).body;
    const video = (await send<ProjectSummary>("POST", "/api/projects", {})).body;
    const names = async (query: string) => (await mcp(query, "tools/list")).tools!.map((t) => t.name);

    expect(await names(`?chat=${song.id}`)).toEqual(MUSIC_TOOLS.map((t) => t.name));
    expect(await names("?suite=music")).toContain("set_steps");
    expect(await names(`?chat=${video.id}`)).toContain("split_clips");
    // Outside clients (no chat) get the video editor's, as before suites.
    expect(await names("")).toContain("split_clips");
    expect((await mcp(`?chat=${song.id}`, "initialize")).instructions).toMatch(/music editor/);

    const call = await send<{ error?: { code: number } }>("POST", `/mcp?chat=${song.id}`, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "split_clips", arguments: {} },
    });
    expect(call.body.error?.code).toBe(-32602);
  });
});
