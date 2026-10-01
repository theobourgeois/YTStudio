import { PPQ, STEP_TICKS } from "@shared/music/types";

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

/** A position in M:S:CS as FL Studio's toolbar shows it: minutes, seconds and hundredths from the start at `tempo`, e.g. "1:04:25". */
export function timeText(tick: number, tempo: number): string {
  const hundredths = Math.floor((Math.max(0, tick) / PPQ) * (60 / tempo) * 100 + 1e-6);
  const seconds = Math.floor(hundredths / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}:${String(hundredths % 100).padStart(2, "0")}`;
}

/** The tempo as FL Studio's LCD shows it, with three decimals: "140.000". */
export const tempoText = (tempo: number) => tempo.toFixed(3);

/** A display's text split before its last `separator`, where FL Studio draws the rest smaller: "1:01" ":00", "140" ".000". */
export function splitTail(text: string, separator: string): [string, string] {
  const at = text.lastIndexOf(separator);
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at)];
}
