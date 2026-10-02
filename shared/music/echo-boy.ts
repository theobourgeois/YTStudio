/**
 * EchoBoy (`docs/soundtoys/echoboy-manual.md`): its edits, what its controls mean (echo times at the tempo,
 * Groove, Feel, Accent, Width, Rhythm Echo's taps and shapes), and the settings the engine plays
 * (`engineEchoBoy`). Pure and tested.
 *
 * What the engine gets is the echo as delay lines, not as modes: up to four lines, what each takes from
 * the input, a feedback matrix between them and where each is heard. Every mode is a way of wiring them
 * (decided here): Groove's "every other repeat" is a pair of lines per side (one T + g long, the other
 * T - g, each feeding the other, so the repeats alternate); Ping-Pong is two lines in series; Dual's
 * FB Mix is the matrix's cross terms; Rhythm Echo is one line as long as its pattern, read by its taps.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import { HIGH_CUT_RANGE, LOW_CUT_RANGE, MAX_ECHO_BPM, MAX_ECHO_GAIN, MAX_ECHO_MS, MAX_RHYTHM_BEATS, MAX_TAPS, MIN_ECHO_BPM, evenTaps, noteBeats, normalizeEchoBoy, normalizeTaps } from "./echo-boy-presets.ts";
import { ECHO_STYLES, decayDb, styleNamed } from "./echo-boy-styles.ts";
import {
  ECHO_SATURATIONS,
  ECHO_WOBBLES,
  type EchoBoy,
  type EchoControl,
  type EchoNote,
  type EchoRhythm,
  type EchoStyle,
  type EchoTime,
  type MusicProject,
  type PanShape,
  type RhythmShape,
  type RhythmTap,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Finding and editing
// ---------------------------------------------------------------------------

/** An EchoBoy of the song, by its effect's id: its track, slot and settings. */
export function findEchoBoy(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.echoBoy) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, echoBoy: found.effect.echoBoy };
}

