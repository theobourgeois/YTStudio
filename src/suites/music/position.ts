import { STEP_TICKS } from "@shared/music/types";

/**
 * A position as FL Studio's toolbar shows it in B:S:T: the bar and the step in it (both from 1), then the
 * ticks into the step (`STEP_TICKS` to a step), e.g. "3:05:12".
 */
export function positionText(tick: number, barSteps: number): string {
  const at = Math.max(0, Math.floor(tick));
  const barTicks = barSteps * STEP_TICKS;
  const bar = Math.floor(at / barTicks) + 1;
  const step = Math.floor((at % barTicks) / STEP_TICKS) + 1;
  return `${bar}:${String(step).padStart(2, "0")}:${String(at % STEP_TICKS).padStart(2, "0")}`;
}

/** Where a press along the song position slider puts play: the step under it, within the pattern. */
export function positionAt(fraction: number, patternTicks: number): number {
  const steps = Math.max(1, Math.round(patternTicks / STEP_TICKS));
  return Math.min(steps - 1, Math.max(0, Math.floor(fraction * steps))) * STEP_TICKS;
}
