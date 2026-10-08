/**
 * YT-L's constants, its styles as numbers, its default and how its settings are validated
 * (`docs/fabfilter/pro-l.md` §4.2, §8.2).
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import {
  PRO_L_CLIP_SHAPES,
  PRO_L_DISPLAY_MODES,
  PRO_L_DITHER,
  PRO_L_METER_SCALES,
  PRO_L_NOISE_SHAPINGS,
  PRO_L_OVERSAMPLING,
  PRO_L_STYLES,
  PRO_L_TIME_SCALES,
  type PluginRef,
  type ProL,
  type ProLControl,
  type ProLMeter,
  type ProLState,
  type ProLStyle,
} from "./types.ts";

/** What a YT-L effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const PRO_L_PLUGIN: PluginRef = { id: "vaudio:pro-l", name: "YT-L", format: "YTStudio" };
export const isProL = (plugin: Pick<PluginRef, "id">) => plugin.id === PRO_L_PLUGIN.id;

export const PRO_L_GAIN_RANGE = [0, 30] as const;
export const PRO_L_OUTPUT_RANGE = [-30, 0] as const;
/** Attack's and Release's most (seconds), as Pro-L 2's. */
export const PRO_L_MAX_TIME = 10;
export const PRO_L_MAX_HOLD = 0.05;
export const PRO_L_SIDE_FLOOR_RANGE = [-18, 0] as const;
export const PRO_L_MAX_CLIP_RANGE = 6;
export const PRO_L_MAX_CLIP_KNEE = 6;
/** FL Studio's Fruity Soft Clipper's knee (dB under its ceiling), measured (`pro-l-research.md` §2.9). */
export const FL_CLIP_KNEE = 2.145;

/**
 * Pro-L 2's own tapers, so a knob reads as it does there: Attack is 10 s × x⁴ and Release 6.859 s × x³ (to 5 s at
 * 0.9, then on to 10 s), x being the knob's turn (0..1).
 */
export const attackFromTurn = (x: number) => PRO_L_MAX_TIME * clamp(x, 0, 1) ** 4;
export const turnFromAttack = (s: number) => (clamp(s, 0, PRO_L_MAX_TIME) / PRO_L_MAX_TIME) ** 0.25;
const RELEASE_CUBE = 5 / 0.9 ** 3;
export const releaseFromTurn = (x: number) => (clamp(x, 0, 1) <= 0.9 ? RELEASE_CUBE * clamp(x, 0, 1) ** 3 : 5 + ((clamp(x, 0, 1) - 0.9) / 0.1) * 5);
export const turnFromRelease = (s: number) => (s <= 5 ? (clamp(s, 0, 5) / RELEASE_CUBE) ** (1 / 3) : 0.9 + 0.1 * ((clamp(s, 5, PRO_L_MAX_TIME) - 5) / 5));

/** What a style is to the engine (§4.2): the engine knows no style, only these. */
export interface ProLStyleSpec {
  /** Seconds of look-ahead beyond the Lookahead knob's range: latency it keeps for its longer ramps. */
  reserve: number;
  /** The Lookahead knob's range (seconds). */
  range: number;
  /** The shortest ramp (seconds): the knob's, at least this. */
  ramp: number;
  /** The ramp's boxes (1–4: more, smoother). */
  layers: number;
  /** Hold's default: null for Auto (half the bass's period), or seconds. */
  hold: number | null;
  /** The transient stage's release (seconds), for an isolated peak and a busy passage; 0: the ramp back up. */
  fastRelease: number;
  slowRelease: number;
  /**
   * The release stage (Attack and Release's): its strength (at most 1, so loudness always rises with Gain), the
   * shortest it lets go in, and how long it waits after an overload before letting go. Null: none.
   */
  releaseStage: { strength: number; floor: number; delay: number } | null;
  /** Seconds of the bass stage's ramp (0: none): the low end limited more slowly than the crack of a hit. */
  bass: number;
  /** dB: transient emphasis before limiting, at most. */
  emphasis: number;
  /** Where its presets start: Lookahead, Attack, Release. */
  start: { lookahead: number; attack: number; release: number };
  /** Whether Attack and Release mean anything to it. */
  timed: boolean;
  /** What it's for, in a sentence (the menu's hint, the assistant's catalogue). */
  hint: string;
}