/** The song's EchoBoys, each with its track. */
export function echoBoys(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.echoBoy ? [{ track, slot, effect, echoBoy: effect.echoBoy }] : [])));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Change an EchoBoy's settings (`change` returning equal settings: the same song). What it returns is validated. */
export function editEchoBoy(song: MusicProject, effectId: string, change: (eb: EchoBoy) => EchoBoy): MusicProject {
  const found = findEchoBoy(song, effectId);
  if (!found) return song;
  const changed = change(found.echoBoy);
  if (changed === found.echoBoy) return song;
  const next = normalizeEchoBoy(changed);
  if (same(next, found.echoBoy)) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, echoBoy: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

export type EchoBoyPatch = Partial<Omit<EchoBoy, "echo1" | "echo2" | "rhythm" | "custom">> & {
  echo1?: Partial<EchoTime>;
  echo2?: Partial<EchoTime>;
};

/**
 * Change EchoBoy's controls. A preset loaded stays named until the sound is changed. Changing the
 * mode keeps each echo's time as it was (EchoBoy keeps a value per knob).
 */
export function updateEchoBoy(song: MusicProject, effectId: string, patch: EchoBoyPatch): MusicProject {
  return editEchoBoy(song, effectId, (eb) => {
    const { echo1, echo2, ...rest } = patch;
    const next = { ...eb, ...rest, ...(echo1 && { echo1: { ...eb.echo1, ...echo1 } }), ...(echo2 && { echo2: { ...eb.echo2, ...echo2 } }) };
    if (patch.style !== undefined && patch.style !== eb.style) next.custom = null;
    return patch.preset === undefined && soundChanged(eb, next) ? { ...next, preset: null } : next;
  });
}

/** Change Rhythm Echo's settings (`change` gets them and the tempo EchoBoy keeps to). */
export function updateRhythm(song: MusicProject, effectId: string, change: (rhythm: EchoRhythm, bpm: number) => EchoRhythm): MusicProject {
  return editEchoBoy(song, effectId, (eb) => {
    const rhythm = change(eb.rhythm, echoTempo(eb, song.settings.tempo));
    return rhythm === eb.rhythm ? eb : { ...eb, rhythm, preset: null };
  });
}

/** Whether what's heard changed (not just which preset is named). */
const soundChanged = (a: EchoBoy, b: EchoBoy) => !same({ ...a, preset: null }, { ...b, preset: null });

// ---------------------------------------------------------------------------
// The style
// ---------------------------------------------------------------------------

/** The style as it plays: the Style Editor's edit, or the named style. */
export const styleOf = (eb: EchoBoy): EchoStyle => eb.custom ?? styleNamed(eb.style);

/** The style's name as the Style LCD says it: "Custom" once it's been edited. */
export const styleLabel = (eb: EchoBoy) => (eb.custom ? "Custom" : eb.style);

/** Pick a style (its settings as they're made). */
export const setStyle = (song: MusicProject, effectId: string, name: string) =>
  ECHO_STYLES.some((s) => s.name === name) ? updateEchoBoy(song, effectId, { style: name }) : song;

/** Edit the style in the Style Editor: it becomes Custom (based on the named style). */
export function editStyle(song: MusicProject, effectId: string, change: (style: EchoStyle) => EchoStyle): MusicProject {
  return editEchoBoy(song, effectId, (eb) => {
    const before = styleOf(eb);
    const custom = change(before);
    if (same(custom, before)) return eb;
    return { ...eb, custom, preset: null };
  });
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** The tempo EchoBoy keeps to: the song's (MIDI on), or its own. */
export const echoTempo = (eb: EchoBoy, songTempo: number) => (eb.followTempo ? songTempo : eb.bpm);

/** An echo's time in ms at `bpm`: its ms, or its note value at the tempo (never past 15 s). */
export function echoMs(time: EchoTime, bpm: number): number {
  if (time.sync === "time") return time.ms;
  return Math.min(MAX_ECHO_MS, (noteBeats(time.note, time.sync) * 60_000) / clamp(bpm, 1, 2000));
}

/** As EchoBoy's LCD says it: "126.2 ms", "1/8", "1/16 dot", "1/16 tri". */
export function timeText(time: EchoTime): string {
  if (time.sync === "time") return time.ms >= 1000 ? `${(time.ms / 1000).toFixed(2)} s` : `${time.ms < 100 ? time.ms.toFixed(2) : time.ms.toFixed(1)} ms`;
  return `1/${time.note}${time.sync === "dot" ? " dot" : time.sync === "trip" ? " tri" : ""}`;
}

/** The time knob's place (0..1) for ms, and back: a log taper (1 ms near the bottom, 120 ms at the middle, 15 s at the top). */
export const msToKnob = (ms: number) => Math.log(clamp(ms, 0, MAX_ECHO_MS) + 1) / Math.log(MAX_ECHO_MS + 1);
export const knobToMs = (knob: number) => Math.round((Math.exp(clamp(knob, 0, 1) * Math.log(MAX_ECHO_MS + 1)) - 1) * 10) / 10;

/** The note values, longest first, as the knob steps through them in Note, Dot and Trip. */
export const NOTE_STEPS: readonly EchoNote[] = [2, 4, 8, 16, 32, 64];

/**
 * Tap tempo: the tempo the taps (times in ms, in order) say, from the gaps between the last few, or null
 * until there are two. A gap over 2 s starts again.
 */
export function tappedTempo(taps: readonly number[]): number | null {
  let start = taps.length - 1;
  while (start > 0 && taps[start] - taps[start - 1] <= 2000 && taps.length - start < 5) start--;
  if (taps[start + 1] !== undefined && taps[start + 1] - taps[start] > 2000) start++;
  const used = taps.slice(start);
  if (used.length < 2) return null;
  const gap = (used[used.length - 1] - used[0]) / (used.length - 1);
  return Math.round(clamp(60_000 / gap, MIN_ECHO_BPM, MAX_ECHO_BPM) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Rhythm Echo
// ---------------------------------------------------------------------------

/** The Rhythm knob's spacing, in beats, at `bpm` (its note value, or its ms). */
export const rhythmStep = (rhythm: EchoRhythm, bpm: number) => (rhythm.time.sync === "time" ? (rhythm.time.ms * bpm) / 60_000 : noteBeats(rhythm.time.note, rhythm.time.sync));

/** A factory pattern: its group (Patt's bars, notes, dotted, triplet), its name, its taps (beats, levels) and length. */
export interface RhythmPattern {
  group: "bars" | "notes" | "dotted" | "triplet" | "presets";
  name: string;
  taps: RhythmTap[];
  length: number;
}

const even = (group: RhythmPattern["group"], name: string, step: number, repeats: number, length: number): RhythmPattern => ({ group, name, taps: evenTaps(step, repeats, length), length });
const at = (name: string, length: number, beats: [number, number][]): RhythmPattern => ({ group: "presets", name, length, taps: [{ beat: 0, level: 1 }, ...beats.map(([beat, level]) => ({ beat, level }))] });

/** Patt's factory patterns. */
export const RHYTHM_PATTERNS: readonly RhythmPattern[] = [
  even("bars", "1 Bar", 4, 1, 8),
  even("bars", "2 Beats", 2, 3, 8),
  even("bars", "3 Beats", 3, 2, 8),
  even("notes", "1/4 Notes", 1, 3, 4),
  even("notes", "1/8 Notes", 0.5, 3, 2),
  even("notes", "1/16 Notes", 0.25, 7, 2),
  even("notes", "1/32 Notes", 0.125, 15, 2),
  even("dotted", "1/4 Dotted", 1.5, 5, 8),
  even("dotted", "1/8 Dotted", 0.75, 5, 4),
  even("dotted", "1/16 Dotted", 0.375, 10, 4),
  even("triplet", "1/4 Triplets", 2 / 3, 5, 4),
  even("triplet", "1/8 Triplets", 1 / 3, 5, 2),
  even("triplet", "1/16 Triplets", 1 / 6, 11, 2),
  at("Gallop", 2, [[0.5, 0.8], [0.75, 0.6], [1.5, 0.7], [1.75, 0.5]]),
  at("Clave", 4, [[0.75, 0.9], [1.5, 0.8], [2.5, 0.7], [3, 0.6]]),
  at("Tresillo", 2, [[0.75, 0.85], [1.5, 0.7]]),
  at("Bounce", 4, [[0.5, 0.9], [1.25, 0.75], [1.75, 0.6], [2.125, 0.5], [2.375, 0.4], [2.5, 0.35], [2.625, 0.3]]),
  at("Skip", 2, [[0.25, 0.5], [0.75, 0.9], [1.25, 0.5], [1.75, 0.7]]),
  at("Complex Pedal Pattern", 4.5, [[0.25, 0.45], [0.75, 0.7], [1, 0.4], [1.5, 0.85], [2, 0.55], [2.5, 0.95], [2.75, 0.6], [3, 0.8], [3.5, 0.5], [3.75, 0.4], [4.25, 0.35]]),
];

/** Rhythm Echo's taps, as the Rhythm knob or Repeats lay them out (its pattern then names the note value). */
export function layOutRhythm(rhythm: EchoRhythm, bpm: number, patch: Partial<Pick<EchoRhythm, "time" | "repeats">> = {}): EchoRhythm {
  const next = { ...rhythm, ...patch, time: { ...rhythm.time, ...patch.time } };
  const step = rhythmStep(next, bpm);
  if (!(step > 0)) return next;
  // The pattern grows to hold them all, up to its longest.
  const needed = Math.min(MAX_RHYTHM_BEATS, Math.max(next.length, Math.ceil(step * next.repeats + 1e-9 + step * 0.0001)));
  const length = Math.max(next.length, needed);
  const name = next.time.sync === "time" ? `${Math.round(next.time.ms)} ms` : `1/${next.time.note}${next.time.sync === "dot" ? " Dotted" : next.time.sync === "trip" ? " Triplets" : " Notes"}`;
  return { ...next, length, taps: evenTaps(step, next.repeats, length), pattern: name };
}

/** Load a factory pattern. */
export const usePattern = (rhythm: EchoRhythm, pattern: RhythmPattern): EchoRhythm => ({ ...rhythm, taps: pattern.taps, length: pattern.length, repeats: pattern.taps.length - 1, pattern: pattern.name });

/** The taps edited (added, moved, deleted: the grid's mouse): the pattern is Custom from then on. */
export const editTaps = (rhythm: EchoRhythm, taps: RhythmTap[]): EchoRhythm => ({ ...rhythm, taps: normalizeTaps(taps, rhythm.length), pattern: "Custom" });

/** A tap added at `beat` (none if one's there, or there are 16). */
export function addTap(taps: readonly RhythmTap[], beat: number, level = 1): RhythmTap[] {
  if (taps.length >= MAX_TAPS || taps.some((t) => Math.abs(t.beat - beat) < 1e-6)) return [...taps];
  return [...taps, { beat, level }].sort((a, b) => a.beat - b.beat);
}

/** A tap moved: back where it was if another's on its new beat. */
export function moveTap(taps: readonly RhythmTap[], index: number, beat: number, level: number): RhythmTap[] {
  if (!taps[index]) return [...taps];
  const clash = taps.some((t, i) => i !== index && Math.abs(t.beat - beat) < 1e-6);
  return taps.map((t, i) => (i === index ? { beat: clash ? t.beat : Math.max(0, beat), level: clamp(level, 0, 1) } : t)).sort((a, b) => a.beat - b.beat);
}

/** A beat snapped to the grid (a note value). */
export const snapBeat = (beat: number, grid: EchoNote) => Math.round(beat / noteBeats(grid)) * noteBeats(grid);

/** Each shape's level across the pattern, 0..1 of the way along it. */
const NONLIN = [1, 0.55, 0.9, 0.35, 0.75, 0.6, 0.95, 0.4, 0.7, 0.5, 0.85, 0.3, 0.65, 0.45, 0.8, 0.25];
function shapeLevel(shape: RhythmShape, x: number, index: number): number {
  switch (shape) {
    case "decay":
      return 1 - 0.9 * x;
    case "reverse":
      return 0.1 + 0.9 * x;
    case "swell":
      return 0.15 + 0.85 * Math.sin(Math.PI * x);
    case "fade":
      return 1 - 0.85 * Math.sin(Math.PI * x);
    case "nonLin":
      return NONLIN[index % NONLIN.length];
  }
}

/** Where `warp` (-1..1, Time's Warp) draws a tap: towards the pattern's start or end. */
export const warpBeat = (beat: number, length: number, warp: number) => (warp === 0 ? beat : length * (beat / length) ** 2 ** (-1.5 * warp));

/** A tap's pan for `shape`: the n-th echo tap of `count` (the "One" is centred). */
function tapPan(shape: PanShape, n: number, count: number): number {
  const x = count > 1 ? n / (count - 1) : 0.5;
  switch (shape) {
    case "double":
    case "center":
      return 0;
    case "alt1":
      return n % 2 ? 0.7 : -0.7;
    case "alt2":
      return [-0.8, 0, 0.8, 0][n % 4];
    case "alt3":
      return n % 2 ? 1 : -1;
    case "sweepL":
      return 1 - 2 * x;
    case "sweepR":
      return 2 * x - 1;
    case "pan":
      return [-0.9, 0.6, -0.3, 0.95, -0.7, 0.2, 0.75, -0.5][n % 8];
  }
}

/**
 * The taps as they're heard: their levels shaped (the "One" isn't) and accented, their beats warped
 * (Time) or swung by Groove (every other one), Double halving them to 8.
 */
export function heardTaps(eb: EchoBoy, bpm: number): { beat: number; level: number; pan: number; one: boolean }[] {
  const r = eb.rhythm;
  const step = rhythmStep(r, bpm);
  const echoes = r.taps.filter((t) => t.beat > 0);
  const kept = r.panShape === "double" ? echoes.slice(0, 8) : echoes;
  const shift = (-eb.groove * step) / 3;
  const accent = (n: number) => (r.time.sync === "time" ? 1 : n % 2 === 0 ? (r.accent < 0 ? 1 + r.accent : 1) : r.accent > 0 ? 1 - r.accent : 1);
  const out = kept.map((tap, n) => {
    const shaped = tap.level * (1 - r.shapeAmount * (1 - shapeLevel(r.shape, tap.beat / r.length, n)));
    const warped = r.time.sync === "time" ? warpBeat(tap.beat, r.length, r.accent) : tap.beat;
    const beat = clamp(warped + (n % 2 === 0 ? shift : 0), 0.001, r.length);
    return { beat, level: shaped * accent(n), pan: tapPan(r.panShape, n, kept.length), one: false };
  });
  const one = r.taps.find((t) => t.beat === 0);
  return one ? [{ beat: 0, level: one.level, pan: 0, one: true }, ...out] : out;
}

// ---------------------------------------------------------------------------
// What the engine plays
// ---------------------------------------------------------------------------

/** A delay line: its length (seconds), whether a new length glides (tape) or crossfades, what it takes from the input's sides and gives to the output's, and whose wobble it follows (0 left, 1 right). */
export interface EngineEchoLine {
  delay: number;
  glide: boolean;
  input: [number, number];
  out: [number, number];
  group: 0 | 1;
}

/** A Rhythm Echo tap reading line 0: its delay (seconds), its gains to each side, the right side's extra delay (Double), and whether it's the "One". */
export interface EngineEchoTap {
  delay: number;
  left: number;
  right: number;
  offset: number;
  one: boolean;
}

/**
 * EchoBoy as the engine plays it, in its own units (seconds, gains, Hz, dB). Each line takes in
 * `fixed[i][j] + amount * feedback[i][j]` of line j's output (row-major, N × N).
 */
export interface EngineEchoBoy {
  lines: EngineEchoLine[];
  feedback: number[];
  fixed: number[];
  amount: number;
  taps: EngineEchoTap[];
  /** Seconds every echo is heard later (Draggin') or earlier (Rushin'). */
  feel: number;
  dry: number;
  wet: number;
  input: number;
  output: number;
  /** The wet sound's sides, scaled (0 mono, 1 as it is, 2 wider than the speakers). */
  side: number;
  /** Hz; 0 is off. */
  lowCut: number;
  highCut: number;
  /** The Style Editor's EQ: [freq, gain dB, dB a further repeat] (mid: [freq, Q, gain dB, dB a further repeat]). */
  eq: { low: [number, number, number]; mid: [number, number, number, number]; high: [number, number, number] };
  diffusion: { amount: number; size: number; loop: boolean };
  wobble: { depth: number; rate: number; sync: number; shape: number; feedback: boolean; out: boolean };
  /** The saturation's type (`ECHO_SATURATIONS`' index), and its drives (dB, the front Saturation knob folded in). */
  saturation: { type: number; decay: number; out: number };
}

/** Feedback's knob to the loop's gain: past about 87% it's over 100%, and the saturation holds it. */
export const feedbackGain = (knob: number) => 1.15 * clamp(knob, 0, 1);
/** Mix's knob to the dry and wet gains: both full at 12 o'clock. */
export const mixGains = (mix: number): [number, number] => [Math.min(1, 2 * (1 - mix)), Math.min(1, 2 * mix)];
/** Width's knob to the wet sides' gain: 1 at 3 o'clock, past it wider than the speakers. */
export const sideGain = (width: number) => (width <= 0.75 ? width / 0.75 : 1 + (width - 0.75) / 0.25);
/** Feel's most, in seconds, each way. */
export const MAX_FEEL = 0.03;
/** The front Saturation knob's most, in dB, each way from the style's drives. */
const SATURATION_RANGE = 18;
const dbGain = (db: number) => 10 ** (db / 20);

const PRIMES = (() => {
  const max = MAX_ECHO_MS + 200;
  const sieve = new Uint8Array(max + 1);
  const list: number[] = [];
  for (let i = 2; i <= max; i++) {
    if (sieve[i]) continue;
    list.push(i);
    for (let j = i * i; j <= max; j += i) sieve[j] = 1;
  }
  return list;
})();

/** Prime Numbers: each time (ms) rounded to the nearest prime number of ms that's still free, so no two lines share a period. */
export function primeTimes(ms: readonly number[]): number[] {
  const used = new Set<number>();
  return ms.map((value) => {
    if (value < 2) return value;
    let lo = 0;
    let hi = PRIMES.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (PRIMES[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    // Outwards from the primes either side of it, nearest first.
    let below = lo - 1;
    let above = lo;
    while (below >= 0 || above < PRIMES.length) {
      const down = below >= 0 ? PRIMES[below] : Infinity;
      const up = above < PRIMES.length ? PRIMES[above] : Infinity;
      const pick = value - down <= up - value ? (below--, down) : (above++, up);
      if (!used.has(pick)) {
        used.add(pick);
        return pick;
      }
    }
    return value;
  });
}

/** Accent's levels for odd and even repeats: one of them softer. */
const accents = (a: number): [number, number] => (a >= 0 ? [1, 1 - a] : [1 + a, 1]);

/** EchoBoy's delay lines, feedback and taps for its mode (`docs/soundtoys/echoboy-manual.md`, The modes). */
function wiring(eb: EchoBoy, bpm: number): Pick<EngineEchoBoy, "lines" | "feedback" | "fixed" | "taps"> {
  const t1 = echoMs(eb.echo1, bpm);
  const t2 = echoMs(eb.echo2, bpm);
  // Groove: towards Shuffle every other repeat later, towards Swing earlier, up to a triplet's feel.
  const g = -eb.groove / 3;
  const offset = eb.offset * Math.min(1, eb.width / 0.75);
  const balance: [number, number] = [Math.min(1, 1 - eb.balance), Math.min(1, 1 + eb.balance)];
  const glide1 = eb.echo1.sync === "time";
  const glide2 = eb.echo2.sync === "time";
  const atLeast = (ms: number) => Math.max(0.05, ms);
  type Line = Omit<EngineEchoLine, "delay"> & { ms: number };
  let lines: Line[];
  let feedback: number[];
  let fixed: number[];
  let taps: EngineEchoTap[] = [];
  const zeros = (n: number) => new Array<number>(n * n).fill(0);

  if (eb.mode === "pingPong") {
    // Ping (left) feeds Pong (right) whatever the feedback (two repeats at none), Pong feeds Ping back.
    const [odd, even] = accents(eb.accent);
    lines = [
      { ms: atLeast(t1 * (1 + g)), glide: glide1, input: [0.5, 0.5], out: [balance[0] * odd, 0], group: 0 },
      { ms: atLeast(t2 - t1 * g), glide: glide2, input: [0, 0], out: [0, balance[1] * even], group: 1 },
    ];
    feedback = [0, 1, 0, 0];
    fixed = [0, 0, 1, 0];
  } else if (eb.mode === "rhythm") {
    // One line as long as the pattern, fed back whole; the taps read it.
    const beat = 60_000 / bpm;
    lines = [{ ms: atLeast(eb.rhythm.length * beat), glide: eb.rhythm.time.sync === "time", input: [0.5, 0.5], out: [0, 0], group: 0 }];
    feedback = [1];
    fixed = [0];
    const double = eb.rhythm.panShape === "double";
    taps = heardTaps(eb, bpm).map((tap) => {
      const pan = clamp(tap.pan, -1, 1);
      return {
        delay: (tap.beat * beat) / 1000,
        left: tap.level * Math.min(1, 1 - pan) * balance[0],
        right: tap.level * Math.min(1, 1 + pan) * balance[1],
        offset: double && !tap.one ? eb.offset / 1000 : 0,
        one: tap.one,
      };
    });
  } else {
    // Single and Dual: a pair of lines a side (L-A, L-B, R-A, R-B), A taking the input, A and B feeding
    // each other. Single's sides share a time (the right's later by L/R Offset); Dual's are Echo 1 and 2.
    const dual = eb.mode === "dual";
    const left = t1;
    const right = dual ? t2 : t1;
    const [odd1, even1] = accents(eb.accent);
    const [odd2, even2] = dual ? accents(eb.accent2) : [odd1, even1];
    const glideRight = dual ? glide2 : glide1;
    const b = dual ? balance : [1, 1];
    lines = [
      { ms: atLeast(left * (1 + g)), glide: glide1, input: [1, 0], out: [b[0] * odd1, 0], group: 0 },
      { ms: atLeast(left * (1 - g)), glide: glide1, input: [0, 0], out: [b[0] * even1, 0], group: 0 },
      { ms: atLeast(right * (1 + g) + offset), glide: glideRight, input: [0, 1], out: [0, b[1] * odd2], group: 1 },
      { ms: atLeast(right * (1 - g)), glide: glideRight, input: [0, 0], out: [0, b[1] * even2], group: 1 },
    ];
    // FB Mix crosses each side's feedback into the other; FB Bal shares it between them.
    const cross = dual ? eb.feedbackMix : 0;
    const share = dual ? [Math.min(1, 1 - eb.feedbackBalance), Math.min(1, 1 + eb.feedbackBalance)] : [1, 1];
    feedback = zeros(4);
    const into = (to: number, from: number, gain: number) => (feedback[to * 4 + from] += gain);
    // L-A from L-B (and R-B), L-B from L-A (and R-A); the right likewise.
    into(0, 1, share[0] * (1 - cross)), into(0, 3, share[0] * cross);
    into(1, 0, share[0] * (1 - cross)), into(1, 2, share[0] * cross);
    into(2, 3, share[1] * (1 - cross)), into(2, 1, share[1] * cross);
    into(3, 2, share[1] * (1 - cross)), into(3, 0, share[1] * cross);
    fixed = zeros(4);
  }

  const ms = eb.primeNumbers ? primeTimes(lines.map((l) => l.ms)) : lines.map((l) => l.ms);
  if (eb.primeNumbers && taps.length) {
    const primed = primeTimes(taps.map((t) => t.delay * 1000));
    taps = taps.map((t, i) => (t.one ? t : { ...t, delay: primed[i] / 1000 }));
  }
  return { lines: lines.map(({ ms: _, ...line }, i) => ({ ...line, delay: ms[i] / 1000 })), feedback, fixed, taps };
}

/** EchoBoy's settings as the engine plays them, at the song's tempo. */
export function engineEchoBoy(eb: EchoBoy, songTempo: number): EngineEchoBoy {
  const bpm = echoTempo(eb, songTempo);
  const style = styleOf(eb);
  const [dry, wet] = mixGains(eb.mix);
  const drive = (eb.saturation - 0.5) * 2 * SATURATION_RANGE;
  const q = (res: number) => 0.7 * 2 ** (res / 12);
  return {
    ...wiring(eb, bpm),
    amount: feedbackGain(eb.feedback),
    feel: eb.feel * MAX_FEEL,
    dry,
    wet,
    input: dbGain(eb.input),
    output: dbGain(eb.output),
    side: sideGain(eb.width),
    lowCut: eb.lowCut <= LOW_CUT_RANGE[0] + 0.5 ? 0 : eb.lowCut,
    highCut: eb.highCut >= HIGH_CUT_RANGE[1] - 1 ? 0 : eb.highCut,
    eq: {
      low: [style.low.freq, style.low.gain, decayDb(style.low.decay)],
      mid: [style.mid.freq, q(style.mid.res), style.mid.gain, decayDb(style.mid.decay)],
      high: [style.high.freq, style.high.gain, decayDb(style.high.decay)],
    },
    diffusion: { ...style.diffusion },
    wobble: { ...style.wobble, shape: ECHO_WOBBLES.indexOf(style.wobble.shape) },
    saturation: {
      type: ECHO_SATURATIONS.indexOf(style.saturation.type),
      decay: clamp(style.saturation.decay + drive, -MAX_ECHO_GAIN - SATURATION_RANGE, MAX_ECHO_GAIN + SATURATION_RANGE),
      out: clamp(style.saturation.out + drive, -MAX_ECHO_GAIN - SATURATION_RANGE, MAX_ECHO_GAIN + SATURATION_RANGE),
    },
  };
}

/** What an automation lane of EchoBoy's sets in the engine (`EngineLaneTarget` "echo"): its values, from the settings at a moment. */
export const ECHO_LANES = {
  mix: (e: EngineEchoBoy) => [e.dry, e.wet],
  feedback: (e: EngineEchoBoy) => [e.amount],
  delays: (e: EngineEchoBoy) => e.lines.map((l) => l.delay),
  lowCut: (e: EngineEchoBoy) => [e.lowCut],
  highCut: (e: EngineEchoBoy) => [e.highCut],
  saturation: (e: EngineEchoBoy) => [e.saturation.decay, e.saturation.out],
  input: (e: EngineEchoBoy) => [e.input],
  output: (e: EngineEchoBoy) => [e.output],
  feel: (e: EngineEchoBoy) => [e.feel],
  side: (e: EngineEchoBoy) => [e.side],
} as const;
export type EchoLane = keyof typeof ECHO_LANES;

/** Which engine lanes each automatable control moves (Width spreads the sides and offsets the right's echoes). */
export const LANES_OF: Record<EchoControl, readonly EchoLane[]> = {
  mix: ["mix"],
  feedback: ["feedback"],
  echo1: ["delays"],
  echo2: ["delays"],
  groove: ["delays"],
  width: ["side", "delays"],
  lowCut: ["lowCut"],
  highCut: ["highCut"],
  saturation: ["saturation"],
  input: ["input"],
  output: ["output"],
  feel: ["feel"],
};

// ---------------------------------------------------------------------------
// Its automatable controls
// ---------------------------------------------------------------------------

/**
 * An automatable control: its name, its value in the song (`get`, `set`), an automation clip's fraction
 * (0..1) as that value and back (the knob's taper), and its value said.
 */
export interface EchoControlSpec {
  name: string;
  get: (eb: EchoBoy) => number;
  set: (eb: EchoBoy, value: number) => EchoBoy;
  toControl: (fraction: number) => number;
  fromControl: (value: number) => number;
  format: (value: number, eb: EchoBoy | null) => string;
}

const linear = (min: number, max: number) => ({ toControl: (f: number) => min + clamp(f, 0, 1) * (max - min), fromControl: (v: number) => clamp((v - min) / (max - min), 0, 1) });
const logScale = (min: number, max: number) => ({
  toControl: (f: number) => min * (max / min) ** clamp(f, 0, 1),
  fromControl: (v: number) => clamp(Math.log(v / min) / Math.log(max / min), 0, 1),
});
const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`);
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const sided = (left: string, right: string) => (v: number) => (Math.abs(v) < 0.005 ? "Centre" : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? left : right}`);

/** An echo's knob (0..1): in Time, the log taper of its ms; in Note, Dot and Trip, its note value's step. */
function echoKnob(key: "echo1" | "echo2"): Pick<EchoControlSpec, "get" | "set" | "format"> {
  return {
    get: (eb) => (eb[key].sync === "time" ? msToKnob(eb[key].ms) : NOTE_STEPS.indexOf(eb[key].note) / (NOTE_STEPS.length - 1)),
    set: (eb, v) =>
      eb[key].sync === "time"
        ? { ...eb, [key]: { ...eb[key], ms: knobToMs(v) } }
        : { ...eb, [key]: { ...eb[key], note: NOTE_STEPS[Math.round(clamp(v, 0, 1) * (NOTE_STEPS.length - 1))] } },
    format: (v, eb) => {
      const time = eb?.[key] ?? { sync: "time" as const, ms: knobToMs(v), note: 8 as const };
      return timeText(time.sync === "time" ? { ...time, ms: knobToMs(v) } : { ...time, note: NOTE_STEPS[Math.round(clamp(v, 0, 1) * (NOTE_STEPS.length - 1))] });
    },
  };
}

export const ECHO_CONTROL_SPECS: Record<EchoControl, EchoControlSpec> = {
  mix: { name: "Mix", get: (eb) => eb.mix, set: (eb, mix) => ({ ...eb, mix }), ...linear(0, 1), format: pct },
  feedback: { name: "Feedback", get: (eb) => eb.feedback, set: (eb, feedback) => ({ ...eb, feedback }), ...linear(0, 1), format: pct },
  echo1: { name: "Echo 1", ...echoKnob("echo1"), ...linear(0, 1) },
  echo2: { name: "Echo 2", ...echoKnob("echo2"), ...linear(0, 1) },
  lowCut: { name: "Low Cut", get: (eb) => eb.lowCut, set: (eb, lowCut) => ({ ...eb, lowCut }), ...logScale(LOW_CUT_RANGE[0], LOW_CUT_RANGE[1]), format: (v) => (v <= LOW_CUT_RANGE[0] + 0.5 ? "Off" : hz(v)) },
  highCut: { name: "High Cut", get: (eb) => eb.highCut, set: (eb, highCut) => ({ ...eb, highCut }), ...logScale(HIGH_CUT_RANGE[0], HIGH_CUT_RANGE[1]), format: (v) => (v >= HIGH_CUT_RANGE[1] - 1 ? "Off" : hz(v)) },
  saturation: { name: "Saturation", get: (eb) => eb.saturation, set: (eb, saturation) => ({ ...eb, saturation }), ...linear(0, 1), format: pct },
  input: { name: "Input", get: (eb) => eb.input, set: (eb, input) => ({ ...eb, input }), ...linear(-MAX_ECHO_GAIN, MAX_ECHO_GAIN), format: db },
  output: { name: "Output", get: (eb) => eb.output, set: (eb, output) => ({ ...eb, output }), ...linear(-MAX_ECHO_GAIN, MAX_ECHO_GAIN), format: db },
  groove: { name: "Groove", get: (eb) => eb.groove, set: (eb, groove) => ({ ...eb, groove }), ...linear(-1, 1), format: sided("shuffle", "swing") },
  feel: { name: "Feel", get: (eb) => eb.feel, set: (eb, feel) => ({ ...eb, feel }), ...linear(-1, 1), format: sided("rushin'", "draggin'") },
  width: { name: "Width", get: (eb) => eb.width, set: (eb, width) => ({ ...eb, width }), ...linear(0, 1), format: pct },
};
