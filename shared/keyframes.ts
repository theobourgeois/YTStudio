/**
 * Animated parameter values. A keyframed parameter stores its keyframes
 * (sorted by time, in source-media time so they stay on their frame when the
 * clip is moved, trimmed or split) and ignores its static value.
 *
 * Between two keyframes the value follows a curve set by how each is passed
 * through (`Easing`): an eased side leaves or reaches its keyframe with zero
 * speed, like Premiere's Ease In / Ease Out (a Bezier with 33% influence).
 * With that influence the curve is a plain cubic in time (`easedProgress`),
 * which the export can evaluate exactly too (e.g. in an ffmpeg expression).
 * A keyframe's `influence` stretches its eased handles further (After
 * Effects' keyframe velocity): at 90% the value hangs near the keyframes and
 * snaps across in between, the curve every "smooth" edit transition uses.
 */
import { isFiniteNumber, tidy } from "./math.ts";
import { type ParamSpec, isAnimatable, isPath, sameValue, sanitizeValue } from "./params.ts";
import { type ArcLengthTable, arcLengthTable, lerpPath, pointAtLength } from "./path.ts";
import type { Easing, Keyframe, ParamValue, Vec2 } from "./types.ts";

export const EASINGS: readonly Easing[] = ["linear", "ease-in", "ease-out", "ease", "hold"];

/** Keyframes closer than this (seconds) are the same keyframe. */
export const SAME_KEYFRAME = 1e-3;

/** An eased side's handle length when the keyframe doesn't say (Premiere's Ease In/Out). */
export const DEFAULT_INFLUENCE = 1 / 3;
export const MIN_INFLUENCE = 0.01;

/** A keyframe's influence (see `Keyframe.influence`). */
export const influenceOf = (k: Pick<Keyframe, "influence">) => k.influence ?? DEFAULT_INFLUENCE;

/** The keyframe is reached slowly. */
export const easesIn = (e: Easing) => e === "ease-in" || e === "ease";
/** The value leaves the keyframe slowly. */
export const easesOut = (e: Easing) => e === "ease-out" || e === "ease";

