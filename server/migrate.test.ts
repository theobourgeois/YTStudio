import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultEffects } from "../shared/effects.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import type { MediaAsset, Project, ProjectSummary } from "../shared/types.ts";
import { createApp, type EditorApp } from "./app.ts";

const ASSET_ID = "media_0123456789ab";
const MTIME = new Date("2026-09-01T12:00:00Z");

/** An asset as saved before projects existed (no `projectId`). */
const legacyAsset: Omit<MediaAsset, "projectId"> = {
  id: ASSET_ID, name: "clip.mp4", kind: "video", duration: 5, width: 1920, height: 1080, fps: 30,
  hasVideo: true, hasAudio: true, size: 4, createdAt: 1, status: "ready",
  src: `/files/media/${ASSET_ID}/source.mp4`, poster: `/files/media/${ASSET_ID}/poster.jpg`,
  filmstrip: null, waveform: null,
};

/** Saved before effects existed: the clip's volume and framing were fields of the clip. */
const legacyClip = { id: "clip_1", assetId: ASSET_ID, trackId: "main", start: 0, in: 1, out: 3, volume: 0.5, fit: "cover" };
const legacyProject = {
  ...createDefaultProject(),
  name: "My short",
  settings: { aspectRatio: "1:1" as const, fps: 30, background: "#000000" },
  clips: [legacyClip],
};

/** The same project today: volume and framing moved into the clip's effects. */
const upgradedProject: Project = {
  ...legacyProject,
  // Projects used to carry a canvas colour; the canvas is always black now.
  settings: { aspectRatio: "1:1", fps: 30 },
  clips: [{
    id: "clip_1", assetId: ASSET_ID, trackId: "main", start: 0, in: 1, out: 3,
    effects: defaultEffects().map((e) =>
      e.type === "motion" ? { ...e, params: { ...e.params, fit: "cover" } }
      : e.type === "volume" ? { ...e, params: { level: 0.5 } }
      : e),
  }],
};

