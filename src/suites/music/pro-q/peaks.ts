/**
 * Spectrum Grab's peaks (Pro-Q's: "the most important peaks in the signal will show a label"): the local
 * highs of a spectrum that stand out from what's round them, the most prominent first, each with the Q a
 * Bell needs to cover it (from where it has fallen half its prominence either side). Pure, so it's tested.
 */
import { clamp } from "@shared/math";
import { spectrumFrequency } from "@shared/music/pro-q-presets";

export interface SpectrumPeak {
  hz: number;
  /** Its level (dB, as measured: no tilt). */
  db: number;
  /** How far it stands over the lower of the lows either side within a third of an octave each way. */
  prominence: number;
  /** A Bell's Q to cover it. */
  q: number;
}

/** Points of `EQ_SPECTRUM_POINTS` in an octave. */
const PER_OCTAVE = (480 - 1) / Math.log2(30_000 / 10);

/** The peaks of `levels` (dB at the spectrum's points) at least `minProminence` dB proud, `count` at most, from 20 Hz to 20 kHz. */
export function findPeaks(levels: ArrayLike<number>, count = 8, minProminence = 6): SpectrumPeak[] {
  const reach = Math.round(PER_OCTAVE / 3);
  const peaks: SpectrumPeak[] = [];
  for (let i = 1; i < levels.length - 1; i++) {
    const v = levels[i];
    const hz = spectrumFrequency(i);
    if (hz < 20 || hz > 20_000 || v < -110) continue;
    if (!(v > levels[i - 1] && v >= levels[i + 1])) continue;
    let leftLow = v;
    let rightLow = v;
    let higher = false;
    for (let k = 1; k <= reach; k++) {
      const l = levels[Math.max(0, i - k)];
      const r = levels[Math.min(levels.length - 1, i + k)];
      if (l > v || r > v) {
        higher = true;
        break;
      }
      leftLow = Math.min(leftLow, l);
      rightLow = Math.min(rightLow, r);
    }
    if (higher) continue;
    const prominence = v - Math.max(leftLow, rightLow);
    if (prominence < minProminence) continue;
    // Its width where it's fallen half its prominence, in octaves: a Bell's Q (Pro-Q's: Q 1 is 1.9 octaves).
    const half = v - prominence / 2;
    let a = i;
    while (a > 0 && levels[a] > half && i - a < reach * 3) a--;
    let b = i;
    while (b < levels.length - 1 && levels[b] > half && b - i < reach * 3) b++;
    const octaves = Math.max(1 / 24, (b - a) / PER_OCTAVE);
    const q = clamp(1 / (Math.SQRT2 * Math.sinh((Math.LN2 * octaves) / 2)), 0.5, 12);
    peaks.push({ hz, db: v, prominence, q });
  }
  peaks.sort((x, y) => y.prominence + y.db / 10 - (x.prominence + x.db / 10));
  return peaks.slice(0, count);
}
