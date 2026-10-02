/**
 * Gross Beat's constants and its factory presets (`docs/fl-studio/gross-beat.md`): the 36 time and 36 volume
 * slots it comes with, named as FL's are (the screenshot's list; the few it hides are guessed), each made
 * here from its idea (a repeat, a gate, a tape stop...). A slot the user hasn't changed isn't stored in the
 * song: it's its preset, from this file.
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { type AutomationPoint, type CurveType, type GrossBeatSlot, PPQ, type PluginRef } from "./types.ts";

/** What a Gross Beat effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const GROSS_BEAT_PLUGIN: PluginRef = { id: "vaudio:gross-beat", name: "Gross Beat", format: "Vaudio" };
export const isGrossBeat = (plugin: Pick<PluginRef, "id">) => plugin.id === GROSS_BEAT_PLUGIN.id;

/** Time slots and volume slots: 36 of each. */
export const GROSS_SLOTS = 36;
/** A slot's envelope is a bar of 4 beats long (quarter notes, whatever the time signature). */
export const GROSS_BEATS = 4;
export const GROSS_TICKS = GROSS_BEATS * PPQ;
/** How far back a time envelope reaches, in beats: the bottom of the panel (the rolling buffer is 2 bars). */
export const GROSS_DEPTH = 8;
/** TRIG SYNC and POS SYNC's choices, in beats (0: Off). */
export const GROSS_SYNCS = [0, 0.25, 0.5, 1, 2, 4] as const;
/** The longest smoothing, in seconds (ATT, REL). */
export const MAX_GROSS_ATTACK = 0.5;
export const MAX_GROSS_RELEASE = 1;

/** A time envelope's value for an offset in beats (0 is now, -8 is the bottom). */
export const offsetValue = (beats: number) => 1 + beats / GROSS_DEPTH;
/** A time envelope's offset in beats for a value. */
export const valueOffset = (value: number) => (value - 1) * GROSS_DEPTH;

// ---------------------------------------------------------------------------
// Building envelopes
// ---------------------------------------------------------------------------

const tick = (beat: number) => Math.round(beat * PPQ);
const point = (beat: number, value: number, curve: CurveType = "single", tension = 0): AutomationPoint => ({ tick: tick(beat), value, tension, curve });

/** A run of steps: from each `[beat, value]` it holds that value until the next, to the bar's end. */
function steps(list: readonly (readonly [number, number])[]): AutomationPoint[] {
  const points = list.map(([beat, value], i) => point(beat, value, i ? "hold" : "single"));
  const last = list[list.length - 1];
  return [...points, point(GROSS_BEATS, last[1], "hold")];
}

/** A time envelope's steps, by offset in beats. */
const timeSteps = (list: readonly (readonly [number, number])[]) => steps(list.map(([beat, offset]) => [beat, offsetValue(offset)] as const));

/** Where each of a bar's pieces starts, `length` beats long. */
const starts = (length: number) => Array.from({ length: Math.ceil(GROSS_BEATS / length - 1e-9) }, (_, k) => k * length);

/**
 * A repeat: the bar's first `length` beats played again and again. Each step reads from where the bar
 * began, so the steps run down the safety line (FL's Spd Up Rpt in the screenshot).
 */
const repeat = (length: number) => timeSteps(starts(length).map((s) => [s, -s] as const));

/** A repeat of pieces that change length: from the bar's start, each piece's start read again. */
const repeatPieces = (lengths: readonly number[]) => {
  const list: [number, number][] = [];
  let at = 0;
  for (const length of lengths) {
    if (at >= GROSS_BEATS) break;
    // Whole ticks, so a piece starts exactly where it reads from.
    const start = tick(at) / PPQ;
    list.push([start, -start]);
    at += length;
  }
  return timeSteps(list);
};

/**
 * Each `length` beats, a ramp from `from` to `to` (offsets in beats), jumping back at each piece's start:
 * a ramp up is faster and higher, a ramp down slower and lower.
 */
