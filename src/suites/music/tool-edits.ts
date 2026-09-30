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
  removeChannel,
  removePattern,
  renamePattern,
  setPatternSteps,
  setStepNote,
  setSwing,
  setTempo,
  setTimeSignature,
  stepNotes,
  stepString,
  updateChannel,
} from "@shared/music/edits";
import { BEAT_UNITS, MAX_STEPS, MAX_TEMPO, MIN_TEMPO } from "@shared/music/project";
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

export const setStepsTool: SongEdit = (song, input, env) => {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  if (typeof input.steps !== "string" || !input.steps.replace(/\s/g, "")) throw new Error('"steps" must be a drawing like "x---x---x---x---" (x = on, - = off).');
  const next = drawSteps(song, pattern.id, channel.id, input.steps);
  return { song: next, text: `"${channel.name}" in "${pattern.name}": ${stepString(getPattern(next, pattern.id)!, channel.id)}` };
};

export const editStep: SongEdit = (song, input, env) => {
  const channel = findChannel(song, input.channel);
  const pattern = findPattern(song, input.pattern, env);
  const step = number(input, "step", 1, pattern.steps);
  if (step === undefined || !Number.isInteger(step)) throw new Error(`"step" must be a whole number from 1 to ${pattern.steps} (the pattern's length).`);
  if (!stepNotes(pattern, channel.id)[step - 1]) {
    throw new Error(`Step ${step} of "${channel.name}" is off (its steps are ${stepString(pattern, channel.id)}). Turn it on with set_steps first.`);
  }
  const velocity = number(input, "velocity", 0, 1);
  const pitch = number(input, "pitch", -48, 48);
  const next = setStepNote(song, pattern.id, channel.id, step - 1, {
    ...(velocity !== undefined && { velocity }),
    ...(pitch !== undefined && { pitch: clamp(ROOT_PITCH + Math.round(pitch), 0, 127) }),
  });
  const note = stepNotes(getPattern(next, pattern.id)!, channel.id)[step - 1]!;
  return { song: next, text: `Step ${step} of "${channel.name}": velocity ${note.velocity.toFixed(2)}, pitch ${note.pitch - ROOT_PITCH} semitones.` };
};

export const addPatternTool: SongEdit = (song, input) => {
  const steps = number(input, "steps", 1, MAX_STEPS);
  const next = addPattern(song, { name: typeof input.name === "string" ? input.name : undefined, steps });
  const made = next.patterns[next.patterns.length - 1];
  return { song: next, text: `Added the pattern "${made.name}" (id ${made.id}, ${made.steps} steps). It's the one shown now.`, showPattern: made.id };
};

export const updatePatternTool: SongEdit = (song, input, env) => {
  const pattern = findPattern(song, input.pattern, env);
  let next = song;
  if (typeof input.name === "string") next = renamePattern(next, pattern.id, input.name);
  const steps = number(input, "steps", 1, MAX_STEPS);
  if (steps !== undefined) next = setPatternSteps(next, pattern.id, steps);
  const now = getPattern(next, pattern.id)!;
  return { song: next, text: `The pattern "${now.name}" is ${now.steps} steps long.` };
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
    sampleName === undefined ? null : sampleName ? `sample ${sampleName}` : "no sample (silent)",
    `volume ${percent(channel.volume)}`,
    channel.pan ? `pan ${percent(Math.abs(channel.pan))} ${channel.pan < 0 ? "left" : "right"}` : null,
    channel.pitch ? `pitch ${channel.pitch > 0 ? "+" : ""}${channel.pitch} st` : null,
    channel.muted ? "muted" : null,
    channel.envelope.enabled
      ? `envelope A ${channel.envelope.attack}s D ${channel.envelope.decay}s S ${percent(channel.envelope.sustain)} R ${channel.envelope.release}s`
      : null,
  ];
  return parts.filter(Boolean).join(", ");
}
