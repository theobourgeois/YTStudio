/**
 * Making and repairing music documents: the one place that decides what a valid `MusicProject` is.
 * It runs when a song is created, loaded and saved, so a new field must be validated here (and
 * old documents upgraded here), or it's dropped.
 */
import { createId } from "../ids.ts";
import { clamp, isFiniteNumber } from "../math.ts";
import { DEFAULT_PROJECT_NAME } from "../suites.ts";
import {
  type Channel,
  type Envelope,
  type Mixer,
  type MixerEffect,
  type MixerSend,
  type MixerTrack,
  type MusicProject,
  type MusicSettings,
  type Note,
  type Pattern,
  type PluginRef,
  type Precomputed,
  ROOT_PITCH,
  STEP_TICKS,
} from "./types.ts";

export const DEFAULT_TEMPO = 120;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 999;
/** The notes that can get the beat. */
export const BEAT_UNITS = [1, 2, 4, 8, 16, 32] as const;
/** FL Studio's defaults: a channel at 78% and a note at velocity 100 of 127 play a sample as it is. */
export const DEFAULT_VOLUME = 0.78;
export const DEFAULT_VELOCITY = 0.78;
/** How far a channel can be transposed, in semitones. */
export const MAX_PITCH = 48;
/** The step sequencer's limit, as in FL Studio (64 bars of 4/4). */
export const MAX_STEPS = 512;
/** How far into a pattern a note can start: 1000 bars of 4/4 (the Piano roll goes well past the step sequencer). */
export const MAX_PATTERN_TICKS = 1000 * 16 * STEP_TICKS;
export const MAX_NAME = 80;
/** Limits of an envelope's times, in seconds. */
export const MAX_ENVELOPE_TIME = 10;

export const DEFAULT_ENVELOPE: Envelope = { enabled: false, attack: 0, decay: 0.2, sustain: 1, release: 0.05 };
export const DEFAULT_PRECOMPUTED: Precomputed = { normalize: false, reverse: false, start: 0, length: 1, fadeIn: 0, fadeOut: 0 };
/** The most a sample's start can be moved, so something is always left to play. */
export const MAX_SAMPLE_START = 0.99;
export const MIN_SAMPLE_LENGTH = 0.01;

/** The master's id, the same in every song. */
export const MASTER_TRACK_ID = "master";
/** How many insert tracks a new song has (FL Studio's templates' 16), and the most it can have (FL's 500). */
export const DEFAULT_INSERTS = 16;
export const MAX_INSERTS = 500;
/** Effect slots on each mixer track, as in FL Studio. */
export const EFFECT_SLOTS = 10;
/** How far a track's manual delay compensation reaches either way, in ms. */
export const MAX_LATENCY_OFFSET = 1000;
/** Where a mixer track's fader leaves its sound as it is (0 dB). */
export const DEFAULT_FADER = 0.8;

/** Steps in one bar of a time signature (16 in 4/4, 12 in 3/4 and 6/8). */
export const stepsPerBar = ([beats, unit]: MusicSettings["timeSignature"]) => Math.max(1, Math.round((beats * 16) / unit));

/** The pattern every song starts with (a fixed id, so an empty song is always the same document). */
export const FIRST_PATTERN_ID = "pat_1";

export function createPattern(name: string, id = createId("pat")): Pattern {
  return { id, name, length: null, notes: {} };
}

/** Where each note list's last note ends (they're kept per list: nothing changes a list in place). */
const listEnds = new WeakMap<Note[], number>();

/** Where a pattern's last note ends, in ticks. */
export function patternEnd(pattern: Pattern): number {
  let end = 0;
  for (const notes of Object.values(pattern.notes)) {
    let listEnd = listEnds.get(notes);
    if (listEnd === undefined) {
      listEnd = 0;
      for (const note of notes) listEnd = Math.max(listEnd, note.start + note.length);
      listEnds.set(notes, listEnd);
    }
    end = Math.max(end, listEnd);
  }
  return end;
}

/**
 * How long a pattern is, in steps: up to the end of the last bar with a note in it, and a bar at least
 * (Auto), or its set length if that's longer. As in FL Studio, a note is never left out: one written
 * past the set length (in the Piano roll) makes the pattern reach the end of its bar.
 */
