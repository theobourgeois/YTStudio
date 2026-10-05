/**
 * F0's measured scenarios (docs/photo/foundations-prototype.md, "F0"). The lab page runs them from its buttons,
 * and `scripts/photo-bench.ts` drives them through `window.photoLab` in headless Chrome and in Electron. Each
 * returns plain JSON.
 */
import { sourceTransform, toLinearSrgb } from "@shared/photo/colour.ts";
import { type View, fitView, zoomAbout } from "@shared/photo/geometry.ts";
import { fromHalf, toHalf } from "@shared/photo/half.ts";
import type { SourceInfo, TileSize } from "@shared/photo/lab.ts";
import { DITHER_8BIT, encodePixel } from "@shared/photo/output.ts";
import { labApi } from "../api.ts";
import { compareBlur, quantize, readLevel0, roundTripError } from "../render/checks.ts";
import { Compositor } from "../render/compositor.ts";
import { Kernels } from "../render/kernels.ts";
import type { PhotoSession } from "../render/session.ts";

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

export async function findSource(name: string): Promise<SourceInfo> {
  const source = (await labApi.sources()).find((s) => s.name === name);
  if (!source) throw new Error(`Upload ${name} first.`);
  return source;
}

/** Every kernel compiles, for both atlas formats. */
export async function compileCheck(session: PhotoSession) {
  return {
    rgba16float: await Kernels.compileErrors(session.gpu.device, "rgba16float"),
    rgba32float: await Kernels.compileErrors(session.gpu.device, "rgba32float"),
    compositor: await Compositor.compileErrors(session.gpu.device),
  };
}

/**
 * Pans and zooms along a fixed path, one view change per animation frame, and reports how long each frame took
 * from submit until the GPU finished it (and on the CPU).
 */
export async function panZoom(session: PhotoSession, steps = 60) {
  const layout = session.layout!;
  const { width, height } = session.canvas;
  const fit = fitView(layout, width, height);
  session.frames = [];
  const gpu: Promise<number>[] = [];
  const cpu: number[] = [];
  let view: View = fit;
  const frame = async (next: View) => {
    await nextFrame();
    view = next;
    session.view = view;
    const timing = session.drawNow("interactive");
    if (timing) {
      cpu.push(timing.cpuMs);
      gpu.push(timing.gpuMs);
    }
  };
  // In to 100% at the centre, across at 100%, back out, across at fit.
  const toOne = Math.pow(1 / fit.zoom, 1 / steps);
  for (let i = 0; i < steps; i++) await frame(zoomAbout(view, width / 2, height / 2, toOne));
  for (let i = 0; i < steps; i++) await frame({ ...view, x: view.x + 40, y: view.y + 15 });
  for (let i = 0; i < steps; i++) await frame(zoomAbout(view, width / 2, height / 2, 1 / toOne));
  for (let i = 0; i < steps; i++) await frame({ ...fit, x: fit.x + Math.sin(i / 8) * 200, y: fit.y + Math.cos(i / 8) * 120 });
  const gpuMs = await Promise.all(gpu);
  // A settled frame at fit and at 100% (Mitchell).
  session.view = fit;
  const fitFinal = await session.drawNow("final")!.gpuMs;
  session.view = { ...zoomAbout(fit, width / 2, height / 2, 1 / fit.zoom) };
  await session.settle();
  const oneFinal = await session.drawNow("final")!.gpuMs;
  session.view = fit;
  return { frames: gpuMs.length, gpu: percentiles(gpuMs), cpu: percentiles(cpu), finalFitMs: round(fitFinal), final100Ms: round(oneFinal) };
}

