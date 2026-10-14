/**
 * Render Now Playing's looks (shared/live-looks.ts) as a contact sheet, in the real app: its own server and web app
 * with the stand-in player (a made-up song measured as if heard), or a sound file of your own (`--song`, never played,
 * only measured), each look shown for a few seconds and screenshot.
 *
 *   pnpm tsx scripts/now-playing-sheet.ts [look|kind ...] [--song file.mp3] [--seconds 4] [--track 1|2|3] [--out sheet.png]
 *   pnpm tsx scripts/now-playing-sheet.ts [look|kind ...] --moments [--at 6,11.5,22] [--parallel 3]
 *   pnpm tsx scripts/now-playing-sheet.ts chaos --rolls 24 --song file.mp3 [--seconds 4]
 *
 * `--track` picks the stand-in's song, so its cover's colours (1 magenta, 2 orange, 3 cyan).
 * Writes the sheet and one picture per look beside it (`<out>-<look>.png`).
 *
 * `--moments` shows each look at the made-up song's breakdown, build-up and drop (`DEMO_SECTIONS`; `--at` says when
 * else, for `--song`), a sheet per kind of look (`<out>-<kind>.png`), and checks every picture: none blown out to
 * white or crushed to black (it exits 1 if one is). Each moment is three frames, judged by the middle one (a strobe's
 * flash is white for a frame, which is fine; white for a while isn't). Don't edit the app's files while it runs:
 * Tailwind reads them all, so the pages reload.
 *
 * `--rolls` shows each look rolled again and again (M between, `--seconds` apart: chaos's recipes, docs/now-playing.md),
 * numbered, a sheet per look (`<out>-<look>.png`, six across), each roll checked the same way: for scoring a round.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page, chromium } from "@playwright/test";
import { LIVE_LOOKS, LOOK_KINDS, type LiveLook } from "../shared/live-looks.ts";
import { DEMO_SECTIONS } from "../shared/signals/demo-sound.ts";

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
const track = Math.max(1, Math.min(3, Number(option("--track") ?? 1)));
const moments = args.includes("--moments");
const rolls = Math.max(0, Number(option("--rolls") ?? 0));
// More pages at once starve the GPU (the 3D scenes): a page that can't keep up draws black.
const parallel = Math.max(1, Number(option("--parallel") ?? 3));
// When in the song each look is shown (seconds after the visualizer opens): well into each part of the made-up song,
// the mood having caught up with it (`LiveMood` takes a second or two).
const at = option("--at")?.split(",").map(Number) ?? [
  DEMO_SECTIONS.breakdown.to - 1.7,
  (DEMO_SECTIONS.build.from + DEMO_SECTIONS.build.to) / 2,
  DEMO_SECTIONS.drop.from + 6.5,
];
const MOMENT_NAMES = ["breakdown", "build-up", "drop"];
/** Frames taken at each moment, this far apart (ms). */
const FRAMES = [0, 150, 300];
/** The page pictures are measured in (`lightOf`). */
let reader: Page | null = null;
const names = args.filter((a, i) => !a.startsWith("--") && !["--out", "--song", "--seconds", "--track", "--at", "--parallel", "--rolls"].includes(args[i - 1]));
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
// The stand-in player opens when it's told to play; then on to the song asked for.
const command = (body: object) =>
  fetch(`http://127.0.0.1:${SERVER_PORT}/api/now-playing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
await command({ action: "play" });
for (let i = 1; i < track; i++) await command({ action: "next" });

// The GPU on (as the export's browser has it): the 3D scenes are too heavy for software rendering.
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])] });
const problems: string[] = [];
const songBytes = song ? fs.readFileSync(song) : null;

/** A page of its own with the visualizer open on `look` (listening starts as it opens), without the controls. */
async function visualizer(look: LiveLook) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  if (songBytes) await page.route("**/now-playing-sheet-song", (route) => route.fulfill({ body: songBytes, contentType: "audio/mpeg" }));
  await page.addInitScript(
    ([first, file]) => {
      localStorage.setItem("editor-visualizer-look", first);
      localStorage.setItem("editor-visualizer-auto", "off");
      if (file) localStorage.setItem("editor-now-playing-demo", "/now-playing-sheet-song");
    },
    [look.id, song ? "yes" : ""] as const,
  );
  await page.goto(web);
  await page.click("[data-now-playing] button[title='Open the visualizer']", { timeout: 30_000 });
  await page.waitForSelector("[data-now-playing-view]");
  await page.mouse.move(2, 2);
  // Without the controls (hidden, not gone).
  await page.keyboard.press("h");
  return page;
}

if (moments || rolls) {
  await (rolls ? showRolls() : showMoments());
  await browser.close();
  process.exit();
}

const page = await visualizer(looks[0]);
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

/** How light a picture is: its mean luma, and the share of it near white and near black (0..1). */
interface Light {
  mean: number;
  white: number;
  black: number;
}

/** A picture blown out (mostly white) or crushed (nothing to see), or null: fine. */
function fault(light: Light): string | null {
  if (light.white > 0.35 || light.mean > 0.85) return `blown out (${Math.round(light.white * 100)}% white, mean ${light.mean.toFixed(2)})`;
  if (light.mean < 0.012 && light.black > 0.995) return `crushed to black (mean ${light.mean.toFixed(3)})`;
  return null;
}

/**
 * Every look at each moment of the song, a page per look (a few at once): each page's listening starts as it opens,
 * so its song is at the same place at the same time after. Then the sheets, and the checks.
 */
async function showMoments() {
  // A look's frames at each moment.
  const shots = new Map<string, string[][]>();
  const queue = [...looks];
  await Promise.all(
    Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      for (let look = queue.shift(); look; look = queue.shift()) {
        // Back to the start of the stand-in's song, so it never moves on to the next (another cover, other colours).
        await command({ action: "seek", position: 0 });
        const page = await visualizer(look);
        const opened = Date.now();
        const moments: string[][] = [];
        for (const [i, seconds] of at.entries()) {
          const frames: string[] = [];
          for (const [k, ms] of FRAMES.entries()) {
            await page.waitForTimeout(Math.max(0, opened + seconds * 1000 + ms - Date.now()));
            const file = `${out.replace(/\.png$/, "")}-${look.id}-${MOMENT_NAMES[i] ?? seconds}-${k}.png`;
            await page.screenshot({ path: file });
            frames.push(file);
          }
          moments.push(frames);
        }
        await page.close();
        shots.set(look.id, moments);
        console.log(`  ${look.name}`);
      }
    }),
  );

  const faults: string[] = [];
  const rows: { look: LiveLook; cells: { file: string; light: Light }[] }[] = [];
  for (const look of looks) {
    const cells = [];
    for (const frames of shots.get(look.id) ?? []) cells.push(await judged(frames));
    rows.push({ look, cells });
    const said = cells.map((c, i) => {
      const problem = fault(c.light);
      if (problem) faults.push(`${look.name} at the ${MOMENT_NAMES[i] ?? at[i]}: ${problem}`);
      return `${(MOMENT_NAMES[i] ?? `${at[i]} s`).padEnd(9)} ${c.light.mean.toFixed(2)}${problem ? " !" : "  "}`;
    });
    console.log(`  ${look.name.padEnd(20)} ${said.join("   ")}`);
  }

  // A sheet per kind: a look a row, its moments across.
  for (const kind of LOOK_KINDS) {
    const mine = rows.filter((r) => r.look.kind === kind.id);
    if (!mine.length) continue;
    const head = at.map((s, i) => `<div class="head">${MOMENT_NAMES[i] ?? ""} · ${s.toFixed(1)} s</div>`).join("");
    const body = mine.map((r) => `<div class="name">${r.look.name}</div>` + r.cells.map((c) => figure(c, c.light.mean.toFixed(2))).join("")).join("");
    await writeSheet(`${out.replace(/\.png$/, "")}-${kind.id}.png`, `140px repeat(${at.length},384px)`, 140 + at.length * 384, `<div></div>${head}${body}`);
  }
  report(faults);
}

/**
 * Each look rolled again and again (M between), a page per look (a few at once): its first roll once the mood and
 * its trails have settled, then one every `seconds`. A sheet per look, the rolls numbered for scoring.
 */
async function showRolls() {
  const shots = new Map<string, string[][]>();
  const queue = [...looks];
  await Promise.all(
    Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      for (let look = queue.shift(); look; look = queue.shift()) {
        await command({ action: "seek", position: 0 });
        const page = await visualizer(look);
        const taken: string[][] = [];
        for (let i = 0; i < rolls; i++) {
          if (i > 0) await page.keyboard.press("m");
          await page.waitForTimeout((i === 0 ? Math.max(seconds, 6) : seconds) * 1000);
          const frames: string[] = [];
          for (const [k, ms] of FRAMES.entries()) {
            if (k > 0) await page.waitForTimeout(ms - FRAMES[k - 1]);
            const file = `${out.replace(/\.png$/, "")}-${look.id}-${i + 1}-${k}.png`;
            await page.screenshot({ path: file });
            frames.push(file);
          }
          taken.push(frames);
        }
        await page.close();
        shots.set(look.id, taken);
        console.log(`  ${look.name}`);
      }
    }),
  );

  const faults: string[] = [];
  for (const look of looks) {
    const cells = [];
    for (const frames of shots.get(look.id) ?? []) cells.push(await judged(frames));
    cells.forEach((c, i) => {
      const problem = fault(c.light);
      if (problem) faults.push(`${look.name} roll ${i + 1}: ${problem}`);
    });
    console.log(`  ${look.name.padEnd(20)} ${cells.map((c, i) => `${i + 1}:${c.light.mean.toFixed(2)}${fault(c.light) ? "!" : ""}`).join(" ")}`);
    const body = cells.map((c, i) => figure(c, `${i + 1}`)).join("");
    await writeSheet(`${out.replace(/\.png$/, "")}-${look.id}.png`, "repeat(6,320px)", 6 * 320, `<div class="title">${look.name} · ${rolls} rolls</div>${body}`);
  }
  report(faults);
}

/** A picture on a sheet, captioned, outlined in red if it fails. */
function figure(c: { file: string; light: Light }, caption: string) {
  return `<figure${fault(c.light) ? ' class="bad"' : ""}><img src="data:image/png;base64,${fs.readFileSync(c.file).toString("base64")}"><figcaption>${caption}</figcaption></figure>`;
}

/** A sheet of pictures in a grid of `columns`, `width` wide. */
async function writeSheet(file: string, columns: string, width: number, html: string) {
  const sheet = await browser.newPage({ viewport: { width, height: 300 } });
  await sheet.setContent(
    `<style>body{margin:0;background:#111;color:#ddd;font:13px system-ui;display:grid;grid-template-columns:${columns}}.head{padding:6px 8px;color:#999}.name{padding:8px;align-self:center}.title{grid-column:1/-1;padding:8px 10px;font-size:15px}figure{margin:0;position:relative;aspect-ratio:16/9}figure.bad{outline:3px solid #f33;outline-offset:-3px}img{width:100%;height:100%;display:block}figcaption{position:absolute;right:8px;bottom:6px;font:12px ui-monospace;text-shadow:0 1px 3px #000}</style>${html}`,
  );
  await sheet.screenshot({ path: file, fullPage: true });
  await sheet.close();
  console.log(`Wrote ${file}`);
}

