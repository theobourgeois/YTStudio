/**
 * How the editor copes with a long edit: starts its own server and app (on
 * ports 5330/5331, with a throwaway data dir), saves a project of `clips`
 * captions, and times what a user does with it in headless Chromium: opening
 * it, dragging, scrolling, the Captions tab, selecting everything, playing,
 * zooming to fit. Long tasks are main-thread work over 50 ms (what feels like lag).
 *
 *   pnpm tsx scripts/perf.ts [clips=1500] [--profile <scenario>]
 *   pnpm tsx scripts/perf.ts --links [clips=300]
 *   pnpm tsx scripts/perf.ts --visualizers
 *   pnpm tsx scripts/perf.ts --scrub <Project.ytvid> [--render]
 *
 * `--links` is the visualizer's gate instead (V3, docs/visualizer/README.md): a song and `clips`
 * solids on ten tracks, each with its scale linked to the bass and its opacity to the kicks, played
 * for 4 s: how many frames a second the preview draws, and the long tasks. `--visualizers` is V4's: three
 * visualizers (Spectrum Bars, Circular Spectrum, Spectrogram) over a song in a 9:16 video, played.
 * `--scrub` opens a copy of a real project in Chrome with the GPU, on a Retina-sized window, and scrubs
 * its ruler as a hand does (a move every 8 ms, not waiting for the page), then plays it: how smooth the
 * page stays, how many frames the Program monitor draws, and at what size (adaptive resolution). With `--render`
 * it renders the effects first (Enter, docs/render-files.md) and says how long that took and what the monitor
 * then showed: the render files, or live drawing.
 * `--profile drag` (any part of a scenario's name) samples that scenario with
 * the JS profiler and prints where the time went, by component and by function.
 * The app runs in dev mode (like `pnpm dev`), so React's development build counts.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type CDPSession, chromium } from "@playwright/test";
import { defaultEffects, solidEffects, textEffects, visualizerEffects } from "../shared/effects.ts";
import type { Clip, MediaAsset, Project, ProjectSummary } from "../shared/types.ts";

// PERF_WEB_PORT/PERF_SERVER_PORT move it off these when another checkout's run has them.
const WEB_PORT = process.env.PERF_WEB_PORT ?? "5330";
const SERVER_PORT = process.env.PERF_SERVER_PORT ?? "5331";

const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
const profileName = profileIndex >= 0 ? args[profileIndex + 1] : null;
const links = args.includes("--links");
const visualizers = args.includes("--visualizers");
const scrubIndex = args.indexOf("--scrub");
const scrubPackage = scrubIndex >= 0 ? args[scrubIndex + 1] : null;
const count = Number(args.find((a, i) => /^\d+$/.test(a) && i !== profileIndex + 1) ?? (links ? 300 : 1500));

// A server already there (another checkout's run left behind) would be measured instead of this one.
for (const port of [WEB_PORT, SERVER_PORT]) {
  const taken = await fetch(`http://localhost:${port}`).then(() => true, () => false);
  if (taken) throw new Error(`Port ${port} is taken: stop what's on it, or set PERF_WEB_PORT/PERF_SERVER_PORT.`);
}

const root = path.resolve(import.meta.dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "editor-perf-"));
const env = { ...process.env, EDITOR_DATA_DIR: dataDir, EDITOR_SERVER_PORT: SERVER_PORT, EDITOR_WEB_PORT: WEB_PORT };
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

const api = `http://127.0.0.1:${SERVER_PORT}/api`;
await waitFor(`${api}/health`);
await waitFor(`http://localhost:${WEB_PORT}`);

const json = { "content-type": "application/json" };
if (links || visualizers) await linkedPlayback();
if (scrubPackage) await scrubProject(path.resolve(scrubPackage));

// One caption a second: 0.8 s of text, then a gap.
const summary: ProjectSummary = await (await fetch(`${api}/projects`, { method: "POST", headers: json, body: "{}" })).json();
const project: Project = await (await fetch(`${api}/projects/${summary.id}`)).json();
const id = (i: number) => `clip_${String(i).padStart(6, "0")}`;
project.clips = Array.from(
  { length: count },
  (_, i): Clip => ({
    id: id(i),
    assetId: "",
    trackId: project.tracks[0].id,
    caption: true,
    start: i,
    in: 0,
    out: 0.8,
    effects: textEffects({ text: `Caption number ${i}` }),
  }),
);
// The first clips are animated (keyframed scale), as a hand-made edit's are.
for (const clip of project.clips.slice(0, 20)) {
  clip.effects = clip.effects.map((e) =>
    e.type === "motion"
      ? { ...e, keyframes: { scale: [{ time: 0, value: 1, easing: "linear" }, { time: 0.8, value: 1.5, easing: "linear" }] } }
      : e,
  );
}

const results: [string, string][] = [];
let t0 = performance.now();
const saved = await fetch(`${api}/projects/${summary.id}`, { method: "PUT", headers: json, body: JSON.stringify(project) });
if (!saved.ok) throw new Error(`Saving the project failed: ${await saved.text()}`);
results.push(["save (server)", `${(performance.now() - t0).toFixed(0)} ms`]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  const w = window as unknown as { __recording: boolean; __longTasks: number };
  w.__recording = false;
  w.__longTasks = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (w.__recording) w.__longTasks += e.duration;
  }).observe({ type: "longtask" });
});
const cdp = await page.context().newCDPSession(page);

async function scenario(name: string, action: () => Promise<void>) {
  const profiling = profileName !== null && name.includes(profileName);
  if (profiling) await startProfile(cdp);
  await page.evaluate(() => {
    const w = window as unknown as { __recording: boolean; __longTasks: number };
    w.__longTasks = 0;
    w.__recording = true;
  });
  const start = performance.now();
  await action();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wall = performance.now() - start;
  const long = await page.evaluate(() => {
    const w = window as unknown as { __recording: boolean; __longTasks: number };
    w.__recording = false;
    return w.__longTasks;
  });
  results.push([name, `${wall.toFixed(0).padStart(5)} ms, long tasks ${long.toFixed(0).padStart(5)} ms`]);
  if (profiling) await printProfile(cdp, name);
}

const domSize = () =>
  page.evaluate(() => `${document.querySelectorAll("*").length} elements, ${document.querySelectorAll("[data-clip-id]").length} clips drawn`);
const scroller = () => page.locator("[data-timeline-lanes]").evaluateHandle((el) => el.closest(".overflow-auto")!);
const tab = (name: string) => page.getByRole("tab", { name }).or(page.getByRole("button", { name, exact: true })).first();

async function dragClip(index: number, dx: number) {
  const box = (await page.locator(`[data-clip-id="${id(index)}"]`).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(x + (dx * k) / 20, y);
  await page.mouse.up();
}

t0 = performance.now();
await page.goto(`http://localhost:${WEB_PORT}/p/${summary.id}`);
await page.locator("[data-clip-id]").first().waitFor({ timeout: 120_000 });
results.push(["open the project", `${(performance.now() - t0).toFixed(0)} ms`]);
results.push(["page size", await domSize()]);

async function scrub() {
  const box = (await page.locator("[data-timeline-ruler]").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 10, y);
  await page.mouse.down();
  for (let k = 1; k <= 60; k++) {
    await page.mouse.move(box.x + 10 + k * 8, y);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await page.mouse.up();
}

await scenario("scrub the ruler (60 moves)", scrub);
await page.locator(`[data-clip-id="${id(2)}"]`).click();
await scenario("scrub, animated clip selected", scrub);
await page.keyboard.press("Escape");
await scenario("drag a clip (20 moves)", () => dragClip(3, 45));
await scenario("scroll the timeline (30 steps)", async () => {
  const el = await scroller();
  for (let k = 0; k < 30; k++) {
    await el.evaluate((s) => (s.scrollLeft += 150));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await el.evaluate((s) => (s.scrollLeft = 0));
});
await scenario("open the Captions tab", async () => {
  await tab("Captions").click();
  await page.getByText(`${count} captions`).waitFor({ timeout: 120_000 });
});
await scenario("drag a clip, Captions tab open", () => dragClip(3, -45));
await scenario("select all", async () => {
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
});
await scenario("deselect all", () => page.keyboard.press("Escape"));
await scenario("play 2 s", async () => {
  await page.keyboard.press("Space");
  await page.waitForTimeout(2000);
  await page.keyboard.press("Space");
});
await tab("Media").click();
await scenario("zoom to fit", async () => {
  await page.keyboard.press("Shift+Z");
  await page.waitForTimeout(300);
});
results.push(["page size at fit", await domSize()]);
await scenario("drag a clip at fit (20 moves)", () => dragClip(Math.floor(count / 2), 30));

console.log(`\n${count} captions\n`);
for (const [name, value] of results) console.log(`${name.padEnd(34)} ${value}`);
await browser.close();
process.exit(0);

/** The visualizer's gate: `count` linked solids over a song, played; frames drawn a second. Exits. */
async function linkedPlayback(): Promise<never> {
  const summary: ProjectSummary = await (await fetch(`${api}/projects`, { method: "POST", headers: json, body: "{}" })).json();
  const song: MediaAsset = await (
    await fetch(`${api}/media?projectId=${summary.id}&name=music-20s.mp3`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(root, "samples", "music-20s.mp3")),
    })
  ).json();
  // Its signals first (the preview waits for nothing then).
  for (let i = 0; i < 240; i++) {
    const asset: MediaAsset = await (await fetch(`${api}/media/${song.id}`)).json();
    if (asset.signals?.status === "ready") break;
    if (i === 0) await fetch(`${api}/media/${song.id}/signals`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 250));
  }
  let project: Project = await (await fetch(`${api}/projects/${summary.id}`)).json();
  const tracks = Array.from({ length: 10 }, (_, k) => ({ id: `v${k}`, kind: "video" as const, name: `Video ${k + 1}`, muted: false }));
  const audio = { id: "a1", kind: "audio" as const, name: "Music", muted: false };
  const perTrack = Math.ceil(count / tracks.length);
  const length = 20 / perTrack;
  const response = { threshold: 0, curve: 1, attack: 0.01, release: 0.12, invert: false };
  const looks = ["audio-bars", "audio-circle", "audio-spectrogram"];
  project = {
    ...project,
    settings: { ...project.settings, aspectRatio: "9:16" },
    tracks: [...tracks, audio],
    clips: [
      { id: "song", assetId: song.id, trackId: "a1", start: 0, in: 0, out: 20, effects: defaultEffects() },
      ...(visualizers ? looks.map((type, i): Clip => ({ id: `look_${i}`, assetId: "", trackId: tracks[i].id, start: 0, in: 0, out: 20, effects: visualizerEffects(type) })) : []),
      ...Array.from({ length: visualizers ? 0 : count }, (_, i): Clip => ({
        id: `solid_${i}`,
        assetId: "",
        trackId: tracks[i % tracks.length].id,
        start: Math.floor(i / tracks.length) * length,
        in: 0,
        out: length,
        effects: solidEffects({ color: "#ff3366" }).map((e) =>
          e.type === "motion"
            ? { ...e, params: { ...e.params, scale: 0.2 }, links: { scale: { signal: { name: "bass" }, mode: "add", amount: 0.3, response } } }
            : e.type === "opacity"
              ? { ...e, params: { ...e.params, opacity: 0.4 }, links: { opacity: { signal: { name: "onsetLow" }, mode: "add", amount: 0.6, response, hit: { attack: 0, hold: 0, decay: 0.25 } } } }
              : e,
        ),
      })),
    ],
  };
  const saved = await fetch(`${api}/projects/${summary.id}`, { method: "PUT", headers: json, body: JSON.stringify(project) });
  if (!saved.ok) throw new Error(`Saving the project failed: ${await saved.text()}`);

  const browser = await chromium.launch();
  // Visualizers are GPU work by the pixel: a big window on a Retina screen.
  const page = await browser.newPage(visualizers ? { viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number };
    w.__longTasks = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks += e.duration;
    }).observe({ type: "longtask" });
  });
  await page.goto(`http://localhost:${WEB_PORT}/p/${summary.id}`);
  await page.locator("[data-clip-id]").first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(2000);
  // Frames the Program monitor draws while playing (each preview draw is a frame).
  // As text: tsx would wrap a function's inner names in a helper the page doesn't have.
  const measure = (): Promise<{ fps: number; worst: number; long: number }> =>
    page.evaluate(`new Promise((done) => {
      window.__longTasks = 0;
      let frames = 0, worst = 0, last = performance.now();
      const start = last;
      const tick = (now) => {
        frames++;
        worst = Math.max(worst, now - last);
        last = now;
        if (now - start < 4000) requestAnimationFrame(tick);
        else done({ fps: frames / ((performance.now() - start) / 1000), worst, long: window.__longTasks });
      };
      requestAnimationFrame(tick);
    })`);
  await page.locator("body").click({ position: { x: 720, y: 20 } });
  const idle = await measure();
  await page.keyboard.press("Space");
  const playing = await measure();
  await page.keyboard.press("Space");
  // Again from the start: what's left is drawing, not the followers being worked out the first time.
  await page.keyboard.press("Home");
  await page.keyboard.press("Space");
  const again = await measure();
  await page.keyboard.press("Space");
  console.log(
    visualizers
      ? `\nThree visualizers (${looks.join(", ")}) over a song, 9:16\n`
      : `\n${count} solids linked to the sound (scale to the bass, opacity to the kicks), ${tracks.length} tracks\n`,
  );
  const line = (name: string, m: { fps: number; worst: number; long: number }) =>
    console.log(`${name.padEnd(12)} ${m.fps.toFixed(1)} frames a second, slowest frame ${m.worst.toFixed(0)} ms, long tasks ${m.long.toFixed(0)} ms`);
  line("paused", idle);
  line("play 4 s", playing);
  line("play again", again);
  await browser.close();
  process.exit(0);
}

