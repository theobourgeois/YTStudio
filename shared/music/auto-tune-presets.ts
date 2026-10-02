/**
 * Auto-Tune's constants, defaults and presets (`docs/antares/auto-tune.md`): what each Input Type listens
 * for, the scales, a new Auto-Tune's settings (hard-tuned: Retune Speed 0, as Théo asked), validating them,
 * and the presets the window and the assistant start from.
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import {
  AUTO_TUNE_INPUTS,
  AUTO_TUNE_SCALES,
  type AutoTune,
  type AutoTuneControl,
  type AutoTuneInput,
  type AutoTuneNote,
  type AutoTuneScale,
  type AutoTuneVibrato,
  type PluginRef,
  VIBRATO_SHAPES,
  type VibratoShape,
} from "./types.ts";

/** What an Auto-Tune effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const AUTO_TUNE_PLUGIN: PluginRef = { id: "vaudio:auto-tune", name: "Auto-Tune", format: "Vaudio" };
export const isAutoTune = (plugin: Pick<PluginRef, "id">) => plugin.id === AUTO_TUNE_PLUGIN.id;

/**
 * Each Input Type: its name and the pitches it listens for (Hz). The lowest decides how far ahead it must
 * look (two periods and more), so a deeper voice is a little later; Bass Instrument the latest.
 */