function ramps(length: number, from: number, to: number, curve: CurveType = "single", tension = 0): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  for (const s of starts(length)) {
    // The jump: on the piece's start, the value it ramps from (after the last piece's end).
    points.push(point(s, offsetValue(from), s ? "hold" : "single"));
    points.push(point(Math.min(GROSS_BEATS, s + length), offsetValue(to), curve, tension));
  }
  return points;
}

/** Points through `[beat, offset]`s, each segment of `curve`. */
const timePath = (list: readonly (readonly [number, number])[], curve: CurveType = "single", tension = 0) =>
  list.map(([beat, offset], i) => point(beat, offsetValue(offset), i ? curve : "single", tension));

/**
 * A gate: on for `duty` of each `period` beats, off for the rest (`on` and `off` its levels; `levels`, a
 * level for each period, fading it).
 */
function gate(period: number, duty = 0.5, levels?: (k: number, n: number) => number, off = 0): AutomationPoint[] {
  const list: [number, number][] = [];
  const all = starts(period);
  all.forEach((s, k) => {
    list.push([s, levels ? levels(k, all.length) : 1]);
    list.push([s + period * duty, off]);
  });
  return steps(list.filter(([beat]) => beat < GROSS_BEATS));
}

/** A 16-step gate (sixteenth notes): `pattern` of 1s and 0s, or levels from 0 to 9. */
function stepGate(pattern: string): AutomationPoint[] {
  const list: [number, number][] = [];
  let last = -1;
  [...pattern].forEach((c, k) => {
    const value = c === "x" ? 1 : Number(c) / (c === "1" || c === "0" ? 1 : 9);
    if (value !== last) list.push([k / 4, value]);
    last = value;
  });
  return steps(list);
}

/** Each `period` beats, a saw: up at once, then down to `low` (`curve` shaping it). */
function saws(period: number, low = 0, curve: CurveType = "single", tension = 0): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  for (const s of starts(period)) {
    points.push(point(s, 1, s ? "hold" : "single"));
    points.push(point(Math.min(GROSS_BEATS, s + period), low, curve, tension));
  }
  return points;
}

/** A tremolo: from 1 down to `low` and back each `period` beats, smoothly (S curves). */
function tremolo(period: number, low: number): AutomationPoint[] {
  const points = [point(0, 1)];
  for (const s of starts(period)) {
    points.push(point(s + period / 2, low, "double"));
    points.push(point(s + period, 1, "double"));
  }
  return points;
}

/** Each beat: down to nothing on it, then back up fast and easing (a compressor keyed by a kick). */
function pump(recovery: number): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  for (const s of starts(1)) {
    points.push(point(s, 0, s ? "hold" : "single"));
    points.push(point(s + recovery, 1, "single", -0.55));
  }
  points.push(point(GROSS_BEATS, 1));
  return points;
}

const flat = (value: number) => [point(0, value), point(GROSS_BEATS, value)];
const slot = (name: string, points: AutomationPoint[]): GrossBeatSlot => ({ name, points });

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

/** Pieces getting shorter (Spd Up Rpt) or longer (Slw Dwn Rpt): a geometric run, none shorter than a 32nd. */
const speedingUp = (() => {
  const lengths: number[] = [];
  let length = 0.5;
  for (let at = 0; at < GROSS_BEATS; at += length, length = Math.max(1 / 32, length * 0.8)) lengths.push(length);
  return lengths;
})();
const slowingDown = (() => {
  const lengths: number[] = [];
  let length = 1 / 16;
  for (let at = 0; at < GROSS_BEATS; at += length, length = Math.min(1, length * 1.35)) lengths.push(length);
  return lengths;
})();

