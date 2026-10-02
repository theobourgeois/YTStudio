/**
 * Rhythm Echo's grid (`docs/soundtoys/echoboy-manual.md`, Editing taps), as numbers: where a tap is drawn,
 * which one is under the pointer, where a click or drag puts one (on the grid, or off it), and what the
 * readouts say. Pure and tested.
 */
import { noteBeats } from "@shared/music/echo-boy-presets";
import type { EchoNote, RhythmTap } from "@shared/music/types";

export interface GridBox {
  width: number;
  height: number;
  /** The pattern's length (beats). */
  length: number;
}

/** Room at the top (a full tap's bar stops under it) and at the bottom (the beat numbers). */
export const TOP = 4;
export const BOTTOM = 12;
/** How near (px) a tap's bar must be to be the one under the pointer. */
const HIT = 5;
/** The left edge (px): a click there puts back the "One". */
export const EDGE = 4;

export const beatX = (box: GridBox, beat: number) => (beat / box.length) * box.width;
export const levelY = (box: GridBox, level: number) => TOP + (1 - level) * (box.height - TOP - BOTTOM);
export const xBeat = (box: GridBox, x: number) => Math.max(0, Math.min(box.length, (x / box.width) * box.length));
export const yLevel = (box: GridBox, y: number) => Math.max(0, Math.min(1, 1 - (y - TOP) / (box.height - TOP - BOTTOM)));

/** The tap whose bar is nearest the pointer (within a few px), or null. */
export function tapAt(box: GridBox, taps: readonly RhythmTap[], x: number): number | null {
  let best: number | null = null;
  let distance = HIT;
  taps.forEach((tap, i) => {
    const d = Math.abs(beatX(box, tap.beat) - x);
    if (d <= distance) (best = i), (distance = d);
  });
  return best;
}

/** A beat for the pointer: on the nearest grid line, or (`free`) where it is, to a thousandth of a beat; never at or past the end. */
export function placeBeat(box: GridBox, x: number, grid: EchoNote, free: boolean): number {
  const step = noteBeats(grid);
  const beat = xBeat(box, x);
  const placed = free ? Math.round(beat * 1000) / 1000 : Math.round(beat / step) * step;
  return Math.min(placed, Math.max(0, box.length - (free ? 0.001 : step)));
}

/** The grid's lines: each step of its note value (a beat's darker). */
export function gridLines(box: GridBox, grid: EchoNote): { x: number; beat: boolean }[] {
  const step = noteBeats(grid);
  const lines: { x: number; beat: boolean }[] = [];
  for (let i = 1; i * step < box.length - 1e-9 && lines.length < 512; i++) {
    const beat = i * step;
    lines.push({ x: beatX(box, beat), beat: Math.abs(beat - Math.round(beat)) < 1e-9 });
  }
  return lines;
}

/** A tap's readouts off the grid: where it is in beats ("2 3/16" or "1.437"), and its level in dB. */
export function tapReadout(tap: RhythmTap): { at: string; level: string } {
  const whole = Math.floor(tap.beat + 1e-9);
  const part = tap.beat - whole;
  const sixteenths = Math.round(part * 16);
  const at = Math.abs(part * 16 - sixteenths) < 1e-6 ? (sixteenths === 0 ? `${whole + 1}` : `${whole + 1} ${fraction(sixteenths)}`) : `${(tap.beat + 1).toFixed(3)}`;
  const db = tap.level > 0 ? 20 * Math.log10(tap.level) : -Infinity;
  return { at, level: Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-∞ dB" };
}

/** n/16, reduced ("1/4", "3/16"). */
function fraction(n: number): string {
  let d = 16;
  while (n % 2 === 0 && d > 1) (n /= 2), (d /= 2);
  return `${n}/${d}`;
}
