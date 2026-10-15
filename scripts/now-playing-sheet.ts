/**
 * Render Now Playing's looks (shared/live-looks.ts) as a contact sheet, in the real app: its own server and web app
 * with the stand-in player (a made-up song measured as if heard), or a sound file of your own (`--song`, never played,
 * only measured), each look shown for a few seconds and screenshot.
 *
 *   pnpm tsx scripts/now-playing-sheet.ts [look|kind ...] [--song file.mp3] [--seconds 4] [--track 1|2|3] [--out sheet.png]
 *   pnpm tsx scripts/now-playing-sheet.ts [look|kind ...] --moments [--at 6,11.5,22] [--parallel 3]
 *   pnpm tsx scripts/now-playing-sheet.ts chaos --rolls 24 --song file.mp3 [--seconds 4]
 *   pnpm tsx scripts/now-playing-sheet.ts chaos-liquid --record 45 --song file.mp3 [--from 48] [--every 6.5] [--auto bars2]
 *     [--keys "6=t 9=y 12=] 18=Backspace"] [--fx '{"feedback":0.85,"kaleido":0.5}'] [--effects music|beat|bar|hand] [--pace 0.5]
 *   pnpm tsx scripts/now-playing-sheet.ts milkdrop --media clip.mp4,picture.jpg [--seconds 6]
 *
 * `--track` picks the stand-in's song, so its cover's colours (1 magenta, 2 orange, 3 cyan). `--pace` is the Speed
 * slider's (1 follows the music, less is slow motion at that speed). `--media` adds clips and pictures of your own to
 * the visualizer's (the Library's Visualizer folder) before it opens: MilkDrop's looks melt them into their feedback.
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
 *
 * `--record` films the visualizer on the first look given for that many seconds (its canvas, 60 fps, as it draws
 * live), the song from `--from` seconds into it, chaos rolled (=) every `--every` seconds or looks changed by
 * themselves (`--auto`, as the menu's: `song` follows the music), keys pressed at film times (`--keys`, `seconds=key`
 * apart by spaces: the frame's T Y [ ] , . Backspace, any of its keys), and puts the song under it in step: `<out>.mp4`,
 * and what the visualizer said as it went (its choices of look, and why) beside it: `<out>.txt`.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page, chromium } from "@playwright/test";
import { LIVE_LOOKS, LOOK_KINDS, type LiveLook } from "../shared/live-looks.ts";
import { DEMO_SECTIONS, demoSong } from "../shared/signals/demo-sound.ts";

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
const recordSeconds = Math.max(0, Number(option("--record") ?? 0));
const from = Math.max(0, Number(option("--from") ?? 0));
const every = Math.max(0, Number(option("--every") ?? 0));
const auto = option("--auto");
// The player's distortions and feedback to start from (the D panel's values, vaudio's units), and who plays them.
const startFx = option("--fx") ?? "";
const effectsBy = option("--effects") ?? (startFx ? "hand" : "");
const pace = option("--pace") ?? "";
const mediaFiles = (option("--media") ?? "").split(",").filter(Boolean);
// Keys to press while filming: `seconds=key`, apart by spaces, in order.
const keysAt = (option("--keys") ?? "")
  .split(/\s+/)
  .filter(Boolean)
  .map((pair) => {
    const [at, ...key] = pair.split("=");
    return { at: Number(at), key: key.join("=") };
  })
  .filter((k) => Number.isFinite(k.at) && k.key)
  .sort((a, b) => a.at - b.at);
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
const names = args.filter((a, i) => !a.startsWith("--") && !["--out", "--song", "--seconds", "--track", "--at", "--parallel", "--rolls", "--record", "--from", "--every", "--auto", "--keys", "--fx", "--effects", "--pace", "--media"].includes(args[i - 1]));
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
  EDITOR_VIBE_MODEL: "stand-in",
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
// Clips and pictures of your own, into the visualizer's folder of the Library (as its media panel adds them).
if (mediaFiles.length) {
  const api = `http://127.0.0.1:${SERVER_PORT}/api/library`;
  const folder = (await (await fetch(`${api}/folders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Visualizer" }) })).json()) as { id: string };
  for (const file of mediaFiles) {
    const added = await fetch(`${api}/items?folderId=${folder.id}&name=${encodeURIComponent(path.basename(file))}`, { method: "POST", body: fs.readFileSync(file) });
    if (!added.ok) throw new Error(`couldn't add ${file}: ${await added.text()}`);
  }
}

// The GPU on (as the export's browser has it): the 3D scenes are too heavy for software rendering.
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])] });
const problems: string[] = [];
// The song from `--from` (and long enough not to come round again while filming): what's heard, and put under the film.
let songFile = song;
if (song && from > 0) {
  songFile = path.join(dataDir, "song.mp3");
  const cut = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(from), "-t", String(recordSeconds ? recordSeconds + 30 : 600), "-i", song, songFile]);
  if (cut.status !== 0) throw new Error(`ffmpeg couldn't cut the song: ${cut.stderr}`);
}
const songBytes = songFile ? fs.readFileSync(songFile) : null;

/** A page of its own with the visualizer open on `look` (listening starts as it opens), without the controls. */
async function visualizer(look: LiveLook) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  if (songBytes) await page.route("**/now-playing-sheet-song", (route) => route.fulfill({ body: songBytes, contentType: "audio/mpeg" }));
  await page.addInitScript(
    ([first, file, changes, quality, fx, by, speed]) => {
      localStorage.setItem("editor-visualizer-look", first);
      if (fx) localStorage.setItem("editor-visualizer-fx", fx);
      if (by) localStorage.setItem("editor-visualizer-effects", by);
      localStorage.setItem("editor-visualizer-auto", changes);
      if (quality) localStorage.setItem("editor-visualizer-quality", quality);
      if (file) localStorage.setItem("editor-now-playing-demo", "/now-playing-sheet-song");
      if (speed) localStorage.setItem("editor-visualizer-pace", speed);
    },
    [look.id, song ? "yes" : "", (recordSeconds && auto) || "off", recordSeconds ? "sharp" : "", startFx, effectsBy, pace] as const,
  );
  await page.goto(web);
  await page.click("[data-now-playing] button[title='Open the visualizer']", { timeout: 30_000 });
  await page.waitForSelector("[data-now-playing-view]");
  await page.mouse.move(2, 2);
  // Without the controls (hidden, not gone).
  await page.keyboard.press("h");
  return page;
}

