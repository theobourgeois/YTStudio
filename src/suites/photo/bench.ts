/**
 * The photo suite's measured scenarios (docs/photo/foundations-prototype.md, "Performance targets"), run in the
 * real workspace on real projects: `scripts/photo-bench.ts` opens the app and drives them through
 * `window.photoBench` (development only, installed by `live.ts`). Each returns plain JSON.
 */
import { addAdjustmentLayer, addFilter, addGeneratorLayer, setEffectParams, setFilter, setHandle, setMask } from "@shared/photo/edits";
import { type View, fitView, zoomAbout } from "@shared/photo/geometry";
import { identityCurveSet } from "@shared/photo/effects/params";
import { useProjects } from "@/stores/projects";
import { canvasDriver } from "./canvas/canvas-panel";
import { liveRenderer } from "./live";
import { usePhotoPreferences } from "./preferences";
import type { Presented } from "./render/renderer";
import { commitSurface } from "./paint-target";
import type { PhotoProject } from "@shared/photo/types";
import { Compositor } from "./render/compositor";
import { currentDoc, photoGesture, usePhoto } from "./store";
import { usePhotoUi } from "./ui";

export interface Percentiles {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { count: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1) ?? 0) };
}

const round = (n: number) => Math.round(n * 100) / 100;
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(get: () => T | null | undefined | false, timeoutMs = 60_000): Promise<T> {
  const started = performance.now();
  for (;;) {
    const value = get();
    if (value) return value;
    if (performance.now() - started > timeoutMs) throw new Error("Timed out");
    await sleep(5);
  }
}

const renderer = async () => {
  const pending = liveRenderer();
  if (!pending) throw new Error("No photo is open.");
  return pending;
};

const driver = () => {
  const d = canvasDriver();
  if (!d) throw new Error("The canvas isn't shown.");
  return d;
};

/**
 * Opens a project in the workspace, cold (its own fresh renderer and device), and times it from the open: the
 * first frame with the image's pixels on the GPU (its preview, then tiles), and the first final frame once every
 * tile is in.
 */
export async function open(projectId: string) {
  const started = performance.now();
  await useProjects.getState().open(projectId);
  const r = await until(() => usePhoto.getState().projectId === projectId && usePhoto.getState().history && liveRenderer());
  const coarse = await until(() => r.presented.find((f) => f.at >= started && f.drawn), 60_000);
  await until(() => r.loadedAt !== null && r.loadedAt >= started);
  const settled = await until(() => r.presented.find((f) => f.at >= r.loadedAt! && f.quality === "final"), 60_000);
  const view = usePhotoUi.getState().view!;
  const doc = usePhoto.getState().history!.doc.doc;
  return {
    size: `${doc.canvas.width}×${doc.canvas.height}`,
    view: `${Math.round(view.width)}×${Math.round(view.height)} device px at ${round(view.zoom * 100)}%`,
    coarseMs: round(coarse.at - started),
    loadedMs: round(r.loadedAt! - started),
    settledMs: round(settled.at - started),
    adapter: r.gpu.adapter,
  };
}

/**
 * Opens the photo again with a GPU budget of `mb` (Settings offers 1 to 4 GB; budgets under pressure go lower), for
 * this session only.
 */
export async function setBudget(mb: number) {
  usePhotoPreferences.setState({ budgetMB: mb });
  return reopen();
}

/** Closes the open project and opens it again: a cold open of the same file (a new device; the server's cache warm). */
export async function reopen() {
  const id = usePhoto.getState().projectId;
  if (!id) throw new Error("No photo is open.");
  await useProjects.getState().goHome();
  await sleep(200);
  return open(id);
}

/**
 * Pans and zooms the canvas along a fixed path, one view change per animation frame, timing each frame from
 * submit until the GPU finished it (and on the CPU).
 */
