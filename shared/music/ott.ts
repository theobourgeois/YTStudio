/**
 * OTT (`docs/xfer/ott.md`): its edits, what its knobs mean to the sound, and the settings the engine
 * plays (`engineOtt`). Pure and tested.
 *
 * The sound is David Braun's model of Xfer's OTT 1.3.1 (`co.xfer_ott` in the Faust libraries, MIT),
 * whose every constant was fitted to measurements of the plugin: per band, an envelope on the mean square
 * of both sides, an upward compressor below one knee (capped), a downward one above another, a makeup
 * gain shaped by Depth, and a floor. The engine runs the law (`ottGainDb`) with the values worked out
 * here, so the display and the tests read the same curve the engine plays.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import { DEFAULT_OTT_BAND, MAX_OTT_STRENGTH, MAX_OTT_TIME, OTT_BAND_GAIN_RANGE, OTT_GAIN_RANGE, normalizeOtt, ottPreset } from "./ott-presets.ts";
import type { MusicProject, Ott, OttBand, OttControl } from "./types.ts";

// ---------------------------------------------------------------------------
// Finding and editing
// ---------------------------------------------------------------------------

/** An OTT of the song, by its effect's id: its track, slot and settings. */
export function findOtt(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.ott) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, ott: found.effect.ott };
}

/** The song's OTTs, each with its track. */
export function otts(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.ott ? [{ track, slot, effect, ott: effect.ott }] : [])));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Whether what's heard changed (not just which preset is named). */
const soundChanged = (a: Ott, b: Ott) => !same({ ...a, preset: null }, { ...b, preset: null });

/** Change an OTT's settings (`change` returning equal settings: the same song). What it returns is validated. */
export function editOtt(song: MusicProject, effectId: string, change: (ott: Ott) => Ott): MusicProject {
  const found = findOtt(song, effectId);
  if (!found) return song;
  const changed = change(found.ott);
  if (changed === found.ott) return song;
  const next = normalizeOtt(changed);
  if (same(next, found.ott)) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, ott: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

export type OttPatch = Partial<Omit<Ott, "bands">>;

/** Change OTT's knobs. A preset chosen stays named until the sound is changed. */
export function updateOtt(song: MusicProject, effectId: string, patch: OttPatch): MusicProject {
  return editOtt(song, effectId, (ott) => {
    const next = { ...ott, ...patch };
    return patch.preset === undefined && soundChanged(ott, next) ? { ...next, preset: null } : next;
  });
}

/** Change one band (0 low, 1 mid, 2 high): its threshold, gain, or either compressor's switch. */
export function updateOttBand(song: MusicProject, effectId: string, band: number, patch: Partial<OttBand>): MusicProject {
  if (band < 0 || band > 2) return song;
  return editOtt(song, effectId, (ott) => {
    const bands = ott.bands.map((b, i) => (i === band ? { ...b, ...patch } : b)) as Ott["bands"];
    const next = { ...ott, bands };
    return soundChanged(ott, next) ? { ...next, preset: null } : ott;
  });
}

/** Load a preset (by name): all of OTT's settings. */
export function chooseOttPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = ottPreset(name);
  return preset ? editOtt(song, effectId, () => preset) : song;
}

// ---------------------------------------------------------------------------
// The sound (Braun's model: per band, low, mid, high)
// ---------------------------------------------------------------------------

/** The crossovers (Hz): the Ableton preset's, so the low band is only the sub. */
export const OTT_CROSSOVERS = [88.3, 2500] as const;

/** The fitted constants, low, mid, high: the upward knee (dB), its width, its slope and cap; the downward knee and width; the makeup's most; the floor; the attack (s). */
const UP_KNEE = [-46.0171, -46.5885, -47.4393];
const UP_WIDTH = [0.0552, 0.4509, 0.0338];
const UP_SLOPE = [0.74786, 0.75601, 0.74738];
const UP_CAP = [35.901, 36.285, 35.872];
const DOWN_KNEE = [-38.9401, -34.8204, -41.6879];
const DOWN_WIDTH = [0.5, 0.530023, 0.5];
const MAKEUP = [14.0348, 9.05203, 14.064];
const FLOOR = [-26.26, -31.7, -25.95];
const ATTACK = [0.00621537, 0.006, 0.0096577];
/** Each band's release (s) at Time 0%, 50% and 100% (straight lines between; above 100% it's in proportion). */
const RELEASE = [
  [0.0100376, 0.0148167, 0.030877],
  [0.0118089, 0.0174314, 0.030877],
  [0.00702632, 0.00702632, 0.0103717],
];
/** How far a threshold of 0 or 2 moves a band's knees (dB). */
const THRESHOLD_SHIFT = [23.009, 23.743, 24.021];
/** Depth's shapes (cubics through 0, 1 at 1): the makeup's, and the downward amount's. */
const MAKEUP_SHAPE = [
  [1.83819, -1.21424, 0.37606],
  [1.63851, -0.83224, 0.19373],
  [1.8444, -1.22723, 0.38284],
];
const DOWN_SHAPE = [
  [0.96509, 0.03154, 0.00337],
  [0.96161, 0.02205, 0.01634],
  [0.97286, 0.05778, -0.03064],
];
/** Dnwd%'s law (0..2 to a strength): fitted to 1, straight on to 2. */
const DOWN_STRENGTH: [number, number][] = [
  [0, 0],
  [0.2, 0.189716],
  [0.4, 0.389364],
  [0.6, 0.590038],
  [0.8, 0.793116],
  [1, 1],
  [2, 2],
];

