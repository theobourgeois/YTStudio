/**
 * The assistant's Auto-Tune (`shared/music/tools.ts`: get_auto_tune, update_auto_tune): pure
 * `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and what get_auto_tune says.
 * For the model, amounts are Auto-Tune's own 0 to 100 (humanize, flex-tune, tracking, throat...), times are
 * milliseconds, keys note names. Errors say what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import { type AutoTunePatch, applyAutoTunePreset, autoTunes, currentPreset, detectKey, findAutoTune, keyText, notesEdited, setAllNotes, setAutoTuneNote, updateAutoTune } from "@shared/music/auto-tune";
import {
  AUTO_TUNE_PRESETS,
  INPUT_TYPES,
  MAX_DETUNE,
  MAX_NATURAL_VIBRATO,
  MAX_ONSET,
  MAX_RETUNE,
  MAX_TRANSPOSE,
  NOTE_NAMES,
  noteName,
} from "@shared/music/auto-tune-presets";
import { AUTO_TUNE_INPUTS, AUTO_TUNE_SCALES, type AutoTune, type AutoTuneInput, type AutoTuneNote, type AutoTuneScale, type AutoTuneVibrato, type MusicProject, VIBRATO_SHAPES, type VibratoShape } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import type { EditResult } from "../tool-edits";
import type { PitchReading } from "./pitch-history";

type Input = Record<string, unknown>;

/**
 * The Auto-Tune an input names: by `effect` (its id), by `track` (the track's Auto-Tune; with
 * `effectSlot`, the one in that slot), or the song's only one. The error lists the song's.
 */
export function findTune(song: MusicProject, input: Input) {
  const all = autoTunes(song);
  const list = () =>
    all.length ? `The song's YT-Tune instances: ${all.map((t) => `${t.effect.id} (${trackLabel(song, t.track)}, slot ${t.slot + 1})`).join(", ")}.` : 'The song has none: add_mixer_effect with plugin "YT-Tune" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findAutoTune(song, input.effect.trim());
    if (!found) throw new Error(`There's no YT-Tune "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((t) => t.track.id === track.id && (!Number.isInteger(input.effectSlot) || t.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no YT-Tune${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which YT-Tune ("effect" or "track"). ${list()}`);
}

const FLATS: Record<string, string> = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#", CB: "B", FB: "E", "E#": "F", "B#": "C" };

/** A pitch class from a note name ("A", "F#", "Bb", "c#") or a number 0..11. */
export function pitchClassOf(ref: unknown): number {
  if (typeof ref === "number" && Number.isInteger(ref) && ref >= 0 && ref <= 11) return ref;
  const text = typeof ref === "string" ? ref.trim().toUpperCase().replace("♯", "#").replace("♭", "B") : "";
  const name = FLATS[text] ?? text;
  const index = NOTE_NAMES.indexOf(name as (typeof NOTE_NAMES)[number]);
  if (index >= 0) return index;
  throw new Error(`"${String(ref)}" isn't a note: use a name (C, C#, Db, D... B) or 0 (C) to 11 (B).`);
}

