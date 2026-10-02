/**
 * The assistant's Pitch Wheel (`shared/music/tools.ts`: get_pitch_wheel, update_pitch_wheel): pure
 * `(song, input) => { song, text }` edits like the rest of `tool-edits.ts`, and what get_pitch_wheel says.
 * For the model, wheels are semitones, knobs 0 to 1, notes FL's names ("C5" is MIDI 60). Errors say
 * what's wrong and what would work.
 */
import { isFiniteNumber } from "@shared/math";
import type { EnginePitchWheelState } from "@shared/music/engine";
import { type PitchWheelPatch, applyPitchWheelPreset, currentPreset, findPitchWheel, pitchWheels, snapped, updatePitchWheel } from "@shared/music/pitch-wheel";
import { PITCH_WHEEL_PRESETS, halfRange } from "@shared/music/pitch-wheel-presets";
import { type MusicProject, type PitchWheel, WHEEL_MIDI_MODES, WHEEL_RANGES, WHEEL_RESOLUTIONS, WHEEL_SNAPS, type Wheel, type WheelMidiMode, type WheelRange, type WheelResolution, type WheelSnap } from "@shared/music/types";
import { findTrack, trackLabel } from "../mixer/tool-edits";
import { pitchFromName, pitchName } from "../piano/geometry";
import { type EditResult, findChannel } from "../tool-edits";

type Input = Record<string, unknown>;

/**
 * The Pitch Wheel an input names: by `effect` (its id), by `track` (the track's Pitch Wheel; with
 * `effectSlot`, the one in that slot), or the song's only one. The error lists the song's.
 */
export function findWheel(song: MusicProject, input: Input) {
  const all = pitchWheels(song);
  const list = () =>
    all.length
      ? `The song's Pitch Wheels: ${all.map((w) => `${w.effect.id} (${trackLabel(song, w.track)}, slot ${w.slot + 1})`).join(", ")}.`
      : 'The song has none: add_mixer_effect with plugin "Pitch Wheel" puts one on a track.';
  if (typeof input.effect === "string" && input.effect.trim()) {
    const found = findPitchWheel(song, input.effect.trim());
    if (!found) throw new Error(`There's no Pitch Wheel "${input.effect}". ${list()}`);
    return found;
  }
  if (input.track !== undefined && input.track !== "") {
    const track = findTrack(song, input.track);
    const on = all.filter((w) => w.track.id === track.id && (!Number.isInteger(input.effectSlot) || w.slot === (input.effectSlot as number) - 1));
    if (!on.length) throw new Error(`${trackLabel(song, track)} has no Pitch Wheel${Number.isInteger(input.effectSlot) ? ` in slot ${String(input.effectSlot)}` : ""}. ${list()}`);
    return on[0];
  }
  if (all.length === 1) return all[0];
  throw new Error(`Say which Pitch Wheel ("effect" or "track"). ${list()}`);
}

const semis = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100) / 100} st`;
const knob = (v: number) => String(Math.round(v * 100) / 100);

/** A wheel in a line: its pointer (and what it plays, snapped), range, snap and knobs. */
function wheelText(name: string, w: Wheel): string {
  const plays = snapped(w.value, w.snap);
  return (
    `${name}: pointer ${semis(w.value)}${plays !== w.value ? ` (plays ${semis(plays)})` : ""}, range ${w.range} (±${halfRange(w.range)}), snap ${w.snap}, ` +
    `gravity ${knob(w.gravity)}, inertia ${knob(w.inertia)}, smooth ${knob(w.smooth)}.`
  );
}

/** Where its notes come from, said with the channel's name and whether it's heard. */
function notesText(song: MusicProject, pw: PitchWheel): string {
  if (!pw.notesFrom) return "No channel's notes play it (only the wheel).";
  const channel = song.channels.find((c) => c.id === pw.notesFrom);
  if (!channel) return `Notes from a channel that's gone (${pw.notesFrom}): set notesFrom to another, or "none".`;
  return `Notes from "${channel.name}" (${channel.id}${channel.muted ? ", muted: only the result is heard" : ", heard too: mute it to hear only the result"}).`;
}

