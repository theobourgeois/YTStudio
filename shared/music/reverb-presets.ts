/**
 * The Reverb's constants, its default, how its settings are validated, and its factory presets
 * (`docs/reverb/reverb.md` 4, 7).
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { REVERB_ERAS, REVERB_MODES, REVERB_NOTES, REVERB_BAND_SHAPES, type PluginRef, type Reverb, type ReverbControl, type ReverbDecayBand, type ReverbNote, type ReverbState } from "./types.ts";

/** What a Reverb effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const REVERB_PLUGIN: PluginRef = { id: "vaudio:reverb", name: "Reverb", format: "Vaudio" };
export const isReverb = (plugin: Pick<PluginRef, "id">) => plugin.id === REVERB_PLUGIN.id;

/** Decay's range (s) and its ∞ (the top of the knob): the loop held, the input open. */
export const REVERB_DECAY_RANGE = [0.1, 60] as const;
export const REVERB_INFINITE = 61;
export const isInfinite = (decay: number) => decay > REVERB_DECAY_RANGE[1];
export const MAX_PREDELAY = 0.5;
export const PREDELAY_OFFSET_RANGE = [0.5, 2] as const;
export const MOD_RATE_RANGE = [0.05, 10] as const;
export const MAX_WIDTH = 1.5;
export const LOW_CUT_RANGE = [20, 2000] as const;
export const HIGH_CUT_RANGE = [1000, 20000] as const;
export const MAX_DE_ESS = 24;
export const MAX_DUCK = 24;
export const DE_ESS_FREQ_RANGE = [4000, 12000] as const;
export const MAX_VLF_CUT = 18;
export const THRESHOLD_RANGE = [-60, 0] as const;
export const ATTACK_RANGE = [0.001, 0.1] as const;
export const RELEASE_RANGE = [0.02, 3] as const;
export const MAX_HOLD = 0.5;
export const MAX_AUTO_DECAY = 0.9;
export const RECOVERY_RANGE = [0.001, 0.5] as const;
export const LOW_SHELF_RANGE = [50, 500] as const;
export const HIGH_SHELF_RANGE = [1000, 16000] as const;
export const MAX_SHELF_GAIN = 12;
export const MONO_BELOW_RANGE = [20, 500] as const;
export const LEVEL_RANGE = [-24, 12] as const;
export const VARIATION_RANGE = [1, 1000] as const;
/** The Decay EQ's most bands (Pro-R 2's number), their multipliers' range and their Q's. */
export const REVERB_BANDS = 6;
export const MULTIPLIER_RANGE = [0.25, 4] as const;
export const BAND_Q_RANGE = [0.1, 10] as const;
export const BAND_FREQ_RANGE = [20, 20000] as const;
/**
 * How loud every factory preset's wet sound is against what goes in (LU, fully wet, pink noise): they're
 * matched to it (`output.level`, measured in `reverb.integration.test.ts`), so a send can be set for a
 * loudness under the voice whatever the preset (add_vocal_reverb).
 */
export const PRESET_LOUDNESS = -12;
/** The slot's Mix on an insert, as a new Reverb comes (engineers' insert mixes are 12–25 %). */
export const INSERT_MIX = 0.18;

/** The Decay EQ band a double-click makes, where it's clicked. */
export const DEFAULT_DECAY_BAND: Omit<ReverbDecayBand, "id"> = { enabled: true, shape: "bell", frequency: 1000, multiplier: 1, q: 1 };

/**
 * Init (7): Smooth Plate, Now, 1.8 s, a 20 ms pre-delay, and nothing else: no cuts, no de-essing, no
 * ducking. The base every preset sets its own values over.
 */
export const INIT_REVERB: ReverbState = {
  mode: "smoothPlate",
  era: "now",
  mix: INSERT_MIX,
  freeze: false,
  predelay: 0.02,
  sync: false,
  predelayNote: { note: 64, feel: "straight" },
  predelayOffset: 1,
  decay: 1.8,
  size: 0.5,
  distance: 0.25,
  diffusion: 0.6,
  modRate: 0.8,
  modDepth: 0.4,
  width: 1,
  lowCut: LOW_CUT_RANGE[0],
  highCut: HIGH_CUT_RANGE[1],
  lowCutSlope: 12,
  highCutSlope: 12,
  deEss: 0,
  duck: 0,
  input: { mode: "auto", cross: 0.3, lowCut: LOW_CUT_RANGE[0], highCut: HIGH_CUT_RANGE[1], deEssFreq: 6500, vlfCut: 0 },
  early: { send: 1, cross: 0.5 },
  late: { diffusion: null, modShape: "chorus", variation: 1, toneLock: true },
  ducking: { key: null, threshold: null, attack: 0.01, release: 0.25, releaseSync: false, releaseNote: { note: 8, feel: "straight" }, hold: 0.05, what: "tail", autoDecay: 0, recovery: 0.1 },
  output: { lowShelf: { frequency: 200, gain: 0 }, highShelf: { frequency: 8000, gain: 0 }, studio: false, monoBelow: 0, level: 0 },
  bands: [],
  bandsBypass: false,
};

