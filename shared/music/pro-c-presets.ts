/**
 * Pro-C's constants, its styles, its default, how its settings are validated, and its presets
 * (`docs/fabfilter/pro-c.md`, `pro-c-vocals.md`).
 *
 * Only types and constants are imported (and Pro-Q's band validation), so `project.ts` can use this to
 * normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { DEFAULT_BAND, normalizeEqBand } from "./pro-q-presets.ts";
import {
  type EqBand,
  PRO_C_AUDIO_MODES,
  PRO_C_CHARACTERS,
  PRO_C_DETECTORS,
  PRO_C_LINK_MODES,
  PRO_C_RECOVERIES,
  PRO_C_STYLES,
  PRO_C_SYNC_NOTES,
  PRO_C_TIME_MODES,
  PRO_C_TRIGGERS,
  type PluginRef,
  type ProC,
  type ProCControl,
  type ProCOptions,
  type ProCSidechain,
  type ProCState,
  type ProCStyle,
} from "./types.ts";

/** What a Pro-C is, as a slot's plugin: one of ours, run by the engine itself. */
export const PRO_C_PLUGIN: PluginRef = { id: "vaudio:pro-c", name: "YT-C", format: "Vaudio" };
export const isProC = (plugin: Pick<PluginRef, "id">) => plugin.id === PRO_C_PLUGIN.id;

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export const PRO_C_THRESHOLD_RANGE = [-60, 0] as const;
export const PRO_C_MAX_KNEE = 72;
export const PRO_C_MAX_RANGE = 60;
/** Seconds (Pro-C 3's attack goes down to 0.005 ms). */
export const PRO_C_ATTACK_RANGE = [0.000005, 0.25] as const;
export const PRO_C_RELEASE_RANGE = [0.005, 5] as const;
export const PRO_C_MAX_HOLD = 0.5;
/** Maximum Lookahead's choices besides Off: 1 … 20 ms. */
export const PRO_C_MAX_LOOKAHEAD = 0.02;
export const PRO_C_GAIN_RANGE = [-36, 36] as const;
export const PRO_C_MAX_MIX = 2;
export const PRO_C_OVERSAMPLING = [1, 2, 4, 8, 16] as const;
/** Side chain EQ bands at most (Pro-C 3's six). */
export const PRO_C_BANDS = 6;
export const PRO_C_MAX_EMPHASIS = 10;
export const PRO_C_LIMITER_RANGE = [-24, 0] as const;
export const PRO_C_GATE_RANGE = [-90, 0] as const;
export const PRO_C_CEILING_RANGE = [-24, 0] as const;
/** The level display's scales (dB shown, from 0 down). */
export const PRO_C_SCALES = [9, 18, 36, 54, 72, 90] as const;

/** The ratio as its slope (`ProCState.slope`), and back: ∞:1 is a slope of 1. */
export const slopeOf = (ratio: number) => (ratio >= 1e6 ? 1 : clamp(1 - 1 / Math.max(1, ratio), 0, 1));
export const ratioOf = (slope: number) => (slope >= 1 - 1e-9 ? Infinity : 1 / (1 - clamp(slope, 0, 1)));
/** The dots round Pro-C's Ratio knob: a click jumps to one. */
export const PRO_C_RATIO_DOTS = [1.5, 2, 3, 4, 6, 10, 20, Infinity] as const;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type ProCGroup = "modern" | "classic" | "utility" | "vintage";
export const PRO_C_GROUPS: readonly { id: ProCGroup; name: string; styles: readonly ProCStyle[] }[] = [
  { id: "modern", name: "Modern", styles: ["clean", "versatile", "smooth", "punch", "upward", "ttm"] },
  { id: "classic", name: "Classic", styles: ["opEl", "variMu", "classic", "opto"] },
  { id: "utility", name: "Utility", styles: ["vocal", "vox", "mastering", "bus", "pumping"] },
  { id: "vintage", name: "Vintage", styles: ["fet", "opto2a", "optoTube", "distress", "vca160", "diode609"] },
];