const amount = (v: number) => Math.round(v * 100);
const signed = (v: number, unit: string) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}${unit}`;

/** Its notes said by state: "tuned C D E F G A B; bypassed none; removed C# D# F# G# A#". */
function notesText(at: AutoTune): string {
  const by = (state: AutoTuneNote) => at.notes.flatMap((n, pc) => (n === state ? [NOTE_NAMES[pc]] : [])).join(" ") || "none";
  return `tuned ${by("tune")}; bypassed ${by("bypass")}; removed ${by("remove")}`;
}

/** Its settings in a few lines, for the model. */
function settingsText(at: AutoTune): string[] {
  const v = at.vibrato;
  return [
    `Input type ${INPUT_TYPES[at.input].name} (${at.input}). Key ${keyText(at.key, at.scale)}${notesEdited(at) ? " (notes edited)" : ""}: ${notesText(at)}. Detune ${signed(at.detune, " cents")} (A4 = ${(440 * 2 ** (at.detune / 1200)).toFixed(1)} Hz).`,
    `Retune speed ${Math.round(at.retuneSpeed)} ms, humanize ${amount(at.humanize)}, flex-tune ${amount(at.flexTune)}, natural vibrato ${signed(at.naturalVibrato, " dB")}, tracking ${amount(at.tracking)}, transpose ${signed(at.transpose, " st")}.`,
    `Formant ${at.formant ? "on" : "off"}, throat ${amount(at.throat)}, classic mode ${at.classic ? "on" : "off"}, targeting ignores vibrato ${at.ignoreVibrato ? "on" : "off"}.`,
    v.shape === "none"
      ? "Create vibrato: off."
      : `Create vibrato: ${v.shape}, ${v.rate} Hz, onset delay ${Math.round(v.delay)} ms, onset rate ${Math.round(v.onset)} ms, variation ${amount(v.variation)}, pitch ${Math.round(v.pitch)} cents, amplitude ${amount(v.amplitude)}, formant ${amount(v.formant)}.`,
  ];
}

/** What it heard lately (readings oldest first), said as notes and corrections: the last few seconds, a reading a note. */
export function heardText(readings: readonly PitchReading[]): string {
  const voiced = readings.filter((r) => r.sung >= 0 && r.target >= 0);
  if (!voiced.length) return "It hasn't heard a pitch lately (nothing sung through it, or the song isn't playing).";
  // Runs of one target: the notes sung, each with how far off it was on average.
  const runs: { target: number; off: number[] }[] = [];
  for (const r of voiced) {
    const last = runs[runs.length - 1];
    if (last && last.target === r.target) last.off.push(r.sung - r.target);
    else runs.push({ target: r.target, off: [r.sung - r.target] });
  }
  const said = runs.slice(-24).map((run) => {
    const mean = run.off.reduce((a, b) => a + b, 0) / run.off.length;
    return `${noteName(run.target)} (${signed(Math.round(mean * 100), "")} cents)`;
  });
  const all = voiced.map((r) => Math.abs(r.sung - r.target) * 100);
  return `Lately it heard (target, how far the voice was from it on average): ${said.join(", ")}. Average correction ${Math.round(all.reduce((a, b) => a + b, 0) / all.length)} cents.`;
}

/** get_auto_tune: where it is, its settings, presets, the song's key, and what it heard lately. */
export function describeAutoTune(song: MusicProject, input: Input, heard: readonly PitchReading[] = []): string {
  const { track, slot, effect, autoTune: at } = findTune(song, input);
  const detected = detectKey(song);
  return [
    `YT-Tune ${effect.id}, slot ${slot + 1} of ${trackLabel(song, track)}${effect.enabled ? "" : " (bypassed)"}${effect.mix < 1 ? `, slot mix ${amount(effect.mix)}%` : ""}.`,
    ...settingsText(at),
    `Preset: ${currentPreset(at) ?? "none (custom)"}. Presets: ${AUTO_TUNE_PRESETS.map((p) => `${p.name} (${p.detail})`).join("; ")}.`,
    detected ? `The song's notes suggest ${keyText(detected.key, detected.scale)}${detected.fit > 0.75 ? "" : " (not clearly)"}.` : "The song has too few pitched notes to suggest a key.",
    heardText(heard),
  ].join("\n");
}

const NOTE_STATES: readonly AutoTuneNote[] = ["tune", "bypass", "remove"];