const RANGE = 0.005;
export const PRO_L_STYLE_SPECS: Record<ProLStyle, ProLStyleSpec> = {
  transparent: {
    reserve: 0, range: RANGE, ramp: 0, layers: 4, hold: null, fastRelease: 0.01, slowRelease: 0.06,
    releaseStage: { strength: 1, floor: 0, delay: 0 }, bass: 0, emphasis: 0,
    start: { lookahead: 0.0005, attack: 0.15, release: 0.5 }, timed: true,
    hint: "Clean, the least latency of the master styles: masters that need a few dB.",
  },
  punchy: {
    reserve: 0, range: RANGE, ramp: 0.001, layers: 4, hold: null, fastRelease: 0.04, slowRelease: 0.15,
    releaseStage: { strength: 1, floor: 0, delay: 0 }, bass: 0, emphasis: 0,
    start: { lookahead: 0.0015, attack: 0.275, release: 0.4 }, timed: true,
    hint: "A slower recovery you can hear pump: vocals, bass, beat music.",
  },
  dynamic: {
    reserve: 0.002, range: RANGE, ramp: 0, layers: 4, hold: null, fastRelease: 0.01, slowRelease: 0.06,
    releaseStage: { strength: 1, floor: 0, delay: 0 }, bass: 0, emphasis: 3,
    start: { lookahead: 0.0003, attack: 0.25, release: 0.25 }, timed: true,
    hint: "Hits turned up before they're limited, so they keep their snap: rock, live drums.",
  },
  allround: {
    reserve: 0, range: RANGE, ramp: 0.0005, layers: 4, hold: null, fastRelease: 0.015, slowRelease: 0.1,
    releaseStage: { strength: 1, floor: 0, delay: 0.1 }, bass: 0, emphasis: 0,
    start: { lookahead: 0.0005, attack: 0.275, release: 0.4 }, timed: true,
    hint: "Lets go only once a sound has ended, then smoothly: when unsure.",
  },
  aggressive: {
    reserve: 0.025, range: RANGE, ramp: 0, layers: 3, hold: null, fastRelease: 0, slowRelease: 0,
    releaseStage: null, bass: 0.01, emphasis: 0,
    start: { lookahead: 0.0001, attack: 0.275, release: 0.4 }, timed: false,
    hint: "Near clipping: dense and loud, a little grit on the hits. EDM, trap.",
  },
  modern: {
    reserve: 0.025, range: RANGE, ramp: 0, layers: 4, hold: null, fastRelease: 0.005, slowRelease: 0.08,
    releaseStage: { strength: 1, floor: 0.3, delay: 0 }, bass: 0.01, emphasis: 0,
    start: { lookahead: 0.00018, attack: 0.275, release: 0.4 }, timed: true,
    hint: "Clean and loud at once, the bass kept smooth: masters of every kind.",
  },
  bus: {
    reserve: 0.045, range: RANGE, ramp: 0.012, layers: 4, hold: 0.015, fastRelease: 0.05, slowRelease: 0.3,
    releaseStage: { strength: 1, floor: 0, delay: 0 }, bass: 0.02, emphasis: 0,
    start: { lookahead: 0.002, attack: 0.03, release: 0.3 }, timed: true,
    hint: "Slow ramps and a pump: glue on a drum bus.",
  },
  safe: {
    reserve: 0.035, range: RANGE, ramp: 0.035, layers: 4, hold: 0.02, fastRelease: 0.08, slowRelease: 0.08,
    releaseStage: { strength: 1, floor: 0.08, delay: 0 }, bass: 0, emphasis: 0,
    start: { lookahead: 0.005, attack: 0, release: 1 }, timed: true,
    hint: "Never distorts, at the price of loudness: acoustic, classical, delicate vocals.",
  },
  spit: {
    reserve: 0, range: 0.001, ramp: 0, layers: 1, hold: 0, fastRelease: 0.001, slowRelease: 0.005,
    releaseStage: null, bass: 0, emphasis: 0,
    start: { lookahead: 0.00005, attack: 0.275, release: 0.4 }, timed: false,
    hint: "A fast, hard brickwall for bite: the L1 \"spit and attitude\" on a vocal, about 1 ms of latency.",
  },
};

