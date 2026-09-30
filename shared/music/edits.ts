/**
 * Edits of a song: pure `(MusicProject) => MusicProject`, returning **the same instance** when nothing
 * changed (so no-ops skip the undo stack and autosave), like the video editor's in `shared/timeline.ts`.
 */
import { createId } from "../ids.ts";
import { clamp } from "../math.ts";
import {
  DEFAULT_VELOCITY,
  MAX_ENVELOPE_TIME,
  MAX_NAME,
  MAX_PITCH,
  MAX_STEPS,
  MAX_TEMPO,
  MIN_TEMPO,
  createChannel,
  createPattern,
  stepsPerBar,
} from "./project.ts";
import { type Channel, type Envelope, type MusicProject, type MusicSettings, type Note, type Pattern, ROOT_PITCH, STEP_TICKS } from "./types.ts";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getChannel = (song: MusicProject, id: string | null) => song.channels.find((c) => c.id === id);
export const getPattern = (song: MusicProject, id: string | null) => song.patterns.find((p) => p.id === id);

const EMPTY: Note[] = [];
export const channelNotes = (pattern: Pattern, channelId: string): Note[] => pattern.notes[channelId] ?? EMPTY;

/**
 * A channel's notes as the step sequencer shows them: the note that starts on each step, or null.
 * (A note off the grid, from the piano roll, isn't a step.)
 */
export function stepNotes(pattern: Pattern, channelId: string): (Note | null)[] {
  const steps: (Note | null)[] = Array.from({ length: pattern.steps }, () => null);
  for (const note of channelNotes(pattern, channelId)) {
    const step = note.start / STEP_TICKS;
    if (Number.isInteger(step) && step < pattern.steps && !steps[step]) steps[step] = note;
  }
  return steps;
}

/** "x---x---x---x---": a channel's steps, for people and the assistant. */
export const stepString = (pattern: Pattern, channelId: string) =>
  stepNotes(pattern, channelId)
    .map((n) => (n ? "x" : "-"))
    .join("");

// ---------------------------------------------------------------------------
// Song settings
// ---------------------------------------------------------------------------

function setSettings(song: MusicProject, patch: Partial<MusicSettings>): MusicProject {
  const settings = { ...song.settings, ...patch };
  const same =
    settings.tempo === song.settings.tempo &&
    settings.swing === song.settings.swing &&
    settings.timeSignature[0] === song.settings.timeSignature[0] &&
    settings.timeSignature[1] === song.settings.timeSignature[1];
  return same ? song : { ...song, settings };
}

export const setTempo = (song: MusicProject, tempo: number) =>
  Number.isFinite(tempo) ? setSettings(song, { tempo: Math.round(clamp(tempo, MIN_TEMPO, MAX_TEMPO) * 100) / 100 }) : song;

export const setSwing = (song: MusicProject, swing: number) => (Number.isFinite(swing) ? setSettings(song, { swing: clamp(swing, 0, 1) }) : song);

export const setTimeSignature = (song: MusicProject, timeSignature: [number, number]) => setSettings(song, { timeSignature });

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Add sampler channels at the end of the rack, one per sample. */
export function addChannels(song: MusicProject, samples: { id?: string; name: string; sampleId: string | null }[]): MusicProject {
  if (!samples.length) return song;
  return { ...song, channels: [...song.channels, ...samples.map((s) => createChannel(s.name.trim().slice(0, MAX_NAME) || "Channel", s.sampleId, s.id))] };
}

export type ChannelPatch = Partial<Pick<Channel, "name" | "sampleId" | "volume" | "pan" | "pitch" | "muted">> & { envelope?: Partial<Envelope> };

function patched(channel: Channel, patch: ChannelPatch): Channel {
  const envelope = patch.envelope
    ? {
        enabled: patch.envelope.enabled ?? channel.envelope.enabled,
        attack: clamp(patch.envelope.attack ?? channel.envelope.attack, 0, MAX_ENVELOPE_TIME),
        decay: clamp(patch.envelope.decay ?? channel.envelope.decay, 0, MAX_ENVELOPE_TIME),
        sustain: clamp(patch.envelope.sustain ?? channel.envelope.sustain, 0, 1),
        release: clamp(patch.envelope.release ?? channel.envelope.release, 0, MAX_ENVELOPE_TIME),
      }
    : channel.envelope;
  const next: Channel = {
    ...channel,
    name: patch.name?.trim().slice(0, MAX_NAME) || channel.name,
    sampleId: patch.sampleId === undefined ? channel.sampleId : patch.sampleId,
    volume: clamp(patch.volume ?? channel.volume, 0, 1),
    pan: clamp(patch.pan ?? channel.pan, -1, 1),
    pitch: clamp(patch.pitch ?? channel.pitch, -MAX_PITCH, MAX_PITCH),
    muted: patch.muted ?? channel.muted,
    envelope,
  };
  const sameEnvelope = (Object.keys(envelope) as (keyof Envelope)[]).every((k) => envelope[k] === channel.envelope[k]);
  const same = (["name", "sampleId", "volume", "pan", "pitch", "muted"] as const).every((k) => next[k] === channel[k]) && sameEnvelope;
  return same ? channel : sameEnvelope ? { ...next, envelope: channel.envelope } : next;
}