export function patternSteps(pattern: Pattern, timeSignature: MusicSettings["timeSignature"]): number {
  const bar = stepsPerBar(timeSignature) * STEP_TICKS;
  const auto = (Math.max(1, Math.ceil(Math.min(patternEnd(pattern), MAX_PATTERN_TICKS) / bar)) * bar) / STEP_TICKS;
  if (pattern.length === null) return auto;
  return patternEnd(pattern) > pattern.length * STEP_TICKS ? Math.max(pattern.length, auto) : pattern.length;
}

export function createChannel(name: string, sampleId: string | null, id = createId("chan")): Channel {
  return {
    id,
    name,
    kind: "sampler",
    plugin: null,
    sampleId,
    volume: DEFAULT_VOLUME,
    pan: 0,
    pitch: 0,
    muted: false,
    cutSelf: false,
    envelope: DEFAULT_ENVELOPE,
    precomputed: DEFAULT_PRECOMPUTED,
    mixerTrack: MASTER_TRACK_ID,
  };
}

/** A channel playing an instrument plugin. */
export function createPluginChannel(plugin: PluginRef, id = createId("chan")): Channel {
  return { ...createChannel(plugin.name, null, id), kind: "plugin", plugin };
}

/** The channel an empty rack has, as in FL Studio: a sampler with no sample yet. */
export const FIRST_CHANNEL_ID = "chan_sampler";
export const emptyRack = (): Channel[] => [createChannel("Sampler", null, FIRST_CHANNEL_ID)];

const emptySlots = (): null[] => Array.from({ length: EFFECT_SLOTS }, () => null);

/** An insert track as FL Studio adds one: unnamed, at 0 dB, no effects, sending to the master. */
export function createMixerTrack(id = createId("insert")): MixerTrack {
  return { id, name: null, volume: DEFAULT_FADER, pan: 0, muted: false, latencyOffset: 0, effects: emptySlots(), sends: [{ to: MASTER_TRACK_ID, level: 1 }] };
}

/** A new song's mixer: the master and `DEFAULT_INSERTS` insert tracks (fixed ids, so an empty song is always the same document). */
export function createMixer(): Mixer {
  const master: MixerTrack = { ...createMixerTrack(MASTER_TRACK_ID), sends: [] };
  return { tracks: [master, ...Array.from({ length: DEFAULT_INSERTS }, (_, i) => createMixerTrack(`insert_${i + 1}`))] };
}

export function createMusicProject(name = DEFAULT_PROJECT_NAME): MusicProject {
  const settings: MusicSettings = { tempo: DEFAULT_TEMPO, timeSignature: [4, 4], swing: 0 };
  return { version: 1, name, settings, channels: emptyRack(), patterns: [createPattern("Pattern 1", FIRST_PATTERN_ID)], mixer: createMixer() };
}

/**
 * Whether `from`'s sound reaches `to` through sends (or is `to`): a send from `to` to `from` would
 * then make a loop. `sends` gives each track's destinations.
 */
export function reaches(sends: (id: string) => readonly MixerSend[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const send of sends(id)) stack.push(send.to);
  }
  return false;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);
const number = (v: unknown, min: number, max: number, fallback: number) => (isFiniteNumber(v) ? clamp(v, min, max) : fallback);
const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_NAME) : fallback);

function normalizeEnvelope(input: unknown): Envelope {
  if (!isObject(input)) return DEFAULT_ENVELOPE;
  return {
    enabled: input.enabled === true,
    attack: number(input.attack, 0, MAX_ENVELOPE_TIME, DEFAULT_ENVELOPE.attack),
    decay: number(input.decay, 0, MAX_ENVELOPE_TIME, DEFAULT_ENVELOPE.decay),
    sustain: number(input.sustain, 0, 1, DEFAULT_ENVELOPE.sustain),
    release: number(input.release, 0, MAX_ENVELOPE_TIME, DEFAULT_ENVELOPE.release),
  };
}

export function normalizePrecomputed(input: unknown): Precomputed {
  if (!isObject(input)) return DEFAULT_PRECOMPUTED;
  return {
    normalize: input.normalize === true,
    reverse: input.reverse === true,
    start: number(input.start, 0, MAX_SAMPLE_START, 0),
    length: number(input.length, MIN_SAMPLE_LENGTH, 1, 1),
    fadeIn: number(input.fadeIn, 0, 1, 0),
    fadeOut: number(input.fadeOut, 0, 1, 0),
  };
}

