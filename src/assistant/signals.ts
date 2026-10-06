/**
 * The assistant's ears: a video's sounds analysed and loaded (waited for, so its answers are never
 * about sound not yet heard), plot_signals' picture, and view_frames' contact sheets.
 */
import { type SignalReader, type SignalSource, beatGridAt, createSignalReader, customSignalHits, isOnsetName, signalAssets, sourceHits } from "@shared/audio-signals";
import { findSignal } from "@shared/links";
import { SIGNALS_VERSION, type SignalData } from "@shared/signals/format";
import type { ToolContent } from "@shared/tool-spec";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import { loadSignals } from "@/stores/signals";
import type { ToolDoc } from "./doc";
import { signalReadersOf } from "./describe-signals";
import { ToolError, secs } from "./input";

const POLL_MS = 500;
/** Longest wait for a file's analysis (a long one takes a few seconds a minute of sound). */
const MAX_WAIT_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A file's signals: analysed now if they aren't yet, then read. */
async function signalsOf(asset: MediaAsset, signal: AbortSignal): Promise<SignalData | null> {
  let current = asset;
  const ready = (a: MediaAsset) => a.signals?.status === "ready" && a.signals.version === SIGNALS_VERSION;
  if (!ready(current)) {
    current = await api.analyseSignals(asset.id);
    const deadline = Date.now() + MAX_WAIT_MS;
    while (current.signals?.status === "processing" && Date.now() < deadline) {
      if (signal.aborted) throw new ToolError("Stopped.");
      await sleep(POLL_MS);
      current = await api.getMedia(asset.id);
    }
    if (current.signals?.status === "error") throw new ToolError(`The sound of "${asset.name}" couldn't be analysed: ${current.signals.error}`);
    if (!ready(current)) throw new ToolError(`The sound of "${asset.name}" is still being analysed: try again in a moment.`);
  }
  return loadSignals(current);
}

/** A reader of a video's sounds, every file with sound its clips play analysed and loaded first. */
export async function readerFor(doc: ToolDoc, ctx: { signal: AbortSignal; progress: (f: number | null, label?: string) => void }): Promise<SignalReader> {
  const assets = new Map(doc.assets.map((a) => [a.id, a]));
  const ids = signalAssets(doc.document, (id) => !!assets.get(id)?.hasAudio);
  const store = new Map<string, SignalData>();
  for (const [i, id] of ids.entries()) {
    ctx.progress(i / Math.max(1, ids.length), "Listening");
    const data = await signalsOf(assets.get(id)!, ctx.signal);
    if (data) store.set(id, data);
  }
  return createSignalReader(doc.document, store);
}

const COLOURS = ["#5ec8ff", "#ff6b8b", "#ffd166", "#7cf29a", "#c792ff", "#ff9f5a"];

