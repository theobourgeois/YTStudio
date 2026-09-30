/**
 * The assistant's edits of a song: each a pure `(song, input, env) => { song, text }`, where `text`
 * is what the model is told. Errors go to the model too: they say what's wrong and what would work.
 */
import { clamp, isFiniteNumber } from "@shared/math";
import {
  type ChannelPatch,
  addPattern,
  drawSteps,
  getPattern,
  lengthOf,
  moveChannels,
  removeChannel,
  removePattern,
  renamePattern,
  setPatternLength,
  setStepNote,
  soloChannel,
  setSwing,
  setTempo,
  setTimeSignature,
  stepNotes,
  stepString,
  transposeChannels,
  updateChannel,
} from "@shared/music/edits";
import { addNotes, editNotes } from "@shared/music/notes";
import { BEAT_UNITS, DEFAULT_VELOCITY, MAX_PATTERN_TICKS, MAX_STEPS, MAX_TEMPO, MIN_TEMPO } from "@shared/music/project";
import { pitchFromName, pitchName } from "./piano/geometry";
import { type Channel, type MusicProject, type Pattern, ROOT_PITCH } from "@shared/music/types";

export interface EditEnv {
  /** The pattern the channel rack shows, which edits act on unless they name another. */
  patternId: string | null;
}

export interface EditResult {
  song: MusicProject;
  text: string;
  /** A pattern the edit made, to show. */
  showPattern?: string;
}

type Input = Record<string, unknown>;
export type SongEdit = (song: MusicProject, input: Input, env: EditEnv) => EditResult;

const names = (items: { name: string }[]) => items.map((i) => `"${i.name}"`).join(", ") || "none";

export function findChannel(song: MusicProject, ref: unknown): Channel {
  const text = typeof ref === "string" ? ref.trim() : "";
  const found = song.channels.find((c) => c.id === text) ?? song.channels.find((c) => c.name.toLowerCase() === text.toLowerCase());
  if (!found) throw new Error(`There's no channel "${text}". The channels are: ${names(song.channels)}. Use a channel's id or name from get_song.`);
  return found;
}

export function findPattern(song: MusicProject, ref: unknown, env: EditEnv): Pattern {
  if (ref === undefined || ref === null || ref === "") return getPattern(song, env.patternId) ?? song.patterns[0];
  const text = String(ref).trim();
  const found = song.patterns.find((p) => p.id === text) ?? song.patterns.find((p) => p.name.toLowerCase() === text.toLowerCase());
  if (!found) throw new Error(`There's no pattern "${text}". The patterns are: ${names(song.patterns)}.`);
  return found;
}

const number = (input: Input, key: string, min: number, max: number): number | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value < min || value > max) throw new Error(`"${key}" must be a number from ${min} to ${max}.`);
  return value;
};

export const updateSong: SongEdit = (song, input) => {
  let next = song;
  const tempo = number(input, "tempo", MIN_TEMPO, MAX_TEMPO);
  if (tempo !== undefined) next = setTempo(next, tempo);
  const swing = number(input, "swing", 0, 1);
  if (swing !== undefined) next = setSwing(next, swing);
  if (input.timeSignature !== undefined) {
    const [beats, unit] = Array.isArray(input.timeSignature) ? input.timeSignature : [];
    if (!Number.isInteger(beats) || beats < 1 || beats > 32 || !BEAT_UNITS.includes(unit)) {
      throw new Error(`"timeSignature" must be [beats, unit] with 1 to 32 beats and a unit of ${BEAT_UNITS.join(", ")}: [4, 4], [6, 8]...`);
    }
    next = setTimeSignature(next, [beats, unit]);
  }
  const { tempo: bpm, swing: sw, timeSignature } = next.settings;
  return { song: next, text: `The song is at ${bpm} BPM in ${timeSignature.join("/")}, swing ${Math.round(sw * 100)}%.` };
};

