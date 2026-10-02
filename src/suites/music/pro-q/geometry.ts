/**
 * Pro-Q's display on screen (`docs/fabfilter/pro-q.md`): frequency across on a log scale (10 Hz to
 * 30 kHz, or the part zoomed into), the EQ's dB up the middle (its display range either way of 0 dB)
 * and the analyzer's dB beside it, the grid, where each band's dot is and what's under the pointer.
 * Pure, so it's tested; `draw.ts` draws with it and `pointer.ts` edits with it.
 */
import { clamp } from "@shared/math";
import { EQ_MAX_FREQUENCY, EQ_MIN_FREQUENCY, hasGain } from "@shared/music/pro-q-presets";
import type { EqBand } from "@shared/music/types";

/** The display's box in px, and what it shows. */
export interface EqView {
  width: number;
  height: number;
  /** The frequencies at its left and right edges (zoomed in, a part of 10 Hz..30 kHz). */
  low: number;
  high: number;
  /** dB either way of 0 the EQ's scale shows (the middle is 0 dB). */
  range: number;
  /** The analyzer's range in dB (0 at the top, -range at the bottom). */
  analyzerRange: number;
  /** Room at the top and bottom of the plot (the bars over it, the frequency scale under it). */
  top: number;
  bottom: number;
}

export const FULL = { low: EQ_MIN_FREQUENCY, high: EQ_MAX_FREQUENCY } as const;

/** Where a frequency is across. */
export const xOf = (view: EqView, hz: number) => (Math.log(hz / view.low) / Math.log(view.high / view.low)) * view.width;
/** The frequency at `x`. */
export const hzAt = (view: EqView, x: number) => view.low * (view.high / view.low) ** (x / view.width);

/** The plot's height (between the bars). */
const plot = (view: EqView) => Math.max(1, view.height - view.top - view.bottom);
/** Where 0 dB is: the middle of the plot (Pro-Q keeps it there whatever the range). */
export const zeroY = (view: EqView) => view.top + plot(view) / 2;
/** Where an EQ gain is (its scale: ±range over the plot, with a little room at each end). */
export const yOf = (view: EqView, db: number) => zeroY(view) - (db / view.range) * (plot(view) / 2) * EQ_SPAN;
export const dbAt = (view: EqView, y: number) => ((zeroY(view) - y) / ((plot(view) / 2) * EQ_SPAN)) * view.range;
/** The EQ scale fills this much of half the plot (so ±range isn't at the very edges). */
export const EQ_SPAN = 0.86;
/** Where an analyzer level is: 0 dB at the top of the plot, -range at the bottom. */
export const analyzerY = (view: EqView, db: number) => view.top + (-db / view.analyzerRange) * plot(view);

/** The vertical grid: every 1..9 times a decade, the labelled ones (20, 50, 100, 200, 500, 1k...) brighter. */
export function frequencyLines(view: EqView): { hz: number; label: string | null }[] {
  const lines: { hz: number; label: string | null }[] = [];
  for (let decade = 1; decade <= 10_000; decade *= 10)
    for (let k = 1; k <= 9; k++) {
      const hz = decade * k;
      if (hz < view.low || hz > view.high) continue;
      const labelled = k === 1 || k === 2 || k === 5;
      lines.push({ hz, label: labelled && hz >= 20 ? (hz >= 1000 ? `${hz / 1000}k` : String(hz)) : null });
    }
  return lines;
}

/** The EQ scale's labelled steps (Pro-Q's: ±3 by 1, ±6 by 2, ±12 by 3, ±30 by 10). */
export function gainSteps(range: number): number[] {
  const step = range <= 3 ? 1 : range <= 6 ? 2 : range <= 12 ? 3 : range <= 18 ? 6 : 10;
  const steps: number[] = [];
  for (let db = -Math.floor(range / step) * step; db <= range + 1e-9; db += step) steps.push(db);
  return steps;
}

