/**
 * The beat of a sound heard live (Now Playing; `live.ts` feeds it), from what's been heard so far. The tempo is
 * found as `server/beats.ts` finds a file's: the onsets' autocorrelation scored over a beat's multiples (a comb),
 * tempos near 120 BPM likelier, then the octave whose beats land on kicks. Where the beats fall is the phase whose
 * beats land on the most onsets, followed like a metronome being nudged (a phase-locked loop), so the beat doesn't
 * jump about from one estimate to the next; a new song's tempo takes over after a few estimates agree on it.
 *
 * Beats already past stay put (a picture counting beats never counts back) and the next few are predicted, so a
 * picture can land on the beat rather than after it. Pure: the tests feed it synthetic drums.
 */
import type { MusicAnalysis } from "../types.ts";

/** Samples a second of the onset envelopes `LiveBeat.update` is given. */
export const BEAT_RATE = 100;
/** Seconds of onsets an estimate looks at. */
export const BEAT_WINDOW = 8;
const MIN_BPM = 70;
const MAX_BPM = 180;
const PRIOR_BPM = 120;
/** Multiples of a beat its score adds up (see `server/beats.ts`). */
const COMB = 4;
/** How regular the onsets must be to have a beat at all (speech, ambient sound and silence aren't). */
const MIN_PERIODICITY = 0.08;
/** Of the octaves, the fastest whose beats land on kicks nearly as often as the best one's. */
const OCTAVE_SHARE = 0.8;
/** Seconds of beats predicted past now. */
const AHEAD = 4;
/** How much of a measured phase or tempo error each estimate corrects (the rest is the beat carrying on). */
const PHASE_GAIN = 0.35;
const TEMPO_GAIN = 0.3;
/** Within this share of the period (tempo) or of a beat (phase), an estimate agrees with the beat. */
const TEMPO_TOLERANCE = 0.04;
const PHASE_TOLERANCE = 0.2;
/** Estimates in a row that disagree before the beat jumps to them (a new song, a tempo change). */
const PATIENCE = 3;
/** Estimates in a row without a beat before there's none (an estimate every half second). */
const QUIET_PATIENCE = 6;

/** The value of `x` at fractional index `i` (0 outside). */
function at(x: Float64Array, i: number): number {
  if (i < 0 || i > x.length - 1) return 0;
  const f = Math.floor(i);
  const p = i - f;
  return p === 0 ? x[f] : x[f] * (1 - p) + (x[f + 1] ?? 0) * p;
}

/** The beat period (samples, fractional) and how periodic `env` is (0..1), or null without a pulse. */
export function livePeriod(env: Float64Array): { period: number; periodicity: number } | null {
  const minLag = Math.floor((60 * BEAT_RATE) / MAX_BPM);
  const maxLag = Math.ceil((60 * BEAT_RATE) / MIN_BPM);
  const top = maxLag * COMB + COMB + 2;
  if (env.length < top + BEAT_RATE) return null;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  const corr = new Float64Array(top + 1);
  for (let lag = 0; lag <= top; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += (env[i] - mean) * (env[i - lag] - mean);
    corr[lag] = s / (env.length - lag);
  }
  if (corr[0] <= 1e-9) return null;
  const near = (lag: number, reach: number) => {
    let most = 0;
    for (let l = Math.max(0, Math.floor(lag - reach)); l <= Math.min(top, Math.ceil(lag + reach)); l++) most = Math.max(most, corr[l]);
    return most;
  };
  const comb = (lag: number) => {
    let sum = 0;
    for (let k = 1; k <= COMB; k++) sum += near(k * lag, 1 + k / 2);
    return sum;
  };
  const priorLag = (60 * BEAT_RATE) / PRIOR_BPM;
  const score = (lag: number) => comb(lag) * Math.exp(-0.5 * Math.log2(lag / priorLag) ** 2);
  let best = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (score(lag) > score(best)) best = lag;
  const periodicity = comb(best) / COMB / corr[0];
  if (!(periodicity > 0)) return null;
  const [a, b, c] = [corr[best - 1], corr[best], corr[best + 1]];
  const shift = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return { period: best + Math.max(-0.5, Math.min(0.5, shift)), periodicity };
}

/**
 * How far back from the end of `env` the last beat is (samples), for beats `period` apart: the phase whose beats
 * land on the most onsets, recent ones counting more. And how strongly they land (the mean onset under them).
 */
export function livePhase(env: Float64Array, period: number): { back: number; strength: number } {
  let best = 0;
  let bestScore = -1;
  let bestStrength = 0;
  const end = env.length - 1;
  for (let back = 0; back < period; back += 0.5) {
    let score = 0;
    let weights = 0;
    let w = 1;
    for (let i = end - back; i >= 0; i -= period) {
      // The strongest onset within a sample of the beat (a beat between samples).
      score += w * Math.max(at(env, i - 1), at(env, i), at(env, i + 1));
      weights += w;
      w *= 0.85;
    }
    if (score > bestScore) {
      bestScore = score;
      best = back;
      bestStrength = weights > 0 ? score / weights : 0;
    }
  }
  return { back: best, strength: bestStrength };
}

/** `x` wrapped into a period either side of 0. */
const wrap = (x: number, period: number) => x - period * Math.round(x / period);

/** Follows the beat of a sound heard live (see the file's comment). */
export class LiveBeat {
  /** Seconds a beat; 0: no beat (yet). */
  private period = 0;
  /** A beat's time; the beats are `anchor + k × period`. */
  private anchor = 0;
  /** Beats already past, kept (counted from the first). */
  private beats: number[] = [];
  /** Which beat of 4 starts a bar (of `beats`' indices). */
  private barPhase = 0;
  private tempoCandidate = 0;
  private tempoVotes = 0;
  private phaseVotes = 0;
  private quiet = 0;
  private confidence = 0;

