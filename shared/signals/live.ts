/**
 * Signals of a sound heard live (Now Playing: what the computer is playing), measured as it arrives by the same
 * analyser as a file's (`SignalAnalyser`) and read through the same `SignalData` as it grows, so whatever reacts
 * to a file's sound (links, visualizers, 3D scenes) reacts to it too, time 0 being when listening started.
 *
 * What a file works out from all of itself is worked out here from what's been heard so far: what counts as loud
 * (the references, auto-gain) from the last `REFERENCE_SECONDS`, hits as soon as they peak (a frame later, rather
 * than from the moments either side), the beat from the last few seconds (`live-beat.ts`), and drops where the
 * sound gets suddenly louder. Pure: the tests feed it synthetic drums.
 */
import {
  HIT_CONTEXT,
  HIT_FACTOR,
  HIT_FLOOR,
  HIT_NEIGHBOURHOOD,
  HIT_SHARE,
  MIN_BAND_REFERENCE,
  MIN_FLUX_REFERENCE,
  MIN_HIT_GAP,
  MIN_HIT_RISE,
  MIN_LEVEL_REFERENCE,
  ONSET_SHIFT,
  SOUNDING_DB,
  SignalAnalyser,
} from "./analyse.ts";
import {
  BAND_COUNT,
  type Hit,
  NAMED_BANDS,
  ONSET_SCALARS,
  type OnsetName,
  SCALARS,
  SIGNALS_VERSION,
  SIGNAL_RATE,
  type ScalarName,
  type SignalData,
  type SignalsHeader,
  bandEdges,
  byteDb,
} from "./format.ts";
import { BEAT_RATE, BEAT_WINDOW, LiveBeat } from "./live-beat.ts";
import type { MusicAnalysis } from "../types.ts";

/** Seconds of the past that say what counts as loud now. */
export const REFERENCE_SECONDS = 20;
/** Frames between updates of the references and the beat (half a second). */
const SLOW_EVERY = SIGNAL_RATE / 2;
/** Seconds of sound needed before the references follow it (a moment of music after silence doesn't reset them). */
const MIN_SOUNDING_SECONDS = 2;
/** A kick within this of a beat lands on it. */
const ON_BEAT = 0.05;
/** A beat of the bar expects a hit when it had one in this share of the last `BARS_JUDGED` bars. */
const ON_THE_BEAT = 0.75;
const BARS_JUDGED = 4;
/** Seconds of hits expected ahead, and how long an expected one is kept (its punch plays out). */
const AHEAD = 1;
const KEPT = 0.6;
/** A drop: the last second this many dB louder than the four before, at most one every `DROP_GAP` seconds. */
const DROP_RISE_DB = 6;
const DROP_GAP = 8;

const S = SCALARS.length;
const INDEX = Object.fromEntries(SCALARS.map((s, i) => [s, i])) as Record<ScalarName, number>;
const EDGES = bandEdges().map((e) => Math.round(e * 1000) / 1000);
const DB_REFERENCES = ["level", "peak", ...NAMED_BANDS.map((b) => b.id)] as const;

/** The `share` percentile of `values` (sorted in place), or null for none. */
function percentile(values: number[], share: number): number | null {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.floor(share * (values.length - 1)))];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** References before there's anything to go on: the floors a file's never go under. */
function startingReferences(): SignalsHeader["reference"] {
  const reference: SignalsHeader["reference"] = { level: -20, peak: -14 };
  for (const band of NAMED_BANDS) reference[band.id] = -30;
  for (const name of ONSET_SCALARS) reference[name] = MIN_FLUX_REFERENCE * 4;
  return reference;
}

export class LiveSignals {
  private readonly analyser: SignalAnalyser;
  /** Frames looked at for hits so far. */
  private checked = 0;
  private readonly hits: Record<OnsetName, Hit[]> = { onset: [], onsetLow: [], onsetMid: [], onsetHigh: [] };
  private reference = startingReferences();
  private bandReference: number[] = new Array<number>(BAND_COUNT).fill(-40);
  private readonly beat = new LiveBeat();
  private rhythm: MusicAnalysis | null = null;
  private drops: { time: number; rise: number }[] = [];
  private nextSlow = SLOW_EVERY;
  /** The header as of the last change (`data` builds the rest each time). */
  private header: SignalsHeader | null = null;
  private ahead = 0;
  private expecting = false;

  constructor(readonly sampleRate = 48_000) {
    this.analyser = new SignalAnalyser(sampleRate, 0, { live: true });
  }