/** A style as the menu shows it: its name, and a line on what it is and what it's for. */
export const PRO_C_STYLE_INFO: Record<ProCStyle, { name: string; detail: string }> = {
  clean: { name: "Clean", detail: "Low distortion, feedforward, program dependent: does what the knobs say, on anything" },
  versatile: { name: "Versatile", detail: "Punchy at longer attacks, tight and smooth at short ones" },
  smooth: { name: "Smooth", detail: "Never grabs: glue at low ratios and slow times" },
  punch: { name: "Punch", detail: "Analog-like: lets the first milliseconds through, a little grab" },
  upward: { name: "Upward", detail: "Turns up what's quiet: detail, tails, room (and breaths)" },
  ttm: { name: "TTM", detail: "To The Max: three bands, up and down, OTT's sound" },
  opEl: { name: "Op-El", detail: "Opto-like tube compression, smooth and warm" },
  variMu: { name: "Vari-Mu", detail: "Remote-cutoff tubes: thicker the harder it's driven" },
  classic: { name: "Classic", detail: "Vintage feedback, very program dependent" },
  opto: { name: "Opto", detail: "Slow, very soft knee, clean: a gentle leveller" },
  vocal: { name: "Vocal", detail: "Brings a vocal forward: automatic knee and ratio, just set the threshold" },
  vox: { name: "Vox", detail: "One fader, after RVox: compression, a gate and a ceiling" },
  mastering: { name: "Mastering", detail: "As transparent as possible, still catching fast peaks" },
  bus: { name: "Bus", detail: "The console bus compressor's glue" },
  pumping: { name: "Pumping", detail: "Deep, over-the-top pumping" },
  fet: { name: "FET 76", detail: "After the 1176: fast, bright, attitude. All buttons for the crush" },
  opto2a: { name: "Opto 2A", detail: "After the LA-2A: the leveller with a memory" },
  optoTube: { name: "Opto Tube", detail: "After the CL 1B: smooth tracking compression, Fix / Man" },
  distress: { name: "Distress", detail: "After the Distressor: a curve per ratio, Nuke, Dist 2 and 3" },
  vca160: { name: "VCA 160", detail: "After the dbx 160: RMS, hard or Over Easy, the crush" },
  diode609: { name: "Diode 609", detail: "After the 33609: diode-bridge colour, a1 / a2 recovery" },
};

export const styleGroup = (style: ProCStyle): ProCGroup => PRO_C_GROUPS.find((g) => g.styles.includes(style))!.id;
export const isVintage = (style: ProCStyle) => styleGroup(style) === "vintage";

/** A Vintage style's ratio positions (as ratios; Nuke and All are ∞ and 16 here): the buttons it shows. */
export const VINTAGE_RATIOS: Partial<Record<ProCStyle, readonly { label: string; ratio: number }[]>> = {
  fet: [
    { label: "4", ratio: 4 },
    { label: "8", ratio: 8 },
    { label: "12", ratio: 12 },
    { label: "20", ratio: 20 },
  ],
  distress: [
    { label: "1:1", ratio: 1 },
    { label: "2:1", ratio: 2 },
    { label: "3:1", ratio: 3 },
    { label: "4:1", ratio: 4 },
    { label: "6:1", ratio: 6 },
    { label: "10:1", ratio: 10 },
    { label: "20:1", ratio: 20 },
    { label: "Nuke", ratio: Infinity },
  ],
  diode609: [
    { label: "1.5", ratio: 1.5 },
    { label: "2", ratio: 2 },
    { label: "3", ratio: 3 },
    { label: "4", ratio: 4 },
    { label: "6", ratio: 6 },
  ],
};

/** The time knobs a Vintage style has: their range (seconds) and their dial (its numbers at each end; the 1176's run backwards). */
export interface VintageDial {
  min: number;
  max: number;
  /** The dial's numbers: at `min` and at `max` (the 1176's 7 is its fastest). */
  from: number;
  to: number;
}
export const VINTAGE_TIMES: Partial<Record<ProCStyle, { attack: VintageDial; release: VintageDial }>> = {
  fet: { attack: { min: 0.00002, max: 0.0008, from: 7, to: 1 }, release: { min: 0.05, max: 1.1, from: 7, to: 1 } },
  distress: { attack: { min: 0.00005, max: 0.03, from: 0, to: 10 }, release: { min: 0.05, max: 3.5, from: 0, to: 10 } },
  optoTube: { attack: { min: 0.0005, max: 0.3, from: 0, to: 10 }, release: { min: 0.05, max: 10, from: 0, to: 10 } },
};
/** Diode 609's stepped times: its attacks (Fast, Slow) and recoveries. */
export const DIODE_ATTACKS = [0.003, 0.006] as const;
export const DIODE_RECOVERIES = [0.1, 0.4, 0.8, 1.5] as const;