/** plot_signals: signals as lanes over a stretch, with the beat, bars, drops and each lane's hits. */
export function plotSignals(
  reader: SignalReader,
  sequenceId: string | null,
  source: SignalSource,
  names: string[],
  from: number,
  to: number,
  width: number,
): ToolContent[] {
  const read = signalReadersOf(reader, sequenceId, source, names);
  const lane = 90;
  const axis = 24;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = names.length * lane + axis;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ToolError("The browser couldn't draw the plot.");
  ctx.fillStyle = "#14161c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const span = to - from;
  const x = (t: number) => ((t - from) / span) * width;
  const column = span / width;

  // The beat: beats faint, bars brighter, drops red.
  const grid = beatGridAt(reader, sequenceId, (from + to) / 2) ?? beatGridAt(reader, sequenceId, from);
  const lines = (times: number[], colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    for (const t of times) {
      if (t < from || t > to) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(t)) + 0.5, 0);
      ctx.lineTo(Math.round(x(t)) + 0.5, names.length * lane);
      ctx.stroke();
    }
  };
  if (grid && grid.beats.filter((t) => t >= from && t <= to).length < width / 4) lines(grid.beats, "#262a33");
  if (grid) lines(grid.downbeats, "#3a4050");
  if (grid) lines(grid.drops, "#e0484880");

  names.forEach((name, i) => {
    const top = i * lane;
    const colour = COLOURS[i % COLOURS.length];
    ctx.fillStyle = "#1c1f27";
    ctx.fillRect(0, top + lane - 1, width, 1);
    ctx.beginPath();
    ctx.moveTo(0, top + lane - 2);
    for (let px = 0; px < width; px++) {
      const t = from + px * column;
      const v = read[i](t + column, column);
      const shown = name === "balance" ? (v + 1) / 2 : v;
      ctx.lineTo(px, top + lane - 2 - shown * (lane - 18));
    }
    ctx.lineTo(width, top + lane - 2);
    ctx.closePath();
    ctx.fillStyle = `${colour}55`;
    ctx.fill();
    ctx.strokeStyle = colour;
    ctx.stroke();
    const own = findSignal(reader.document, name);
    const hits = isOnsetName(name) ? sourceHits(reader, sequenceId, source, name) : own ? customSignalHits(reader, own, from, to) : [];
    if (hits.length) {
      ctx.fillStyle = "#ffffff";
      for (const [t, v] of hits) {
        if (t < from || t > to) continue;
        ctx.fillRect(Math.round(x(t)), top + 14, 2, 4 + v * 10);
      }
    }
    ctx.fillStyle = "#e8eaf0";
    ctx.font = "12px sans-serif";
    ctx.fillText(name, 6, top + 13);
  });

  // Time axis.
  ctx.fillStyle = "#9aa0ad";
  ctx.font = "11px sans-serif";
  const tick = niceStep(span / 8);
  for (let t = Math.ceil(from / tick) * tick; t <= to; t += tick) {
    ctx.fillRect(Math.round(x(t)), names.length * lane, 1, 5);
    ctx.fillText(`${secs(t)}s`, Math.min(width - 40, x(t) + 3), names.length * lane + 17);
  }
  const data = canvas.toDataURL("image/png").split(",")[1];
  const legend =
    `Signals ${names.join(", ")} from ${secs(from)}s to ${secs(to)}s (0 at each lane's bottom, 1 at its top` +
    `${grid ? "; vertical lines: bars, faint: beats, red: drops" : ""}; white ticks: hits, taller is harder).`;
  return [
    { type: "text", text: legend },
    { type: "image", data, mimeType: "image/png" },
  ];
}

/** A round step for an axis: 1, 2 or 5 times a power of ten. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  for (const m of [1, 2, 5, 10]) if (m * power >= raw) return m * power;
  return 10 * power;
}

/** Frames (a text line and a picture each) as one picture: a grid, each frame labelled with its time. */
export async function contactSheet(frames: ToolContent[], times: number[], tile: number): Promise<ToolContent[]> {
  const images = frames.filter((c): c is Extract<ToolContent, { type: "image" }> => c.type === "image");
  const bitmaps = await Promise.all(images.map(async (img) => createImageBitmap(await (await fetch(`data:${img.mimeType};base64,${img.data}`)).blob())));
  if (!bitmaps.length) return frames;
  const columns = Math.ceil(Math.sqrt(bitmaps.length));
  const rows = Math.ceil(bitmaps.length / columns);
  const h = Math.round((tile * bitmaps[0].height) / bitmaps[0].width);
  const label = 16;
  const canvas = document.createElement("canvas");
  canvas.width = columns * tile + (columns - 1) * 4;
  canvas.height = rows * (h + label) + (rows - 1) * 4;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ToolError("The browser couldn't make a picture.");
  ctx.fillStyle = "#101114";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "12px sans-serif";
  bitmaps.forEach((bitmap, i) => {
    const left = (i % columns) * (tile + 4);
    const top = Math.floor(i / columns) * (h + label + 4);
    ctx.fillStyle = "#c8ccd6";
    ctx.fillText(`${i + 1}. ${secs(times[i])}s`, left + 2, top + 12);
    ctx.drawImage(bitmap, left, top + label, tile, h);
    bitmap.close();
  });
  return [
    { type: "text", text: `${bitmaps.length} frames, left to right then down: ${times.map((t, i) => `${i + 1}. ${secs(t)}s`).join(", ")}` },
    { type: "image", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1], mimeType: "image/jpeg" },
  ];
}
