/**
 * The photo suite's bench (docs/photo/foundations-prototype.md, "Performance targets"): starts its own server and
 * Vite (ports 5340/5341, a throwaway data dir), makes photo projects of the fixtures (`scripts/photo-fixtures.ts`),
 * and runs the suite's scenarios in the real workspace (`src/suites/photo/bench.ts`): cold opens, pan and zoom,
 * adjustment drags and their refinement, a radius-1000 glow and a flare's handle drag, export, device loss, a
 * tight budget. In headless Chrome and in an
 * Electron hidden window. Prints a summary and writes everything as JSON.
 *
 *   pnpm tsx scripts/photo-bench.ts [--runner chrome|electron] [--quick] [--out file.json]
 *   pnpm tsx scripts/photo-bench.ts --lab [--tiles 256,512] [--quick]
 *
 * `--lab` runs F0's lab instead (`photo-lab.html`, `src/suites/photo/lab/`): the renderer's parts the suite doesn't
 * use yet (strokes, the blur's seams, P3, f16 rounding, 16-bit precision), at both tile sizes. `--quick` skips the
 * 100 MP image (and the lab's 48 MP export). `--shots dir` saves screenshots of the lab's canvas instead.
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

/** A step of the suite's `runPlan` (src/suites/photo/bench.ts `BenchStep`). */
type SuiteStep = { open: string } | { run: "reopen" | "panZoom" | "adjustExposure" | "adjustCurves" | "exportPng" | "deviceLoss" | "budgetWalk" | "paintMask" | "glow" | "flare"; label?: string; budgetMB?: number };

/** What the app puts on `window` in development (src/suites/photo/live.ts). */
type SuiteWindow = { photoBench?: { load(): Promise<{ runPlan(steps: SuiteStep[]): Promise<unknown> }> } };

const WEB_PORT = "5340";
const SERVER_PORT = "5341";
const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURES = path.join(ROOT, "data", "photo-fixtures");
const VIEW = { width: 1920, height: 1080 };
/** The suite's window: its canvas panel is then about 1920 × 1080 device pixels (the bench reports what it got). */
const WINDOW = { width: 2240, height: 1300 };

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const quick = args.includes("--quick");
const lab = args.includes("--lab") || args.includes("--shots");
const runners = (option("--runner") ?? "chrome,electron").split(",");
const tiles = lab ? ((option("--tiles") ?? "256,512").split(",").map(Number) as (256 | 512)[]) : [256 as const];
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
const appUrl = `http://localhost:${WEB_PORT}/`;
const server = `http://127.0.0.1:${SERVER_PORT}`;

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

async function runChrome(steps: PlanStep[] | SuiteStep[]) {
  // The flags server/gl-browser.ts launches the export's Chromium with: Metal WebGPU on a Mac.
  const launchArgs = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])];
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", args: launchArgs });
  } catch {
    browser = await chromium.launch({ args: launchArgs });
  }
  try {
    const page = await browser.newPage({ viewport: lab ? { width: 1600, height: 1000 } : WINDOW });
    page.on("pageerror", (e) => console.error("[page]", e.message));
    if (lab) {
      await page.goto(pageUrl);
      await page.waitForFunction(() => (window as LabWindow).photoLab !== undefined);
      const results = await page.evaluate(async (s) => {
        const lab = (window as LabWindow).photoLab!;
        await lab.ready;
        return lab.bench.runPlan(s);
      }, steps);
      return { browser: browser.version(), results };
    }
    await page.goto(appUrl);
    await page.waitForFunction(() => (window as SuiteWindow).photoBench !== undefined);
    const results = await page.evaluate(async (s) => (await (window as SuiteWindow).photoBench!.load()).runPlan(s), steps as SuiteStep[]);
    return { browser: browser.version(), results };
  } finally {
    await browser.close();
  }
}

