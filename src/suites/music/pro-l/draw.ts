/**
 * Drawing YT-L's displays (`docs/fabfilter/pro-l.md` §2.6, FabFilter's look in our drawing): the level display
 * scrolling right to left (the input after Gain a pale fill, the output a deep blue one with a light line, the
 * clip stage's reduction orange and the limiter's red hanging from the top, the loudness a thin line coloured by
 * the target, the ceiling dashed, the dB scale at the right); the meters (output, each side, its Momentary as a
 * paler segment and its peak held; the gain reduction red from the top). Colours are the theme's `--lim-*` tokens.
 */
import type { ProLMeter } from "@shared/music/types";
import { dbY, loudnessFraction, loudnessZone, scaleSteps } from "./geometry";
import type { LimHistory } from "./history";
import { columnAt } from "./history";

export interface LimPalette {
  bgTop: string;
  bgBottom: string;
  grid: string;
  gridStrong: string;
  label: string;
  text: string;
  input: string;
  output: string;
  outputLine: string;
  reduction: string;
  clip: string;
  ceiling: string;
  loudLow: string;
  loudNear: string;
  loudOver: string;
  target: string;
  meter: string;
  meterHot: string;
  font: string;
}

let cached: { key: string; palette: LimPalette } | null = null;
/** The displays' colours (read again when the theme changes). */
export function readLimPalette(element: Element): LimPalette {
  const key = document.documentElement.className;
  if (cached?.key === key) return cached.palette;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--lim-${name}`).trim();
  const palette: LimPalette = {
    bgTop: read("bg-top"),
    bgBottom: read("bg-bottom"),
    grid: read("grid"),
    gridStrong: read("grid-strong"),
    label: read("label"),
    text: read("text"),
    input: read("input"),
    output: read("output"),
    outputLine: read("output-line"),
    reduction: read("reduction"),
    clip: read("clip"),
    ceiling: read("ceiling"),
    loudLow: read("loud-low"),
    loudNear: read("loud-near"),
    loudOver: read("loud-over"),
    target: read("target"),
    meter: read("meter"),
    meterHot: read("meter-hot"),
    font: style.getPropertyValue("--font-sans").trim() || "sans-serif",
  };
  cached = { key, palette };
  return palette;
}

/** `colour` (#rrggbb) at `a`. */
export function alpha(colour: string, a: number): string {
  const n = Number.parseInt(colour.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const zoneColour = (palette: LimPalette, zone: "low" | "near" | "over") => (zone === "over" ? palette.loudOver : zone === "near" ? palette.loudNear : palette.loudLow);

/** The level display as drawn: its box, the plot inside it, what it shows. */
export interface LevelScene {
  width: number;
  height: number;
  top: number;
  plot: number;
  gutter: number;
  /** dB the scale shows, and where its 0 mark is (the K-System's). */
  range: number;
  zero: number;
  /** The ceiling (dB), drawn dashed. */
  ceiling: number;
  /** Seconds across, and where the newest column is (0..1 of the width, Slow Down's filling). */
  seconds: number;
  head: number;
  /** `performance.now()` the right edge stands for. */
  now: number;
  /** Which loudness the line follows (column 4 Momentary, 5 Short-term), and the target it's coloured by. */
  loudness: 4 | 5;
  target: number;
  bypassed: boolean;
  palette: LimPalette;
}

export function drawLevel(ctx: CanvasRenderingContext2D, scene: LevelScene, history: LimHistory | undefined) {
  const { width, height, top, plot, gutter, range, palette } = scene;
  const right = width - gutter;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.bgTop);
  gradient.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const y = (db: number) => dbY(db, range, top, plot);

  // The scale's lines and labels (the K-System's numbered from its 0 mark).
  ctx.font = `10px ${palette.font}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const db of scaleSteps(range)) {
    const at = Math.round(y(db)) + 0.5;
    ctx.strokeStyle = db === 0 ? palette.gridStrong : palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, at);
    ctx.lineTo(right, at);
    ctx.stroke();
    const shown = db - scene.zero;
    ctx.fillStyle = palette.label;
    ctx.fillText(shown === 0 ? "0" : `${shown > 0 ? "+" : "−"}${Math.abs(shown)}`, width - 4, at);
  }

  const columns = history?.columns ?? [];
  if (history && columns.length && scene.seconds > 0) {
    // The newest column at `head` of the width (Slow Down fills from the left), moving at the whole width's pace.
    const across = right * scene.head;
    const pxPerMs = right / (scene.seconds * 1000);
    const step = Math.max(1, history.step * 1000 * pxPerMs);
    const first = Math.max(0, columns.length - Math.ceil((scene.seconds / history.step) * 1.05) - 2);
    const newest = history.last;
    const xOf = (i: number) => across - (scene.now - columnAt(history, newest - (columns.length - 1 - i))) * pxPerMs;
    const bottom = top + plot;
    const dim = scene.bypassed ? 0.35 : 1;
    // The input after Gain, then the output over it.
    ctx.globalAlpha = dim;
    ctx.fillStyle = palette.input;
    for (let i = first; i < columns.length; i++) {
      const x = xOf(i);
      if (x < -step || x > right) continue;
      const v = y(columns[i][0]);
      ctx.fillRect(x - step, v, step + 0.5, bottom - v);
    }
    ctx.fillStyle = palette.output;
    for (let i = first; i < columns.length; i++) {
      const x = xOf(i);
      if (x < -step || x > right) continue;
      const v = y(columns[i][1]);
      ctx.fillRect(x - step, v, step + 0.5, bottom - v);
    }
    ctx.strokeStyle = palette.outputLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let drawing = false;
    for (let i = first; i < columns.length; i++) {
      const x = xOf(i);
      if (x < -step || x > right) continue;
      const v = y(columns[i][1]);
      if (drawing) ctx.lineTo(x, v);
      else ctx.moveTo(x, v);
      drawing = true;
    }
    ctx.stroke();
    // The reductions from the top: the clip stage's first, the limiter's under it.
    const depth = (gr: number) => Math.max(0, dbY(-gr, range, top, plot) - top);
    for (let i = first; i < columns.length; i++) {
      const x = xOf(i);
      if (x < -step || x > right) continue;
      const clip = depth(columns[i][2]);
      const total = depth(columns[i][2] + columns[i][3]);
      if (clip > 0.2) {
        ctx.fillStyle = palette.clip;
        ctx.fillRect(x - step, top, step + 0.5, clip);
      }
      if (total - clip > 0.2) {
        ctx.fillStyle = palette.reduction;
        ctx.fillRect(x - step, top + clip, step + 0.5, total - clip);
      }
    }
    // The loudness: a thin line, coloured by where it is against the target.
    ctx.lineWidth = 1.5;
    let previous: [number, number, string] | null = null;
    for (let i = first; i < columns.length; i++) {
      const x = xOf(i);
      if (x < -step || x > right) continue;
      const lufs = columns[i][scene.loudness];
      if (lufs <= -119) {
        previous = null;
        continue;
      }
      const colour = zoneColour(palette, loudnessZone(lufs, scene.target));
      const v = y(lufs);
      if (previous) {
        ctx.strokeStyle = colour;
        ctx.beginPath();
        ctx.moveTo(previous[0], previous[1]);
        ctx.lineTo(x, v);
        ctx.stroke();
      }
      previous = [x, v, colour];
    }
    ctx.globalAlpha = 1;
  }

  // The ceiling, dashed.
  const at = Math.round(y(scene.ceiling)) + 0.5;
  ctx.strokeStyle = palette.ceiling;
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, at);
  ctx.lineTo(right, at);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The meters as drawn: each side's output (dB) with its Momentary (LUFS) and held peak, and the gain reduction. */
