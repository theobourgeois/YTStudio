/**
 * Try the packaged desktop app end to end (after `pnpm build:desktop`): launch it on a throwaway data dir, check
 * the editor loads in its window, then export a cross dissolve, which draws in the app's own hidden Chromium
 * window, and check its colours; check projects are files it declares, and that launching it with one (what
 * Finder's double-click does) opens it. Leaves a screenshot of the window.
 *
 *   pnpm test:desktop [--out window.png]
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { type Browser, type Page, chromium } from "playwright-core";
import { defaultEffects } from "../shared/effects.ts";
import { createDefaultProject } from "../shared/timeline.ts";
import type { Clip, ExportJob, MediaAsset, Project, ProjectSummary } from "../shared/types.ts";
import { FFMPEG } from "../server/config.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const outIndex = process.argv.indexOf("--out");
const SCREENSHOT = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(ROOT, "desktop-smoke.png");
const APP = {
  darwin: `release/mac-${process.arch}/Vaudio.app/Contents/MacOS/Vaudio`,
  linux: "release/linux-unpacked/vaudio",
  win32: "release/win-unpacked/Vaudio.exe",
}[process.platform as "darwin" | "linux" | "win32"];

const executablePath = APP && path.join(ROOT, APP);
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
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: path.join(tmp, "data"), EDITOR_USER_DATA_DIR: path.join(tmp, "profile") };
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
  // Projects are files: a package in the data folder's Documents/Vaudio (the user's own Documents/Vaudio when no
  // data folder is given), a type the app declares, opened by launching the app with it.
  const summary = (await api<ProjectSummary[]>("/api/projects")).find((p) => p.id === project.id);
  const expected = path.join(tmp, "data", "Documents", "Vaudio", "Desktop smoke.vaudio");
  check("the project is a package", summary?.path === expected && existsSync(path.join(expected, "project.json")), summary?.path);
  if (process.platform === "darwin") {
    const plist = path.join(path.dirname(path.dirname(executablePath)), "Info.plist");
    const types = execFileSync("plutil", ["-extract", "CFBundleDocumentTypes", "json", "-o", "-", plist], { encoding: "utf8" });
    check("declares .vaudio packages", /"vaudio"/.test(types) && /"LSTypeIsPackage":true/.test(types));
  }
  await window.goto(`${base}/`);
  await window.getByRole("heading", { name: "Recent" }).waitFor({ timeout: 20_000 });
  const second = spawn(executablePath, [expected], { env, stdio: "ignore" });
  const opened = await window.waitForURL(`**/p/${project.id}`, { timeout: 20_000 }).then(() => true, () => false);
  check("opens a project it's launched with", opened);
  second.kill();
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