export const INPUT_TYPES: Record<AutoTuneInput, { name: string; minHz: number; maxHz: number }> = {
  soprano: { name: "Soprano", minHz: 110, maxHz: 1400 },
  altoTenor: { name: "Alto/Tenor", minHz: 75, maxHz: 1100 },
  lowMale: { name: "Low Male", minHz: 55, maxHz: 700 },
  instrument: { name: "Instrument", minHz: 55, maxHz: 2000 },
  bass: { name: "Bass Instrument", minHz: 27.5, maxHz: 440 },
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
/** A MIDI note's name with its octave (60 is C4, as Auto-Tune says it). */
export const noteName = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Each scale: its name and its notes, in semitones from the key. */
export const SCALES: Record<AutoTuneScale, { name: string; steps: readonly number[] }> = {
  chromatic: { name: "Chromatic", steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: "Harmonic Minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { name: "Jazz Melodic Minor", steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { name: "Dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: "Phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: "Lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: "Mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: "Locrian", steps: [0, 1, 3, 5, 6, 8, 10] },
  majorPentatonic: { name: "Major Pentatonic", steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: "Minor Pentatonic", steps: [0, 3, 5, 7, 10] },
  blues: { name: "Blues", steps: [0, 3, 5, 6, 7, 10] },
  wholeTone: { name: "Whole Tone", steps: [0, 2, 4, 6, 8, 10] },
  diminished: { name: "Diminished", steps: [0, 2, 3, 5, 6, 8, 9, 11] },
};

/** A scale's notes by pitch class (C first): its notes tuned to, the others removed. */
export function scaleNotes(key: number, scale: AutoTuneScale): AutoTuneNote[] {
  const on = new Set(SCALES[scale].steps.map((s) => (s + key) % 12));
  return Array.from({ length: 12 }, (_, pc) => (on.has(pc) ? "tune" : "remove"));
}

/** The ranges of its controls (and of their knobs). */
export const MAX_RETUNE = 400;
export const MAX_DETUNE = 100;
export const MAX_NATURAL_VIBRATO = 12;
export const MAX_TRANSPOSE = 12;
export const MIN_THROAT = 0.5;
export const MAX_THROAT = 1.8;
export const MAX_ONSET = 1500;
export const MAX_VIBRATO_AMPLITUDE = 0.3;

/** Create Vibrato as it comes (Auto-Tune's own defaults), off until a shape is chosen. */
export const DEFAULT_VIBRATO: AutoTuneVibrato = { shape: "none", rate: 5.5, delay: 500, onset: 500, variation: 0.2, pitch: 18, amplitude: 0.1, formant: 0.7 };

/**
 * A new Auto-Tune: Alto/Tenor, C Chromatic (every note a target: it works on any song until its key is
 * set), and tuned as hard as it goes (Retune Speed 0, no Humanize or Flex-Tune), as Théo wants it.
 * Formant is on, so Transpose keeps the voice's character.
 */
export const DEFAULT_AUTO_TUNE: AutoTune = {
  input: "altoTenor",
  key: 0,
  scale: "chromatic",
  notes: scaleNotes(0, "chromatic"),
  detune: 0,
  retuneSpeed: 0,
  humanize: 0,
  flexTune: 0,
  naturalVibrato: 0,
  tracking: 0.5,
  transpose: 0,
  formant: true,
  throat: 1,
  classic: false,
  ignoreVibrato: false,
  vibrato: DEFAULT_VIBRATO,
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const NOTES: readonly AutoTuneNote[] = ["tune", "bypass", "remove"];

function normalizeVibrato(input: unknown): AutoTuneVibrato {
  if (!isObject(input)) return DEFAULT_VIBRATO;
  const d = DEFAULT_VIBRATO;
  return {
    shape: VIBRATO_SHAPES.includes(input.shape as VibratoShape) ? (input.shape as VibratoShape) : d.shape,
    rate: number(input.rate, 0.1, 10, d.rate),
    delay: number(input.delay, 0, MAX_ONSET, d.delay),
    onset: number(input.onset, 0, MAX_ONSET, d.onset),
    variation: number(input.variation, 0, 1, d.variation),
    pitch: number(input.pitch, 0, 100, d.pitch),
    amplitude: number(input.amplitude, 0, MAX_VIBRATO_AMPLITUDE, d.amplitude),
    formant: number(input.formant, 0, 1, d.formant),
  };
}

/** Auto-Tune's settings: anything missing or wrong is its default (the notes, the scale's). */
export function normalizeAutoTune(input: unknown): AutoTune {
  if (!isObject(input)) return DEFAULT_AUTO_TUNE;
  const d = DEFAULT_AUTO_TUNE;
  const key = Number.isInteger(input.key) && (input.key as number) >= 0 && (input.key as number) < 12 ? (input.key as number) : d.key;
  const scale = AUTO_TUNE_SCALES.includes(input.scale as AutoTuneScale) ? (input.scale as AutoTuneScale) : d.scale;
  const notes =
    Array.isArray(input.notes) && input.notes.length === 12 && input.notes.every((n) => NOTES.includes(n as AutoTuneNote)) ? (input.notes as AutoTuneNote[]).slice() : scaleNotes(key, scale);
  return {
    input: AUTO_TUNE_INPUTS.includes(input.input as AutoTuneInput) ? (input.input as AutoTuneInput) : d.input,
    key,
    scale,
    notes,
    detune: number(input.detune, -MAX_DETUNE, MAX_DETUNE, d.detune),
    retuneSpeed: number(input.retuneSpeed, 0, MAX_RETUNE, d.retuneSpeed),
    humanize: number(input.humanize, 0, 1, d.humanize),
    flexTune: number(input.flexTune, 0, 1, d.flexTune),
    naturalVibrato: number(input.naturalVibrato, -MAX_NATURAL_VIBRATO, MAX_NATURAL_VIBRATO, d.naturalVibrato),
    tracking: number(input.tracking, 0, 1, d.tracking),
    transpose: Math.round(number(input.transpose, -MAX_TRANSPOSE, MAX_TRANSPOSE, d.transpose)),
    formant: typeof input.formant === "boolean" ? input.formant : d.formant,
    throat: number(input.throat, MIN_THROAT, MAX_THROAT, d.throat),
    classic: input.classic === true,
    ignoreVibrato: input.ignoreVibrato === true,
    vibrato: normalizeVibrato(input.vibrato),
  };
}

/** What a preset sets: its sound, never the key, scale or voice (those are the song's and the singer's). */
export type AutoTuneSound = Partial<Omit<AutoTune, "input" | "key" | "scale" | "notes" | "detune" | "vibrato">> & { vibrato?: Partial<AutoTuneVibrato> };

export interface AutoTunePreset {
  name: string;
  /** What it's for, in a few words (the menu's second line, and the assistant's list). */
  detail: string;
  sound: AutoTuneSound;
}

/** Everything a preset leaves as it is set back to Auto-Tune's own, so presets don't pile on each other. */
const PLAIN: AutoTuneSound = {
  retuneSpeed: 0,
  humanize: 0,
  flexTune: 0,
  naturalVibrato: 0,
  transpose: 0,
  formant: true,
  throat: 1,
  classic: false,
  ignoreVibrato: false,
  vibrato: { shape: "none" },
};

const preset = (name: string, detail: string, sound: AutoTuneSound): AutoTunePreset => ({ name, detail, sound: { ...PLAIN, ...sound, vibrato: { ...PLAIN.vibrato, ...sound.vibrato } } });

/** The presets: from the hard-tuned sound through natural correction to effects. */
export const AUTO_TUNE_PRESETS: readonly AutoTunePreset[] = [
  preset("Hard Tune", "Retune Speed 0: every note snapped, the modern rap and pop sound", {}),
  preset("Classic Hard Tune", "The Auto-Tune 5 sound: hard, bright, sharp steps between notes", { classic: true }),
  preset("Robot", "Hard tuned, vibrato flattened, targets chosen past it", { naturalVibrato: -12, ignoreVibrato: true }),
  preset("Modern Pop", "Tight but alive: fast retune, sustained notes kept natural", { retuneSpeed: 12, humanize: 0.25 }),
  preset("Natural Vocal", "Transparent correction that keeps the singer's slides", { retuneSpeed: 30, humanize: 0.4, flexTune: 0.2 }),
  preset("Gentle Fix", "Only what's near a note, slowly: barely there", { retuneSpeed: 60, humanize: 0.6, flexTune: 0.45 }),
  preset("Ballad", "Slow, smooth, the vibrato a touch wider", { retuneSpeed: 80, humanize: 0.7, flexTune: 0.3, naturalVibrato: 2 }),
  preset("Vibrato Lead", "Fast tuning with a vibrato of its own after each note's start", {
    retuneSpeed: 8,
    vibrato: { shape: "sine", rate: 5.5, delay: 250, onset: 350, variation: 0.2, pitch: 35, amplitude: 0.08, formant: 0.5 },
  }),
  preset("Octave Up", "An octave higher, the voice's character kept", { retuneSpeed: 10, transpose: 12 }),
  preset("Octave Down", "An octave lower, a little deeper in the throat", { retuneSpeed: 10, transpose: -12, throat: 1.15 }),
  preset("Chipmunk", "Up a fifth, the formants up with it", { transpose: 7, formant: false }),
  preset("Monster", "Down an octave, a long throat", { transpose: -12, throat: 1.6 }),
];

// ---------------------------------------------------------------------------
// Its controls, as automation and the knobs say them
// ---------------------------------------------------------------------------

/** Each automatable control: its name, range (in its own units) and how it reads. */
export const AUTO_TUNE_CONTROL_INFO: Record<AutoTuneControl, { name: string; min: number; max: number; whole?: boolean; format: (v: number) => string }> = {
  retuneSpeed: { name: "Retune Speed", min: 0, max: MAX_RETUNE, format: (v) => `${Math.round(v)} ms` },
  humanize: { name: "Humanize", min: 0, max: 1, format: (v) => `${Math.round(v * 100)}` },
  flexTune: { name: "Flex-Tune", min: 0, max: 1, format: (v) => `${Math.round(v * 100)}` },
  naturalVibrato: { name: "Natural Vibrato", min: -MAX_NATURAL_VIBRATO, max: MAX_NATURAL_VIBRATO, format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB` },
  transpose: { name: "Transpose", min: -MAX_TRANSPOSE, max: MAX_TRANSPOSE, whole: true, format: (v) => `${v > 0 ? "+" : ""}${Math.round(v)} st` },
  throat: { name: "Throat Length", min: MIN_THROAT, max: MAX_THROAT, format: (v) => `${Math.round(v * 100)}` },
  key: { name: "Key", min: 0, max: 11, whole: true, format: (v) => NOTE_NAMES[clamp(Math.round(v), 0, 11)] },
};