if (moments || rolls || recordSeconds) {
  await (recordSeconds ? record() : rolls ? showRolls() : showMoments());
  await browser.close();
  process.exit();
}

const page = await visualizer(looks[0]);
const shots: { id: string; name: string; file: string }[] = [];
for (const look of looks) {
  if (look !== looks[0]) {
    // The controls are hidden (H), not gone: the looks menu, the look's kind, then the look.
    const menu = page.locator("[data-looks-menu]");
    await menu.getByRole("button", { name: /^Looks:/ }).click({ force: true });
    await menu.locator(`[data-kind="${look.kind}"]`).click({ force: true });
    await menu.locator(`[data-look="${look.id}"]`).click({ force: true });
  }
  await page.waitForTimeout(seconds * 1000);
  const file = `${out.replace(/\.png$/, "")}-${look.id}.png`;
  await page.screenshot({ path: file });
  shots.push({ id: look.id, name: look.name, file });
  // With clips of your own: which one MilkDrop's feeding in, and how many frames of it so far.
  const fed = mediaFiles.length && look.kind === "milkdrop" ? await page.locator("canvas[data-milkdrop]").evaluate((c) => ` (${c.dataset.media || "no media"}, ${c.dataset.fed ?? 0} frames fed, at ${c.dataset.mediaGain ?? 1} for the picture's sake, background out: ${c.dataset.mediaKeyed})`) : "";
  console.log(`  ${look.name}${fed}`);
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

/**
 * The visualizer filmed: its canvas recorded as it draws (MediaRecorder, a second at a time into `<out>.webm`), then
 * the song laid under it from where it was when filming began, less the picture's own delay (`<out>.mp4`).
 */
async function record() {
  const page = await visualizer(looks[0]);
  const base = out.replace(/\.png$/, "");
  const webm = `${base}.webm`;
  fs.writeFileSync(webm, "");
  await page.exposeFunction("saveFilm", (b64: string) => fs.appendFileSync(webm, Buffer.from(b64, "base64")));
  // What the visualizer says (its choices of look), timed from when filming starts.
  let filmed = 0;
  const said: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("[now-playing]")) said.push(`${filmed ? ((Date.now() - filmed) / 1000).toFixed(1).padStart(6) : "before"} s  ${text.slice(14)}`);
  });
  // The mood and the trails settle first.
  await page.waitForTimeout(3000);
  const heard = await page.evaluate(async () => {
    type Filming = Window & { saveFilm(b64: string): Promise<void>; filming: { recorder: MediaRecorder; saved: Promise<void> } };
    const w = window as unknown as Filming;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-slot="visualizer-canvas"]')!;
    const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 14_000_000 });
    w.filming = { recorder, saved: Promise.resolve() };
    // In order: each second's piece saved after the one before.
    recorder.ondataavailable = (e) => {
      w.filming.saved = w.filming.saved.then(async () => {
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await w.saveFilm(btoa(text));
      });
    };
    // Where the song is as filming starts: the store the app uses (the same module, from the dev server).
    const url = "/src/stores/now-playing.ts";
    const { useNowPlaying } = await import(/* @vite-ignore */ url);
    recorder.start(1000);
    return (useNowPlaying.getState().live?.signals.seconds as number | undefined) ?? 0;
  });
  filmed = Date.now();
  console.log(`  filming ${looks[0].name} from ${heard.toFixed(2)} s into the song`);
  const until = Date.now() + recordSeconds * 1000;
  let nextRoll = every ? filmed + every * 1000 : Infinity;
  const pending = [...keysAt];
  while (Date.now() < until - 300) {
    await page.waitForTimeout(Math.max(10, Math.min(nextRoll, pending[0] ? filmed + pending[0].at * 1000 : Infinity, until) - Date.now()));
    if (Date.now() >= nextRoll && Date.now() < until - 1000) {
      await page.keyboard.press("=");
      nextRoll += every * 1000;
    }
    while (pending[0] && Date.now() >= filmed + pending[0].at * 1000) await page.keyboard.press(pending.shift()!.key);
  }
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        const { filming } = window as unknown as { filming: { recorder: MediaRecorder; saved: Promise<void> } };
        filming.recorder.onstop = () => void filming.saved.then(() => done());
        filming.recorder.stop();
      }),
  );
  await page.close();
  // The picture of a moment is drawn ~35 ms after it's heard (the analysis, a frame): the song starts that early.
  // Without a song, the made-up one (the tab's, never played) is made again here, the same from its start.
  const mp4 = `${base}.mp4`;
  const sound = songFile ?? writeDemoSong(path.join(dataDir, "demo.wav"), heard + recordSeconds + 5);
  const audio = ["-ss", String(Math.max(0, heard - 0.035)), "-i", sound, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest"];
  const mux = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", webm, ...audio, "-vf", "fps=60", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
  if (mux.status !== 0) throw new Error(`ffmpeg couldn't make the film: ${mux.stderr}`);
  fs.writeFileSync(`${base}.txt`, `${said.join("\n")}\n`);
  console.log(`Wrote ${mp4} and ${base}.txt`);
  report([]);
}

/** The made-up song (`demoSong`), `seconds` of it from its start, as a 16-bit stereo WAV at `file`. */
function writeDemoSong(file: string, seconds: number): string {
  const rate = 48_000;
  const samples = demoSong(rate).next(Math.ceil(rate * seconds));
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
  return file;
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