export const updateChannelTool: SongEdit = (song, input) => {
  const channel = findChannel(song, input.channel);
  const patch: ChannelPatch = {};
  if (typeof input.name === "string") patch.name = input.name;
  const volume = number(input, "volume", 0, 1);
  if (volume !== undefined) patch.volume = volume;
  const pan = number(input, "pan", -1, 1);
  if (pan !== undefined) patch.pan = pan;
  const pitch = number(input, "pitch", -48, 48);
  if (pitch !== undefined) patch.pitch = pitch;
  if (typeof input.muted === "boolean") patch.muted = input.muted;
  if (typeof input.cutSelf === "boolean") patch.cutSelf = input.cutSelf;
  if (input.sample && typeof input.sample === "object") {
    const sample = input.sample as Input;
    patch.precomputed = {
      ...(typeof sample.normalize === "boolean" && { normalize: sample.normalize }),
      ...(typeof sample.reverse === "boolean" && { reverse: sample.reverse }),
      ...(["start", "length", "fadeIn", "fadeOut"] as const).reduce<Record<string, number>>((all, key) => {
        const value = number(sample, key, 0, 1);
        return value === undefined ? all : { ...all, [key]: value };
      }, {}),
    };
  }
  if (input.envelope && typeof input.envelope === "object") {
    const envelope = input.envelope as Input;
    patch.envelope = {
      ...(typeof envelope.enabled === "boolean" && { enabled: envelope.enabled }),
      ...(["attack", "decay", "release"] as const).reduce<Record<string, number>>((all, key) => {
        const value = number(envelope, key, 0, 10);
        return value === undefined ? all : { ...all, [key]: value };
      }, {}),
      ...(number(envelope, "sustain", 0, 1) !== undefined && { sustain: number(envelope, "sustain", 0, 1) }),
    };
  }
  const next = updateChannel(song, channel.id, patch);
  const now = next.channels.find((c) => c.id === channel.id)!;
  return { song: next, text: next === song ? `"${channel.name}" is already like that.` : `Changed ${describeChannel(now)}.` };
};

export const removeChannelTool: SongEdit = (song, input) => {
  const channel = findChannel(song, input.channel);
  return { song: removeChannel(song, channel.id), text: `Removed the channel "${channel.name}".` };
};

export const soloChannelTool: SongEdit = (song, input) => {
  const channel = findChannel(song, input.channel);
  const next = soloChannel(song, channel.id);
  const sounding = next.channels.filter((c) => !c.muted).map((c) => c.name);
  return { song: next, text: sounding.length === 1 ? `"${channel.name}" is soloed (the others are muted).` : `Nothing is soloed now: every channel is unmuted.` };
};

export const moveChannelTool: SongEdit = (song, input) => {
  const channel = findChannel(song, input.channel);
  if (input.direction !== "up" && input.direction !== "down") throw new Error('"direction" must be "up" or "down".');
  const next = moveChannels(song, [channel.id], input.direction === "up" ? -1 : 1);
  return { song: next, text: `The rack's order is now: ${next.channels.map((c) => c.name).join(", ")}.` };
};

export const transposeChannelsTool: SongEdit = (song, input, env) => {
  if (!Array.isArray(input.channels) || !input.channels.length) throw new Error('"channels" must be a list of channels (ids or names from get_song).');
  const channels = input.channels.map((ref) => findChannel(song, ref));
  const semitones = number(input, "semitones", -127, 127);
  if (semitones === undefined || !Number.isInteger(semitones)) throw new Error('"semitones" must be a whole number from -127 to 127 (12 is an octave up).');
  const pattern = findPattern(song, input.pattern, env);
  const next = transposeChannels(song, pattern.id, channels.map((c) => c.id), semitones);
  const list = channels.map((c) => `"${c.name}"`).join(", ");
  if (next === song) return { song, text: `Nothing moved: ${list} ${semitones === 0 ? "stay where they are" : `have no notes to move in "${pattern.name}"`}.` };
  return { song: next, text: `Moved the notes of ${list} in "${pattern.name}" ${Math.abs(semitones)} semitone${Math.abs(semitones) === 1 ? "" : "s"} ${semitones > 0 ? "up" : "down"}.` };
};

