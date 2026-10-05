/**
 * The photo suite's F0 bench (docs/photo/foundations-prototype.md, "F0"): starts its own server and Vite (ports
 * 5340/5341, a throwaway data dir), uploads the fixtures (`scripts/photo-fixtures.ts`), and runs the lab's
 * scenarios in headless Chrome and in an Electron hidden window, at 256- and 512-pixel tiles. Each runner starts
 * with the server's decode cache empty, so opens are cold. Prints a summary and writes everything as JSON.
 *
 *   pnpm tsx scripts/photo-bench.ts [--runner chrome|electron] [--tiles 256,512] [--quick] [--out file.json]
 *
 * `--quick` skips the 100 MP image and the 48 MP export. `--shots dir` instead saves screenshots of the canvas
 * (fit, 100% with a stroke, the P3 photo, a pan mid-load) for looking at.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

/** A step of the lab's `runPlan` (src/suites/photo/lab/bench.ts `PlanStep`). */
type PlanStep =
  | { start: { tile: 256 | 512; budgetMB: number; width: number; height: number } }
  | { open: string }
  | { run: string; label?: string };

/** What the lab page puts on `window` (src/suites/photo/lab/lab.tsx). */
type LabWindow = { photoLab?: { ready: Promise<void>; bench: { runPlan(steps: PlanStep[]): Promise<unknown> } } };

const WEB_PORT = "5340";
const SERVER_PORT = "5341";
const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "data", "photo-fixtures");
const VIEW = { width: 1920, height: 1080 };

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const quick = args.includes("--quick");
const runners = (option("--runner") ?? "chrome,electron").split(",");
const tiles = (option("--tiles") ?? "256,512").split(",").map(Number) as (256 | 512)[];
const outFile = option("--out") ?? path.join(ROOT, "data", "photo-bench", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-bench-"));
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: dataDir, EDITOR_SERVER_PORT: SERVER_PORT, EDITOR_WEB_PORT: WEB_PORT };
delete env.ELECTRON_RUN_AS_NODE;
const children: ChildProcess[] = [];
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

const api = `http://127.0.0.1:${SERVER_PORT}/api/photo/lab`;
const pageUrl = `http://localhost:${WEB_PORT}/photo-lab.html`;

function plan(tile: 256 | 512): PlanStep[] {
  const start = (budgetMB: number): PlanStep => ({ start: { tile, budgetMB, ...VIEW } });
  return [
    start(2048),
    { run: "compileCheck" },
    { open: "noise-48mp.jpg" },
    { run: "panZoom" },
    { run: "stroke" },
    { run: "deviceLoss" },
    ...(quick ? [] : [{ run: "roundTrip", label: "roundTrip 48MP" } as PlanStep]),
    { open: "blur-detail.png" },
    { run: "blur" },
    { open: "p3-patches.png" },
    { run: "p3" },
    { open: "alpha-gradient.png" },
    { run: "roundTrip", label: "roundTrip alpha" },
    { open: "ramp-8bit.png" },
    { run: "rounding" },
    { run: "roundTrip", label: "roundTrip ramp" },
    { open: "orientation-6.jpg" },
    { run: "roundTrip", label: "roundTrip orientation" },
    { open: "ramp-16bit.png" },
    { run: "precision16" },
    start(256),
    { open: "noise-48mp.jpg" },
    { run: "budgetWalk", label: "budgetWalk 48MP @256MB" },
    ...(quick ? [] : [start(1024), { open: "noise-100mp.jpg" } as PlanStep, { run: "budgetWalk", label: "budgetWalk 100MP @1GB" } as PlanStep]),
  ];
}

async function runChrome(steps: PlanStep[]) {
  // The flags server/gl-browser.ts launches the export's Chromium with: Metal WebGPU on a Mac.
  const launchArgs = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])];
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", args: launchArgs });
  } catch {
    browser = await chromium.launch({ args: launchArgs });
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("pageerror", (e) => console.error("[page]", e.message));
    await page.goto(pageUrl);
    await page.waitForFunction(() => (window as LabWindow).photoLab !== undefined);
    const results = await page.evaluate(async (s) => {
      const lab = (window as LabWindow).photoLab!;
      await lab.ready;
      return lab.bench.runPlan(s);
    }, steps);
    return { browser: browser.version(), results };
  } finally {
    await browser.close();
  }
}

async function runElectron(steps: PlanStep[]) {
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(electron, [path.join(ROOT, "scripts", "photo-bench-electron.cjs")], {
      env: { ...env, PHOTO_BENCH_URL: pageUrl, PHOTO_BENCH_PLAN: JSON.stringify(steps) },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", () => {
      const line = out.split("\n").find((l) => l.startsWith("PHOTO_BENCH_RESULT "));
      if (!line) return reject(new Error(`Electron printed no result:\n${out.slice(-2000)}`));
      resolve(JSON.parse(line.slice("PHOTO_BENCH_RESULT ".length)));
    });
  });
}

