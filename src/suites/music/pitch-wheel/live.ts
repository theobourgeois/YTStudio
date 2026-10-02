/**
 * What each Pitch Wheel is doing as it's heard (`EnginePitchWheelState`), from the engine's transport
 * events, kept outside React: the window reads it every frame, the assistant when it asks. The engine
 * only says it while something sounds; `freshWheel` is what it said lately enough to show.
 */
import type { EnginePitchWheelState } from "@shared/music/engine";

interface Heard {
  state: EnginePitchWheelState;
  /** `performance.now()` when it came. */
  at: number;
}

const heard = new Map<string, Heard>();

/** A transport event's Pitch Wheels (absent: none said anything). */
export function takePitchWheels(states: Record<string, EnginePitchWheelState> | undefined) {
  if (!states) return;
  const now = performance.now();
  for (const [id, state] of Object.entries(states)) heard.set(id, { state, at: now });
}

/** What a Pitch Wheel last said, however long ago (null: never). */
export const latestWheelState = (effectId: string): EnginePitchWheelState | null => heard.get(effectId)?.state ?? null;

/** How long what the engine said stands: a little more than two of its events (it says ~25 a second). */
export const FRESH_MS = 120;

/** What it said, if it's recent: the engine is running it now, sound going through. */
export function freshWheel(effectId: string, now = performance.now()): Heard | null {
  const last = heard.get(effectId);
  return last && now - last.at <= FRESH_MS ? last : null;
}
