/**
 * Pitch Wheel (`docs/quikquak/pitchwheel.md`): finding the song's Pitch Wheels, their edits (either wheel,
 * the Timbre tab, notes, presets), how a wheel's actual pitch follows its pointer (`stepWheel`: the
 * physics, which the engine runs every sample and the window when the engine is silent), and the settings
 * the engine plays (`enginePitchWheel`). Pure and tested.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import { MAX_SWING, PITCH_WHEEL_PRESETS, controlField, halfRange } from "./pitch-wheel-presets.ts";
import {
  type MusicProject,
  type PitchWheel,
  type PitchWheelControl,
  WHEEL_MIDI_MODES,
  WHEEL_RANGES,
  WHEEL_RESOLUTIONS,
  WHEEL_SNAPS,
  type Wheel,
  type WheelSnap,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Finding them
// ---------------------------------------------------------------------------

/** A Pitch Wheel of the song, by its effect's id: its track, slot and settings. */
export function findPitchWheel(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.pitchWheel) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, pitchWheel: found.effect.pitchWheel };
}

/** The song's Pitch Wheels, each with its track. */
export function pitchWheels(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.pitchWheel ? [{ track, slot, effect, pitchWheel: effect.pitchWheel }] : [])));
}

/** Change a Pitch Wheel's settings (`change` returning the same settings: the same song). */
export function editPitchWheel(song: MusicProject, effectId: string, change: (pw: PitchWheel) => PitchWheel): MusicProject {
  const found = findPitchWheel(song, effectId);
  if (!found) return song;
  const next = change(found.pitchWheel);
  if (next === found.pitchWheel) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, pitchWheel: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export type PitchWheelPatch = Partial<Omit<PitchWheel, "pitch" | "timbre">> & { pitch?: Partial<Wheel>; timbre?: Partial<Wheel> };

const sameWheel = (a: Wheel, b: Wheel) => (Object.keys(a) as (keyof Wheel)[]).every((k) => a[k] === b[k]);

/** A wheel with a patch on it: out-of-range values clamped, unknown ones ignored; a narrower range brings the pointer in. */
function patchWheel(was: Wheel, patch: Partial<Wheel> | undefined): Wheel {
  if (!patch) return was;
  const num = (v: number | undefined, old: number, min: number, max: number) => clamp(v !== undefined && Number.isFinite(v) ? v : old, min, max);
  const range = patch.range !== undefined && WHEEL_RANGES.includes(patch.range) ? patch.range : was.range;
  const next: Wheel = {
    value: num(patch.value, was.value, -halfRange(range), halfRange(range)),
    range,
    snap: patch.snap && WHEEL_SNAPS.includes(patch.snap) ? patch.snap : was.snap,
    gravity: num(patch.gravity, was.gravity, 0, 1),
    inertia: num(patch.inertia, was.inertia, 0, 1),
    smooth: num(patch.smooth, was.smooth, 0, 1),
  };
  return sameWheel(next, was) ? was : next;
}

/** Change a Pitch Wheel's settings. Out-of-range values are clamped; unknown names are ignored. */
export function updatePitchWheel(song: MusicProject, effectId: string, patch: PitchWheelPatch): MusicProject {
  return editPitchWheel(song, effectId, (pw) => {
    const next: PitchWheel = {
      pitch: patchWheel(pw.pitch, patch.pitch),
      timbre: patchWheel(pw.timbre, patch.timbre),
      timbreOn: patch.timbreOn ?? pw.timbreOn,
      midiMode: patch.midiMode && WHEEL_MIDI_MODES.includes(patch.midiMode) ? patch.midiMode : pw.midiMode,
      notesFrom: patch.notesFrom === undefined ? pw.notesFrom : patch.notesFrom || null,
      origin: patch.origin !== undefined && Number.isFinite(patch.origin) ? Math.round(clamp(patch.origin, 0, 127)) : pw.origin,
      resolution: patch.resolution && WHEEL_RESOLUTIONS.includes(patch.resolution) ? patch.resolution : pw.resolution,
    };
    return (Object.keys(next) as (keyof PitchWheel)[]).every((k) => next[k] === pw[k]) ? pw : next;
  });
}

/** A preset's sound, put on a Pitch Wheel (where its notes come from, its origin, mode and resolution stay). */
export function applyPitchWheelPreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = PITCH_WHEEL_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!preset) return song;
  return updatePitchWheel(song, effectId, preset.sound);
}

/** The preset its sound is, if it's one's exactly. */
export function currentPreset(pw: PitchWheel): string | null {
  for (const preset of PITCH_WHEEL_PRESETS) {
    const { pitch, timbre, timbreOn } = preset.sound;
    const same = (wheel: Wheel, want: Partial<Wheel>) => (Object.keys(want) as (keyof Wheel)[]).every((k) => wheel[k] === want[k]);
    if (pw.timbreOn === timbreOn && same(pw.pitch, pitch) && same(pw.timbre, timbre)) return preset.name;
  }
  return null;
}

/** A control's value as the song has it (unautomated). */
export function controlValue(pw: PitchWheel, control: PitchWheelControl): number {
  const { wheel, field } = controlField(control);
  return pw[wheel][field];
}

/** The song with one control at a value (a knob turned, the assistant's). */
export function setControl(song: MusicProject, effectId: string, control: PitchWheelControl, value: number): MusicProject {
  const { wheel, field } = controlField(control);
  return updatePitchWheel(song, effectId, { [wheel]: { [field]: value } });
}

// ---------------------------------------------------------------------------
// How the actual pitch follows the pointer
// ---------------------------------------------------------------------------