/** `--scrub`: a real project scrubbed and played, measured. Exits. */
async function scrubProject(pkg: string): Promise<never> {
  // A copy in the throwaway data folder's own Documents, so the real one is never touched.
  const copy = path.join(dataDir, "Documents", "YTStudio", path.basename(pkg));
  fs.cpSync(pkg, copy, { recursive: true });
  const opened = await fetch(`${api}/projects/open`, { method: "POST", headers: json, body: JSON.stringify({ path: copy }) });
  if (!opened.ok) throw new Error(`Opening ${pkg} failed: ${await opened.text()}`);
  const summary: ProjectSummary = await opened.json();

  // Chrome (not Playwright's Chromium) draws with the real GPU, headless too.
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1728, height: 1050 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    const w = window as unknown as { __recording: boolean; __longTasks: number; __drawn: number };
    w.__recording = false;
    w.__longTasks = 0;
    w.__drawn = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (w.__recording) w.__longTasks += e.duration;
    }).observe({ type: "longtask" });
    // Each frame the preview draws ends with a fence (see `PreviewEngine.inFlight`).
    const fenceSync = WebGL2RenderingContext.prototype.fenceSync;
    WebGL2RenderingContext.prototype.fenceSync = function (...a) {
      w.__drawn++;
      return fenceSync.apply(this, a);
    };
  });
  await page.goto(`http://localhost:${WEB_PORT}/p/${summary.id}`);
  await page.locator("[data-clip-id]").first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  const canvas = page.locator("[data-slot=preview-canvas]");
  const results: [string, string][] = [];
  if (args.includes("--render")) {
    await page.locator("body").click({ position: { x: 900, y: 20 } });
    const start = performance.now();
    await page.keyboard.press("Enter");
    await page.locator("[data-rendering]").waitFor({ timeout: 30_000 });
    await page.locator("[data-rendering]").waitFor({ state: "detached", timeout: 30 * 60_000 });
    const runs = await page.locator("[data-render-run]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.renderRun).join(" "));
    results.push(["render effects (Enter)", `${((performance.now() - start) / 1000).toFixed(1)} s, the bar: ${runs}`]);
  }
  const canvasSize = () => canvas.evaluate((c: HTMLCanvasElement) => `${c.width}×${c.height}`);
  // As text: tsx would wrap a function's inner names in a helper the page doesn't have.
  const startRecording = () =>
    page.evaluate(`(() => {
      window.__longTasks = 0; window.__drawn = 0; window.__recording = true; window.__frames = [];
      let last = performance.now();
      const tick = (now) => { window.__frames.push(now - last); last = now; if (window.__recording) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    })()`);
  const stopRecording = (): Promise<{ fps: number; worst: number; drawn: number; long: number }> =>
    page.evaluate(`(() => {
      window.__recording = false;
      const f = window.__frames.slice(1);
      const sum = f.reduce((a, b) => a + b, 0);
      return { fps: f.length / (sum / 1000), worst: Math.max(...f), drawn: window.__drawn, long: window.__longTasks };
    })()`);
  const record = (name: string, wall: number, m: { fps: number; worst: number; drawn: number; long: number }, extra = "") =>
    results.push([name, `${wall.toFixed(0).padStart(6)} ms, page ${m.fps.toFixed(0)} fps (slowest ${m.worst.toFixed(0)} ms), monitor drew ${m.drawn}, long tasks ${m.long.toFixed(0)} ms${extra}`]);

  const session = await page.context().newCDPSession(page);
  async function scrub(name: string, from: number, to: number, moves = 60) {
    const profiling = profileName !== null && name.includes(profileName);
    await page.locator("body").click({ position: { x: 900, y: 20 } });
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+Z");
    const scroller = await page.locator("[data-timeline-lanes]").evaluateHandle((el) => el.closest(".overflow-auto")!);
    await scroller.evaluate((s) => (s.scrollLeft = 0));
    await page.waitForTimeout(600);
    const ruler = (await page.locator("[data-timeline-ruler]").boundingBox())!;
    const shown = (await scroller.asElement()!.boundingBox())!;
    const width = Math.min(ruler.width, shown.x + shown.width - ruler.x);
    const [y, x0, x1] = [ruler.y + ruler.height / 2, ruler.x + width * from, ruler.x + width * to];
    await page.mouse.move(x0, y);
    await page.mouse.down();
    if (profiling) await startProfile(session);
    await startRecording();
    const start = performance.now();
    for (let k = 1; k <= moves; k++) {
      await page.mouse.move(x0 + ((x1 - x0) * k) / moves, y);
      await new Promise((r) => setTimeout(r, 8));
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const wall = performance.now() - start;
    const during = `${await canvasSize()} ${await canvas.evaluate((c: HTMLCanvasElement) => c.dataset.source)}`;
    const m = await stopRecording();
    await page.mouse.up();
    await page.waitForTimeout(1000);
    record(name, wall, m, `, drawn at ${during} (${await canvasSize()} once still)`);
    if (profiling) await printProfile(session, name);
  }

  await scrub("scrub the edit (60 moves)", 0, 0.9);
  await scrub("scrub it again", 0, 0.9);
  await scrub("scrub its last third", 0.6, 0.9);
  await page.keyboard.press("Home");
  await page.waitForTimeout(500);
  await startRecording();
  const start = performance.now();
  await page.keyboard.press("Space");
  await page.waitForTimeout(4000);
  await page.keyboard.press("Space");
  record("play 4 s", performance.now() - start, await stopRecording());

  console.log(`\n${summary.name}\n`);
  for (const [name, value] of results) console.log(`${name.padEnd(28)} ${value}`);
  await browser.close();
  process.exit(0);
}

async function startProfile(session: CDPSession) {
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  await session.send("Profiler.start");
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

/** Where a scenario's time went: components (inclusive, from `src/`) and functions (self time). */
async function printProfile(session: CDPSession, name: string) {
  const { profile } = await session.send("Profiler.stop");
  const nodes = new Map<number, ProfileNode>(profile.nodes.map((n: ProfileNode) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of nodes.values()) for (const c of n.children ?? []) parent.set(c, n.id);
  const file = (url: string) => url.split("/").pop()!.split("?")[0];
  const components = new Map<string, number>();
  const functions = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, ms: number) => map.set(key, (map.get(key) ?? 0) + ms);
  profile.samples!.forEach((sample: number, i: number) => {
    const ms = (profile.timeDeltas![i] ?? 0) / 1000;
    const leaf = nodes.get(sample)!.callFrame;
    if (!leaf.functionName.startsWith("(")) add(functions, `${leaf.functionName || "(anonymous)"} ${file(leaf.url)}:${leaf.lineNumber + 1}`, ms);
    const seen = new Set<string>();
    for (let n: number | undefined = sample; n !== undefined; n = parent.get(n)) {
      const f = nodes.get(n)!.callFrame;
      const key = `${f.functionName} ${file(f.url)}`;
      if (!/^[A-Z]/.test(f.functionName) || !f.url.includes("/src/") || seen.has(key)) continue;
      seen.add(key);
      add(components, key, ms);
    }
  });
  const top = (map: Map<string, number>) =>
    [...map].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `  ${v.toFixed(1).padStart(7)} ms  ${k}`).join("\n");
  console.log(`\nProfile of "${name}"\nComponents (inclusive):\n${top(components)}\nFunctions (self):\n${top(functions)}`);
}
