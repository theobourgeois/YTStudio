/**
 * How heavy Now Playing's looks are, and whether it holds up over time (docs/now-playing.md, "Speed"): its own server
 * and web app with the stand-in player, Chromium on the GPU at the display's frame rate, as the app is.
 *
 *   pnpm tsx scripts/now-playing-perf.ts [look|kind ...] [--seconds 3] [--data <dir>] [--quality sharp] [--size 1920x1080] [--out perf.json]
 *   pnpm tsx scripts/now-playing-perf.ts <look> --profile [--seconds 3]   # where the page's time goes on it
 *   pnpm tsx scripts/now-playing-perf.ts <look> --trace [--seconds 3]     # what every thread does on it, the GPU's too
 *   pnpm tsx scripts/now-playing-perf.ts --soak 20 [--auto bars1] [--data <dir>]
 *
 * Each look is shown in turn and measured for `--seconds`: the frames the engine drew a second (60 is every one), what
 * one cost the GPU (the engine's own timer: its compositing, not MilkDrop's or a model's canvas, which show as frames
 * missed) and the page's own work (script, style, layout: milliseconds a frame), slowest first. (Without vsync it's no
 * measure: with only a canvas changing, headless Chromium draws 32 frames a second whatever they cost.) `--soak` lets the looks change by themselves (`--auto`, every bar by
 * default) for that many minutes and says every half minute how fast it's drawing, the JS heap, the WebGL objects alive
 * (programs, shaders, textures, buffers, framebuffers: what isn't deleted piles up on the GPU) and the GPU process's
 * memory: a leak is a column that only grows. `--data` copies a data folder (the desktop app's, with your sets and
 * models) to start from, so your media go in; without it there are none (`--no-media` turns them off).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Page, chromium } from "@playwright/test";
import { LIVE_LOOKS } from "../shared/live-looks.ts";

const WEB_PORT = "5360";
const SERVER_PORT = "5361";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const OPTIONS = ["--seconds", "--data", "--quality", "--size", "--out", "--soak", "--auto"];
const root = path.resolve(import.meta.dirname, "..");
const seconds = Number(option("--seconds") ?? 3);
const soakMinutes = Number(option("--soak") ?? 0);
const auto = option("--auto") ?? "bars1";
const quality = option("--quality") ?? "balanced";
const [width, height] = (option("--size") ?? "1600x900").split("x").map(Number);
const out = path.resolve(option("--out") ?? path.join(root, "now-playing-perf.json"));
const names = args.filter((a, i) => !a.startsWith("--") && !OPTIONS.includes(args[i - 1]));
const looks = names.length ? LIVE_LOOKS.filter((l) => names.includes(l.id) || names.includes(l.kind)) : LIVE_LOOKS;
if (!looks.length) {
  console.error(`No looks match ${names.join(", ")}.`);
  process.exit(1);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "editor-now-playing-perf-"));
const from = option("--data");
if (from) fs.cpSync(from, dataDir, { recursive: true, filter: (src) => !/[\\/](logs|tmp|exports)$/.test(src) });
const env = {
  ...process.env,
  EDITOR_DATA_DIR: dataDir,
  EDITOR_SERVER_PORT: SERVER_PORT,
  EDITOR_WEB_PORT: WEB_PORT,
  EDITOR_NOW_PLAYING: "stand-in",
  EDITOR_VIBE_MODEL: "stand-in",
  EDITOR_ENGINE_PATH: path.join(root, "server/music/fake-engine.mjs"),
};
const windows = process.platform === "win32";
const start = (command: string) => spawn(command, { cwd: root, env, stdio: "ignore", shell: true, detached: !windows });
const children: ChildProcess[] = [start("pnpm exec tsx server/index.ts"), start(`pnpm exec vite --port ${WEB_PORT} --strictPort`)];
function cleanUp() {
  for (const child of children) {
    try {
      if (windows) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
      else process.kill(-child.pid!);
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
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} didn't come up`);
}
await waitFor(`http://127.0.0.1:${SERVER_PORT}/api/health`);
await waitFor(`http://localhost:${WEB_PORT}`);
await fetch(`http://127.0.0.1:${SERVER_PORT}/api/now-playing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "play" }) });

const gpu = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : windows ? ["--use-angle=d3d11", "--enable-gpu"] : [];
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", ...gpu] });
const page = await browser.newPage({ viewport: { width, height } });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(e.message));
// (A string: tsx's helpers aren't in the page.)
await page.addInitScript(`
  localStorage.setItem("editor-visualizer-look", ${JSON.stringify(looks[0].id)});
  localStorage.setItem("editor-visualizer-auto", ${JSON.stringify(soakMinutes ? auto : "off")});
  localStorage.setItem("editor-visualizer-quality", ${JSON.stringify(quality)});
  ${args.includes("--no-media") ? 'localStorage.setItem("editor-visualizer-media", "off");' : ""}
  ${args.includes("--no-effects") ? 'localStorage.setItem("editor-visualizer-effects", "hand"); localStorage.setItem("editor-visualizer-fx", JSON.stringify({ warp: 0, swirl: 0, ripple: 0, kaleido: 0, lens: 0, fold: 0, feedback: 0, trails: 0, echoZoom: 0, echoSpin: 0, echoHue: 0, echoFlow: 0 }));' : ""}
  // (tsx names the functions handed to page.evaluate with a helper of its own.)
  window.__name = (f) => f;
  // WebGL's objects alive, every context's: made less deleted.
  const alive = {};
  window.glAlive = alive;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const kind of ["Program", "Shader", "Texture", "Buffer", "Framebuffer", "Renderbuffer", "VertexArray"]) {
      const make = proto["create" + kind];
      const drop = proto["delete" + kind];
      if (!make || !drop) continue;
      Object.defineProperty(proto, "create" + kind, { value(...a) { alive[kind] = (alive[kind] ?? 0) + 1; return make.apply(this, a); } });
      Object.defineProperty(proto, "delete" + kind, { value(...a) { if (a[0]) alive[kind] = (alive[kind] ?? 0) - 1; return drop.apply(this, a); } });
    }
  }
`);
await page.goto(`http://localhost:${WEB_PORT}`);
await page.click("[data-visualize-sound]", { timeout: 60_000 });
await page.waitForSelector("[data-now-playing-view]");
await page.mouse.move(2, 2);
await page.keyboard.press("h");
await page.waitForSelector('[data-slot="visualizer-canvas"][data-drawn="clips"]', { timeout: 60_000 }).catch(() => {});
console.log(
  "GPU:",
  await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  }),
);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");

/** The page's work so far (seconds) and its JS heap (bytes). */
async function metrics() {
  const { metrics: all } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(all.map((x) => [x.name, x.value]));
  return { work: (m.ScriptDuration ?? 0) + (m.RecalcStyleDuration ?? 0) + (m.LayoutDuration ?? 0), heap: m.JSHeapUsedSize ?? 0 };
}
/** The frames the engine has drawn and what the last of them cost the GPU (ms): `PreviewEngine` puts them on its canvas. */
const engine = (p: Page) =>
  p.locator('[data-slot="visualizer-canvas"]').evaluate((c: HTMLElement) => ({ frames: Number(c.dataset.drawnFrames ?? 0), gpu: Number(c.dataset.frameMs ?? 0), level: c.dataset.level ?? "" }));

