/**
 * The photo suite's light, rendered and checked (docs/photo/f4-light.md, "Tools and checks"), as the video editor's
 * effect sheet: starts its own server and Vite (ports 5344/5345, a throwaway data dir), opens a photo in headless
 * Chrome with WebGPU, paints its scenes (a night of lights above white, the sample photo, a cut-out on
 * transparency) and renders each with each filter and generator preset through the app's own renderer. Checks:
 * every pipeline compiles; each effect changes the picture; nothing is NaN; regions far smaller than a glow give the
 * same pixels as one. Writes a contact sheet, with a row comparing the output's `film` strengths (s = ½, 1, 2) and
 * `clip` on the same light, encoded here from the renderer's floats.
 *
 *   pnpm tsx scripts/photo-sheet.ts [glow|flare|film ...] [--out photo-sheet.png]
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp, { type OverlayOptions } from "sharp";
import { linearToSrgb } from "../shared/photo/colour.ts";
import { addFilter, addGeneratorLayer } from "../shared/photo/edits.ts";
import type { View } from "../shared/photo/geometry.ts";
import { filmHighlights } from "../shared/photo/output.ts";
import type { PhotoProject } from "../shared/photo/types.ts";

const WEB_PORT = "5344";
const SERVER_PORT = "5345";
const ROOT = path.resolve(import.meta.dirname, "..");
const SAMPLE = path.join(ROOT, "samples", "photo-1600x1200.jpg");
const CELL = { width: 320, height: 240 };
const LABEL = 22;

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = path.resolve(outIndex >= 0 ? args[outIndex + 1] : "photo-sheet.png");
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
const shows = (tag: string) => wanted.length === 0 || wanted.includes(tag);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-sheet-"));
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: dataDir, EDITOR_SERVER_PORT: SERVER_PORT, EDITOR_WEB_PORT: WEB_PORT };
delete env.ELECTRON_RUN_AS_NODE;
const children: ChildProcess[] = [];
process.on("exit", () => {
  for (const child of children) {
    try {
      process.kill(-child.pid!);
    } catch {
      // already gone
    }
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});
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

if (!fs.existsSync(SAMPLE)) {
  console.error(`No ${path.relative(ROOT, SAMPLE)}: run pnpm samples first.`);
  process.exit(1);
}

children.push(
  spawn("pnpm", ["exec", "tsx", "server/index.ts"], { cwd: ROOT, env, stdio: "ignore", detached: true }),
  spawn("pnpm", ["exec", "vite", "--port", WEB_PORT, "--strictPort"], { cwd: ROOT, env, stdio: "ignore", detached: true }),
);
const server = `http://127.0.0.1:${SERVER_PORT}`;
await waitFor(`${server}/api/health`);
await waitFor(`http://localhost:${WEB_PORT}/`);

const created = (await (await fetch(`${server}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite: "photo", name: "Sheet" }) })).json()) as { id: string };
const media = (await (await fetch(`${server}/api/media?projectId=${created.id}&name=photo.jpg`, { method: "POST", body: fs.readFileSync(SAMPLE) })).json()) as { id: string };

type Bench = {
  sheetSetup(projectId: string, mediaId: string): Promise<PhotoProject>;
  renderDoc(doc: PhotoProject, view: View): Promise<number[]>;
  compileErrors(): Promise<string[]>;
};
type SheetWindow = { photoBench?: { load(): Promise<Bench> } };

const launchArgs = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", ...(process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [])];
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", args: launchArgs });
} catch {
  browser = await chromium.launch({ args: launchArgs });
}
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.error("[page]", e.message));
await page.goto(`http://localhost:${WEB_PORT}/`);
await page.waitForFunction(() => (window as SheetWindow).photoBench !== undefined);
const call = <T>(name: keyof Bench, ...input: unknown[]) =>
  page.evaluate(async ({ name, input }) => ((await (window as SheetWindow).photoBench!.load()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...input), { name, input }) as Promise<T>;

const base = await call<PhotoProject>("sheetSetup", created.id, media.id);
const errors = await call<string[]>("compileErrors");

// --- scenes and effects ---

interface Scene {
  name: string;
  /** Its layer with content, which filters go on. */
  layer: string;
  doc: PhotoProject;
}
const scene = (name: string, layer: string, background: string | null, shown: string[]): Scene => ({
  name,
  layer,
  doc: { ...base, canvas: { ...base.canvas, background }, layers: base.layers.map((l) => ({ ...l, visible: shown.includes(l.id) })) },
});
const SCENES = [scene("night", "lights", "#05070c", ["lights"]), scene("photo", "photo", "#ffffff", ["photo"]), scene("cut-out", "object", null, ["object"])];

interface Effect {
  name: string;
  tag: string;
  apply: (doc: PhotoProject, layer: string) => PhotoProject;
}
const glow = (name: string, params: Record<string, unknown>): Effect => ({ name, tag: "glow", apply: (doc, layer) => addFilter(doc, layer, { id: "sheet_glow", type: "glow", params }) });
const flare = (preset: string): Effect => ({ name: `flare ${preset}`, tag: "flare", apply: (doc) => addGeneratorLayer(doc, { id: "sheet_flare", type: "lens-flare", preset, params: { source: [260, 190] } }) });
const EFFECTS: Effect[] = ([
  { name: "as it is", tag: "base", apply: (doc: PhotoProject) => doc },
  glow("glow r30", { radius: 30, threshold: 60 }),
  glow("glow r120", { radius: 120, threshold: 60 }),
  glow("glow tinted", { radius: 80, threshold: 50, intensity: 0.5, tint: "#ff6a3d", tintAmount: 70 }),
  flare("classic"),
  flare("anamorphic"),
  flare("subtle"),
] as Effect[]).filter((e) => e.tag === "base" || shows(e.tag));

