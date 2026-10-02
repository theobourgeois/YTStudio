/**
 * Gross Beat's mapping panel on screen (`docs/fl-studio/gross-beat.md`): where a bar's ticks and an
 * envelope's values are, the snap's grid, the guides (the safety line and the reverse guides) and what a
 * point says. Pure, so it's tested; `draw.ts` draws with it and `pointer.ts` edits with it.
 */
import { clamp } from "@shared/math";
import { type GrossKind, speedAt, speedText } from "@shared/music/gross-beat";
import { GROSS_DEPTH, GROSS_TICKS, offsetValue, valueOffset } from "@shared/music/gross-beat-presets";
import { type AutomationPoint, PPQ } from "@shared/music/types";
import type { CurveBox } from "../automation/curve-geometry";

/** The snap's choices, in beats (0 is X: none), as FL's strip lists them. */
export const GROSS_SNAPS = [0, 1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3] as const;
export type GrossSnap = (typeof GROSS_SNAPS)[number];
export const snapLabel = (snap: GrossSnap) => (snap === 0 ? "X" : `1/${Math.round(1 / snap)}`);

/** Room either side of the bar, so a point on its first or last tick can be grabbed whole. */
export const SIDE_PAD = 5;

/** Where the bar is drawn in a panel `width` by `height` px: tick 0 at the left, value 1 at the top. */
export function panelBox(width: number, height: number): CurveBox {
  return { x0: SIDE_PAD, pxPerTick: Math.max(0.01, (width - SIDE_PAD * 2) / GROSS_TICKS), top: 0, height };
}

/** A tick on the snap's grid (Alt, or X: to the tick). Within the bar. */
export function snapTick(tick: number, snap: GrossSnap, free: boolean): number {
  const step = free || snap === 0 ? 1 : snap * PPQ;
  return clamp(Math.round(tick / step) * step, 0, GROSS_TICKS);
}

/** A value on the snap's grid: a time envelope's offset in whole steps of it (a jump of exactly 1/8 beat); a volume as it is. */
export function snapValue(value: number, kind: GrossKind, snap: GrossSnap, free: boolean): number {
  if (kind === "volume" || free || snap === 0) return clamp(value, 0, 1);
  return clamp(offsetValue(Math.round(valueOffset(value) / snap) * snap), 0, 1);
}

/** The grid cell (ticks) a tick is in, for step editing: a snap's step, or a tick with X. */
export function stepCell(tick: number, snap: GrossSnap): { from: number; to: number } {
  const step = snap === 0 ? 1 : snap * PPQ;
  const from = clamp(Math.floor(tick / step) * step, 0, GROSS_TICKS - step);
  return { from, to: from + step };
}

/** The panel's vertical lines: each snap step (faint), each beat (stronger), in ticks. */
export function gridLines(snap: GrossSnap): { tick: number; beat: boolean }[] {
  const lines: { tick: number; beat: boolean }[] = [];
  const step = snap === 0 ? PPQ / 4 : snap * PPQ;
  for (let t = 0; t <= GROSS_TICKS + 1e-9; t += step) lines.push({ tick: Math.round(t * 1e6) / 1e6, beat: Math.abs(t / PPQ - Math.round(t / PPQ)) < 1e-9 });
  return lines;
}

/** A time envelope's horizontal lines: each beat back (labelled -1 .. -7), as values. */
export const beatRows = () => Array.from({ length: GROSS_DEPTH - 1 }, (_, i) => ({ beats: -(i + 1), value: offsetValue(-(i + 1)) }));

/**
 * The guides on a time envelope, as lines from tick to tick in values: the safety line (one beat back
 * per beat: a pause; below it, on the first bar, there's no sound yet) and the reverse guides (two beats
 * back per beat: normal speed backwards), one from each beat along the top.
 */
export function guides(): { safety: [number, number, number, number]; reverse: [number, number, number, number][] } {
  const at = (tick: number, beats: number) => [tick, offsetValue(beats)] as const;
  const reverse: [number, number, number, number][] = [];
  for (let beat = 0; beat < GROSS_TICKS / PPQ; beat++) {
    // From (beat, now) down two beats per beat, to the panel's bottom or the bar's end.
    const end = Math.min(beat + GROSS_DEPTH / 2, GROSS_TICKS / PPQ);
    reverse.push([...at(beat * PPQ, 0), ...at(end * PPQ, -(end - beat) * 2)]);
  }
  return { safety: [...at(0, 0), ...at(GROSS_TICKS, -GROSS_TICKS / PPQ)], reverse };
}

/** A tick of the bar said in beats ("2.25"), and a point's value as its envelope means it. */
export const beatText = (tick: number) => `${Math.round((tick / PPQ) * 1000) / 1000}`;
export function valueText(value: number, kind: GrossKind): string {
  if (kind === "volume") return `${Math.round(value * 100)}%`;
  const back = -valueOffset(value);
  return back < 1e-6 ? "now" : `${Math.round(back * 1000) / 1000} beat${Math.abs(back - 1) < 1e-6 ? "" : "s"} back`;
}

/** What the hint bar says of a point: where it is, its value and, on a time envelope, how fast it plays from there. */
export function pointHint(points: readonly AutomationPoint[], index: number, kind: GrossKind): string {
  const point = points[index];
  if (!point) return "";
  const where = `Beat ${beatText(point.tick)}: ${valueText(point.value, kind)}`;
  if (kind !== "time" || point.tick >= GROSS_TICKS) return where;
  return `${where}, then ${speedText(speedAt(points, point.tick))}`;
}