function normalizePlugin(input: unknown): PluginRef | null {
  if (!isObject(input) || typeof input.id !== "string" || !input.id || input.id.length > 400) return null;
  return { id: input.id, name: text(input.name, "Plugin"), format: text(input.format, "") || "VST3" };
}

/** The song's channels; never none (a rack is never empty: `emptyRack`). */
function normalizeChannels(input: unknown, isSample: (id: string) => boolean, isTrack: (id: string) => boolean): Channel[] {
  if (!Array.isArray(input)) return emptyRack();
  const seen = new Set<string>();
  const channels: Channel[] = [];
  for (const raw of input) {
    if (!isObject(raw) || !isId(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const plugin = raw.kind === "plugin" ? normalizePlugin(raw.plugin) : null;
    channels.push({
      id: raw.id,
      name: text(raw.name, plugin?.name ?? "Channel"),
      kind: plugin ? "plugin" : "sampler",
      plugin,
      sampleId: !plugin && typeof raw.sampleId === "string" && isSample(raw.sampleId) ? raw.sampleId : null,
      volume: number(raw.volume, 0, 1, DEFAULT_VOLUME),
      pan: number(raw.pan, -1, 1, 0),
      pitch: number(raw.pitch, -MAX_PITCH, MAX_PITCH, 0),
      muted: raw.muted === true,
      cutSelf: raw.cutSelf === true,
      envelope: normalizeEnvelope(raw.envelope),
      precomputed: normalizePrecomputed(raw.precomputed),
      mixerTrack: isId(raw.mixerTrack) && isTrack(raw.mixerTrack) ? raw.mixerTrack : MASTER_TRACK_ID,
    });
  }
  return channels.length ? channels : emptyRack();
}

function normalizeNotes(input: unknown, end: number): Note[] {
  if (!Array.isArray(input)) return [];
  const notes: Note[] = [];
  const ids = new Set<number>();
  const unnamed: Note[] = [];
  for (const raw of input) {
    if (!isObject(raw) || !isFiniteNumber(raw.start)) continue;
    const start = Math.round(raw.start);
    if (start < 0 || start >= end) continue;
    const id = Number.isInteger(raw.id) && (raw.id as number) > 0 && !ids.has(raw.id as number) ? (raw.id as number) : 0;
    const note: Note = {
      id,
      start,
      length: Math.round(number(raw.length, 1, end, STEP_TICKS)),
      pitch: Math.round(number(raw.pitch, 0, 127, ROOT_PITCH)),
      velocity: number(raw.velocity, 0, 1, DEFAULT_VELOCITY),
      pan: number(raw.pan, -1, 1, 0),
      muted: raw.muted === true,
    };
    if (id) ids.add(id);
    else unnamed.push(note);
    notes.push(note);
  }
  // Notes without an id of their own (older songs, or a duplicate) get the next ones.
  let next = Math.max(0, ...ids);
  for (const note of unnamed) note.id = ++next;
  return notes.sort(byStart);
}

/** The order notes are kept in: by start, then pitch, then id (so it's the same every time). */
export const byStart = (a: Note, b: Note) => a.start - b.start || a.pitch - b.pitch || a.id - b.id;

/** An id no note of the list has. */
export const nextNoteId = (notes: readonly Note[]) => notes.reduce((max, note) => Math.max(max, note.id), 0) + 1;

function normalizePatterns(input: unknown, channels: Channel[]): Pattern[] {
  const channelIds = new Set(channels.map((c) => c.id));
  const seen = new Set<string>();
  const patterns: Pattern[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isObject(raw) || !isId(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    // (Songs from before Auto had `steps`, always set; they become Auto, which shows the same bars.)
    const length = isFiniteNumber(raw.length) ? Math.round(clamp(raw.length, 1, MAX_STEPS)) : null;
    const notes: Pattern["notes"] = {};
    for (const [channelId, list] of Object.entries(isObject(raw.notes) ? raw.notes : {})) {
      if (!channelIds.has(channelId)) continue;
      const valid = normalizeNotes(list, MAX_PATTERN_TICKS);
      if (valid.length) notes[channelId] = valid;
    }
    patterns.push({ id: raw.id, name: text(raw.name, `Pattern ${patterns.length + 1}`), length, notes });
  }
  return patterns.length ? patterns : [createPattern("Pattern 1", FIRST_PATTERN_ID)];
}

function normalizeEffect(input: unknown, seen: Set<string>): MixerEffect | null {
  if (!isObject(input) || !isId(input.id) || seen.has(input.id)) return null;
  const plugin = normalizePlugin(input.plugin);
  if (!plugin) return null;
  seen.add(input.id);
  return { id: input.id, plugin, enabled: input.enabled !== false, mix: number(input.mix, 0, 1, 1) };
}

/**
 * The song's mixer: the master first (made if it's missing), then the insert tracks. Sends go to tracks
 * that exist, one per destination, and any that would close a loop is dropped (the first ones win), so
 * the engine can always put the tracks in an order. Songs from before the mixer get a new one.
 */
function normalizeMixer(input: unknown): Mixer {
  if (!isObject(input) || !Array.isArray(input.tracks)) return createMixer();
  const raws = new Map<string, Record<string, unknown>>();
  for (const raw of input.tracks) {
    if (!isObject(raw) || !isId(raw.id) || raws.has(raw.id)) continue;
    if (raw.id !== MASTER_TRACK_ID && raws.size - (raws.has(MASTER_TRACK_ID) ? 1 : 0) >= MAX_INSERTS) continue;
    raws.set(raw.id, raw);
  }
  const ids = [MASTER_TRACK_ID, ...[...raws.keys()].filter((id) => id !== MASTER_TRACK_ID)];
  const effectIds = new Set<string>();
  const tracks: MixerTrack[] = ids.map((id) => {
    const raw = raws.get(id) ?? {};
    const effects = Array.isArray(raw.effects) ? raw.effects : [];
    return {
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : null,
      volume: number(raw.volume, 0, 1, DEFAULT_FADER),
      pan: number(raw.pan, -1, 1, 0),
      muted: raw.muted === true,
      latencyOffset: Math.round(number(raw.latencyOffset, -MAX_LATENCY_OFFSET, MAX_LATENCY_OFFSET, 0) * 100) / 100,
      effects: Array.from({ length: EFFECT_SLOTS }, (_, slot) => normalizeEffect(effects[slot], effectIds)),
      sends: [],
    };
  });
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const sendsOf = (id: string) => byId.get(id)?.sends ?? [];
  for (const track of tracks) {
    // A track that never had a list of sends (a hand-made song) goes to the master.
    const raw = raws.get(track.id);
    const list = Array.isArray(raw?.sends) ? raw.sends : track.id === MASTER_TRACK_ID ? [] : [{ to: MASTER_TRACK_ID, level: 1 }];
    if (track.id === MASTER_TRACK_ID) continue;
    for (const send of list) {
      if (!isObject(send) || typeof send.to !== "string" || !byId.has(send.to)) continue;
      if (track.sends.some((s) => s.to === send.to) || reaches(sendsOf, send.to, track.id)) continue;
      track.sends.push({ to: send.to, level: number(send.level, 0, 1, 1) });
    }
  }
  return { tracks };
}

/**
 * Repair a song from untrusted storage: anything missing or out of range falls back to the default.
 * `isSample` says which media ids the song may play (its project's audio); others are dropped.
 */
export function normalizeMusicProject(input: unknown, isSample: (id: string) => boolean = () => true): MusicProject {
  const base = createMusicProject();
  if (!isObject(input)) return base;
  const settings = isObject(input.settings) ? input.settings : {};
  const tempo = Math.round(number(settings.tempo, MIN_TEMPO, MAX_TEMPO, base.settings.tempo) * 100) / 100;
  const [beats, unit] = Array.isArray(settings.timeSignature) ? settings.timeSignature : [];
  const timeSignature: [number, number] =
    Number.isInteger(beats) && (beats as number) >= 1 && (beats as number) <= 32 && BEAT_UNITS.includes(unit as (typeof BEAT_UNITS)[number])
      ? [beats as number, unit as number]
      : base.settings.timeSignature;
  const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : base.name;
  const mixer = normalizeMixer(input.mixer);
  const trackIds = new Set(mixer.tracks.map((t) => t.id));
  const channels = normalizeChannels(input.channels, isSample, (id) => trackIds.has(id));
  return {
    version: 1,
    name,
    settings: { tempo, timeSignature, swing: number(settings.swing, 0, 1, 0) },
    channels,
    patterns: normalizePatterns(input.patterns, channels),
    mixer,
  };
}