/** Valid, time-sorted keyframes for `spec` from untrusted storage (one per time; none when it can't animate). */
export function sanitizeKeyframes(spec: ParamSpec, raw: unknown): Keyframe[] {
  if (!isAnimatable(spec) || !Array.isArray(raw)) return [];
  const byTime = new Map<number, Keyframe>();
  for (const k of raw) {
    if (!k || typeof k !== "object" || !isFiniteNumber(k.time)) continue;
    const value = sanitizeValue(spec, k.value);
    if (value === undefined) continue;
    const time = tidy(k.time);
    const key: Keyframe = { time, value, easing: EASINGS.includes(k.easing) ? k.easing : "linear" };
    if (isFiniteNumber(k.influence) && Math.abs(k.influence - DEFAULT_INFLUENCE) > 1e-6) {
      key.influence = tidy(Math.min(1, Math.max(MIN_INFLUENCE, k.influence)));
    }
    const handleIn = sanitizeHandle(k.handleIn, "in");
    const handleOut = sanitizeHandle(k.handleOut, "out");
    if (handleIn) key.handleIn = handleIn;
    if (handleOut) key.handleOut = handleOut;
    if (spec.kind === "vec2") {
      const spatialIn = sanitizeSpatial(k.spatialIn);
      const spatialOut = sanitizeSpatial(k.spatialOut);
      if (spatialIn) key.spatialIn = spatialIn;
      if (spatialOut) key.spatialOut = spatialOut;
    }
    byTime.set(time, key);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** How far a handle's value may overshoot its segment (fractions of the change in value). */
export const MAX_OVERSHOOT = 10;

/**
 * A Bézier handle kept inside its segment's unit square in time (so the curve never turns
 * back in time) and within `MAX_OVERSHOOT` in value. `side` says which end it belongs to:
 * an out handle can't sit on its own keyframe's time, nor an in handle on its own.
 */
export function clampHandle([x, y]: Vec2, side: "in" | "out"): Vec2 {
  const cx = side === "out" ? Math.min(1, Math.max(MIN_INFLUENCE, x)) : Math.min(1 - MIN_INFLUENCE, Math.max(0, x));
  return [tidy(cx), tidy(Math.min(MAX_OVERSHOOT, Math.max(-MAX_OVERSHOOT, y)))];
}

/** How far a spatial handle may reach (in the value's units: many canvases). */
const MAX_SPATIAL = 20;

/** A spatial handle from storage (none when it's missing, invalid, or no handle at all: [0, 0]). */
export function sanitizeSpatial(raw: unknown): Vec2 | undefined {
  if (!Array.isArray(raw) || raw.length !== 2 || !isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) return undefined;
  const at = (v: number) => tidy(Math.min(MAX_SPATIAL, Math.max(-MAX_SPATIAL, v)));
  const handle: Vec2 = [at(raw[0]), at(raw[1])];
  return handle[0] === 0 && handle[1] === 0 ? undefined : handle;
}

function sanitizeHandle(raw: unknown, side: "in" | "out"): Vec2 | undefined {
  if (!Array.isArray(raw) || raw.length !== 2 || !isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) return undefined;
  return clampHandle([raw[0], raw[1]], side);
}

/** The keyframe at `time` (within `SAME_KEYFRAME`), if any. */
export function keyframeAt(keys: readonly Keyframe[], time: number): Keyframe | undefined {
  return keys.find((k) => Math.abs(k.time - time) < SAME_KEYFRAME);
}

/**
 * `keys` with a keyframe of `value` at `time`: one already there (within
 * `SAME_KEYFRAME`) keeps its time and easing. Same array when unchanged.
 */
export function setKeyframe(keys: Keyframe[], time: number, value: ParamValue): Keyframe[] {
  const at = keyframeAt(keys, time);
  if (at && sameValue(at.value, value)) return keys;
  const added: Keyframe = at ? { ...at, value } : { time: tidy(time), value, easing: "linear" };
  return [...keys.filter((k) => k !== at), added].sort((a, b) => a.time - b.time);
}

/**
 * How far the value has gone from `a` to `b` (0..1, more when it overshoots) at fraction
 * `f` of the time between them: a cubic Bézier from (0, 0) to (1, 1) with control points
 * (x1, y1) and (x2, y2), x being time. Where x is just `f` (the handles at a third and two
 * thirds of the time) no solving is needed; otherwise x is solved for `f` first.
 */
export function bezierProgress(f: number, x1: number, y1: number, x2: number, y2: number): number {
  const bezier = (s: number, p1: number, p2: number) => {
    const g = 1 - s;
    return 3 * g * g * s * p1 + 3 * g * s * s * p2 + s * s * s;
  };
  return bezier(solveBezierX(f, x1, x2), y1, y2);
}

/** The curve parameter where a unit Bézier's x (control points at `x1`, `x2`) is `f`. */
function solveBezierX(f: number, x1: number, x2: number): number {
  if (Math.abs(x1 - 1 / 3) <= 1e-9 && Math.abs(x2 - 2 / 3) <= 1e-9) return f;
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  // x(s) rises monotonically (handles stay inside 0..1): Newton, falling back to bisection.
  let s = f;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const g = 1 - s;
    const x = 3 * g * g * s * x1 + 3 * g * s * s * x2 + s * s * s - f;
    if (Math.abs(x) < 1e-9) break;
    if (x > 0) hi = s;
    else lo = s;
    const dx = 3 * g * g * x1 + 6 * g * s * (x2 - x1) + 3 * s * s * (1 - x2);
    const next = dx > 1e-6 ? s - x / dx : (lo + hi) / 2;
    s = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return s;
}

/**
 * The slope of a unit Bézier (dy/dx: progress per fraction of the time) at fraction `f`
 * of the time: the graph editor's speed, once scaled by the segment's change per second.
 */
export function bezierSlope(f: number, x1: number, y1: number, x2: number, y2: number): number {
  const s = solveBezierX(Math.min(1, Math.max(0, f)), x1, x2);
  const g = 1 - s;
  const d = (p1: number, p2: number) => 3 * g * g * p1 + 6 * g * s * (p2 - p1) + 3 * s * s * (1 - p2);
  const dx = d(x1, x2);
  const dy = d(y1, y2);
  if (Math.abs(dx) > 1e-9) return dy / dx;
  // The ends of a handle of zero length: the slope along the handle itself.
  if (s < 0.5) return x1 > 1e-9 ? y1 / x1 : 0;
  return 1 - x2 > 1e-9 ? (1 - y2) / (1 - x2) : 0;
}

/**
 * How far (0..1) the value has gone from `a` to `b` at fraction `f` of the
 * time between them, for keyframes eased or not (see `bezierProgress`): an
 * eased side is flat and its handle reaches `outInfluence` (leaving `a`) or
 * `inInfluence` (reaching `b`) of the way across; a linear side's handle
 * points straight along the line at a third.
 */
export function easedProgress(
  f: number,
  easeOut: boolean,
  easeIn: boolean,
  outInfluence = DEFAULT_INFLUENCE,
  inInfluence = DEFAULT_INFLUENCE,
): number {
  const [x1, y1] = easeOut ? [outInfluence, 0] : [1 / 3, 1 / 3];
  const [x2, y2] = easeIn ? [1 - inInfluence, 1] : [2 / 3, 2 / 3];
  return bezierProgress(f, x1, y1, x2, y2);
}

/**
 * The control points of the curve from keyframe `a` to `b` in their unit square: the
 * graph editor's handles where they're set, else what the easing says.
 */
export function segmentHandles(a: Keyframe, b: Keyframe): { out: Vec2; in: Vec2 } {
  const out: Vec2 = a.handleOut ?? (easesOut(a.easing) ? [influenceOf(a), 0] : [1 / 3, 1 / 3]);
  const into: Vec2 = b.handleIn ?? (easesIn(b.easing) ? [1 - influenceOf(b), 1] : [2 / 3, 2 / 3]);
  return { out, in: into };
}

/** A segment follows the plain eased (or linear) curve at 33% influence, a cubic in time. */
export const isPlainSegment = (a: Keyframe, b: Keyframe) =>
  a.influence === undefined && b.influence === undefined && !a.handleOut && !b.handleIn;

/** How far (0..1) the value has gone from keyframe `a` to `b` at fraction `f` of the time between them. */
export function segmentProgress(a: Keyframe, b: Keyframe, f: number): number {
  const h = segmentHandles(a, b);
  return bezierProgress(f, h.out[0], h.out[1], h.in[0], h.in[1]);
}

/** Spatial curves' lengths, measured once per pair of keyframes (keyframes are never changed in place). */
const curves = new WeakMap<Keyframe, { to: Keyframe; table: ArcLengthTable }>();

/**
 * The curve a point travels from keyframe `a` to `b` when either has a spatial handle on
 * that side (see `Keyframe.spatialIn`), measured by length; null when it's the straight line.
 */
export function spatialCurve(a: Keyframe, b: Keyframe): ArcLengthTable | null {
  if ((!a.spatialOut && !b.spatialIn) || !Array.isArray(a.value) || !Array.isArray(b.value)) return null;
  const kept = curves.get(a);
  if (kept?.to === b) return kept.table;
  const table = arcLengthTable(
    {
      vertices: [
        { point: a.value, in: [0, 0], out: a.spatialOut ?? [0, 0] },
        { point: b.value, in: b.spatialIn ?? [0, 0], out: [0, 0] },
      ],
      closed: false,
    },
    // Values are fractions of the canvas: far finer than a pixel.
    1e-5,
  );
  curves.set(a, { to: b, table });
  return table;
}

/** Where a point is `progress` of the way (by length; it may overshoot) along a spatial curve. */
function alongCurve(table: ArcLengthTable, progress: number): Vec2 {
  const at = pointAtLength(table, Math.min(1, Math.max(0, progress)) * table.total)!;
  if (progress >= 0 && progress <= 1) return at.point;
  // Past an end (an overshooting ease): straight on along the curve's direction there.
  const over = (progress > 1 ? progress - 1 : progress) * table.total;
  return [at.point[0] + at.tangent[0] * over, at.point[1] + at.tangent[1] * over];
}

function mix(a: ParamValue, b: ParamValue, f: number): ParamValue {
  if (isFiniteNumber(a) && isFiniteNumber(b)) return a + (b - a) * f;
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  // A path morphs, vertex by vertex.
  if (isPath(a) && isPath(b)) return f <= 0 ? a : f >= 1 ? b : lerpPath(a, b, f);
  return f < 1 ? a : b;
}

/**
 * How fast sorted keyframes' value changes at `time` (per second; for a point, the speed
 * along its path), the graph editor's speed graph. Zero outside them and on a hold.
 */
export function keyframeSpeed(keyframes: readonly Keyframe[], time: number): number {
  const next = keyframes.findIndex((k) => k.time > time);
  if (next <= 0) return 0;
  const a = keyframes[next - 1];
  const b = keyframes[next];
  if (a.easing === "hold") return 0;
  const dt = b.time - a.time;
  const curve = spatialCurve(a, b);
  const change = curve
    ? curve.total
    : isFiniteNumber(a.value) && isFiniteNumber(b.value)
      ? b.value - a.value
      : Array.isArray(a.value) && Array.isArray(b.value)
        ? Math.hypot(b.value[0] - a.value[0], b.value[1] - a.value[1])
        : 0;
  if (!(dt > 0)) return 0;
  const h = segmentHandles(a, b);
  return (change / dt) * bezierSlope((time - a.time) / dt, h.out[0], h.out[1], h.in[0], h.in[1]);
}

/** The value of sorted keyframes at `time`: held before the first and after the last. */
export function keyframeValue(keyframes: Keyframe[], time: number): ParamValue {
  const next = keyframes.findIndex((k) => k.time > time);
  if (next === 0) return keyframes[0].value;
  if (next === -1) return keyframes[keyframes.length - 1].value;
  const a = keyframes[next - 1];
  const b = keyframes[next];
  if (a.easing === "hold") return a.value;
  const f = (time - a.time) / (b.time - a.time);
  const curve = spatialCurve(a, b);
  if (curve) return alongCurve(curve, segmentProgress(a, b, f));
  return mix(a.value, b.value, segmentProgress(a, b, f));
}

/** How far a point travels from keyframe `a` to `b`: along its spatial curve, or straight (0 for anything but numbers and points). */
export function keyframeDistance(a: Keyframe, b: Keyframe): number {
  const curve = spatialCurve(a, b);
  if (curve) return curve.total;
  if (isFiniteNumber(a.value) && isFiniteNumber(b.value)) return Math.abs(b.value - a.value);
  if (Array.isArray(a.value) && Array.isArray(b.value)) return Math.hypot(b.value[0] - a.value[0], b.value[1] - a.value[1]);
  return 0;
}