/** A new YT-L (Théo's choices, `pro-l.md` §7.1): Modern, a −0.1 dBFS sample-peak ceiling, the clipper off, 4x. */
export const DEFAULT_PRO_L_STATE: ProLState = {
  style: "modern",
  gain: 0,
  output: -0.1,
  lookahead: 0.00018,
  attack: 0.275,
  release: 0.4,
  hold: null,
  stereo: "lr",
  linkTransients: 0.75,
  linkRelease: 1,
  sideFloor: -6,
  clip: false,
  clipRange: 1.5,
  clipShape: "smooth",
  clipKnee: 1.5,
  clipOrder: "first",
  truePeak: false,
  oversampling: 4,
  dither: 0,
  noiseShaping: "optimized",
  dcFilter: false,
  unityGain: false,
  audition: "off",
};
/** The meter as a new YT-L shows it: 32 dB, true peaks, Slow Down, a streaming target. */
export const DEFAULT_PRO_L_METER: ProLMeter = {
  scale: "32",
  truePeakMeter: true,
  display: "slowDown",
  target: -14,
  timeScale: "shortTerm",
  loudnessRange: 9,
  relative: false,
  maxOf: "shortTerm",
  autoReset: true,
};
export const PRO_L_TARGET_RANGE = [-40, 0] as const;
/** The loudness targets offered (§2.7): Pro-L 2's, and the louder ones these genres master to. */
export const PRO_L_TARGETS = [
  { lufs: -6, name: "Loud rap / hyperpop" },
  { lufs: -9, name: "CD" },
  { lufs: -14, name: "Streaming" },
  { lufs: -16, name: "Apple Music" },
  { lufs: -23, name: "EBU R 128" },
  { lufs: -24, name: "ATSC A/85" },
] as const;

export const DEFAULT_PRO_L: ProL = { ...DEFAULT_PRO_L_STATE, preset: "Default Setting", lockOutput: false, other: null, slot: "a", meter: DEFAULT_PRO_L_METER };

/** What Lock Output keeps when a preset is loaded: where the sound is delivered, not how it sounds. */
export const PRO_L_DELIVERY = ["output", "truePeak", "dither", "noiseShaping"] as const satisfies readonly (keyof ProLState)[];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** A YT-L's sound from anything (a saved song, the assistant, A/B's other side): each value kept to its range. */
export function normalizeProLState(input: unknown): ProLState {
  if (!isObject(input)) return DEFAULT_PRO_L_STATE;
  const d = DEFAULT_PRO_L_STATE;
  const style = oneOf(PRO_L_STYLES, input.style, d.style);
  const range = PRO_L_STYLE_SPECS[style].range;
  return {
    style,
    gain: num(input.gain, PRO_L_GAIN_RANGE[0], PRO_L_GAIN_RANGE[1], d.gain),
    output: num(input.output, PRO_L_OUTPUT_RANGE[0], PRO_L_OUTPUT_RANGE[1], d.output),
    lookahead: num(input.lookahead, 0, range, Math.min(d.lookahead, range)),
    attack: num(input.attack, 0, PRO_L_MAX_TIME, d.attack),
    release: num(input.release, 0, PRO_L_MAX_TIME, d.release),
    hold: input.hold === null || input.hold === undefined ? null : num(input.hold, 0, PRO_L_MAX_HOLD, 0),
    stereo: input.stereo === "ms" ? "ms" : "lr",
    linkTransients: num(input.linkTransients, 0, 1, d.linkTransients),
    linkRelease: num(input.linkRelease, 0, 1, d.linkRelease),
    sideFloor: num(input.sideFloor, PRO_L_SIDE_FLOOR_RANGE[0], PRO_L_SIDE_FLOOR_RANGE[1], d.sideFloor),
    clip: input.clip === true,
    clipRange: num(input.clipRange, 0, PRO_L_MAX_CLIP_RANGE, d.clipRange),
    clipShape: oneOf(PRO_L_CLIP_SHAPES, input.clipShape, d.clipShape),
    clipKnee: num(input.clipKnee, 0, PRO_L_MAX_CLIP_KNEE, d.clipKnee),
    clipOrder: input.clipOrder === "last" ? "last" : "first",
    truePeak: input.truePeak === true,
    oversampling: oneOf(PRO_L_OVERSAMPLING, input.oversampling, d.oversampling),
    dither: oneOf(PRO_L_DITHER, input.dither, d.dither),
    noiseShaping: oneOf(PRO_L_NOISE_SHAPINGS, input.noiseShaping, d.noiseShaping),
    dcFilter: input.dcFilter === true,
    unityGain: input.unityGain === true,
    audition: oneOf(["off", "all", "clip", "limiter"] as const, input.audition, "off"),
  };
}

