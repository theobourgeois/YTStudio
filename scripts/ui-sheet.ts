/**
 * Screenshots of the app's look, in every theme, to check a restyle (docs/ui-redesign.md):
 * each section of the component gallery (`/gallery`, `src/gallery/`) and the app's screens (the empty
 * state, the New project picker, the video editor with clips, the music editor). Starts its own server
 * and app on ports 5340/5341 with a throwaway data dir and the stand-in engine and assistant, like e2e.
 *
 *   pnpm tsx scripts/ui-sheet.ts [section or screen ...] [--out dir] [--light | --dark] [--theme <id>]
 *
 * Pictures go to `ui-sheet/` (`<name>-<theme>.png`); with names, only those are taken. `--light`/`--dark`
 * take only the light or dark themes, `--theme` one theme.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page, chromium } from "@playwright/test";
import { defaultEffects, textEffects } from "../shared/effects.ts";
import type { Clip, MediaAsset, Project, ProjectSummary } from "../shared/types.ts";
import { THEMES as ALL_THEMES } from "../src/themes/index.ts";

const WEB_PORT = "5340";
const SERVER_PORT = "5341";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(root, "ui-sheet"));
const themeIndex = args.indexOf("--theme");
const names = args.filter((a, i) => !a.startsWith("--") && (outIndex < 0 || i !== outIndex + 1) && (themeIndex < 0 || i !== themeIndex + 1));
const THEMES = ALL_THEMES.filter(
  (t) => (themeIndex < 0 || t.id === args[themeIndex + 1]) && (args.includes("--light") ? !t.dark : args.includes("--dark") ? t.dark : true),
).map((t) => t.id);
const wanted = (name: string) => names.length === 0 || names.some((n) => name === n || name.startsWith(`${n}-`));

// Another run's server would be used instead of ours (and its projects shown): refuse rather than mix them.
for (const port of [WEB_PORT, SERVER_PORT]) {
  const taken = await fetch(`http://${port === WEB_PORT ? "localhost" : "127.0.0.1"}:${port}`).then(() => true, () => false);
  if (taken) {
    console.error(`Port ${port} is taken (an earlier run still going?). Stop it: lsof -ti:${port} | xargs kill`);
    process.exit(1);
  }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "editor-ui-"));
const env = {
  ...process.env,
  EDITOR_DATA_DIR: dataDir,
  EDITOR_SERVER_PORT: SERVER_PORT,
  EDITOR_WEB_PORT: WEB_PORT,
  EDITOR_TRANSCRIPTION_ENGINE: "fake",
  CLAUDE_PATH: path.join(root, "e2e/fake-claude.mjs"),
  CODEX_PATH: path.join(root, "e2e/fake-codex.mjs"),
  EDITOR_ENGINE_PATH: path.join(root, "server/music/fake-engine.mjs"),
};
const children: ChildProcess[] = [
  spawn("pnpm", ["exec", "tsx", "server/index.ts"], { cwd: root, env, stdio: "ignore", detached: true }),
  spawn("pnpm", ["exec", "vite", "--port", WEB_PORT, "--strictPort"], { cwd: root, env, stdio: "ignore", detached: true }),
];
function cleanUp() {
  for (const child of children) {
    try {
      process.kill(-child.pid!);
    } catch {
      // already gone
    }
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.on("exit", cleanUp);
process.on("SIGINT", () => process.exit(130));

async function waitFor(url: string) {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} didn't come up`);
}

const web = `http://localhost:${WEB_PORT}`;
const api = `http://127.0.0.1:${SERVER_PORT}/api`;
const json = { "content-type": "application/json" };
await waitFor(`${api}/health`);
await waitFor(web);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const written: string[] = [];

/** A page in one theme: the look is saved in localStorage before the app starts. */
async function pageIn(theme: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(
    ([t, dark]) => {
      localStorage.setItem("editor-theme-choice", t);
      localStorage.setItem("editor-theme-dark", dark);
    },
    [theme, String(ALL_THEMES.find((t) => t.id === theme)!.dark)],
  );
  return page;
}

async function shoot(page: Page, name: string, target?: string) {
  const file = path.join(outDir, `${name}.png`);
  // Let menus and dialogs finish opening.
  await page.waitForTimeout(250);
  if (target) await page.locator(target).screenshot({ path: file });
  else await page.screenshot({ path: file });
  written.push(file);
  console.log(`  ${name}`);
}