// --- run ---

if (!fs.existsSync(path.join(FIXTURES, "manifest.json")) || (!quick && !fs.existsSync(path.join(FIXTURES, "noise-100mp.jpg")))) {
  console.log("Making the fixtures…");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", "scripts/photo-fixtures.ts", ...(quick ? ["--skip-large"] : [])], { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("photo-fixtures failed"))));
  });
}

children.push(
  spawn("pnpm", ["exec", "tsx", "server/index.ts"], { cwd: ROOT, env, stdio: "ignore", detached: true }),
  spawn("pnpm", ["exec", "vite", "--port", WEB_PORT, "--strictPort"], { cwd: ROOT, env, stdio: "ignore", detached: true }),
);
await waitFor(`${api}/helper`);
await waitFor(pageUrl);

const names = ["noise-48mp.jpg", "blur-detail.png", "p3-patches.png", "alpha-gradient.png", "ramp-8bit.png", "orientation-6.jpg", "ramp-16bit.png", ...(quick ? [] : ["noise-100mp.jpg"])];
for (const name of names) {
  const res = await fetch(`${api}/sources?name=${name}`, { method: "POST", body: fs.readFileSync(path.join(FIXTURES, name)) });
  if (!res.ok) throw new Error(`Uploading ${name}: ${res.status} ${await res.text()}`);
}

const shotsDir = option("--shots");
if (shotsDir) {
  await takeShots(path.resolve(shotsDir));
  process.exit(0);
}

/** Screenshots of the lab's canvas in a few states (headless Chrome, 256-pixel tiles). */
async function takeShots(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const upload = await fetch(`${api}/sources?name=photo-like-p3.jpg`, { method: "POST", body: fs.readFileSync(path.join(FIXTURES, "photo-like-p3.jpg")) });
  if (!upload.ok) throw new Error(await upload.text());
  const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(pageUrl);
  await page.waitForFunction(() => (window as LabWindow).photoLab !== undefined);
  const step = (steps: PlanStep[]) => page.evaluate(async (s) => (window as LabWindow).photoLab!.bench.runPlan(s), steps);
  const shot = async (name: string) => {
    await page.waitForTimeout(300);
    await page.locator("canvas").screenshot({ path: path.join(dir, `${name}.png`) });
    console.log("  ", path.join(dir, `${name}.png`));
  };
  const view = { width: 960, height: 760 };
  console.log(JSON.stringify(await step([{ start: { tile: 256, budgetMB: 2048, ...view } }, { open: "noise-48mp.jpg" }])));
  await shot("48mp-fit");
  console.log(JSON.stringify(await step([{ run: "stroke" }])));
  await page.evaluate(() => {
    const s = (window as unknown as { photoLab: { session(): { view: { zoom: number; x: number; y: number }; layout: { width: number; height: number }; requestDraw(q: string): void } } }).photoLab.session();
    s.view = { ...s.view, zoom: 0.5, x: s.layout.width * 0.2 - 200, y: s.layout.height * 0.25 - 150 };
    s.requestDraw("final");
  });
  await shot("48mp-stroke-50pct");
  console.log(JSON.stringify(await step([{ open: "photo-like-p3.jpg" }])));
  await shot("p3-photo-fit");
  console.log(JSON.stringify(await step([{ open: "alpha-gradient.png" }])));
  await shot("alpha-fit");
  console.log(JSON.stringify(await step([{ open: "orientation-6.jpg" }])));
  await shot("orientation-fit");
  await browser.close();
}

const report: Record<string, unknown> = { date: new Date().toISOString(), machine: `${os.cpus()[0].model}, ${Math.round(os.totalmem() / 1024 ** 3)} GB, ${os.platform()} ${os.release()}`, view: VIEW, runs: {} };
for (const runner of runners) {
  for (const tile of tiles) {
    await fetch(`${api}/cache`, { method: "DELETE" });
    const label = `${runner} ${tile}`;
    console.log(`\n=== ${label} ===`);
    const started = Date.now();
    const result = runner === "electron" ? await runElectron(plan(tile)) : await runChrome(plan(tile));
    (report.runs as Record<string, unknown>)[label] = result;
    const r = result as { results?: { step: string; ms: number; result?: unknown; error?: string }[]; error?: string };
    if (r.error) console.log("  FAILED:", r.error);
    for (const step of r.results ?? []) {
      console.log(`  ${step.step.padEnd(28)} ${String(step.ms).padStart(9)} ms  ${step.error ? `ERROR ${step.error.split("\n")[0]}` : JSON.stringify(step.result)}`);
    }
    console.log(`  (${Math.round((Date.now() - started) / 1000)} s)`);
  }
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\nWrote ${path.relative(ROOT, outFile)}`);
process.exit(0);
