/**
 * An automation clip's curve on screen (`docs/fl-studio/automation.md`): where its points and tension
 * handles are inside a clip on the Playlist (or the automation window's preview), which one is under the
 * pointer, and what a drag of one does. Pure, so it's tested; `draw-curve.ts` draws with it and the
 * Playlist's pointer edits with it.
 */
import { clamp } from "@shared/math";
import { curveAt } from "@shared/music/automation";
import type { AutomationPoint, CurveType } from "@shared/music/types";

/** Where a curve is drawn: its tick 0 at `x0`, `pxPerTick` across; its values from `top` (1) to `top + height` (0). */
export interface CurveBox {
  x0: number;
  pxPerTick: number;
  top: number;
  height: number;
}

/** Room kept above and below the curve inside its box, so a point at 0 or 1 can be grabbed whole. */
export const CURVE_PAD = 3;
/** How near (px) the pointer must be to grab a point or a tension handle. */
export const GRAB = 7;
/** A segment this narrow (px) or less shows no tension handle (there's no room to grab it). */
export const MIN_HANDLE_SEGMENT = 14;

export const curveX = (box: CurveBox, tick: number) => box.x0 + tick * box.pxPerTick;
export const curveTick = (box: CurveBox, x: number) => (x - box.x0) / box.pxPerTick;
export const curveY = (box: CurveBox, value: number) => box.top + CURVE_PAD + (1 - value) * Math.max(1, box.height - CURVE_PAD * 2);
export const curveValueAt = (box: CurveBox, y: number) => clamp(1 - (y - box.top - CURVE_PAD) / Math.max(1, box.height - CURVE_PAD * 2), 0, 1);

/** Where a segment's tension handle is: half-way along it in time, on the curve. Null for the first point (it ends no segment). */
export function tensionHandle(points: readonly AutomationPoint[], index: number, box: CurveBox): { x: number; y: number } | null {
  const to = points[index];
  const from = points[index - 1];
  if (!to || !from) return null;
  const x = curveX(box, (from.tick + to.tick) / 2);
  return { x, y: curveY(box, from.value + (to.value - from.value) * curveAt(to.curve, to.tension, 0.5)) };
}

export type CurveHit = { kind: "point"; index: number } | { kind: "tension"; index: number };

/**
 * The point or tension handle under `(x, y)`, if any, between `left` and `right` px (the clip's window
 * on the curve): the nearest point within `GRAB`, else the nearest handle. Points win over handles.
 */
export function hitCurve(points: readonly AutomationPoint[], box: CurveBox, x: number, y: number, left = -Infinity, right = Infinity): CurveHit | null {
  let best: CurveHit | null = null;
  let distance = GRAB;
  points.forEach((point, index) => {
    const px = curveX(box, point.tick);
    if (px < left - GRAB || px > right + GRAB) return;
    const d = Math.hypot(px - x, curveY(box, point.value) - y);
    // On a tie (points on one tick), the later: it's the one drawn on top.
    if (d <= distance) {
      distance = d;
      best = { kind: "point", index };
    }
  });
  if (best) return best;
  for (let index = 1; index < points.length; index++) {
    const width = (points[index].tick - points[index - 1].tick) * box.pxPerTick;
    if (width <= MIN_HANDLE_SEGMENT) continue;
    const handle = tensionHandle(points, index, box);
    if (!handle || handle.x < left || handle.x > right) continue;
    const d = Math.hypot(handle.x - x, handle.y - y);
    if (d <= distance) {
      distance = d;
      best = { kind: "tension", index };
    }
  }
  return best;
}

/** The curve types whose tension bends them (the rest: it sets how many steps or cycles they have). */
const BENDS: ReadonlySet<CurveType> = new Set(["single", "double", "altSingle", "altDouble", "halfSine", "smooth"]);

/** How far a drag of 100 px moves a tension (of its -1..1). */
const TENSION_PER_100PX = 1.25;

/**
 * A tension after its handle has been dragged `up` px (Ctrl: `fine`, a fifth as far): a bending curve's
 * handle follows the pointer (up is towards the higher of its two values' side of the line, whichever way
 * the segment goes); for stairs, pulses and waves, up is more steps or cycles.
 */
export function draggedTension(points: readonly AutomationPoint[], index: number, start: number, up: number, fine: boolean): number {
  const to = points[index];
  const from = points[index - 1];
  if (!to || !from) return start;
  const amount = (up / 100) * TENSION_PER_100PX * (fine ? 0.2 : 1);
  if (!BENDS.has(to.curve)) return clamp(start + amount, -1, 1);
  // Up raises the middle of the segment: a rising one starts faster (less tension), a falling one slower.
  const rising = to.value >= from.value;
  return clamp(start + (rising ? -amount : amount), -1, 1);
}
