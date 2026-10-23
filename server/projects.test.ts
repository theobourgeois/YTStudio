import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEffects } from "../shared/effects.ts";
import type { AppResponse, MediaAsset, Project, ProjectLocation, ProjectSummary } from "../shared/types.ts";
import { type AppOptions, createApp, type EditorApp } from "./app.ts";
import { fileName, fitsName, isPackageName, namedAfter, packageName, relocated, uniquePackage } from "./packages.ts";
import { MAX_COVER_BYTES } from "./projects.ts";
import { videoSuite } from "./suites/video.ts";

describe("package names", () => {
  it("makes a project's name a file name", () => {
    expect(fileName("Launch / teaser: v2")).toBe("Launch - teaser- v2");
    expect(fileName("..hidden")).toBe("hidden");
    expect(fileName("   ")).toBe("Untitled");
    expect(fileName("x".repeat(300))).toHaveLength(120);
  });

  it("knows a folder named after its project, numbered or not", () => {
    expect(namedAfter("/a/Song.ytsng", "Song")).toBe(true);
    expect(namedAfter("/a/Song 2.ytsng", "Song")).toBe(true);
    expect(namedAfter("/a/Song copy.ytsng", "Song")).toBe(false);
    expect(namedAfter("/a/A - B.ytvid", "A / B")).toBe(true);
  });

  it("knows each suite's packages and older ones, and that the older ones are to be renamed", () => {
    expect(["/a/Song.ytsng", "/a/Edit.ytvid", "/a/Shot.ytimg", "/a/Song.yt"].map(isPackageName)).toEqual([true, true, true, true]);
    expect(isPackageName("/a/Song.VAUDIO/")).toBe(true);
    expect(isPackageName("/a/Song")).toBe(false);
    expect(packageName("/a/Song.vaudio")).toBe("Song");
    expect(packageName("/a/Song.ytsng")).toBe("Song");
    expect(namedAfter("/a/Song.vaudio", "Song")).toBe(true);
    expect(fitsName("/a/Song.vaudio", "Song", "music")).toBe(false);
    expect(fitsName("/a/Song.yt", "Song", "music")).toBe(false);
    expect(fitsName("/a/Song 2.ytsng", "Song", "music")).toBe(true);
    expect(fitsName("/a/Song.ytvid", "Song", "music")).toBe(false);
  });

  it("finds a package where the rename put it", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "editor-names-"));
    try {
      const old = path.join(dir, "Vaudio");
      mkdirSync(path.join(dir, "YTStudio", "Song.ytsng"), { recursive: true });
      mkdirSync(path.join(dir, "Elsewhere", "Mix.yt"), { recursive: true });
      mkdirSync(path.join(dir, "Elsewhere", "Cut.ytvid"), { recursive: true });
      expect(relocated(path.join(old, "Song.vaudio"))).toBe(path.join(dir, "YTStudio", "Song.ytsng"));
      expect(relocated(old)).toBe(path.join(dir, "YTStudio"));
      expect(relocated(path.join(dir, "Elsewhere", "Mix.vaudio"))).toBe(path.join(dir, "Elsewhere", "Mix.yt"));
      expect(relocated(path.join(dir, "Elsewhere", "Cut.yt"))).toBe(path.join(dir, "Elsewhere", "Cut.ytvid"));
      // Nowhere to be found: left as it was (it's missing).
      expect(relocated(path.join(old, "Gone.vaudio"))).toBe(path.join(old, "Gone.vaudio"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds a free name with its suite's extension, keeping a package's own", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "editor-names-"));
    try {
      expect(uniquePackage(dir, "Song", "music")).toBe(path.join(dir, "Song.ytsng"));
      mkdirSync(path.join(dir, "Song.ytsng"));
      expect(uniquePackage(dir, "Song", "music")).toBe(path.join(dir, "Song 2.ytsng"));
      expect(uniquePackage(dir, "Song", "video")).toBe(path.join(dir, "Song.ytvid"));
      expect(uniquePackage(dir, "Song", "music", path.join(dir, "Song.ytsng"))).toBe(path.join(dir, "Song.ytsng"));
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

  async function start(options: Partial<Pick<AppOptions, "app" | "dataDir" | "recentsFrom">> = {}) {
    const editor = await createApp({
      projectsDir: documents,
      ...options,
      dataDir: options.dataDir ?? dataDir,
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
    documents = path.join(tmp, "Documents", "YTStudio");
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
    expect([a.path, b.path]).toEqual([path.join(documents, "Summer edit.ytvid"), path.join(documents, "Summer edit 2.ytvid")]);
    expect(readdirSync(a.path).sort()).toEqual(["media", "meta.json", "project.json"]);

    // Opening one doesn't move it up the recents; saving one does.
    await send("POST", `/api/projects/${a.id}/opened`);
    expect((await list()).map((p) => p.id)).toEqual([b.id, a.id]);
    await send("PUT", `/api/projects/${a.id}`, (await send<Project>("GET", `/api/projects/${a.id}`)).body);
    expect((await list()).map((p) => p.id)).toEqual([a.id, b.id]);
    await send("POST", `/api/projects/${b.id}/reveal`);
    expect(revealed).toEqual([b.path]);

    // Another folder for new ones (made if need be), kept.
    const elsewhere = path.join(tmp, "Elsewhere");
    expect((await send<ProjectLocation>("PUT", "/api/projects/location", { path: elsewhere })).body.path).toBe(elsewhere);
    const c = await create("Third");
    expect(c.path).toBe(path.join(elsewhere, "Third.ytvid"));
    expect((await send("PUT", "/api/projects/location", { path: "relative/dir" })).status).toBe(400);
    expect((await send("PUT", "/api/projects/location", { path: a.path })).status).toBe(400);

    await stop();
    await start();
    expect((await list()).map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    expect((await send<ProjectLocation>("GET", "/api/projects/location")).body.path).toBe(elsewhere);
  });

  it("brings projects from before the app was YTStudio along: the folder, the recents, the extension", async () => {
    await start();
    const a = await create("Summer edit");
    const elsewhere = path.join(tmp, "Elsewhere");
    await send("PUT", "/api/projects/location", { path: elsewhere });
    const b = await create("Beat");
    await send("PUT", "/api/projects/location", { path: documents });
    await stop();
    // As Vaudio left them: ~/Documents/Vaudio, `.vaudio` packages, the recents saying so.
    const legacy = path.join(tmp, "Documents", "Vaudio");
    renameSync(documents, legacy);
    renameSync(path.join(legacy, "Summer edit.ytvid"), path.join(legacy, "Summer edit.vaudio"));
    renameSync(b.path, path.join(elsewhere, "Beat.vaudio"));
    const recentsFile = path.join(dataDir, "projects.json");
    writeFileSync(recentsFile, readFileSync(recentsFile, "utf8").replaceAll(documents, legacy).replaceAll(".ytvid", ".vaudio"));
    // One never opened here, from a backup.
    const backup = path.join(tmp, "Backup", "Old.vaudio");
    cpSync(path.join(legacy, "Summer edit.vaudio"), backup, { recursive: true });

    await start();
    expect(existsSync(legacy)).toBe(false);
    const byId = new Map((await list()).map((p) => [p.id, p]));
    expect(byId.get(a.id)).toMatchObject({ name: "Summer edit", path: path.join(documents, "Summer edit.ytvid") });
    expect(byId.get(b.id)).toMatchObject({ name: "Beat", path: path.join(elsewhere, "Beat.ytvid") });
    expect(existsSync(path.join(documents, "Summer edit.ytvid", "project.json"))).toBe(true);
    expect((await create("New")).path).toBe(path.join(documents, "New.ytvid"));

    // Opened, an old package takes its suite's extension at once.
    const old = (await open(backup)).body;
    expect(old.path).toBe(path.join(tmp, "Backup", "Old.ytvid"));
    expect(existsSync(backup)).toBe(false);
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
    expect(closed.path).toBe(path.join(documents, "Anthem.ytsng"));
    expect(existsSync(song.path)).toBe(false);
    // Closed, a rename moves it at once.
    expect((await send<ProjectSummary>("PATCH", `/api/projects/${song.id}`, { name: "Anthem / final" })).body.path).toBe(path.join(documents, "Anthem - final.ytsng"));
  });

  it("shows one app's projects only, keeping the others' recents, and turns down another app's file", async () => {
    await start();
    const cut = await create("Cut");
    const beat = (await send<ProjectSummary>("POST", "/api/projects", { suite: "music", name: "Beat" })).body;
    await stop();
    // As one YTStudio left them: `.yt`, whatever the suite.
    const oldCut = path.join(documents, "Cut.yt");
    const oldBeat = path.join(documents, "Beat.yt");
    renameSync(cut.path, oldCut);
    renameSync(beat.path, oldBeat);
    const recentsFile = path.join(dataDir, "projects.json");
    writeFileSync(recentsFile, readFileSync(recentsFile, "utf8").replaceAll(".ytvid", ".yt").replaceAll(".ytsng", ".yt"));

    await start({ app: "video" });
    expect((await send<AppResponse>("GET", "/api/app")).body).toEqual({ app: "video" });
    // The video is listed and takes its extension; the song is neither.
    expect((await list()).map((p) => [p.id, p.path])).toEqual([[cut.id, path.join(documents, "Cut.ytvid")]]);
    expect(existsSync(oldBeat)).toBe(true);
    const refused = await send<{ error: string }>("POST", "/api/projects/open", { path: oldBeat });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/is a song: open it in YTStudio Music/);
    expect((await send("POST", "/api/projects", { suite: "music", name: "No" })).status).toBe(400);
    expect((await create("Default")).path).toBe(path.join(documents, "Default.ytvid"));
    await stop();

    // Every suite again: the song was kept, and is renamed now.
    await start();
    expect((await send<AppResponse>("GET", "/api/app")).body).toEqual({ app: null });
    expect(new Map((await list()).map((p) => [p.id, p.path])).get(beat.id)).toBe(path.join(documents, "Beat.ytsng"));
    await stop();

    // A new app's data folder starts with the shared one's recents, its own suites' only, and the location.
    const musicData = path.join(tmp, "apps", "music");
    await start({ app: "music", dataDir: musicData, recentsFrom: dataDir });
    expect((await list()).map((p) => p.id)).toEqual([beat.id]);
    expect((await send("POST", "/api/music/visualizer", {})).status).toBe(400);
    await stop();
    // Once only: what it does then is its own.
    writeFileSync(path.join(musicData, "projects.json"), JSON.stringify({ recent: [] }));
    await start({ app: "music", dataDir: musicData, recentsFrom: dataDir });
    expect(await list()).toEqual([]);
  });

  it("takes the document's name for a recent renamed in the app while the server stopped", async () => {
    await start();
    const a = await create("First name");
    await send("POST", `/api/projects/${a.id}/opened`);
    const doc = (await send<object>("GET", `/api/projects/${a.id}`)).body;
    await send("PUT", `/api/projects/${a.id}`, { ...doc, name: "Second name" });
    await stop();
    await start();
    expect((await list())[0]).toMatchObject({ name: "Second name", path: path.join(documents, "Second name.ytvid") });
  });

  it("opens a package from anywhere, by its folder or a file in it, and takes its folder's name", async () => {
    await start();
    const a = await create("Mine");
    await stop();
    // Moved and renamed in Finder while the app was closed: it's missing where it was.
    const moved = path.join(tmp, "Desktop", "Renamed.ytvid");
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

    // Moved again while the app runs: the list says so at once.
    const again = path.join(tmp, "Desktop", "Again.ytvid");
    renameSync(moved, again);
    expect((await list())[0]).toMatchObject({ id: a.id, missing: true, path: moved });
    expect((await open(again)).body).toMatchObject({ id: a.id, name: "Again", path: again });

    expect((await open(path.join(tmp, "nothing-here"))).status).toBe(404);
    expect((await open(tmp)).status).toBe(400);
    expect((await open("relative.yt")).status).toBe(400);
  });

  it("gives a copy made in Finder ids of its own, its media too", async () => {
    await start();
    const a = await create("Original");
    await stop();
    const asset = seedMedia(a.path, a.id, "media_00000000000a");
    const copy = path.join(documents, "Original copy.ytvid");
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

  it("deletes a project made by New and left untouched when its tab closes, and keeps any other", async () => {
    await start();
    const discard = async (id: string) => (await send<{ discarded: boolean }>("POST", `/api/projects/${id}/discard`)).body.discarded;
    const left = await create("Left");
    const renamed = await create("Named");
    const later = await create("Later");
    const kept = await create("Kept");

    await send("POST", `/api/projects/${left.id}/opened`);
    await send("POST", `/api/projects/${left.id}/closed`);
    expect(await discard(left.id)).toBe(true);
    expect(existsSync(left.path)).toBe(false);
    expect(trashed).toEqual([]);
    expect((await list()).map((p) => p.id)).not.toContain(left.id);
    expect(await discard(left.id)).toBe(false);

    // Renamed: that's something done to it.
    await send("PATCH", `/api/projects/${renamed.id}`, { name: "Named it" });
    expect(await discard(renamed.id)).toBe(false);
    // Open again (in another tab, or reopened at once): not now.
    await send("POST", `/api/projects/${later.id}/opened`);
    expect(await discard(later.id)).toBe(false);
    await send("POST", `/api/projects/${later.id}/closed`);
    // A copy, or one opened from a file, wasn't made by New.
    const copy = (await send<ProjectSummary>("POST", `/api/projects/${kept.id}/duplicate`)).body;
    expect(await discard(copy.id)).toBe(false);
    await send("DELETE", `/api/projects/${kept.id}/recent`);
    const reopened = (await open(kept.path)).body;
    expect(await discard(reopened.id)).toBe(false);

    // Still untouched after a restart (its tab was open when the app quit).
    await stop();
    await start();
    expect(await discard(later.id)).toBe(true);
    expect(existsSync(later.path)).toBe(false);
    expect((await list()).map((p) => p.name).sort()).toEqual(["Kept", "Kept copy", "Named it"]);
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
    expect(next.path).toBe(path.join(documents, "From it.ytvid"));
    expect((await list()).map((p) => p.name)).toEqual(["From it", "Setup"]);
    const template = path.join(dataDir, "templates", readdirSync(path.join(dataDir, "templates"))[0]);
    expect((await open(template)).status).toBe(400);
    expect((await send<ProjectSummary>("POST", "/api/projects", { name: "Copy", blank: true })).body).toMatchObject({ clipCount: 0 });
  });

  /** The copies of a package's damaged document kept beside it. */
  const damagedCopies = (pkg: string) => readdirSync(pkg).filter((f) => /^project\.corrupt-.+\.json$/.test(f));

  it("never writes over a damaged document: it's kept aside once, listed as damaged and refused", async () => {
    await start();
    const a = await create("Broken");
    const healthy = readFileSync(path.join(a.path, "project.json"));
    await stop();
    const broken = Buffer.from('{"name":"Broken","tracks":[');
    writeFileSync(path.join(a.path, "project.json"), broken);
    await start();

    const [listed] = await list();
    expect(listed).toMatchObject({ id: a.id, name: "Broken" });
    expect(listed.missing).toBeUndefined();
    expect(listed.damaged).toMatch(/isn't valid JSON/);
    const copies = damagedCopies(a.path);
    expect(copies).toHaveLength(1);
    expect(listed.damaged).toContain(path.join(a.path, copies[0]));
    expect(readFileSync(path.join(a.path, copies[0])).equals(broken)).toBe(true);

    // Opening, saving, renaming, copying: all refused, the file as it was.
    const opened = await send<{ error: string }>("GET", `/api/projects/${a.id}`);
    expect(opened.status).toBe(422);
    expect(opened.body.error).toBe(listed.damaged);
    expect((await send("PUT", `/api/projects/${a.id}`, JSON.parse(healthy.toString("utf8")))).status).toBe(422);
    expect((await send("PATCH", `/api/projects/${a.id}`, { name: "Renamed" })).status).toBe(422);
    expect((await send("POST", `/api/projects/${a.id}/duplicate`)).status).toBe(422);
    expect((await send("POST", `/api/projects/${a.id}/template`)).status).toBe(422);
    expect(readFileSync(path.join(a.path, "project.json")).equals(broken)).toBe(true);
    expect(readdirSync(documents)).toEqual(["Broken.ytvid"]);

    // Read again and again, across restarts: still the one copy.
    await stop();
    await start();
    expect((await send("GET", `/api/projects/${a.id}`)).status).toBe(422);
    expect(damagedCopies(a.path)).toEqual(copies);
    expect((await list())[0].damaged).toBeDefined();

    // Mended by hand: it opens and saves again.
    writeFileSync(path.join(a.path, "project.json"), healthy);
    const doc = (await send<Project>("GET", `/api/projects/${a.id}`)).body;
    expect(doc.name).toBe("Broken");
    expect((await list())[0].damaged).toBeUndefined();
    expect((await send<ProjectSummary>("PUT", `/api/projects/${a.id}`, { ...doc, name: "Fixed" })).body.name).toBe("Fixed");
  });

  it("refuses a document its suite can't repair, and one that isn't a document, leaving healthy ones be", async () => {
    // The suites repair almost anything: one that gives up is stood in for.
    const normalize = videoSuite.normalize;
    const spy = vi.spyOn(videoSuite, "normalize").mockImplementation((doc, media) => {
      if ((doc as { poison?: unknown }).poison) throw new Error("tracks beyond repair");
      return normalize(doc, media);
    });
    try {
      await start();
      const a = await create("Poisoned");
      const b = await create("Healthy");
      const doc = (await send<Project>("GET", `/api/projects/${a.id}`)).body;
      const poisoned = Buffer.from(JSON.stringify({ ...doc, poison: true }));
      writeFileSync(path.join(a.path, "project.json"), poisoned);

      const opened = await send<{ error: string }>("GET", `/api/projects/${a.id}`);
      expect(opened.status).toBe(422);
      expect(opened.body.error).toMatch(/can't be repaired \(tracks beyond repair\)/);
      expect((await list()).find((p) => p.id === a.id)?.damaged).toBe(opened.body.error);
      expect((await send("PUT", `/api/projects/${a.id}`, doc)).status).toBe(422);
      expect(readFileSync(path.join(a.path, "project.json")).equals(poisoned)).toBe(true);
      const [copy] = damagedCopies(a.path);
      expect(readFileSync(path.join(a.path, copy)).equals(poisoned)).toBe(true);

      // Valid JSON that isn't an object is no document either: a second content, a second copy.
      writeFileSync(path.join(a.path, "project.json"), "null");
      expect((await send<{ error: string }>("GET", `/api/projects/${a.id}`)).body.error).toMatch(/isn't a video/);
      expect(damagedCopies(a.path)).toHaveLength(2);
      expect(readFileSync(path.join(a.path, "project.json"), "utf8")).toBe("null");

      // The other project is untouched by any of it.
      const other = (await send<Project>("GET", `/api/projects/${b.id}`)).body;
      const saved = await send<ProjectSummary>("PUT", `/api/projects/${b.id}`, { ...other, name: "Still healthy" });
      expect(saved.status).toBe(200);
      expect((await list()).find((p) => p.id === b.id)).toMatchObject({ name: "Still healthy" });
      expect((await list()).find((p) => p.id === b.id)?.damaged).toBeUndefined();
      expect(damagedCopies(saved.body.path)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to give a damaged copy made in Finder ids of its own, changing nothing in it", async () => {
    await start();
    const a = await create("Original");
    await stop();
    seedMedia(a.path, a.id, "media_00000000000b");
    const copy = path.join(documents, "Original copy.ytvid");
    cpSync(a.path, copy, { recursive: true });
    writeFileSync(path.join(copy, "project.json"), "{ not json");
    const meta = readFileSync(path.join(copy, "meta.json"));
    await start();

    const opened = await open(copy);
    expect(opened.status).toBe(422);
    expect((opened.body as unknown as { error: string }).error).toMatch(/isn't valid JSON/);
    expect(readFileSync(path.join(copy, "project.json"), "utf8")).toBe("{ not json");
    expect(readFileSync(path.join(copy, "meta.json")).equals(meta)).toBe(true);
    expect(readdirSync(path.join(copy, "media"))).toEqual(["media_00000000000b"]);
    expect(damagedCopies(copy)).toHaveLength(1);
    expect((await list()).map((p) => p.id)).toEqual([a.id]);
  });

  it("makes a new document for a package that has none (there's nothing to lose)", async () => {
    await start();
    const a = await create("Emptied");
    await stop();
    rmSync(path.join(a.path, "project.json"));
    await start();
    expect((await list())[0].damaged).toBeUndefined();
    expect((await send<Project>("GET", `/api/projects/${a.id}`)).body).toMatchObject({ name: "Emptied", clips: [] });
    expect(damagedCopies(a.path)).toEqual([]);
  });

  it("duplicates a package's own folders without their caches or renditions, its cover too", async () => {
    await start();
    const a = await create("Layers");
    mkdirSync(path.join(a.path, "photo", "resources"), { recursive: true });
    mkdirSync(path.join(a.path, "photo", "cache"), { recursive: true });
    mkdirSync(path.join(a.path, "photo", "deep", "cache"), { recursive: true });
    mkdirSync(path.join(a.path, ".preview"));
    writeFileSync(path.join(a.path, "photo", "resources", "x"), "pixels");
    writeFileSync(path.join(a.path, "photo", "cache", "y"), "tiles");
    writeFileSync(path.join(a.path, "photo", "deep", "cache", "z"), "not a top cache");
    writeFileSync(path.join(a.path, ".preview", "preview.json"), "{}");
    writeFileSync(path.join(a.path, ".preview", "preview.mp4"), "rendition");

    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("cover")]);
    expect((await putCover(a.id, png, "image/png")).status).toBe(204);

    const copy = (await send<ProjectSummary>("POST", `/api/projects/${a.id}/duplicate`)).body;
    expect(copy.path).toBe(path.join(documents, "Layers copy.ytvid"));
    expect(readFileSync(path.join(copy.path, "photo", "resources", "x"), "utf8")).toBe("pixels");
    expect(existsSync(path.join(copy.path, "photo", "cache"))).toBe(false);
    expect(readFileSync(path.join(copy.path, "photo", "deep", "cache", "z"), "utf8")).toBe("not a top cache");
    expect(readdirSync(path.join(copy.path, ".preview"))).toEqual(["cover.png"]);
    expect(copy.thumbnail).toMatch(new RegExp(`^/api/projects/${copy.id}/cover\\?v=\\d+$`));
    // The original keeps everything.
    expect(readFileSync(path.join(a.path, "photo", "cache", "y"), "utf8")).toBe("tiles");
  });

  async function putCover(id: string, bytes: Buffer, type: string) {
    const res = await fetch(`${base}/api/projects/${id}/cover`, { method: "PUT", headers: { "Content-Type": type }, body: new Uint8Array(bytes) });
    return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as { error: string }) };
  }

  it("keeps a cover the tab drew as the card's picture", async () => {
    await start();
    const a = await create("Composite");
    const b = await create("Plain");
    expect(a.thumbnail).toBeNull();
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png pixels")]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg pixels")]);

    expect((await putCover(a.id, Buffer.from("GIF89a nope"), "image/png")).status).toBe(415);
    expect((await putCover(a.id, Buffer.alloc(0), "image/png")).status).toBe(415);
    const big = Buffer.concat([png, Buffer.alloc(MAX_COVER_BYTES)]);
    expect((await putCover(a.id, big, "image/png")).status).toBe(413);
    expect((await putCover("project_000000000000", png, "image/png")).status).toBe(404);
    expect((await send("GET", `/api/projects/${a.id}/cover`)).status).toBe(404);
    expect((await list()).find((p) => p.id === a.id)?.thumbnail).toBeNull();

    expect((await putCover(a.id, png, "image/png")).status).toBe(204);
    const first = (await list()).find((p) => p.id === a.id)!.thumbnail!;
    expect(first).toMatch(new RegExp(`^/api/projects/${a.id}/cover\\?v=\\d+$`));
    const served = await fetch(base + first);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer()).equals(png)).toBe(true);

    // Replaced by a JPEG: a new URL, the PNG gone.
    expect((await putCover(a.id, jpeg, "application/octet-stream")).status).toBe(204);
    const second = (await list()).find((p) => p.id === a.id)!.thumbnail!;
    expect(second).not.toBe(first);
    expect(readdirSync(path.join(a.path, ".preview"))).toEqual(["cover.jpg"]);
    expect(Buffer.from(await (await fetch(base + second)).arrayBuffer()).equals(jpeg)).toBe(true);
    expect((await list()).find((p) => p.id === b.id)?.thumbnail).toBeNull();

    // Found again after a restart.
    await stop();
    await start();
    expect((await list()).find((p) => p.id === a.id)?.thumbnail).toMatch(new RegExp(`^/api/projects/${a.id}/cover\\?v=\\d+$`));
  });
});