/** The engine's frames a second, what one cost the GPU and the page's milliseconds of work a frame, over `s` seconds. */
async function measure(s: number) {
  const [e0, m0, t0] = [await engine(page), await metrics(), performance.now()];
  const gpu: number[] = [];
  for (let at = 0; at < s * 1000; at += 500) {
    await page.waitForTimeout(500);
    gpu.push((await engine(page)).gpu);
  }
  const [e1, m1, t1] = [await engine(page), await metrics(), performance.now()];
  const n = Math.max(1, e1.frames - e0.frames);
  return { level: e1.level, fps: (n * 1000) / (t1 - t0), gpu: gpu.reduce((a, b) => a + b, 0) / gpu.length, work: ((m1.work - m0.work) * 1000) / n, heap: m1.heap };
}

/** The GPU process's memory (MB), as the system counts it. */
function gpuMemory(): number | null {
  if (windows) {
    const ps = spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='chrome-headless-shell.exe'\" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | ForEach-Object { $_.PrivatePageCount }"], { encoding: "utf8" });
    const values = ps.stdout.split(/\s+/).filter(Boolean).map(Number);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / 1048576) : null;
  }
  const ps = spawnSync("sh", ["-c", "ps -axo rss,command | grep -- '--type=gpu-process' | grep -v grep | awk '{s+=$1} END {print s}'"], { encoding: "utf8" });
  const kb = Number(ps.stdout.trim());
  return kb ? Math.round(kb / 1024) : null;
}

const showing = () => page.locator("[data-now-playing-view]").getAttribute("data-showing");

