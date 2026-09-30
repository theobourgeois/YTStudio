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
  MAX_SAMPLE_START,
  MAX_STEPS,
  MAX_TEMPO,
  MIN_SAMPLE_LENGTH,
  MIN_TEMPO,
  createChannel,
  emptyRack,
  createPattern,
  byStart,
  createPluginChannel,
  nextNoteId,
  patternSteps,
} from "./project.ts";
import {
  type Channel,
  type Envelope,
  type MusicProject,
  type MusicSettings,
  type Note,
  type Pattern,
  type PluginRef,
  type Precomputed,
  ROOT_PITCH,
  STEP_TICKS,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getChannel = (song: MusicProject, id: string | null) => song.channels.find((c) => c.id === id);
export const getPattern = (song: MusicProject, id: string | null) => song.patterns.find((p) => p.id === id);

const EMPTY: Note[] = [];
export const channelNotes = (pattern: Pattern, channelId: string): Note[] => pattern.notes[channelId] ?? EMPTY;

/** A pattern's length in steps in its song (its own, or Auto). */
export const lengthOf = (song: MusicProject, pattern: Pattern) => patternSteps(pattern, song.settings.timeSignature);

/**
 * A channel's first `count` steps as the step sequencer shows them: the note that starts on each
 * step, or null. (A note off the grid, from the piano roll, isn't a step.)
 */
export function stepNotes(pattern: Pattern, channelId: string, count: number): (Note | null)[] {
  const steps: (Note | null)[] = Array.from({ length: count }, () => null);
  for (const note of channelNotes(pattern, channelId)) {
    const step = note.start / STEP_TICKS;
    if (Number.isInteger(step) && step < count && !steps[step]) steps[step] = note;
  }
  return steps;
}

/** "x---x---x---x---": a channel's first `count` steps, for people and the assistant. */
export const stepString = (pattern: Pattern, channelId: string, count: number) =>
  stepNotes(pattern, channelId, count)
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

/**
 * The channels new ones go after. A rack is never empty (`emptyRack`), but the sampler it's given then
 * is only a placeholder: while it's untouched (no sample, no notes, its settings as they came), the
 * first channels added take its place.
 */
function channelsBefore(song: MusicProject): Channel[] {
  const [only] = song.channels;
  const untouched =
    song.channels.length === 1 &&
    JSON.stringify(only) === JSON.stringify(emptyRack()[0]) &&
    song.patterns.every((p) => !p.notes[only.id]?.length);
  return untouched ? [] : song.channels;
}

/** Add sampler channels at the end of the rack, one per sample. */
export function addChannels(song: MusicProject, samples: { id?: string; name: string; sampleId: string | null }[]): MusicProject {
  if (!samples.length) return song;
  return { ...song, channels: [...channelsBefore(song), ...samples.map((s) => createChannel(s.name.trim().slice(0, MAX_NAME) || "Channel", s.sampleId, s.id))] };
}

/** Add a channel playing an instrument plugin, at the end of the rack. */
export const addPluginChannel = (song: MusicProject, plugin: PluginRef, id?: string): MusicProject => ({
  ...song,
  channels: [...channelsBefore(song), createPluginChannel(plugin, id)],
});

export type ChannelPatch = Partial<Pick<Channel, "name" | "sampleId" | "volume" | "pan" | "pitch" | "muted" | "cutSelf">> & {
  envelope?: Partial<Envelope>;
  precomputed?: Partial<Precomputed>;
};

/** `next` if it differs from `current` in any field, else `current` itself. */
function changed<T extends object>(current: T, next: T): T {
  return (Object.keys(next) as (keyof T)[]).every((key) => next[key] === current[key]) ? current : next;
}

function patched(channel: Channel, patch: ChannelPatch): Channel {
  const envelope = changed(channel.envelope, {
    enabled: patch.envelope?.enabled ?? channel.envelope.enabled,
    attack: clamp(patch.envelope?.attack ?? channel.envelope.attack, 0, MAX_ENVELOPE_TIME),
    decay: clamp(patch.envelope?.decay ?? channel.envelope.decay, 0, MAX_ENVELOPE_TIME),
    sustain: clamp(patch.envelope?.sustain ?? channel.envelope.sustain, 0, 1),
    release: clamp(patch.envelope?.release ?? channel.envelope.release, 0, MAX_ENVELOPE_TIME),
  });
  const precomputed = changed(channel.precomputed, {
    normalize: patch.precomputed?.normalize ?? channel.precomputed.normalize,
    reverse: patch.precomputed?.reverse ?? channel.precomputed.reverse,
    start: clamp(patch.precomputed?.start ?? channel.precomputed.start, 0, MAX_SAMPLE_START),
    length: clamp(patch.precomputed?.length ?? channel.precomputed.length, MIN_SAMPLE_LENGTH, 1),
    fadeIn: clamp(patch.precomputed?.fadeIn ?? channel.precomputed.fadeIn, 0, 1),
    fadeOut: clamp(patch.precomputed?.fadeOut ?? channel.precomputed.fadeOut, 0, 1),
  });
  return changed(channel, {
    ...channel,
    name: patch.name?.trim().slice(0, MAX_NAME) || channel.name,
    sampleId: patch.sampleId === undefined ? channel.sampleId : patch.sampleId,
    volume: clamp(patch.volume ?? channel.volume, 0, 1),
    pan: clamp(patch.pan ?? channel.pan, -1, 1),
    pitch: clamp(patch.pitch ?? channel.pitch, -MAX_PITCH, MAX_PITCH),
    muted: patch.muted ?? channel.muted,
    cutSelf: patch.cutSelf ?? channel.cutSelf,
    envelope,
    precomputed,
  });
}

/** Apply `update` to the channels in `ids` (in one pass), keeping the song if none changes. */
function updateChannels(song: MusicProject, ids: readonly string[], update: (channel: Channel) => Channel): MusicProject {
  const wanted = new Set(ids);
  let any = false;
  const channels = song.channels.map((channel) => {
    if (!wanted.has(channel.id)) return channel;
    const next = update(channel);
    any ||= next !== channel;
    return next;
  });
  return any ? { ...song, channels } : song;
}

export const updateChannel = (song: MusicProject, id: string, patch: ChannelPatch) => updateChannels(song, [id], (channel) => patched(channel, patch));

/** Mute or unmute several channels. */
export const setMuted = (song: MusicProject, ids: readonly string[], muted: boolean) => updateChannels(song, ids, (channel) => patched(channel, { muted }));

/**
 * Solo a channel, FL Studio's way: solo is a state of the mutes, not a flag. Every other channel is
 * muted and this one unmuted; soloing the channel that's already alone unmutes them all.
 */
export function soloChannel(song: MusicProject, id: string): MusicProject {
  if (!getChannel(song, id)) return song;
  const alone = song.channels.every((c) => (c.id === id ? !c.muted : c.muted));
  const others = song.channels.filter((c) => c.id !== id).map((c) => c.id);
  if (alone) return setMuted(song, others, false);
  return setMuted(setMuted(song, others, true), [id], false);
}

/** Remove channels and their notes in every pattern. */
export function removeChannels(song: MusicProject, ids: readonly string[]): MusicProject {
  const gone = new Set(ids.filter((id) => getChannel(song, id)));
  if (!gone.size) return song;
  return {
    ...song,
    // All of them: the rack gets a sampler again, rather than being left empty.
    channels: gone.size === song.channels.length ? emptyRack() : song.channels.filter((c) => !gone.has(c.id)),
    patterns: song.patterns.map((p) => {
      if (!Object.keys(p.notes).some((id) => gone.has(id))) return p;
      return { ...p, notes: Object.fromEntries(Object.entries(p.notes).filter(([id]) => !gone.has(id))) };
    }),
  };
}

export const removeChannel = (song: MusicProject, id: string) => removeChannels(song, [id]);

/**
 * A copy of a channel right under it: its sample and every setting, but none of its notes (as FL
 * Studio's Clone does).
 */
export function cloneChannel(song: MusicProject, id: string, newId = createId("chan")): MusicProject {
  const index = song.channels.findIndex((c) => c.id === id);
  if (index < 0) return song;
  const copy = { ...song.channels[index], id: newId };
  return { ...song, channels: [...song.channels.slice(0, index + 1), copy, ...song.channels.slice(index + 1)] };
}

/** Move channels one place up (-1) or down (1) the rack, together. Those against the edge stay. */
export function moveChannels(song: MusicProject, ids: readonly string[], direction: -1 | 1): MusicProject {
  const moving = new Set(ids);
  const channels = [...song.channels];
  let any = false;
  const order = direction < 0 ? channels.map((_, i) => i) : channels.map((_, i) => channels.length - 1 - i);
  for (const i of order) {
    const to = i + direction;
    if (!moving.has(channels[i].id) || to < 0 || to >= channels.length || moving.has(channels[to].id)) continue;
    [channels[i], channels[to]] = [channels[to], channels[i]];
    any = true;
  }
  return any ? { ...song, channels } : song;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** "Pattern 3": the first such name no pattern has. */
function nextPatternName(song: MusicProject): string {
  const names = new Set(song.patterns.map((p) => p.name));
  for (let n = song.patterns.length + 1; ; n++) if (!names.has(`Pattern ${n}`)) return `Pattern ${n}`;
}

/** Add an empty pattern after the others. */
export function addPattern(song: MusicProject, options: { id?: string; name?: string } = {}): MusicProject {
  return { ...song, patterns: [...song.patterns, createPattern(options.name?.trim().slice(0, MAX_NAME) || nextPatternName(song), options.id)] };
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

/** Set a pattern's length in steps, or null for Auto. Notes past a set length stay, unheard. */
export const setPatternLength = (song: MusicProject, id: string, length: number | null) =>
  updatePattern(song, id, (p) => {
    const next = length === null || !Number.isFinite(length) ? null : clamp(Math.round(length), 1, MAX_STEPS);
    return next === p.length ? p : { ...p, length: next };
  });

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Replace a channel's notes in a pattern (pasting, or any edit of the whole list). */
export function setChannelNotes(song: MusicProject, patternId: string, channelId: string, update: (notes: Note[], pattern: Pattern) => Note[]): MusicProject {
  if (!getChannel(song, channelId)) return song;
  return updatePattern(song, patternId, (p) => {
    const current = channelNotes(p, channelId);
    const next = update(current, p);
    if (next === current) return p;
    const { [channelId]: _old, ...rest } = p.notes;
    return { ...p, notes: next.length ? { ...rest, [channelId]: next } : rest };
  });
}

const stepNote = (step: number, id: number): Note => ({
  id,
  start: step * STEP_TICKS,
  length: STEP_TICKS,
  pitch: ROOT_PITCH,
  velocity: DEFAULT_VELOCITY,
  pan: 0,
  muted: false,
});
const onStep = (note: Note, step: number) => note.start === step * STEP_TICKS;
const isStep = (step: number) => Number.isInteger(step) && step >= 0 && step < MAX_STEPS;

/** Switch steps of a channel on or off. Steps already that way are left alone. */
export function setSteps(song: MusicProject, patternId: string, channelId: string, steps: number[], on: boolean): MusicProject {
  return setChannelNotes(song, patternId, channelId, (notes) => {
    const changing = [...new Set(steps)].filter((s) => isStep(s) && notes.some((n) => onStep(n, s)) !== on);
    if (!changing.length) return notes;
    if (!on) return notes.filter((n) => !changing.some((s) => onStep(n, s)));
    const first = nextNoteId(notes);
    return [...notes, ...changing.map((step, i) => stepNote(step, first + i))].sort(byStart);
  });
}

/**
 * Replace a channel's first `count` steps with a drawn pattern: any of "x", "X", "1" or "o" is a step
 * on, anything else off ("x---x---x---x---"). A drawing shorter than `count` repeats to fill it. Notes
 * off the grid, or past `count`, are kept; steps that stay on keep their velocity and pitch.
 */
export function drawSteps(song: MusicProject, patternId: string, channelId: string, drawing: string, count: number): MusicProject {
  const cells = [...drawing.replace(/\s/g, "")].map((c) => "xX1o".includes(c));
  if (!cells.length) return song;
  const total = clamp(Math.round(count), 1, MAX_STEPS);
  return setChannelNotes(song, patternId, channelId, (notes) => {
    const want = Array.from({ length: total }, (_, i) => cells[i % cells.length]);
    const isOn = (step: number) => notes.some((n) => onStep(n, step));
    if (want.every((on, step) => on === isOn(step))) return notes;
    const kept = notes.filter((n) => {
      const step = n.start / STEP_TICKS;
      return !Number.isInteger(step) || step >= total || want[step];
    });
    let id = nextNoteId(notes);
    const added = want.flatMap((on, step) => (on && !isOn(step) ? [stepNote(step, id++)] : []));
    return [...kept, ...added].sort(byStart);
  });
}

/** A step on every `every` steps from the first, over `count` steps (the rack's "Fill each 2/4/8 steps"). */
export const fillSteps = (song: MusicProject, patternId: string, channelId: string, every: number, count: number) =>
  drawSteps(song, patternId, channelId, `x${"-".repeat(Math.max(0, Math.round(every) - 1))}`, count);

/** Move a channel's notes a step left (-1) or right (1), wrapping round the first `count` steps. */
export function rotateSteps(song: MusicProject, patternId: string, channelId: string, direction: -1 | 1, count: number): MusicProject {
  const span = clamp(Math.round(count), 1, MAX_STEPS) * STEP_TICKS;
  return setChannelNotes(song, patternId, channelId, (notes) => {
    if (!notes.some((n) => n.start < span)) return notes;
    return notes.map((n) => (n.start < span ? { ...n, start: (n.start + direction * STEP_TICKS + span) % span } : n)).sort(byStart);
  });
}

export type StepPatch = Partial<Pick<Note, "velocity" | "pitch">>;

/** Change the notes on several steps at once (the graph editor): their velocity (0..1) or pitch (a MIDI note). */
export function setStepNotes(song: MusicProject, patternId: string, channelId: string, patches: ReadonlyMap<number, StepPatch>): MusicProject {
  if (!patches.size) return song;
  return setChannelNotes(song, patternId, channelId, (notes) => {
    let any = false;
    const next = notes.map((note) => {
      const patch = patches.get(note.start / STEP_TICKS);
      if (!patch) return note;
      const velocity = clamp(patch.velocity ?? note.velocity, 0, 1);
      const pitch = Math.round(clamp(patch.pitch ?? note.pitch, 0, 127));
      if (velocity === note.velocity && pitch === note.pitch) return note;
      any = true;
      return { ...note, velocity, pitch };
    });
    return any ? next : notes;
  });
}

export const setStepNote = (song: MusicProject, patternId: string, channelId: string, step: number, patch: StepPatch) =>
  setStepNotes(song, patternId, channelId, new Map([[step, patch]]));