/** A YT-L's meter settings from anything. */
export function normalizeProLMeter(input: unknown): ProLMeter {
  if (!isObject(input)) return DEFAULT_PRO_L_METER;
  const d = DEFAULT_PRO_L_METER;
  const meter: ProLMeter = {
    scale: oneOf(PRO_L_METER_SCALES, input.scale, d.scale),
    truePeakMeter: input.truePeakMeter !== false,
    display: oneOf(PRO_L_DISPLAY_MODES, input.display, d.display),
    target: Math.round(num(input.target, PRO_L_TARGET_RANGE[0], PRO_L_TARGET_RANGE[1], d.target) * 10) / 10,
    timeScale: oneOf(PRO_L_TIME_SCALES, input.timeScale, d.timeScale),
    loudnessRange: input.loudnessRange === 18 ? 18 : 9,
    relative: input.relative === true,
    maxOf: input.maxOf === "momentary" ? "momentary" : "shortTerm",
    autoReset: input.autoReset !== false,
  };
  return JSON.stringify(meter) === JSON.stringify(d) ? d : meter;
}

/** A YT-L's settings from anything: its sound, the preset it was last set to (a name, or null), A/B and its meter. */
export function normalizeProL(input: unknown): ProL {
  if (!isObject(input)) return DEFAULT_PRO_L;
  return {
    ...normalizeProLState(input),
    preset: typeof input.preset === "string" && PRO_L_PRESETS.some((p) => p.name === input.preset) ? input.preset : null,
    lockOutput: input.lockOutput === true,
    other: isObject(input.other) ? normalizeProLState(input.other) : null,
    slot: input.slot === "b" ? "b" : "a",
    meter: normalizeProLMeter(input.meter),
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * A preset (`pro-l.md` §6): the sound it sets (the rest is the default), its delivery settings where it's about
 * delivery (left as they are otherwise, and with Lock Output on), and the loudness it's meant for.
 */
export interface ProLPreset {
  name: string;
  folder: "Master" | "Vocal" | "Drums and bass" | "Delivery";
  detail: string;
  settings: Partial<ProLState>;
  /** LUFS: the meter's target it sets. */
  target?: number;
}

const ms = (v: number) => v / 1000;
/** Lookahead, Attack, Release (milliseconds). */
const times = (lookahead: number, attack: number, release: number) => ({ lookahead: ms(lookahead), attack: ms(attack), release: ms(release) });
const truePeak = (output: number, oversampling: ProLState["oversampling"] = 4) => ({ output, truePeak: true, oversampling });
const samplePeak = (output: number, oversampling: ProLState["oversampling"] = 4) => ({ output, truePeak: false, oversampling });
const linked = { linkTransients: 1, linkRelease: 1 };

/** Ours, from the engineers' numbers (`pro-l-research.md` §1.10). Gain stays at 0 dB: how loud is the user's call. */
export const PRO_L_PRESETS: readonly ProLPreset[] = [
  { name: "Default Setting", folder: "Master", detail: "Modern, a −0.1 dBFS ceiling, 4x: anything", settings: { style: "modern", ...times(0.18, 275, 400), ...samplePeak(-0.1) }, target: -14 },
  { name: "Master: Streaming −14", folder: "Master", detail: "Spotify, YouTube, TIDAL: −1 dBTP", settings: { style: "modern", ...times(0.5, 150, 300), ...truePeak(-1) }, target: -14 },
  { name: "Master: Streaming Loud", folder: "Master", detail: "Louder than −14 and headed for lossy: −2 dBTP, a clipper first", settings: { style: "modern", ...times(0.5, 150, 300), clip: true, clipRange: 2, clipShape: "smooth", ...truePeak(-2) }, target: -10 },
  { name: "Master: Chart Pop", folder: "Master", detail: "Pop at today's −8 LUFS", settings: { style: "modern", ...times(0.3, 200, 300), clip: true, clipRange: 2, clipShape: "smooth", clipKnee: 1.5, ...truePeak(-1) }, target: -8 },
  { name: "Master: Trap Loud", folder: "Master", detail: "Trap and rap: FL's clipper into the limiter", settings: { style: "punchy", ...times(0.5, 275, 300), clip: true, clipRange: 3, clipShape: "fl", ...samplePeak(-0.1) }, target: -6 },
  {
    name: "Master: FL (Emphasizer)",
    folder: "Master",
    detail: "FL Studio 2026's default master, as measured: a limiter 1 dB over, then a hard clip at the ceiling",
    settings: { style: "punchy", ...times(0.5, 275, 50), clip: true, clipOrder: "last", clipRange: 1, clipShape: "hard", ...samplePeak(-0.1, 1) },
    target: -6,
  },
  { name: "Master: Rage / Hyperpop", folder: "Master", detail: "Carti, Ken Carson, 100 gecs: as loud as it goes", settings: { style: "aggressive", lookahead: ms(0.1), clip: true, clipRange: 1, clipShape: "hard", ...samplePeak(-0.01) }, target: -4 },
  { name: "Master: Wide", folder: "Master", detail: "Wide choruses: the side first, the centre kept", settings: { style: "modern", ...times(0.3, 275, 400), clip: true, clipRange: 2, clipShape: "smooth", stereo: "ms", sideFloor: -6, ...truePeak(-1) }, target: -8 },
  { name: "Master: Clean", folder: "Master", detail: "Ballads, R&B, dynamic masters", settings: { style: "transparent", ...times(1, 150, 500), ...truePeak(-1) }, target: -12 },
  { name: "Master: 808 Control", folder: "Master", detail: "Sub-heavy beats: the bass stays clean", settings: { style: "modern", ...times(1, 400, 400), ...linked } },
  { name: "Master: Rock Punch", folder: "Master", detail: "Rock and live drums: hits keep their snap", settings: { style: "dynamic", ...times(0.3, 250, 250), linkTransients: 0.8 } },
  { name: "Master: Allround", folder: "Master", detail: "When unsure", settings: { style: "allround", ...times(0.5, 275, 400), linkTransients: 0.8 } },
  { name: "Master: Classical and Acoustic", folder: "Master", detail: "Delicate, dynamic music: never distorts", settings: { style: "safe", ...times(5, 0, 1000), hold: ms(20), ...linked } },
  { name: "Approval Mix", folder: "Delivery", detail: "A client bounce, loud enough to compare: off for mastering", settings: { style: "modern", ...times(0.3, 275, 400), clip: true, clipRange: 1, clipShape: "smooth", ...samplePeak(-0.3) }, target: -9 },
  { name: "Vocal: Peak Catcher", folder: "Vocal", detail: "After the vocal compressors: the last peaks", settings: { style: "punchy", ...times(2, 150, 200), ...linked, truePeak: false, oversampling: 1 } },
  { name: "Vocal: Spit", folder: "Vocal", detail: "The L1's \"spit and attitude\", hit hard", settings: { style: "spit", lookahead: ms(0.05), release: ms(3), hold: 0, ...linked, truePeak: false, oversampling: 1 } },
  { name: "Vocal: Smooth", folder: "Vocal", detail: "Ballads, spoken word", settings: { style: "safe", ...times(5, 0, 300), hold: ms(20), ...linked, truePeak: false, oversampling: 1 } },
  { name: "808: Clip", folder: "Drums and bass", detail: "An 808 or sub bus: the clipper does the work", settings: { style: "transparent", ...times(0.5, 275, 100), clip: true, clipRange: 0, clipShape: "fl", ...linked, truePeak: false } },
  { name: "Drum Bus: Glue", folder: "Drums and bass", detail: "A drum bus, a few dB", settings: { style: "bus", ...times(2, 30, 300), hold: ms(15), ...linked, truePeak: false } },
  { name: "Drum Bus: Crunch", folder: "Drums and bass", detail: "Clipped, crunchy drums", settings: { style: "bus", ...times(1, 10, 150), hold: ms(15), clip: true, clipRange: 1, clipShape: "soft", ...linked, truePeak: false } },
  { name: "Kick and Sub Ceiling", folder: "Drums and bass", detail: "A maximum for the kick and 808", settings: { style: "transparent", ...times(1, 275, 200), ...linked, truePeak: false } },
  { name: "Broadcast EBU R 128", folder: "Delivery", detail: "TV and radio in Europe: −23 LUFS, −1 dBTP", settings: { style: "transparent", ...times(1, 150, 500), ...linked, ...truePeak(-1) }, target: -23 },
  { name: "Broadcast ATSC A/85", folder: "Delivery", detail: "TV in the US: −24 LUFS, −2 dBTP", settings: { style: "transparent", ...times(1, 150, 500), ...linked, ...truePeak(-2) }, target: -24 },
  { name: "CD Master", folder: "Delivery", detail: "A 16-bit master, dithered", settings: { style: "modern", ...times(0.5, 275, 400), ...truePeak(-0.1, 8), dither: 16, noiseShaping: "optimized" }, target: -9 },
];

export const proLPreset = (name: string) => PRO_L_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;

// ---------------------------------------------------------------------------
// The assistant's names for its automatable controls
// ---------------------------------------------------------------------------

/** add_automation's names for YT-L's controls. */
export const PRO_L_TOOL_CONTROLS = {
  "limiter gain": "gain",
  "limiter output": "output",
  "limiter attack": "attack",
  "limiter release": "release",
  "limiter hold": "hold",
  "limiter transients link": "linkTransients",
  "limiter release link": "linkRelease",
  "limiter side floor": "sideFloor",
  "limiter clip range": "clipRange",
  "limiter clip knee": "clipKnee",
} as const satisfies Record<string, ProLControl>;
export type ProLToolControl = keyof typeof PRO_L_TOOL_CONTROLS;
export const PRO_L_TOOL_CONTROL_NAMES = Object.keys(PRO_L_TOOL_CONTROLS) as ProLToolControl[];

/** Each control's values, said for the model. */
export const PRO_L_HINTS: Record<ProLControl, string> = {
  gain: "dB, 0 to 30",
  output: "dB, -30 to 0 (the ceiling)",
  attack: "milliseconds, 0 to 10000",
  release: "milliseconds, 0 to 10000",
  hold: "milliseconds, 0 to 50",
  linkTransients: "0 to 1 (100%)",
  linkRelease: "0 to 1 (100%)",
  sideFloor: "dB, -18 to 0",
  clipRange: "dB, 0 to 6",
  clipKnee: "dB, 0 to 6",
};
