/**
 * A Pitch Wheel dial's maths (`docs/quikquak/pitchwheel.md`): the pointer sweeps 270°, 0 at the top,
 * the range's ends at half past seven and half past four; the actual pitch goes on round past them at
 * the same degrees per semitone (it can spin all the way round). Angles are degrees clockwise from 12
 * o'clock. Pure, so it's tested.
 */
import type { WheelRange } from "@shared/music/types";

/** How far the pointer sweeps, end to end. */
export const SWEEP = 270;

/** Degrees per semitone on a dial of this range. */
export const degreesPerSemitone = (range: WheelRange) => SWEEP / range;

/** Where a value is on the dial (degrees, clockwise from the top; past the ends for the actual pitch). */
export const angleOf = (value: number, range: WheelRange) => value * degreesPerSemitone(range);

/** A point `radius` from the centre at `degrees` (clockwise from the top). */
export function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const a = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
}

/** The pointer's direction from the centre (degrees clockwise from the top, -180..180). */
export const pointerAngle = (dx: number, dy: number) => (Math.atan2(dx, -dy) * 180) / Math.PI;

/** The shortest turn from one angle to another (-180..180), so a drag across the bottom doesn't jump. */
export function turn(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** A tick around the dial: its value, whether it's a long one, and its label (null: none). */
export interface Tick {
  value: number;
  major: boolean;
  label: string | null;
}

/** How a range is marked: labels every so many semitones, short ticks between (QuikQuak's change with the range too). */
const MARKS: Record<WheelRange, { label: number; minor: number }> = {
  2: { label: 0.5, minor: 0.1 },
  4: { label: 1, minor: 0.25 },
  6: { label: 1, minor: 0.25 },
  12: { label: 1, minor: 0.5 },
  24: { label: 1, minor: 0.5 },
  48: { label: 4, minor: 1 },
};

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export function ticks(range: WheelRange): Tick[] {
  const { label, minor } = MARKS[range];
  const half = range / 2;
  const out: Tick[] = [];
  const steps = Math.round(range / minor);
  for (let i = 0; i <= steps; i++) {
    const value = Math.round((-half + i * minor) * 1000) / 1000;
    const major = Math.abs(value / label - Math.round(value / label)) < 1e-6;
    out.push({ value, major, label: major ? signed(Number(value.toFixed(label < 1 ? 1 : 0))) : null });
  }
  return out;
}

/** The value a drag has turned the pointer to: `degrees` of turn from where it was (clamped to the range). */
export function turned(value: number, degrees: number, range: WheelRange, fine = false): number {
  const half = range / 2;
  return Math.max(-half, Math.min(half, value + (degrees / degreesPerSemitone(range)) * (fine ? 0.2 : 1)));
}

/** A value as the dial's display shows it: "+2.00", "-0.35", "0.00". */
export const readout = (value: number) => {
  const text = (Math.abs(value) < 0.005 ? 0 : value).toFixed(2);
  return value >= 0.005 ? `+${text}` : text;
};

/** What a scroll step moves the pointer by: a semitone when snapped (an octave when snapped to them), else a tenth. */
export const scrollStep = (snap: "off" | "semitone" | "octave", fine: boolean) => (snap === "octave" ? 12 : snap === "semitone" && !fine ? 1 : fine ? 0.01 : 0.1);

// ---------------------------------------------------------------------------
// The keyboard
// ---------------------------------------------------------------------------

const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (key: number) => BLACK.has(((key % 12) + 12) % 12);

/** A key of the keyboard: its note and where it's drawn. */
export interface KeyRect {
  key: number;
  black: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The keys from `low` to `high` (MIDI, whole octaves from a C) across `width`: white keys side by side, black ones over their joins. */
export function keyboardLayout(width: number, height: number, low: number, high: number): KeyRect[] {
  const whites: number[] = [];
  for (let key = low; key <= high; key++) if (!isBlack(key)) whites.push(key);
  const step = width / whites.length;
  const keys: KeyRect[] = [];
  const whiteX = new Map<number, number>();
  whites.forEach((key, i) => {
    whiteX.set(key, i * step);
    keys.push({ key, black: false, x: i * step, y: 0, width: step, height });
  });
  for (let key = low; key <= high; key++) {
    if (!isBlack(key)) continue;
    const left = whiteX.get(key - 1);
    if (left === undefined) continue;
    const w = step * 0.62;
    keys.push({ key, black: true, x: left + step - w / 2, y: 0, width: w, height: height * 0.6 });
  }
  return keys;
}

/** The key at a point: the black keys are over the white ones. */
export function keyAt(keys: readonly KeyRect[], x: number, y: number): number | null {
  const inside = (k: KeyRect) => x >= k.x && x < k.x + k.width && y >= k.y && y < k.y + k.height;
  return keys.find((k) => k.black && inside(k))?.key ?? keys.find((k) => !k.black && inside(k))?.key ?? null;
}
