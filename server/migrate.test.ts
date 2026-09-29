import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
  const assetDir = () => path.join(dataDir, "media", ASSET_ID);
  const readMeta = () => JSON.parse(readFileSync(path.join(assetDir(), "meta.json"), "utf8")) as MediaAsset;

  async function start() {
    const editor = await createApp({ dataDir });
    const server = http.createServer(editor.app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    running = { editor, server };
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  it("turns the legacy project.json into a project that owns the existing media", async () => {
    seedAsset();
    const legacyFile = path.join(dataDir, "project.json");
    writeFileSync(legacyFile, JSON.stringify(legacyProject));
    utimesSync(legacyFile, MTIME, MTIME);

    const get = await start();
    const [summary, ...rest] = await get<ProjectSummary[]>("/api/projects");
    expect(rest).toEqual([]);
    expect(summary).toMatchObject({
      name: "My short", status: "active", settledAt: null, createdAt: MTIME.getTime(),
      updatedAt: MTIME.getTime(), aspectRatio: "1:1", duration: 2, clipCount: 1,
      thumbnail: legacyAsset.poster,
    });
    expect(await get<Project>(`/api/projects/${summary.id}`)).toEqual(upgradedProject);
    expect((await get<MediaAsset[]>(`/api/media?projectId=${summary.id}`)).map((a) => a.id)).toEqual([ASSET_ID]);

    // Files are moved/tagged, never deleted.
    expect(readMeta()).toEqual({ ...legacyAsset, projectId: summary.id });
    expect(readFileSync(path.join(assetDir(), "source.mp4"), "utf8")).toBe("data");
    expect(existsSync(legacyFile)).toBe(false);
    expect(JSON.parse(readFileSync(`${legacyFile}.migrated`, "utf8"))).toEqual(legacyProject);
    const projectDir = path.join(dataDir, "projects", summary.id);
    expect(JSON.parse(readFileSync(path.join(projectDir, "project.json"), "utf8"))).toEqual(upgradedProject);
    expect(JSON.parse(readFileSync(path.join(projectDir, "meta.json"), "utf8"))).toEqual({
      id: summary.id, status: "active", createdAt: MTIME.getTime(), updatedAt: MTIME.getTime(), settledAt: null,
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
    expect(summary).toMatchObject({ name: "Imported media", status: "active", clipCount: 0, thumbnail: null });
    expect(readMeta().projectId).toBe(summary.id);
  });

  it("doesn't create a project when there's nothing to migrate", async () => {
    const get = await start();
    expect(await get<ProjectSummary[]>("/api/projects")).toEqual([]);
  });
});