export interface MeterScene {
  width: number;
  height: number;
  top: number;
  plot: number;
  range: number;
  output: [number, number];
  rms: [number, number];
  peak: [number, number];
  reduction: [number, number];
  ceiling: number;
  palette: LimPalette;
}

export function drawMeters(ctx: CanvasRenderingContext2D, scene: MeterScene) {
  const { width, height, top, plot, range, palette } = scene;
  ctx.clearRect(0, 0, width, height);
  const bar = Math.max(4, Math.floor((width - 14) / 4));
  const y = (db: number) => dbY(db, range, top, plot);
  const bottom = top + plot;
  // The gain reduction, each side, red from the top.
  for (let i = 0; i < 2; i++) {
    const x = 3 + i * (bar + 2);
    ctx.fillStyle = alpha(palette.reduction, 0.12);
    ctx.fillRect(x, top, bar, plot);
    const depth = dbY(-scene.reduction[i], range, top, plot) - top;
    ctx.fillStyle = palette.reduction;
    ctx.fillRect(x, top, bar, Math.max(0, depth));
  }
  // The output, each side: the peak bar, its Momentary paler under it, the held peak a line.
  for (let i = 0; i < 2; i++) {
    const x = 9 + 2 * (bar + 2) + i * (bar + 2);
    ctx.fillStyle = alpha(palette.meter, 0.12);
    ctx.fillRect(x, top, bar, plot);
    const level = y(scene.output[i]);
    ctx.fillStyle = scene.output[i] > scene.ceiling + 0.05 ? palette.meterHot : palette.meter;
    ctx.fillRect(x, level, bar, Math.max(0, bottom - level));
    const rms = y(scene.rms[i]);
    ctx.fillStyle = alpha(palette.text, 0.35);
    ctx.fillRect(x, rms, bar, Math.max(0, bottom - rms));
    if (scene.peak[i] > -119) {
      ctx.fillStyle = palette.text;
      ctx.fillRect(x, Math.round(y(scene.peak[i])), bar, 1);
    }
  }
}