  /** Seconds after a moment it's measured (the sound the analysis needs after it). */
  get delay(): number {
    return this.analyser.delay;
  }

  /**
   * Seconds the beat is shown early: what's known ahead of time (the beat, and kicks that land on it) is given that
   * much before it's heard, so a picture drawn late still lands on it (the visualizer sets it from its own delay).
   */
  get lead(): number {
    return this.ahead;
  }

  set lead(seconds: number) {
    if (seconds === this.ahead) return;
    this.ahead = seconds;
    this.header = null;
  }

  /** Whether the next kicks are expected on the beat (the last beats each had one): their punches come on time. */
  get expectingKicks(): boolean {
    return this.expecting;
  }

  /** The beats so far and the next few, as heard (not moved by `lead`). */
  get beats(): readonly number[] {
    return this.rhythm?.beats ?? [];
  }

  /** Interleaved stereo samples (left, right, left...) or mono, as they're heard. */
  push(samples: Float32Array, channels: 1 | 2 = 2): void {
    this.analyser.push(samples, channels);
    const { frames, scalars } = this.analyser.measured();
    for (; this.checked < frames; this.checked++) {
      this.findHits(scalars, this.checked);
      if (this.checked >= this.nextSlow) {
        this.nextSlow += SLOW_EVERY;
        this.updateSlow(scalars, this.checked + 1);
      }
    }
  }

  /** Frames measured so far. */
  get frames(): number {
    return this.analyser.measured().frames;
  }

  /** Seconds heard (and measured) so far: the moment the newest frame is centred on. */
  get seconds(): number {
    return Math.max(0, this.frames - 1) / SIGNAL_RATE;
  }

  /** The beat so far (null while there's none). */
  get bpm(): number | null {
    return this.rhythm?.bpm ?? null;
  }

  /** Everything heard so far, as a file's signals (the tables are views: read it, don't keep it). */
  data(): SignalData {
    const m = this.analyser.measured();
    this.header ??= {
      version: SIGNALS_VERSION,
      rate: SIGNAL_RATE,
      frames: 0,
      duration: 0,
      bandEdges: EDGES,
      scalars: [...SCALARS],
      reference: this.reference,
      bandReference: this.bandReference,
      hits: { ...this.hits, onsetLow: this.expected("onsetLow"), onsetMid: this.expected("onsetMid") },
      rhythm: this.rhythm && {
        ...this.rhythm,
        beats: this.rhythm.beats.map((b) => round(b - this.ahead)),
        downbeats: this.rhythm.downbeats.map((b) => round(b - this.ahead)),
        drops: this.drops,
      },
      waveRate: m.waveRate,
      waveSamples: 0,
    };
    return {
      header: { ...this.header, frames: m.frames, duration: m.frames / SIGNAL_RATE, waveSamples: m.waveSamples },
      scalars: m.scalars,
      bands: m.bands,
      wave: m.wave,
    };
  }

  /**
   * The newest frame's spectrum in `count` bands (log-spaced from 40 Hz to 16 kHz), each 0..1 against what's
   * been loud in it lately: a level meter's bars.
   */
  meter(count: number): number[] {
    const { frames, bands } = this.analyser.measured();
    const out = new Array<number>(count).fill(0);
    if (!frames) return out;
    const row = (frames - 1) * BAND_COUNT;
    const lo = EDGES.findIndex((e) => e >= 40);
    const hi = EDGES.findIndex((e) => e >= 16_000);
    for (let i = 0; i < count; i++) {
      const from = lo + Math.floor(((hi - lo) * i) / count);
      const to = Math.max(from + 1, lo + Math.floor(((hi - lo) * (i + 1)) / count));
      let most = 0;
      for (let b = from; b < to; b++) most = Math.max(most, 1 + (byteDb(bands[row + b]) - this.bandReference[b]) / 24);
      out[i] = Math.min(1, Math.max(0, most));
    }
    return out;
  }

