/**
 * PanMan's constants, its settings' validation and its factory presets (`docs/soundtoys/panman.md`). The
 * presets are ours, the seven names the manual shows among them, each made from its idea.
 *
 * Only types and maths are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import { type PanControl, type PanCurve, type PanDirection, type PanMan, type PanManMode, type PanShapeEvent, type PanStepPoint, type PanStyle, PPQ, type PluginRef } from "./types.ts";

/** What a PanMan effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const PANMAN_PLUGIN: PluginRef = { id: "vaudio:panman", name: "YT-Pan", format: "YTStudio" };
export const isPanMan = (plugin: Pick<PluginRef, "id">) => plugin.id === PANMAN_PLUGIN.id;

/** Degrees: hard left or right is 90, and positions go on to 105 ("beyond the speakers"). */
export const PAN_HARD = 90;
export const PAN_LIMIT = 105;
export const MAX_PAN_WIDTH = 2 * PAN_LIMIT;
/** The LFO's rate (Hz). */
export const MIN_PAN_RATE = 0.01;
export const MAX_PAN_RATE = 10;
export const MIN_PAN_STEPS = 2;
export const MAX_PAN_STEPS = 16;
/** The dynamics' Attack and Release, at most (seconds). */
export const MAX_PAN_TIME = 5;
/** The Threshold's and the Trigger's range (dB); the Trigger at its top doesn't trigger. */
export const MIN_PAN_LEVEL = -40;
export const MAX_PAN_DIVIDER = 12;
export const MIN_PAN_CUTOFF = 100;
export const MAX_PAN_CUTOFF = 15_000;
export const MAX_PAN_FILTER_GAIN = 20;
export const MAX_PAN_RATE_MOD = 4;
export const MAX_PAN_GAIN = 24;
export const MIN_PAN_TEMPO = 20;
export const MAX_PAN_TEMPO = 999;
/** Feel at either end moves the pattern a 16th note. */
export const PAN_FEEL_TICKS = PPQ / 4;
/** The editors: bars, and beats in a bar. */
export const MAX_PAN_BARS = 8;
export const MAX_PAN_BEATS_PER_BAR = 16;
export const MAX_PAN_POINTS = 1024;

export const PAN_MODES: readonly { id: PanManMode; name: string }[] = [
  { id: "lfo", name: "LFO" },
  { id: "rhythmStep", name: "Rhythm Step" },
  { id: "rhythmShape", name: "Rhythm Shape" },
  { id: "pingPong", name: "PingPong" },
  { id: "random", name: "Random" },
  { id: "step", name: "Step" },
];
export const PAN_DIRECTIONS: readonly PanDirection[] = ["down", "both", "up"];
export const PAN_CURVES: readonly { id: PanCurve; name: string }[] = [
  { id: "linear", name: "Linear" },
  { id: "sine", name: "Sine" },
  { id: "exp", name: "Exp" },
  { id: "sym", name: "Sym" },
  { id: "rev", name: "Rev" },
];
export const PAN_STYLES: readonly { id: PanStyle; name: string; detail: string }[] = [
  { id: "clean", name: "Clean", detail: "The most range before it clips, fairly hard" },
  { id: "fat", name: "Fat", detail: "Smooth low-frequency distortion" },
  { id: "squash", name: "Squash", detail: "Fat, more compressed" },
  { id: "dirt", name: "Dirt", detail: "Smooth broadband saturation" },
  { id: "crunch", name: "Crunch", detail: "Exaggerated high-end clipping" },
  { id: "shred", name: "Shred", detail: "Lots of asymmetrical clipping" },
  { id: "pump", name: "Pump", detail: "Extreme pumping compression" },
];

/** A rhythm of the Rhythm menu: a note length, in beats (quarter notes). */
export interface PanRhythm {
  id: string;
  name: string;
  beats: number;
}
export const PAN_RHYTHMS: readonly PanRhythm[] = [
  { id: "1/32", name: "1/32 note", beats: 1 / 8 },
  { id: "1/16t", name: "1/16 trip", beats: 1 / 6 },
  { id: "1/16", name: "1/16 note", beats: 1 / 4 },
  { id: "1/16d", name: "1/16 dot", beats: 3 / 8 },
  { id: "1/8t", name: "1/8 trip", beats: 1 / 3 },
  { id: "1/8", name: "1/8 note", beats: 1 / 2 },
  { id: "1/8d", name: "1/8 dot", beats: 3 / 4 },
  { id: "1/4t", name: "1/4 trip", beats: 2 / 3 },
  { id: "1/4", name: "1/4 note", beats: 1 },
  { id: "1/4d", name: "1/4 dot", beats: 3 / 2 },
  { id: "1/2t", name: "1/2 trip", beats: 4 / 3 },
  { id: "1/2", name: "1/2 note", beats: 2 },
  { id: "1/2d", name: "1/2 dot", beats: 3 },
  { id: "1", name: "1 bar", beats: 4 },
  { id: "2", name: "2 bars", beats: 8 },
  { id: "4", name: "4 bars", beats: 16 },
];
/** A rhythm by id (an unknown id is a quarter note). */
export const panRhythm = (id: string): PanRhythm => PAN_RHYTHMS.find((r) => r.id === id) ?? PAN_RHYTHMS[8];