/** The loudness bar: the chosen loudness filled, M, S and I as thin bars beside, the target's tick. */
export interface LoudnessScene {
  width: number;
  height: number;
  meter: ProLMeter;
  main: number;
  momentary: number;
  shortTerm: number;
  integrated: number;
  palette: LimPalette;
}

export function drawLoudness(ctx: CanvasRenderingContext2D, scene: LoudnessScene) {
  const { width, height, meter, palette } = scene;
  ctx.clearRect(0, 0, width, height);
  const y = (lufs: number) => height - loudnessFraction(lufs, meter) * height;
  const main = Math.floor(width * 0.5);
  ctx.fillStyle = alpha(palette.loudLow, 0.12);
  ctx.fillRect(0, 0, main, height);
  if (scene.main > -119) {
    const v = y(scene.main);
    ctx.fillStyle = zoneColour(palette, loudnessZone(scene.main, meter.target));
    ctx.fillRect(0, v, main, height - v);
  }
  // M, S and I as thin bars.
  [scene.momentary, scene.shortTerm, scene.integrated].forEach((lufs, i) => {
    const x = main + 4 + i * Math.floor((width - main - 4) / 3);
    const w = Math.max(2, Math.floor((width - main - 4) / 3) - 2);
    ctx.fillStyle = alpha(palette.loudLow, 0.12);
    ctx.fillRect(x, 0, w, height);
    if (lufs > -119) {
      const v = y(lufs);
      ctx.fillStyle = zoneColour(palette, loudnessZone(lufs, meter.target));
      ctx.fillRect(x, v, w, height - v);
    }
  });
  // The target: an orange tick across.
  const t = Math.round(y(meter.target)) + 0.5;
  ctx.strokeStyle = palette.target;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, t);
  ctx.lineTo(width, t);
  ctx.stroke();
}