/** update_auto_tune: a preset, then the key and scale, the notes, the knobs and options. */
export function updateAutoTuneTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findTune(song, input);
  let next = song;
  if (input.preset !== undefined) {
    const name = String(input.preset).trim().toLowerCase();
    const preset = AUTO_TUNE_PRESETS.find((p) => p.name.toLowerCase() === name);
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${AUTO_TUNE_PRESETS.map((p) => p.name).join(", ")}.`);
    next = applyAutoTunePreset(next, effect.id, preset.name);
  }

  const patch: AutoTunePatch = {};
  if (input.detectKey === true) {
    const found = detectKey(next);
    if (!found) throw new Error('The song has too few pitched notes to tell its key: give "key" and "scale" yourself.');
    patch.key = found.key;
    patch.scale = found.scale;
  }
  if (input.key !== undefined) patch.key = pitchClassOf(input.key);
  if (input.scale !== undefined) {
    if (!AUTO_TUNE_SCALES.includes(input.scale as AutoTuneScale)) throw new Error(`"scale" must be one of: ${AUTO_TUNE_SCALES.join(", ")}.`);
    patch.scale = input.scale as AutoTuneScale;
  }
  if (input.input !== undefined) {
    if (!AUTO_TUNE_INPUTS.includes(input.input as AutoTuneInput)) throw new Error(`"input" must be one of: ${AUTO_TUNE_INPUTS.join(", ")}.`);
    patch.input = input.input as AutoTuneInput;
  }
  const range = (key: string, min: number, max: number, scale = 1): number | undefined => {
    const v = input[key];
    if (v === undefined) return undefined;
    if (!isFiniteNumber(v) || v < min || v > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
    return v * scale;
  };
  patch.detune = range("detune", -MAX_DETUNE, MAX_DETUNE);
  patch.retuneSpeed = range("retuneSpeed", 0, MAX_RETUNE);
  patch.humanize = range("humanize", 0, 100, 1 / 100);
  patch.flexTune = range("flexTune", 0, 100, 1 / 100);
  patch.naturalVibrato = range("naturalVibrato", -MAX_NATURAL_VIBRATO, MAX_NATURAL_VIBRATO);
  patch.tracking = range("tracking", 0, 100, 1 / 100);
  patch.transpose = range("transpose", -MAX_TRANSPOSE, MAX_TRANSPOSE);
  patch.throat = range("throat", 50, 180, 1 / 100);
  for (const key of ["formant", "classic", "ignoreVibrato"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new Error(`"${key}" must be true or false.`);
    patch[key] = input[key] as boolean;
  }
  if (input.vibrato !== undefined) {
    const v = (input.vibrato && typeof input.vibrato === "object" ? input.vibrato : {}) as Input;
    const vibrato: Partial<AutoTuneVibrato> = {};
    if (v.shape !== undefined) {
      if (!VIBRATO_SHAPES.includes(v.shape as VibratoShape)) throw new Error(`"vibrato.shape" must be one of: ${VIBRATO_SHAPES.join(", ")}.`);
      vibrato.shape = v.shape as VibratoShape;
    }
    const field = (key: string, min: number, max: number, scale = 1) => {
      const x = v[key];
      if (x === undefined) return undefined;
      if (!isFiniteNumber(x) || x < min || x > max) throw new Error(`"vibrato.${key}" must be a number from ${min} to ${max}.`);
      return x * scale;
    };
    vibrato.rate = field("rate", 0.1, 10);
    vibrato.delay = field("delay", 0, MAX_ONSET);
    vibrato.onset = field("onset", 0, MAX_ONSET);
    vibrato.variation = field("variation", 0, 100, 1 / 100);
    vibrato.pitch = field("pitch", 0, 100);
    vibrato.amplitude = field("amplitude", 0, 30, 1 / 100);
    vibrato.formant = field("formant", 0, 100, 1 / 100);
    patch.vibrato = Object.fromEntries(Object.entries(vibrato).filter(([, x]) => x !== undefined));
  }
  const defined = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)) as AutoTunePatch;
  next = updateAutoTune(next, effect.id, defined);

  // The notes, after the key and scale (which reset them).
  if (input.notes !== undefined) {
    if (!input.notes || typeof input.notes !== "object" || Array.isArray(input.notes)) throw new Error('"notes" must be an object of note names and states: { "C#": "remove", "E": "bypass" }.');
    for (const [name, state] of Object.entries(input.notes as Input)) {
      if (!NOTE_STATES.includes(state as AutoTuneNote)) throw new Error(`Note "${name}": its state must be one of: ${NOTE_STATES.join(", ")}.`);
      if (name.toLowerCase() === "all") next = setAllNotes(next, effect.id, state as AutoTuneNote);
      else next = setAutoTuneNote(next, effect.id, pitchClassOf(name), state as AutoTuneNote);
    }
  }
  const asked = input.preset !== undefined || input.detectKey === true || input.notes !== undefined || Object.keys(defined).length > 0;
  if (!asked) throw new Error("Nothing to change: give a preset, a key or scale, notes, or a setting.");
  const now = findAutoTune(next, effect.id)!.autoTune;
  return {
    song: next,
    text: [`YT-Tune ${effect.id}${next === song ? " (already so)" : ""}:`, ...settingsText(now), `Preset: ${currentPreset(now) ?? "custom"}.`].join(" "),
  };
}