/** The pictures that fail and the page's errors, said; either fails the run. */
function report(faults: string[]) {
  if (faults.length) {
    console.log(`Pictures that fail:\n${faults.map((f) => `  ${f}`).join("\n")}`);
    process.exitCode = 1;
  }
  if (problems.length) {
    console.log(`Problems in the page:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    process.exitCode = 1;
  }
}

/** A moment's frames judged by the middle one by lightness: kept (without its frame number), the others dropped. */
async function judged(frames: string[]): Promise<{ file: string; light: Light }> {
  const lit = [];
  for (const file of frames) lit.push({ file, light: await lightOf(file) });
  lit.sort((a, b) => a.light.mean - b.light.mean);
  const middle = lit[Math.floor(lit.length / 2)];
  const file = middle.file.replace(/-\d+\.png$/, ".png");
  fs.renameSync(middle.file, file);
  for (const other of lit) if (other !== middle) fs.rmSync(other.file);
  return { file, light: middle.light };
}

/** How light a picture is, read off a canvas in a page of its own (`reader`). */
async function lightOf(file: string): Promise<Light> {
  reader ??= await browser.newPage();
  return reader.evaluate(async (url): Promise<Light> => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = new OffscreenCanvas(320, 180);
    const g = canvas.getContext("2d")!;
    g.drawImage(img, 0, 0, 320, 180);
    const d = g.getImageData(0, 0, 320, 180).data;
    let sum = 0;
    let white = 0;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      sum += y;
      if (y > 0.94) white++;
      if (y < 0.03) black++;
    }
    const n = d.length / 4;
    return { mean: sum / n, white: white / n, black: black / n };
  }, `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`);
}
