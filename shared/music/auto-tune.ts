/**
 * Auto-Tune (`docs/antares/auto-tune.md`): finding the song's Auto-Tunes, their edits (any setting, a
 * scale's notes, presets), the song's key heard from its notes (Detect key), and the settings the engine
 * plays (`engineAutoTune`): what Tracking, Natural Vibrato and the Input Type mean is decided here, not in
 * C++. Pure and tested.
 */
import { clamp } from "../math.ts";
import { findEffect } from "./automation.ts";
import {
  AUTO_TUNE_PRESETS,
  INPUT_TYPES,
  MAX_DETUNE,
  MAX_NATURAL_VIBRATO,
  MAX_ONSET,
  MAX_RETUNE,
  MAX_THROAT,
  MAX_TRANSPOSE,
  MAX_VIBRATO_AMPLITUDE,
  MIN_THROAT,
  NOTE_NAMES,
  SCALES,
  scaleNotes,
} from "./auto-tune-presets.ts";
import {
  AUTO_TUNE_INPUTS,
  AUTO_TUNE_SCALES,
  type AutoTune,
  type AutoTuneControl,
  type AutoTuneNote,
  type AutoTuneScale,
  type AutoTuneVibrato,
  type MusicProject,
  VIBRATO_SHAPES,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Finding them
// ---------------------------------------------------------------------------

/** An Auto-Tune of the song, by its effect's id: its track, slot and settings. */
export function findAutoTune(song: MusicProject, effectId: string) {
  const found = findEffect(song, effectId);
  if (!found?.effect?.autoTune) return null;
  return { track: found.track, slot: found.track.effects.indexOf(found.effect), effect: found.effect, autoTune: found.effect.autoTune };
}

/** The song's Auto-Tunes, each with its track. */
export function autoTunes(song: MusicProject) {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.autoTune ? [{ track, slot, effect, autoTune: effect.autoTune }] : [])));
}