/** A diagonal stroke across about twenty tiles: pointer up → committed, and → uploaded; then undo and redo. */
export async function stroke(session: PhotoSession, radius = 180) {
  const paint = session.paint!;
  const layout = session.layout!;
  paint.begin({ radius, hardness: 0.6, strength: 0.8, spacing: 0.15 }, [0.9, 0.3, 0.05, 0.9]);
  const from = { x: layout.width * 0.2, y: layout.height * 0.25 };
  const to = { x: layout.width * 0.2 + 1100, y: layout.height * 0.25 + 500 };
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    paint.add([{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
    if (i % 4 === 0) {
      session.requestDraw();
      await nextFrame();
    }
  }
  const result = await paint.end();
  if (!result) throw new Error("The stroke touched nothing.");
  const uploaded = await result.uploaded;
  const undoStart = performance.now();
  paint.undo();
  await paint.ensureResident();
  await session.drawNow("final")!.gpuMs;
  const undoMs = performance.now() - undoStart;
  const redoStart = performance.now();
  paint.redo();
  await paint.ensureResident();
  await session.drawNow("final")!.gpuMs;
  const redoMs = performance.now() - redoStart;
  return {
    tiles: result.tiles,
    commitMs: round(result.commitMs),
    readbackMs: round(result.readbackMs),
    hashMs: round(result.hashMs),
    uploadMs: round(uploaded.ms),
    uploadedTiles: uploaded.sent,
    undoMs: round(undoMs),
    redoMs: round(redoMs),
    manifest: paint.manifestId,
  };
}

/** The tiled blur against the monolithic one, on whatever is open (blur-detail.png). */
export async function blur(session: PhotoSession, sigma = 6) {
  const r = await compareBlur(session.ctx, session.source!, sigma);
  return { ...r, tiledMs: round(r.tiledMs), monoMs: round(r.monoMs) };
}

/** Display P3 patches (p3-patches.png: green, red, blue, grey) converted on the GPU, against the CPU reference. */
export async function p3(session: PhotoSession) {
  const layout = session.layout!;
  const level0 = await readLevel0(session.ctx, session.source!.image);
  const icc = layout.icc ? Uint8Array.from(atob(layout.icc), (c) => c.charCodeAt(0)) : null;
  const transform = sourceTransform(icc);
  const patches: Record<string, { stored: [number, number, number]; gpu: number[]; cpu: number[] }> = {};
  const stored: [string, [number, number, number]][] = [["green", [0, 255, 0]], ["red", [255, 0, 0]], ["blue", [0, 0, 255]], ["grey", [128, 128, 128]]];
  let maxError = 0;
  stored.forEach(([name, rgb], i) => {
    const x = i * 64 + 32;
    const y = 32;
    const at = (y * layout.width + x) * 4;
    const gpu = Array.from(level0.subarray(at, at + 3));
    const cpu = toLinearSrgb(transform, [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
    gpu.forEach((v, c) => (maxError = Math.max(maxError, Math.abs(v - cpu[c]))));
    patches[name] = { stored: rgb, gpu: gpu.map((v) => round(v * 1e4) / 1e4), cpu: cpu.map((v) => round(v * 1e4) / 1e4) };
  });
  return { transform: transform.kind, patches, maxError };
}

/**
 * Exports what's open as an 8-bit PNG through the output transform and has the server compare its samples with
 * the source file's: an unedited 8-bit sRGB source must come back bit for bit. Also how far f16 tiles moved the
 * samples (the dither's margin), when the image is small enough to read back whole.
 */
export async function roundTrip(session: PhotoSession) {
  const info = session.info!;
  const layout = session.layout!;
  const name = `roundtrip-${info.key.slice(0, 12)}-${session.options.tile}.png`;
  const { id } = await labApi.beginExport({ name, width: layout.width, height: layout.height, bits: 8, format: "png" });
  const q = await quantize(session.ctx, session.source!, null, (from, rows) => labApi.exportRows(id, from, rows));
  const exported = await labApi.finishExport(id);
  const compared = await labApi.compare(name, info.key);
  let margin: number | null = null;
  let worst: number | null = null;
  if (q.width * q.height <= 4_000_000) {
    const level0 = await readLevel0(session.ctx, session.source!.image);
    worst = round(roundTripError(level0, encodePixel) * 1000) / 1000;
    margin = round((0.5 - DITHER_8BIT - worst) * 1000) / 1000;
  }
  return { quantizeMs: round(q.ms), encodeMs: exported.encodeMs, bytes: exported.bytes, differing: compared.differing, maxDifference: compared.maxDifference, underTransparent: compared.underTransparent, worstStepError: worst, ditherMargin: margin };
}

/** Destroys the device mid-session and times the view's return, then checks the paint came back. */
export async function deviceLoss(session: PhotoSession) {
  const before = session.paint?.manifestId ?? null;
  const ms = await session.simulateLoss();
  return { recoverMs: round(ms), paintRestored: (session.paint?.manifestId ?? null) === before, recoveries: session.recoveries, gpuErrors: session.gpu.errors.length };
}

/**
 * At 100%, visits points across the whole image, waiting for each to settle: with a budget smaller than the
 * image, level-0 tiles are evicted and fetched again. Reports refetches, evictions and errors.
 */
export async function budgetWalk(session: PhotoSession, stops = 16) {
  const layout = session.layout!;
  const { width, height } = session.canvas;
  const settleTimes: number[] = [];
  const cols = Math.ceil(Math.sqrt(stops));
  for (let i = 0; i < stops; i++) {
    const cx = ((i % cols) + 0.5) / cols;
    const cy = (Math.floor(i / cols) + 0.5) / Math.ceil(stops / cols);
    session.view = { zoom: 1, x: layout.width * cx - width / 2, y: layout.height * cy - height / 2, width, height };
    session.drawNow("interactive");
    const started = performance.now();
    await session.settle();
    settleTimes.push(performance.now() - started);
  }
  session.view = fitView(layout, width, height);
  await session.settle();
  const atlas = session.ctx.atlas;
  return {
    settle: percentiles(settleTimes),
    refetchedTiles: session.source!.refetched,
    evictions: atlas.evictions,
    capacityTiles: atlas.capacity,
    allocatedMB: Math.round(atlas.allocatedBytes / 1024 ** 2),
    gpuErrors: [...session.gpu.errors],
  };
}

/** Opens a source on a fresh session and reports the open's marks. */
export async function openSource(session: PhotoSession, name: string) {
  const info = await findSource(name);
  const marks = await session.open(info);
  return {
    name,
    size: `${session.layout!.width}×${session.layout!.height}`,
    bits: session.layout!.bits,
    decodeMs: marks.decodeMs,
    layoutMs: round(marks.layoutMs),
    coarseMs: round(marks.coarseMs),
    loadedMs: round(marks.loadedMs),
    settledMs: round(marks.settledMs),
    fetchedMB: Math.round((marks.bytes ?? 0) / 1024 ** 2),
  };
}


/** 16-bit precision: level 0 of a 16-bit ramp on the GPU against the CPU reference, and what f16 would lose. */
export async function precision16(session: PhotoSession) {
  const layout = session.layout!;
  if (layout.bits !== 16) throw new Error("Open a 16-bit image (ramp-16bit.png).");
  const level0 = await readLevel0(session.ctx, session.source!.image);
  const icc = layout.icc ? Uint8Array.from(atob(layout.icc), (c) => c.charCodeAt(0)) : null;
  const transform = sourceTransform(icc);
  let maxError = 0;
  let maxF16Error = 0;
  for (let x = 0; x < layout.width; x++) {
    const code = Math.round((x * 65535) / (layout.width - 1));
    const expected = toLinearSrgb(transform, [code / 65535, code / 65535, code / 65535])[0];
    maxError = Math.max(maxError, Math.abs(level0[x * 4] - expected));
    maxF16Error = Math.max(maxF16Error, Math.abs(toHalfValue(expected) - expected));
  }
  // Errors in 16-bit steps at white (sRGB's slope there is 1/2.275 of linear).
  const stepsAtWhite = (e: number) => round((e / 2.275) * 65535 * 1000) / 1000;
  return { atlas: session.ctx.format, maxError, inSteps: stepsAtWhite(maxError), f16WouldBe: maxF16Error, f16InSteps: stepsAtWhite(maxF16Error) };
}

const toHalfValue = (v: number) => fromHalf(toHalf(v));

export type PlanStep =
  | { start: { tile: TileSize; budgetMB: number; width: number; height: number } }
  | { open: string }
  | { run: "compileCheck" | "panZoom" | "stroke" | "blur" | "p3" | "roundTrip" | "deviceLoss" | "budgetWalk" | "precision16" | "rounding"; label?: string };

/** Runs steps in order, collecting each result (an error is recorded and the plan goes on). */
export async function runPlan(steps: PlanStep[]) {
  const results: { step: string; ms: number; result?: unknown; error?: string }[] = [];
  for (const step of steps) {
    const started = performance.now();
    const name = "start" in step ? `start ${step.start.tile} ${step.start.budgetMB}MB` : "open" in step ? `open ${step.open}` : (step.label ?? step.run);
    try {
      let result: unknown;
      if ("start" in step) {
        await window.photoLab!.start(step.start);
        const s = window.photoLab!.session()!;
        result = { adapter: s.gpu.adapter, capacity: s.ctx.atlas.capacity };
      } else {
        const session = window.photoLab!.session();
        if (!session) throw new Error("No session: start one first.");
        if ("open" in step) result = await openSource(session, step.open);
        else {
          const tasks = { compileCheck, panZoom, stroke, blur, p3, roundTrip, deviceLoss, budgetWalk, precision16, rounding } as const;
          result = await (tasks[step.run] as (s: PhotoSession) => Promise<unknown>)(session);
        }
      }
      results.push({ step: name, ms: round(performance.now() - started), result });
    } catch (error) {
      results.push({ step: name, ms: round(performance.now() - started), error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) });
    }
  }
  return results;
}

/**
 * How the GPU rounded the converted source into its f16 tiles: each stored half against round-to-nearest and
 * truncation of the exact value (8-bit sources; the first tile).
 */
export async function rounding(session: PhotoSession) {
  const layout = session.layout!;
  if (layout.bits !== 8 || session.ctx.format !== "rgba16float") throw new Error("Open an 8-bit image.");
  const res = await fetch(session.source!.urls.raw, { headers: { Range: `bytes=0-${layout.tileBytes - 1}` } });
  const raw = new Uint8Array(await res.arrayBuffer());
  const level0 = await readLevel0(session.ctx, session.source!.image);
  const icc = layout.icc ? Uint8Array.from(atob(layout.icc), (c) => c.charCodeAt(0)) : null;
  const transform = sourceTransform(icc);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  const truncate = (x: number) => {
    f[0] = x;
    const e = ((u[0] >>> 23) & 255) - 127 + 15;
    return e <= 0 ? toHalf(x) : (u[0] >>> 16) & 0x8000 | (e << 10) | ((u[0] & 0x7fffff) >>> 13);
  };
  const counts = { nearest: 0, truncated: 0, other: 0, same: 0 };
  const w = Math.min(layout.width, layout.tile);
  const h = Math.min(layout.height, layout.tile);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * layout.tile + x) * 4;
      const a = raw[o + 3] / 255;
      const lin = toLinearSrgb(transform, [raw[o] / 255, raw[o + 1] / 255, raw[o + 2] / 255]);
      for (let c = 0; c < 3; c++) {
        const exact = Math.fround(Math.fround(lin[c]) * a);
        const got = toHalf(level0[(y * layout.width + x) * 4 + c]);
        const n = toHalf(exact);
        const t = truncate(exact);
        if (n === t) counts.same++;
        else if (got === n) counts.nearest++;
        else if (got === t) counts.truncated++;
        else counts.other++;
      }
    }
  }
  return counts;
}