// The gallery: each section alone, then the extra shots it asks for (a menu open, a dialog...).
const { SECTIONS } = await galleryIndex();
for (const theme of THEMES) {
  for (const section of SECTIONS) {
    const suffix = theme;
    const shots = (section.shots ?? []).filter((s) => wanted(`${section.id}-${s.name}`));
    if (!wanted(section.id) && shots.length === 0) continue;
    const page = await pageIn(theme);
    const url = `${web}/gallery?section=${section.id}&theme=${theme}`;
    await page.goto(url);
    const box = `[data-gallery-section="${section.id}"]`;
    await page.locator(box).waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (wanted(section.id)) await shoot(page, `${section.id}-${suffix}`, box);
    for (const shot of shots) {
      await page.goto(url);
      await page.locator(box).waitFor();
      if (shot.click) await page.getByRole("button", { name: shot.click, exact: true }).or(page.getByRole("combobox", { name: shot.click })).first().click();
      if (shot.rightClick) await page.locator(`[data-gallery-target="${shot.rightClick}"]`).click({ button: "right" });
      await shoot(page, `${section.id}-${shot.name}-${suffix}`, shot.page ? undefined : box);
    }
    await page.close();
  }
}

/** The gallery's sections, read from the running page (each says what extra shots it wants). */
async function galleryIndex(): Promise<{ SECTIONS: { id: string; shots?: { name: string; click?: string; rightClick?: string; page?: boolean }[] }[] }> {
  const page = await browser.newPage();
  await page.goto(`${web}/gallery`);
  await page.locator("[data-gallery-section]").first().waitFor();
  const sections = await page.locator("[data-gallery-section]").evaluateAll((els) =>
    els.map((el) => ({ id: el.getAttribute("data-gallery-section")!, shots: JSON.parse(el.getAttribute("data-gallery-shots") ?? "[]") })),
  );
  await page.close();
  return { SECTIONS: sections };
}

// The app's screens, on a video and a song made for them.
const screens = ["empty", "new-project", "video", "video-effects", "video-properties", "video-captions", "video-settings", "video-export", "video-auto-captions", "video-save-to-library", "video-clip-menu", "settings-window", "music", "music-piano", "music-settings"];
if (screens.some(wanted)) {
  const video = await makeVideo();
  const music: ProjectSummary = await (await fetch(`${api}/projects`, { method: "POST", headers: json, body: JSON.stringify({ suite: "music", name: "Beat" }) })).json();
  let kitAdded = false;
  for (const theme of THEMES) {
    const suffix = theme;
    const page = await pageIn(theme);
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });

    if (wanted("empty")) {
      await page.goto(web);
      await page.getByRole("button", { name: "New project" }).first().waitFor();
      await shoot(page, `empty-${suffix}`);
    }
    if (wanted("new-project")) {
      await page.goto(web);
      await page.getByRole("button", { name: "New project" }).first().click();
      await page.getByRole("dialog").waitFor();
      await shoot(page, `new-project-${suffix}`);
    }
    if (screens.slice(2, 12).some(wanted)) {
      await page.goto(`${web}/p/${video.id}`);
      await page.locator("[data-clip-id]").first().waitFor();
      await page.waitForTimeout(800);
      if (wanted("video")) await shoot(page, `video-${suffix}`);
      if (wanted("video-effects")) {
        await tab("Effects").click();
        await shoot(page, `video-effects-${suffix}`);
      }
      if (wanted("video-captions")) {
        await tab("Captions").click();
        await shoot(page, `video-captions-${suffix}`);
      }
      if (wanted("video-properties")) {
        await page.locator("[data-clip-id]").first().click();
        await tab("Properties").click();
        await shoot(page, `video-properties-${suffix}`);
      }
      if (wanted("video-clip-menu")) {
        await page.locator("[data-clip-id]").first().click({ button: "right" });
        await shoot(page, `video-clip-menu-${suffix}`);
        await page.keyboard.press("Escape");
      }
      if (wanted("video-settings")) {
        await page.getByRole("button", { name: "Video settings", exact: true }).click();
        await page.locator('[data-window="video-settings"]').waitFor();
        await shoot(page, `video-settings-${suffix}`);
        await page.keyboard.press("Escape");
      }
      // The export, a window over the editor.
      if (wanted("video-export")) {
        await page.getByRole("button", { name: "Export", exact: true }).click();
        await page.locator('[data-window="export"]').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, `video-export-${suffix}`);
        await page.keyboard.press("Escape");
      }
      if (wanted("video-auto-captions")) {
        await page.getByRole("button", { name: "Auto captions", exact: true }).first().click();
        await page.locator('[data-window="captions"]').waitFor();
        await page.waitForTimeout(500);
        await shoot(page, `video-auto-captions-${suffix}`);
        await page.keyboard.press("Escape");
      }
      if (wanted("video-save-to-library")) {
        await page.locator("[data-clip-id]").first().click({ button: "right" });
        await page.getByRole("menuitem", { name: /Save to Library/ }).click();
        await page.locator('[data-window="save-to-library"]').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, `video-save-to-library-${suffix}`);
        await page.keyboard.press("Escape");
      }
      // Settings, the app's window (⌘,), over the video: on its General tab, with the themes.
      if (wanted("settings-window")) {
        await page.keyboard.press("ControlOrMeta+Comma");
        await page.locator("[data-settings]").waitFor();
        await page.getByRole("tab", { name: "General" }).click();
        await shoot(page, `settings-window-${suffix}`);
        await page.keyboard.press("Escape");
      }
    }
    if (wanted("music") || wanted("music-piano") || wanted("music-settings")) {
      await page.goto(`${web}/p/${music.id}`);
      await page.getByRole("toolbar", { name: "Transport" }).waitFor();
      if (!kitAdded) {
        await page.getByRole("button", { name: "Channel rack menu" }).click();
        await page.getByRole("menuitem", { name: "Add starter kit" }).click();
        await page.getByRole("listitem").nth(3).waitFor();
        for (const [channel, steps] of [["Kick", [1, 5, 9, 13]], ["Hat", [3, 7, 11, 15]], ["Snare", [5, 13]]] as const) {
          for (const n of steps) await page.getByRole("button", { name: `${channel} step ${n}`, exact: true }).click();
        }
        kitAdded = true;
      }
      await page.waitForTimeout(500);
      if (wanted("music")) await shoot(page, `music-${suffix}`);
      if (wanted("music-piano")) {
        await page.getByRole("button", { name: "Select Kick" }).click();
        await page.keyboard.press("F7");
        await page.waitForTimeout(500);
        await shoot(page, `music-piano-${suffix}`);
        await page.keyboard.press("F7");
      }
      if (wanted("music-settings")) {
        await page.keyboard.press("ControlOrMeta+Comma");
        await page.locator("[data-settings]").waitFor();
        await page.waitForTimeout(300);
        await shoot(page, `music-settings-${suffix}`);
        await page.keyboard.press("Escape");
      }
    }
    await page.close();
  }
}

