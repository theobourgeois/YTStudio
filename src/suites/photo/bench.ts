/**
 * The photo suite's measured scenarios (docs/photo/foundations-prototype.md, "Performance targets"), run in the
 * real workspace on real projects: `scripts/photo-bench.ts` opens the app and drives them through
 * `window.photoBench` (development only, installed by `live.ts`). Each returns plain JSON. The renderer's parts that
 * the suite doesn't use yet (strokes, the blur's seams, P3 patches, f16 rounding, 16-bit precision) are still
 * measured by the lab (`lab/bench.ts`) until the suite has them.
 */
import { addAdjustmentLayer, setEffectParams } from "@shared/photo/edits";
import { type View, fitView, zoomAbout } from "@shared/photo/geometry";
import { identityCurveSet } from "@shared/photo/effects/params";
import { useProjects } from "@/stores/projects";
import { canvasDriver } from "./canvas/canvas-panel";
import { liveRenderer } from "./live";
import { usePhotoPreferences } from "./preferences";
import type { Presented } from "./render/renderer";
import { photoGesture, usePhoto } from "./store";
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

export type BenchStep = { open: string } | { run: "reopen" | "panZoom" | "adjustExposure" | "adjustCurves" | "exportPng" | "deviceLoss" | "budgetWalk"; label?: string; budgetMB?: number };

const TASKS = { reopen, panZoom, adjustExposure, adjustCurves, exportPng, deviceLoss, budgetWalk } as const;

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