describe("legacy data migration", () => {
  let dataDir: string;
  let running: { editor: EditorApp; server: http.Server } | undefined;
  let base = "";
  const fetchText = (p: string) => fetch(base + p).then((r) => r.text());
  const assetDir = () => path.join(dataDir, "media", ASSET_ID);

  async function start() {
    const editor = await createApp({ dataDir });
    const server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    running = { editor, server };
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return <T>(p: string) => fetch(base + p).then((r) => r.json() as Promise<T>);
  }

  async function stop() {
    if (!running) return;
    running.editor.shutdown();
    running.server.closeAllConnections();
    await new Promise((resolve) => running!.server.close(resolve));
    running = undefined;
  }

  function seedAsset() {
    mkdirSync(assetDir(), { recursive: true });
    writeFileSync(path.join(assetDir(), "meta.json"), JSON.stringify(legacyAsset));
    writeFileSync(path.join(assetDir(), "source.mp4"), "data");
  }

  beforeEach(() => {
    dataDir = path.join(mkdtempSync(path.join(os.tmpdir(), "editor-migrate-")), "data");
    mkdirSync(dataDir);
  });

  afterEach(async () => {
    await stop();
    rmSync(path.dirname(dataDir), { recursive: true, force: true });
  });

  const projectsDir = () => path.join(dataDir, "Documents", "Vaudio");

  it("turns the legacy project.json into a project package that owns the existing media", async () => {
    seedAsset();
    const legacyFile = path.join(dataDir, "project.json");
    writeFileSync(legacyFile, JSON.stringify(legacyProject));
    utimesSync(legacyFile, MTIME, MTIME);

    const get = await start();
    const [summary, ...rest] = await get<ProjectSummary[]>("/api/projects");
    expect(rest).toEqual([]);
    const pkg = path.join(projectsDir(), "My short.vaudio");
    expect(summary).toMatchObject({
      suite: "video", name: "My short", createdAt: MTIME.getTime(), updatedAt: MTIME.getTime(), openedAt: MTIME.getTime(),
      aspectRatio: "1:1", duration: 2, clipCount: 1, thumbnail: legacyAsset.poster, path: pkg,
    });
    expect(await get<Project>(`/api/projects/${summary.id}`)).toEqual(upgradedProject);
    expect((await get<MediaAsset[]>(`/api/media?projectId=${summary.id}`)).map((a) => a.id)).toEqual([ASSET_ID]);

    // Files are moved into the package, never deleted, and served where they were.
    const moved = path.join(pkg, "media", ASSET_ID);
    expect(JSON.parse(readFileSync(path.join(moved, "meta.json"), "utf8"))).toEqual({ ...legacyAsset, projectId: summary.id });
    expect(readFileSync(path.join(moved, "source.mp4"), "utf8")).toBe("data");
    expect(existsSync(assetDir())).toBe(false);
    expect(await fetchText(`/files/media/${ASSET_ID}/source.mp4`)).toBe("data");
    expect(existsSync(legacyFile)).toBe(false);
    expect(JSON.parse(readFileSync(`${legacyFile}.migrated`, "utf8"))).toEqual(legacyProject);
    expect(JSON.parse(readFileSync(path.join(pkg, "project.json"), "utf8"))).toEqual(upgradedProject);
    expect(JSON.parse(readFileSync(path.join(pkg, "meta.json"), "utf8"))).toEqual({
      id: summary.id, suite: "video", createdAt: MTIME.getTime(), updatedAt: MTIME.getTime(),
    });

    // Idempotent: a restart changes nothing.
    await stop();
    const again = await start();
    expect(await again<ProjectSummary[]>("/api/projects")).toEqual([summary]);
  });

  it("puts untagged media into an 'Imported media' project when there's no legacy file", async () => {
    seedAsset();
    const get = await start();
    const [summary, ...rest] = await get<ProjectSummary[]>("/api/projects");
    expect(rest).toEqual([]);
    expect(summary).toMatchObject({ name: "Imported media", clipCount: 0, thumbnail: null, path: path.join(projectsDir(), "Imported media.vaudio") });
    expect(JSON.parse(readFileSync(path.join(summary.path, "media", ASSET_ID, "meta.json"), "utf8")).projectId).toBe(summary.id);
  });

  it("doesn't create a project when there's nothing to migrate", async () => {
    const get = await start();
    expect(await get<ProjectSummary[]>("/api/projects")).toEqual([]);
    expect(existsSync(path.join(dataDir, "projects"))).toBe(false);
  });

  /** A project of the layout before packages: `projects/<id>/` and its media in `media/<id>/`. */
  function seedOldProject(id: string, name: string, meta: Record<string, unknown>) {
    const dir = path.join(dataDir, "projects", id);
    mkdirSync(path.join(dir, "plugins"), { recursive: true });
    writeFileSync(path.join(dir, "project.json"), JSON.stringify({ ...legacyProject, name }));
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, suite: "video", createdAt: 1, updatedAt: 2, ...meta }));
    writeFileSync(path.join(dir, "plugins", "chan_x.bin"), "state");
    return dir;
  }

  it("makes each project of the old layout a package (settled ones too), and starting points hidden ones", async () => {
    const [mine, done, start2] = ["project_00000000000a", "project_00000000000b", "project_00000000000c"];
    seedOldProject(mine, "Launch / teaser", { status: "active", settledAt: null, updatedAt: 30 });
    seedOldProject(done, "Old one", { status: "settled", settledAt: 5, updatedAt: 20 });
    seedOldProject(start2, "My setup", { status: "active", settledAt: null, template: true });
    mkdirSync(assetDir(), { recursive: true });
    writeFileSync(path.join(assetDir(), "meta.json"), JSON.stringify({ ...legacyAsset, projectId: mine }));
    writeFileSync(path.join(assetDir(), "source.mp4"), "data");

    const get = await start();
    const list = await get<ProjectSummary[]>("/api/projects");
    // "/" can't be in a file's name.
    expect(list.map((p) => [p.id, p.name, path.relative(projectsDir(), p.path)])).toEqual([
      [mine, "Launch / teaser", "Launch - teaser.vaudio"],
      [done, "Old one", "Old one.vaudio"],
    ]);
    expect(list[0]).toMatchObject({ clipCount: 1, thumbnail: legacyAsset.poster });
    expect(readFileSync(path.join(list[0].path, "plugins", "chan_x.bin"), "utf8")).toBe("state");
    expect(JSON.parse(readFileSync(path.join(list[1].path, "meta.json"), "utf8"))).toEqual({ id: done, suite: "video", createdAt: 1, updatedAt: 20 });
    expect(await get("/api/projects/templates")).toMatchObject({ video: { name: "My setup" } });
    expect(existsSync(path.join(dataDir, "templates", `${start2}.vaudio`, "plugins", "chan_x.bin"))).toBe(true);
    expect(existsSync(path.join(dataDir, "projects"))).toBe(false);
    expect(existsSync(path.join(dataDir, "media"))).toBe(false);

    await stop();
    const again = await start();
    expect(await again<ProjectSummary[]>("/api/projects")).toEqual(list);
  });

  it("carries on a move into a package that stopped halfway", async () => {
    const id = "project_00000000000d";
    const old = seedOldProject(id, "Halfway", { status: "active", settledAt: null });
    // Its media and document were moved; its meta.json wasn't yet.
    const partial = path.join(projectsDir(), `.migrating-${id}`);
    mkdirSync(path.join(partial, "media"), { recursive: true });
    seedAsset();
    writeFileSync(path.join(assetDir(), "meta.json"), JSON.stringify({ ...legacyAsset, projectId: id }));
    renameSync(assetDir(), path.join(partial, "media", ASSET_ID));
    renameSync(path.join(old, "project.json"), path.join(partial, "project.json"));

    const get = await start();
    const [summary, ...rest] = await get<ProjectSummary[]>("/api/projects");
    expect(rest).toEqual([]);
    expect(summary).toMatchObject({ id, name: "Halfway", clipCount: 1, path: path.join(projectsDir(), "Halfway.vaudio") });
    expect(existsSync(partial)).toBe(false);
  });
});
