/**
 * What each Pro-C did lately, as the engine says it (`EngineProCState`, about 25 times a second, each time
 * the points since the last), kept for its level display, meters and knee dot. Outside React, as
 * Auto-Tune's `pitch-history.ts`: the window's canvases read it every frame, so nothing re-renders as
 * points arrive.
 */
import type { EngineProCState } from "@shared/music/engine";

/** Seconds of points kept: more than the widest display shows. */
export const KEPT_SECONDS = 20;

export interface CompHistory {
  /** `[input, output, reduction]` dB, oldest first; the last is point number `last`. */
  points: [number, number, number][];
  last: number;
  step: number;
  /** When point `anchorN` was (`performance.now()` ms): points are timed from it, `step` apart, so the display scrolls evenly. */
  anchorN: number;
  anchorAt: number;
  /** What it said last (the meters, the ring, the knee dot), and when (ms). */
  latest: EngineProCState;
  at: number;
}

/** The new points added on (the oldest let go), timed from an anchor taken again when the clocks drift apart. Returns a new history. */
export function mergePoints(history: CompHistory | undefined, state: EngineProCState, now: number): CompHistory {
  const keep = Math.ceil(KEPT_SECONDS / Math.max(1e-3, state.step));
  const points = history && history.step === state.step ? history.points.concat(state.points) : state.points.slice();
  const kept = points.length > keep ? points.slice(points.length - keep) : points;
  const last = (history && history.step === state.step ? history.last : 0) + state.points.length;
  // The newest point arrived now. Kept while the engine's clock and ours agree (events come unevenly),
  // taken again when they drift apart (a pause, the engine restarted).
  let anchorN = history?.anchorN ?? last;
  let anchorAt = history?.anchorAt ?? now;
  const predicted = anchorAt + (last - anchorN) * state.step * 1000;
  if (!history || state.step !== history.step || Math.abs(predicted - now) > 150) {
    anchorN = last;
    anchorAt = now;
  }
  return { points: kept, last, step: state.step, anchorN, anchorAt, latest: state, at: now };
}

/** When point `n` was (`performance.now()` ms). */
export const pointAt = (history: CompHistory, n: number) => history.anchorAt + (n - history.anchorN) * history.step * 1000;

/** What it said last, if it's recent (within `within` ms): stopped, the meters fall to nothing. */
export const latestOf = (history: CompHistory | undefined, now: number, within = 300): EngineProCState | null => (history && now - history.at <= within ? history.latest : null);

const histories = new Map<string, CompHistory>();

/** The engine said what its Pro-Cs did (`EngineTransport.proCs`). */
export function takeProCs(states: Record<string, EngineProCState> | undefined, now = performance.now()) {
  if (!states) return;
  for (const [id, state] of Object.entries(states)) histories.set(id, mergePoints(histories.get(id), state, now));
}

export const compHistory = (effectId: string) => histories.get(effectId);