/** Where a pointer lands, snapped. */
export function snapped(value: number, snap: WheelSnap): number {
  if (snap === "semitone") return Math.round(value);
  if (snap === "octave") return Math.round(value / 12) * 12;
  return value;
}

/**
 * A wheel's physics, from its knobs (ours: the guide only describes them). Smooth is a one-pole
 * follower of the target, `tau` seconds (0 .. 1.5 s). The actual pitch is a mass on a spring towards
 * what that follower says: Inertia sets its natural frequency (30 Hz at 0 down to 0.25 Hz at 1),
 * Gravity its damping (ζ from 0.02, which swings for seconds, to critical) and its stiffness (up to 41
 * times: high gravity overrides inertia, as QuikQuak's does); at 1 it's clamped outright.
 *
 * Mirrored in `engine/src/PitchWheel.cpp` (`Physics`): change both.
 */
export interface WheelPhysics {
  tau: number;
  /** Radians a second. */
  omega: number;
  zeta: number;
  clamped: boolean;
}

export function wheelPhysics(w: Pick<Wheel, "gravity" | "inertia" | "smooth">): WheelPhysics {
  const gravity = clamp(w.gravity, 0, 1);
  const inertia = clamp(w.inertia, 0, 1);
  const smooth = clamp(w.smooth, 0, 1);
  const natural = 30 * (0.25 / 30) ** inertia;
  return {
    tau: 1.5 * smooth * smooth,
    omega: 2 * Math.PI * natural * (1 + 40 * gravity ** 4),
    zeta: Math.min(1, 0.02 + 1.5 * gravity * gravity),
    clamped: gravity >= 0.999,
  };
}

/** Where a wheel is: what the hand's pointer has been smoothed to, the actual pitch (what's heard) and how fast it moves (semitones a second). */
export interface WheelMotion {
  target: number;
  actual: number;
  velocity: number;
}

export const restingAt = (value: number): WheelMotion => ({ target: value, actual: value, velocity: 0 });

/**
 * The wheel `dt` seconds on, its pointer at `goal` meanwhile. The spring is solved exactly over the step
 * (any `dt` is stable: the window steps a frame at a time, the engine a sample). The actual pitch stops at
 * ±`MAX_SWING`.
 */
export function stepWheel(m: WheelMotion, goal: number, physics: WheelPhysics, dt: number): WheelMotion {
  if (!(dt > 0)) return m;
  const target = physics.tau > 0 ? m.target + (goal - m.target) * (1 - Math.exp(-dt / physics.tau)) : goal;
  if (physics.clamped) return { target, actual: clamp(target, -MAX_SWING, MAX_SWING), velocity: 0 };
  const { omega: w, zeta: z } = physics;
  const e = m.actual - target;
  const v = m.velocity;
  let e1: number;
  let v1: number;
  const decay = Math.exp(-z * w * dt);
  if (z >= 0.9999) {
    e1 = decay * (e * (1 + w * dt) + v * dt);
    v1 = decay * (-e * w * w * dt + v * (1 - w * dt));
  } else {
    const wd = w * Math.sqrt(1 - z * z);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    e1 = decay * (e * (c + ((z * w) / wd) * s) + v * (s / wd));
    v1 = decay * (-e * ((w * w) / wd) * s + v * (c - ((z * w) / wd) * s));
  }
  const actual = target + e1;
  if (Math.abs(actual) > MAX_SWING) return { target, actual: Math.sign(actual) * MAX_SWING, velocity: 0 };
  return { target, actual, velocity: v1 };
}

// ---------------------------------------------------------------------------
// The engine's
// ---------------------------------------------------------------------------

/** A wheel as the engine has it: where its pointer lands (snapped, semitones) and its knobs (0..1: the engine works out `wheelPhysics` the same way). */
export interface EngineWheel {
  target: number;
  gravity: number;
  inertia: number;
  smooth: number;
}

/** A Pitch Wheel as the engine plays it (`engine/src/PitchWheel.cpp`). */
export interface EnginePitchWheel {
  pitch: EngineWheel;
  /** The formants' own shift; ignored unless `timbreOn`. */
  timbre: EngineWheel;
  timbreOn: boolean;
  /** Multi: a voice per note, silent without; else one voice, always heard, the latest note setting its offset. */
  multi: boolean;
  /** The channel whose notes play it (by id; the engine finds it in the song), or null. */
  notesFrom: string | null;
  origin: number;
  /** The analysis window at 48 kHz (2048 or 4096 samples; the engine scales it with the rate). */
  window: number;
}

const engineWheel = (w: Wheel): EngineWheel => ({ target: snapped(w.value, w.snap), gravity: w.gravity, inertia: w.inertia, smooth: w.smooth });

export function enginePitchWheel(pw: PitchWheel): EnginePitchWheel {
  return {
    pitch: engineWheel(pw.pitch),
    timbre: engineWheel(pw.timbre),
    timbreOn: pw.timbreOn,
    multi: pw.midiMode === "multi",
    notesFrom: pw.notesFrom,
    origin: pw.origin,
    window: pw.resolution === "wide" ? 4096 : 2048,
  };
}

/** A control's value (its own units) as the engine's lane takes it: a wheel's snapped as its pointer would be. */
export function engineControlValue(pw: PitchWheel, control: PitchWheelControl, value: number): number {
  if (control === "pitch") return snapped(value, pw.pitch.snap);
  if (control === "timbre") return snapped(value, pw.timbre.snap);
  return clamp(value, 0, 1);
}