export function updateChannel(song: MusicProject, id: string, patch: ChannelPatch): MusicProject {
  const channel = getChannel(song, id);
  if (!channel) return song;
  const next = patched(channel, patch);
  return next === channel ? song : { ...song, channels: song.channels.map((c) => (c === channel ? next : c)) };
}

/** Remove a channel and its notes in every pattern. */
export function removeChannel(song: MusicProject, id: string): MusicProject {
  if (!getChannel(song, id)) return song;
  return {
    ...song,
    channels: song.channels.filter((c) => c.id !== id),
    patterns: song.patterns.map((p) => {
      if (!(id in p.notes)) return p;
      const { [id]: _gone, ...notes } = p.notes;
      return { ...p, notes };
    }),
  };
}

/** A copy of a channel right under it, with its notes in every pattern. */
export function cloneChannel(song: MusicProject, id: string, newId = createId("chan")): MusicProject {
  const index = song.channels.findIndex((c) => c.id === id);
  if (index < 0) return song;
  const copy = { ...song.channels[index], id: newId };
  return {
    ...song,
    channels: [...song.channels.slice(0, index + 1), copy, ...song.channels.slice(index + 1)],
    patterns: song.patterns.map((p) => (p.notes[id] ? { ...p, notes: { ...p.notes, [newId]: p.notes[id] } } : p)),
  };
}

