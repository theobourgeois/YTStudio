/**
 * The photo suite's light, rendered and checked (docs/photo/f4-light.md, "Tools and checks"), as the video editor's
 * effect sheet: starts its own server and Vite (ports 5344/5345, a throwaway data dir), opens a photo in headless
 * Chrome with WebGPU, paints its scenes (a night of lights above white, the sample photo, a cut-out on
 * transparency) and renders each with every look of the catalogue (each filter's and generator's presets: the Filter
 * Gallery's) through the app's own renderer. Checks:
 * every pipeline compiles; each effect changes the picture; nothing is NaN; regions far smaller than a glow give the
 * same pixels as one; every kernel filter's look (`shared/photo/effects/kernel.ts`) is its CPU reference
 * (`shared/photo/reference/filters/`). Writes a contact sheet, with a row comparing the output's `film` strengths
 * (s = ½, 1, 2) and `clip` on the same light, encoded here from the renderer's floats.
 *
 * `--thumbnails` also renders every look on the gallery's sample scene (`photo-filter-scene.ts`) into
 * `public/photo-filters/<type>--<preset>.jpg`: the Filter Gallery's cards. `--port N` runs Vite on N and the server
 * on N + 1 (default 5344), so several can run at once.
 *
 * `camera-raw` renders Camera Raw's looks (docs/photo/camera-raw.md) as a filter and as an adjustment layer: the filter
 * on the GPU is its CPU reference (`shared/photo/reference/camera-raw.ts`), and the adjustment over the photo alone
 * is the filter on it. `hue-saturation` does the same for Hue/Saturation (docs/photo/hue-saturation.md).
 *
 * Filters that read their picture's scene maps (depth, subject: docs/photo/effects/scene-maps.md) get them from the
 * models' stand-ins, unless `--models` says to use the real ones (downloaded first if they aren't here: thumbnails
 * want them). The reference is given the maps the renderer drew with.
 *
 *   pnpm tsx scripts/photo-sheet.ts [glow|flare|film|camera-raw|hue-saturation|<filter type> ...] [--out photo-sheet.png] [--thumbnails] [--models] [--port 5344]
 */
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp, { type OverlayOptions } from "sharp";
import { linearToSrgb } from "../shared/photo/colour.ts";
import { addAdjustmentLayer, addFilter, addGeneratorLayer, setEffectParams } from "../shared/photo/edits.ts";
import { FILTER_ENTRIES, entryParams } from "../shared/photo/effects/catalog.ts";
import { effectDefinition, isKernelFilter, validateParams } from "../shared/photo/effects/index.ts";
import { applyKernel } from "../shared/photo/reference/kernel.ts";
import { KERNEL_REFERENCES } from "../shared/photo/reference/filters/index.ts";
import { sceneSvg } from "./photo-filter-scene.ts";
import type { View } from "../shared/photo/geometry.ts";
import { filmHighlights } from "../shared/photo/output.ts";
import type { PhotoProject } from "../shared/photo/types.ts";
import type { SceneMaps } from "../shared/photo/scene.ts";

/** Scene maps as the bench hands them over (plain arrays). */
type SheetMaps = Omit<SceneMaps, "depth" | "subject"> & { depth: number[] | null; subject: number[] | null };

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const port = Number(option("--port") ?? 5344);
const WEB_PORT = String(port);
const SERVER_PORT = String(port + 1);
const ROOT = path.resolve(import.meta.dirname, "..");
const SAMPLE = path.join(ROOT, "samples", "photo-1600x1200.jpg");
const THUMBNAILS = path.join(ROOT, "public", "photo-filters");
const CELL = { width: 320, height: 240 };
const LABEL = 22;

