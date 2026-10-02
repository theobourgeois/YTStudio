/**
 * How the editor copes with a long edit: starts its own server and app (on
 * ports 5330/5331, with a throwaway data dir), saves a project of `clips`
 * captions, and times what a user does with it in headless Chromium: opening
 * it, dragging, scrolling, the Captions tab, selecting everything, playing,
 * zooming to fit. Long tasks are main-thread work over 50 ms (what feels like lag).
 *
 *   pnpm tsx scripts/perf.ts [clips=1500] [--profile <scenario>]
 *
 * `--profile drag` (any part of a scenario's name) samples that scenario with
 * the JS profiler and prints where the time went, by component and by function.
 * The app runs in dev mode (like `pnpm dev`), so React's development build counts.
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type CDPSession, chromium } from "@playwright/test";
import { textEffects } from "../shared/effects.ts";
import type { Clip, Project, ProjectSummary } from "../shared/types.ts";

const WEB_PORT = "5330";
const SERVER_PORT = "5331";

const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
const profileName = profileIndex >= 0 ? args[profileIndex + 1] : null;
const count = Number(args.find((a, i) => /^\d+$/.test(a) && i !== profileIndex + 1) ?? 1500);

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

// One caption a second: 0.8 s of text, then a gap.
const json = { "content-type": "application/json" };
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