/** Change an Auto-Tune's settings (`change` returning the same settings: the same song). */
export function editAutoTune(song: MusicProject, effectId: string, change: (at: AutoTune) => AutoTune): MusicProject {
  const found = findAutoTune(song, effectId);
  if (!found) return song;
  const next = change(found.autoTune);
  if (next === found.autoTune) return song;
  const effects = found.track.effects.map((e) => (e === found.effect ? { ...e, autoTune: next } : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export type AutoTunePatch = Partial<Omit<AutoTune, "vibrato">> & { vibrato?: Partial<AutoTuneVibrato> };

const sameNotes = (a: readonly AutoTuneNote[], b: readonly AutoTuneNote[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Change an Auto-Tune's settings. A new key or scale makes its notes the scale's again (edits to the
 * notes are lost, as in Auto-Tune), unless the patch gives notes too. Out-of-range values are clamped;
 * unknown names are ignored.
 */
export function updateAutoTune(song: MusicProject, effectId: string, patch: AutoTunePatch): MusicProject {
  return editAutoTune(song, effectId, (at) => {
    const num = (v: number | undefined, was: number, min: number, max: number) => (v !== undefined && Number.isFinite(v) ? clamp(v, min, max) : was);
    const key = patch.key !== undefined && Number.isInteger(patch.key) ? ((patch.key % 12) + 12) % 12 : at.key;
    const scale = patch.scale && AUTO_TUNE_SCALES.includes(patch.scale) ? patch.scale : at.scale;
    let notes = at.notes;
    if (patch.notes && patch.notes.length === 12) notes = patch.notes.slice();
    else if (key !== at.key || scale !== at.scale) notes = scaleNotes(key, scale);
    const v = patch.vibrato ?? {};
    const vibrato: AutoTuneVibrato = {
      shape: v.shape && VIBRATO_SHAPES.includes(v.shape) ? v.shape : at.vibrato.shape,
      rate: num(v.rate, at.vibrato.rate, 0.1, 10),
      delay: num(v.delay, at.vibrato.delay, 0, MAX_ONSET),
      onset: num(v.onset, at.vibrato.onset, 0, MAX_ONSET),
      variation: num(v.variation, at.vibrato.variation, 0, 1),
      pitch: num(v.pitch, at.vibrato.pitch, 0, 100),
      amplitude: num(v.amplitude, at.vibrato.amplitude, 0, MAX_VIBRATO_AMPLITUDE),
      formant: num(v.formant, at.vibrato.formant, 0, 1),
    };
    const sameVibrato = (Object.keys(vibrato) as (keyof AutoTuneVibrato)[]).every((k) => vibrato[k] === at.vibrato[k]);
    const next: AutoTune = {
      input: patch.input && AUTO_TUNE_INPUTS.includes(patch.input) ? patch.input : at.input,
      key,
      scale,
      notes: sameNotes(notes, at.notes) ? at.notes : notes,
      detune: num(patch.detune, at.detune, -MAX_DETUNE, MAX_DETUNE),
      retuneSpeed: num(patch.retuneSpeed, at.retuneSpeed, 0, MAX_RETUNE),
      humanize: num(patch.humanize, at.humanize, 0, 1),
      flexTune: num(patch.flexTune, at.flexTune, 0, 1),
      naturalVibrato: num(patch.naturalVibrato, at.naturalVibrato, -MAX_NATURAL_VIBRATO, MAX_NATURAL_VIBRATO),
      tracking: num(patch.tracking, at.tracking, 0, 1),
      transpose: Math.round(num(patch.transpose, at.transpose, -MAX_TRANSPOSE, MAX_TRANSPOSE)),
      formant: patch.formant ?? at.formant,
      throat: num(patch.throat, at.throat, MIN_THROAT, MAX_THROAT),
      classic: patch.classic ?? at.classic,
      ignoreVibrato: patch.ignoreVibrato ?? at.ignoreVibrato,
      vibrato: sameVibrato ? at.vibrato : vibrato,
    };
    return (Object.keys(next) as (keyof AutoTune)[]).every((k) => next[k] === at[k]) ? at : next;
  });
}

/** One note of the scale (a pitch class, C is 0) tuned to, bypassed or removed: the keyboard's and Edit Scale's. */
export function setAutoTuneNote(song: MusicProject, effectId: string, pitchClass: number, note: AutoTuneNote): MusicProject {
  if (!Number.isInteger(pitchClass) || pitchClass < 0 || pitchClass > 11) return song;
  return editAutoTune(song, effectId, (at) => {
    if (at.notes[pitchClass] === note) return at;
    const notes = at.notes.slice();
    notes[pitchClass] = note;
    // Every note removed would leave nothing to tune to: one stays.
    if (notes.every((n) => n === "remove")) return at;
    return { ...at, notes };
  });
}

/** Set All (every note tuned to), Bypass All, Remove All (but the key's own note, so something's left). */
export function setAllNotes(song: MusicProject, effectId: string, note: AutoTuneNote): MusicProject {
  return editAutoTune(song, effectId, (at) => {
    const notes = Array.from({ length: 12 }, (_, pc): AutoTuneNote => (note === "remove" && pc === at.key ? "tune" : note));
    return sameNotes(notes, at.notes) ? at : { ...at, notes };
  });
}

/** Whether its notes are its scale's as it comes (no note edited). */
export const notesEdited = (at: AutoTune) => !sameNotes(at.notes, scaleNotes(at.key, at.scale));

/** A preset's sound, put on an Auto-Tune (its key, scale and voice stay). */
export function applyAutoTunePreset(song: MusicProject, effectId: string, name: string): MusicProject {
  const preset = AUTO_TUNE_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  if (!preset) return song;
  return editAutoTune(song, effectId, (at) => {
    const { vibrato, ...sound } = preset.sound;
    const next = { ...at, ...sound, vibrato: { ...at.vibrato, ...vibrato } };
    return (Object.keys(next) as (keyof AutoTune)[]).every((k) => k === "vibrato" ? (Object.keys(next.vibrato) as (keyof AutoTuneVibrato)[]).every((v) => next.vibrato[v] === at.vibrato[v]) : next[k] === at[k]) ? at : next;
  });
}

/** The preset its sound is, if it's one's exactly. */
export function currentPreset(at: AutoTune): string | null {
  for (const preset of AUTO_TUNE_PRESETS) {
    const { vibrato = {}, ...sound } = preset.sound;
    const same = (Object.keys(sound) as (keyof typeof sound)[]).every((k) => at[k] === sound[k]) && (Object.keys(vibrato) as (keyof AutoTuneVibrato)[]).every((k) => at.vibrato[k] === vibrato[k]);
    if (same) return preset.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The song's key, heard from its notes (Detect key)
// ---------------------------------------------------------------------------

/** Krumhansl and Kessler's key profiles: how much each degree of a major and a minor key is heard. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface DetectedKey {
  key: number;
  scale: "major" | "minor";
  /** -1..1: how well the notes fit it (above 0.7, clearly). */
  fit: number;
}

/**
 * The song's key from its pitched notes (each weighted by its length and by how often its pattern is on
 * the Playlist), Krumhansl-Schmuckler's way. Drum channels (whose notes sit on one or two pitches) are left
 * out. Null when there isn't enough to tell.
 */
export function detectKey(song: MusicProject): DetectedKey | null {
  const uses = new Map<string, number>();
  for (const clip of song.playlist.clips) if (clip.kind === "pattern" && !clip.muted) uses.set(clip.ref, (uses.get(clip.ref) ?? 0) + 1);
  // A channel is pitched if it plays three pitch classes or more.
  const classes = new Map<string, Set<number>>();
  for (const pattern of song.patterns)
    for (const [channel, notes] of Object.entries(pattern.notes)) {
      const set = classes.get(channel) ?? new Set<number>();
      for (const note of notes) if (!note.muted) set.add(((Math.round(note.pitch) % 12) + 12) % 12);
      classes.set(channel, set);
    }
  const histogram = Array.from({ length: 12 }, () => 0);
  let total = 0;
  for (const pattern of song.patterns) {
    const weight = Math.max(1, uses.get(pattern.id) ?? 0);
    for (const [channel, notes] of Object.entries(pattern.notes)) {
      if ((classes.get(channel)?.size ?? 0) < 3) continue;
      for (const note of notes) {
        if (note.muted) continue;
        const amount = note.length * weight * (0.5 + 0.5 * note.velocity);
        histogram[((Math.round(note.pitch) % 12) + 12) % 12] += amount;
        total += amount;
      }
    }
  }
  if (total <= 0 || histogram.filter((h) => h > 0).length < 3) return null;
  let best: DetectedKey | null = null;
  for (let key = 0; key < 12; key++)
    for (const [scale, profile] of [
      ["major", MAJOR_PROFILE],
      ["minor", MINOR_PROFILE],
    ] as const) {
      const rotated = Array.from({ length: 12 }, (_, pc) => profile[(pc - key + 12) % 12]);
      const fit = correlation(histogram, rotated);
      if (!best || fit > best.fit) best = { key, scale, fit };
    }
  return best && best.fit > 0.5 ? best : null;
}

/** "A Minor", "F# Major", "C Chromatic". */
export const keyText = (key: number, scale: AutoTuneScale) => `${NOTE_NAMES[((key % 12) + 12) % 12]} ${SCALES[scale].name}`;

// ---------------------------------------------------------------------------
// The engine's
// ---------------------------------------------------------------------------

/** An Auto-Tune as the engine plays it (`engine/src/AutoTune.cpp`), in its units. */
export interface EngineAutoTune {
  /** The pitches it listens for, Hz (the Input Type's). */
  minHz: number;
  maxHz: number;
  /** YIN's threshold (Tracking): 0.07 Choosy .. 0.35 Relaxed. */
  threshold: number;
  /** By pitch class (C first): 0 tuned to, 1 bypassed, 2 removed. */
  notes: number[];
  key: number;
  /** A4 in Hz (Detune). */
  reference: number;
  /** Seconds. */
  retune: number;
  humanize: number;
  flexTune: number;
  /** The sung vibrato's gain (Natural Vibrato's dB). */
  vibratoGain: number;
  transpose: number;
  formant: boolean;
  throat: number;
  classic: boolean;
  ignoreVibrato: boolean;
  vibrato: { shape: string; rate: number; delay: number; onset: number; variation: number; depth: number; amplitude: number; formant: number };
}

const NOTE_CODES: Record<AutoTuneNote, number> = { tune: 0, bypass: 1, remove: 2 };

/** Tracking (0 Choosy .. 1 Relaxed) as YIN's threshold. */
export const trackingThreshold = (tracking: number) => 0.07 + clamp(tracking, 0, 1) * 0.28;
/** Detune's cents as A4's frequency. */
export const referenceHz = (detune: number) => 440 * 2 ** (clamp(detune, -MAX_DETUNE, MAX_DETUNE) / 1200);
/** Natural Vibrato's dB as a gain on the sung vibrato. */
export const vibratoGain = (db: number) => 10 ** (clamp(db, -MAX_NATURAL_VIBRATO, MAX_NATURAL_VIBRATO) / 20);
/** A control's value (its own units) as the engine's lane takes it. */
export function engineControlValue(control: AutoTuneControl, value: number): number {
  switch (control) {
    case "retuneSpeed":
      return clamp(value, 0, MAX_RETUNE) / 1000;
    case "naturalVibrato":
      return vibratoGain(value);
    case "transpose":
    case "key":
      return Math.round(value);
    default:
      return value;
  }
}

export function engineAutoTune(at: AutoTune): EngineAutoTune {
  const range = INPUT_TYPES[at.input];
  return {
    minHz: range.minHz,
    maxHz: range.maxHz,
    threshold: trackingThreshold(at.tracking),
    notes: at.notes.map((n) => NOTE_CODES[n]),
    key: at.key,
    reference: referenceHz(at.detune),
    retune: at.retuneSpeed / 1000,
    humanize: at.humanize,
    flexTune: at.flexTune,
    vibratoGain: vibratoGain(at.naturalVibrato),
    transpose: at.transpose,
    formant: at.formant,
    throat: at.throat,
    classic: at.classic,
    ignoreVibrato: at.ignoreVibrato,
    vibrato: {
      shape: at.vibrato.shape,
      rate: at.vibrato.rate,
      delay: at.vibrato.delay / 1000,
      onset: at.vibrato.onset / 1000,
      variation: at.vibrato.variation,
      depth: at.vibrato.pitch / 100,
      amplitude: at.vibrato.amplitude,
      formant: at.vibrato.formant,
    },
  };
}