/** Move a channel to `index` of the rack. */
export function moveChannel(song: MusicProject, id: string, index: number): MusicProject {
  const from = song.channels.findIndex((c) => c.id === id);
  const to = clamp(Math.round(index), 0, song.channels.length - 1);
  if (from < 0 || from === to) return song;
  const channels = song.channels.filter((c) => c.id !== id);
  channels.splice(to, 0, song.channels[from]);
  return { ...song, channels };
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** "Pattern 3": the first such name no pattern has. */
function nextPatternName(song: MusicProject): string {
  const names = new Set(song.patterns.map((p) => p.name));
  for (let n = song.patterns.length + 1; ; n++) if (!names.has(`Pattern ${n}`)) return `Pattern ${n}`;
}

/** Add an empty pattern, one bar long, after the others. */
export function addPattern(song: MusicProject, options: { id?: string; name?: string; steps?: number } = {}): MusicProject {
  const steps = clamp(Math.round(options.steps ?? stepsPerBar(song.settings.timeSignature)), 1, MAX_STEPS);
  return { ...song, patterns: [...song.patterns, createPattern(options.name?.trim().slice(0, MAX_NAME) || nextPatternName(song), steps, options.id)] };
}

/** A copy of a pattern right after it. */
export function clonePattern(song: MusicProject, id: string, newId = createId("pat")): MusicProject {
  const index = song.patterns.findIndex((p) => p.id === id);
  if (index < 0) return song;
  const copy = { ...song.patterns[index], id: newId, name: nextPatternName(song) };
  return { ...song, patterns: [...song.patterns.slice(0, index + 1), copy, ...song.patterns.slice(index + 1)] };
}

/** Remove a pattern; a song keeps at least one. */
export function removePattern(song: MusicProject, id: string): MusicProject {
  if (song.patterns.length <= 1 || !getPattern(song, id)) return song;
  return { ...song, patterns: song.patterns.filter((p) => p.id !== id) };
}

function updatePattern(song: MusicProject, id: string, update: (p: Pattern) => Pattern): MusicProject {
  const pattern = getPattern(song, id);
  if (!pattern) return song;
  const next = update(pattern);
  return next === pattern ? song : { ...song, patterns: song.patterns.map((p) => (p === pattern ? next : p)) };
}

export const renamePattern = (song: MusicProject, id: string, name: string) =>
  updatePattern(song, id, (p) => {
    const trimmed = name.trim().slice(0, MAX_NAME);
    return !trimmed || trimmed === p.name ? p : { ...p, name: trimmed };
  });

/** Change a pattern's length. Notes past a shorter end are removed. */
export const setPatternSteps = (song: MusicProject, id: string, steps: number) =>
  updatePattern(song, id, (p) => {
    const length = clamp(Math.round(steps), 1, MAX_STEPS);
    if (!Number.isFinite(steps) || length === p.steps) return p;
    const end = length * STEP_TICKS;
    const notes: Pattern["notes"] = {};
    for (const [channelId, list] of Object.entries(p.notes)) {
      const kept = list.some((n) => n.start >= end) ? list.filter((n) => n.start < end) : list;
      if (kept.length) notes[channelId] = kept;
    }
    return { ...p, steps: length, notes };
  });

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function setChannelNotes(song: MusicProject, patternId: string, channelId: string, update: (notes: Note[], pattern: Pattern) => Note[]): MusicProject {
  if (!getChannel(song, channelId)) return song;
  return updatePattern(song, patternId, (p) => {
    const current = channelNotes(p, channelId);
    const next = update(current, p);
    if (next === current) return p;
    const { [channelId]: _old, ...rest } = p.notes;
    return { ...p, notes: next.length ? { ...rest, [channelId]: next } : rest };
  });
}

const stepNote = (step: number): Note => ({ start: step * STEP_TICKS, length: STEP_TICKS, pitch: ROOT_PITCH, velocity: DEFAULT_VELOCITY });
const onStep = (note: Note, step: number) => note.start === step * STEP_TICKS;
const byStart = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch;

/** Switch steps of a channel on or off. Steps already that way (or outside the pattern) are left alone. */
export function setSteps(song: MusicProject, patternId: string, channelId: string, steps: number[], on: boolean): MusicProject {
  return setChannelNotes(song, patternId, channelId, (notes, pattern) => {
    const wanted = [...new Set(steps)].filter((s) => Number.isInteger(s) && s >= 0 && s < pattern.steps);
    const changing = wanted.filter((s) => notes.some((n) => onStep(n, s)) !== on);
    if (!changing.length) return notes;
    if (!on) return notes.filter((n) => !changing.some((s) => onStep(n, s)));
    return [...notes, ...changing.map(stepNote)].sort(byStart);
  });
}

export function toggleStep(song: MusicProject, patternId: string, channelId: string, step: number): MusicProject {
  const pattern = getPattern(song, patternId);
  if (!pattern) return song;
  return setSteps(song, patternId, channelId, [step], !stepNotes(pattern, channelId)[step]);
}

/**
 * Replace a channel's steps with a drawn pattern: any of "x", "X", "1" or "o" is a step on, anything
 * else off ("x---x---x---x---"). A pattern shorter than the channel's repeats to fill it. Notes off
 * the grid are kept; steps that stay on keep their velocity and pitch.
 */
export function drawSteps(song: MusicProject, patternId: string, channelId: string, drawing: string): MusicProject {
  const cells = [...drawing.replace(/\s/g, "")].map((c) => "xX1o".includes(c));
  if (!cells.length) return song;
  return setChannelNotes(song, patternId, channelId, (notes, pattern) => {
    const want = Array.from({ length: pattern.steps }, (_, i) => cells[i % cells.length]);
    const isOn = (step: number) => notes.some((n) => onStep(n, step));
    if (want.every((on, step) => on === isOn(step))) return notes;
    const kept = notes.filter((n) => !Number.isInteger(n.start / STEP_TICKS) || want[n.start / STEP_TICKS]);
    const added = want.flatMap((on, step) => (on && !isOn(step) ? [stepNote(step)] : []));
    return [...kept, ...added].sort(byStart);
  });
}

/** A step on every `every` steps from the first (the rack's "Fill each 2/4/8 steps"). */
export const fillSteps = (song: MusicProject, patternId: string, channelId: string, every: number) =>
  drawSteps(song, patternId, channelId, `x${"-".repeat(Math.max(0, Math.round(every) - 1))}`);

/** Change the note on a step (the graph editor): its velocity (0..1) or pitch (a MIDI note). */
export function setStepNote(song: MusicProject, patternId: string, channelId: string, step: number, patch: Partial<Pick<Note, "velocity" | "pitch">>): MusicProject {
  return setChannelNotes(song, patternId, channelId, (notes) => {
    const index = notes.findIndex((n) => onStep(n, step));
    if (index < 0) return notes;
    const note = notes[index];
    const velocity = clamp(patch.velocity ?? note.velocity, 0, 1);
    const pitch = Math.round(clamp(patch.pitch ?? note.pitch, 0, 127));
    if (velocity === note.velocity && pitch === note.pitch) return notes;
    return notes.map((n, i) => (i === index ? { ...n, velocity, pitch } : n));
  });
}