const outFile = path.resolve(option("--out") ?? "photo-sheet.png");
const thumbnails = args.includes("--thumbnails");
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--port");
const shows = (tag: string) => wanted.length === 0 || wanted.includes(tag);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-sheet-"));
const realModels = args.includes("--models");
const env: NodeJS.ProcessEnv = { ...process.env, EDITOR_DATA_DIR: dataDir, EDITOR_SERVER_PORT: SERVER_PORT, EDITOR_WEB_PORT: WEB_PORT, EDITOR_NO_HMR: "1", ...(realModels ? {} : { EDITOR_SUBJECT_MODEL: "stand-in", EDITOR_DEPTH_MODEL: "stand-in" }) };
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
if (realModels) {
  for (const model of ["subject", "depth"]) {
    await fetch(`${server}/api/photo/models/${model}/setup`, { method: "POST" });
    for (;;) {
      const status = (await (await fetch(`${server}/api/photo/models/${model}`)).json()) as { status: string; progress: number | null; error: string | null };
      if (status.status === "ready") break;
      if (status.status !== "downloading") throw new Error(`The ${model} model isn't here: ${status.error ?? status.status}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const created = (await (await fetch(`${server}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite: "photo", name: "Sheet" }) })).json()) as { id: string };
const media = (await (await fetch(`${server}/api/media?projectId=${created.id}&name=photo.jpg`, { method: "POST", body: fs.readFileSync(SAMPLE) })).json()) as { id: string };
// The gallery's scene too, before the photo opens (its media are what the renderer knows).
const sceneMedia = thumbnails ? ((await (await fetch(`${server}/api/media?projectId=${created.id}&name=scene.png`, { method: "POST", body: await sharp(Buffer.from(sceneSvg())).png().toBuffer() })).json()) as { id: string }) : null;