async function runElectron(steps: PlanStep[] | SuiteStep[]) {
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(electron, [path.join(ROOT, "scripts", "photo-bench-electron.cjs")], {
      env: {
        ...env,
        PHOTO_BENCH_URL: lab ? pageUrl : appUrl,
        PHOTO_BENCH_PLAN: JSON.stringify(steps),
        ...(lab ? { PHOTO_BENCH_LAB: "1" } : { PHOTO_BENCH_WIDTH: String(WINDOW.width), PHOTO_BENCH_HEIGHT: String(WINDOW.height) }),
      },
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
await waitFor(lab ? pageUrl : appUrl);

if (lab) {
  const names = ["noise-48mp.jpg", "blur-detail.png", "p3-patches.png", "alpha-gradient.png", "ramp-8bit.png", "orientation-6.jpg", "ramp-16bit.png", ...(quick ? [] : ["noise-100mp.jpg"])];
  for (const name of names) {
    const res = await fetch(`${api}/sources?name=${name}`, { method: "POST", body: fs.readFileSync(path.join(FIXTURES, name)) });
    if (!res.ok) throw new Error(`Uploading ${name}: ${res.status} ${await res.text()}`);
  }
}

/** A photo project of a fixture: the image as its canvas, at 100% (as opening a file makes one). */
async function photoProject(name: string): Promise<string> {
  const created = await fetch(`${server}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite: "photo", name }) });
  if (!created.ok) throw new Error(`Creating ${name}: ${created.status} ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  const uploaded = await fetch(`${server}/api/media?projectId=${id}&name=${encodeURIComponent(name)}`, { method: "POST", body: fs.readFileSync(path.join(FIXTURES, name)) });
  if (!uploaded.ok) throw new Error(`Uploading ${name}: ${uploaded.status} ${await uploaded.text()}`);
  const media = (await uploaded.json()) as { id: string; width: number; height: number };
  const doc = {
    version: 5,
    name,
    canvas: { width: media.width, height: media.height, background: null },
    output: { highlights: "film" },
    layers: [{ id: "layer_bench", kind: "image", name, visible: true, opacity: 1, mediaId: media.id, transform: { x: media.width / 2, y: media.height / 2, scaleX: 1, scaleY: 1, rotation: 0 } }],
  };
  const saved = await fetch(`${server}/api/projects/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
  if (!saved.ok) throw new Error(`Saving ${name}: ${saved.status} ${await saved.text()}`);
  return id;
}

/** The suite's plan: each photo opened cold, then the scenarios on the 48 MP one (`src/suites/photo/bench.ts`). */
async function suitePlan(): Promise<SuiteStep[]> {
  const p48 = await photoProject("noise-48mp.jpg");
  const p100 = quick ? null : await photoProject("noise-100mp.jpg");
  return [
    { open: p48 },
    { run: "reopen", label: "reopen 48MP" },
    { run: "panZoom" },
    { run: "adjustExposure" },
    { run: "adjustCurves" },
    { run: "paintMask" },
    { run: "glow" },
    { run: "flare" },
    { run: "exportPng", label: "exportPng 48MP" },
    { run: "deviceLoss" },
    // F0's budgets: the 48 MP image in 256 MB, the 100 MP one in 1 GB (its levels above level 0 alone are ~270 MB).
    { run: "budgetWalk", label: "budgetWalk 48MP @256MB", budgetMB: 256 },
    ...(p100 ? [{ open: p100 } as SuiteStep, { run: "budgetWalk", label: "budgetWalk 100MP @1GB", budgetMB: 1024 } as SuiteStep] : []),
  ];
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
  // The page's own pointer handling: a brush drag (as a person paints), a pan, the wheel.
  await page.getByRole("button", { name: "Fit" }).click();
  await page.getByRole("button", { name: "Brush" }).click();
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.3 + i * 0.02), box.y + box.height * (0.6 - i * 0.01));
  await page.mouse.up();
  await page.getByText("uploaded").first().waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Brush" }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 80, { steps: 10 });
  await page.mouse.up();
  await shot("48mp-painted-by-pointer");
  console.log(await page.locator("ol").first().innerText().then((t) => t.split("\n").slice(0, 8).join(" ")));
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
    const label = lab ? `lab ${runner} ${tile}` : `suite ${runner}`;
    console.log(`\n=== ${label} ===`);
    const started = Date.now();
    // The suite's projects are made afresh for each runner, so its opens are cold on the server too.
    const steps = lab ? plan(tile) : await suitePlan();
    const result = runner === "electron" ? await runElectron(steps) : await runChrome(steps);
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