/** The time slots, as FL's come (the screenshot's list, in its order). */
export const GROSS_TIME_PRESETS: readonly GrossBeatSlot[] = [
  slot("Empty", flat(1)),
  slot("2 Beat Rpt", repeat(2)),
  slot("1.5 Beat Rpt", repeat(1.5)),
  slot("1 Beat Rpt", repeat(1)),
  slot("3/4 Repeat", repeat(0.75)),
  slot("1/2 Repeat", repeat(0.5)),
  slot("1/3 Repeat", repeat(1 / 3)),
  slot("1/4 Repeat", repeat(0.25)),
  slot("1/6 Repeat", repeat(1 / 6)),
  slot("1/8 Repeat", repeat(0.125)),
  slot("1/12 Repeat", repeat(1 / 12)),
  slot("1/16 Repeat", repeat(1 / 16)),
  slot("1.5 Bt Juggle", timeSteps([[0, 0], [1.5, -1.5], [3, 0]])),
  slot("1 Beat Juggle", timeSteps([[0, 0], [1, -1], [2, 0], [3, -1]])),
  slot("Slw Dwn Rpt", repeatPieces(slowingDown)),
  slot("Spd Up Rpt", repeatPieces(speedingUp)),
  // A quarter beat's sound in each quarter beat, an octave up (twice as fast, so it reaches back a quarter).
  slot("1/4 Pitch Up", ramps(0.25, -0.25, 0)),
  // Half speed, an octave down, starting afresh every quarter beat.
  slot("1/4 Pitch Dn", ramps(0.25, 0, -0.125)),
  slot("Pitch Bend", timePath([[0, 0], [2, -1], [4, 0]], "double")),
  slot("Jumps", timeSteps([[0, 0], [0.5, -0.5], [1, 0], [1.5, -1], [2, -2], [2.5, 0], [3, -1.5], [3.5, -3]])),
  // Two beats back for every beat on: normal speed, backwards, through the last bar.
  slot("Reverse", timePath([[0, 0], [4, -8]])),
  slot("Backspin", [point(0, 1), point(3, 1), point(4, offsetValue(-4), "single", 0.5)]),
  slot("Backspinstart", [point(0, 1), point(1, offsetValue(-3), "altSingle", 0.35), point(1, 1, "hold"), point(4, 1)]),
  // Speed from 1 down to 0 across the bar (a turntable switched off): the offset falls as x².
  slot("Vinyl Off", [point(0, 1), point(4, offsetValue(-2), "single", 1 / 3)]),
  // From a standstill up to speed.
  slot("Vinyl On", [point(0, 1), point(4, offsetValue(-2), "altSingle", -1 / 3)]),
  slot("Vinyl Push", timePath([[0, 0], [2, -0.5], [4, 0]], "double")),
  slot("Vinyl Stop", [point(0, 1), point(3, 1), point(4, offsetValue(-0.5), "single", 1 / 3)]),
  slot("Bar Scratch", timePath([[0, 0], [4, -2]], "wave", -0.4)),
  // Back and forth on each beat (and on each triplet): back slowly, then forward fast to catch up.
  slot("Scratch", timePath([[0, 0], ...starts(1).flatMap((s): [number, number][] => [[s + 0.5, -0.75], [s + 1, 0]])], "double")),
  slot("Trip Scratch", timePath([[0, 0], ...starts(2 / 3).flatMap((s): [number, number][] => [[s + 1 / 3, -0.5], [s + 2 / 3, 0]])], "double")),
  slot("1/2 Speed", timePath([[0, 0], [4, -2]])),
  // Each beat the last beat and this one, twice as fast.
  slot("X2 Speed", ramps(1, -1, 0)),
  // Grains at their own speed, read from half as far along: half the tempo, the same pitch.
  slot("1/2 Grains", [point(0, 1), point(4, offsetValue(-2), "stairs", 1)]),
  slot("Slow Tripplet", timeSteps(starts(1 / 3).map((s, k) => [s, -k / 9] as const))),
  slot("Underwater", timePath([[0, -0.1], [2, -0.16], [4, -0.1]], "wave", 0.25)),
  // Every second sixteenth replays the one before.
  slot("Digital", timeSteps(starts(1 / 16).map((s, k) => [s, k % 2 ? -1 / 16 : 0] as const))),
];