/** A dial's number for a time (log between its ends), and back. */
export function dialOf(dial: VintageDial, seconds: number): number {
  const f = Math.log(clamp(seconds, dial.min, dial.max) / dial.min) / Math.log(dial.max / dial.min);
  return dial.from + f * (dial.to - dial.from);
}
export function secondsOfDial(dial: VintageDial, value: number): number {
  const f = clamp((value - dial.from) / (dial.to - dial.from), 0, 1);
  return dial.min * (dial.max / dial.min) ** f;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PRO_C_OPTIONS: ProCOptions = {
  link: true,
  allButtons: false,
  limit: false,
  emphasis: 0,
  timeMode: "manual",
  detector: "norm",
  audio: "norm",
  british: false,
  overEasy: false,
  auto: true,
  recovery: "manual",
  limiter: null,
  gate: null,
  ceiling: 0,
};

/** A side chain high-pass: what keeps a vocal's plosives and the low end from triggering it. */
export const sidechainHighPass = (frequency: number, id = 1): EqBand => ({ ...DEFAULT_BAND, id, shape: "lowCut", frequency, slope: 12, gain: 0, q: 1, dynamics: false });

/** The preset a quick duck loads (`duckWithProC`): External, ∞:1, 1 ms / 150 ms. */
export const DUCK_PRESET = "Sidechain – Duck to Kick";

export const DEFAULT_PRO_C_SIDECHAIN: ProCSidechain = {
  trigger: "internal",
  level: 0,
  link: 1,
  linkMode: "mid",
  bands: [],
  sync: { note: 4, offset: 1, length: 0.5 },
};

/**
 * A new Pro-C: vocals first (Théo's main use), so the Vocal style (its preset, Vocal – Upfront): a side
 * chain high-pass at 120 Hz, Auto Release and Auto Gain on, no lookahead and no oversampling: no latency, so a vocal can be recorded through it.
 */
export const DEFAULT_PRO_C_STATE: ProCState = {
  style: "vocal",
  threshold: -18,
  autoThreshold: false,
  slope: 0.75,
  knee: 6,
  range: 40,
  attack: 0.005,
  release: 0.1,
  autoRelease: true,
  lookahead: 0,
  hold: 0,
  wet: 0,
  wetPan: 0,
  autoGain: true,
  dry: null,
  dryPan: 0,
  character: { mode: "off", drive: 0.3, post: true },
  sidechain: { ...DEFAULT_PRO_C_SIDECHAIN, bands: [sidechainHighPass(120)] },
  input: 0,
  inputPan: 0,
  output: 0,
  outputPan: 0,
  mix: 1,
  options: DEFAULT_PRO_C_OPTIONS,
  oversampling: 1,
  maxLookahead: 0,
};

export const DEFAULT_PRO_C: ProC = {
  ...DEFAULT_PRO_C_STATE,
  preset: "Vocal – Upfront",
  other: null,
  slot: "a",
  view: { knee: true, scale: 36, compact: false, sidechain: false },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const orNull = (v: unknown, min: number, max: number) => (isFiniteNumber(v) ? clamp(v, min, max) : null);

function normalizeOptions(input: unknown): ProCOptions {
  if (!isObject(input)) return DEFAULT_PRO_C_OPTIONS;
  const d = DEFAULT_PRO_C_OPTIONS;
  const options: ProCOptions = {
    link: input.link !== false,
    allButtons: input.allButtons === true,
    limit: input.limit === true,
    emphasis: num(input.emphasis, 0, PRO_C_MAX_EMPHASIS, d.emphasis),
    timeMode: oneOf(PRO_C_TIME_MODES, input.timeMode, d.timeMode),
    detector: oneOf(PRO_C_DETECTORS, input.detector, d.detector),
    audio: oneOf(PRO_C_AUDIO_MODES, input.audio, d.audio),
    british: input.british === true,
    overEasy: input.overEasy === true,
    auto: input.auto !== false,
    recovery: oneOf(PRO_C_RECOVERIES, input.recovery, d.recovery),
    limiter: orNull(input.limiter, PRO_C_LIMITER_RANGE[0], PRO_C_LIMITER_RANGE[1]),
    gate: orNull(input.gate, PRO_C_GATE_RANGE[0], PRO_C_GATE_RANGE[1]),
    ceiling: num(input.ceiling, PRO_C_CEILING_RANGE[0], PRO_C_CEILING_RANGE[1], d.ceiling),
  };
  return JSON.stringify(options) === JSON.stringify(d) ? d : options;
}

function normalizeSidechain(input: unknown): ProCSidechain {
  if (!isObject(input)) return DEFAULT_PRO_C_SIDECHAIN;
  const d = DEFAULT_PRO_C_SIDECHAIN;
  const seen = new Set<number>();
  const bands = (Array.isArray(input.bands) ? input.bands : [])
    .flatMap((b) => normalizeEqBand(b, seen, PRO_C_BANDS) ?? [])
    // Its bands are stereo, mid or side (not left or right), and never dynamic.
    .map(({ external: _, ...b }) => ({ ...b, placement: b.placement === "mid" || b.placement === "side" ? b.placement : "stereo", dynamics: false, range: 0, threshold: null }) satisfies EqBand)
    .slice(0, PRO_C_BANDS);
  const sync = isObject(input.sync) ? input.sync : {};
  return {
    trigger: oneOf(PRO_C_TRIGGERS, input.trigger, d.trigger),
    level: num(input.level, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1], d.level),
    link: num(input.link, 0, 2, d.link),
    linkMode: oneOf(PRO_C_LINK_MODES, input.linkMode, d.linkMode),
    bands,
    sync: {
      note: oneOf(PRO_C_SYNC_NOTES, sync.note, d.sync.note),
      offset: num(sync.offset, 0.5, 2, d.sync.offset),
      length: num(sync.length, 0.05, 1, d.sync.length),
    },
  };
}

/** What A/B swaps, from anything: each value kept to its range, the rest defaults. */
export function normalizeProCState(input: unknown): ProCState {
  if (!isObject(input)) return DEFAULT_PRO_C_STATE;
  const d = DEFAULT_PRO_C_STATE;
  const character = isObject(input.character) ? input.character : {};
  const maxLookahead = isFiniteNumber(input.maxLookahead) && input.maxLookahead >= 0.0005 ? clamp(Math.round(input.maxLookahead * 1000) / 1000, 0.001, PRO_C_MAX_LOOKAHEAD) : 0;
  return {
    style: oneOf(PRO_C_STYLES, input.style, d.style),
    threshold: num(input.threshold, PRO_C_THRESHOLD_RANGE[0], PRO_C_THRESHOLD_RANGE[1], d.threshold),
    autoThreshold: input.autoThreshold === true,
    slope: num(input.slope, 0, 1, d.slope),
    knee: num(input.knee, 0, PRO_C_MAX_KNEE, d.knee),
    range: num(input.range, 0, PRO_C_MAX_RANGE, d.range),
    attack: num(input.attack, PRO_C_ATTACK_RANGE[0], PRO_C_ATTACK_RANGE[1], d.attack),
    release: num(input.release, PRO_C_RELEASE_RANGE[0], PRO_C_RELEASE_RANGE[1], d.release),
    autoRelease: input.autoRelease === true,
    lookahead: num(input.lookahead, 0, maxLookahead, 0),
    hold: num(input.hold, 0, PRO_C_MAX_HOLD, d.hold),
    wet: num(input.wet, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1], d.wet),
    wetPan: num(input.wetPan, -1, 1, 0),
    autoGain: input.autoGain !== false,
    dry: orNull(input.dry, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1]),
    dryPan: num(input.dryPan, -1, 1, 0),
    character: {
      mode: oneOf(PRO_C_CHARACTERS, character.mode, d.character.mode),
      drive: num(character.drive, 0, 1, d.character.drive),
      post: character.post !== false,
    },
    sidechain: normalizeSidechain(input.sidechain),
    input: num(input.input, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1], 0),
    inputPan: num(input.inputPan, -1, 1, 0),
    output: num(input.output, PRO_C_GAIN_RANGE[0], PRO_C_GAIN_RANGE[1], 0),
    outputPan: num(input.outputPan, -1, 1, 0),
    mix: num(input.mix, 0, PRO_C_MAX_MIX, 1),
    options: normalizeOptions(input.options),
    oversampling: oneOf(PRO_C_OVERSAMPLING, input.oversampling, 1),
    maxLookahead,
  };
}

