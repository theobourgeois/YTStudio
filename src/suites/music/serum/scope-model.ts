/**
 * The Serum player's oscilloscope, its maths (pure, tested): the waveform held on its cycle, and the trace drawn
 * steady from one frame to the next. `scope-view.tsx` draws it.
 */

/**
 * `length` samples of `wave` starting on a rising zero crossing (the first one there's room after), so a steady
 * note's waveform stands still from one frame to the next, as an oscilloscope's trigger holds it.
 */
export function triggered(wave: readonly number[], length = 512): number[] {
  const last = Math.max(0, wave.length - length);
  let start = 0;
  for (let i = 1; i <= last; i++)
    if (wave[i - 1] < 0 && wave[i] >= 0) {
      start = i;
      break;
    }
  return wave.slice(start, start + length);
}

/** How fast the trace takes a new frame, and settles flat once nothing sounds (seconds: time constants). */
const TAKE = 0.03;
const SETTLE = 0.12;
/** The most a quiet sound is scaled up to fill the screen, and how slowly the scale follows the level. */
export const MOST_GAIN = 4;
const GAIN_TIME = 0.5;

/**
 * The trace and its scale after `dt` seconds: moved toward `wave` (null, nothing sounds: toward flat), and scaled so
 * its peak fills about the screen (a quiet pad as readable as a loud bass), never by more than `MOST_GAIN`, back to
 * 1 in silence. `shown` is changed in place (or made anew when `wave` is another length).
 */
export function steady(shown: Float32Array, gain: number, wave: readonly number[] | null, dt: number): { shown: Float32Array; gain: number } {
  const out = wave && wave.length !== shown.length ? new Float32Array(wave.length) : shown;
  const k = 1 - Math.exp(-dt / (wave ? TAKE : SETTLE));
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] += ((wave?.[i] ?? 0) - out[i]) * k;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const wanted = wave && peak > 1e-3 ? Math.min(MOST_GAIN, Math.max(1, 0.9 / peak)) : 1;
  return { shown: out, gain: gain + (wanted - gain) * (1 - Math.exp(-dt / GAIN_TIME)) };
}