  /**
   * The hits of a band (kicks, snares): those heard, and those expected on the beat ahead of time (`lead` early),
   * replacing the heard ones there. A beat of the bar is expected to have one when it had one in nearly every one
   * of the last bars (four on the floor: every beat; a half-time kick: 1 and 3; a snare: 2 and 4). An expected hit
   * that didn't come is dropped once it's past (its punch stops short: a breakdown's first beat or two).
   */
  private expected(name: "onsetLow" | "onsetMid"): Hit[] {
    const heard = this.hits[name];
    const beats = this.rhythm?.beats ?? [];
    const now = this.seconds;
    const near = (t: number) => {
      // The last hit at or before t + ON_BEAT (they're in order).
      let lo = 0;
      let hi = heard.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (heard[mid][0] <= t + ON_BEAT) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return found >= 0 && heard[found][0] >= t - ON_BEAT ? heard[found] : null;
    };
    // The last bars' beats whose hits would have been heard by now, by their place in the bar.
    let last = beats.length - 1;
    while (last >= 0 && beats[last] > now - ON_BEAT) last--;
    const first = Math.max(0, last - BARS_JUDGED * 4 + 1);
    const matched: { offset: number; velocity: number }[] = [];
    const places = [0, 1, 2, 3].filter((place) => {
      let tried = 0;
      let had = 0;
      for (let i = first; i <= last; i++) {
        if (i % 4 !== place) continue;
        tried++;
        const hit = near(beats[i]);
        if (hit) {
          had++;
          matched.push({ offset: hit[0] - beats[i], velocity: hit[1] });
        }
      }
      return tried >= BARS_JUDGED - 1 && had >= tried * ON_THE_BEAT;
    });
    if (name === "onsetLow") this.expecting = places.length > 0;
    if (!places.length) return heard;
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const velocity = median(matched.map((m) => m.velocity));
    // Where hits fall against the beat (the beat's phase is the tracker's guess; the hits are what's heard).
    const off = median(matched.map((m) => m.offset));
    const expected: Hit[] = [];
    const window = (t: number) => t > now - KEPT && t <= now + AHEAD;
    for (let i = 0; i < beats.length; i++) {
      const t = beats[i] + off;
      if (!places.includes(i % 4) || !window(t)) continue;
      // Past, and nothing came: it wasn't one.
      if (t <= now - ON_BEAT && !near(t)) continue;
      expected.push([round(t - this.ahead), velocity]);
    }
    if (!expected.length) return heard;
    const replaced = (t: number) => beats.some((b, i) => places.includes(i % 4) && window(b + off) && Math.abs(t - b - off) <= ON_BEAT);
    return [...heard.filter(([t]) => !replaced(t)), ...expected].sort((a, b) => a[0] - b[0]);
  }

