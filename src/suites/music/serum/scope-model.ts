/**
 * The Serum player's display, its maths (pure, tested): the spectrum as a line, the waveform held on its cycle, the
 * trace drawn steady from one frame to the next. `scope-view.tsx` draws them.
 */

/** The engine's spectrum: 480 points log-spaced from 10 Hz to 30 kHz (`eq::SpectrumGrid`). */
const POINTS = 480;
/** What the spectrum view shows: 20 Hz to 20 kHz, in this many steps, `FLOOR` dB under full scale at the bottom. */
export const SPECTRUM_LOW = 20;
export const SPECTRUM_HIGH = 20_000;
export const SPECTRUM_BINS = 160;
const FLOOR = 84;
/** Music falls about this much an octave: tilted level about 1 kHz (as Pro-Q's analyzer is), so the highs read. */
const TILT = 4.5;

/** Where `hz` is across the spectrum view, 0 to 1. */
export const spectrumX = (hz: number) => Math.log(hz / SPECTRUM_LOW) / Math.log(SPECTRUM_HIGH / SPECTRUM_LOW);

/** The engine's spectrum (dB) as `bins` heights from 0 (the floor) to 1 (full scale), tilted level. */
export function spectrumHeights(db: readonly number[], bins = SPECTRUM_BINS): Float32Array {
  const out = new Float32Array(bins);
  if (!db.length) return out;
  for (let b = 0; b < bins; b++) {
    const hz = SPECTRUM_LOW * (SPECTRUM_HIGH / SPECTRUM_LOW) ** (b / (bins - 1));
    const point = (Math.log(hz / 10) / Math.log(3000)) * (POINTS - 1);
    const i = Math.min(db.length - 2, Math.floor(point));
    const level = db[i] + (db[i + 1] - db[i]) * (point - i) + TILT * Math.log2(hz / 1000);
    out[b] = Math.max(0, Math.min(1, (level + FLOOR) / FLOOR));
  }
  return out;
}

/** `current` moved toward `target` over `dt` seconds: quick up, slow down, as an analyzer falls. In place. */
export function follow(current: Float32Array, target: Float32Array | null, dt: number): Float32Array {
  const up = 1 - Math.exp(-dt / 0.02);
  const down = 1 - Math.exp(-dt / 0.3);
  for (let i = 0; i < current.length; i++) {
    const t = target?.[i] ?? 0;
    current[i] += (t - current[i]) * (t > current[i] ? up : down);
  }
  return current;
}

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
