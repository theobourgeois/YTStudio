/**
 * What each YT-L did lately, as the engine says it (`EngineProLState`, about 25 times a second, each time the
 * display's columns since the last), kept for its display and meters. Outside React, as Pro-C's `history.ts`:
 * the window's canvases read it every frame, so nothing re-renders as columns arrive.
 */
import type { EngineProLState } from "@shared/music/engine";

/** Seconds of columns kept: what Infinite shows at most. */
export const KEPT_SECONDS = 120;

/** A column: `[input, output, clip, limiter, momentary, shortTerm]` (peaks dBFS, reductions dB, loudness LUFS). */
export type LimColumn = EngineProLState["columns"][number];

export interface LimHistory {
  /** Oldest first; the last is column number `last`. */
  columns: LimColumn[];
  last: number;
  step: number;
  /** When column `anchorN` was (`performance.now()` ms): columns are timed from it, `step` apart, so the display scrolls evenly. */
  anchorN: number;
  anchorAt: number;
  /** What it said last (the meters), and when (ms). */
  latest: EngineProLState;
  at: number;
}

/** The new columns added on (the oldest let go), timed from an anchor taken again when the clocks drift apart. Returns a new history. */
export function mergeColumns(history: LimHistory | undefined, state: EngineProLState, now: number): LimHistory {
  const keep = Math.ceil(KEPT_SECONDS / Math.max(1e-3, state.step));
  const same = !!history && history.step === state.step;
  const columns = same ? history.columns.concat(state.columns) : state.columns.slice();
  const kept = columns.length > keep ? columns.slice(columns.length - keep) : columns;
  const last = (same ? history.last : 0) + state.columns.length;
  let anchorN = history?.anchorN ?? last;
  let anchorAt = history?.anchorAt ?? now;
  const predicted = anchorAt + (last - anchorN) * state.step * 1000;
  if (!same || Math.abs(predicted - now) > 150) {
    anchorN = last;
    anchorAt = now;
  }
  return { columns: kept, last, step: state.step, anchorN, anchorAt, latest: state, at: now };
}

/** When column `n` was (`performance.now()` ms). */
export const columnAt = (history: LimHistory, n: number) => history.anchorAt + (n - history.anchorN) * history.step * 1000;

/** What it said last, if it's recent (within `within` ms): stopped, the meters fall to nothing. */
export const latestOf = (history: LimHistory | undefined, now: number, within = 300): EngineProLState | null => (history && now - history.at <= within ? history.latest : null);

const histories = new Map<string, LimHistory>();
/** What the meters last read, whether or not it's recent (the loudness readings stay while stopped). */
const readings = new Map<string, EngineProLState>();

/** The engine said what its YT-Ls did (`EngineTransport.limiters`). */
export function takeLimiters(states: Record<string, EngineProLState> | undefined, now = performance.now()) {
  if (!states) return;
  for (const [id, state] of Object.entries(states)) {
    readings.set(id, state);
    if (state.columns?.length) histories.set(id, mergeColumns(histories.get(id), state, now));
    else {
      const history = histories.get(id);
      if (history) histories.set(id, { ...history, latest: state, at: now });
    }
  }
}

export const limHistory = (effectId: string) => histories.get(effectId);
export const limReading = (effectId: string) => readings.get(effectId) ?? null;

/** The display starts again (the meter's reset: Slow Down and Infinite fill from empty). */
export function clearLimHistory(effectId: string) {
  const history = histories.get(effectId);
  if (history) histories.set(effectId, { ...history, columns: [] });
}