export const DEFAULT_VIEW: Reverb["view"] = { display: "decay", advanced: false, analyzer: true, natural: true, logTime: false };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const slope = (v: unknown, fallback: 12 | 24): 12 | 24 => (v === 12 || v === 24 ? v : fallback);

function normalizeNote(input: unknown, fallback: ReverbNote): ReverbNote {
  if (!isObject(input)) return fallback;
  const note = REVERB_NOTES.includes(input.note as ReverbNote["note"]) ? (input.note as ReverbNote["note"]) : fallback.note;
  const feel = oneOf(input.feel, ["straight", "dotted", "triplet"] as const, fallback.feel);
  return note === fallback.note && feel === fallback.feel ? fallback : { note, feel };
}

function normalizeBand(input: unknown): ReverbDecayBand | null {
  if (!isObject(input) || !Number.isInteger(input.id) || (input.id as number) < 1 || (input.id as number) > REVERB_BANDS) return null;
  const d = DEFAULT_DECAY_BAND;
  return {
    id: input.id as number,
    enabled: bool(input.enabled, true),
    shape: oneOf(input.shape, REVERB_BAND_SHAPES, d.shape),
    frequency: num(input.frequency, BAND_FREQ_RANGE[0], BAND_FREQ_RANGE[1], d.frequency),
    multiplier: num(input.multiplier, MULTIPLIER_RANGE[0], MULTIPLIER_RANGE[1], d.multiplier),
    q: num(input.q, BAND_Q_RANGE[0], BAND_Q_RANGE[1], d.q),
  };
}

/** Decay: within its range, or ∞. */
const normalizeDecay = (v: unknown, fallback: number) => (isFiniteNumber(v) ? (v > REVERB_DECAY_RANGE[1] ? REVERB_INFINITE : clamp(v, REVERB_DECAY_RANGE[0], REVERB_DECAY_RANGE[1])) : fallback);
/** A cut: its range, its end the knob's "off". */
const cut = (v: unknown, range: readonly [number, number], fallback: number) => num(v, range[0], range[1], fallback);