export const setStepsTool: SongEdit = (song, input, env) => {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  const drawing = typeof input.steps === "string" ? input.steps.replace(/\s/g, "") : "";
  if (!drawing) throw new Error('"steps" must be a drawing like "x---x---x---x---" (x = on, - = off).');
  // Over the pattern's length, or further if more is drawn (which makes an Auto pattern longer).
  const count = Math.max(lengthOf(song, pattern), drawing.length);
  const next = drawSteps(song, pattern.id, channel.id, drawing, count);
  const now = getPattern(next, pattern.id)!;
  return { song: next, text: `"${channel.name}" in "${pattern.name}": ${stepString(now, channel.id, lengthOf(next, now))}` };
};

const STEP = 24;
const steps = (ticks: number) => Math.round((ticks / STEP) * 1000) / 1000;

/** A channel's notes in a pattern, for the model. */
export function describeNotes(song: MusicProject, input: Input, env: EditEnv): string {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  const notes = pattern.notes[channel.id] ?? [];
  if (!notes.length) return `"${channel.name}" has no notes in "${pattern.name}".`;
  return [
    `"${channel.name}" in "${pattern.name}" (${lengthOf(song, pattern)} steps long): ${notes.length} note${notes.length === 1 ? "" : "s"}, as pitch, start and length in steps.`,
    ...notes.map(
      (n) => `- ${pitchName(n.pitch)} at ${steps(n.start)} for ${steps(n.length)}, velocity ${n.velocity.toFixed(2)}${n.pan ? `, pan ${n.pan.toFixed(2)}` : ""}${n.muted ? ", muted" : ""}`,
    ),
  ].join("\n");
}

export const setNotesTool: SongEdit = (song, input, env) => {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  if (!Array.isArray(input.notes)) throw new Error('"notes" must be a list of { pitch, start, length }.');
  const made = input.notes.map((raw, i) => {
    const note = (raw && typeof raw === "object" ? raw : {}) as Input;
    const pitch = typeof note.pitch === "string" ? pitchFromName(note.pitch) : Number.isInteger(note.pitch) ? (note.pitch as number) : null;
    if (pitch === null || pitch < 0 || pitch > 127) throw new Error(`Note ${i + 1}: "pitch" must be a note name like "C5" or "F#4", or a MIDI number from 0 to 127.`);
    const start = number(note, "start", 0, MAX_PATTERN_TICKS / STEP);
    const length = number(note, "length", 1 / STEP, 4096);
    if (start === undefined || length === undefined) throw new Error(`Note ${i + 1}: "start" and "length" are numbers of steps (sixteenth notes).`);
    const velocity = number(note, "velocity", 0, 1);
    return { pitch, start: start * STEP, length: length * STEP, velocity: velocity ?? DEFAULT_VELOCITY };
  });
  const next = editNotes(song, pattern.id, channel.id, (notes) => addNotes(input.mode === "add" ? notes : [], made).notes);
  const now = getPattern(next, pattern.id)!;
  return { song: next, text: `"${channel.name}" has ${(now.notes[channel.id] ?? []).length} notes in "${pattern.name}", which is ${lengthOf(next, now)} steps long.` };
};

export const editStep: SongEdit = (song, input, env) => {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  const length = lengthOf(song, pattern);
  const step = number(input, "step", 1, length);
  if (step === undefined || !Number.isInteger(step)) throw new Error(`"step" must be a whole number from 1 to ${length} (the pattern's length).`);
  if (!stepNotes(pattern, channel.id, length)[step - 1]) {
    throw new Error(`Step ${step} of "${channel.name}" is off (its steps are ${stepString(pattern, channel.id, length)}). Turn it on with set_steps first.`);
  }
  const velocity = number(input, "velocity", 0, 1);
  const pitch = number(input, "pitch", -48, 48);
  const next = setStepNote(song, pattern.id, channel.id, step - 1, {
    ...(velocity !== undefined && { velocity }),
    ...(pitch !== undefined && { pitch: clamp(ROOT_PITCH + Math.round(pitch), 0, 127) }),
  });
  const note = stepNotes(getPattern(next, pattern.id)!, channel.id, length)[step - 1]!;
  return { song: next, text: `Step ${step} of "${channel.name}": velocity ${note.velocity.toFixed(2)}, pitch ${note.pitch - ROOT_PITCH} semitones.` };
};