/** A Pro-C's settings from anything (a saved song, the assistant). */
export function normalizeProC(input: unknown): ProC {
  if (!isObject(input)) return DEFAULT_PRO_C;
  const view = isObject(input.view) ? input.view : {};
  const d = DEFAULT_PRO_C.view;
  return {
    ...normalizeProCState(input),
    preset: typeof input.preset === "string" && PRO_C_PRESETS.some((p) => p.name === input.preset) ? input.preset : null,
    other: isObject(input.other) ? normalizeProCState(input.other) : null,
    slot: input.slot === "b" ? "b" : "a",
    view: {
      knee: view.knee !== false,
      scale: oneOf<number>(PRO_C_SCALES, view.scale, d.scale),
      compact: view.compact === true,
      sidechain: view.sidechain === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** A preset: what it sets (the rest is the default), what it's for, and where it comes from. */
export interface ProCPreset {
  name: string;
  /** Its folder in the menu. */
  folder: "Vocals" | "Drums" | "Bass" | "Mix" | "Special";
  detail: string;
  settings: Partial<Omit<ProCState, "options" | "sidechain" | "character">> & {
    options?: Partial<ProCOptions>;
    sidechain?: Partial<ProCSidechain>;
    character?: Partial<ProCState["character"]>;
  };
}

const hp = (frequency: number) => ({ bands: [sidechainHighPass(frequency)] });
const noBands = { bands: [] };

/** Ours (FabFilter publishes no list): the vocal ones from the engineers' settings (`docs/fabfilter/pro-c.md` 6). */
export const PRO_C_PRESETS: readonly ProCPreset[] = [
  { name: "Default Setting", folder: "Mix", detail: "A starting point: Clean, 4:1, 10 ms / 100 ms, Auto Gain", settings: { style: "clean", threshold: -18, slope: 0.75, knee: 6, attack: 0.01, release: 0.1, sidechain: noBands } },
  {
    name: "Vocal – Rough Mix",
    folder: "Vocals",
    detail: "The quick finished vocal to write over: dense and upfront without lifting the gaps",
    settings: { style: "vocal", threshold: -26, attack: 0.001, autoRelease: true, dry: -12, sidechain: hp(100), character: { mode: "tube", drive: 0.3, post: true } },
  },
  { name: "Vocal – Upfront", folder: "Vocals", detail: "Pro-C's one-knob lead vocal: set the threshold", settings: { style: "vocal", threshold: -18, attack: 0.005, release: 0.1, sidechain: hp(120), autoRelease: true } },
  { name: "Vocal – Vox", folder: "Vocals", detail: "RVox's way: one Compression fader, a gate under it, a ceiling", settings: { style: "vox", threshold: -18, options: { ceiling: -1, gate: null }, sidechain: hp(100) } },
  {
    name: "Vocal – FET Catch",
    folder: "Vocals",
    detail: "First stage: 4:1, attack 3, release 7 (CLA, Grech-Marguerat, Baptie)",
    settings: { style: "fet", threshold: -22, slope: 0.75, attack: 0.00023, release: 0.05, sidechain: hp(80), autoGain: false },
  },
  { name: "Vocal – Opto Level", folder: "Vocals", detail: "Second stage: the LA-2A's \"4 to 8 dB of compression continuously\"", settings: { style: "opto2a", threshold: -16, autoGain: false, sidechain: noBands } },
  {
    name: "Vocal – Tracking Opto",
    folder: "Vocals",
    detail: "The CL 1B's vocal setting: ~3.5:1, Manual, 30 ms / 0.6 s, 4–5 dB",
    settings: { style: "optoTube", threshold: -24, slope: slopeOf(3.5), attack: 0.03, release: 0.6, options: { timeMode: "manual" }, sidechain: noBands },
  },
  {
    name: "Vocal – Clean Control",
    folder: "Vocals",
    detail: "The RComp role in rap and R&B chains: soft knee, auto release",
    settings: { style: "clean", threshold: -22, slope: slopeOf(5), knee: 12, attack: 0.016, release: 0.16, autoRelease: true, sidechain: hp(100) },
  },
  {
    name: "Vocal – Distress Grit",
    folder: "Vocals",
    detail: "Empirical Labs' vocal setting: 6:1, attack 5, release 4, HP, Dist 2",
    settings: { style: "distress", threshold: -20, slope: slopeOf(6), attack: 0.0012, release: 0.27, options: { detector: "hp", audio: "dist2hp" }, sidechain: noBands, autoGain: false },
  },
  { name: "Vocal – VCA Crush", folder: "Vocals", detail: "The dbx 160 crush: Auto, hard knee, 6:1", settings: { style: "vca160", threshold: -26, slope: slopeOf(6), options: { auto: true, overEasy: false }, sidechain: hp(90) } },
  { name: "Vocal – Diode Catch", folder: "Vocals", detail: "A 33609 first stage: 3:1, Fast, a1", settings: { style: "diode609", threshold: -20, slope: slopeOf(3), attack: 0.003, release: 0.1, options: { recovery: "a1" }, sidechain: noBands } },
  {
    name: "Vocal – Parallel Crush",
    folder: "Vocals",
    detail: "10–20 dB of FET all buttons under the dry vocal: blend with Wet",
    settings: { style: "fet", threshold: -30, slope: slopeOf(20), attack: 0.00002, release: 0.05, options: { allButtons: true }, dry: 0, wet: -12, autoGain: false, sidechain: hp(100) },
  },
  { name: "Vocal – Air", folder: "Vocals", detail: "Andrew Scheps' parallel air: Opto 2A on the highs only", settings: { style: "opto2a", threshold: -30, options: { limit: true, emphasis: 10 }, dry: 0, wet: -15, sidechain: hp(300), autoGain: false } },
  { name: "Vocal – Gentle Level", folder: "Vocals", detail: "2–4 dB of slow levelling, no colour", settings: { style: "opto", threshold: -20, slope: slopeOf(2.5), attack: 0.02, release: 0.3, sidechain: hp(100) } },
  { name: "Vocals – Backing Glue", folder: "Vocals", detail: "A stereo stack's mid held: 2:1, slow, auto release", settings: { style: "bus", threshold: -20, slope: slopeOf(2), attack: 0.03, release: 0.3, autoRelease: true, sidechain: { ...hp(100), link: 2, linkMode: "mid" } } },
  { name: "Vocal – Breath Lift", folder: "Vocals", detail: "Detail up in parallel (careful: it raises breaths)", settings: { style: "upward", threshold: -30, slope: 0.5, range: 6, mix: 0.5, sidechain: hp(100) } },
  { name: "Kick – Punch", folder: "Drums", detail: "Attack 20 ms: the click through", settings: { style: "punch", threshold: -20, slope: 0.75, attack: 0.02, release: 0.08, sidechain: noBands } },
  { name: "Snare – Smack", folder: "Drums", detail: "Fast release, a little Diode", settings: { style: "classic", threshold: -22, slope: slopeOf(6), attack: 0.002, release: 0.05, character: { mode: "diode", drive: 0.4 }, sidechain: noBands } },
  { name: "Drums – Bus Glue", folder: "Drums", detail: "4:1, 30 ms, auto release, 2–3 dB", settings: { style: "bus", threshold: -16, slope: 0.75, attack: 0.03, release: 0.3, autoRelease: true, sidechain: noBands } },
  { name: "Drums – Parallel Smash", folder: "Drums", detail: "∞:1, 0.1 ms, the dry kit under it", settings: { style: "clean", threshold: -30, slope: 1, attack: 0.0001, release: 0.08, dry: 0, wet: -6, autoGain: false, sidechain: noBands } },
  { name: "Bass – Even", folder: "Bass", detail: "A steady low end", settings: { style: "opto", threshold: -22, slope: slopeOf(4), attack: 0.02, release: 0.25, sidechain: noBands } },
  { name: "808 – Control", folder: "Bass", detail: "Hold 20 ms, so the gain doesn't follow each cycle", settings: { style: "mastering", threshold: -14, slope: slopeOf(6), attack: 0.003, release: 0.12, hold: 0.02, sidechain: noBands } },
  { name: "Mix Bus – Glue", folder: "Mix", detail: "2:1, slow, 1–2 dB", settings: { style: "bus", threshold: -14, slope: 0.5, attack: 0.03, release: 0.6, autoRelease: true, sidechain: noBands } },
  { name: "Master – Transparent", folder: "Mix", detail: "1.5:1, soft, lookahead, oversampled", settings: { style: "mastering", threshold: -12, slope: slopeOf(1.5), knee: 24, maxLookahead: 0.005, lookahead: 0.005, oversampling: 4, sidechain: noBands } },
  { name: "EDM – Pump 1/4", folder: "Special", detail: "Ducking on every beat, no kick needed", settings: { style: "pumping", threshold: -30, slope: 1, attack: 0.002, release: 0.15, sidechain: { trigger: "sync", bands: [], sync: { note: 4, offset: 1, length: 0.5 } } } },
  { name: DUCK_PRESET, folder: "Special", detail: "External: pick the kick's track", settings: { style: "clean", threshold: -30, slope: 1, attack: 0.001, release: 0.15, autoGain: false, sidechain: { trigger: "external", bands: [] } } },
  { name: "Upward – Detail", folder: "Special", detail: "Room and tails up", settings: { style: "upward", threshold: -28, slope: 0.6, range: 12, sidechain: noBands } },
  { name: "TTM – To The Max", folder: "Special", detail: "OTT-style mayhem", settings: { style: "ttm", threshold: -20, slope: 0.85, attack: 0.003, release: 0.08, sidechain: noBands } },
];

/** A preset's settings, whole (on top of the defaults). Its view and A/B are kept by whoever loads it. */
export function proCPreset(name: string): ProCState | null {
  const preset = PRO_C_PRESETS.find((p) => p.name === name);
  if (!preset) return null;
  const { options, sidechain, character, ...rest } = preset.settings;
  const d = DEFAULT_PRO_C_STATE;
  return normalizeProCState({
    ...d,
    ...rest,
    options: { ...d.options, ...options },
    sidechain: { ...d.sidechain, ...sidechain, sync: { ...d.sidechain.sync, ...sidechain?.sync } },
    character: { ...d.character, ...character },
  });
}

// ---------------------------------------------------------------------------
// The assistant's names
// ---------------------------------------------------------------------------

/** Pro-C's controls as the assistant names them (`add_automation`'s `control`). */
export const PRO_C_TOOL_CONTROLS = {
  "pro-c threshold": "threshold",
  "pro-c ratio": "ratio",
  "pro-c knee": "knee",
  "pro-c range": "range",
  "pro-c attack": "attack",
  "pro-c release": "release",
  "pro-c hold": "hold",
  "pro-c wet": "wet",
  "pro-c dry": "dry",
  "pro-c mix": "mix",
  "pro-c sidechain level": "sidechainLevel",
  "pro-c drive": "drive",
  "pro-c input": "input",
  "pro-c output": "output",
  "pro-c emphasis": "emphasis",
} as const satisfies Record<string, ProCControl>;
export type ProCToolControl = keyof typeof PRO_C_TOOL_CONTROLS;
export const PRO_C_TOOL_CONTROL_NAMES = Object.keys(PRO_C_TOOL_CONTROLS) as ProCToolControl[];

/** Each control's values, said for the model. */
export const PRO_C_HINTS: Record<ProCControl, string> = {
  threshold: "dB, -60 to 0 (a Vintage style's Input is its negative: -18 is Input 18)",
  ratio: "1 to 100 (100 and above: ∞:1)",
  knee: "dB, 0 (hard) to 72 (soft)",
  range: "dB, 0 to 60",
  attack: "milliseconds, 0.005 to 250",
  release: "milliseconds, 5 to 5000",
  hold: "milliseconds, 0 to 500",
  wet: "dB, -36 to 36",
  dry: "dB, -36 to 36 (off: no dry)",
  mix: "0 to 2 (1 is 100%)",
  sidechainLevel: "dB, -36 to 36",
  drive: "0 to 1",
  input: "dB, -36 to 36",
  output: "dB, -36 to 36",
  emphasis: "dB, 0 to 10 (Opto 2A's HF emphasis)",
};
