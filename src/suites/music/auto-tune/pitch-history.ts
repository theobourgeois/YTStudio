/**
 * What each Auto-Tune heard and played lately, as the engine says it (`EngineAutoTuneState`, about 25
 * times a second, each time its last readings), kept for its window's pitch graph and meter. Outside
 * React: the window's canvas reads it every frame, so nothing re-renders as readings arrive.
 */
import type { EngineAutoTuneState } from "@shared/music/engine";

/** Seconds of readings kept: what the graph can show at its widest. */
export const KEPT_SECONDS = 12;

export interface PitchReading {
  /** Its number (in order, `step` seconds apart). */
  n: number;
  /** MIDI notes (fractions are cents); -1 where there was no pitch. */
  sung: number;
  tuned: number;
  target: number;
}

export interface PitchHistory {
  /** In order of `n`, oldest first. */
  readings: PitchReading[];
  step: number;
  latency: number;
  /** When reading `anchorN` was (`performance.now()` ms): readings are timed from it, `step` apart, so the graph scrolls evenly. */
  anchorN: number;
  anchorAt: number;
}

/** Readings said again by the next event are left out; ones too old to show go. Returns a new history. */
export function mergeReadings(history: PitchHistory | undefined, state: EngineAutoTuneState, now: number): PitchHistory {
  const readings = history?.readings.slice() ?? [];
  const newest = readings.length ? readings[readings.length - 1].n : -Infinity;
  for (const [n, sung, tuned, target] of state.points) if (n > newest) readings.push({ n, sung, tuned, target });
  const last = readings.length ? readings[readings.length - 1].n : 0;
  const keep = Math.ceil(KEPT_SECONDS / Math.max(1e-3, state.step));
  const from = readings.findIndex((r) => r.n > last - keep);
  const kept = from > 0 ? readings.slice(from) : readings;
  // Timed from an anchor: the newest reading arrived now. Kept while the engine's clock and ours agree
  // (events come unevenly), taken again when they drift apart (a pause, the engine restarted).
  let anchorN = history?.anchorN ?? last;
  let anchorAt = history?.anchorAt ?? now;
  const predicted = anchorAt + (last - anchorN) * state.step * 1000;
  if (!history || state.step !== history.step || Math.abs(predicted - now) > 150 || last < anchorN) {
    anchorN = last;
    anchorAt = now;
  }
  return { readings: kept, step: state.step, latency: state.latency, anchorN, anchorAt };
}

/** When a reading was (`performance.now()` ms). */
export const readingAt = (history: PitchHistory, n: number) => history.anchorAt + (n - history.anchorN) * history.step * 1000;

/** The newest reading with a pitch, if it's recent (within `within` ms of `now`). */
export function latestPitch(history: PitchHistory | undefined, now: number, within = 250): PitchReading | null {
  if (!history) return null;
  for (let i = history.readings.length - 1; i >= 0; i--) {
    const r = history.readings[i];
    if (now - readingAt(history, r.n) > within) return null;
    if (r.sung >= 0) return r;
  }
  return null;
}

const histories = new Map<string, PitchHistory>();

/** The engine said what its Auto-Tunes heard (`EngineTransport.autoTunes`). */
export function takeAutoTunes(states: Record<string, EngineAutoTuneState> | undefined, now = performance.now()) {
  if (!states) return;
  for (const [id, state] of Object.entries(states)) histories.set(id, mergeReadings(histories.get(id), state, now));
}

export const pitchHistory = (effectId: string) => histories.get(effectId);