export async function panZoom(steps = 60) {
  const d = driver();
  const ui = usePhotoUi.getState();
  const doc = usePhoto.getState().history!.doc.doc;
  const { width, height } = ui.view!;
  const fit = fitView(doc.canvas, width, height);
  const gpu: Promise<number>[] = [];
  const cpu: number[] = [];
  let view: View = fit;
  const frame = async (next: View) => {
    await nextFrame();
    view = next;
    usePhotoUi.setState({ view });
    const timing = d.draw("interactive");
    if (timing) {
      cpu.push(timing.cpuMs);
      gpu.push(timing.gpuMs);
    }
  };
  const toOne = Math.pow(1 / fit.zoom, 1 / steps);
  for (let i = 0; i < steps; i++) await frame(zoomAbout(view, width / 2, height / 2, toOne));
  for (let i = 0; i < steps; i++) await frame({ ...view, x: view.x + 40, y: view.y + 15 });
  for (let i = 0; i < steps; i++) await frame(zoomAbout(view, width / 2, height / 2, 1 / toOne));
  for (let i = 0; i < steps; i++) await frame({ ...fit, x: fit.x + Math.sin(i / 8) * 200, y: fit.y + Math.cos(i / 8) * 120 });
  const gpuMs = await Promise.all(gpu);
  usePhotoUi.setState({ view: fit });
  const fitFinal = await d.draw("final")!.gpuMs;
  return { view: `${Math.round(width)}×${Math.round(height)}`, frames: gpuMs.length, gpu: percentiles(gpuMs), cpu: percentiles(cpu), finalFitMs: round(fitFinal) };
}

/**
 * An adjustment's slider dragged at fit (one edit per frame, as a drag makes them): each preview frame timed, the
 * screen's counted work, then the time from the last edit to the settled view: final, or refined when the
 * adjustment doesn't commute with reduction. Leaves the adjustment out again (undone).
 */
async function drag(type: "exposure" | "curves", frames = 60) {
  const d = driver();
  const r = await renderer();
  const doc = usePhoto.getState().history!.doc.doc;
  usePhotoUi.getState().setView(fitView(doc.canvas, usePhotoUi.getState().view!.width, usePhotoUi.getState().view!.height));
  const id = `layer_bench_${type}`;
  usePhoto.getState().commit((d) => addAdjustmentLayer(d, { id, type }));
  await nextFrame();
  const before = { ...r.stats };
  const gesture = photoGesture();
  gesture.begin();
  const gpu: Promise<number>[] = [];
  const cpu: number[] = [];
  for (let i = 1; i <= frames; i++) {
    // Out to the strongest setting, where the drag ends (back at the start would be the identity: nothing to refine).
    const t = Math.sin(((i / frames) * Math.PI) / 2);
    gesture.apply((doc) =>
      setEffectParams(
        doc,
        id,
        type === "exposure" ? { exposure: 2 * t } : { curves: { ...identityCurveSet(), rgb: [[0, 0], [64, Math.round(64 - 30 * t)], [192, Math.round(192 + 30 * t)], [255, 255]] } },
      ),
    );
    await nextFrame();
    // The driver draws on this frame; time a frame of the same state ourselves.
    const timing = d.draw("final");
    if (timing) {
      cpu.push(timing.cpuMs);
      gpu.push(timing.gpuMs);
    }
  }
  gesture.end();
  const ended = performance.now();
  const counted = { imageDraws: r.stats.imageDraws - before.imageDraws, adjustmentPasses: r.stats.adjustmentPasses - before.adjustmentPasses, resumed: r.stats.resumed - before.resumed };
  const gpuMs = await Promise.all(gpu);
  const lastDone = performance.now();
  // Settled: an adjustment that commutes is final in its last preview frame (the GPU finishing it); one that doesn't
  // is once its refinement is shown.
  let settledMs: number | null = round(lastDone - ended);
  if (type === "curves") {
    const settled = await until((): Presented | undefined => r.presented.find((f) => f.at >= ended && f.refined), 30_000).catch(() => null);
    settledMs = settled ? round(settled.at - ended) : null;
  }
  const result = { frames: gpuMs.length, gpu: percentiles(gpuMs), cpu: percentiles(cpu), counted, settledMs, refineState: r.refineState, gpuErrors: r.gpu.errors.slice(-3) };
  usePhoto.getState().undo();
  await nextFrame();
  return result;
}