/** The analyzer scale's steps: every 10 dB from 0 down. */
export const analyzerSteps = (range: number) => Array.from({ length: Math.floor(range / 10) }, (_, i) => -(i + 1) * 10);

/**
 * Where a band's dot is: at its frequency, and its gain (shapes with one), or for a gainless shape (cut,
 * notch, band pass) its Q: up for more resonance, down for less, Q 1 on 0 dB (a drag up and down
 * changes the Q).
 */
export function dotOf(view: EqView, band: EqBand): { x: number; y: number } {
  return { x: xOf(view, band.frequency), y: yOf(view, hasGain(band.shape) ? band.gain : qHeight(band.q, view.range)) };
}
/** A gainless band's Q as a height on the EQ scale, and back: an octave of Q is a quarter of the range. */
export const qHeight = (q: number, range: number) => clamp(Math.log2(q) * (range / 4), -range, range);
export const qAtHeight = (db: number, range: number) => 2 ** ((db * 4) / range);

/** The dot's radius, and how near the pointer must be to grab one. */
export const DOT = 6;
export const GRAB = 10;

/** The band whose dot is under (x, y), the nearest, or null. */
export function bandAt(view: EqView, bands: readonly EqBand[], x: number, y: number): EqBand | null {
  let best: EqBand | null = null;
  let distance = GRAB;
  for (const band of bands) {
    const dot = dotOf(view, band);
    const d = Math.hypot(dot.x - x, dot.y - y);
    if (d <= distance) {
      distance = d;
      best = band;
    }
  }
  return best;
}

/** The frequencies a display's curves are drawn at: one every couple of px across. */
export function curveFrequencies(view: EqView, step = 2): Float64Array {
  const n = Math.max(2, Math.ceil(view.width / step) + 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = hzAt(view, (i / (n - 1)) * view.width);
  return out;
}

/**
 * The shape a double-click makes where it lands (Pro-Q's): a Notch along the bottom, a Low Cut at the far
 * left and a High Cut at the far right, a Bell elsewhere. A drag of the curve at its ends makes a shelf.
 */
export function shapeForClick(view: EqView, x: number, y: number): "bell" | "notch" | "lowCut" | "highCut" {
  const bottom = view.height - view.bottom;
  if (y > bottom - (bottom - zeroY(view)) * 0.18) return "notch";
  if (hzAt(view, x) < 25) return "lowCut";
  if (hzAt(view, x) > 15_000) return "highCut";
  return "bell";
}
export const shapeForCurveDrag = (hz: number): "bell" | "lowShelf" | "highShelf" => (hz < 40 ? "lowShelf" : hz > 10_000 ? "highShelf" : "bell");

/** A zoom of the frequency scale: `factor` (> 1 in) around `hz`, held inside 10 Hz..30 kHz. */
export function zoomed(view: Pick<EqView, "low" | "high">, hz: number, factor: number): { low: number; high: number } {
  const span = Math.log(view.high / view.low) / factor;
  const full = Math.log(FULL.high / FULL.low);
  if (span >= full - 1e-9) return { ...FULL };
  const minSpan = Math.log(4);
  const s = Math.max(minSpan, span);
  const at = (Math.log(hz / view.low) / Math.log(view.high / view.low)) * s;
  let low = Math.log(hz) - at;
  low = clamp(low, Math.log(FULL.low), Math.log(FULL.high) - s);
  return { low: Math.exp(low), high: Math.exp(low + s) };
}
/** The zoomed scale moved by `dx` px. */
export function scrolled(view: EqView, dx: number): { low: number; high: number } {
  const span = Math.log(view.high / view.low);
  const shift = -(dx / view.width) * span;
  const low = clamp(Math.log(view.low) + shift, Math.log(FULL.low), Math.log(FULL.high) - span);
  return { low: Math.exp(low), high: Math.exp(low + span) };
}