await browser.close();
console.log(`Wrote ${written.length} pictures to ${path.relative(process.cwd(), outDir) || "."}`);
// The server and app we started keep Node running: exiting stops them (`cleanUp`).
process.exit(0);

/** A video with three media, clips on two tracks and a caption, like a short edit in progress. */
async function makeVideo(): Promise<ProjectSummary> {
  const samples = path.join(root, "samples");
  if (!fs.existsSync(path.join(samples, "music-20s.mp3"))) execFileSync("pnpm", ["exec", "tsx", "scripts/make-samples.ts"], { cwd: root, stdio: "inherit" });
  const summary: ProjectSummary = await (await fetch(`${api}/projects`, { method: "POST", headers: json, body: JSON.stringify({ suite: "video", name: "Summer trip" }) })).json();
  const upload = async (file: string): Promise<MediaAsset> => {
    const body = fs.readFileSync(path.join(samples, file));
    const res = await fetch(`${api}/media?projectId=${summary.id}&name=${encodeURIComponent(file)}`, { method: "POST", body });
    if (!res.ok) throw new Error(`Uploading ${file} failed: ${await res.text()}`);
    return res.json();
  };
  const [vertical, landscape, song] = [await upload("vertical-1080x1920-6s.mp4"), await upload("landscape-1920x1080-8s.mp4"), await upload("music-20s.mp3")];
  await upload("photo-1600x1200.jpg");
  for (const asset of [vertical, landscape, song]) {
    for (let i = 0; i < 120; i++) {
      const now: MediaAsset = await (await fetch(`${api}/media/${asset.id}`)).json();
      if (now.status !== "processing") break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const project: Project = await (await fetch(`${api}/projects/${summary.id}`)).json();
  const [videoTrack, audioTrack] = [project.tracks.find((t) => t.kind === "video")!, project.tracks.find((t) => t.kind === "audio")!];
  const clip = (id: string, assetId: string, trackId: string, start: number, length: number): Clip => ({
    id,
    assetId,
    trackId,
    start,
    in: 0,
    out: length,
    effects: defaultEffects(),
  });
  project.tracks.unshift({ ...videoTrack, id: "track_text", name: "Video 2" });
  project.clips = [
    clip("clip_a", vertical.id, videoTrack.id, 0, 6),
    clip("clip_b", landscape.id, videoTrack.id, 6, 5),
    clip("clip_c", song.id, audioTrack.id, 0, 11),
    { id: "clip_t", assetId: "", trackId: "track_text", start: 1, in: 0, out: 3, effects: textEffects({ text: "Summer ’26" }) },
  ];
  const saved = await fetch(`${api}/projects/${summary.id}`, { method: "PUT", headers: json, body: JSON.stringify(project) });
  if (!saved.ok) throw new Error(`Saving the video failed: ${await saved.text()}`);
  return summary;
}