const view: View = { zoom: CELL.width / base.canvas.width, x: 0, y: 0, ...CELL };

/** Premultiplied linear floats as 8-bit RGBA: unpremultiplied, highlights by `s` (or clipped), over the checkerboard. */
function encode(data: number[], width: number, height: number, s: number | "clip"): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = Math.min(1, Math.max(0, data[i + 3]));
      const grey = ((x >> 3) + (y >> 3)) & 1 ? 0.48 : 0.8;
      let rgb: [number, number, number] = [data[i] + grey * (1 - a), data[i + 1] + grey * (1 - a), data[i + 2] + grey * (1 - a)];
      if (s !== "clip") rgb = filmHighlights(...rgb, s);
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(linearToSrgb(Math.min(1, Math.max(0, rgb[c]))) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

const failures: string[] = errors.map((e) => `compile: ${e}`);
const rows: { label: string; cells: { label: string; data: number[] ; s: number | "clip" }[] }[] = [];
for (const sc of SCENES) {
  const cells = [];
  let plain: number[] | null = null;
  for (const effect of EFFECTS) {
    const data = await call<number[]>("renderDoc", effect.apply(sc.doc, sc.layer), view);
    if (data.some((v) => !Number.isFinite(v))) failures.push(`${sc.name} / ${effect.name}: NaN or infinity`);
    if (effect.tag === "base") plain = data;
    else if (plain) {
      let changed = 0;
      for (let i = 0; i < data.length; i++) changed = Math.max(changed, Math.abs(data[i] - plain[i]));
      if (changed < 0.01) failures.push(`${sc.name} / ${effect.name}: changes nothing (largest difference ${changed.toExponential(2)})`);
    }
    cells.push({ label: effect.name, data, s: 1 as number | "clip" });
  }
  rows.push({ label: sc.name, cells });
}

// Tiled matches whole: regions far smaller than the glow (as an export's) give the same pixels.
if (shows("glow")) {
  const night = glow("", { radius: 120, threshold: 60 }).apply(SCENES[0].doc, "lights");
  const whole = await call<number[]>("renderDoc", night, { zoom: 1, x: 0, y: 0, width: 800, height: 600 });
  let worst = 0;
  for (let y = 0; y < 600; y += 200) {
    for (let x = 0; x < 800; x += 200) {
      const tile = await call<number[]>("renderDoc", night, { zoom: 1, x, y, width: 200, height: 200 });
      for (let j = 0; j < 200; j++) for (let i = 0; i < 200; i++) for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(tile[(j * 200 + i) * 4 + c] - whole[((y + j) * 800 + x + i) * 4 + c]));
    }
  }
  console.log(`tiled vs whole (glow r120, 200-pixel regions): worst ${worst.toExponential(2)}`);
  if (worst > 1e-5) failures.push(`glow r120: tiled differs from whole by ${worst}`);
}

// The output's highlights: the same light through each film strength, and clipped.
if (shows("film")) {
  const lit = flare("classic").apply(glow("", { radius: 120, threshold: 60 }).apply(SCENES[0].doc, "lights"), "lights");
  const data = await call<number[]>("renderDoc", lit, view);
  rows.push({ label: "highlights", cells: (["clip", 0.5, 1, 2] as const).map((s) => ({ label: s === "clip" ? "clip" : `film s=${s}${s === 1 ? " (default)" : ""}`, data, s })) });
}

// --- the sheet ---

const columns = Math.max(...rows.map((r) => r.cells.length));
const ROW_LABEL = 90;
const width = ROW_LABEL + columns * CELL.width;
const height = rows.length * (CELL.height + LABEL);
const layers: OverlayOptions[] = [];
const text = (x: number, y: number, s: string, w: number, h: number) =>
  Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><text x="${x}" y="${y}" font-family="Helvetica, Arial" font-size="13" fill="#d8dce4">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`);
rows.forEach((row, r) => {
  const top = r * (CELL.height + LABEL);
  layers.push({ input: text(6, LABEL + CELL.height / 2, row.label, ROW_LABEL, CELL.height + LABEL), left: 0, top });
  row.cells.forEach((cell, c) => {
    const left = ROW_LABEL + c * CELL.width;
    layers.push({ input: text(6, 15, cell.label, CELL.width, LABEL), left, top });
    layers.push({ input: encode(cell.data, CELL.width, CELL.height, cell.s), raw: { width: CELL.width, height: CELL.height, channels: 4 }, left, top: top + LABEL });
  });
});
await sharp({ create: { width, height, channels: 4, background: "#1c1f26" } })
  .composite(layers)
  .png()
  .toFile(outFile);
await browser.close();

console.log(`Wrote ${path.relative(process.cwd(), outFile)} (${rows.length} rows)`);
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("Every check passed: the pipelines compile, each effect changes the picture, nothing is NaN, tiles match.");
process.exit(0);
