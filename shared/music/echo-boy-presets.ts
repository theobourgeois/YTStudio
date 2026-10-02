/**
 * EchoBoy's constants, its defaults and how its settings are validated (`docs/soundtoys/echoboy-manual.md`),
 * Rhythm Echo's patterns, and its factory presets. Its styles are in `echo-boy-styles.ts`.
 *
 * Only types, constants and the styles are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { DEFAULT_STYLE, ECHO_STYLES, styleNamed } from "./echo-boy-styles.ts";
import {
  ECHO_MODES,
  ECHO_NOTES,
  ECHO_SATURATIONS,
  ECHO_SYNCS,
  ECHO_WOBBLES,
  type EchoBand,
  type EchoBoy,
  type EchoControl,
  type EchoNote,
  type EchoRhythm,
  type EchoStyle,
  type EchoTime,
  PAN_SHAPES,
  type PluginRef,
  RHYTHM_SHAPES,
  type RhythmTap,
} from "./types.ts";

/** What an EchoBoy effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const ECHO_BOY_PLUGIN: PluginRef = { id: "vaudio:echo-boy", name: "EchoBoy", format: "Vaudio" };
export const isEchoBoy = (plugin: Pick<PluginRef, "id">) => plugin.id === ECHO_BOY_PLUGIN.id;

/** The longest echo, in ms (EchoBoy 5's 15 seconds). */
export const MAX_ECHO_MS = 15_000;
/** Low Cut's and High Cut's ranges (Hz): Low Cut at its least and High Cut at its most cut nothing. */
export const LOW_CUT_RANGE = [20, 2000] as const;
export const HIGH_CUT_RANGE = [500, 20_000] as const;
/** Input and Output (dB), and the Style Editor's saturation drives. */
export const MAX_ECHO_GAIN = 24;
/** L/R Offset's most (ms). */
export const MAX_OFFSET = 25;
/** EchoBoy's own tempo (typed or tapped), as its bpm LCD takes it. */
export const MIN_ECHO_BPM = 30;
export const MAX_ECHO_BPM = 300;
/** How far back a Rhythm tap can read (seconds): what the engine's line holds, less the wobble's reach. Later taps are silent. */
export const maxTapSeconds = 16.25;
/** Rhythm Echo: at most 16 taps, a pattern 1 to 8 beats long. */
export const MAX_TAPS = 16;
export const MAX_RHYTHM_BEATS = 8;
/** The Style Editor's ranges. */
export const EQ_GAIN_RANGE = [-40, 18] as const;
export const MID_RES_RANGE = [-12, 24] as const;
export const LOW_FREQ_RANGE = [20, 2000] as const;
export const MID_FREQ_RANGE = [20, 5000] as const;
export const HIGH_FREQ_RANGE = [500, 12_000] as const;
export const MAX_DIFFUSION_SIZE = 50;
export const MAX_WOBBLE_DEPTH = 1200;
export const WOBBLE_RATE_RANGE = [0.01, 50] as const;

/** A note value's length in beats (quarter notes): 1/8 is half a beat; dotted ×1.5, triplet ×2/3. */
export function noteBeats(note: EchoNote, sync: EchoTime["sync"] = "note"): number {
  const straight = 4 / note;
  return sync === "dot" ? straight * 1.5 : sync === "trip" ? (straight * 2) / 3 : straight;
}

/** Rhythm Echo's taps as the Rhythm knob lays them out: the "One", then `repeats` taps `step` beats apart, inside `length`. */
export function evenTaps(step: number, repeats: number, length: number): RhythmTap[] {
  const taps: RhythmTap[] = [{ beat: 0, level: 1 }];
  for (let k = 1; k <= repeats && taps.length < MAX_TAPS; k++) {
    const beat = Math.round(k * step * 1e6) / 1e6;
    if (beat >= length - 1e-9) break;
    taps.push({ beat, level: 1 });
  }
  return taps;
}

export const DEFAULT_RHYTHM: EchoRhythm = {
  time: { sync: "note", ms: 250, note: 8 },
  taps: evenTaps(0.5, 3, 2),
  repeats: 3,
  pattern: "1/8 Notes",
  shape: "decay",
  shapeAmount: 0.5,
  panShape: "alt1",
  accent: 0,
  grid: 16,
  length: 2,
};

/** A new EchoBoy: Single Echo at an eighth note, Studio Tape, the song's tempo. */
export const DEFAULT_ECHO_BOY: EchoBoy = {
  mode: "single",
  echo1: { sync: "note", ms: 250, note: 8 },
  echo2: { sync: "dot", ms: 375, note: 8 },
  rhythm: DEFAULT_RHYTHM,
  mix: 0.4,
  feedback: 0.35,
  lowCut: LOW_CUT_RANGE[0],
  highCut: HIGH_CUT_RANGE[1],
  primeNumbers: false,
  saturation: 0.5,
  input: 0,
  output: 0,
  style: DEFAULT_STYLE,
  custom: null,
  followTempo: true,
  bpm: 120,
  groove: 0,
  feel: 0,
  width: 0.5,
  offset: 8,
  accent: 0,
  accent2: 0,
  balance: 0,
  feedbackMix: 0,
  feedbackBalance: 0,
  preset: null,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const oneOf = <T>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const name = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : fallback);