/** What's heard, from anything (a saved song, the assistant, A/B's other side): each value kept to its range, the rest Init's. */
export function normalizeReverbState(input: unknown, base: ReverbState = INIT_REVERB): ReverbState {
  if (!isObject(input)) return base;
  const d = base;
  const i = isObject(input.input) ? input.input : {};
  const e = isObject(input.early) ? input.early : {};
  const l = isObject(input.late) ? input.late : {};
  const k = isObject(input.ducking) ? input.ducking : {};
  const o = isObject(input.output) ? input.output : {};
  const lowShelf = isObject(o.lowShelf) ? o.lowShelf : {};
  const highShelf = isObject(o.highShelf) ? o.highShelf : {};
  const seen = new Set<number>();
  const bands = !Array.isArray(input.bands)
    ? d.bands
    : input.bands
    .map(normalizeBand)
    .filter((b): b is ReverbDecayBand => !!b && !seen.has(b.id) && (seen.add(b.id), true))
    .slice(0, REVERB_BANDS)
    .sort((a, b) => a.id - b.id);
  const monoBelow = isFiniteNumber(o.monoBelow) && o.monoBelow >= MONO_BELOW_RANGE[0] ? clamp(o.monoBelow, MONO_BELOW_RANGE[0], MONO_BELOW_RANGE[1]) : isFiniteNumber(o.monoBelow) ? 0 : d.output.monoBelow;
  return {
    mode: oneOf(input.mode, REVERB_MODES, d.mode),
    era: oneOf(input.era, REVERB_ERAS, d.era),
    mix: num(input.mix, 0, 1, d.mix),
    freeze: bool(input.freeze, d.freeze),
    predelay: num(input.predelay, 0, MAX_PREDELAY, d.predelay),
    sync: bool(input.sync, d.sync),
    predelayNote: normalizeNote(input.predelayNote, d.predelayNote),
    predelayOffset: num(input.predelayOffset, PREDELAY_OFFSET_RANGE[0], PREDELAY_OFFSET_RANGE[1], d.predelayOffset),
    decay: normalizeDecay(input.decay, d.decay),
    size: num(input.size, 0, 1, d.size),
    distance: num(input.distance, 0, 1, d.distance),
    diffusion: num(input.diffusion, 0, 1, d.diffusion),
    modRate: num(input.modRate, MOD_RATE_RANGE[0], MOD_RATE_RANGE[1], d.modRate),
    modDepth: num(input.modDepth, 0, 1, d.modDepth),
    width: num(input.width, 0, MAX_WIDTH, d.width),
    lowCut: cut(input.lowCut, LOW_CUT_RANGE, d.lowCut),
    highCut: cut(input.highCut, HIGH_CUT_RANGE, d.highCut),
    lowCutSlope: slope(input.lowCutSlope, d.lowCutSlope),
    highCutSlope: slope(input.highCutSlope, d.highCutSlope),
    deEss: num(input.deEss, 0, MAX_DE_ESS, d.deEss),
    duck: num(input.duck, -MAX_DUCK, 0, d.duck),
    input: {
      mode: oneOf(i.mode, ["auto", "mono", "stereo"] as const, d.input.mode),
      cross: num(i.cross, 0, 1, d.input.cross),
      lowCut: cut(i.lowCut, LOW_CUT_RANGE, d.input.lowCut),
      highCut: cut(i.highCut, HIGH_CUT_RANGE, d.input.highCut),
      deEssFreq: num(i.deEssFreq, DE_ESS_FREQ_RANGE[0], DE_ESS_FREQ_RANGE[1], d.input.deEssFreq),
      vlfCut: num(i.vlfCut, -MAX_VLF_CUT, 0, d.input.vlfCut),
    },
    early: { send: num(e.send, 0, 1, d.early.send), cross: num(e.cross, 0, 1, d.early.cross) },
    late: {
      diffusion: l.diffusion === null ? null : isFiniteNumber(l.diffusion) ? clamp(l.diffusion, 0, 1) : d.late.diffusion,
      modShape: oneOf(l.modShape, ["chorus", "random"] as const, d.late.modShape),
      variation: Math.round(num(l.variation, VARIATION_RANGE[0], VARIATION_RANGE[1], d.late.variation)),
      toneLock: bool(l.toneLock, d.late.toneLock),
    },
    ducking: {
      key: typeof k.key === "string" && k.key ? k.key : k.key === null ? null : d.ducking.key,
      threshold: k.threshold === null ? null : isFiniteNumber(k.threshold) ? clamp(k.threshold, THRESHOLD_RANGE[0], THRESHOLD_RANGE[1]) : d.ducking.threshold,
      attack: num(k.attack, ATTACK_RANGE[0], ATTACK_RANGE[1], d.ducking.attack),
      release: num(k.release, RELEASE_RANGE[0], RELEASE_RANGE[1], d.ducking.release),
      releaseSync: bool(k.releaseSync, d.ducking.releaseSync),
      releaseNote: normalizeNote(k.releaseNote, d.ducking.releaseNote),
      hold: num(k.hold, 0, MAX_HOLD, d.ducking.hold),
      what: oneOf(k.what, ["tail", "all"] as const, d.ducking.what),
      autoDecay: num(k.autoDecay, 0, MAX_AUTO_DECAY, d.ducking.autoDecay),
      recovery: num(k.recovery, RECOVERY_RANGE[0], RECOVERY_RANGE[1], d.ducking.recovery),
    },
    output: {
      lowShelf: { frequency: num(lowShelf.frequency, LOW_SHELF_RANGE[0], LOW_SHELF_RANGE[1], d.output.lowShelf.frequency), gain: num(lowShelf.gain, -MAX_SHELF_GAIN, MAX_SHELF_GAIN, d.output.lowShelf.gain) },
      highShelf: { frequency: num(highShelf.frequency, HIGH_SHELF_RANGE[0], HIGH_SHELF_RANGE[1], d.output.highShelf.frequency), gain: num(highShelf.gain, -MAX_SHELF_GAIN, MAX_SHELF_GAIN, d.output.highShelf.gain) },
      studio: bool(o.studio, d.output.studio),
      monoBelow,
      level: num(o.level, LEVEL_RANGE[0], LEVEL_RANGE[1], d.output.level),
    },
    bands,
    bandsBypass: bool(input.bandsBypass, d.bandsBypass),
  };
}

/** Only what's heard, out of a whole Reverb (what A/B keeps, and what decides whether the sound changed). */
export const heardReverb = (r: ReverbState): ReverbState => normalizeReverbState(r);