export const adjustExposure = () => drag("exposure");
export const adjustCurves = () => drag("curves");

/** The open photo exported as a PNG at its size (8 bits), with an exposure and curves on it: throughput. */
export async function exportPng() {
  const r = await renderer();
  const { projectId, history } = usePhoto.getState();
  let doc = addAdjustmentLayer(history!.doc.doc, { id: "bench_ex", type: "exposure", params: { exposure: 0.5 } });
  doc = addAdjustmentLayer(doc, { id: "bench_cu", type: "curves", params: { curves: { ...identityCurveSet(), rgb: [[0, 0], [64, 50], [192, 205], [255, 255]] } } });
  const started = performance.now();
  const result = await r.export(projectId!, doc, { name: "bench.png", format: "png" });
  return { ms: round(performance.now() - started), bytes: result.bytes, megapixels: round((doc.canvas.width * doc.canvas.height) / 1e6) };
}

/** Destroys the device and times the return: a new device, the first frame with pixels, every tile back. */
export async function deviceLoss() {
  const r = await renderer();
  const started = performance.now();
  await r.simulateLoss();
  const recovered = performance.now();
  // The first frame drawn on the new device with an image's pixels on it (frames before the loss don't count).
  const back = await until(() => r.presented.find((f) => f.at >= recovered && f.drawn), 30_000);
  await until(() => r.loadedAt !== null && r.loadedAt >= recovered, 30_000);
  return { deviceMs: round(recovered - started), viewMs: round(back.at - started), reloadedMs: round(r.loadedAt! - started), recoveries: r.recoveries, gpuErrors: r.gpu.errors.length };
}

/**
 * With a GPU budget smaller than the image, visits points across it at 100%, waiting for each to settle: level-0
 * tiles are evicted and fetched again. Reopens the photo with that budget first.
 */
export async function budgetWalk(budgetMB = 256, stops = 16) {
  usePhotoPreferences.setState({ budgetMB });
  try {
    await reopen();
    const r = await renderer();
    const doc = usePhoto.getState().history!.doc.doc;
    const { width, height } = usePhotoUi.getState().view!;
    const settle: number[] = [];
    const cols = Math.ceil(Math.sqrt(stops));
    for (let i = 0; i < stops; i++) {
      const cx = ((i % cols) + 0.5) / cols;
      const cy = (Math.floor(i / cols) + 0.5) / Math.ceil(stops / cols);
      const started = performance.now();
      usePhotoUi.getState().setView({ zoom: 1, x: doc.canvas.width * cx - width / 2, y: doc.canvas.height * cy - height / 2, width, height });
      await r.ensureVisible(usePhotoUi.getState().view!);
      await until(() => r.presented.find((f) => f.at >= started && f.quality === "final"), 30_000);
      settle.push(performance.now() - started);
    }
    return { budgetMB, settle: percentiles(settle), gpuErrors: [...r.gpu.errors] };
  } finally {
    usePhotoPreferences.setState({ budgetMB: 2048 });
  }
}

/**
 * F3's painting targets on the open photo, at fit: a mask stroke drawn a segment a frame (each frame timed from the
 * samples given to the GPU finishing the frame that shows them: the first visible dab and every one after), its end
 * committed to history, and undo and redo of it (the command to the GPU finishing the frame that shows it).
 */