const cubic = ([a, b, c]: number[], d: number) => d * (a + d * (b + d * c));

/** A piecewise-linear function through `points` (sorted by x), held past either end. */
function through(points: readonly [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** A band as the engine runs it: its envelope's times, and its gain law's values (`ottGainDb`). */
export interface EngineOttBand {
  /** Seconds. */
  attack: number;
  release: number;
  /** dB, whatever the level. */
  makeup: number;
  /** The upward compressor: dB of lift per dB below its knee (0: off), its knee (dB), the knee's width, and the most it lifts (dB). */
  upward: number;
  upKnee: number;
  upWidth: number;
  cap: number;
  /** The downward compressor: how much of each dB above its knee is taken off (1: an infinite ratio; 0: off), its knee and width. */
  downward: number;
  downKnee: number;
  downWidth: number;
  /** The least its gain ever is (dB). */
  floor: number;
  /** After it (linear): the H / M / L gain. */
  gain: number;
}

/** OTT as the engine plays it: In Gain and Out Gain (linear) around the three bands (low, mid, high). */
export interface EngineOtt {
  input: number;
  output: number;
  bands: [EngineOttBand, EngineOttBand, EngineOttBand];
}

const dbGain = (db: number) => 10 ** (db / 20);

/** A band's release (s) at a Time (0..10, 1 is OTT's own). */
export function ottRelease(band: number, time: number): number {
  const pct = 100 * Math.max(0, time);
  const [at0, at50, at100] = RELEASE[band];
  const base = through(
    [
      [0, at0],
      [50, at50],
      [100, at100],
    ],
    Math.min(100, pct),
  );
  return base * Math.max(1, pct / 100);
}

/** What the engine plays for an OTT's settings. */
export function engineOtt(ott: Ott): EngineOtt {
  const depth = clamp(ott.depth, 0, 1);
  const band = (k: number): EngineOttBand => {
    const b = ott.bands[k] ?? DEFAULT_OTT_BAND;
    const shift = (clamp(b.threshold, 0, MAX_OTT_STRENGTH) - 1) * THRESHOLD_SHIFT[k];
    return {
      attack: ATTACK[k],
      release: ottRelease(k, ott.time),
      makeup: cubic(MAKEUP_SHAPE[k], depth) * MAKEUP[k],
      upward: b.upward ? depth * clamp(ott.upward, 0, MAX_OTT_STRENGTH) * UP_SLOPE[k] : 0,
      upKnee: UP_KNEE[k] + shift,
      upWidth: UP_WIDTH[k],
      cap: UP_CAP[k],
      downward: b.downward ? Math.min(1, cubic(DOWN_SHAPE[k], depth) * through(DOWN_STRENGTH, clamp(ott.downward, 0, MAX_OTT_STRENGTH))) : 0,
      downKnee: DOWN_KNEE[k] + shift,
      downWidth: DOWN_WIDTH[k],
      floor: FLOOR[k],
      gain: dbGain(b.gain),
    };
  };
  return { input: dbGain(ott.input), output: dbGain(ott.output), bands: [band(0), band(1), band(2)] };
}

/** The softplus knee: 0 well below 0, `z` well above, rounded over about `width`. */
export const softKnee = (width: number, z: number) => Math.max(z, 0) + width * Math.log1p(Math.exp(-Math.abs(z) / width));

/**
 * A band's gain (dB, before its H / M / L gain) for a level (dB of its mean square): the law the engine
 * runs on each sample's envelope, and what the display draws.
 */
export function ottGainDb(band: EngineOttBand, level: number): number {
  const up = Math.min(band.cap, band.upward * softKnee(band.upWidth, band.upKnee - level));
  const down = band.downward * softKnee(band.downWidth, level - band.downKnee);
  return Math.max(band.floor, band.makeup + up - down);
}

/** What an automation lane of OTT's sets in the engine (`EngineLaneTarget` "ott"): its values, from the settings at a moment. */
export const OTT_LANES = {
  input: (e: EngineOtt) => [e.input],
  output: (e: EngineOtt) => [e.output],
  makeup: (e: EngineOtt) => e.bands.map((b) => b.makeup),
  upward: (e: EngineOtt) => e.bands.map((b) => b.upward),
  downward: (e: EngineOtt) => e.bands.map((b) => b.downward),
  upKnee: (e: EngineOtt) => e.bands.map((b) => b.upKnee),
  downKnee: (e: EngineOtt) => e.bands.map((b) => b.downKnee),
  release: (e: EngineOtt) => e.bands.map((b) => b.release),
  gains: (e: EngineOtt) => e.bands.map((b) => b.gain),
} as const;
export type OttLane = keyof typeof OTT_LANES;

/** Which engine lanes each automatable control moves. */
export const OTT_LANES_OF: Record<OttControl, readonly OttLane[]> = {
  depth: ["makeup", "upward", "downward"],
  time: ["release"],
  input: ["input"],
  output: ["output"],
  upward: ["upward"],
  downward: ["downward"],
  lowThreshold: ["upKnee", "downKnee"],
  midThreshold: ["upKnee", "downKnee"],
  highThreshold: ["upKnee", "downKnee"],
  lowGain: ["gains"],
  midGain: ["gains"],
  highGain: ["gains"],
};

// ---------------------------------------------------------------------------
// Its automatable controls
// ---------------------------------------------------------------------------

/**
 * An automatable control: its name, its value in the song (`get`, `set`), an automation clip's fraction
 * (0..1) as that value and back (the knob's taper, which its knob turns by too), its default, and its
 * value said.
 */
export interface OttControlSpec {
  name: string;
  get: (ott: Ott) => number;
  set: (ott: Ott, value: number) => Ott;
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  defaultValue: number;
  format: (value: number) => string;
}

const linear = (min: number, max: number) => ({ toControl: (f: number) => min + clamp(f, 0, 1) * (max - min), fromControl: (v: number) => clamp((v - min) / (max - min), 0, 1) });
/** Time's taper: 100% at 12 o'clock, 1000% at the end (a power law, as OTT's knob turns). */
const TIME_POWER = Math.log(1 / MAX_OTT_TIME) / Math.log(0.5);
const timeTaper = {
  toControl: (f: number) => MAX_OTT_TIME * clamp(f, 0, 1) ** TIME_POWER,
  fromControl: (v: number) => clamp(Math.max(0, v) / MAX_OTT_TIME, 0, 1) ** (1 / TIME_POWER),
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;

const bandControl = (k: 0 | 1 | 2, what: "threshold" | "gain"): Pick<OttControlSpec, "get" | "set"> => ({
  get: (ott) => ott.bands[k][what],
  set: (ott, value) => ({ ...ott, bands: ott.bands.map((b, i) => (i === k ? { ...b, [what]: value } : b)) as Ott["bands"] }),
});
const threshold = (k: 0 | 1 | 2, name: string): OttControlSpec => ({ name: `${name} threshold`, ...bandControl(k, "threshold"), ...linear(0, MAX_OTT_STRENGTH), defaultValue: 1, format: pct });
const bandGain = (k: 0 | 1 | 2, name: string): OttControlSpec => ({ name: `${name} gain`, ...bandControl(k, "gain"), ...linear(OTT_BAND_GAIN_RANGE[0], OTT_BAND_GAIN_RANGE[1]), defaultValue: 0, format: db });

export const OTT_CONTROL_SPECS: Record<OttControl, OttControlSpec> = {
  depth: { name: "Depth", get: (o) => o.depth, set: (o, depth) => ({ ...o, depth }), ...linear(0, 1), defaultValue: 1, format: pct },
  time: { name: "Time", get: (o) => o.time, set: (o, time) => ({ ...o, time }), ...timeTaper, defaultValue: 1, format: pct },
  input: { name: "In Gain", get: (o) => o.input, set: (o, input) => ({ ...o, input }), ...linear(OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1]), defaultValue: 0, format: db },
  output: { name: "Out Gain", get: (o) => o.output, set: (o, output) => ({ ...o, output }), ...linear(OTT_GAIN_RANGE[0], OTT_GAIN_RANGE[1]), defaultValue: 0, format: db },
  upward: { name: "Upward", get: (o) => o.upward, set: (o, upward) => ({ ...o, upward }), ...linear(0, MAX_OTT_STRENGTH), defaultValue: 1, format: pct },
  downward: { name: "Downward", get: (o) => o.downward, set: (o, downward) => ({ ...o, downward }), ...linear(0, MAX_OTT_STRENGTH), defaultValue: 1, format: pct },
  lowThreshold: threshold(0, "Low"),
  midThreshold: threshold(1, "Mid"),
  highThreshold: threshold(2, "High"),
  lowGain: bandGain(0, "Low"),
  midGain: bandGain(1, "Mid"),
  highGain: bandGain(2, "High"),
};

/** A band's two controls, by band (0 low, 1 mid, 2 high). */
export const OTT_BAND_CONTROLS = [
  { threshold: "lowThreshold", gain: "lowGain" },
  { threshold: "midThreshold", gain: "midGain" },
  { threshold: "highThreshold", gain: "highGain" },
] as const satisfies readonly { threshold: OttControl; gain: OttControl }[];

/** Set an OTT's control to a value in its own units (a knob turned, an assistant's edit). */
export const setOttControl = (song: MusicProject, effectId: string, control: OttControl, value: number) =>
  editOtt(song, effectId, (ott) => {
    const next = OTT_CONTROL_SPECS[control].set(ott, value);
    return soundChanged(ott, next) ? { ...next, preset: null } : ott;
  });
