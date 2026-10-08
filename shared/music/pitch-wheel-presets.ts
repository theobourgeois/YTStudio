/**
 * Pitch Wheel's constants, defaults and presets (`docs/quikquak/pitchwheel.md`): what a new one is,
 * validating its settings, the presets the window and the assistant start from, and its controls'
 * ranges for automation.
 *
 * Only types and constants are imported, so `project.ts` can use this to normalise a song.
 */
import { clamp, isFiniteNumber } from "../math.ts";
import {
  type PitchWheel,
  type PitchWheelControl,
  type PluginRef,
  WHEEL_MIDI_MODES,
  WHEEL_RANGES,
  WHEEL_RESOLUTIONS,
  WHEEL_SNAPS,
  type Wheel,
  type WheelMidiMode,
  type WheelRange,
  type WheelResolution,
  type WheelSnap,
} from "./types.ts";

/** What a Pitch Wheel effect is, as a slot's plugin: one of ours, run by the engine itself. */
export const PITCH_WHEEL_PLUGIN: PluginRef = { id: "vaudio:pitch-wheel", name: "YT-Pitch", format: "YTStudio" };
export const isPitchWheel = (plugin: Pick<PluginRef, "id">) => plugin.id === PITCH_WHEEL_PLUGIN.id;

/** How far the actual pitch (or timbre) can go, either way, however it's swung: four octaves. */
export const MAX_SWING = 48;
/** The most notes Multi plays at once (QuikQuak's eight). */
export const MAX_WHEEL_VOICES = 8;
/** The note that shifts nothing, as a new one has it: 60, FL's C5. */
export const DEFAULT_ORIGIN = 60;

/** Half a wheel's range: how far its pointer goes either way. */
export const halfRange = (range: WheelRange) => range / 2;

/** A new Pitch Wheel's pitch wheel: centred, 24 semitones across, snapped, held firmly (about QuikQuak's load-up knobs). */
export const DEFAULT_PITCH: Wheel = { value: 0, range: 24, snap: "semitone", gravity: 0.75, inertia: 0.45, smooth: 0.1 };
/** Its Timbre wheel: 12 across, snapped (as in Théo's screenshot). */
export const DEFAULT_TIMBRE: Wheel = { value: 0, range: 12, snap: "semitone", gravity: 0.75, inertia: 0.45, smooth: 0.1 };

/**
 * A new Pitch Wheel: nothing shifted, the Timbre tab open (so turning Pitch keeps a voice's character, as
 * in Théo's screenshot), Single (the sound always heard), C5 the origin, Wide (chords and low notes stay
 * clean: notes 45 Hz apart are told apart; its 85 ms are compensated; Tight is for playing it live).
 */
export const DEFAULT_PITCH_WHEEL: PitchWheel = {
  pitch: DEFAULT_PITCH,
  timbre: DEFAULT_TIMBRE,
  timbreOn: true,
  midiMode: "single",
  notesFrom: null,
  origin: DEFAULT_ORIGIN,
  resolution: "wide",
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);

function normalizeWheel(input: unknown, d: Wheel): Wheel {
  if (!isObject(input)) return d;
  const range = WHEEL_RANGES.includes(input.range as WheelRange) ? (input.range as WheelRange) : d.range;
  // (Snap was On / Off in QuikQuak's: a boolean reads as that.)
  const snap = WHEEL_SNAPS.includes(input.snap as WheelSnap) ? (input.snap as WheelSnap) : typeof input.snap === "boolean" ? (input.snap ? "semitone" : "off") : d.snap;
  return {
    value: number(input.value, -halfRange(range), halfRange(range), d.value),
    range,
    snap,
    gravity: number(input.gravity, 0, 1, d.gravity),
    inertia: number(input.inertia, 0, 1, d.inertia),
    smooth: number(input.smooth, 0, 1, d.smooth),
  };
}

