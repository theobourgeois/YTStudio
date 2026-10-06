/**
 * The photo suite's faults through the real server (docs/photo/foundations-prototype.md, F5): what a save, a crash,
 * damage in the package and a full disk leave, and what opening does about it. The helper's own (killed
 * mid-decode and mid-encode) are in helper.test.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addPixelLayer, setSurface } from "../../shared/photo/edits.ts";
import { canonicalJson, emptySurface, withTiles } from "../../shared/photo/surfaces.ts";
import type { PhotoProject } from "../../shared/photo/types.ts";
import { PROJECT_NOTICE_HEADER, type ProjectSummary } from "../../shared/types.ts";
import { createApp, type EditorApp } from "../app.ts";
import { sha256 } from "./blobs.ts";
import { PhotoHelper } from "./helper.ts";
import { PhotoService } from "./service.ts";

let tmp: string;
let running: { editor: EditorApp; server: http.Server } | undefined;
let base = "";

async function start(projectsDir = path.join(tmp, "Documents")) {
  const editor = await createApp({ dataDir: path.join(tmp, "data"), projectsDir });
  const server = http.createServer(editor.app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running = { editor, server };
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The server stops at once (as when it's killed: nothing is flushed on the way out). */
async function stop() {
  if (!running) return;
  running.editor.shutdown();
  running.server.closeAllConnections();
  await new Promise<void>((resolve) => running!.server.close(() => resolve()));
  running = undefined;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "photo-faults-"));
});
afterEach(async () => {
  await stop();
  await fs.rm(tmp, { recursive: true, force: true });
});

const json = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; body: T; headers: Headers }> => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T, headers: res.headers };
};

/** Uploads a one-tile surface into the project, as the tab does after a stroke: its id and its files. */
async function upload(projectId: string, seed: number) {
  const samples = new Uint8Array(256 * 256 * 8).map((_, i) => (i * 29 + seed) & 255);
  const tile = sha256(samples);
  const put = await fetch(`${base}/api/photo/projects/${projectId}/blobs/${tile}`, { method: "PUT", body: samples });
  if (!put.ok) return { status: put.status, error: ((await put.json()) as { error: string }).error };
  const manifest = withTiles(emptySurface("rgba16f", 256, [0, 0, 0, 0]), [[0, 0, tile]]);
  const id = sha256(canonicalJson(manifest));
  const res = await json<{ error?: string }>("PUT", `/api/photo/projects/${projectId}/manifests/${id}`, manifest);
  return { status: res.status, error: res.body.error, id, tile };
}

async function newPhoto(): Promise<{ summary: ProjectSummary; doc: PhotoProject }> {
  const summary = (await json<ProjectSummary>("POST", "/api/projects", { name: "Night", suite: "photo" })).body;
  const doc = (await json<PhotoProject>("GET", `/api/projects/${summary.id}`)).body;
  return { summary, doc: addPixelLayer(doc, { id: "p", name: "Paint" }) };
}

const painted = (doc: PhotoProject, surface: string) => setSurface(doc, "p", surface);
const surfaceOf = (doc: PhotoProject) => (doc.layers.find((l) => l.id === "p") as { surface: string | null }).surface;
const resources = (dir: string) => path.join(dir, "photo", "resources");
const manifestFile = (dir: string, id: string) => path.join(resources(dir), "manifests", id.slice(0, 2), `${id}.json`);

describe("saving and opening a photo", () => {
  it("keeps the replaced version, and opens it when the saved one's pixels are gone", async () => {
    await start();
    const { summary, doc } = await newPhoto();
    const first = await upload(summary.id, 1);
    const second = await upload(summary.id, 2);
    expect((await json("PUT", `/api/projects/${summary.id}`, painted(doc, first.id!))).status).toBe(200);
    expect((await json("PUT", `/api/projects/${summary.id}`, painted(doc, second.id!))).status).toBe(200);
    const checkpoint = JSON.parse(await fs.readFile(path.join(summary.path, "photo", "recovery", "previous.json"), "utf8")) as PhotoProject;
    expect(surfaceOf(checkpoint)).toBe(first.id);

    const whole = await json<PhotoProject>("GET", `/api/projects/${summary.id}`);
    expect(surfaceOf(whole.body)).toBe(second.id);
    expect(whole.headers.get(PROJECT_NOTICE_HEADER)).toBeNull();

    // Deleted outside the app (a sync tool, a clean-up): the latest version can't be drawn.
    await fs.rm(manifestFile(summary.path, second.id!));
    const opened = await json<PhotoProject>("GET", `/api/projects/${summary.id}`);
    expect(surfaceOf(opened.body)).toBe(first.id);
    expect(decodeURIComponent(opened.headers.get(PROJECT_NOTICE_HEADER)!)).toMatch(/^Pixels of "Paint" were missing/);
    // It's what's saved now; the incomplete one is kept.
    const saved = JSON.parse(await fs.readFile(path.join(summary.path, "project.json"), "utf8")) as PhotoProject;
    expect(surfaceOf(saved)).toBe(first.id);
    expect((await fs.readdir(path.join(summary.path, "photo", "recovery"))).some((n) => n.startsWith("incomplete-"))).toBe(true);
    expect((await json<PhotoProject>("GET", `/api/projects/${summary.id}`)).headers.get(PROJECT_NOTICE_HEADER)).toBeNull();
  });

  it("opens what was saved when a write was interrupted", async () => {
    await start();
    const { summary, doc } = await newPhoto();
    const s = await upload(summary.id, 3);
    await json("PUT", `/api/projects/${summary.id}`, painted(doc, s.id!));
    // A save cut off before its rename (the server killed, the power gone): a half-written temporary file.
    await fs.writeFile(path.join(summary.path, "project.json.0123456789ab.tmp"), '{"version":5,"name":"Ni');
    await stop();
    await start();
    const opened = await json<PhotoProject>("GET", `/api/projects/${summary.id}`);
    expect(opened.status).toBe(200);
    expect(surfaceOf(opened.body)).toBe(s.id);
  });

  it("collects what was uploaded but never saved when the server died, keeping what's saved", async () => {
    await start();
    const { summary, doc } = await newPhoto();
    const saved = await upload(summary.id, 4);
    await json("PUT", `/api/projects/${summary.id}`, painted(doc, saved.id!));
    const pending = await upload(summary.id, 5);
    // Killed with the stroke's upload done and its save still waiting (and a blob write cut off mid-way).
    await stop();
    const leftover = `${manifestFile(summary.path, pending.id!)}.fedcba987654.tmp`;
    await fs.writeFile(leftover, "{");
    const old = new Date(Date.now() - 60_000);
    for (const file of await walk(resources(summary.path))) await fs.utimes(file, old, old);
    await start();
    await json("POST", `/api/projects/${summary.id}/opened`);
    expect(existsSync(manifestFile(summary.path, saved.id!))).toBe(true);
    expect(existsSync(manifestFile(summary.path, pending.id!))).toBe(false);
    expect(existsSync(leftover)).toBe(false);
    expect(surfaceOf((await json<PhotoProject>("GET", `/api/projects/${summary.id}`)).body)).toBe(saved.id);
  });
});