type Bench = {
  sheetSetup(projectId: string, mediaId: string): Promise<PhotoProject>;
  showDoc(doc: PhotoProject): Promise<void>;
  renderDoc(doc: PhotoProject, view: View): Promise<number[]>;
  compileErrors(): Promise<string[]>;
  cameraRawAnalysis(doc: PhotoProject, layerId: string, filterId: string | null): Promise<{ grid: number[]; colour: number[] } | null>;
  sceneMaps(doc: PhotoProject, layerId: string, filterId: string): Promise<SheetMaps | null>;
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
/** A glow with these parameters, and a flare of a preset (the tiled check's and the highlights row's light). */
const glow = (name: string, params: Record<string, unknown>): Effect => ({ name, tag: "glow", apply: (doc, layer) => addFilter(doc, layer, { id: "sheet_glow", type: "glow", params }) });
const flare = (preset: string): Effect => ({ name: `flare ${preset}`, tag: "flare", apply: (doc) => addGeneratorLayer(doc, { id: "sheet_flare", type: "lens-flare", preset, params: { source: [260, 190] } }) });
/** A tag for the command line: a definition's type, the flare's "flare". */
const tagOf = (type: string) => (type === "lens-flare" ? "flare" : type);
// Every look of the catalogue, as the Filter Gallery applies it (a generator's source where the scenes' lights are).
const EFFECTS: Effect[] = ([
  { name: "as it is", tag: "base", apply: (doc: PhotoProject) => doc },
  ...FILTER_ENTRIES.map((e): Effect => ({
    name: `${e.def.label.toLowerCase()} ${e.preset.label.toLowerCase()}`,
    tag: tagOf(e.def.type),
    apply: (doc, layer) =>
      e.def.kind === "filter"
        ? addFilter(doc, layer, { id: "sheet_filter", type: e.def.type, params: entryParams(e, doc.canvas) })
        : addGeneratorLayer(doc, { id: "sheet_generator", type: e.def.type, params: { ...entryParams(e, doc.canvas), source: [260, 190] } }),
  })),
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

// Kernel filters: each look on the GPU is its CPU reference, on the photo and on the cut-out's soft edges. The
// reference reads the content (the scene without the filter) over the region grown by the filter's reach.
// Every kernel filter's looks, and Apply To (a look on the subject alone, another on the background alone).
const applied = (key: string, applyTo: string) => {
  const e = FILTER_ENTRIES.find((f) => f.key === key)!;
  return { ...e, key: `${e.key} (${applyTo} only)`, preset: { ...e.preset, params: (c: { width: number; height: number }) => ({ ...e.preset.params(c), applyTo }) } };
};
const kernelLooks = [
  ...FILTER_ENTRIES.filter((e) => isKernelFilter(e.def.type) && shows(tagOf(e.def.type))),
  ...(shows("apply-to") ? [applied("posterize/screenprint", "subject"), applied("wind/blast", "background")] : []),
];
for (const e of kernelLooks) {
  const reference = KERNEL_REFERENCES[e.def.type];
  if (!reference) {
    failures.push(`${e.key}: no CPU reference`);
    continue;
  }
  for (const [sc, x0, y0] of [[SCENES[1], 230, 170], [SCENES[2], 300, 230]] as const) {
    const params = entryParams(e, sc.doc.canvas);
    // Its settings as the filter holds them (the preset's, its defaults for the rest).
    const full = validateParams(e.def, params).params;
    const R = Math.ceil(e.def.reach(full)) + 2;
    const W = 128;
    const H = 96;
    const plain = await call<number[]>("renderDoc", { ...sc.doc, canvas: { ...sc.doc.canvas, background: null } }, { zoom: 1, x: x0 - R, y: y0 - R, width: W + 2 * R, height: H + 2 * R });
    const doc = addFilter({ ...sc.doc, canvas: { ...sc.doc.canvas, background: null } }, sc.layer, { id: "sheet_kernel", type: e.def.type, params });
    const filtered = await call<number[]>("renderDoc", doc, { zoom: 1, x: x0, y: y0, width: W, height: H });
    // The scene maps it drew with, for one that reads them.
    let maps: SceneMaps | null = null;
    if (e.def.scene?.(full)) {
      const m = await call<SheetMaps | null>("sceneMaps", doc, sc.layer, "sheet_kernel");
      if (!m) {
        failures.push(`${e.key} on ${sc.name}: its scene maps weren't made`);
        continue;
      }
      maps = { ...m, depth: m.depth && Float32Array.from(m.depth), subject: m.subject && Float32Array.from(m.subject) };
    }
    const expected = applyKernel(reference, { width: W + 2 * R, height: H + 2 * R, data: Float64Array.from(plain) }, full, sc.doc.canvas, { x: x0 - R, y: y0 - R }, maps);
    const diffs: number[] = [];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++)
        for (let c = 0; c < 4; c++) diffs.push(Math.abs(filtered[(j * W + i) * 4 + c] - expected.data[((j + R) * (W + 2 * R) + i + R) * 4 + c]));
    diffs.sort((a, b) => a - b);
    const p99 = diffs[Math.floor(diffs.length * 0.99)];
    const over = diffs.filter((d) => d > 0.02).length / diffs.length;
    const line = `${e.key} on ${sc.name}: p99 ${p99.toExponential(2)}, ${(over * 100).toFixed(2)}% over 0.02, worst ${diffs[diffs.length - 1].toExponential(2)}`;
    console.log(line);
    if (p99 > 5e-3 || over > 0.01) failures.push(`GPU ≠ reference: ${line}`);
  }
}

// Camera Raw: a few looks as a filter on the photo, then as an adjustment layer over it.
if (shows("camera-raw")) {
  const def = effectDefinition("camera-raw")!;
  const LOOKS: [string, Record<string, unknown>][] = [
    ["light", { exposure: 0.7, contrast: 40, whites: 30, blacks: -35 }],
    ["warm faded", { temperature: 35, tint: 10, vibrance: 40, saturation: -20, curveShadows: 40, curveHighlights: -30 }],
    ["cool b&w", { temperature: -40, treatment: "bw", contrast: 60 }],
    ["curves", { pointCurve: { rgb: [[0, 30], [70, 60], [190, 205], [255, 240]], red: [[0, 0], [128, 150], [255, 255]], green: [[0, 0], [255, 255]], blue: [[0, 20], [255, 235]] } }],
    ["vignette grain", { vignette: -60, vignetteFeather: 70, grain: 60, grainRoughness: 80 }],
    ["darken", { exposure: -1.5, saturation: 60, vignette: 40, vignetteStyle: "color" }],
    // CR2: the local sliders, read from the analysis.
    ["recover", { highlights: -100, shadows: 100, contrast: 30 }],
    ["clarity", { clarity: 100, texture: 60 }],
    ["soften", { clarity: -100, texture: -100 }],
    ["dehaze", { dehaze: 80, highlights: -40 }],
    ["haze", { dehaze: -70, shadows: -50 }],
    // CR3: the Color Mixer, Color Grading and Glow.
    ["mixer", { hueRed: 40, saturationOrange: 60, luminanceBlue: -60, hueGreen: -50, saturationAqua: -80, luminanceYellow: 40 }],
    ["grading", { shadowsHue: 210, shadowsSaturation: 50, highlightsHue: 40, highlightsSaturation: 45, midtonesLuminance: -20, gradingBalance: 30 }],
    ["grade global", { globalHue: 300, globalSaturation: 40, globalLuminance: 25, gradingBlending: 100 }],
    ["bloom", { glow: 80, glowRange: 70, glowWarmth: 40 }],
    ["halation", { glow: 100, glowStyle: "halation", glowSpread: 70 }],
    ["diffusion", { glow: 100, glowStyle: "diffusion", glowWarmth: -50 }],
  ];
  const sc = SCENES[1];
  const cells = [];
  const doc = { ...sc.doc, canvas: { ...sc.doc.canvas, background: null } };
  for (const [name, raw] of LOOKS) {
    const params = validateParams(def, raw).params;
    const filtered = addFilter(doc, sc.layer, { id: "sheet_cr", type: "camera-raw", params });
    cells.push({ label: `camera raw ${name}`, data: await call<number[]>("renderDoc", filtered, view), s: 1 as number | "clip" });
    // The filter on the GPU is its reference.
    const [x0, y0, W, H] = [180, 140, 160, 120];
    const plain = await call<number[]>("renderDoc", doc, { zoom: 1, x: x0, y: y0, width: W, height: H });
    const gpu = await call<number[]>("renderDoc", filtered, { zoom: 1, x: x0, y: y0, width: W, height: H });
    // The analysis the GPU drew with (the local sliders read it), handed to the reference as the plan hands it.
    const analysis = await call<{ grid: number[]; colour: number[] } | null>("cameraRawAnalysis", filtered, sc.layer, "sheet_cr");
    const withAnalysis = analysis ? { ...params, __analysis: { ...analysis, grid: Float32Array.from(analysis.grid), colour: Float32Array.from(analysis.colour) } as never } : params;
    const expected = applyKernel(KERNEL_REFERENCES["camera-raw"], { width: W, height: H, data: Float64Array.from(plain) }, withAnalysis, doc.canvas, { x: x0, y: y0 });
    const diffs = gpu.map((v, i) => Math.abs(v - expected.data[i])).sort((a, b) => a - b);
    const p99 = diffs[Math.floor(diffs.length * 0.99)];
    const line = `camera-raw ${name} (filter): p99 ${p99.toExponential(2)}, worst ${diffs[diffs.length - 1].toExponential(2)}`;
    console.log(line);
    if (p99 > 5e-3) failures.push(`GPU ≠ reference: ${line}`);
    // The adjustment layer over the photo alone draws what the filter on it does.
    const adjusted = setEffectParams(addAdjustmentLayer(doc, { id: "sheet_cr_layer", type: "camera-raw" }, null), "sheet_cr_layer", params);
    const adj = await call<number[]>("renderDoc", adjusted, { zoom: 1, x: x0, y: y0, width: W, height: H });
    const worst = adj.reduce((w, v, i) => Math.max(w, Math.abs(v - gpu[i])), 0);
    console.log(`camera-raw ${name} (adjustment vs filter): worst ${worst.toExponential(2)}`);
    if (worst > 2e-2) failures.push(`camera-raw ${name}: the adjustment layer differs from the filter by ${worst}`);
  }
  rows.push({ label: "camera raw", cells });
}

// Hue/Saturation: a few settings as a filter on the photo (the GPU is its CPU reference), then as an adjustment layer
// over it (the same pixels).
if (shows("hue-saturation")) {
  const def = effectDefinition("hue-saturation")!;
  const LOOKS: [string, Record<string, unknown>][] = [
    ["hue", { hue: 120 }],
    ["saturate", { saturation: 60, lightness: -10 }],
    ["desaturate", { saturation: -80, lightness: 20 }],
    ["ranges", { redsHue: 40, yellowsSaturation: 70, greensHue: -60, cyansLightness: 50, bluesSaturation: -100, magentasHue: 90 }],
    ["master and range", { hue: -30, saturation: 30, bluesHue: 60, bluesLightness: -40 }],
    ["sepia", { colorize: true, colorizeHue: 35, colorizeSaturation: 25 }],
    ["cyanotype", { colorize: true, colorizeHue: 205, colorizeSaturation: 60, lightness: -20 }],
  ];
  const cells = [];
  for (const [sc, x0, y0] of [[SCENES[1], 180, 140], [SCENES[2], 300, 230], [SCENES[0], 250, 430]] as const) {
    const doc = { ...sc.doc, canvas: { ...sc.doc.canvas, background: null } };
    const [W, H] = [160, 120];
    const plain = await call<number[]>("renderDoc", doc, { zoom: 1, x: x0, y: y0, width: W, height: H });
    for (const [name, raw] of LOOKS) {
      const params = validateParams(def, raw).params;
      const filtered = addFilter(doc, sc.layer, { id: "sheet_hs", type: "hue-saturation", params });
      if (sc === SCENES[1]) cells.push({ label: `hue/sat ${name}`, data: await call<number[]>("renderDoc", filtered, view), s: 1 as number | "clip" });
      const gpu = await call<number[]>("renderDoc", filtered, { zoom: 1, x: x0, y: y0, width: W, height: H });
      const expected = applyKernel(KERNEL_REFERENCES["hue-saturation"], { width: W, height: H, data: Float64Array.from(plain) }, params, doc.canvas, { x: x0, y: y0 });
      const diffs = gpu.map((v, i) => Math.abs(v - expected.data[i])).sort((a, b) => a - b);
      const p99 = diffs[Math.floor(diffs.length * 0.99)];
      const line = `hue-saturation ${name} on ${sc.name} (filter): p99 ${p99.toExponential(2)}, worst ${diffs[diffs.length - 1].toExponential(2)}`;
      console.log(line);
      if (p99 > 1e-3 || diffs[diffs.length - 1] > 2e-2) failures.push(`GPU ≠ reference: ${line}`);
      if (gpu.some((v) => !Number.isFinite(v))) failures.push(`hue-saturation ${name} on ${sc.name}: not a number`);
      if (sc === SCENES[1] && plain.reduce((w, v, i) => Math.max(w, Math.abs(v - gpu[i])), 0) < 1e-3) failures.push(`hue-saturation ${name}: changes nothing`);
      // The adjustment layer over the layer alone draws what the filter on it does.
      const adjusted = setEffectParams(addAdjustmentLayer(doc, { id: "sheet_hs_layer", type: "hue-saturation" }, null), "sheet_hs_layer", params);
      const adj = await call<number[]>("renderDoc", adjusted, { zoom: 1, x: x0, y: y0, width: W, height: H });
      const worst = adj.reduce((w, v, i) => Math.max(w, Math.abs(v - gpu[i])), 0);
      console.log(`hue-saturation ${name} on ${sc.name} (adjustment vs filter): worst ${worst.toExponential(2)}`);
      if (worst > 2e-2) failures.push(`hue-saturation ${name} on ${sc.name}: the adjustment layer differs from the filter by ${worst}`);
    }
  }
  rows.push({ label: "hue/saturation", cells });
}

// The Filter Gallery's cards: every look on the sample scene.
if (sceneMedia) {
  const doc: PhotoProject = {
    ...base,
    canvas: { width: 800, height: 600, background: "#000000" },
    layers: [{ id: "scene", kind: "image", name: "scene", visible: true, opacity: 1, mediaId: sceneMedia.id, transform: { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } }],
  };
  // Shown, so its image loads.
  await call("showDoc", doc);
  fs.mkdirSync(THUMBNAILS, { recursive: true });
  const cardView: View = { zoom: CELL.width / 800, x: 0, y: 0, ...CELL };
  for (const e of FILTER_ENTRIES.filter((e) => shows(tagOf(e.def.type)))) {
    const params = entryParams(e, doc.canvas);
    const shown =
      e.def.kind === "filter"
        ? addFilter(doc, "scene", { id: "card_filter", type: e.def.type, params })
        : addGeneratorLayer(doc, { id: "card_generator", type: e.def.type, params: { ...params, source: [300, 290] } });
    const data = await call<number[]>("renderDoc", shown, cardView);
    const raw = encode(data, CELL.width, CELL.height, 1);
    await sharp(raw, { raw: { width: CELL.width, height: CELL.height, channels: 4 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(THUMBNAILS, `${e.key.replace("/", "--")}.jpg`));
  }
  console.log(`Wrote the gallery's cards into ${path.relative(ROOT, THUMBNAILS)}/`);
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