  /**
   * A new estimate from the onset envelopes of the last `BEAT_WINDOW` seconds or so ending at `now` (seconds
   * since listening started), `BEAT_RATE` samples a second: `onset` (every hit) and `low` (kicks), each
   * about 1 at a hard hit. Returns the beat so far, or null while there's none.
   */
  update(onset: Float64Array, low: Float64Array, now: number): MusicAnalysis | null {
    const env = new Float64Array(onset.length);
    for (let i = 0; i < env.length; i++) env[i] = onset[i] + low[i];
    const found = livePeriod(env);
    if (!found || found.periodicity < MIN_PERIODICITY) {
      if (++this.quiet >= QUIET_PATIENCE) this.period = 0;
      return this.analysis(now);
    }
    this.quiet = 0;
    this.confidence = Math.min(1, found.periodicity);
    const measured = this.octave(env, low, found.period) / BEAT_RATE;
    const phaseAt = (period: number) => now - livePhase(env, period * BEAT_RATE).back / BEAT_RATE;

    if (this.period === 0) {
      this.lock(measured, phaseAt(measured), now);
      return this.analysis(now);
    }
    // The tempo: nudged towards an estimate that agrees, jumping to one that keeps disagreeing the same way.
    if (Math.abs(measured - this.period) / this.period < TEMPO_TOLERANCE) {
      this.period += TEMPO_GAIN * (measured - this.period);
      this.tempoVotes = 0;
    } else if (this.tempoCandidate && Math.abs(measured - this.tempoCandidate) / this.tempoCandidate < TEMPO_TOLERANCE) {
      if (++this.tempoVotes >= PATIENCE) {
        this.lock(measured, phaseAt(measured), now);
        return this.analysis(now);
      }
    } else {
      this.tempoCandidate = measured;
      this.tempoVotes = 1;
    }
    // The phase: the same, against where the beat says a beat should be.
    const error = wrap(phaseAt(this.period) - this.anchor, this.period);
    if (Math.abs(error) < PHASE_TOLERANCE * this.period) {
      this.anchor += PHASE_GAIN * error;
      this.phaseVotes = 0;
    } else if (++this.phaseVotes >= PATIENCE) {
      this.anchor += error;
      this.phaseVotes = 0;
    }
    this.chooseBar(low, now);
    return this.analysis(now);
  }

  /** Half, the same or double `period` (samples): the fastest whose beats land on kicks nearly as often as the best's. */
  private octave(env: Float64Array, low: Float64Array, period: number): number {
    const minLag = (60 * BEAT_RATE) / MAX_BPM;
    const maxLag = (60 * BEAT_RATE) / MIN_BPM;
    const candidates = [period / 2, period, period * 2].filter((p) => p >= minLag && p <= maxLag);
    const onKicks = candidates.map((p) => {
      const { back } = livePhase(env, p);
      let hits = 0;
      let count = 0;
      for (let i = env.length - 1 - back; i >= 0; i -= p) {
        count++;
        if (Math.max(at(low, i - 1), at(low, i), at(low, i + 1)) >= 0.3) hits++;
      }
      return count ? hits / count : 0;
    });
    const best = Math.max(...onKicks);
    if (best <= 0) return period;
    return candidates[onKicks.findIndex((share) => share >= OCTAVE_SHARE * best)];
  }

  /** A new beat from here on (the first, or after a jump): the beats already past stay. */
  private lock(period: number, beat: number, now: number): void {
    this.period = period;
    this.anchor = beat;
    this.tempoCandidate = 0;
    this.tempoVotes = 0;
    this.phaseVotes = 0;
    // The first beat ever: the grid reaches back over what was heard.
    if (!this.beats.length) for (let t = beat - Math.floor((beat - Math.max(0, now - BEAT_WINDOW)) / period) * period; t <= now; t += period) if (t >= 0) this.beats.push(t);
  }

  /** Which beat of 4 starts a bar: the one with the most kicks lately (changing only for a clearly better one). */
  private chooseBar(low: Float64Array, now: number): void {
    const start = now - (low.length - 1) / BEAT_RATE;
    const sums = [0, 0, 0, 0];
    for (let i = 0; i < this.beats.length; i++) {
      const f = (this.beats[i] - start) * BEAT_RATE;
      if (f < 1) continue;
      sums[i % 4] += Math.max(at(low, f - 1), at(low, f), at(low, f + 1));
    }
    const best = sums.indexOf(Math.max(...sums));
    if (sums[best] > sums[this.barPhase] * 1.25) this.barPhase = best;
  }

  private analysis(now: number): MusicAnalysis | null {
    if (this.period === 0) return null;
    const p = this.period;
    // Beats on the grid since the last kept one become kept once they're past.
    const last = this.beats.at(-1) ?? -Infinity;
    const first = this.anchor + Math.ceil((last + p / 2 - this.anchor) / p) * p;
    const ahead: number[] = [];
    for (let t = first; t <= now + AHEAD; t += p) {
      if (t < 0) continue;
      if (t <= now) this.beats.push(t);
      else ahead.push(t);
    }
    const beats = [...this.beats, ...ahead].map((t) => Math.round(t * 1000) / 1000);
    return {
      bpm: Math.round((600 / p)) / 10,
      confidence: Math.round(this.confidence * 100) / 100,
      beats,
      downbeats: beats.filter((_, i) => i % 4 === this.barPhase),
      sections: [],
      drops: [],
    };
  }
}
