/**
 * YT-L's constants, its styles as numbers, its default and how its settings are validated
 * (`docs/fabfilter/pro-l.md` §4.2, §8.2).
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import {
  PRO_L_CLIP_SHAPES,
  PRO_L_DITHER,
  PRO_L_NOISE_SHAPINGS,
  PRO_L_OVERSAMPLING,
  PRO_L_STYLES,
  type PluginRef,
  type ProL,
  type ProLState,
  type ProLStyle,
} from "./types.ts";

/** What a YT-L effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const PRO_L_PLUGIN: PluginRef = { id: "vaudio:pro-l", name: "YT-L", format: "Vaudio" };
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
export const DEFAULT_PRO_L: ProL = { ...DEFAULT_PRO_L_STATE, preset: "Default Setting" };

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

/** A YT-L's settings from anything: its sound, and the preset it was last set to (a name, or null). */
export function normalizeProL(input: unknown): ProL {
  if (!isObject(input)) return DEFAULT_PRO_L;
  return { ...normalizeProLState(input), preset: typeof input.preset === "string" && input.preset.length <= 80 ? input.preset : null };
}