export function normalizeEchoTime(raw: unknown, fallback: EchoTime): EchoTime {
  if (!isObject(raw)) return fallback;
  return { sync: oneOf(ECHO_SYNCS, raw.sync, fallback.sync), ms: num(raw.ms, 0, MAX_ECHO_MS, fallback.ms), note: oneOf<EchoNote>(ECHO_NOTES, raw.note, fallback.note) };
}

/** Taps in order, no two on one beat, none at or past `length`, 16 at most. */
export function normalizeTaps(raw: unknown, length: number): RhythmTap[] {
  if (!Array.isArray(raw)) return [];
  const taps = raw
    .filter(isObject)
    .filter((t) => isFiniteNumber(t.beat) && t.beat >= 0 && t.beat < length)
    .map((t) => ({ beat: Math.round((t.beat as number) * 1e6) / 1e6, level: num(t.level, 0, 1, 1) }))
    .sort((a, b) => a.beat - b.beat);
  return taps.filter((t, i) => i === 0 || t.beat - taps[i - 1].beat > 1e-6).slice(0, MAX_TAPS);
}

function normalizeRhythm(raw: unknown): EchoRhythm {
  if (!isObject(raw)) return DEFAULT_RHYTHM;
  const d = DEFAULT_RHYTHM;
  const length = num(raw.length, 1, MAX_RHYTHM_BEATS, d.length);
  return {
    time: normalizeEchoTime(raw.time, d.time),
    taps: Array.isArray(raw.taps) ? normalizeTaps(raw.taps, length) : d.taps,
    repeats: Math.round(num(raw.repeats, 1, MAX_TAPS, d.repeats)),
    pattern: name(raw.pattern, "Custom"),
    shape: oneOf(RHYTHM_SHAPES, raw.shape, d.shape),
    shapeAmount: num(raw.shapeAmount, 0, 1, d.shapeAmount),
    panShape: oneOf(PAN_SHAPES, raw.panShape, d.panShape),
    accent: num(raw.accent, -1, 1, 0),
    grid: oneOf<EchoNote>(ECHO_NOTES, raw.grid, d.grid),
    length,
  };
}

function normalizeBand(raw: unknown, fallback: EchoBand, range: readonly [number, number]): EchoBand {
  if (!isObject(raw)) return fallback;
  return { freq: num(raw.freq, range[0], range[1], fallback.freq), gain: num(raw.gain, EQ_GAIN_RANGE[0], EQ_GAIN_RANGE[1], fallback.gain), decay: num(raw.decay, EQ_GAIN_RANGE[0], EQ_GAIN_RANGE[1], fallback.decay) };
}

/** A style's settings from anything: what's missing or wrong is `fallback`'s. */
export function normalizeEchoStyle(raw: unknown, fallback: EchoStyle = styleNamed(DEFAULT_STYLE)): EchoStyle {
  if (!isObject(raw)) return fallback;
  const f = fallback;
  const mid = isObject(raw.mid) ? raw.mid : {};
  const diffusion = isObject(raw.diffusion) ? raw.diffusion : {};
  const wobble = isObject(raw.wobble) ? raw.wobble : {};
  const saturation = isObject(raw.saturation) ? raw.saturation : {};
  return {
    low: normalizeBand(raw.low, f.low, LOW_FREQ_RANGE),
    mid: { ...normalizeBand(raw.mid, f.mid, MID_FREQ_RANGE), res: num(mid.res, MID_RES_RANGE[0], MID_RES_RANGE[1], f.mid.res) },
    high: normalizeBand(raw.high, f.high, HIGH_FREQ_RANGE),
    diffusion: {
      amount: num(diffusion.amount, 0, 1, f.diffusion.amount),
      size: num(diffusion.size, 0, MAX_DIFFUSION_SIZE, f.diffusion.size),
      loop: typeof diffusion.loop === "boolean" ? diffusion.loop : f.diffusion.loop,
    },
    wobble: {
      depth: num(wobble.depth, 0, MAX_WOBBLE_DEPTH, f.wobble.depth),
      rate: num(wobble.rate, WOBBLE_RATE_RANGE[0], WOBBLE_RATE_RANGE[1], f.wobble.rate),
      sync: num(wobble.sync, -1, 1, f.wobble.sync),
      shape: oneOf(ECHO_WOBBLES, wobble.shape, f.wobble.shape),
      feedback: typeof wobble.feedback === "boolean" ? wobble.feedback : f.wobble.feedback,
      out: typeof wobble.out === "boolean" ? wobble.out : f.wobble.out,
    },
    saturation: {
      decay: num(saturation.decay, -MAX_ECHO_GAIN, MAX_ECHO_GAIN, f.saturation.decay),
      out: num(saturation.out, -MAX_ECHO_GAIN, MAX_ECHO_GAIN, f.saturation.out),
      type: oneOf(ECHO_SATURATIONS, saturation.type, f.saturation.type),
    },
  };
}