/** "16 steps (automatic)" or "24 steps (set)". */
export const describeLength = (song: MusicProject, pattern: Pattern) => `${lengthOf(song, pattern)} steps (${pattern.length === null ? "automatic" : "set"})`;

export const addPatternTool: SongEdit = (song, input) => {
  const next = addPattern(song, { name: typeof input.name === "string" ? input.name : undefined });
  const made = next.patterns[next.patterns.length - 1];
  return { song: next, text: `Added the pattern "${made.name}" (id ${made.id}). It's the one shown now.`, showPattern: made.id };
};

export const updatePatternTool: SongEdit = (song, input, env) => {
  const pattern = findPattern(song, input.pattern, env);
  let next = song;
  if (typeof input.name === "string") next = renamePattern(next, pattern.id, input.name);
  if (input.length === "auto") next = setPatternLength(next, pattern.id, null);
  else if (input.length !== undefined) {
    const length = input.length;
    if (!Number.isInteger(length) || (length as number) < 1 || (length as number) > MAX_STEPS) {
      throw new Error(`"length" must be "auto" or a whole number of steps from 1 to ${MAX_STEPS}.`);
    }
    next = setPatternLength(next, pattern.id, length as number);
  }
  const now = getPattern(next, pattern.id)!;
  return { song: next, text: `The pattern "${now.name}" is ${describeLength(next, now)}.` };
};

export const removePatternTool: SongEdit = (song, input, env) => {
  const pattern = findPattern(song, input.pattern, env);
  if (song.patterns.length <= 1) throw new Error("A song keeps at least one pattern. Clear its steps with set_steps instead.");
  return { song: removePattern(song, pattern.id), text: `Removed the pattern "${pattern.name}".` };
};

const percent = (v: number) => `${Math.round(v * 100)}%`;

export function describeChannel(channel: Channel, sampleName?: string | null): string {
  const parts = [
    `"${channel.name}" (id ${channel.id})`,
    channel.kind === "plugin" ? `plugin ${channel.plugin?.name} (${channel.plugin?.format})` : sampleName === undefined ? null : sampleName ? `sample ${sampleName}` : "no sample (silent)",
    `volume ${percent(channel.volume)}`,
    channel.pan ? `pan ${percent(Math.abs(channel.pan))} ${channel.pan < 0 ? "left" : "right"}` : null,
    channel.pitch ? `pitch ${channel.pitch > 0 ? "+" : ""}${channel.pitch} st` : null,
    channel.muted ? "muted" : null,
    channel.cutSelf ? "cut self" : null,
    describeSample(channel),
    channel.envelope.enabled
      ? `envelope A ${channel.envelope.attack}s D ${channel.envelope.decay}s S ${percent(channel.envelope.sustain)} R ${channel.envelope.release}s`
      : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** What's done to the channel's sample before it plays, or null when nothing is. */
function describeSample({ precomputed: p }: Channel): string | null {
  const parts = [
    p.normalize ? "normalized" : null,
    p.reverse ? "reversed" : null,
    p.start > 0 ? `starts at ${percent(p.start)}` : null,
    p.length < 1 ? `length ${percent(p.length)}` : null,
    p.fadeIn > 0 ? `fade in ${percent(p.fadeIn)}` : null,
    p.fadeOut > 0 ? `fade out ${percent(p.fadeOut)}` : null,
  ].filter(Boolean);
  return parts.length ? `sample ${parts.join(", ")}` : null;
}
