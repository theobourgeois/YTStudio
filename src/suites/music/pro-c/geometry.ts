/**
 * Pro-C's displays on screen (`docs/fabfilter/pro-c.md` 2.7): the level display (dB down from 0 at the top
 * to the meter scale at the bottom, the gain reduction hanging from the top on the same scale, time
 * scrolling right to left), the knee display over its left part (input across, output up, the same dB
 * scale), the meters, and the Vintage styles' knobs (Input, Peak Reduction, the units' time dials). Pure,
 * so it's tested; `draw.ts` draws with it.
 */
import { clamp } from "@shared/math";
import { PRO_C_RATIO_DOTS, PRO_C_SCALES, type VintageDial, dialOf, secondsOfDial, slopeOf } from "@shared/music/pro-c-presets";

/** How fast the level display scrolls (px a second): about six seconds across a window of the usual size. */
export const PX_PER_SECOND = 130;
/** The display is drawn this late (ms), so the newest points (which come in bursts) reach its right edge. */
export const DISPLAY_DELAY_MS = 60;

/** Where a level (dB) is on the display: 0 at `top`, the scale's bottom `height` px under it. */
export const dbY = (db: number, scale: number, top: number, height: number) => top + clamp(-db / scale, 0, 1) * height;
/** The level (dB) at `y`. */
export const yDb = (y: number, scale: number, top: number, height: number) => -((y - top) / height) * scale;
/** Where the gain reduction line is: hanging from the top, `gr` dB down on the same scale (a boost stays at the top). */
export const reductionY = (gr: number, scale: number, top: number, height: number) => top + clamp(gr / scale, 0, 1) * height;

/** The labelled steps of a scale, 0 first: every 1 dB at 9, 3 at 18 and 36, 6 at 54 and 72, 10 at 90. */
export function scaleSteps(scale: number): number[] {
  const step = scale <= 9 ? 1 : scale <= 36 ? 3 : scale <= 72 ? 6 : 10;
  const steps: number[] = [];
  for (let db = 0; db >= -scale - 1e-9; db -= step) steps.push(db);
  return steps;
}

/** The scale button's next scale (a click cycles them). */
export function nextScale(scale: number): number {
  const at = PRO_C_SCALES.indexOf(scale as (typeof PRO_C_SCALES)[number]);
  return PRO_C_SCALES[(at + 1) % PRO_C_SCALES.length];
}

/** Where a point `ageMs` old is across the level display, its newest at `right`. */
export const timeX = (ageMs: number, right: number) => right - (ageMs / 1000) * PX_PER_SECOND;

/** The knee display's width: square on the display's dB scale, at most half the display. */
export const kneeWidth = (plotHeight: number, displayWidth: number) => Math.max(0, Math.min(plotHeight, displayWidth * 0.5));
/** Where an input level (dB) is across the knee display: the scale's bottom at its left, 0 dB at its right. */
export const kneeX = (db: number, scale: number, width: number) => clamp(1 + db / scale, 0, 1) * width;
/** The input level (dB) at `x` across the knee display. */
export const kneeDb = (x: number, scale: number, width: number) => (x / width - 1) * scale;

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/** A level (linear, 1 full scale) in dB; silence is -120. */
export const linearDb = (v: number) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
/** How full a meter is for a level (dB) on the scale: empty at its bottom, full at 0 dB (and over). */
export const meterFraction = (db: number, scale: number) => clamp(1 + db / scale, 0, 1);
/** A peak readout: "−∞" for silence, else one decimal (Pro-C's "−15", "0.0"). */
export const peakText = (db: number) => (db <= -119 ? "−∞" : `${db > 0.05 ? "+" : db < -0.05 ? "−" : ""}${Math.abs(db).toFixed(1)}`);

/** Whether the key is near enough the threshold for the Threshold's ring to turn yellow (within 3 dB below it, or over). */
export const ringHot = (key: number, threshold: number) => key > threshold - 3;

// ---------------------------------------------------------------------------
// The knobs
// ---------------------------------------------------------------------------

/** Where the Ratio knob's dots are (fractions of its travel: it turns along the slope). */
export const RATIO_DOT_FRACTIONS = PRO_C_RATIO_DOTS.map((ratio) => ({ ratio, fraction: slopeOf(ratio) }));

/** A Vintage style's Input knob: 0..48 dB of drive into its fixed threshold (`threshold = -input`). */
export const VINTAGE_INPUT_MAX = 48;
export const inputOfThreshold = (threshold: number) => clamp(-threshold, 0, VINTAGE_INPUT_MAX);
export const thresholdOfInput = (input: number) => -clamp(input, 0, VINTAGE_INPUT_MAX);
/** Opto 2A's Peak Reduction, 0..100: the LA-2A's knob (`threshold = -0.4 × PR`). */
export const PEAK_REDUCTION_DB = 0.4;
export const peakReductionOf = (threshold: number) => clamp(-threshold / PEAK_REDUCTION_DB, 0, 100);
export const thresholdOfPeakReduction = (pr: number) => -PEAK_REDUCTION_DB * clamp(pr, 0, 100);

/** A time dial's knob position (0..1, its lowest number at the left, as the unit's knob turns) for a time, and back. */
export function dialFraction(dial: VintageDial, seconds: number): number {
  const lo = Math.min(dial.from, dial.to);
  const hi = Math.max(dial.from, dial.to);
  return clamp((dialOf(dial, seconds) - lo) / (hi - lo), 0, 1);
}
export function secondsAtDial(dial: VintageDial, fraction: number): number {
  const lo = Math.min(dial.from, dial.to);
  const hi = Math.max(dial.from, dial.to);
  return secondsOfDial(dial, lo + clamp(fraction, 0, 1) * (hi - lo));
}
/** The dial's number at a position ("3.5"). */
export function dialText(dial: VintageDial, fraction: number): string {
  const lo = Math.min(dial.from, dial.to);
  const hi = Math.max(dial.from, dial.to);
  const value = lo + clamp(fraction, 0, 1) * (hi - lo);
  return Math.abs(value - Math.round(value)) < 0.05 ? String(Math.round(value)) : value.toFixed(1);
}

/** A pan ring's dot: -1..1 as an angle (degrees from 12 o'clock), a quarter turn either way. */
export const panAngle = (pan: number) => clamp(pan, -1, 1) * 90;
/** A pan after the ring is dragged `dy` px up (Shift: fine). */
export const draggedPan = (start: number, dy: number, fine = false) => clamp(start + dy / (fine ? 1500 : 150), -1, 1);