/** EchoBoy's settings (`docs/soundtoys/echoboy-manual.md`): anything missing or wrong is its default. */
export function normalizeEchoBoy(input: unknown): EchoBoy {
  if (!isObject(input)) return DEFAULT_ECHO_BOY;
  const d = DEFAULT_ECHO_BOY;
  const style = typeof input.style === "string" && ECHO_STYLES.some((s) => s.name === input.style) ? input.style : d.style;
  return {
    mode: oneOf(ECHO_MODES, input.mode, d.mode),
    echo1: normalizeEchoTime(input.echo1, d.echo1),
    echo2: normalizeEchoTime(input.echo2, d.echo2),
    rhythm: normalizeRhythm(input.rhythm),
    mix: num(input.mix, 0, 1, d.mix),
    feedback: num(input.feedback, 0, 1, d.feedback),
    lowCut: num(input.lowCut, LOW_CUT_RANGE[0], LOW_CUT_RANGE[1], d.lowCut),
    highCut: num(input.highCut, HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1], d.highCut),
    primeNumbers: input.primeNumbers === true,
    saturation: num(input.saturation, 0, 1, d.saturation),
    input: num(input.input, -MAX_ECHO_GAIN, MAX_ECHO_GAIN, d.input),
    output: num(input.output, -MAX_ECHO_GAIN, MAX_ECHO_GAIN, d.output),
    style,
    custom: isObject(input.custom) ? normalizeEchoStyle(input.custom, styleNamed(style)) : null,
    followTempo: input.followTempo !== false,
    bpm: num(input.bpm, MIN_ECHO_BPM, MAX_ECHO_BPM, d.bpm),
    groove: num(input.groove, -1, 1, d.groove),
    feel: num(input.feel, -1, 1, d.feel),
    width: num(input.width, 0, 1, d.width),
    offset: num(input.offset, 0, MAX_OFFSET, d.offset),
    accent: num(input.accent, -1, 1, d.accent),
    accent2: num(input.accent2, -1, 1, d.accent2),
    balance: num(input.balance, -1, 1, d.balance),
    feedbackMix: num(input.feedbackMix, 0, 1, d.feedbackMix),
    feedbackBalance: num(input.feedbackBalance, -1, 1, d.feedbackBalance),
    preset: typeof input.preset === "string" && input.preset.trim() ? name(input.preset, "") : null,
  };
}

/** EchoBoy's controls as the assistant names them (`add_automation`'s `control`). */
export const ECHO_TOOL_CONTROLS = {
  "echo mix": "mix",
  "echo feedback": "feedback",
  "echo time 1": "echo1",
  "echo time 2": "echo2",
  "echo low cut": "lowCut",
  "echo high cut": "highCut",
  "echo saturation": "saturation",
  "echo input": "input",
  "echo output": "output",
  "echo groove": "groove",
  "echo feel": "feel",
  "echo width": "width",
  "echo offset": "offset",
  "echo balance": "balance",
  "echo accent": "accent",
  "echo accent 2": "accent2",
  "echo fb mix": "feedbackMix",
  "echo fb balance": "feedbackBalance",
  "echo rhythm": "rhythmTime",
  "echo rhythm shape": "rhythmShape",
  "echo rhythm accent": "rhythmAccent",
  "echo low freq": "lowFreq",
  "echo low gain": "lowGain",
  "echo low decay": "lowDecay",
  "echo mid freq": "midFreq",
  "echo mid res": "midRes",
  "echo mid gain": "midGain",
  "echo mid decay": "midDecay",
  "echo high freq": "highFreq",
  "echo high gain": "highGain",
  "echo high decay": "highDecay",
  "echo diffusion": "diffusionAmount",
  "echo diffusion size": "diffusionSize",
  "echo wobble depth": "wobbleDepth",
  "echo wobble rate": "wobbleRate",
  "echo wobble sync": "wobbleSync",
  "echo decay sat": "decaySat",
  "echo out sat": "outSat",
} as const satisfies Record<string, EchoControl>;
export type EchoToolControl = keyof typeof ECHO_TOOL_CONTROLS;
export const ECHO_TOOL_CONTROL_NAMES = Object.keys(ECHO_TOOL_CONTROLS) as EchoToolControl[];
