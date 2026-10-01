import { MAX_TEMPO, MIN_TEMPO } from "@shared/music/project";

/** A pause longer than this (ms) starts the taps again: it's a new go, not a slow beat. */
export const TAP_RESET_MS = 2000;
/** How many of the latest taps count: enough to even out the hand, few enough to follow a change. */
const TAPS_KEPT = 12;

/** The taps with one more at `now` (ms), the old ones dropped after a pause. */
export function addTap(taps: readonly number[], now: number): number[] {
  const last = taps.at(-1);
  if (last === undefined || now - last > TAP_RESET_MS || now <= last) return [now];
  return [...taps, now].slice(-TAPS_KEPT);
}

/**
 * The tempo the taps keep (beats per minute, to a tenth), or null before there are three. The beat is the
 * slope of a straight line through the taps (least squares), so one tap early or late moves it less
 * than an average of the gaps would, and a tempo outside a song's range is doubled or halved into it.
 */
export function tappedTempo(taps: readonly number[]): number | null {
  const n = taps.length;
  if (n < 3) return null;
  const meanIndex = (n - 1) / 2;
  const meanTime = taps.reduce((sum, t) => sum + t, 0) / n;
  let covariance = 0;
  let variance = 0;
  taps.forEach((t, i) => {
    covariance += (i - meanIndex) * (t - meanTime);
    variance += (i - meanIndex) ** 2;
  });
  const beatMs = covariance / variance;
  if (!(beatMs > 0)) return null;
  let bpm = 60_000 / beatMs;
  while (bpm > MAX_TEMPO) bpm /= 2;
  while (bpm < MIN_TEMPO) bpm *= 2;
  return Math.round(bpm * 10) / 10;
}
