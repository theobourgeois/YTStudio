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
import { type ParamSpec, isAnimatable, sameValue, sanitizeValue } from "./params.ts";
import type { Easing, Keyframe, ParamValue } from "./types.ts";

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
    byTime.set(time, key);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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
  const added: Keyframe = { time: at?.time ?? tidy(time), value, easing: at?.easing ?? "linear" };
  if (at?.influence !== undefined) added.influence = at.influence;
  return [...keys.filter((k) => k !== at), added].sort((a, b) => a.time - b.time);
}

/**
 * How far (0..1) the value has gone from `a` to `b` at fraction `f` of the
 * time between them: a cubic Bezier from (0, 0) to (1, 1), flat on an eased
 * side, whose handles reach `outInfluence` (leaving `a`) and `inInfluence`
 * (reaching `b`) of the way across. A linear side's handle points straight
 * along the line at a third. At 33% influence x is just `f`, so no solving is
 * needed; otherwise the curve's x is solved for `f` first.
 */
export function easedProgress(
  f: number,
  easeOut: boolean,
  easeIn: boolean,
  outInfluence = DEFAULT_INFLUENCE,
  inInfluence = DEFAULT_INFLUENCE,
): number {
  const x1 = easeOut ? outInfluence : 1 / 3;
  const y1 = easeOut ? 0 : 1 / 3;
  const x2 = easeIn ? 1 - inInfluence : 2 / 3;
  const y2 = easeIn ? 1 : 2 / 3;
  const bezier = (s: number, p1: number, p2: number) => {
    const g = 1 - s;
    return 3 * g * g * s * p1 + 3 * g * s * s * p2 + s * s * s;
  };
  let s = f;
  if (Math.abs(x1 - 1 / 3) > 1e-9 || Math.abs(x2 - 2 / 3) > 1e-9) {
    if (f <= 0) return 0;
    if (f >= 1) return 1;
    // x(s) rises monotonically (handles stay inside 0..1): Newton, falling back to bisection.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const x = bezier(s, x1, x2) - f;
      if (Math.abs(x) < 1e-7) break;
      if (x > 0) hi = s;
      else lo = s;
      const g = 1 - s;
      const dx = 3 * g * g * x1 + 6 * g * s * (x2 - x1) + 3 * s * s * (1 - x2);
      const next = dx > 1e-6 ? s - x / dx : (lo + hi) / 2;
      s = next > lo && next < hi ? next : (lo + hi) / 2;
    }
  }
  return bezier(s, y1, y2);
}

/** How far (0..1) the value has gone from keyframe `a` to `b` at fraction `f` of the time between them. */
export function segmentProgress(a: Keyframe, b: Keyframe, f: number): number {
  return easedProgress(f, easesOut(a.easing), easesIn(b.easing), influenceOf(a), influenceOf(b));
}

function mix(a: ParamValue, b: ParamValue, f: number): ParamValue {
  if (isFiniteNumber(a) && isFiniteNumber(b)) return a + (b - a) * f;
  if (Array.isArray(a) && Array.isArray(b)) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  return f < 1 ? a : b;
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
  return mix(a.value, b.value, segmentProgress(a, b, f));
}
