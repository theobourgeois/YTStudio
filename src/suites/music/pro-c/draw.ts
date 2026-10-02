/**
 * Drawing Pro-C's displays (`docs/fabfilter/pro-c.md` 2.7, FabFilter's look in our drawing): the level
 * display scrolling right to left (the input a dark grey fill, the output a lighter one with a light line,
 * the gain reduction a red line hanging from the top), the threshold's dashed line, the dB scale; the knee
 * display over its left part (the transfer curve white, green up to the level heard, a dot there); and
 * the meters (gain reduction red, input and output green). Colours are the theme's `--comp-*` tokens.
 */
import type { CompHistory } from "./history";
import { pointAt } from "./history";
import { dbY, kneeX, meterFraction, reductionY, scaleSteps, timeX } from "./geometry";

export interface CompPalette {
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
  threshold: string;
  kneeBg: string;
  knee: string;
  kneeLive: string;
  meter: string;
  meterLoud: string;
  meterHot: string;
  /** The knobs' yellow (the side chain EQ's curve). */
  arc: string;
  font: string;
}

let cached: { key: string; palette: CompPalette } | null = null;
/** The displays' colours (read again when the theme changes). */
export function readCompPalette(element: Element): CompPalette {
  const key = document.documentElement.className;
  if (cached?.key === key) return cached.palette;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(`--comp-${name}`).trim();
  const palette: CompPalette = {
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
    threshold: read("threshold"),
    kneeBg: read("knee-bg"),
    knee: read("knee"),
    kneeLive: read("knee-live"),
    meter: read("meter"),
    meterLoud: read("meter-loud"),
    meterHot: read("meter-hot"),
    arc: read("arc"),
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

/** The level display as drawn: its box, the plot inside it, what it shows. */
export interface LevelScene {
  width: number;
  height: number;
  /** The plot: from `top`, `plot` px tall; the scale's labels in the `gutter` px at the right. */
  top: number;
  plot: number;
  gutter: number;
  scale: number;
  palette: CompPalette;
  history: CompHistory | undefined;
  /** The time at the right edge (ms, `performance.now()`'s). */
  head: number;
  /** dB: the threshold's dashed line (null: none, as a Vintage unit has no threshold to show). */
  threshold: number | null;
  /** Dimmed: bypassed. */
  bypassed: boolean;
  knee: KneeScene | null;
}

/** The knee display: the transfer curve (`[input dB, output dB]` points), the level heard now (null: none), its width. */
export interface KneeScene {
  width: number;
  curve: [number, number][];
  live: { level: number; output: number } | null;
  threshold: number | null;
}

/** One column of the level display: the most input, output and reduction in it. */
interface Column {
  input: number;
  output: number;
  reduction: number;
}

/** The history in columns of a pixel, newest at the right (index 0 at the plot's left). */
function columns(history: CompHistory, head: number, right: number): (Column | null)[] {
  const out: (Column | null)[] = Array.from({ length: Math.ceil(right) + 1 }, () => null);
  const first = history.last - history.points.length + 1;
  for (let i = history.points.length - 1; i >= 0; i--) {
    const x = Math.floor(timeX(head - pointAt(history, first + i), right));
    if (x < 0) break;
    if (x > right) continue;
    const [input, output, reduction] = history.points[i];
    const c = out[x];
    if (c) {
      c.input = Math.max(c.input, input);
      c.output = Math.max(c.output, output);
      c.reduction = Math.max(c.reduction, reduction);
    } else out[x] = { input, output, reduction };
  }
  return out;
}

export function drawLevel(ctx: CanvasRenderingContext2D, s: LevelScene) {
  const { width, height, top, plot, gutter, scale, palette: c } = s;
  const right = width - gutter;
  const bottom = top + plot;
  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, c.bgTop);
  bg.addColorStop(1, c.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // The grid: a line at each labelled step, the scale's labels at the right.
  ctx.font = `10px ${c.font}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const db of scaleSteps(scale)) {
    const y = Math.round(dbY(db, scale, top, plot)) + 0.5;
    ctx.fillStyle = db === 0 ? c.gridStrong : c.grid;
    ctx.fillRect(0, y, right, 1);
    ctx.fillStyle = c.label;
    ctx.fillText(db === 0 ? "0" : `−${Math.abs(db)}`, width - 5, Math.max(top + 5, Math.min(bottom - 5, y)));
  }

  // The levels, as filled shapes column by column, and the reduction's line.
  const cols = s.history ? columns(s.history, s.head, right) : [];
  const shape = (pick: (col: Column) => number, line: string | null, fill: string | null) => {
    let open = false;
    const runs: [number, number][] = [];
    let start = 0;
    for (let x = 0; x < cols.length; x++) {
      const col = cols[x];
      if (!col) {
        if (open) runs.push([start, x - 1]);
        open = false;
        continue;
      }
      if (!open) start = x;
      open = true;
    }
    if (open) runs.push([start, cols.length - 1]);
    for (const [a, b] of runs) {
      if (fill) {
        ctx.beginPath();
        ctx.moveTo(a, bottom);
        for (let x = a; x <= b; x++) ctx.lineTo(x + 0.5, dbY(pick(cols[x]!), scale, top, plot));
        ctx.lineTo(b + 1, bottom);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (line) {
        ctx.beginPath();
        for (let x = a; x <= b; x++) {
          const y = dbY(pick(cols[x]!), scale, top, plot);
          if (x === a) ctx.moveTo(x + 0.5, y);
          else ctx.lineTo(x + 0.5, y);
        }
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  };
  if (cols.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, right, plot);
    ctx.clip();
    shape((col) => col.input, null, alpha(c.input, 0.85));
    shape((col) => col.output, alpha(c.outputLine, 0.85), alpha(c.output, 0.42));
    // The gain reduction, from the top: a red line (and a faint wash above it).
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= cols.length; x++) {
      const on = x < cols.length && cols[x] !== null;
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push([start, x - 1]);
        start = -1;
      }
    }
    for (const [a, b] of runs) {
      ctx.beginPath();
      ctx.moveTo(a, top);
      for (let x = a; x <= b; x++) ctx.lineTo(x + 0.5, reductionY(cols[x]!.reduction, scale, top, plot));
      ctx.lineTo(b + 1, top);
      ctx.closePath();
      ctx.fillStyle = alpha(c.reduction, 0.1);
      ctx.fill();
      ctx.beginPath();
      for (let x = a; x <= b; x++) {
        const y = reductionY(cols[x]!.reduction, scale, top, plot);
        if (x === a) ctx.moveTo(x + 0.5, y);
        else ctx.lineTo(x + 0.5, y);
      }
      ctx.strokeStyle = c.reduction;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  // The threshold: a dashed line across.
  if (s.threshold !== null && s.threshold > -scale && s.threshold <= 0) {
    const y = Math.round(dbY(s.threshold, scale, top, plot)) + 0.5;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = alpha(c.threshold, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.restore();
  }

  if (s.knee) drawKnee(ctx, s, s.knee);

  if (s.bypassed) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, right, height);
  }
}

/** The knee display, over the level display's left part, on its dB scale. */
function drawKnee(ctx: CanvasRenderingContext2D, s: LevelScene, k: KneeScene) {
  const { top, plot, scale, palette: c } = s;
  const w = k.width;
  const bottom = top + plot;
  ctx.save();
  // Its panel: darker, the level display seen through it, an edge at its right.
  const panel = ctx.createLinearGradient(0, 0, w, 0);
  panel.addColorStop(0, alpha(c.kneeBg, 0.82));
  panel.addColorStop(1, alpha(c.kneeBg, 0.62));
  ctx.fillStyle = panel;
  ctx.fillRect(0, 0, w, s.height);
  ctx.fillStyle = c.gridStrong;
  ctx.fillRect(Math.round(w) - 0.5, 0, 1, s.height);
  ctx.beginPath();
  ctx.rect(0, top - 2, w, plot + 4);
  ctx.clip();

  // Unity (in = out): a faint diagonal; the threshold: a dashed line up.
  ctx.strokeStyle = alpha(c.knee, 0.12);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  ctx.lineTo(w, top);
  ctx.stroke();
  if (k.threshold !== null && k.threshold > -scale && k.threshold < 0) {
    const x = Math.round(kneeX(k.threshold, scale, w)) + 0.5;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = alpha(c.threshold, 0.6);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  }

  // The curve: white, green up to the level heard.
  const point = ([input, output]: [number, number]) => [kneeX(input, scale, w), dbY(output, scale, top, plot)] as const;
  const stroke = (pts: [number, number][], colour: string, width: number) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = point(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  };
  stroke(k.curve, alpha(c.knee, 0.9), 2);
  if (k.live && k.live.level > -scale) {
    const lit = k.curve.filter(([input]) => input <= k.live!.level);
    lit.push([k.live.level, k.live.output]);
    ctx.save();
    ctx.shadowColor = alpha(c.kneeLive, 0.6);
    ctx.shadowBlur = 6;
    stroke(lit, c.kneeLive, 2.5);
    ctx.restore();
    const [x, y] = point([k.live.level, k.live.output]);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = c.kneeLive;
    ctx.fill();
    ctx.strokeStyle = alpha(c.knee, 0.9);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/** A meter's state: its levels (dB) now and their held peaks. */
export interface MeterScene {
  width: number;
  height: number;
  top: number;
  plot: number;
  scale: number;
  palette: CompPalette;
  /** dB of gain reduction now, and its peak held. */
  reduction: number;
  reductionPeak: number;
  input: [number, number];
  output: [number, number];
  outputPeak: [number, number];
}

/** The meters at the right (vertical): gain reduction (red, from the top), then input and output (green, from the bottom). */
export function drawMeters(ctx: CanvasRenderingContext2D, s: MeterScene) {
  const { width, height, top, plot, scale, palette: c } = s;
  ctx.clearRect(0, 0, width, height);
  const bar = 5;
  const gap = 2;
  const groups = [
    { x: 4, n: 1 },
    { x: 4 + bar + 5, n: 2 },
    { x: 4 + bar + 5 + 2 * bar + gap + 5, n: 2 },
  ];
  const well = (x: number, w: number) => {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(x, top, w, plot);
  };
  // Gain reduction: from the top down.
  well(groups[0].x, bar);
  const gr = Math.max(0, s.reduction);
  ctx.fillStyle = c.reduction;
  ctx.fillRect(groups[0].x, top, bar, (Math.min(gr, scale) / scale) * plot);
  if (s.reductionPeak > 0.05) {
    ctx.fillRect(groups[0].x, top + (Math.min(s.reductionPeak, scale) / scale) * plot - 1, bar, 2);
  }
  // Input (dimmer) and output: from the bottom up, yellow near the top.
  const level = (x: number, db: number, dim: boolean) => {
    const h = meterFraction(db, scale) * plot;
    const g = ctx.createLinearGradient(0, top + plot, 0, top);
    g.addColorStop(0, dim ? alpha(c.meter, 0.45) : c.meter);
    g.addColorStop(0.8, dim ? alpha(c.meterLoud, 0.45) : c.meterLoud);
    g.addColorStop(1, dim ? alpha(c.meterHot, 0.5) : c.meterHot);
    ctx.fillStyle = g;
    ctx.fillRect(x, top + plot - h, bar, h);
  };
  for (const [g, levels, dim] of [
    [groups[1], s.input, true],
    [groups[2], s.output, false],
  ] as const) {
    for (let i = 0; i < 2; i++) {
      const x = g.x + i * (bar + gap);
      well(x, bar);
      level(x, levels[i], dim);
    }
  }
  for (let i = 0; i < 2; i++) {
    const db = s.outputPeak[i];
    if (db <= -scale) continue;
    ctx.fillStyle = db > -0.1 ? c.reduction : c.meterHot;
    ctx.fillRect(groups[2].x + i * (bar + gap), top + plot - meterFraction(db, scale) * plot - 1, bar, 2);
  }
  // Captions under them.
  ctx.font = `600 8px ${c.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = c.label;
  ctx.fillText("GR", groups[0].x + bar / 2, top + plot + 4);
  ctx.fillText("IN", groups[1].x + bar + gap / 2, top + plot + 4);
  ctx.fillText("OUT", groups[2].x + bar + gap / 2, top + plot + 4);
}

/** The meters in Compact (horizontal, as Pro-C's without its displays): gain change from the right, the output's two sides from the left. */
export function drawCompactMeters(ctx: CanvasRenderingContext2D, s: Omit<MeterScene, "top" | "plot" | "input"> & { left: number; right: number }) {
  const { width, height, scale, palette: c, left, right } = s;
  ctx.clearRect(0, 0, width, height);
  const span = right - left;
  const row = (y: number, h: number) => {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(left, y, span, h);
  };
  const h = 5;
  // Gain change: red, from 0 dB (at the right) leftwards.
  for (let i = 0; i < 2; i++) {
    const y = 4 + i * (h + 2);
    row(y, h);
    const w = (Math.min(Math.max(0, s.reduction), scale) / scale) * span;
    ctx.fillStyle = c.reduction;
    ctx.fillRect(right - w, y, w, h);
    if (s.reductionPeak > 0.05) ctx.fillRect(right - (Math.min(s.reductionPeak, scale) / scale) * span - 1, y, 2, h);
  }
  // Output: green from the left.
  for (let i = 0; i < 2; i++) {
    const y = 4 + 2 * (h + 2) + 6 + i * (h + 2);
    row(y, h);
    const w = meterFraction(s.output[i], scale) * span;
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, c.meter);
    g.addColorStop(0.8, c.meterLoud);
    g.addColorStop(1, c.meterHot);
    ctx.fillStyle = g;
    ctx.fillRect(left, y, w, h);
    const peak = s.outputPeak[i];
    if (peak > -scale) {
      ctx.fillStyle = c.meterHot;
      ctx.fillRect(left + meterFraction(peak, scale) * span - 1, y, 2, h);
    }
  }
  ctx.font = `600 9px ${c.font}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = c.label;
  ctx.fillText("GR", left - 6, 4 + h + 1);
  ctx.fillText("OUT", left - 6, 4 + 2 * (h + 2) + 6 + h + 1);
}
