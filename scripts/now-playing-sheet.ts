/**
 * Render Now Playing's looks (shared/live-looks.ts) as a contact sheet, in the real app: its own server and web app
 * with the stand-in player (a made-up song measured as if heard), or a sound file of your own (`--song`, never played,
 * only measured), each look shown for a few seconds and screenshot.
 *
 *   pnpm tsx scripts/now-playing-sheet.ts [look ...] [--song file.mp3] [--seconds 4] [--out sheet.png]
 *
 * Writes the sheet and one picture per look beside it (`<out>-<look>.png`).
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { LIVE_LOOKS, LOOK_KINDS } from "../shared/live-looks.ts";

const WEB_PORT = "5350";
const SERVER_PORT = "5351";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(option("--out") ?? path.join(root, "now-playing-sheet.png"));
const song = option("--song");
const seconds = Number(option("--seconds") ?? 4);
const names = args.filter((a, i) => !a.startsWith("--") && !["--out", "--song", "--seconds"].includes(args[i - 1]));
const looks = names.length ? LIVE_LOOKS.filter((l) => names.includes(l.id) || names.includes(l.kind)) : LIVE_LOOKS;
if (!looks.length) {
  console.error(`No looks match ${names.join(", ")}. Known: ${LIVE_LOOKS.map((l) => l.id).join(", ")}`);
  process.exit(1);
}

for (const port of [WEB_PORT, SERVER_PORT]) {
  const taken = await fetch(`http://${port === WEB_PORT ? "localhost" : "127.0.0.1"}:${port}`).then(() => true, () => false);
  if (taken) {
    console.error(`Port ${port} is taken (an earlier run still going?). Stop it: lsof -ti:${port} | xargs kill`);
    process.exit(1);
  }
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "editor-now-playing-"));
const env = {
  ...process.env,
  EDITOR_DATA_DIR: dataDir,
  EDITOR_SERVER_PORT: SERVER_PORT,
  EDITOR_WEB_PORT: WEB_PORT,
  EDITOR_NOW_PLAYING: "stand-in",
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
await waitFor(`http://127.0.0.1:${SERVER_PORT}/api/health`);
await waitFor(web);
// The stand-in player opens when it's told to play.
await fetch(`http://127.0.0.1:${SERVER_PORT}/api/now-playing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "play" }) });

// The GPU on (as the export's browser has it): the 3D scenes are too heavy for software rendering.
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems: string[] = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(e.message));
if (song) {
  const bytes = fs.readFileSync(song);
  await page.route("**/now-playing-sheet-song", (route) => route.fulfill({ body: bytes, contentType: "audio/mpeg" }));
}
await page.addInitScript(
  ([first, file]) => {
    localStorage.setItem("editor-visualizer-look", first);
    localStorage.setItem("editor-visualizer-auto", "off");
    if (file) localStorage.setItem("editor-now-playing-demo", "/now-playing-sheet-song");
  },
  [looks[0].id, song ? "yes" : ""] as const,
);
await page.goto(web);
await page.click("[data-now-playing] button[title='Open the visualizer']", { timeout: 30_000 });
await page.waitForSelector("[data-now-playing-view]");
await page.mouse.move(2, 2);
// Without the controls.
await page.keyboard.press("h");

const shots: { id: string; name: string; file: string }[] = [];
for (const look of looks) {
  if (look !== looks[0]) {
    // The controls are hidden (H), not gone: their group, then the look.
    const group = LOOK_KINDS.find((k) => k.id === look.kind)!.label;
    await page.click(`[data-look-picker] button:text-is("${group}")`, { force: true });
    await page.click(`[data-look="${look.id}"]`, { force: true });
  }
  await page.waitForTimeout(seconds * 1000);
  const file = `${out.replace(/\.png$/, "")}-${look.id}.png`;
  await page.screenshot({ path: file });
  shots.push({ id: look.id, name: look.name, file });
  console.log(`  ${look.name}`);
}

// The sheet: every look, labelled, four across.
const cells = shots
  .map((s) => `<figure><img src="data:image/png;base64,${fs.readFileSync(s.file).toString("base64")}"><figcaption>${s.name}</figcaption></figure>`)
  .join("");
const sheet = await browser.newPage({ viewport: { width: 4 * 400, height: 300 } });
await sheet.setContent(
  `<style>body{margin:0;background:#111;color:#ddd;font:13px system-ui;display:grid;grid-template-columns:repeat(4,400px)}figure{margin:0;position:relative}img{width:400px;height:225px;display:block}figcaption{position:absolute;left:8px;bottom:6px;text-shadow:0 1px 3px #000}</style>${cells}`,
);
await sheet.screenshot({ path: out, fullPage: true });
console.log(`Wrote ${out}`);
if (problems.length) {
  console.log(`Problems in the page:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exitCode = 1;
}
await browser.close();
// The server and web app are children: exiting stops them (`cleanUp`).
process.exit();
