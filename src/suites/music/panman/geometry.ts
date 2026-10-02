/**
 * PanMan's window maths (`docs/soundtoys/panman.md`): the editors' boxes (one bar shown at a time, R at the
 * top, L at the bottom), their grids, snapping and hit tests, and the meters' LEDs. Pure, tested.
 */
import { PAN_HARD, PAN_LIMIT } from "@shared/music/panman-presets";
import { type PanShapeEvent, type PanStepPoint, PPQ } from "@shared/music/types";

/** The editors' Grid menu, in beats. */
export const PAN_GRIDS: readonly { id: string; name: string; beats: number }[] = [
  { id: "1/4", name: "1/4th", beats: 1 },
  { id: "1/8", name: "1/8th", beats: 1 / 2 },
  { id: "1/16", name: "1/16th", beats: 1 / 4 },
  { id: "1/32", name: "1/32nd", beats: 1 / 8 },
  { id: "1/4t", name: "1/4 trip", beats: 2 / 3 },
  { id: "1/8t", name: "1/8 trip", beats: 1 / 3 },
  { id: "1/16t", name: "1/16 trip", beats: 1 / 6 },
];
export const gridTicks = (id: string) => (PAN_GRIDS.find((g) => g.id === id) ?? PAN_GRIDS[1]).beats * PPQ;

/** Where an editor draws: its area (px) and the bar it shows (its first tick, its length). */
export interface EditorBox {
  left: number;
  top: number;
  width: number;
  height: number;
  barStart: number;
  barTicks: number;
}

/** Room around the area: a little inside, the R / C / L letters on the right, the beat numbers under it. */
const PAD = 6;
const LETTERS = 16;
const NUMBERS = 14;

export function editorBox(width: number, height: number, barTicks: number, bar: number): EditorBox {
  return { left: PAD, top: PAD, width: Math.max(1, width - 2 * PAD - LETTERS), height: Math.max(1, height - PAD - NUMBERS), barStart: bar * barTicks, barTicks };
}

export const tickX = (box: EditorBox, tick: number) => box.left + ((tick - box.barStart) / box.barTicks) * box.width;
export const xTick = (box: EditorBox, x: number) => box.barStart + ((x - box.left) / box.width) * box.barTicks;
/** A position's height: R (1) at the top, L (-1) at the bottom. */
export const valueY = (box: EditorBox, value: number) => box.top + ((1 - value) / 2) * box.height;
export const yValue = (box: EditorBox, y: number) => Math.max(-1, Math.min(1, 1 - (2 * (y - box.top)) / box.height));

/** A tick on the grid (inside the bar shown); off it, a whole tick. */
export function snapTick(box: EditorBox, tick: number, grid: number, snap = true): number {
  const inside = Math.max(box.barStart, Math.min(box.barStart + box.barTicks - (snap ? grid : 1), tick));
  return snap ? box.barStart + Math.round((inside - box.barStart) / grid) * grid : Math.round(inside);
}

/** An event's end on the grid (or a whole tick), from the bar's start to its end. */
export function snapEdge(box: EditorBox, tick: number, grid: number, snap = true): number {
  const inside = Math.max(box.barStart, Math.min(box.barStart + box.barTicks, tick));
  return snap ? box.barStart + Math.round((inside - box.barStart) / grid) * grid : Math.round(inside);
}

/** The grid's lines across the bar shown: each beat stronger, the bar's start strongest. */
export function gridLines(box: EditorBox, grid: number): { tick: number; strength: "bar" | "beat" | "grid" }[] {
  const lines: { tick: number; strength: "bar" | "beat" | "grid" }[] = [];
  for (let k = 0; k * grid < box.barTicks - 1e-9 && k < 512; k++) {
    const tick = box.barStart + k * grid;
    const into = k * grid;
    lines.push({ tick, strength: into === 0 ? "bar" : Math.abs(into / PPQ - Math.round(into / PPQ)) < 1e-9 ? "beat" : "grid" });
  }
  return lines;
}

/** The point (index) under (x, y), within a few px, of those in the bar shown; -1 if none. */
export function hitPoint(points: readonly PanStepPoint[], box: EditorBox, x: number, y: number, radius = 6): number {
  let best = -1;
  let bestDistance = radius;
  points.forEach((p, i) => {
    if (p.tick < box.barStart || p.tick >= box.barStart + box.barTicks) return;
    const distance = Math.hypot(tickX(box, p.tick) - x, valueY(box, p.value) - y);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** The event under x, and which part: its start or end edge (within a few px), or its body. */
export function hitEvent(events: readonly PanShapeEvent[], box: EditorBox, x: number, edge = 5): { index: number; part: "start" | "end" | "body" } | null {
  for (let i = 0; i < events.length; i++) {
    const from = tickX(box, events[i].tick);
    const to = tickX(box, events[i].tick + events[i].length);
    if (x < from - edge || x > to + edge) continue;
    if (to - from > 3 * edge) {
      if (Math.abs(x - from) <= edge) return { index: i, part: "start" };
      if (Math.abs(x - to) <= edge) return { index: i, part: "end" };
    }
    if (x >= from && x <= to) return { index: i, part: "body" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/** The Pan Position Meter's LEDs: 29 across -105..105°, 7.5° apart, so two at each end are past hard left or right. */
export const METER_LEDS = 29;
export const ledDegrees = (index: number) => -PAN_LIMIT + (index * 2 * PAN_LIMIT) / (METER_LEDS - 1);
export const ledOf = (degrees: number) => Math.max(0, Math.min(METER_LEDS - 1, Math.round(((degrees + PAN_LIMIT) / (2 * PAN_LIMIT)) * (METER_LEDS - 1))));
/** Past the speakers: drawn yellow. */
export const isBeyond = (index: number) => Math.abs(ledDegrees(index)) > PAN_HARD + 1e-9;

/**
 * The LEDs lit now (brightness 0..1, as `previous` decays towards dark: they charge and discharge like
 * real LEDs, leaving trails): every one from `least` to `most` (where it's been since the last word) full.
 */
export function meterLeds(previous: readonly number[], least: number, most: number, decay: number): number[] {
  const [from, to] = [ledOf(Math.min(least, most)), ledOf(Math.max(least, most))];
  return Array.from({ length: METER_LEDS }, (_, i) => (i >= from && i <= to ? 1 : (previous[i] ?? 0) * decay));
}

/** Input and Output's five LEDs (three green, a yellow 6 dB under clipping, a red at it): how many a peak (linear) lights. */
export const IO_LEDS = [-30, -18, -12, -6, -0.1] as const;
export function ioLit(peak: number): number {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return IO_LEDS.filter((at) => db >= at).length;
}
