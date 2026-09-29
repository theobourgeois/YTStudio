/**
 * Animated parameter values. A keyframed parameter stores its keyframes
 * (sorted by time, in source-media time so they stay on their frame when the
 * clip is moved, trimmed or split) and ignores its static value.
 */
import { isFiniteNumber, tidy } from "./math.ts";
import { type ParamSpec, isAnimatable, sameValue, sanitizeValue } from "./params.ts";
import type { Easing, Keyframe, ParamValue } from "./types.ts";

export const EASINGS: readonly Easing[] = ["linear", "ease", "hold"];

/** Valid, time-sorted keyframes for `spec` from untrusted storage (one per time; none when it can't animate). */
export function sanitizeKeyframes(spec: ParamSpec, raw: unknown): Keyframe[] {
  if (!isAnimatable(spec) || !Array.isArray(raw)) return [];
  const byTime = new Map<number, Keyframe>();
  for (const k of raw) {
    if (!k || typeof k !== "object" || !isFiniteNumber(k.time)) continue;
    const value = sanitizeValue(spec, k.value);
    if (value === undefined) continue;
    const time = tidy(k.time);
    byTime.set(time, { time, value, easing: EASINGS.includes(k.easing) ? k.easing : "linear" });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** `keys` with a keyframe of `value` at `time` (replacing one there, keeping its easing). Same array when unchanged. */
export function setKeyframe(keys: Keyframe[], time: number, value: ParamValue): Keyframe[] {
  const t = tidy(time);
  const at = keys.find((k) => k.time === t);
  if (at && sameValue(at.value, value)) return keys;
  const added: Keyframe = { time: t, value, easing: at?.easing ?? "linear" };
  return [...keys.filter((k) => k.time !== t), added].sort((a, b) => a.time - b.time);
}

const smooth = (f: number) => f * f * (3 - 2 * f);

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
  return mix(a.value, b.value, a.easing === "ease" ? smooth(f) : f);
}