export async function paintMask(frames = 90, undos = 10) {
  const d = driver();
  const r = await renderer();
  const doc = currentDoc()!;
  usePhotoUi.getState().setView(fitView(doc.canvas, usePhotoUi.getState().view!.width, usePhotoUi.getState().view!.height));
  const layerId = doc.layers[0].id;
  usePhoto.getState().commit((d) => setMask(d, layerId, null));
  const brush = { radius: Math.max(20, doc.canvas.width / 60), hardness: 0.6, strength: 1, spacing: 0.1 };
  await until(() => r.beginStroke(layerId, "mask", brush, [0, 0, 0, 1], null), 10_000);
  const gpuDone = () => r.device.queue.onSubmittedWorkDone();
  const dab: number[] = [];
  const w = doc.canvas.width;
  const h = doc.canvas.height;
  for (let i = 0; i <= frames; i++) {
    await nextFrame();
    // A wave across the photo, a few samples a frame (as a pointer gives them).
    const at = (k: number) => ({ x: w * (0.1 + (0.8 * k) / frames), y: h * (0.5 + 0.3 * Math.sin((k / frames) * Math.PI * 4)) });
    const started = performance.now();
    r.strokeTo([0.25, 0.5, 0.75, 1].map((f) => at(i - 1 + f)));
    d.draw("final");
    await gpuDone();
    dab.push(performance.now() - started);
  }
  const ending = performance.now();
  const result = await r.endStroke();
  if (!result) throw new Error("The stroke painted nothing.");
  usePhoto.getState().commit(commitSurface(layerId, "mask", result.id));
  const commitMs = performance.now() - ending;
  // Undo and redo: until the screen shows it, drawn and done.
  const shown = async (command: () => void) => {
    await nextFrame();
    await gpuDone();
    const started = performance.now();
    command();
    const revision = r.revision;
    await until(() => r.revision !== revision && r.presented.find((f) => f.at >= started && f.revision === r.revision), 10_000);
    await gpuDone();
    return performance.now() - started;
  };
  const undo: number[] = [];
  const redo: number[] = [];
  for (let i = 0; i < undos; i++) {
    undo.push(await shown(() => usePhoto.getState().undo()));
    redo.push(await shown(() => usePhoto.getState().redo()));
  }
  // F0's measure of a stroke's end: about 20 tiles (a brush of 60 px along 1500 px of the photo).
  await until(() => r.beginStroke(layerId, "mask", { radius: 30, hardness: 0.6, strength: 1, spacing: 0.1 }, [0, 0, 0, 1], null), 10_000);
  r.strokeTo(Array.from({ length: 300 }, (_, k) => ({ x: w * 0.2 + k * 5, y: h * 0.3 + 40 * Math.sin(k / 20) })));
  d.draw("final");
  await gpuDone();
  const small = performance.now();
  const twenty = await r.endStroke();
  if (twenty) usePhoto.getState().commit(commitSurface(layerId, "mask", twenty.id));
  const smallMs = performance.now() - small;
  // Leave the photo as it was (the strokes and the mask undone).
  usePhoto.getState().undo();
  usePhoto.getState().undo();
  usePhoto.getState().undo();
  return {
    dab: percentiles(dab),
    firstDabMs: round(dab[0]),
    long: { tiles: result.tiles, commitMs: round(commitMs), readbackMs: round(result.readbackMs), hashMs: round(result.hashMs) },
    stroke: { tiles: twenty?.tiles ?? 0, commitMs: round(smallMs), readbackMs: round(twenty?.readbackMs ?? 0), hashMs: round(twenty?.hashMs ?? 0) },
    undo: percentiles(undo),
    redo: percentiles(redo),
  };
}

/** Resolves when the GPU has done what's been submitted. */
const gpuIdle = async () => (await renderer()).device.queue.onSubmittedWorkDone();

/**
 * Light's target (foundations-prototype.md: "Glow/flare, large radius: first response ≤ 100 ms; settled ≤ 1 s at
 * fit on 48 MP"): a radius-1000 glow put on the photo at fit, timed from the edit to the first frame showing it
 * (the GPU done: its preview) and to the first frame after its cache was built (settled). Then its radius dragged
 * (the cache re-blurred, not rebuilt) and its threshold changed (rebuilt). Undone after.
 */