  /** Whether frame `f - 1` of an onset scalar is a hit, now that frame `f` is here (see `pickHits`, which looks both ways). */
  private findHits(scalars: Float32Array, f: number): void {
    const i = f - 1;
    if (i < 1) return;
    const context = Math.round(HIT_CONTEXT * SIGNAL_RATE);
    const neighbourhood = Math.round(HIT_NEIGHBOURHOOD * SIGNAL_RATE);
    for (const name of ONSET_SCALARS) {
      const c = INDEX[name];
      const flux = (k: number) => (k >= 0 ? scalars[k * S + c] : 0);
      const v = flux(i);
      if (!(v > flux(i - 1) && v >= flux(f))) continue;
      const reference = this.reference[name] ?? MIN_FLUX_REFERENCE;
      if (v <= Math.max(HIT_FLOOR * reference, MIN_HIT_RISE)) continue;
      let sum = 0;
      let most = 0;
      for (let k = Math.max(0, i - neighbourhood); k < i; k++) {
        if (k >= i - context) sum += flux(k);
        most = Math.max(most, flux(k));
      }
      const mean = (sum + v) / (Math.min(i, context) + 1);
      if (v < mean * HIT_FACTOR || v < HIT_SHARE * most) continue;
      // Between frames: the top of the parabola through the peak and its neighbours.
      const [a, b, cc] = [flux(i - 1), v, flux(f)];
      const curve = a - 2 * b + cc;
      const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - cc)) / curve)) : 0;
      const hit: Hit = [round(Math.max(0, (i + shift) / SIGNAL_RATE + ONSET_SHIFT)), Math.round(Math.min(1, v / reference) * 100) / 100];
      const hits = this.hits[name];
      const last = hits.at(-1);
      // Hits closer than the gap are one: the stronger (a later peak can still win, as the file's would).
      if (last && hit[0] - last[0] < MIN_HIT_GAP) {
        if (hit[1] > last[1]) hits[hits.length - 1] = hit;
        else continue;
      } else hits.push(hit);
      this.header = null;
    }
  }

  /** The references, the beat and the drops, from the last few seconds up to frame `frames`. */
  private updateSlow(scalars: Float32Array, frames: number): void {
    const { bands } = this.analyser.measured();
    const from = Math.max(0, frames - REFERENCE_SECONDS * SIGNAL_RATE);
    const column = (name: ScalarName, f: number) => scalars[f * S + INDEX[name]];
    // Every other frame is plenty for a percentile.
    const sounding: number[] = [];
    for (let f = from; f < frames; f += 2) if (column("level", f) > SOUNDING_DB) sounding.push(f);
    if (sounding.length >= (MIN_SOUNDING_SECONDS * SIGNAL_RATE) / 2) {
      const reference: SignalsHeader["reference"] = {};
      const over = (name: ScalarName, share: number) => percentile(sounding.map((f) => column(name, f)), share) ?? -Infinity;
      for (const name of DB_REFERENCES) reference[name] = round(Math.max(name === "level" || name === "peak" ? MIN_LEVEL_REFERENCE : MIN_BAND_REFERENCE, over(name, 0.95)));
      for (const name of ONSET_SCALARS) reference[name] = round(Math.max(MIN_FLUX_REFERENCE, over(name, 0.99)));
      // Bands are bytes: a count of each value finds their percentiles without sorting.
      const bandReference: number[] = [];
      const counts = new Uint32Array(256);
      const target = Math.floor(0.95 * (sounding.length - 1));
      for (let b = 0; b < BAND_COUNT; b++) {
        counts.fill(0);
        for (const f of sounding) counts[bands[f * BAND_COUNT + b]]++;
        let seen = 0;
        let value = 0;
        for (; value < 255; value++) if ((seen += counts[value]) > target) break;
        bandReference.push(round(Math.max(MIN_BAND_REFERENCE, byteDb(value))));
      }
      this.reference = reference;
      this.bandReference = bandReference;
    }

    // The beat, from the onsets of the last few seconds at its rate (the strongest of each pair of frames).
    const step = SIGNAL_RATE / BEAT_RATE;
    const start = Math.max(0, frames - BEAT_WINDOW * SIGNAL_RATE);
    const length = Math.floor((frames - start) / step);
    const onset = new Float64Array(length);
    const low = new Float64Array(length);
    const onsetRef = this.reference.onset ?? MIN_FLUX_REFERENCE;
    const lowRef = this.reference.onsetLow ?? MIN_FLUX_REFERENCE;
    for (let k = 0; k < length; k++) {
      const f = frames - (length - k) * step;
      let o = 0;
      let l = 0;
      for (let j = 0; j < step; j++) {
        o = Math.max(o, column("onset", f + j));
        l = Math.max(l, column("onsetLow", f + j));
      }
      onset[k] = Math.min(3, o / onsetRef);
      low[k] = Math.min(3, l / lowRef);
    }
    this.rhythm = this.beat.update(onset, low, (frames - 1) / SIGNAL_RATE);
    this.findDrop(scalars, frames);
    this.header = null;
  }

  /**
   * A drop where the last second is suddenly louder than the four before the two before it: where the sound got
   * halfway there, snapped to a beat close by.
   */
  private findDrop(scalars: Float32Array, frames: number): void {
    if (frames < 6 * SIGNAL_RATE) return;
    const now = (frames - 1) / SIGNAL_RATE;
    if (this.drops.length && now - this.drops[this.drops.length - 1].time < DROP_GAP) return;
    const meanDb = (from: number, to: number) => {
      let power = 0;
      for (let f = from; f < to; f++) power += 10 ** (scalars[f * S + INDEX.level] / 10);
      return 10 * Math.log10(power / Math.max(1, to - from) + 1e-12);
    };
    const recent = meanDb(frames - SIGNAL_RATE, frames);
    const before = meanDb(frames - 6 * SIGNAL_RATE, frames - 2 * SIGNAL_RATE);
    const rise = recent - before;
    if (rise < DROP_RISE_DB || recent < (this.reference.level ?? 0) - 10) return;
    // Half a second at a time (a tenth would rise at a single hat), its middle where it gets there.
    const span = SIGNAL_RATE / 2;
    let at = frames - SIGNAL_RATE;
    for (let f = frames - 2 * SIGNAL_RATE - span / 2; f <= frames - span; f += SIGNAL_RATE / 20) {
      if (meanDb(f, f + span) >= before + rise / 2) {
        at = f + span / 2;
        break;
      }
    }
    let time = at / SIGNAL_RATE;
    const beats = this.rhythm?.beats ?? [];
    const near = beats.reduce((best, b) => (Math.abs(b - time) < Math.abs(best - time) ? b : best), Infinity);
    if (Math.abs(near - time) < 0.15) time = near;
    this.drops.push({ time: round(time), rise: round(rise) });
  }
}