/** Its settings in a few lines, for the model. */
function settingsText(song: MusicProject, pw: PitchWheel): string[] {
  return [
    wheelText("Pitch wheel", pw.pitch),
    pw.timbreOn
      ? wheelText("Timbre wheel (on: the formants are its)", pw.timbre)
      : `Timbre tab off: the formants move with the pitch (the tape sound); its wheel, unused: ${wheelText("Timbre", pw.timbre).slice("Timbre: ".length)}`,
    `${pw.midiMode === "multi" ? "Multi (a voice per note, silent without)" : "Single (always heard, the latest note setting the shift)"}. ${notesText(song, pw)} ` +
      `Origin ${pitchName(pw.origin)} (MIDI ${pw.origin}). Resolution ${pw.resolution}.`,
  ];
}

/** What the engine last said it was doing. */
export function liveText(live: EnginePitchWheelState | null, now: boolean): string {
  if (!live) return "The engine hasn't said what it's doing yet (nothing has played through it).";
  const voices = live.voices.map((v) => (v.key < 0 ? `the wheel's at ${semis(v.pitch)}` : `${pitchName(v.key)} at ${semis(v.pitch)}`));
  return (
    `${now ? "Now (sound is going through it)" : "Last heard (nothing is going through it now)"}: pitch heard ${semis(live.pitch)}, timbre ${semis(live.timbre)}; ` +
    `notes held: ${live.notes.map(pitchName).join(", ") || "none"}; voices: ${voices.join(", ") || "none (silent)"}; ` +
    `input level ${Math.round(live.input * 100)}%; it comes out ${live.latency} samples late (compensated).`
  );
}

/** get_pitch_wheel: where it is, its settings, presets, and what the engine last said it was doing. */
export function describePitchWheel(song: MusicProject, input: Input, live: EnginePitchWheelState | null = null, now = false): string {
  const { track, slot, effect, pitchWheel: pw } = findWheel(song, input);
  return [
    `Pitch Wheel ${effect.id}, slot ${slot + 1} of ${trackLabel(song, track)}${effect.enabled ? "" : " (bypassed)"}${effect.mix < 1 ? `, slot mix ${Math.round(effect.mix * 100)}%` : ""}.`,
    ...settingsText(song, pw),
    `Preset: ${currentPreset(pw) ?? "none (custom)"}. Presets: ${PITCH_WHEEL_PRESETS.map((p) => `${p.name} (${p.detail})`).join("; ")}.`,
    liveText(live, now),
  ].join("\n");
}

/** The smallest range whose dial reaches a value. */
const rangeFor = (value: number): WheelRange | undefined => WHEEL_RANGES.find((r) => Math.abs(value) <= halfRange(r));

/** A wheel's fields from the model, checked: what to patch it with. */
function wheelPatch(raw: unknown, name: "pitch" | "timbre", was: Wheel): Partial<Wheel> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`"${name}" must be an object: { value, range, snap, gravity, inertia, smooth }.`);
  const w = raw as Input;
  const patch: Partial<Wheel> = {};
  if (w.range !== undefined) {
    if (!WHEEL_RANGES.includes(w.range as WheelRange)) throw new Error(`"${name}.range" must be one of: ${WHEEL_RANGES.join(", ")} (semitones end to end).`);
    patch.range = w.range as WheelRange;
  }
  if (w.value !== undefined) {
    const most = halfRange(WHEEL_RANGES[WHEEL_RANGES.length - 1]);
    if (!isFiniteNumber(w.value) || Math.abs(w.value) > most) throw new Error(`"${name}.value" must be a number of semitones from -${most} to ${most}.`);
    const range = patch.range ?? was.range;
    if (Math.abs(w.value) > halfRange(range)) {
      // Past the dial: widen it, unless a range was asked for.
      if (patch.range !== undefined) throw new Error(`"${name}.value" ${w.value} is past range ${range} (±${halfRange(range)}): give a range of ${rangeFor(w.value)} or more.`);
      patch.range = rangeFor(w.value);
    }
    patch.value = w.value;
  }
  if (w.snap !== undefined) {
    // (QuikQuak's Snap is On / Off: a boolean reads as that.)
    const snap = typeof w.snap === "boolean" ? (w.snap ? "semitone" : "off") : w.snap;
    if (!WHEEL_SNAPS.includes(snap as WheelSnap)) throw new Error(`"${name}.snap" must be one of: ${WHEEL_SNAPS.join(", ")}.`);
    patch.snap = snap as WheelSnap;
  }
  for (const key of ["gravity", "inertia", "smooth"] as const) {
    const v = w[key];
    if (v === undefined) continue;
    if (!isFiniteNumber(v) || v < 0 || v > 1) throw new Error(`"${name}.${key}" must be a number from 0 to 1.`);
    patch[key] = v;
  }
  return patch;
}