/** A Reverb's settings from anything: each value kept to its range, the rest a new Reverb's. */
export function normalizeReverb(input: unknown): Reverb {
  if (!isObject(input)) return DEFAULT_REVERB;
  const state = normalizeReverbState(input, DEFAULT_REVERB);
  const v = isObject(input.view) ? input.view : {};
  return {
    ...state,
    preset: typeof input.preset === "string" && REVERB_PRESETS.some((p) => p.name === input.preset) ? input.preset : null,
    mixLock: bool(input.mixLock, DEFAULT_REVERB.mixLock),
    other: isObject(input.other) ? normalizeReverbState(input.other, DEFAULT_REVERB) : null,
    slot: input.slot === "b" ? "b" : "a",
    view: {
      display: oneOf(v.display, ["decay", "shape"] as const, DEFAULT_VIEW.display),
      advanced: bool(v.advanced, DEFAULT_VIEW.advanced),
      analyzer: bool(v.analyzer, DEFAULT_VIEW.analyzer),
      natural: bool(v.natural, DEFAULT_VIEW.natural),
      logTime: bool(v.logTime, DEFAULT_VIEW.logTime),
    },
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** The preset menu's folders (4.1). */
export const REVERB_FOLDERS = ["Lead Vocal", "Pairs", "Backing Vocals", "Throws & FX", "Other"] as const;
export type ReverbFolder = (typeof REVERB_FOLDERS)[number];

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? DeepPartial<NonNullable<T[K]>> | (null extends T[K] ? null : never) : T[K] };

/** A preset: its folder, a line on what it's for and where its numbers come from, and what it sets over Init. */
export interface ReverbPreset {
  name: string;
  folder: ReverbFolder | null;
  detail: string;
  settings: DeepPartial<ReverbState>;
}

/** What every vocal preset has (7): the onset's low shelf, and the wet sound's side taken out under 150 Hz. */
const VOCAL = { input: { vlfCut: -10 }, output: { monoBelow: 150 } } as const;
const note = (n: ReverbNote["note"], feel: ReverbNote["feel"] = "straight"): ReverbNote => ({ note: n, feel });
const synced = (n: ReverbNote["note"], feel: ReverbNote["feel"] = "straight") => ({ sync: true, predelayNote: note(n, feel) });
const mod = (rate: number, depth: number, shape: "chorus" | "random" = "chorus") => ({ modRate: rate, modDepth: depth, late: { modShape: shape } });
const OFF = { modDepth: 0 };

/**
 * The factory presets (7), vocal first: each from what engineers set and what the units' and makers' own
 * vocal presets do (`docs/reverb/reverb-vocals.md`). `output.level` matches their loudness (test 23).
 */
export const REVERB_PRESETS: readonly ReverbPreset[] = [
  // Lead vocal
  {
    name: "Vocal Plate",
    folder: "Lead Vocal",
    detail: "The all-round pop and R&B lead: glossy, behind the voice",
    settings: { ...VOCAL, mode: "smoothPlate", decay: 1.8, ...synced(64), size: 0.5, distance: 0.2, diffusion: 0.6, ...mod(0.8, 0.4), width: 1, lowCut: 200, highCut: 8000, duck: -4, deEss: 6 },
  },
  {
    name: "Vox Plate",
    folder: "Lead Vocal",
    detail: "The Bricasti M7's VOX Plate: expensive and dark-topped",
    settings: {
      ...VOCAL,
      mode: "smoothPlate",
      decay: 1.5,
      predelay: 0.024,
      size: 0.45,
      distance: 0.15,
      diffusion: 0.55,
      ...mod(0.8, 0.3),
      lowCut: 150,
      highCut: 6400,
      duck: -3,
      deEss: 6,
      bands: [
        { id: 1, enabled: true, shape: "lowShelf", frequency: 1200, multiplier: 0.85, q: 0.7 },
        { id: 2, enabled: true, shape: "highShelf", frequency: 5600, multiplier: 0.9, q: 0.7 },
      ],
    },
  },
  {
    name: "Classic Plate",
    folder: "Lead Vocal",
    detail: "The 140-style plate, static, its curve following Decay (Waves' 40 ms for vocals)",
    settings: { ...VOCAL, mode: "plate", era: "1980s", decay: 2.2, predelay: 0.04, size: 0.5, distance: 0, diffusion: 0.5, ...OFF, lowCut: 250, highCut: 8000, deEss: 4 },
  },
  {
    name: "Bright Pop Plate",
    folder: "Lead Vocal",
    detail: "Modern glossy pop, air on top; the s kept out by De-ess",
    settings: { ...VOCAL, mode: "smoothPlate", decay: 1.4, ...synced(64), size: 0.4, distance: 0.1, diffusion: 0.65, ...mod(0.8, 0.35), width: 1.1, lowCut: 300, highCut: 14000, duck: -6, deEss: 10, output: { highShelf: { frequency: 8000, gain: 2 } } },
  },
  {
    name: "Dark Plate",
    folder: "Lead Vocal",
    detail: "Soul and R&B warmth, a vintage tail (the M7's Dark Plate)",
    settings: { ...VOCAL, mode: "plate", era: "1970s", decay: 2.0, predelay: 0.03, size: 0.55, distance: 0.1, diffusion: 0.5, ...OFF, width: 0.9, lowCut: 200, highCut: 6000, duck: -3, deEss: 4 },
  },
  {
    name: "Rap Room",
    folder: "Lead Vocal",
    detail: "The dark short reverb under a rap vocal: felt, not heard (Firkins' D-Verb on Future: 15 ms, 751 ms, 9.36 kHz, 15% wet)",
    settings: { ...VOCAL, mode: "room", decay: 0.75, predelay: 0.015, size: 0.35, distance: 0.3, diffusion: 0.6, ...mod(0.6, 0.3, "random"), width: 0.9, lowCut: 250, highCut: 9000, duck: -6, deEss: 6, mix: 0.15 },
  },
  {
    name: "Vocal Chamber",
    folder: "Lead Vocal",
    detail: "The Capitol / Abbey Road chamber: density and size without a long reverb",
    settings: { ...VOCAL, mode: "chamber", decay: 1.2, predelay: 0.02, size: 0.45, distance: 0.25, diffusion: 0.7, ...mod(0.5, 0.4, "random"), lowCut: 600, highCut: 10000, duck: -3, deEss: 5, output: { studio: true } },
  },
  {
    name: "Air",
    folder: "Lead Vocal",
    detail: "Space and width for a dry-sounding modern vocal (the M7's Small Amb)",
    settings: { ...VOCAL, mode: "ambience", decay: 0.5, predelay: 0.02, size: 0.4, distance: 0.35, diffusion: 0.7, ...mod(0.4, 0.28, "random"), width: 1.2, lowCut: 400, highCut: 12000, deEss: 6 },
  },
  {
    name: "Ballad Hall",
    folder: "Lead Vocal",
    detail: "Long, lush, swelling in the gaps",
    settings: { ...VOCAL, mode: "hall", decay: 3.2, ...synced(16), size: 0.65, distance: 0.5, diffusion: 0.7, ...mod(0.7, 0.6), width: 1.1, lowCut: 250, highCut: 7000, duck: -8, deEss: 6 },
  },
  {
    name: "80s Hall",
    folder: "Lead Vocal",
    detail: "The 224 / 480L hall with its chorus",
    settings: { ...VOCAL, mode: "hall", era: "1980s", decay: 2.8, predelay: 0.06, size: 0.6, distance: 0.45, diffusion: 0.6, ...mod(0.9, 0.7), width: 1.1, lowCut: 200, highCut: 7000, duck: -4, deEss: 4 },
  },
  {
    name: "Intimate",
    folder: "Lead Vocal",
    detail: "Bedroom-pop closeness: a small room around a whisper",
    settings: { ...VOCAL, mode: "room", decay: 0.35, predelay: 0.02, size: 0.25, distance: 0.15, diffusion: 0.6, ...mod(0.4, 0.3, "random"), width: 0.8, lowCut: 300, highCut: 9000, deEss: 6 },
  },
  {
    name: "80s Rap Plate",
    folder: "Lead Vocal",
    detail: "The REV7's short metallic plate, ringing on purpose (Jess Jackson on Pop Smoke)",
    settings: { ...VOCAL, mode: "plate", era: "1980s", decay: 0.9, predelay: 0.02, size: 0.2, distance: 0.1, diffusion: 0.3, ...OFF, width: 0.9, lowCut: 300, highCut: 9000, duck: -4, deEss: 4 },
  },
  // Pairs: the short space where the voice sits, and the depth behind it (Senior's recipe)
  {
    name: "Pair A: Front Chamber",
    folder: "Pairs",
    detail: "The short space where the voice sits; with Pair B: Back Plate",
    settings: { ...VOCAL, mode: "chamber", decay: 0.9, predelay: 0.02, size: 0.4, distance: 0.25, diffusion: 0.7, ...mod(0.5, 0.4, "random"), lowCut: 600, highCut: 10000, deEss: 5 },
  },
  {
    name: "Pair B: Back Plate",
    folder: "Pairs",
    detail: "The depth behind it: longer, later, ducked; with Pair A: Front Chamber",
    settings: { ...VOCAL, mode: "smoothPlate", decay: 2.4, ...synced(16), size: 0.55, distance: 0.35, diffusion: 0.6, ...mod(0.8, 0.4), lowCut: 250, highCut: 9000, duck: -8, deEss: 6 },
  },
  {
    name: "Pair A: Rap Room",
    folder: "Pairs",
    detail: "The short room under a rap vocal; with Pair B: Rap Plate",
    settings: { ...VOCAL, mode: "room", decay: 0.5, predelay: 0.02, size: 0.35, distance: 0.3, diffusion: 0.6, ...mod(0.6, 0.3, "random"), width: 0.9, lowCut: 250, highCut: 9000, duck: -6, deEss: 6 },
  },
  {
    name: "Pair B: Rap Plate",
    folder: "Pairs",
    detail: "Only heard in the gaps; with Pair A: Rap Room",
    settings: { ...VOCAL, mode: "plate", decay: 1.6, ...synced(32), size: 0.45, distance: 0.2, diffusion: 0.5, ...OFF, lowCut: 300, highCut: 9000, duck: -10, deEss: 6 },
  },
  // Backing vocals and doubles
  {
    name: "Stack Wash",
    folder: "Backing Vocals",
    detail: "Doubles panned wide stay wide (stereo in)",
    settings: { ...VOCAL, mode: "hall", decay: 2.5, predelay: 0.03, size: 0.6, distance: 0.5, diffusion: 0.7, ...mod(0.7, 0.55), width: 1.4, lowCut: 300, highCut: 8000, duck: -4, deEss: 6, input: { mode: "stereo", vlfCut: -10 } },
  },
  {
    name: "Harmony Plate",
    folder: "Backing Vocals",
    detail: "A different space from the lead's",
    settings: { ...VOCAL, mode: "smoothPlate", decay: 2.0, predelay: 0.04, size: 0.55, distance: 0.3, diffusion: 0.6, ...mod(0.8, 0.45), width: 1.3, lowCut: 300, highCut: 9000, deEss: 6 },
  },
  {
    name: "Choir Chamber",
    folder: "Backing Vocals",
    detail: "Stacks into one room (stereo in)",
    settings: { ...VOCAL, mode: "chamber", decay: 1.8, predelay: 0.02, size: 0.55, distance: 0.35, diffusion: 0.7, ...mod(0.5, 0.4, "random"), width: 1.2, lowCut: 250, highCut: 9000, deEss: 5, input: { mode: "stereo", vlfCut: -10 } },
  },
  // Throws and effects
  {
    name: "Throw Wash",
    folder: "Throws & FX",
    detail: "A long ducked wash: automate the send on the last word",
    settings: { ...VOCAL, mode: "hall", decay: 8, ...synced(8), size: 0.85, distance: 0.6, diffusion: 0.7, ...mod(0.6, 0.8), width: 1.3, lowCut: 300, highCut: 7000, duck: -12, deEss: 8 },
  },
  {
    name: "Infinite",
    folder: "Throws & FX",
    detail: "Freeze on a word, a pad underneath",
    settings: { ...VOCAL, mode: "smoothPlate", decay: REVERB_INFINITE, predelay: 0.02, size: 0.7, distance: 0.4, diffusion: 0.7, ...mod(0.6, 0.5), width: 1.2, lowCut: 250, highCut: 8000, deEss: 8 },
  },
  {
    name: "Chorus Verb",
    folder: "Throws & FX",
    detail: "The Chorus Verb aux (Olivia Rodrigo's mix): about 14 cents of chorus",
    settings: { ...VOCAL, mode: "hall", decay: 2.4, predelay: 0.03, size: 0.55, distance: 0.4, diffusion: 0.7, ...mod(1.6, 0.9), width: 1.2, lowCut: 250, highCut: 8000, duck: -4, deEss: 6 },
  },
  {
    name: "EMT 250 Chorus",
    folder: "Throws & FX",
    detail: "The EMT 250, which sounded like a chorus unit",
    settings: {
      ...VOCAL,
      mode: "hall",
      era: "1970s",
      decay: 2.0,
      predelay: 0.04,
      size: 0.5,
      distance: 0.35,
      diffusion: 0.6,
      ...mod(1.2, 1, "random"),
      lowCut: 200,
      highCut: 8000,
      deEss: 4,
      bands: [
        { id: 1, enabled: true, shape: "highShelf", frequency: 6000, multiplier: 0.33, q: 0.7 },
        { id: 2, enabled: true, shape: "lowShelf", frequency: 300, multiplier: 1.5, q: 0.7 },
      ],
    },
  },
  {
    name: "Back Of The Hall",
    folder: "Throws & FX",
    detail: "The Quantec's reverb from the back of the hall: pushed behind the source",
    settings: { ...VOCAL, mode: "hall", era: "1980s", decay: 2.0, predelay: 0.03, size: 0.6, distance: 1, diffusion: 0.5, ...OFF, lowCut: 200, highCut: 8000, deEss: 4 },
  },
  {
    name: "Lo-Fi Verb",
    folder: "Throws & FX",
    detail: "Radio-ish: a 1970s plate through a narrow band",
    settings: { mode: "plate", era: "1970s", decay: 1.6, predelay: 0.02, size: 0.45, distance: 0.2, diffusion: 0.5, ...OFF, lowCut: 500, highCut: 5000 },
  },
  // Other sources
  { name: "Snare Plate", folder: "Other", detail: "The 80s snare plate", settings: { mode: "plate", era: "1980s", decay: 1.2, predelay: 0.005, size: 0.45, distance: 0.1, diffusion: 0.75, ...OFF, lowCut: 200, highCut: 10000 } },
  { name: "Drum Room", folder: "Other", detail: "A close room for a kit", settings: { mode: "room", decay: 0.7, predelay: 0, size: 0.5, distance: 0, diffusion: 0.75, ...mod(0.6, 0.3, "random"), lowCut: 80, highCut: 12000 } },
  { name: "Keys Hall", folder: "Other", detail: "A hall for piano and keys", settings: { mode: "hall", decay: 2.6, predelay: 0.025, size: 0.6, distance: 0.4, diffusion: 0.7, ...mod(0.6, 0.45), lowCut: 120, highCut: 9000 } },
  { name: "Synth Space", folder: "Other", detail: "A long modulated space for pads", settings: { mode: "hall", decay: 6, predelay: 0.04, size: 0.9, distance: 0.6, diffusion: 0.8, ...mod(0.8, 0.85), width: 1.3, lowCut: 150, highCut: 8000 } },
  { name: "Acoustic Chamber", folder: "Other", detail: "A chamber for acoustic guitar", settings: { mode: "chamber", decay: 1.4, predelay: 0.015, size: 0.5, distance: 0.3, diffusion: 0.7, ...mod(0.5, 0.4, "random"), lowCut: 150, highCut: 10000 } },
  { name: "Init", folder: null, detail: "Smooth Plate, 1.8 s, nothing else", settings: {} },
];

/**
 * Each preset's output trim (dB), so their wet sounds are as loud as each other (`PRESET_LOUDNESS` against
 * what goes in, fully wet, pink noise, ducking off): measured by `reverb.integration.test.ts`'s "presets at
 * one loudness", which fails when one drifts.
 */
export const PRESET_LEVELS: Record<string, number> = {
  "Vocal Plate": 0.1,
  "Vox Plate": 1.2,
  "Classic Plate": -1.2,
  "Bright Pop Plate": 1.2,
  "Dark Plate": -0.5,
  "Rap Room": 2.0,
  "Vocal Chamber": 1.8,
  "Air": 0.8,
  "Ballad Hall": -0.5,
  "80s Hall": -0.9,
  "Intimate": 1.2,
  "80s Rap Plate": 2.5,
  "Pair A: Front Chamber": 1.9,
  "Pair B: Back Plate": -1.3,
  "Pair A: Rap Room": 2.5,
  "Pair B: Rap Plate": 0.2,
  "Stack Wash": -1.1,
  "Harmony Plate": -1.5,
  "Choir Chamber": -0.7,
  "Throw Wash": -3.0,
  "Infinite": -11.7,
  "Chorus Verb": -0.7,
  "EMT 250 Chorus": -0.6,
  "Back Of The Hall": 0.1,
  "Lo-Fi Verb": 0.1,
  "Snare Plate": -0.1,
  "Drum Room": -5.5,
  "Keys Hall": -2.1,
  "Synth Space": -4.1,
  "Acoustic Chamber": -1.3,
  "Init": -4.0,
};

/** The preset a new Reverb loads (7): the vocal default. */
export const DEFAULT_PRESET = "Vocal Plate";

/** Deep-merge a preset's settings over a state (arrays replaced). */
function merged<T>(base: T, over: unknown): T {
  if (!isObject(over) || !isObject(base)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = isObject(value) && isObject(out[key]) ? merged(out[key], value) : value;
  return out as T;
}

/** A preset's sound, whole (Init's values where it says nothing). */
export function reverbPresetState(name: string): ReverbState | null {
  const preset = REVERB_PRESETS.find((p) => p.name === name);
  if (!preset) return null;
  const state = normalizeReverbState(merged(INIT_REVERB, preset.settings));
  return { ...state, output: { ...state.output, level: Math.round((state.output.level + (PRESET_LEVELS[name] ?? 0)) * 10) / 10 } };
}

/** Whether a preset sets the Mix (the one insert preset, Rap Room); the others leave it. */
export const presetSetsMix = (name: string) => REVERB_PRESETS.find((p) => p.name === name)?.settings.mix !== undefined;

/** A new Reverb: the vocal default, at an insert's Mix. */
export const DEFAULT_REVERB: Reverb = {
  ...reverbPresetState(DEFAULT_PRESET)!,
  mix: INSERT_MIX,
  preset: DEFAULT_PRESET,
  mixLock: false,
  other: null,
  slot: "a",
  view: DEFAULT_VIEW,
};

// ---------------------------------------------------------------------------
// The assistant's names for its controls
// ---------------------------------------------------------------------------

/** The Reverb's controls as the assistant names them (`add_automation`'s `control`). */
export const REVERB_TOOL_CONTROLS = {
  "reverb mix": "mix",
  "reverb decay": "decay",
  "reverb freeze": "freeze",
  "reverb predelay": "predelay",
  "reverb size": "size",
  "reverb distance": "distance",
  "reverb diffusion": "diffusion",
  "reverb mod rate": "modRate",
  "reverb mod": "modDepth",
  "reverb width": "width",
  "reverb low cut": "lowCut",
  "reverb high cut": "highCut",
  "reverb de-ess": "deEss",
  "reverb duck": "duck",
  "reverb input cross": "inputCross",
  "reverb input low cut": "inputLowCut",
  "reverb input high cut": "inputHighCut",
  "reverb de-ess freq": "deEssFreq",
  "reverb vlf cut": "vlfCut",
  "reverb predelay offset": "predelayOffset",
  "reverb early send": "earlySend",
  "reverb early cross": "earlyCross",
  "reverb late diffusion": "lateDiffusion",
  "reverb duck threshold": "threshold",
  "reverb duck attack": "attack",
  "reverb duck release": "release",
  "reverb duck hold": "hold",
  "reverb auto decay": "autoDecay",
  "reverb recovery": "recovery",
  "reverb low shelf freq": "lowShelfFreq",
  "reverb low shelf gain": "lowShelfGain",
  "reverb high shelf freq": "highShelfFreq",
  "reverb high shelf gain": "highShelfGain",
  "reverb mono below": "monoBelow",
  "reverb output": "level",
} as const satisfies Record<string, ReverbControl>;
export type ReverbToolControl = keyof typeof REVERB_TOOL_CONTROLS;
export const REVERB_TOOL_CONTROL_NAMES = Object.keys(REVERB_TOOL_CONTROLS) as ReverbToolControl[];
/** Controls the assistant gives in milliseconds (the song keeps seconds). */
export const REVERB_MS_CONTROLS: readonly ReverbControl[] = ["predelay", "attack", "release", "hold", "recovery"];

/** Each control's values, said for the model (as add_automation takes them). */
export const REVERB_HINTS: Record<ReverbControl, string> = {
  mix: "0 to 1 (equal power: 0.15 to 0.25 on an insert, 1 on a send)",
  decay: `seconds, 0.1 to 60 (61: ∞, the loop held)`,
  freeze: "0 (off) or 1 (on: the tail held, nothing new in)",
  predelay: "milliseconds, 0 to 500",
  size: "0 to 1",
  distance: "0 (near) to 1 (far)",
  diffusion: "0 to 1",
  modRate: "Hz, 0.05 to 10",
  modDepth: "0 to 1",
  width: "0 (mono) to 1.5",
  lowCut: "Hz, 20 (off) to 2000",
  highCut: "Hz, 1000 to 20000 (off)",
  deEss: "dB, 0 to 24",
  duck: "dB, -24 to 0",
  inputCross: "0 to 1",
  inputLowCut: "Hz, 20 (off) to 2000",
  inputHighCut: "Hz, 1000 to 20000 (off)",
  deEssFreq: "Hz, 4000 to 12000",
  vlfCut: "dB, -18 to 0",
  predelayOffset: "0.5 to 2 (× a synced pre-delay)",
  earlySend: "0 to 1",
  earlyCross: "0 to 1",
  lateDiffusion: "0 to 1",
  threshold: "dB, -60 to 0",
  attack: "milliseconds, 1 to 100",
  release: "milliseconds, 20 to 3000",
  hold: "milliseconds, 0 to 500",
  autoDecay: "0 to 0.9",
  recovery: "milliseconds, 1 to 500",
  lowShelfFreq: "Hz, 50 to 500",
  lowShelfGain: "dB, -12 to 12",
  highShelfFreq: "Hz, 1000 to 16000",
  highShelfGain: "dB, -12 to 12",
  monoBelow: "Hz, 0 (off) or 20 to 500",
  level: "dB, -24 to 12",
};