/** Pitch Wheel's settings: anything missing or wrong is its default. */
export function normalizePitchWheel(input: unknown): PitchWheel {
  if (!isObject(input)) return DEFAULT_PITCH_WHEEL;
  const d = DEFAULT_PITCH_WHEEL;
  return {
    pitch: normalizeWheel(input.pitch, d.pitch),
    timbre: normalizeWheel(input.timbre, d.timbre),
    timbreOn: typeof input.timbreOn === "boolean" ? input.timbreOn : d.timbreOn,
    midiMode: WHEEL_MIDI_MODES.includes(input.midiMode as WheelMidiMode) ? (input.midiMode as WheelMidiMode) : d.midiMode,
    notesFrom: typeof input.notesFrom === "string" && input.notesFrom ? input.notesFrom : null,
    origin: Math.round(number(input.origin, 0, 127, d.origin)),
    resolution: WHEEL_RESOLUTIONS.includes(input.resolution as WheelResolution) ? (input.resolution as WheelResolution) : d.resolution,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * What a preset sets: the wheels and how they move, and the Timbre tab; never where notes come from, the
 * origin, Single / Multi or the resolution (those are the song's).
 */
export interface PitchWheelSound {
  pitch: Partial<Wheel>;
  timbre: Partial<Wheel>;
  timbreOn: boolean;
}

export interface PitchWheelPreset {
  name: string;
  /** What it's for, in a few words (the menu's second line, and the assistant's list). */
  detail: string;
  sound: PitchWheelSound;
}

const preset = (name: string, detail: string, pitch: Partial<Wheel>, timbre: Partial<Wheel> = {}, timbreOn = true): PitchWheelPreset => ({
  name,
  detail,
  // Everything a preset doesn't say is a new one's, so presets don't pile on each other.
  sound: { pitch: { ...DEFAULT_PITCH, ...pitch }, timbre: { ...DEFAULT_TIMBRE, ...timbre }, timbreOn },
});

/** The presets: clean intervals, characters, then the ways it can move. */
export const PITCH_WHEEL_PRESETS: readonly PitchWheelPreset[] = [
  preset("Natural", "Nothing shifted, the knobs as they come: a fresh start", {}),
  preset("Octave Up", "An octave higher, the voice's character kept", { value: 12 }),
  preset("Octave Down", "An octave lower, the voice's character kept", { value: -12 }),
  preset("Fifth Up", "Up a fifth, formants kept: a harmony to blend in", { value: 7 }),
  preset("Fourth Down", "Down a fourth, formants kept: a low harmony", { value: -5 }),
  preset("Chipmunk", "Up a fifth with the formants: the tape sped up", { value: 7 }, {}, false),
  preset("Helium", "The same notes, the formants up: a small, bright voice", {}, { value: 4 }),
  preset("Giant", "Down a fourth, the formants lower still: a big, dark voice", { value: -5 }, { value: -3 }),
  preset("Monster", "Down an octave with the formants: the tape slowed down", { value: -12 }, {}, false),
  preset("Slow Tape", "A quarter-tone flat, as a tape running slow", { value: -0.35, snap: "off" }, {}, false),
  preset("Turntable", "Nothing snapped, a little weight: play it like a record", { snap: "off", gravity: 0.55, inertia: 0.55, smooth: 0.05 }, {}, false),
  preset("Springy", "Every move overshoots and settles: springy vibrato", { snap: "off", gravity: 0.25, inertia: 0.35, smooth: 0 }),
  preset("Wild Swing", "No gravity: swing it and the pitch flies past and back for octaves", { snap: "off", gravity: 0, inertia: 0.5, smooth: 0 }),
  preset("Slow Glide", "Notes and moves glide in, as a portamento", { gravity: 0.9, inertia: 0.3, smooth: 0.6 }),
];

// ---------------------------------------------------------------------------
// Its controls, as automation and the knobs say them
// ---------------------------------------------------------------------------

const signed = (v: number, digits: number) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const amount = (v: number) => `${Math.round(v * 100)}`;

/** Each automatable control: its name, range (in its own units) and how it reads. The wheels' ranges are the widest (their dial's own is narrower). */
export const PITCH_WHEEL_CONTROL_INFO: Record<PitchWheelControl, { name: string; min: number; max: number; format: (v: number) => string }> = {
  pitch: { name: "Pitch", min: -24, max: 24, format: (v) => `${signed(v, 2)} st` },
  timbre: { name: "Timbre", min: -24, max: 24, format: (v) => `${signed(v, 2)} st` },
  pitchGravity: { name: "Pitch gravity", min: 0, max: 1, format: amount },
  pitchInertia: { name: "Pitch inertia", min: 0, max: 1, format: amount },
  pitchSmooth: { name: "Pitch smooth", min: 0, max: 1, format: amount },
  timbreGravity: { name: "Timbre gravity", min: 0, max: 1, format: amount },
  timbreInertia: { name: "Timbre inertia", min: 0, max: 1, format: amount },
  timbreSmooth: { name: "Timbre smooth", min: 0, max: 1, format: amount },
};

/** Which wheel a control is on, and which of its settings. */
export function controlField(control: PitchWheelControl): { wheel: "pitch" | "timbre"; field: "value" | "gravity" | "inertia" | "smooth" } {
  if (control === "pitch" || control === "timbre") return { wheel: control, field: "value" };
  const wheel = control.startsWith("pitch") ? "pitch" : "timbre";
  return { wheel, field: control.slice(wheel.length).toLowerCase() as "gravity" | "inertia" | "smooth" };
}