/** update_pitch_wheel: a preset, then the wheels, the Timbre tab, the notes and options. */
export function updatePitchWheelTool(song: MusicProject, input: Input): EditResult {
  const { effect } = findWheel(song, input);
  let next = song;
  if (input.preset !== undefined) {
    const name = String(input.preset).trim().toLowerCase();
    const preset = PITCH_WHEEL_PRESETS.find((p) => p.name.toLowerCase() === name);
    if (!preset) throw new Error(`There's no preset "${String(input.preset)}". The presets: ${PITCH_WHEEL_PRESETS.map((p) => p.name).join(", ")}.`);
    next = applyPitchWheelPreset(next, effect.id, preset.name);
  }
  const was = findPitchWheel(next, effect.id)!.pitchWheel;

  const patch: PitchWheelPatch = {};
  if (input.pitch !== undefined) patch.pitch = wheelPatch(input.pitch, "pitch", was.pitch);
  if (input.timbre !== undefined) patch.timbre = wheelPatch(input.timbre, "timbre", was.timbre);
  if (input.timbreOn !== undefined) {
    if (typeof input.timbreOn !== "boolean") throw new Error('"timbreOn" must be true or false.');
    patch.timbreOn = input.timbreOn;
  }
  if (input.midiMode !== undefined) {
    if (!WHEEL_MIDI_MODES.includes(input.midiMode as WheelMidiMode)) throw new Error(`"midiMode" must be one of: ${WHEEL_MIDI_MODES.join(", ")}.`);
    patch.midiMode = input.midiMode as WheelMidiMode;
  }
  if (input.resolution !== undefined) {
    if (!WHEEL_RESOLUTIONS.includes(input.resolution as WheelResolution)) throw new Error(`"resolution" must be one of: ${WHEEL_RESOLUTIONS.join(", ")}.`);
    patch.resolution = input.resolution as WheelResolution;
  }
  if (input.notesFrom !== undefined) {
    const ref = typeof input.notesFrom === "string" ? input.notesFrom.trim() : input.notesFrom;
    patch.notesFrom = ref === null || ref === "" || (typeof ref === "string" && ref.toLowerCase() === "none") ? null : findChannel(song, ref).id;
  }
  if (input.origin !== undefined) {
    const origin = typeof input.origin === "string" ? pitchFromName(input.origin) : Number.isInteger(input.origin) ? (input.origin as number) : null;
    if (origin === null || origin < 0 || origin > 127) throw new Error('"origin" must be a note name like "C5" (MIDI 60) or "A4", or a MIDI number from 0 to 127.');
    patch.origin = origin;
  }
  const asked = input.preset !== undefined || Object.keys(patch).length > 0;
  if (!asked) throw new Error("Nothing to change: give a preset, a wheel (pitch, timbre), timbreOn, midiMode, notesFrom, origin or resolution.");
  next = updatePitchWheel(next, effect.id, patch);

  const now = findPitchWheel(next, effect.id)!.pitchWheel;
  const warnings: string[] = [];
  if (now.midiMode === "multi" && !now.notesFrom) warnings.push("Multi with no channel's notes is silent until notes play it: set notesFrom.");
  return {
    song: next,
    text: [`Pitch Wheel ${effect.id}${next === song ? " (already so)" : ""}:`, ...settingsText(next, now), `Preset: ${currentPreset(now) ?? "custom"}.`, ...warnings].join(" "),
  };
}
