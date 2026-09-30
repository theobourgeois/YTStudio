/**
 * Pure maths of the graph editor (After Effects' Value and Speed Graphs): where a
 * property's keyframes and their Bézier handles are drawn, and which handle a drag
 * makes. Times here are source times (the keyframes' own clock) and values are stored
 * values; the component converts both to px.
 *
 * A segment's curve lives in its unit square (`Keyframe.handleOut`/`handleIn`): x is the
 * fraction of its time, y of its change. In the value graph a handle is drawn where that
 * puts it in (time, value); in the speed graph it's drawn at the speed it gives its
 * keyframe (the slope along it), as far out in time as its influence reaches.
 */
import { MIN_INFLUENCE, isDynamicSegment, segmentHandles } from "@shared/keyframes";
import type { Keyframe, ParamValue, Vec2 } from "@shared/types";

export type Side = "in" | "out";

/** How much a segment's value changes: signed for a number, the distance travelled for a point. */
export function segmentChange(a: ParamValue, b: ParamValue): number {
  if (typeof a === "number" && typeof b === "number") return b - a;
  if (Array.isArray(a) && Array.isArray(b)) return Math.hypot(b[0] - a[0], b[1] - a[1]);
  return 0;
}

/** A handle as a point: time and (value graph) value or (speed graph) speed. */
export interface GraphPoint {
  time: number;
  y: number;
}

/**
 * The segment a keyframe's handle on `side` belongs to: the one after it (out) or before
 * it (in), as [a, b]. Null at the ends, or leaving a hold.
 */
export function handleSegment(keys: readonly Keyframe[], index: number, side: Side): [Keyframe, Keyframe] | null {
  const [a, b] = side === "out" ? [keys[index], keys[index + 1]] : [keys[index - 1], keys[index]];
  if (!a || !b || a.easing === "hold" || !(b.time > a.time)) return null;
  // A spring or a bounce isn't a Bézier curve: there are no handles to show for it.
  if (isDynamicSegment(a, b)) return null;
  return [a, b];
}

/** The value graph's handle point of the segment from `a` to `b` (numbers only). */
export function valueHandle(a: Keyframe, b: Keyframe, side: Side): GraphPoint {
  const h = segmentHandles(a, b)[side];
  const dv = (b.value as number) - (a.value as number);
  return { time: a.time + h[0] * (b.time - a.time), y: (a.value as number) + h[1] * dv };
}

/**
 * The handle a drag in the value graph to (`time`, `value`) makes, in its segment's unit
 * square; null when the segment doesn't change value (then only its speed can be shaped).
 */
export function handleFromValue(a: Keyframe, b: Keyframe, time: number, value: number): Vec2 | null {
  const dv = (b.value as number) - (a.value as number);
  if (Math.abs(dv) < 1e-12) return null;
  return [(time - a.time) / (b.time - a.time), (value - (a.value as number)) / dv];
}

/** The speed (value per source second) a keyframe leaves (`out`) or reaches (`in`) its segment at. */
export function handleSpeed(a: Keyframe, b: Keyframe, side: Side): number {
  const h = segmentHandles(a, b)[side];
  const rate = segmentChange(a.value, b.value) / (b.time - a.time);
  if (side === "out") return h[0] > 1e-9 ? (h[1] / h[0]) * rate : 0;
  return 1 - h[0] > 1e-9 ? ((1 - h[1]) / (1 - h[0])) * rate : 0;
}

/** The speed graph's handle point: at its keyframe's speed, as far along as its influence. */
export function speedHandle(a: Keyframe, b: Keyframe, side: Side): GraphPoint {
  const h = segmentHandles(a, b)[side];
  return { time: a.time + h[0] * (b.time - a.time), y: handleSpeed(a, b, side) };
}

/**
 * The handle a drag in the speed graph makes: its influence from how far along the drag is
 * (`time`), its slope from the speed. Null when the segment doesn't change value.
 */
export function handleFromSpeed(a: Keyframe, b: Keyframe, side: Side, time: number, speed: number): Vec2 | null {
  const dt = b.time - a.time;
  const change = segmentChange(a.value, b.value);
  if (Math.abs(change) < 1e-12 || !(dt > 0)) return null;
  const x = Math.min(1, Math.max(0, (time - a.time) / dt));
  if (side === "out") {
    const reach = Math.max(MIN_INFLUENCE, x);
    return [reach, (speed * reach * dt) / change];
  }
  const reach = Math.max(MIN_INFLUENCE, 1 - x);
  return [1 - reach, 1 - (speed * reach * dt) / change];
}

/**
 * The other side of a keyframe with the same speed (After Effects' continuous Bézier: both
 * handles in line), keeping that side's influence. Null when it can't be (no segment there,
 * or one that doesn't change).
 */
export function matchingHandle(keys: readonly Keyframe[], index: number, side: Side, speed: number): Vec2 | null {
  const segment = handleSegment(keys, index, side);
  if (!segment) return null;
  const [a, b] = segment;
  const h = segmentHandles(a, b)[side];
  return handleFromSpeed(a, b, side, a.time + h[0] * (b.time - a.time), speed);
}

/** The speed a value-graph handle point gives its keyframe (value per source second). */
export function speedOfValuePoint(keyframe: Keyframe, point: GraphPoint): number {
  const dt = point.time - keyframe.time;
  return Math.abs(dt) > 1e-12 ? (point.y - (keyframe.value as number)) / dt : 0;
}

/** The lowest and highest of `values`, padded so the curve never touches the graph's edges. */
export function graphRange(values: readonly number[], pad = 0.12): { min: number; max: number } {
  const finite = values.filter(Number.isFinite);
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 1;
  if (max - min < 1e-9) {
    const half = Math.max(Math.abs(max) * 0.1, 1e-3);
    min -= half;
    max += half;
  }
  const margin = (max - min) * pad;
  return { min: min - margin, max: max + margin };
}