/** The volume slots, as FL's come. */
export const GROSS_VOLUME_PRESETS: readonly GrossBeatSlot[] = [
  slot("Empty", flat(1)),
  slot("2 Beat Gate", gate(2)),
  slot("1 Beat Gate", gate(1)),
  slot("1/2 Bt Gate", gate(0.5)),
  slot("1/3 Bt Gate", gate(1 / 3)),
  slot("1/4 Bt Gate", gate(0.25)),
  slot("1/6 Bt Gate", gate(1 / 6)),
  slot("1/8 Bt Gate", gate(0.125)),
  slot("Trance Gt 1", stepGate("1011011010110110")),
  slot("Trance Gt 2", stepGate("1101101101101010")),
  slot("Trance Gt 3", stepGate("1110111011101110")),
  slot("Trance Gt 4", stepGate("1010101110101011")),
  slot("Saw Gate 1", saws(0.5)),
  slot("Saw Gate 2", saws(0.25)),
  slot("1st Step", gate(1, 0.25)),
  slot("1st Stp Fade", (() => {
    const points: AutomationPoint[] = [];
    for (const s of starts(1)) points.push(point(s, 1, s ? "hold" : "single"), point(s + 0.25, 0, "single", 0.3));
    return [...points, point(4, 0)];
  })()),
  slot("2nd Step", stepGate("0100010001000100")),
  slot("Off Beat", stepGate("0011001100110011")),
  slot("Dotted Gate", gate(0.75, 2 / 3)),
  slot("Swing Gate", steps(starts(1).flatMap((s) => [[s, 1], [s + 0.4, 0], [s + 2 / 3, 1], [s + 0.9, 0]] as [number, number][]))),
  slot("1/4 Gate Out", gate(0.25, 0.5, (k, n) => 1 - k / n)),
  slot("1/4 Gate In", gate(0.25, 0.5, (k, n) => (k + 1) / n)),
  slot("Spd Up Gate", (() => {
    const list: [number, number][] = [];
    let at = 0;
    for (let period = 1; at < GROSS_BEATS; at += period, period = Math.max(1 / 16, period * 0.75)) list.push([at, 1], [at + period / 2, 0]);
    return steps(list.filter(([b]) => b < GROSS_BEATS));
  })()),
  slot("Slw Dn Gate", (() => {
    const list: [number, number][] = [];
    let at = 0;
    for (let period = 1 / 8; at < GROSS_BEATS; at += period, period = Math.min(1, period * 1.3)) list.push([at, 1], [at + period / 2, 0]);
    return steps(list.filter(([b]) => b < GROSS_BEATS));
  })()),
  // A quarter-beat gate fading away: its off steps rise until it's gone.
  slot("Gate Fade", (() => {
    const all = starts(0.25);
    return steps(all.flatMap((s, k) => [[s, 1], [s + 0.125, k / (all.length - 1)]] as [number, number][]));
  })()),
  slot("Gate Beat", stepGate("1001001000101000")),
  slot("Tremelo Slw", tremolo(1, 0.15)),
  slot("Tremelo Fst", tremolo(0.25, 0.15)),
  slot("Sidechain", pump(0.6)),
  slot("Drum Loop", stepGate("x05090x050090730")),
  slot("Copter", gate(1 / 12)),
  slot("AM", tremolo(1 / 16, 0)),
  slot("Fade In", [point(0, 0), point(4, 1)]),
  slot("Fade Out", [point(0, 1), point(4, 0)]),
  slot("Fade In Out", [point(0, 0), point(2, 1), point(4, 0)]),
  slot("Mute", flat(0)),
];
