import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultEffects } from "../shared/effects.ts";
import type { MediaAsset, Project, ProjectLocation, ProjectSummary } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";
import { fileName, namedAfter, uniquePackage } from "./packages.ts";

describe("package names", () => {
  it("makes a project's name a file name", () => {
    expect(fileName("Launch / teaser: v2")).toBe("Launch - teaser- v2");
    expect(fileName("..hidden")).toBe("hidden");
    expect(fileName("   ")).toBe("Untitled");
    expect(fileName("x".repeat(300))).toHaveLength(120);
  });

  it("knows a folder named after its project, numbered or not", () => {
    expect(namedAfter("/a/Song.vaudio", "Song")).toBe(true);
    expect(namedAfter("/a/Song 2.vaudio", "Song")).toBe(true);
    expect(namedAfter("/a/Song copy.vaudio", "Song")).toBe(false);
    expect(namedAfter("/a/A - B.vaudio", "A / B")).toBe(true);
  });

  it("finds a free name, keeping a package's own", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "editor-names-"));
    try {
      expect(uniquePackage(dir, "Song")).toBe(path.join(dir, "Song.vaudio"));
      mkdirSync(path.join(dir, "Song.vaudio"));
      expect(uniquePackage(dir, "Song")).toBe(path.join(dir, "Song 2.vaudio"));
      expect(uniquePackage(dir, "Song", path.join(dir, "Song.vaudio"))).toBe(path.join(dir, "Song.vaudio"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Projects as packages: made, opened from anywhere, renamed, moved, copied in Finder, missing, trashed. */
describe("project packages", () => {
  let tmp: string;
  let dataDir: string;
  let documents: string;
  let trashed: string[];
  let revealed: string[];
  let running: { editor: EditorApp; server: http.Server } | undefined;
  let base = "";

  async function start() {
    const editor = await createApp({
      dataDir,
      projectsDir: documents,
      trash: async (dir) => {
        trashed.push(dir);
        rmSync(dir, { recursive: true, force: true });
      },
      reveal: async (dir) => void revealed.push(dir),
    });
    const server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    running = { editor, server };
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function stop() {
    if (!running) return;
    running.editor.shutdown();
    running.server.closeAllConnections();
    await new Promise<void>((resolve) => running!.server.close(() => resolve()));
    running = undefined;
  }
  const send = async <T>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T };
  };
  const list = async () => (await send<ProjectSummary[]>("GET", "/api/projects")).body;
  const create = async (name: string) => (await send<ProjectSummary>("POST", "/api/projects", { name })).body;
  const open = (file: string) => send<ProjectSummary>("POST", "/api/projects/open", { path: file });

  /** A media file saved straight into a package, as an import would have left it. */
  function seedMedia(pkg: string, projectId: string, id: string): MediaAsset {
    const asset: MediaAsset = {
      id, projectId, name: "clip.mp4", kind: "video", duration: 5, width: 320, height: 180, fps: 30, hasVideo: true, hasAudio: false,
      size: 4, createdAt: 1, status: "ready", src: `/files/media/${id}/source.mp4`, poster: `/files/media/${id}/poster.jpg`, filmstrip: null, waveform: null,
    };
    mkdirSync(path.join(pkg, "media", id), { recursive: true });
    writeFileSync(path.join(pkg, "media", id, "meta.json"), JSON.stringify(asset));
    writeFileSync(path.join(pkg, "media", id, "source.mp4"), `data of ${id}`);
    const doc = JSON.parse(readFileSync(path.join(pkg, "project.json"), "utf8")) as Project;
    const clip = { id: "clip_1", assetId: id, trackId: doc.tracks[0].id, start: 0, in: 0, out: 2, effects: defaultEffects() };
    writeFileSync(path.join(pkg, "project.json"), JSON.stringify({ ...doc, clips: [clip] }));
    return asset;
  }

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "editor-packages-"));
    dataDir = path.join(tmp, "data");
    documents = path.join(tmp, "Documents", "Vaudio");
    trashed = [];
    revealed = [];
  });
  afterEach(async () => {
    await stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("makes each project a package in the location, and keeps the recents across restarts", async () => {
    await start();
    expect((await send<ProjectLocation>("GET", "/api/projects/location")).body).toEqual({ path: documents, default: documents });
    const a = await create("Summer edit");
    const b = await create("Summer edit");
    expect([a.path, b.path]).toEqual([path.join(documents, "Summer edit.vaudio"), path.join(documents, "Summer edit 2.vaudio")]);
    expect(readdirSync(a.path).sort()).toEqual(["media", "meta.json", "project.json"]);

    // Opening one makes it the latest.
    await send("POST", `/api/projects/${a.id}/opened`);
    expect((await list()).map((p) => p.id)).toEqual([a.id, b.id]);
    await send("POST", `/api/projects/${b.id}/reveal`);
    expect(revealed).toEqual([b.path]);

    // Another folder for new ones (made if need be), kept.
    const elsewhere = path.join(tmp, "Elsewhere");
    expect((await send<ProjectLocation>("PUT", "/api/projects/location", { path: elsewhere })).body.path).toBe(elsewhere);
    const c = await create("Third");
    expect(c.path).toBe(path.join(elsewhere, "Third.vaudio"));
    expect((await send("PUT", "/api/projects/location", { path: "relative/dir" })).status).toBe(400);
    expect((await send("PUT", "/api/projects/location", { path: a.path })).status).toBe(400);

    await stop();
    await start();
    expect((await list()).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect((await send<ProjectLocation>("GET", "/api/projects/location")).body.path).toBe(elsewhere);
  });

  it("renames an open project's package once it's closed", async () => {
    await start();
    const song = (await send<ProjectSummary>("POST", "/api/projects", { suite: "music", name: "Beat" })).body;
    await send("POST", `/api/projects/${song.id}/opened`);
    const doc = (await send<{ name: string }>("GET", `/api/projects/${song.id}`)).body;
    // Renamed while open: only its document changes (things are writing into its folder).
    const saved = (await send<ProjectSummary>("PUT", `/api/projects/${song.id}`, { ...doc, name: "Anthem" })).body;
    expect(saved).toMatchObject({ name: "Anthem", path: song.path });
    const closed = (await send<ProjectSummary>("POST", `/api/projects/${song.id}/closed`)).body;
    expect(closed.path).toBe(path.join(documents, "Anthem.vaudio"));
    expect(existsSync(song.path)).toBe(false);
    // Closed, a rename moves it at once.
    expect((await send<ProjectSummary>("PATCH", `/api/projects/${song.id}`, { name: "Anthem / final" })).body.path).toBe(path.join(documents, "Anthem - final.vaudio"));
  });

  it("takes the document's name for a recent renamed in the app while the server stopped", async () => {
    await start();
    const a = await create("First name");
    await send("POST", `/api/projects/${a.id}/opened`);
    const doc = (await send<object>("GET", `/api/projects/${a.id}`)).body;
    await send("PUT", `/api/projects/${a.id}`, { ...doc, name: "Second name" });
    await stop();
    await start();
    expect((await list())[0]).toMatchObject({ name: "Second name", path: path.join(documents, "Second name.vaudio") });
  });

  it("opens a package from anywhere, by its folder or a file in it, and takes its folder's name", async () => {
    await start();
    const a = await create("Mine");
    await stop();
    // Moved and renamed in Finder while the app was closed: it's missing where it was.
    const moved = path.join(tmp, "Desktop", "Renamed.vaudio");
    mkdirSync(path.dirname(moved));
    renameSync(a.path, moved);
    await start();
    const [lost] = await list();
    expect(lost).toMatchObject({ id: a.id, name: "Mine", missing: true, path: a.path, thumbnail: null });
    expect((await send("GET", `/api/projects/${a.id}`)).status).toBe(404);

    // Located: the same project, where it is now, called what Finder calls it.
    const found = (await open(path.join(moved, "project.json"))).body;
    expect(found).toMatchObject({ id: a.id, name: "Renamed", path: moved });
    expect(found.missing).toBeUndefined();
    expect((await list()).map((p) => [p.id, p.path])).toEqual([[a.id, moved]]);
    expect((await send<Project>("GET", `/api/projects/${a.id}`)).body.name).toBe("Renamed");
    // Opening it again changes nothing.
    expect((await open(moved)).body.id).toBe(a.id);

    expect((await open(path.join(tmp, "nothing-here"))).status).toBe(404);
    expect((await open(tmp)).status).toBe(400);
    expect((await open("relative.vaudio")).status).toBe(400);
  });

  it("gives a copy made in Finder ids of its own, its media too", async () => {
    await start();
    const a = await create("Original");
    await stop();
    const asset = seedMedia(a.path, a.id, "media_00000000000a");
    const copy = path.join(documents, "Original copy.vaudio");
    cpSync(a.path, copy, { recursive: true });
    await start();

    const opened = (await open(copy)).body;
    expect(opened.id).not.toBe(a.id);
    expect(opened).toMatchObject({ name: "Original copy", clipCount: 1, path: copy });
    const [media] = (await send<MediaAsset[]>("GET", `/api/media?projectId=${opened.id}`)).body;
    expect(media.id).not.toBe(asset.id);
    expect(media).toMatchObject({ projectId: opened.id, src: `/files/media/${media.id}/source.mp4`, poster: `/files/media/${media.id}/poster.jpg` });
    const doc = (await send<Project>("GET", `/api/projects/${opened.id}`)).body;
    expect(doc.clips[0].assetId).toBe(media.id);
    // Each one's files are its own.
    expect(await (await fetch(`${base}${media.src}`)).text()).toBe(`data of ${asset.id}`);
    expect(existsSync(path.join(copy, "media", media.id, "source.mp4"))).toBe(true);
    expect((await send<MediaAsset[]>("GET", `/api/media?projectId=${a.id}`)).body.map((m) => m.id)).toEqual([asset.id]);
  });

  it("removes from the recents without deleting, and moves to the Trash", async () => {
    await start();
    const a = await create("Keep the files");
    const b = await create("Throw away");
    expect((await send("DELETE", `/api/projects/${a.id}/recent`)).status).toBe(204);
    expect(existsSync(a.path)).toBe(true);
    expect((await list()).map((p) => p.id)).toEqual([b.id]);
    // Open… brings it back.
    expect((await open(a.path)).body.id).toBe(a.id);

    expect((await send("DELETE", `/api/projects/${b.id}`)).status).toBe(204);
    expect(trashed).toEqual([b.path]);
    expect((await list()).map((p) => p.id)).toEqual([a.id]);

    // A missing one is only forgotten.
    await stop();
    rmSync(a.path, { recursive: true });
    await start();
    expect((await list())[0].missing).toBe(true);
    expect((await send("DELETE", `/api/projects/${a.id}`)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect(trashed).toEqual([b.path]);
  });

  it("keeps a starting point in the data folder, out of the recents", async () => {
    await start();
    const a = await create("Setup");
    await send("POST", `/api/projects/${a.id}/template`);
    expect(readdirSync(path.join(dataDir, "templates"))).toHaveLength(1);
    const next = await create("From it");
    expect(next.path).toBe(path.join(documents, "From it.vaudio"));
    expect((await list()).map((p) => p.name)).toEqual(["From it", "Setup"]);
    const template = path.join(dataDir, "templates", readdirSync(path.join(dataDir, "templates"))[0]);
    expect((await open(template)).status).toBe(400);
    expect((await send<ProjectSummary>("POST", "/api/projects", { name: "Copy", blank: true })).body).toMatchObject({ clipCount: 0 });
  });
});