describe("a missing source", () => {
  it("is a 404 that names its file", async () => {
    const helper = new PhotoHelper(path.join(import.meta.dirname, "helper-process.mjs"));
    try {
      const photo = new PhotoService(helper, {
        projectDir: () => tmp,
        sourcePath: () => path.join(tmp, "media", "media_0123456789ab", "beach.jpg"),
        exportsFolder: path.join(tmp, "exports"),
        adoptImage: () => Promise.reject(new Error("unused")),
      });
      await expect(photo.layout("project_0123456789ab", "media_0123456789ab", 256)).rejects.toMatchObject({
        status: 404,
        message: expect.stringContaining("beach.jpg is missing"),
      });
    } finally {
      helper.close();
    }
  });
});

/** macOS makes small disks (hdiutil), so a full disk is a real one. */
const canMakeDisks = process.platform === "darwin" && existsSync("/usr/bin/hdiutil");

describe.runIf(canMakeDisks)("a full disk", () => {
  let mount = "";
  afterEach(async () => {
    await stop(); // its files are open on the disk
    if (mount) execFileSync("hdiutil", ["detach", mount, "-force"], { stdio: "ignore" });
    mount = "";
  });

  it("refuses uploads and saves with its reason, and what was saved is intact", async () => {
    const image = path.join(tmp, "small.dmg");
    execFileSync("hdiutil", ["create", "-size", "4m", "-fs", "HFS+", "-volname", "vaudio-full", "-layout", "NONE", image], { stdio: "ignore" });
    mount = path.join(tmp, "volume");
    await fs.mkdir(mount);
    execFileSync("hdiutil", ["attach", image, "-mountpoint", mount, "-nobrowse", "-noverify"], { stdio: "ignore" });
    // Neither the file-event log nor Spotlight may write to it (or free room on it) behind the test's back.
    await fs.mkdir(path.join(mount, ".fseventsd"), { recursive: true });
    await fs.writeFile(path.join(mount, ".fseventsd", "no_log"), "");
    await fs.writeFile(path.join(mount, ".metadata_never_index"), "");

    await start(path.join(mount, "Documents"));
    const { summary, doc } = await newPhoto();
    const s = await upload(summary.id, 6);
    await json("PUT", `/api/projects/${summary.id}`, painted(doc, s.id!));
    const before = await fs.readFile(path.join(summary.path, "project.json"), "utf8");

    // Fill it, to the last byte (again before each refusal: nothing else may have made room meanwhile).
    const fill = async () => {
      const filler = await fs.open(path.join(mount, "filler"), "a");
      try {
        for (let chunk = 64 * 1024; chunk >= 1; chunk >>= 1) {
          try {
            for (;;) await filler.write(Buffer.alloc(chunk, 1));
          } catch (error) {
            expect((error as NodeJS.ErrnoException).code).toBe("ENOSPC");
          }
        }
      } finally {
        await filler.close();
      }
    };
    await fill();

    const refused = await upload(summary.id, 7);
    expect(refused.status).toBe(507);
    expect(refused.error).toMatch(/disk is full/);
    await fill();
    const save = await json<{ error: string }>("PUT", `/api/projects/${summary.id}`, { ...painted(doc, s.id!), name: "Night at the pier, a much longer name that needs more room" });
    expect(save.status).toBe(507);
    expect(save.body.error).toMatch(/disk is full/);
    expect(await fs.readFile(path.join(summary.path, "project.json"), "utf8")).toBe(before);
    expect((await walk(summary.path)).filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // Room again: the same requests go through.
    await fs.rm(path.join(mount, "filler"));
    expect((await upload(summary.id, 7)).status).toBe(201);
    expect((await json("PUT", `/api/projects/${summary.id}`, painted(doc, s.id!))).status).toBe(200);
  });
});

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}
