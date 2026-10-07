/**
 * The Gradient tool's maths (pure, so it's tested): a drag's line constrained by Shift, and the live gradient's widget
 * on the canvas (docs/photo/tools/gradient.md, "The widget"): where its ends, colour stops and midpoints are on the
 * screen, what a press lands on, and the gradient after a stop or a midpoint is moved, added or pulled off.
 */
import type { DocPoint, Gradient, PhotoProject } from "@shared/photo/types";
import { addGradientStop, moveGradientStop, removeGradientStop } from "../layer-style/controls/geometry";

export interface Point {
  x: number;
  y: number;
}

/**
 * `end` turned about `start` to the nearest multiple of `step` degrees, its length kept (Shift: 45° while drawing,
 * 15° while an end is dragged). A line of no length stays as it is.
 */
export function constrainLine(start: DocPoint, end: DocPoint, step: number): DocPoint {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return end;
  const unit = (step * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / unit) * unit;
  const round = (v: number) => Math.round(v * 100) / 100;
  return [round(start[0] + Math.cos(a) * length), round(start[1] + Math.sin(a) * length)];
}

/** A screen point's place along the line from `a` to `b` (0 at `a`, 1 at `b`, unclamped) and its distance from it (px). */
export function alongLine(p: Point, a: Point, b: Point): { t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ll = dx * dx + dy * dy;
  if (ll === 0) return { t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / ll;
  return { t, distance: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(ll) };
}

/** Where a stop at `at` is drawn: from the start (Reverse runs the gradient from the end). */
export const shownAt = (at: number, reverse: boolean) => (reverse ? 1 - at : at);

/** Midpoints sit this many px beside the line (above it, as Photoshop's diamonds). */
export const MID_OFFSET = 12;
/** How far (px) from the line a dragged stop comes off. */
export const STOP_OFF = 24;

export interface WidgetLayout {
  start: Point;
  end: Point;
  /** Colour stops, by index, where they're drawn. */
  stops: { index: number; at: Point; colour: string }[];
  /** Midpoints, by the index of the stop they follow. */
  mids: { index: number; at: Point }[];
}

/** The widget on the screen for a line between screen points `start` and `end`. */
export function widgetLayout(gradient: Gradient, reverse: boolean, start: Point, end: Point): WidgetLayout {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  // The side "above" the line: its normal turned towards the screen's top (left for a vertical line).
  let nx = dy / length;
  let ny = -dx / length;
  if (ny > 0 || (ny === 0 && nx > 0)) [nx, ny] = [-nx, -ny];
  const on = (f: number): Point => ({ x: start.x + dx * f, y: start.y + dy * f });
  const stops = gradient.colours.map((s, index) => ({ index, at: on(shownAt(s.at, reverse)), colour: s.colour }));
  const mids = gradient.colours.slice(0, -1).flatMap((s, index) => {
    const next = gradient.colours[index + 1];
    if (next.at - s.at < 0.02) return [];
    const p = on(shownAt(s.at + (s.mid ?? 0.5) * (next.at - s.at), reverse));
    return [{ index, at: { x: p.x + nx * MID_OFFSET, y: p.y + ny * MID_OFFSET } }];
  });
  return { start, end, stops, mids };
}

/** Whether a stop at an end is that end's (drawn filled in its circle; dragging the circle moves the end). */
export const stopAtEnd = (at: number) => at <= 0 || at >= 1;

/** Stop `index` dragged to `t` along the shown line (Reverse taken back off), or pulled off it (`off`): the gradient, and the stop's index now (−1: gone). */
export function dragStop(g: Gradient, index: number, t: number, reverse: boolean, off: boolean): { gradient: Gradient; index: number } {
  if (off && g.colours.length > 2) return { gradient: removeGradientStop(g, "colour", index), index: -1 };
  return moveGradientStop(g, "colour", index, Math.max(0, Math.min(1, shownAt(t, reverse))));
}

/** A colour stop added at `t` along the shown line, in the gradient's colour there. */
export const addStopOnLine = (g: Gradient, t: number, reverse: boolean) => addGradientStop(g, "colour", Math.max(0, Math.min(1, shownAt(t, reverse))));

/** The midpoint after stop `index` dragged to `t` along the shown line: 5% to 95% of the way to the next stop. */
export function dragMid(g: Gradient, index: number, t: number, reverse: boolean): Gradient {
  const a = g.colours[index];
  const b = g.colours[index + 1];
  if (!a || !b || b.at <= a.at) return g;
  const mid = Math.round(Math.max(0.05, Math.min(0.95, (shownAt(t, reverse) - a.at) / (b.at - a.at))) * 100) / 100;
  const colours = g.colours.map((s, i) => {
    if (i !== index) return s;
    const { mid: _, ...rest } = s;
    return mid === 0.5 ? rest : { ...s, mid };
  });
  return { ...g, name: "Custom", colours };
}

/** A new Gradient Fill's name, Photoshop's: "Gradient Fill" and the next number. */
export function gradientFillName(doc: PhotoProject): string {
  let n = 1;
  for (const l of doc.layers) {
    const m = /^Gradient Fill (\d+)$/.exec(l.name);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `Gradient Fill ${n}`;
}