/** A new PanMan: a slow pan back and forth (LFO, 0.5 Hz), the whole width, half smoothed, Clean. */
export const DEFAULT_PANMAN: PanMan = {
  preset: "Slow Pan",
  mode: "lfo",
  offset: 0,
  width: 180,
  smoothing: 0.5,
  feel: 0,
  groove: 0,
  rate: 0.5,
  direction: "both",
  rhythm: "1/4",
  steps: 3,
  custom: false,
  sync: true,
  tempo: 120,
  trigger: -20,
  divider: 1,
  filter: "off",
  cutoff: 1000,
  filterGain: 0,
  monitor: false,
  threshold: -20,
  attack: 0.01,
  release: 0.2,
  gate: false,
  offsetMod: 0,
  widthMod: 0,
  rateMod: 0,
  style: "clean",
  input: 0,
  output: 0,
  stepPattern: { bars: 1, beatsPerBar: 4, curve: "sine", points: [] },
  shapePattern: { bars: 1, beatsPerBar: 4, events: [] },
};

const percentText = (v: number) => `${Math.round(v * 100)}%`;
const sidedText = (low: string, high: string) => (v: number) => (Math.abs(v) < 0.005 ? "None" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? low : high}`);
const secondsText = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

/** A position said the way the Offset knob says it: "Centre", "45° L", "105° R". */
export const degreesText = (v: number) => (Math.abs(v) < 0.5 ? "Centre" : `${Math.round(Math.abs(v))}° ${v < 0 ? "L" : "R"}`);
export const rateText = (hz: number) => (hz < 0.1 ? `${hz.toFixed(2)} Hz` : hz < 1 ? `${hz.toFixed(2)} Hz` : `${hz.toFixed(1)} Hz`);
export const dbText = (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;

/**
 * PanMan's controls an automation clip can drive (`PanControl`): their names, their ranges (an automation
 * clip's 0..1 is from `min` to `max`; the rate's along a log scale, as its knob turns) and how they're said.
 */
export const PAN_CONTROLS: Record<PanControl, { name: string; min: number; max: number; log?: boolean; format: (v: number) => string }> = {
  offset: { name: "Offset", min: -PAN_LIMIT, max: PAN_LIMIT, format: degreesText },
  width: { name: "Width", min: 0, max: MAX_PAN_WIDTH, format: (v) => `${Math.round(v)}°` },
  rate: { name: "Rate", min: MIN_PAN_RATE, max: MAX_PAN_RATE, log: true, format: rateText },
  input: { name: "Input", min: -MAX_PAN_GAIN, max: MAX_PAN_GAIN, format: dbText },
  output: { name: "Output", min: -MAX_PAN_GAIN, max: MAX_PAN_GAIN, format: dbText },
  smoothing: { name: "Smoothing", min: 0, max: 1, format: percentText },
  feel: { name: "Feel", min: -1, max: 1, format: sidedText("rush", "drag") },
  groove: { name: "Groove", min: -1, max: 1, format: sidedText("shuffle", "swing") },
  trigger: { name: "Trigger", min: MIN_PAN_LEVEL, max: 0, format: (v) => (v >= -0.01 ? "Off" : dbText(v)) },
  divider: { name: "Divider", min: 1, max: MAX_PAN_DIVIDER, format: (v) => `Every ${Math.round(v)}` },
  cutoff: { name: "Cutoff", min: MIN_PAN_CUTOFF, max: MAX_PAN_CUTOFF, log: true, format: (v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`) },
  filterGain: { name: "Filter gain", min: -MAX_PAN_FILTER_GAIN, max: MAX_PAN_FILTER_GAIN, format: dbText },
  threshold: { name: "Threshold", min: MIN_PAN_LEVEL, max: 0, format: dbText },
  attack: { name: "Attack", min: 0, max: MAX_PAN_TIME, format: secondsText },
  release: { name: "Release", min: 0, max: MAX_PAN_TIME, format: secondsText },
  offsetMod: { name: "Offset Mod", min: -PAN_LIMIT, max: PAN_LIMIT, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}°` },
  widthMod: { name: "Width Mod", min: -MAX_PAN_WIDTH, max: MAX_PAN_WIDTH, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)}°` },
  rateMod: { name: "Rate Mod", min: -MAX_PAN_RATE_MOD, max: MAX_PAN_RATE_MOD, format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} oct` },
};
export const PAN_CONTROL_IDS = Object.keys(PAN_CONTROLS) as PanControl[];
/** What an automation lane's values are of each control (the engine's lanes hold values within ±64): the offset and width as fractions of their ends. */
export const PAN_LANE_SCALE: Record<PanControl, number> = {
  offset: PAN_LIMIT,
  width: MAX_PAN_WIDTH,
  rate: 1,
  input: 1,
  output: 1,
  smoothing: 1,
  feel: 1,
  groove: 1,
  trigger: 1,
  divider: 1,
  // (kHz)
  cutoff: 1000,
  filterGain: 1,
  threshold: 1,
  attack: 1,
  release: 1,
  offsetMod: PAN_LIMIT,
  widthMod: MAX_PAN_WIDTH,
  rateMod: 1,
};
/**
 * The controls that are the engine's own (a lane each); Feel and Groove only shape the pattern, and so does
 * Smoothing in the pattern modes: automated, the pattern itself goes to the engine as a lane (`PAN_SHAPE_POINTS`).
 */
export const PAN_ENGINE_CONTROLS: readonly PanControl[] = ["offset", "width", "rate", "input", "output", "smoothing", "trigger", "divider", "cutoff", "filterGain", "threshold", "attack", "release", "offsetMod", "widthMod", "rateMod"];
/** The controls that reshape a pattern mode's pattern. */
export const PAN_SHAPING_CONTROLS: readonly PanControl[] = ["smoothing", "feel", "groove"];
/** How many evenly spaced points a pattern sent as an automation lane has (the engine's lanes hold up to 128). */
export const PAN_SHAPE_POINTS = 128;
/** A fraction of a control's range (an automation clip's value) as the control's value, and back. */
export function panControlValue(control: PanControl, fraction: number): number {
  const { min, max, log } = PAN_CONTROLS[control];
  const f = clamp(fraction, 0, 1);
  return log ? min * (max / min) ** f : min + (max - min) * f;
}
export function panControlFraction(control: PanControl, value: number): number {
  const { min, max, log } = PAN_CONTROLS[control];
  const v = clamp(value, min, max);
  return log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const whole = (v: unknown, min: number, max: number, fallback: number) => Math.round(number(v, min, max, fallback));
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** An editor's length in ticks: its bars of its beats. */
export const patternTicks = (pattern: { bars: number; beatsPerBar: number }) => pattern.bars * pattern.beatsPerBar * PPQ;

/** The Rhythm Step Editor's points: inside its bars, on whole ticks, one per tick (the later kept), in order. */
export function normalizeStepPoints(input: unknown, length: number): PanStepPoint[] {
  const byTick = new Map<number, number>();
  for (const raw of Array.isArray(input) ? input.slice(0, MAX_PAN_POINTS) : []) {
    if (!isObject(raw) || !isFiniteNumber(raw.tick)) continue;
    const tick = Math.round(raw.tick);
    if (tick < 0 || tick >= length) continue;
    byTick.set(tick, number(raw.value, -1, 1, 0));
  }
  return [...byTick].sort((a, b) => a[0] - b[0]).map(([tick, value]) => ({ tick, value }));
}

/** The Rhythm Editor's events: inside its bars, at least a tick long, in order, none overlapping (a later one is cut short by the next). */
export function normalizeShapeEvents(input: unknown, length: number): PanShapeEvent[] {
  const events: PanShapeEvent[] = [];
  for (const raw of Array.isArray(input) ? input.slice(0, MAX_PAN_POINTS) : []) {
    if (!isObject(raw) || !isFiniteNumber(raw.tick) || !isFiniteNumber(raw.length)) continue;
    const tick = Math.round(raw.tick);
    if (tick < 0 || tick >= length) continue;
    events.push({ tick, length: Math.max(1, Math.min(Math.round(raw.length), length - tick)) });
  }
  events.sort((a, b) => a.tick - b.tick);
  const kept: PanShapeEvent[] = [];
  for (const event of events) {
    const last = kept.at(-1);
    if (last && last.tick === event.tick) continue;
    if (last && last.tick + last.length > event.tick) kept[kept.length - 1] = { ...last, length: event.tick - last.tick };
    kept.push(event);
  }
  return kept;
}

/** PanMan's settings (`docs/soundtoys/panman.md`): anything missing or wrong is its default. */
export function normalizePanMan(input: unknown): PanMan {
  if (!isObject(input)) return DEFAULT_PANMAN;
  const d = DEFAULT_PANMAN;
  const step = isObject(input.stepPattern) ? input.stepPattern : {};
  const shape = isObject(input.shapePattern) ? input.shapePattern : {};
  const stepBars = { bars: whole(step.bars, 1, MAX_PAN_BARS, 1), beatsPerBar: whole(step.beatsPerBar, 1, MAX_PAN_BEATS_PER_BAR, 4) };
  const shapeBars = { bars: whole(shape.bars, 1, MAX_PAN_BARS, 1), beatsPerBar: whole(shape.beatsPerBar, 1, MAX_PAN_BEATS_PER_BAR, 4) };
  return {
    preset: typeof input.preset === "string" && input.preset.trim() ? input.preset.trim().slice(0, 64) : d.preset,
    mode: oneOf(input.mode, PAN_MODES.map((m) => m.id), d.mode),
    offset: number(input.offset, -PAN_LIMIT, PAN_LIMIT, d.offset),
    width: number(input.width, 0, MAX_PAN_WIDTH, d.width),
    smoothing: number(input.smoothing, 0, 1, d.smoothing),
    feel: number(input.feel, -1, 1, d.feel),
    groove: number(input.groove, -1, 1, d.groove),
    rate: number(input.rate, MIN_PAN_RATE, MAX_PAN_RATE, d.rate),
    direction: oneOf(input.direction, PAN_DIRECTIONS, d.direction),
    rhythm: oneOf(input.rhythm, PAN_RHYTHMS.map((r) => r.id), d.rhythm),
    steps: whole(input.steps, MIN_PAN_STEPS, MAX_PAN_STEPS, d.steps),
    custom: flag(input.custom, d.custom),
    sync: flag(input.sync, d.sync),
    tempo: number(input.tempo, MIN_PAN_TEMPO, MAX_PAN_TEMPO, d.tempo),
    trigger: number(input.trigger, MIN_PAN_LEVEL, 0, d.trigger),
    divider: whole(input.divider, 1, MAX_PAN_DIVIDER, d.divider),
    filter: oneOf(input.filter, ["hpf", "off", "lpf"] as const, d.filter),
    cutoff: number(input.cutoff, MIN_PAN_CUTOFF, MAX_PAN_CUTOFF, d.cutoff),
    filterGain: number(input.filterGain, -MAX_PAN_FILTER_GAIN, MAX_PAN_FILTER_GAIN, d.filterGain),
    monitor: flag(input.monitor, d.monitor),
    threshold: number(input.threshold, MIN_PAN_LEVEL, 0, d.threshold),
    attack: number(input.attack, 0, MAX_PAN_TIME, d.attack),
    release: number(input.release, 0, MAX_PAN_TIME, d.release),
    gate: flag(input.gate, d.gate),
    offsetMod: number(input.offsetMod, -PAN_LIMIT, PAN_LIMIT, d.offsetMod),
    widthMod: number(input.widthMod, -MAX_PAN_WIDTH, MAX_PAN_WIDTH, d.widthMod),
    rateMod: number(input.rateMod, -MAX_PAN_RATE_MOD, MAX_PAN_RATE_MOD, d.rateMod),
    style: oneOf(input.style, PAN_STYLES.map((s) => s.id), d.style),
    input: number(input.input, -MAX_PAN_GAIN, MAX_PAN_GAIN, d.input),
    output: number(input.output, -MAX_PAN_GAIN, MAX_PAN_GAIN, d.output),
    stepPattern: { ...stepBars, curve: oneOf(step.curve, PAN_CURVES.map((c) => c.id), d.stepPattern.curve), points: normalizeStepPoints(step.points, patternTicks(stepBars)) },
    shapePattern: { ...shapeBars, events: normalizeShapeEvents(shape.events, patternTicks(shapeBars)) },
  };
}

// ---------------------------------------------------------------------------
// The factory presets
// ---------------------------------------------------------------------------

/** A factory preset: its name and the settings it changes from a new PanMan's. */
export interface PanPreset {
  name: string;
  /** What it's for, said in the preset menu and to the assistant. */
  detail: string;
  settings: PanMan;
}

const preset = (name: string, detail: string, patch: Partial<Omit<PanMan, "preset">>): PanPreset => ({ name, detail, settings: { ...DEFAULT_PANMAN, ...patch, preset: name } });

export const PANMAN_PRESETS: readonly PanPreset[] = [
  preset("Slow Pan", "A slow pan back and forth across the speakers", {}),
  preset("Pendulum Pan", "Swinging side to side, smoothly, a little fat", { rate: 0.35, width: 160, smoothing: 0.85, style: "fat" }),
  preset("Faast Shimmer Pan", "A quick, narrow shimmer around the centre", { rate: 7, width: 80, smoothing: 0.7 }),
  preset("Lazy Drift", "Drifting across over many seconds", { rate: 0.08, width: 120, smoothing: 1 }),
  preset("Beyond the Speakers", "Sweeps past both speakers", { rate: 0.25, width: 210, smoothing: 0.8 }),
  preset("Spinning Wheel", "Left to right, again and again, quickly", { rate: 4, direction: "up", smoothing: 0.25 }),
  preset("Breathing Pan", "Narrow when quiet, wide when loud", { rate: 0.5, width: 60, smoothing: 0.8, threshold: -30, widthMod: 120, attack: 0.3, release: 1.2 }),
  preset("Pumped Pan", "A pan through extreme pumping compression", { rate: 1, smoothing: 0.6, style: "pump" }),
  preset("Tooo Dang Fast", "Triplet 16ths stepping right to left, fat", { mode: "rhythmStep", rhythm: "1/16t", steps: 3, direction: "down", smoothing: 0.55, style: "fat" }),
  preset("Eighth Hop", "Left, right, every 8th note", { mode: "rhythmStep", rhythm: "1/8", steps: 2, smoothing: 0.15 }),
  preset("Three Step Walk", "Walking left to right in 8th notes", { mode: "rhythmStep", rhythm: "1/8", steps: 3, direction: "up", smoothing: 0.3 }),
  preset("Dotted Bounce", "Side to side on dotted 8ths", { mode: "rhythmStep", rhythm: "1/8d", steps: 2, smoothing: 0.25 }),
  preset("Sixteenth Sprinkle", "Five places, back and forth, in 16ths", { mode: "rhythmStep", rhythm: "1/16", steps: 5, width: 150, smoothing: 0.2 }),
  preset("Wiper Panner", "A dotted-half sweep right to left, like a wiper", { mode: "rhythmShape", rhythm: "1/2d", direction: "down", smoothing: 0.35 }),
  preset("Quarter Sway", "Swaying on the beat", { mode: "rhythmShape", rhythm: "1/4", smoothing: 0.6 }),
  preset("Swung Eighths", "8th-note sways with a swing", { mode: "rhythmShape", rhythm: "1/8", groove: 0.7, smoothing: 0.5 }),
  preset("Saw Train", "8th-note sweeps left to right", { mode: "rhythmShape", rhythm: "1/8", direction: "up", smoothing: 0.15 }),
  preset("Fast When Loud", "Quarter-note sways that double when the sound is loud", { mode: "rhythmShape", rhythm: "1/4", smoothing: 0.6, threshold: -20, gate: true, rateMod: 1, attack: 0.05, release: 0.5 }),
  preset("SpazPong", "Hard left, hard right, on every hit, fat", { mode: "pingPong", trigger: -18, smoothing: 0.05, style: "fat" }),
  preset("Every Other Hit", "Moves side on every second hit", { mode: "pingPong", trigger: -18, divider: 2, smoothing: 0.2 }),
  preset("Bar Bouncer", "Moves side every fourth kick", { mode: "pingPong", trigger: -20, divider: 4, smoothing: 0.35, filter: "lpf", cutoff: 200 }),
  preset("Hi-Hat Ping", "Bounces on the hi-hats, not the kick", { mode: "pingPong", trigger: -24, filter: "hpf", cutoff: 6000, filterGain: 6, width: 140, smoothing: 0.1 }),
  preset("Random Ambler", "Wandering to a new place every half note", { mode: "random", rhythm: "1/2", width: 140, smoothing: 0.7 }),
  preset("Quarter Wander", "A new place every beat, gliding", { mode: "random", rhythm: "1/4", smoothing: 0.45 }),
  preset("Scatter", "A new place every 16th, jumping", { mode: "random", rhythm: "1/16", width: 200, smoothing: 0 }),
  preset("EasyHopper", "A new place on every hit, gently", { mode: "step", trigger: -20, width: 150, smoothing: 0.3 }),
  preset("Kick Scatter", "A new place on every kick", { mode: "step", trigger: -16, filter: "lpf", cutoff: 150, smoothing: 0.1 }),
];
export const panPreset = (name: string) => PANMAN_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
