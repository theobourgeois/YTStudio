/**
 * Try the packaged desktop app end to end (after `pnpm build:desktop`): launch it on a throwaway data dir, check
 * the editor loads in its window, then export a cross dissolve, which draws in the app's own hidden Chromium
 * window, and check its colours; check projects are files it declares, and that launching it with one (what
 * Finder's double-click does) opens it; and that Now Playing's visualizer pops out into a window of its own, drawn there
 * (a made-up song, never heard). Leaves a screenshot of the window.
 *
 *   pnpm test:desktop [--out window.png]
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type Page, chromium } from "playwright-core";
import { defaultEffects } from "../shared/effects.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import type { Clip, ExportJob, MediaAsset, Project, ProjectSummary } from "../shared/types.ts";
import { FFMPEG } from "../server/config.ts";
import { addChannels, setSteps } from "../shared/music/edits.ts";
import { createMusicProject, FIRST_PATTERN_ID } from "../shared/music/project.ts";
import type { EngineStatus } from "../shared/music/engine.ts";
import type { CompareResult, SourceInfo, SourceLayout } from "../shared/photo/lab.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
const SCREENSHOT = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(ROOT, "desktop-smoke.png");
const APP = {
  darwin: `release/mac-${process.arch}/YTStudio.app/Contents/MacOS/YTStudio`,
  linux: "release/linux-unpacked/ytstudio",
  win32: "release/win-unpacked/YTStudio.exe",
}[process.platform as "darwin" | "linux" | "win32"];

const executablePath = process.env.EDITOR_DESKTOP_APP_PATH || (APP && path.join(ROOT, APP));
if (!executablePath || !existsSync(executablePath)) {
  console.error(`No packaged app at ${APP}: run \`pnpm build:desktop\` first.`);
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "editor-desktop-"));
const ffmpeg = (...args: string[]) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const pixelAt = (file: string, time: number, x: number, y: number) => {
  const out = execFileSync(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(time), "-i", file,
    "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [out[0], out[1], out[2]];
};
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

/** A free port for the app's DevTools endpoint (Playwright's own Electron launcher can't drive an ESM main). */
const debugPort = await new Promise<number>((resolve) => {
  const probe = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as net.AddressInfo;
    probe.close(() => resolve(port));
  });
});
// Now Playing's stand-in player: made-up songs, whose sound is made up too (nothing is heard, Spotify isn't asked).
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: path.join(tmp, "data"), EDITOR_USER_DATA_DIR: path.join(tmp, "profile"), EDITOR_NOW_PLAYING: "stand-in", EDITOR_VIBE_MODEL: "stand-in" };
// Terminals inside Electron apps pass this on, and it would make the app a plain Node.js.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executablePath, [`--remote-debugging-port=${debugPort}`], { env, stdio: ["ignore", "inherit", "inherit"] });
let browser: Browser | null = null;
for (let i = 0; i < 120 && !browser; i++) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`).catch(() => null);
  if (!browser) await new Promise((r) => setTimeout(r, 250));
}
if (!browser) throw new Error("The app didn't start.");

/** The editor's window (hidden export windows are pages too). */
async function editorWindow(): Promise<Page> {
  for (let i = 0; i < 120; i++) {
    const page = browser!.contexts().flatMap((c) => c.pages()).find((p) => /^http:\/\/127\.0\.0\.1:\d+\/$/.test(p.url()));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The editor's window didn't open.");
}

try {
  const window = await editorWindow();
  await window.waitForLoadState("domcontentloaded");
  const base = new URL(window.url()).origin;
  console.log(`app at ${base}, data in ${tmp}`);
  check("marked as the desktop app", await window.evaluate(() => document.documentElement.classList.contains("desktop")));
  check("can flush autosave on close", await window.evaluate(() => typeof (window as { editorDesktop?: { flush?: unknown } }).editorDesktop?.flush === "function"));

  const api = async <T>(p: string, init?: RequestInit) => {
    const res = await fetch(base + p, init);
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${p}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const post = <T>(p: string, body: unknown) =>
    api<T>(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const health = await api<{ ffmpeg: { available: boolean } }>("/api/health");
  check("finds ffmpeg (login shell PATH)", health.ffmpeg.available);

  // The photo suite: WebGPU in the app's window, and its helper (sharp, shipped in the app's resources) decoding and
  // encoding through the app's own server, an image's samples coming back exactly.
  const gpu = await window.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter ? `${adapter.info.vendor} ${adapter.info.architecture}${(adapter.info as { isFallbackAdapter?: boolean }).isFallbackAdapter ? " (fallback)" : ""}` : null;
  });
  check("WebGPU in the window", gpu !== null && !gpu.includes("fallback"), gpu ?? "no adapter");
  const photoHelper = await api<{ decoder: string | null }>("/api/photo/lab/helper");
  check("the photo helper runs from the app's resources", /^sharp /.test(photoHelper.decoder ?? ""), photoHelper.decoder ?? "");
  const still = path.join(tmp, "photo.png");
  ffmpeg("-f", "lavfi", "-i", "testsrc2=size=320x240", "-frames:v", "1", "-pix_fmt", "rgba", still);
  const source = await api<SourceInfo>("/api/photo/lab/sources?name=photo.png", { method: "POST", body: readFileSync(still) });
  const layout = await api<SourceLayout>(`/api/photo/lab/sources/${source.key}/layout?tile=256`);
  const tiles = new Uint8Array(await (await fetch(`${base}/api/photo/lab/sources/${source.key}/raw?tile=256`)).arrayBuffer());
  const rows = new Uint8Array(layout.width * layout.height * 4);
  for (let y = 0; y < layout.height; y++) {
    for (let tx = 0; tx < layout.tilesX; tx++) {
      const width = Math.min(256, layout.width - tx * 256);
      const from = (Math.floor(y / 256) * layout.tilesX + tx) * layout.tileBytes + (y % 256) * 256 * 4;
      rows.set(tiles.subarray(from, from + width * 4), (y * layout.width + tx * 256) * 4);
    }
  }
  const { id: exportId } = await post<{ id: string }>("/api/photo/lab/exports", { name: "smoke.png", width: layout.width, height: layout.height, bits: 8, format: "png" });
  await fetch(`${base}/api/photo/lab/exports/${exportId}/rows?from=0`, { method: "PUT", body: rows });
  await api(`/api/photo/lab/exports/${exportId}/finish`, { method: "POST" });
  const compared = await api<CompareResult>(`/api/photo/lab/exports/smoke.png/compare?source=${source.key}`);
  check("the photo helper decodes and encodes exactly", layout.width === 320 && compared.differing === 0, `${layout.decoder}, ${compared.differing} samples differ`);
  // A photo project with that image as a layer opens in the window and its image reaches the GPU.
  const photo = await post<ProjectSummary>("/api/projects", { suite: "photo", name: "Desktop photo" });
  const image = await api<MediaAsset>(`/api/media?projectId=${photo.id}&name=photo.png`, { method: "POST", body: readFileSync(still) });
  const doc = await api<Record<string, unknown> & { canvas: { width: number; height: number } }>(`/api/projects/${photo.id}`);
  const layer = { id: "layer_smoke", kind: "image", name: "Smoke", visible: true, opacity: 1, mediaId: image.id, transform: { x: doc.canvas.width / 2, y: doc.canvas.height / 2, scaleX: 1, scaleY: 1, rotation: 0 } };
  await api(`/api/projects/${photo.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...doc, layers: [layer] }) });
  await window.goto(`${base}/p/${photo.id}`);
  const drawn = await window.locator('[data-layer][data-source="ready"]').waitFor({ timeout: 20_000 }).then(() => true, () => false);
  const state = drawn
    ? ""
    : await window.evaluate(() => {
        const row = document.querySelector("[data-layer]");
        const canvas = document.querySelector("[data-photo-canvas]");
        return `layer: ${row?.getAttribute("data-source") ?? "none"}; ${row?.querySelector("[aria-label^=Image]")?.getAttribute("aria-label") ?? ""} ${canvas?.textContent?.slice(0, 300) ?? `no canvas: ${location.pathname} ${document.body.innerText.slice(0, 300)}`}`;
      });
  check("a photo opens and its image is drawn by the GPU in the window", drawn, state);
  await window.goto(`${base}/`);

  const project = await post<ProjectSummary>("/api/projects", { name: "Desktop smoke" });
  const colour = async (name: string) => {
    const file = path.join(tmp, `${name}.png`);
    ffmpeg("-f", "lavfi", "-i", `color=${name}:size=100x50`, "-frames:v", "1", file);
    return post<MediaAsset>("/api/media/import-file", { projectId: project.id, path: file });
  };
  const [red, blue] = await Promise.all([colour("red"), colour("blue")]);
  const clip = (asset: MediaAsset, start: number): Clip => ({
    id: `clip_${asset.id.slice(-8)}`, assetId: asset.id, trackId: "main", start, in: 0, out: 2, effects: defaultEffects(),
  });
  const dissolve = { type: "cross-dissolve", duration: 1, alignment: "center" as const, params: {} };
  const timeline: Project = { ...createDefaultProject(), clips: [{ ...clip(red, 0), transitionOut: dissolve }, clip(blue, 2)] };

  // The editor opens the video, then the export draws it.
  await window.reload();
  await window.getByText("Desktop smoke").first().waitFor({ timeout: 20_000 });
  const started = Date.now();
  let job = await post<ExportJob>("/api/exports", { project: timeline, resolution: "720p" });
  while (job.status === "queued" || job.status === "rendering") {
    await new Promise((r) => setTimeout(r, 250));
    job = await api<ExportJob>(`/api/exports/${job.id}`);
  }
  check("exports", job.status === "done", job.error ?? `${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (job.status === "done") {
    const output = path.join(tmp, "data", "exports", `${job.id}.mp4`);
    const near = (actual: number[], expected: number[]) => actual.every((v, i) => Math.abs(v - expected[i]) < 40);
    const mid = pixelAt(output, 2, 360, 640);
    check("the transition is drawn by the app's Chromium", near(pixelAt(output, 1.2, 360, 640), [255, 0, 0]) && near(mid, [128, 0, 128]) && near(pixelAt(output, 2.7, 360, 640), [0, 0, 255]), `mid ${mid}`);
  }
  // Projects are files: a package in the data folder's Documents/YTStudio (the user's own Documents/YTStudio when no
  // data folder is given), a type the app declares, opened by launching the app with it.
  const summary = (await api<ProjectSummary[]>("/api/projects")).find((p) => p.id === project.id);
  const expected = path.join(tmp, "data", "Documents", "YTStudio", "Desktop smoke.ytvid");
  check("the project is a package", summary?.path === expected && existsSync(path.join(expected, "project.json")), summary?.path);
  if (process.platform === "darwin") {
    const plist = path.join(path.dirname(path.dirname(executablePath)), "Info.plist");
    const types = execFileSync("plutil", ["-extract", "CFBundleDocumentTypes", "json", "-o", "-", plist], { encoding: "utf8" });
    check("associates the exported project types with YTStudio", /"LSItemContentTypes":\["gg\.jestr\.ytstudio\.video",/.test(types));
    check("declares .ytvid packages", /"ytvid"/.test(types) && /"LSTypeIsPackage":true/.test(types));
  }
  await window.goto(`${base}/`);
  await window.getByRole("heading", { name: "Recent" }).waitFor({ timeout: 20_000 });
  const second = spawn(executablePath, [expected], { env, stdio: "ignore" });
  const opened = await window.waitForURL(`**/p/${project.id}`, { timeout: 20_000 }).then(() => true, () => false);
  check("opens a project it's launched with", opened);
  second.kill();
  if (process.argv.includes("--music")) {
    const music = await post<ProjectSummary>("/api/projects", { suite: "music", name: "Windows music smoke" });
    const file = path.join(tmp, "Quiet sample.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=0.4", "-af", "volume=0.08", file);
    const sample = await post<MediaAsset>("/api/media/import-file", { projectId: music.id, path: file });
    const song = setSteps(addChannels(createMusicProject("Windows music smoke", 120), [{ id: "chan_smoke", name: "Quiet sample", sampleId: sample.id }]), FIRST_PATTERN_ID, "chan_smoke", [0, 4, 8, 12], true);
    await api(`/api/projects/${music.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(song) });
    await window.goto(`${base}/p/${music.id}`);
    await window.locator('[data-suite="music"]').waitFor({ timeout: 20_000 });
    // Native panels are currently disabled app-wide; music panels live in the main desktop's page.
    await window.getByTestId("channel-rack").waitFor({ timeout: 20_000 });
    check("music opens the channel rack", await window.getByTestId("channel-rack").isVisible());
    await window.getByText("Quiet sample", { exact: true }).first().waitFor({ timeout: 20_000 });
    await post("/api/engine/song", { projectId: music.id, song, patternId: FIRST_PATTERN_ID });
    const status = await post<EngineStatus>("/api/engine/status", {});
    check("packaged music engine opens an output", !!status.device && !status.offline, status.device ?? "no device");
    await post("/api/engine/play", {});
    let playing: EngineStatus = status;
    for (let i = 0; i < 12; i++) {
      playing = await post<EngineStatus>("/api/engine/status", {});
      if (playing.peak > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await post("/api/engine/stop", {});
    check("sampler playback reaches the real output", playing.peak > 0 && playing.transport.playing, `peak ${playing.peak}`);
    check("Windows sample paths survive save/reopen", (await api<{ channels: { sampleId: string | null }[] }>(`/api/projects/${music.id}`)).channels[0].sampleId === sample.id);
  }
  // Now Playing's visualizer, out of the app: a window of the system's (framed, so it goes to another screen and full
  // screen there), drawn by the page, its keys its own.
  await post("/api/now-playing", { action: "play" });
  await window.goto(`${base}/`);
  await window.locator("[data-visualize-sound]").click();
  await window.locator("[data-now-playing-view]").waitFor({ timeout: 20_000 });
  const context = browser.contexts()[0];
  const popped = context.waitForEvent("page", { timeout: 20_000 });
  await window.keyboard.press("o");
  const stage = await popped.catch(() => null);
  if (stage) {
    const view = stage.locator('[data-now-playing-view="out"]');
    const drawn = await view.locator('[data-slot="visualizer-canvas"][data-drawn="clips"]').waitFor({ timeout: 20_000 }).then(() => true, () => false);
    check("the visualizer pops out into its own window, drawn there", drawn && (await window.locator("[data-now-playing-view]").count()) === 0);
    const frame = await stage.evaluate(() => self.outerHeight - self.innerHeight);
    check("its window is the system's own, with a title bar", frame > 0, `${frame} px`);
    const state = () => fetch(`${base}/api/now-playing`).then((r) => r.json() as Promise<{ state?: string }>).then((s) => s.state);
    const was = await state();
    await stage.keyboard.press(" ");
    let now = was;
    for (let i = 0; i < 20 && now === was; i++) {
      await new Promise((r) => setTimeout(r, 100));
      now = await state();
    }
    check("its keys are its own", now !== was, `${was} -> ${now}`);
    const closed = stage.waitForEvent("close", { timeout: 10_000 }).then(() => true, () => false);
    await stage.keyboard.press("Escape");
    check("Escape closes it, and its window", await closed);
  } else check("the visualizer pops out into its own window", false, "no window opened");
  await window.screenshot({ path: SCREENSHOT });
  console.log(`screenshot: ${path.relative(process.cwd(), SCREENSHOT)}`);
} finally {
  await browser.close().catch(() => {});
  // Quitting waits for the page to save; it mustn't need asking twice.
  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(true));
    setTimeout(() => resolve(false), 10_000);
  });
  child.kill("SIGTERM");
  check("quits", await exited);
  if (child.exitCode === null) child.kill("SIGKILL");
  rmSync(tmp, { recursive: true, force: true });
}
