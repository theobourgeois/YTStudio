/**
 * The Reverb's displays' maths (`docs/reverb/reverb.md` 4.6): the Decay display's frequency across (20 Hz ..
 * 20 kHz, log) and decay time up (0.1 .. 30 s, log), the Post EQ's dB on its right (±12); the Shape display's
 * time across (0 .. 1.5 × Decay) and level up (0 .. -72 dB). Where the bands' dots and the Post EQ's handles
 * are, what a press is on, and what a drag means. Pure and tested.
 */
import { clamp } from "@shared/math";
import { MULTIPLIER_RANGE, decayCurve, naturalT60 } from "@shared/music/reverb";
import { HIGH_CUT_RANGE, LOW_CUT_RANGE, isInfinite } from "@shared/music/reverb-presets";
import type { ReverbBandShape, ReverbDecayBand, ReverbState } from "@shared/music/types";

export const FREQ_RANGE = [20, 20000] as const;
export const T60_RANGE = [0.1, 30] as const;
/** The Post EQ's scale, ±dB. */
export const POST_DB = 12;
/** The Shape display's floor (dB). */
export const SHAPE_FLOOR = -72;

export interface Plot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const freqX = (p: Plot, f: number) => p.left + (Math.log(clamp(f, FREQ_RANGE[0], FREQ_RANGE[1]) / FREQ_RANGE[0]) / Math.log(FREQ_RANGE[1] / FREQ_RANGE[0])) * p.width;
export const xFreq = (p: Plot, x: number) => FREQ_RANGE[0] * (FREQ_RANGE[1] / FREQ_RANGE[0]) ** clamp((x - p.left) / p.width, 0, 1);
export const t60Y = (p: Plot, t: number) => p.top + (1 - Math.log(clamp(t, T60_RANGE[0], T60_RANGE[1]) / T60_RANGE[0]) / Math.log(T60_RANGE[1] / T60_RANGE[0])) * p.height;
export const yT60 = (p: Plot, y: number) => T60_RANGE[0] * (T60_RANGE[1] / T60_RANGE[0]) ** clamp(1 - (y - p.top) / p.height, 0, 1);
export const dbY = (p: Plot, db: number) => p.top + p.height / 2 - (clamp(db, -POST_DB * 1.5, POST_DB * 1.5) / POST_DB) * (p.height / 2);
export const yDb = (p: Plot, y: number) => clamp(((p.top + p.height / 2 - y) / (p.height / 2)) * POST_DB, -POST_DB, POST_DB);

/** A band's dot: at its frequency, as high as the T60 it asks for there over the mode's curve. */
export function bandPoint(r: ReverbState, band: ReverbDecayBand, p: Plot) {
  return { x: freqX(p, band.frequency), y: t60Y(p, naturalT60(r, band.frequency) * band.multiplier) };
}

/** A band dragged to `y` at frequency `f`: its multiplier (what's drawn is seconds, what's kept a multiple of Decay). */
export const multiplierAt = (r: ReverbState, f: number, y: number, p: Plot) => clamp(yT60(p, y) / naturalT60(r, f), MULTIPLIER_RANGE[0], MULTIPLIER_RANGE[1]);

/** The band whose dot is under (x, y), nearest first (within `radius` px), or null. */
export function hitBand(r: ReverbState, p: Plot, x: number, y: number, radius = 9): number | null {
  let best: { id: number; d: number } | null = null;
  for (const band of r.bands) {
    const at = bandPoint(r, band, p);
    const d = Math.hypot(at.x - x, at.y - y);
    if (d <= radius && (!best || d < best.d)) best = { id: band.id, d };
  }
  return best?.id ?? null;
}

/** Whether (x, y) is on the decay curve (within `tolerance` px): a drag there moves Decay. */
export const onCurve = (t60: readonly number[], p: Plot, x: number, y: number, tolerance = 6) => Math.abs(t60Y(p, decayCurve(t60, xFreq(p, x))) - y) <= tolerance;

/** A band a double-click makes there: a shelf near either end, a bell between, a notch near the bottom. */
export function newBandAt(r: ReverbState, p: Plot, x: number, y: number): Omit<ReverbDecayBand, "id"> {
  const frequency = Math.round(xFreq(p, x));
  const shape: ReverbBandShape = y > p.top + 0.85 * p.height ? "notch" : frequency < 150 ? "lowShelf" : frequency > 6000 ? "highShelf" : "bell";
  return { enabled: true, shape, frequency, multiplier: shape === "notch" ? 0.5 : multiplierAt(r, frequency, y, p), q: shape === "notch" ? 4 : 1 };
}

/** The Post EQ's handles: the cuts at their corners (−3 dB), the shelves at half their gain. */
export type PostHandle = "lowCut" | "highCut" | "lowShelf" | "highShelf";
export function postHandles(r: ReverbState, p: Plot): { kind: PostHandle; x: number; y: number }[] {
  return [
    { kind: "lowCut", x: freqX(p, r.lowCut <= LOW_CUT_RANGE[0] + 0.5 ? FREQ_RANGE[0] : r.lowCut), y: dbY(p, -3) },
    { kind: "highCut", x: freqX(p, r.highCut >= HIGH_CUT_RANGE[1] - 1 ? FREQ_RANGE[1] : r.highCut), y: dbY(p, -3) },
    { kind: "lowShelf", x: freqX(p, r.output.lowShelf.frequency), y: dbY(p, r.output.lowShelf.gain / 2) },
    { kind: "highShelf", x: freqX(p, r.output.highShelf.frequency), y: dbY(p, r.output.highShelf.gain / 2) },
  ];
}
export function hitPost(r: ReverbState, p: Plot, x: number, y: number, radius = 7): PostHandle | null {
  let best: { kind: PostHandle; d: number } | null = null;
  for (const h of postHandles(r, p)) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= radius && (!best || d < best.d)) best = { kind: h.kind, d };
  }
  return best?.kind ?? null;
}

// ---------------------------------------------------------------------------
// The Shape display
// ---------------------------------------------------------------------------

/** The time it shows (s): 1.5 × Decay (3 s for ∞), at least 0.3 s, at most 30. */
export const shapeSpan = (r: ReverbState) => clamp(1.5 * (isInfinite(r.decay) ? 2 : r.decay), 0.3, 30);
/** Time across: linear, or log (spreading the early taps: Open AIR's toggle), from 1 ms. */
export function timeX(p: Plot, t: number, span: number, log = false): number {
  const f = log ? Math.log(1 + Math.max(0, t) * 1000) / Math.log(1 + span * 1000) : t / span;
  return p.left + clamp(f, 0, 1) * p.width;
}
export function xTime(p: Plot, x: number, span: number, log = false): number {
  const f = clamp((x - p.left) / p.width, 0, 1);
  return log ? (Math.exp(f * Math.log(1 + span * 1000)) - 1) / 1000 : f * span;
}
export const levelY = (p: Plot, db: number) => p.top + (clamp(db, SHAPE_FLOOR, 0) / SHAPE_FLOOR) * p.height;
