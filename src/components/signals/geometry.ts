/**
 * The Signals window's and the signal lanes' maths (pure, tested): the spectrum's log frequency axis
 * and a range dragged on it, and hits on the timeline (which are in view, snapped to beats, moved).
 */
import type { SignalEvent } from "@shared/types";

export const LOW_HZ = 20;
export const HIGH_HZ = 20_000;
const SPAN = Math.log(HIGH_HZ / LOW_HZ);

/** Where a frequency is on a spectrum `width` px wide (log, 20 Hz at 0). */
export const hzToX = (hz: number, width: number) => (Math.log(Math.min(HIGH_HZ, Math.max(LOW_HZ, hz)) / LOW_HZ) / SPAN) * width;
/** The frequency at `x` px of a spectrum `width` px wide. */
export const xToHz = (x: number, width: number) => LOW_HZ * Math.exp((Math.min(width, Math.max(0, x)) / Math.max(1, width)) * SPAN);

/** A frequency to two significant figures (37 Hz, 120 Hz, 2,500 Hz), as a person would set it. */
export function roundHz(hz: number): number {
  const power = 10 ** Math.max(0, Math.floor(Math.log10(hz)) - 1);
  return Math.round(hz / power) * power;
}

/** The band a drag between two points of the spectrum makes: rounded, at least a tenth of an octave wide. */
export function rangeFromDrag(xa: number, xb: number, width: number): { low: number; high: number } {
  let low = roundHz(xToHz(Math.min(xa, xb), width));
  let high = roundHz(xToHz(Math.max(xa, xb), width));
  if (high < low * 1.07) {
    const mid = Math.sqrt(low * high);
    [low, high] = [roundHz(mid / 1.035), roundHz(mid * 1.035)];
    if (high <= low) high = low + 1;
  }
  return { low: Math.max(LOW_HZ, low), high: Math.min(HIGH_HZ, high) };
}

/** `1.2 kHz`, `80 Hz`. */
export const formatHz = (hz: number) => (hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${Math.round(hz)} Hz`);

/** The index of the first of sorted `times` at or after `t`. */
function firstFrom(times: readonly { time: number }[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The indices of the hits between two times (a timeline's visible window), in order. */
export function eventsBetween(events: readonly SignalEvent[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = firstFrom(events, from); i < events.length && events[i].time <= to; i++) out.push(i);
  return out;
}

/** `t` moved onto the nearest of `beats` when one is within `reach` seconds. */
export function snapToBeats(t: number, beats: readonly number[], reach: number): number {
  let best = t;
  let distance = reach;
  for (const b of beats) {
    const d = Math.abs(b - t);
    if (d <= distance) {
      best = b;
      distance = d;
    }
  }
  return best;
}

/** Hits with some of them (by index) moved by `delta` seconds (none before 0), sorted again. */
export function moveEvents(events: readonly SignalEvent[], indices: ReadonlySet<number>, delta: number): SignalEvent[] {
  return events.map((e, i) => (indices.has(i) ? { ...e, time: Math.max(0, Math.round((e.time + delta) * 1e6) / 1e6) } : e)).sort((a, b) => a.time - b.time);
}

/** Hits without some of them (by index). */
export const removeEvents = (events: readonly SignalEvent[], indices: ReadonlySet<number>) => events.filter((_, i) => !indices.has(i));

/** Hits with one more at `time` (none twice within a millisecond). */
export function addEvent(events: readonly SignalEvent[], time: number, velocity = 1): SignalEvent[] {
  const t = Math.max(0, Math.round(time * 1e6) / 1e6);
  if (events.some((e) => Math.abs(e.time - t) < 0.001)) return [...events];
  return [...events, { time: t, velocity }].sort((a, b) => a.time - b.time);
}

/** Hits snapped to `divisions` of each beat (beats sorted; nothing moves without two of them). */
export function quantizeEvents(events: readonly SignalEvent[], beats: readonly number[], divisions: number): SignalEvent[] {
  if (beats.length < 2) return [...events];
  const grid: number[] = [];
  for (let i = 0; i + 1 < beats.length; i++) for (let k = 0; k < divisions; k++) grid.push(beats[i] + ((beats[i + 1] - beats[i]) * k) / divisions);
  grid.push(beats.at(-1)!);
  const seen = new Set<number>();
  const out: SignalEvent[] = [];
  for (const e of events) {
    const time = Math.round(snapToBeats(e.time, grid, Infinity) * 1e6) / 1e6;
    if (seen.has(time)) continue;
    seen.add(time);
    out.push({ ...e, time });
  }
  return out.sort((a, b) => a.time - b.time);
}