if (args.includes("--trace")) {
  // What every thread does on the first look (the GPU process's too): slices by their own time, per thread.
  await page.waitForTimeout(1500);
  const traced = path.join(os.tmpdir(), "now-playing-trace.json");
  await browser.startTracing(page, { path: traced, categories: ["gpu", "gpu.service", "viz", "cc", "toplevel", "blink", "v8", "disabled-by-default-gpu.service", "disabled-by-default-devtools.timeline"] });
  const m = await measure(seconds);
  await browser.stopTracing();
  const { traceEvents } = JSON.parse(fs.readFileSync(traced, "utf8")) as { traceEvents: { ph: string; name: string; pid: number; tid: number; ts: number; dur?: number; args?: { name?: string } }[] };
  const threads = new Map<string, string>();
  for (const e of traceEvents) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args?.name ?? "?");
  const byThread = new Map<string, Map<string, number>>();
  for (const e of traceEvents) {
    if (e.ph !== "X" || !e.dur) continue;
    const thread = threads.get(`${e.pid}:${e.tid}`) ?? "?";
    const slices = byThread.get(thread) ?? new Map<string, number>();
    slices.set(e.name, (slices.get(e.name) ?? 0) + e.dur);
    byThread.set(thread, slices);
  }
  console.log(`${looks[0].id}: ${m.fps.toFixed(0)} fps, ${m.gpu.toFixed(1)} GPU ms (trace: ${traced})`);
  for (const [thread, slices] of byThread) {
    const top = [...slices].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!top.length || top[0][1] < seconds * 1e5) continue;
    console.log(`  ${thread}`);
    for (const [name, us] of top) console.log(`    ${((us / 1000 / (seconds * 1000)) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
} else if (args.includes("--profile")) {
  // Where the page's time goes on the first look: its functions by their own time.
  await page.waitForTimeout(1500);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const m = await measure(seconds);
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map<string, number>();
  const ids = new Map(profile.nodes.map((n) => [n.id, n]));
  const counts = new Map<number, number>();
  for (const id of profile.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const total = (profile.samples ?? []).length;
  for (const [id, n] of counts) {
    const f = ids.get(id)!.callFrame;
    const key = `${f.functionName || "(anonymous)"}  ${f.url.replace(/^.*\/(src|node_modules|@fs)\//, "")}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + n);
  }
  console.log(`${looks[0].id}: ${m.fps.toFixed(0)} fps, ${m.gpu.toFixed(1)} GPU ms, ${m.work.toFixed(1)} ms of work a frame`);
  for (const [key, n] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${((100 * n) / total).toFixed(1).padStart(5)}%  ${key}`);
} else if (soakMinutes) {
  const started = Date.now();
  console.log("  min   fps  GPU ms  ms/frame  heap MB  GPU MB  look            WebGL alive");
  const rows = [];
  while (Date.now() - started < soakMinutes * 60_000) {
    const m = await measure(30);
    const alive = await page.evaluate(() => (window as unknown as { glAlive: Record<string, number> }).glAlive);
    const row = { minutes: (Date.now() - started) / 60_000, ...m, gpuMB: gpuMemory(), look: await showing(), alive };
    rows.push(row);
    console.log(
      `${row.minutes.toFixed(1).padStart(5)} ${row.fps.toFixed(0).padStart(5)} ${row.gpu.toFixed(1).padStart(7)} ${row.work.toFixed(1).padStart(9)} ${(row.heap / 1048576).toFixed(0).padStart(8)} ${String(row.gpuMB ?? "?").padStart(7)}  ${(row.look ?? "").padEnd(15)} ${Object.entries(alive).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
  }
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
} else {
  const rows: { look: string; kind: string; fps: number; gpu: number; work: number; level: string }[] = [];
  const line = (r: (typeof rows)[number]) =>
    `  ${r.look.padEnd(34)} ${r.kind.padEnd(9)} ${r.fps.toFixed(0).padStart(4)} fps ${r.gpu.toFixed(1).padStart(6)} GPU ms ${r.work.toFixed(1).padStart(6)} ms/frame  at ${r.level}`;
  for (const look of looks) {
    if (look !== looks[0] || (await showing()) !== look.id) {
      const menu = page.locator("[data-looks-menu]");
      await menu.getByRole("button", { name: /^Looks:/ }).click({ force: true });
      await menu.locator(`[data-kind="${look.kind}"]`).click({ force: true });
      await menu.locator(`[data-look="${look.id}"]`).click({ force: true });
      await page.mouse.move(2, 2);
    }
    // (Settled: a MilkDrop preset compiling, a scene's first frames.)
    await page.waitForTimeout(1200);
    const m = await measure(seconds);
    rows.push({ look: look.id, kind: look.kind, fps: m.fps, gpu: m.gpu, work: m.work, level: m.level });
    console.log(line(rows[rows.length - 1]));
  }
  // (Under 58 a second it's missing frames; past that, the GPU's cost says what's heaviest.)
  rows.sort((a, b) => Math.min(a.fps, 58) - Math.min(b.fps, 58) || b.gpu - a.gpu);
  console.log("\nSlowest:");
  for (const r of rows.slice(0, 25)) console.log(line(r));
  const median = [...rows].sort((a, b) => a.fps - b.fps)[Math.floor(rows.length / 2)]?.fps ?? 0;
  console.log(`Median ${median.toFixed(0)} fps over ${rows.length} looks`);
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
}
if (problems.length) console.log(`Problems in the page:\n${problems.map((p) => `  ${p}`).join("\n")}`);
console.log(`Wrote ${out}`);
await browser.close();
process.exit();