export async function glow(frames = 30) {
  const d = driver();
  const r = await renderer();
  const doc = usePhoto.getState().history!.doc.doc;
  usePhotoUi.getState().setView(fitView(doc.canvas, usePhotoUi.getState().view!.width, usePhotoUi.getState().view!.height));
  const layerId = doc.layers.find((l) => l.kind !== "adjustment")!.id;
  await nextFrame();
  await gpuIdle();
  const stage = <T>(name: string, p: Promise<T>) => p.catch((error: unknown) => Promise.reject(new Error(`${name}: ${error instanceof Error ? error.message : String(error)} (refine ${r.refineState})`)));
  const shown = async (started: number) => {
    const frame = await stage("a frame showing it", until(() => r.presented.find((f) => f.at >= started && f.revision === r.revision), 30_000));
    await gpuIdle();
    return { frame, ms: performance.now() - started };
  };
  // Settled: its cache built and a frame drawn with it, done on the GPU (the screen draws one by itself too).
  const settle = async (started: number) => {
    await stage("its cache", until(() => r.glows.complete(r.planFor(usePhoto.getState().history!.doc.doc)), 60_000));
    const timing = d.draw("final");
    if (timing) await timing.gpuMs;
    return performance.now() - started;
  };
  const started = performance.now();
  usePhoto.getState().commit((d) => addFilter(d, layerId, { id: "bench_glow", type: "glow", params: { radius: 1000, threshold: 60 } }));
  const first = await shown(started);
  const settled = await settle(started);
  // The radius dragged: each frame re-blurs the cached contributions.
  const gesture = photoGesture();
  gesture.begin();
  const gpu: Promise<number>[] = [];
  for (let i = 1; i <= frames; i++) {
    gesture.apply((doc) => setFilter(doc, layerId, "bench_glow", { params: { radius: Math.round(1000 + 400 * Math.sin((i / frames) * Math.PI)) } }));
    await nextFrame();
    const timing = d.draw("final");
    if (timing) gpu.push(timing.gpuMs);
  }
  gesture.end();
  const radiusDrag = percentiles(await Promise.all(gpu));
  // The threshold changed: the contributions are made again from level 0.
  const again = performance.now();
  usePhoto.getState().commit((d) => setFilter(d, layerId, "bench_glow", { params: { threshold: 80 } }));
  const thresholdFirst = await shown(again);
  const thresholdSettled = await settle(again);
  const result = {
    firstResponseMs: round(first.ms),
    settledMs: round(settled),
    radiusDrag,
    threshold: { firstResponseMs: round(thresholdFirst.ms), settledMs: round(thresholdSettled) },
    gpuErrors: r.gpu.errors.slice(-3),
  };
  usePhoto.getState().undo();
  usePhoto.getState().undo();
  usePhoto.getState().undo();
  await nextFrame();
  return result;
}

/** A Lens Flare added at fit, then its source handle dragged across the photo, a frame an edit: frame times. */
export async function flare(frames = 60) {
  const d = driver();
  const r = await renderer();
  const doc = usePhoto.getState().history!.doc.doc;
  const { width, height } = doc.canvas;
  usePhotoUi.getState().setView(fitView(doc.canvas, usePhotoUi.getState().view!.width, usePhotoUi.getState().view!.height));
  await nextFrame();
  await gpuIdle();
  const started = performance.now();
  usePhoto.getState().commit((d) => addGeneratorLayer(d, { id: "bench_flare", type: "lens-flare" }));
  await until(() => r.presented.find((f) => f.at >= started && f.revision === r.revision), 30_000);
  await gpuIdle();
  const firstMs = performance.now() - started;
  const gesture = photoGesture();
  gesture.begin();
  const gpu: Promise<number>[] = [];
  const cpu: number[] = [];
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    gesture.apply((doc) => setHandle(doc, "bench_flare", "source", [width * (0.2 + 0.6 * t), height * (0.3 + 0.2 * Math.sin(t * Math.PI))]));
    await nextFrame();
    const timing = d.draw("final");
    if (timing) {
      cpu.push(timing.cpuMs);
      gpu.push(timing.gpuMs);
    }
  }
  gesture.end();
  const result = { firstMs: round(firstMs), drag: { gpu: percentiles(await Promise.all(gpu)), cpu: percentiles(cpu) }, gpuErrors: r.gpu.errors.slice(-3) };
  usePhoto.getState().undo();
  usePhoto.getState().undo();
  await nextFrame();
  return result;
}

// --- the photo sheet (`scripts/photo-sheet.ts`): scenes painted here, any document rendered to floats ---

/** Paints `points` on a layer's pixels with this colour (premultiplied linear), committed as a stroke is. */
async function paintDabs(layerId: string, points: { x: number; y: number }[], radius: number, colour: number[], hardness = 1) {
  const r = await renderer();
  await until(() => r.beginStroke(layerId, "content", { radius, hardness, strength: 1, spacing: 0.1 }, colour, null), 10_000);
  r.strokeTo(points);
  const result = await r.endStroke();
  if (result) usePhoto.getState().commit(commitSurface(layerId, "content", result.id));
}

/**
 * The sheet's scenes in the open photo (800 × 600): `photo` the sample image (half size), `lights` a night of bright
 * dabs and a lit line above white, `object` a soft bright blob (alone on transparency, it's the cut-out). Returns
 * the document, whose layers the sheet shows and hides per scene.
 */
export async function sheetSetup(projectId: string, mediaId: string) {
  await useProjects.getState().open(projectId);
  const r = await until(() => usePhoto.getState().projectId === projectId && usePhoto.getState().history && liveRenderer());
  const pixel = (id: string) => ({ id, kind: "pixel" as const, name: id, visible: true, opacity: 1, surface: null, size: { width: 800, height: 600 }, transform: { x: 400, y: 300, scaleX: 1, scaleY: 1, rotation: 0 } });
  usePhoto.getState().commit((d) => ({
    ...d,
    canvas: { width: 800, height: 600, background: "#05070c" },
    layers: [{ id: "photo", kind: "image", name: "photo", visible: true, opacity: 1, mediaId, transform: { x: 400, y: 300, scaleX: 0.5, scaleY: 0.5, rotation: 0 } }, pixel("lights"), pixel("object")],
  }));
  await sleep(50);
  for (const [x, y, c] of [
    [160, 140, [6, 4.5, 2, 1]],
    [420, 210, [2.5, 3, 5, 1]],
    [610, 120, [5, 1.5, 1, 1]],
    [300, 420, [3, 3, 3, 1]],
  ] as const)
    await paintDabs("lights", [{ x, y }], 5, [...c]);
  await paintDabs("lights", Array.from({ length: 60 }, (_, i) => ({ x: 120 + i * 9, y: 520 - Math.sin(i / 8) * 30 })), 2.5, [1.6, 1.2, 0.6, 1]);
  await paintDabs("object", Array.from({ length: 30 }, (_, i) => ({ x: 400 + Math.cos(i / 4.8) * 90, y: 300 + Math.sin(i / 4.8) * 60 })), 40, [1.4, 1.1, 0.5, 1], 0.4);
  await r.ready();
  return usePhoto.getState().history!.doc.doc;
}

/** Any document (the open one's layers) rendered at `view` as RGBA floats, refined below 100% when it needs to be. */
export async function renderDoc(doc: PhotoProject, view: View) {
  const r = await renderer();
  const { texture } = await r.renderView(doc, view);
  const data = await r.readFloat(texture, view.width, view.height);
  texture.destroy();
  return Array.from(data);
}

/** Every pipeline's WGSL compiled: the errors (none, when they all compile). */
export async function compileErrors() {
  const r = await renderer();
  return Compositor.compileErrors(r.device);
}

export type BenchStep = { open: string } | { run: "reopen" | "panZoom" | "adjustExposure" | "adjustCurves" | "exportPng" | "deviceLoss" | "budgetWalk" | "paintMask" | "glow" | "flare"; label?: string; budgetMB?: number };

const TASKS = { reopen, panZoom, adjustExposure, adjustCurves, exportPng, deviceLoss, budgetWalk, paintMask, glow, flare } as const;

/** Runs steps in order, collecting each result (an error is recorded and the plan goes on). */
export async function runPlan(steps: BenchStep[]) {
  const results: { step: string; ms: number; result?: unknown; error?: string }[] = [];
  for (const step of steps) {
    const started = performance.now();
    const name = "open" in step ? `open ${step.open}` : (step.label ?? step.run);
    try {
      const result = "open" in step ? await open(step.open) : step.run === "budgetWalk" ? await budgetWalk(step.budgetMB) : await TASKS[step.run]();
      results.push({ step: name, ms: round(performance.now() - started), result });
    } catch (error) {
      results.push({ step: name, ms: round(performance.now() - started), error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
    }
  }
  return results;
}
