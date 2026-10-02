/**
 * Making and repairing music documents: the one place that decides what a valid `MusicProject` is.
 * It runs when a song is created, loaded and saved, so a new field must be validated here (and
 * old documents upgraded here), or it's dropped.
 */
import { createId } from "../ids.ts";
import { normalizeMarkers } from "./markers.ts";
import { normalizeSamplerFields } from "./sampler.ts";
import { isScaleId } from "./scales.ts";
import { clamp, isFiniteNumber } from "../math.ts";
import { DEFAULT_PROJECT_NAME } from "../suites.ts";
import { GROSS_BEAT_PLUGIN, GROSS_SLOTS, GROSS_SYNCS, GROSS_TICKS, MAX_GROSS_ATTACK, MAX_GROSS_RELEASE, isGrossBeat } from "./gross-beat-presets.ts";
import {
  type Automation,
  type AutomationLfo,
  type AutomationPoint,
  type AutomationTarget,
  CURVE_TYPES,
  type Channel,
  type CurveType,
  type Envelope,
  type GrossBeat,
  type GrossBeatSlot,
  type ChannelControl,
  type GrossControl,
  type GrossHold,
  type Mixer,
  type MixerEffect,
  type InputMonitor,
  type MixerGroup,
  type MixerInput,
  type MixerSend,
  type MixerTrack,
  type MusicProject,
  type MusicSettings,
  type Note,
  type Pattern,
  type Playlist,
  type PlaylistClip,
  type PlaylistTrack,
  type PluginRef,
  type Precomputed,
  ROOT_PITCH,
  STEP_TICKS,
} from "./types.ts";

export const DEFAULT_TEMPO = 140;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 999;
/** The notes that can get the beat. */
export const BEAT_UNITS = [1, 2, 4, 8, 16, 32] as const;
/** FL Studio's defaults: a channel at 78% and a note at velocity 100 of 127 play a sample as it is. */
export const DEFAULT_VOLUME = 0.78;
export const DEFAULT_VELOCITY = 0.78;
/** How far a channel can be transposed, in semitones. */
export const MAX_PITCH = 48;
/** The channel PITCH knob's reach either way, in semitones (and an automation clip's of it). */
export const PITCH_KNOB_RANGE = 24;
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

/** Whether a sample's precomputed effects change nothing (it plays as its file is). */
export const precomputedUntouched = (p: Precomputed) => (Object.keys(DEFAULT_PRECOMPUTED) as (keyof Precomputed)[]).every((key) => p[key] === DEFAULT_PRECOMPUTED[key]);

/** The master's id, the same in every song. */
export const MASTER_TRACK_ID = "master";
/** How many insert tracks a new song has (FL Studio's templates' 16), and the most it can have (FL's 500). */
export const DEFAULT_INSERTS = 16;
export const MAX_INSERTS = 500;
/** Effect slots on each mixer track, as in FL Studio. */
export const EFFECT_SLOTS = 10;
/** The colours a mixer track can be given from its menu (content colours, the same in every theme): FL Studio's muted tones. */
export const TRACK_COLORS = ["#a8403c", "#b8662f", "#a8913a", "#71913a", "#3f8a4c", "#38868c", "#3f5ea8", "#5d4ca8", "#8a4a9e", "#a8456f", "#7d5c44", "#646973"] as const;
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** How far a track's manual delay compensation reaches either way, in ms. */
export const MAX_LATENCY_OFFSET = 1000;
/** How far a track's input offset (`MixerTrack.inputOffset`) moves its takes either way, in ms. */
export const MAX_INPUT_OFFSET = 1000;
/** The audio device's inputs a track can take, by number: more than any interface has. */
export const MAX_INPUT_CHANNELS = 64;
export const INPUT_MONITORS = ["off", "armed", "on"] as const;

/** A mixer track's input, checked: a channel the device could have, or null. */
export function normalizeInput(raw: unknown): MixerInput | null {
  if (!isObject(raw) || !Number.isInteger(raw.channel)) return null;
  const channel = raw.channel as number;
  const stereo = raw.stereo === true;
  if (channel < 0 || channel + (stereo ? 1 : 0) >= MAX_INPUT_CHANNELS) return null;
  return { channel, stereo };
}

/** Where a mixer track's fader leaves its sound as it is (0 dB). */
export const DEFAULT_FADER = 0.8;

/** The playlist's tracks, as many as FL Studio has. */
export const MAX_PLAYLIST_TRACKS = 500;
/** How late in the song a clip can end: 1000 bars of 4/4, as far as a pattern reaches. */
export const MAX_SONG_TICKS = MAX_PATTERN_TICKS;
/** The most clips a playlist holds. */
export const MAX_CLIPS = 50_000;
/** How far into its file an audio clip's window can start, in seconds (a day). */
export const MAX_AUDIO_OFFSET = 86_400;
/** An audio clip's own gain at most: +36 dB, as FL's. */
export const MAX_CLIP_GAIN = 10 ** (36 / 20);
/** How far an audio clip can be time-stretched: an eighth as long, to eight times as long. */
export const MIN_STRETCH = 0.125;
export const MAX_STRETCH = 8;

/**
 * An audio clip's own gain, fades and stretch (`PlaylistClip`), checked: each only when it isn't its
 * default, the fades within its `length` (shortened together if they'd overlap).
 */
export function clipExtras(raw: Record<string, unknown>, length: number): Pick<PlaylistClip, "fadeIn" | "fadeOut" | "fadeInTension" | "fadeOutTension" | "gain" | "stretch"> {
  const extras: Pick<PlaylistClip, "fadeIn" | "fadeOut" | "fadeInTension" | "fadeOutTension" | "gain" | "stretch"> = {};
  let fadeIn = Math.round(number(raw.fadeIn, 0, length, 0));
  let fadeOut = Math.round(number(raw.fadeOut, 0, length, 0));
  if (fadeIn + fadeOut > length) {
    const scale = length / (fadeIn + fadeOut);
    fadeIn = Math.floor(fadeIn * scale);
    fadeOut = Math.floor(fadeOut * scale);
  }
  if (fadeIn > 0) extras.fadeIn = fadeIn;
  if (fadeOut > 0) extras.fadeOut = fadeOut;
  const inTension = number(raw.fadeInTension, -1, 1, 0);
  const outTension = number(raw.fadeOutTension, -1, 1, 0);
  if (fadeIn > 0 && inTension !== 0) extras.fadeInTension = inTension;
  if (fadeOut > 0 && outTension !== 0) extras.fadeOutTension = outTension;
  const gain = number(raw.gain, 0, MAX_CLIP_GAIN, 1);
  if (gain !== 1) extras.gain = gain;
  const stretch = number(raw.stretch, MIN_STRETCH, MAX_STRETCH, 1);
  if (Math.abs(stretch - 1) > 1e-9) extras.stretch = stretch;
  return extras;
}
/** A playlist track's height, as a share of the usual one (FL's track Size). */
export const MIN_TRACK_SIZE = 0.25;
export const MAX_TRACK_SIZE = 4;
/** A track as new: unnamed, the playlist's colour, the usual height, playing. */
export const DEFAULT_PLAYLIST_TRACK: PlaylistTrack = { name: null, color: null, size: 1, muted: false, mixerTrack: null };

/** The most automation clips a song has, and points one curve has. */
export const MAX_AUTOMATIONS = 2000;
export const MAX_AUTOMATION_POINTS = 20_000;
/** An LFO's slowest and fastest speeds, in cycles per bar. */
export const MIN_LFO_SPEED = 1 / 16;
export const MAX_LFO_SPEED = 32;
/** An automation clip's LFO as new: off, a cycle a bar, even, none of it. */
export const DEFAULT_LFO: AutomationLfo = { enabled: false, speed: 1, tension: 0, skew: 0.5, level: 0, multiply: false };

/** Steps in one bar of a time signature (16 in 4/4, 12 in 3/4 and 6/8). */
export const stepsPerBar = ([beats, unit]: MusicSettings["timeSignature"]) => Math.max(1, Math.round((beats * 16) / unit));

/** The pattern every song starts with (a fixed id, so an empty song is always the same document). */
export const FIRST_PATTERN_ID = "pat_1";

export function createPattern(name: string, id = createId("pat")): Pattern {
  return { id, name, length: null, notes: {}, color: null };
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
 * How long a pattern is, in steps. Auto: a bar while its notes fit in one, else up to the end of the
 * two bars its last note is in (phrases come in twos: three bars of notes make a four-bar pattern, as
 * Théo wants). Set: its length, or longer if that's too short. As in FL Studio, a note is never left out:
 * one written past the set length (in the Piano roll) makes the pattern reach the end of its bar.
 */
export function patternSteps(pattern: Pattern, timeSignature: MusicSettings["timeSignature"]): number {
  const bar = stepsPerBar(timeSignature) * STEP_TICKS;
  const bars = Math.max(1, Math.ceil(Math.min(patternEnd(pattern), MAX_PATTERN_TICKS) / bar));
  if (pattern.length === null) return ((bars === 1 ? 1 : Math.min(Math.ceil(bars / 2) * 2, Math.ceil(MAX_PATTERN_TICKS / bar))) * bar) / STEP_TICKS;
  return patternEnd(pattern) > pattern.length * STEP_TICKS ? Math.max(pattern.length, (bars * bar) / STEP_TICKS) : pattern.length;
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
    color: null,
  };
}

/** An audio clip's channel (FL's "Audio clip"): the file the playlist's audio clips play. */
export function createAudioChannel(name: string, sampleId: string, id = createId("chan")): Channel {
  return { ...createChannel(name, sampleId, id), kind: "audio" };
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
  return {
    id,
    name: null,
    color: null,
    dock: "middle",
    separator: false,
    group: null,
    volume: DEFAULT_FADER,
    pan: 0,
    muted: false,
    invert: false,
    swap: false,
    stereo: 0,
    latencyOffset: 0,
    input: null,
    monitor: "armed",
    inputOffset: 0,
    effects: emptySlots(),
    sends: [{ to: MASTER_TRACK_ID, level: 1 }],
  };
}

/** A new song's mixer: the master and `DEFAULT_INSERTS` insert tracks (fixed ids, so an empty song is always the same document). */
export function createMixer(): Mixer {
  const master: MixerTrack = { ...createMixerTrack(MASTER_TRACK_ID), dock: "left", sends: [] };
  return { tracks: [master, ...Array.from({ length: DEFAULT_INSERTS }, (_, i) => createMixerTrack(`insert_${i + 1}`))], groups: [] };
}

export function createMusicProject(name = DEFAULT_PROJECT_NAME, tempo = DEFAULT_TEMPO): MusicProject {
  const settings: MusicSettings = { tempo, timeSignature: [4, 4], swing: 0, volume: DEFAULT_VOLUME };
  return {
    version: 1,
    name,
    settings,
    channels: emptyRack(),
    patterns: [createPattern("Pattern 1", FIRST_PATTERN_ID)],
    playlist: emptyPlaylist(),
    mixer: createMixer(),
    automations: [],
  };
}

/** What the tab chooses for a new song (`CreateProjectRequest.options`): the tempo set as the default. */
export interface NewSongOptions {
  tempo?: number;
}

/** A new song with the tab's choices for it (untrusted: a tempo out of range is ignored). */
export function withSongOptions(song: MusicProject, options: unknown): MusicProject {
  if (!isObject(options)) return song;
  const tempo = options.tempo;
  if (typeof tempo !== "number" || !Number.isFinite(tempo) || tempo < MIN_TEMPO || tempo > MAX_TEMPO) return song;
  const rounded = Math.round(tempo * 100) / 100;
  return rounded === song.settings.tempo ? song : { ...song, settings: { ...song.settings, tempo: rounded } };
}

/** A playlist with nothing on it: every track as new. */
export const emptyPlaylist = (): Playlist => ({ tracks: [], clips: [] });

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
    ...envelopeExtras(input),
  };
}

/** A volume envelope's delay, hold and tensions, each only when it isn't 0. */
export function envelopeExtras(input: Record<string, unknown>): Pick<Envelope, "delay" | "hold" | "attackTension" | "decayTension" | "releaseTension"> {
  const out: Pick<Envelope, "delay" | "hold" | "attackTension" | "decayTension" | "releaseTension"> = {};
  for (const key of ["delay", "hold"] as const) {
    const value = number(input[key], 0, MAX_ENVELOPE_TIME, 0);
    if (value) out[key] = value;
  }
  for (const key of ["attackTension", "decayTension", "releaseTension"] as const) {
    const value = number(input[key], -1, 1, 0);
    if (value) out[key] = value;
  }
  return out;
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
    const sampleId = !plugin && typeof raw.sampleId === "string" && isSample(raw.sampleId) ? raw.sampleId : null;
    // An audio clip's channel without its file has nothing to be: it goes (its clips with it).
    if (raw.kind === "audio" && !sampleId) continue;
    channels.push({
      id: raw.id,
      name: text(raw.name, plugin?.name ?? "Channel"),
      kind: plugin ? "plugin" : raw.kind === "audio" ? "audio" : "sampler",
      plugin,
      sampleId,
      volume: number(raw.volume, 0, 1, DEFAULT_VOLUME),
      pan: number(raw.pan, -1, 1, 0),
      pitch: number(raw.pitch, -MAX_PITCH, MAX_PITCH, 0),
      muted: raw.muted === true,
      cutSelf: raw.cutSelf === true,
      envelope: normalizeEnvelope(raw.envelope),
      precomputed: normalizePrecomputed(raw.precomputed),
      mixerTrack: isId(raw.mixerTrack) && isTrack(raw.mixerTrack) ? raw.mixerTrack : MASTER_TRACK_ID,
      color: isColor(raw.color) ? raw.color.toLowerCase() : null,
      ...normalizeSamplerFields(raw),
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
  // Any channel can have notes: an audio clip's channel plays its file from them too, as in FL Studio.
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
    patterns.push({ id: raw.id, name: text(raw.name, `Pattern ${patterns.length + 1}`), length, notes, color: isColor(raw.color) ? raw.color.toLowerCase() : null });
  }
  return patterns.length ? patterns : [createPattern("Pattern 1", FIRST_PATTERN_ID)];
}

function normalizeEffect(input: unknown, seen: Set<string>): MixerEffect | null {
  if (!isObject(input) || !isId(input.id) || seen.has(input.id)) return null;
  const plugin = normalizePlugin(input.plugin);
  if (!plugin) return null;
  seen.add(input.id);
  const effect: MixerEffect = { id: input.id, plugin, enabled: input.enabled !== false, mix: number(input.mix, 0, 1, 1) };
  // Ours: its settings are the song's (a plugin's are its own, in a file beside it).
  if (isGrossBeat(plugin)) return { ...effect, plugin: GROSS_BEAT_PLUGIN, grossBeat: normalizeGrossBeat(input.grossBeat) };
  return effect;
}

/** A new Gross Beat's settings: its first slots (Empty) picked, both envelopes at full, FL's defaults. */
export const DEFAULT_GROSS_BEAT: GrossBeat = {
  timeSlot: 0,
  volumeSlot: 0,
  timeMix: 1,
  volumeMix: 1,
  attack: 0,
  release: 0,
  tension: 0,
  time: Array.from({ length: GROSS_SLOTS }, () => null),
  volume: Array.from({ length: GROSS_SLOTS }, () => null),
  linkSlots: false,
  oneShot: false,
  hold: "last",
  trigSync: 0.25,
  posSync: 4,
  clickReduction: true,
  attackCompensation: false,
  removeDc: false,
  hq: false,
};

const GROSS_HOLDS: readonly GrossHold[] = ["off", "last", "next"];
const isSync = (v: unknown): v is number => GROSS_SYNCS.includes(v as never);
const slotIndex = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < GROSS_SLOTS ? (v as number) : 0);

/** A Gross Beat slot changed from its preset, or null (the preset). */
function normalizeGrossSlot(raw: unknown): GrossBeatSlot | null {
  if (!isObject(raw) || !Array.isArray(raw.points)) return null;
  return { name: text(raw.name, "Slot"), points: normalizePoints(raw.points, GROSS_TICKS) };
}

/** Gross Beat's settings (`docs/fl-studio/gross-beat.md`): anything missing or wrong is its default. */
export function normalizeGrossBeat(input: unknown): GrossBeat {
  if (!isObject(input)) return DEFAULT_GROSS_BEAT;
  const slots = (list: unknown) => Array.from({ length: GROSS_SLOTS }, (_, i) => (Array.isArray(list) ? normalizeGrossSlot(list[i]) : null));
  const d = DEFAULT_GROSS_BEAT;
  return {
    timeSlot: slotIndex(input.timeSlot),
    volumeSlot: slotIndex(input.volumeSlot),
    timeMix: number(input.timeMix, 0, 1, d.timeMix),
    volumeMix: number(input.volumeMix, 0, 1, d.volumeMix),
    attack: number(input.attack, 0, MAX_GROSS_ATTACK, d.attack),
    release: number(input.release, 0, MAX_GROSS_RELEASE, d.release),
    tension: number(input.tension, -1, 1, d.tension),
    time: slots(input.time),
    volume: slots(input.volume),
    linkSlots: input.linkSlots === true,
    oneShot: input.oneShot === true,
    hold: GROSS_HOLDS.includes(input.hold as GrossHold) ? (input.hold as GrossHold) : d.hold,
    trigSync: isSync(input.trigSync) ? input.trigSync : d.trigSync,
    posSync: isSync(input.posSync) ? input.posSync : d.posSync,
    clickReduction: typeof input.clickReduction === "boolean" ? input.clickReduction : d.clickReduction,
    attackCompensation: input.attackCompensation === true,
    removeDc: input.removeDc === true,
    hq: input.hq === true,
  };
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
  const groups: MixerGroup[] = [];
  for (const raw of Array.isArray(input.groups) ? input.groups : []) {
    if (isObject(raw) && isId(raw.id) && !groups.some((g) => g.id === raw.id)) groups.push({ id: raw.id, name: text(raw.name, "Group") });
  }
  const effectIds = new Set<string>();
  const tracks: MixerTrack[] = ids.map((id) => {
    const raw = raws.get(id) ?? {};
    const effects = Array.isArray(raw.effects) ? raw.effects : [];
    return {
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : null,
      color: isColor(raw.color) ? raw.color.toLowerCase() : null,
      dock: id === MASTER_TRACK_ID ? "left" : raw.dock === "left" || raw.dock === "right" ? raw.dock : "middle",
      separator: raw.separator === true,
      group: id !== MASTER_TRACK_ID && typeof raw.group === "string" && groups.some((g) => g.id === raw.group) ? raw.group : null,
      volume: number(raw.volume, 0, 1, DEFAULT_FADER),
      pan: number(raw.pan, -1, 1, 0),
      muted: raw.muted === true,
      invert: raw.invert === true,
      swap: raw.swap === true,
      stereo: number(raw.stereo, -1, 1, 0),
      latencyOffset: Math.round(number(raw.latencyOffset, -MAX_LATENCY_OFFSET, MAX_LATENCY_OFFSET, 0) * 100) / 100,
      input: id === MASTER_TRACK_ID ? null : normalizeInput(raw.input),
      monitor: INPUT_MONITORS.includes(raw.monitor as InputMonitor) ? (raw.monitor as InputMonitor) : "armed",
      inputOffset: Math.round(number(raw.inputOffset, -MAX_INPUT_OFFSET, MAX_INPUT_OFFSET, 0) * 100) / 100,
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
  // A group no track is in any more goes.
  return { tracks, groups: groups.filter((g) => tracks.some((t) => t.group === g.id)) };
}

const sameTrack = (a: PlaylistTrack, b: PlaylistTrack) => a.name === b.name && a.color === b.color && a.size === b.size && a.muted === b.muted && a.mixerTrack === b.mixerTrack;

/** The tracks' list without the tracks at its end that are as new (the list is only as long as it needs to be). */
export function trimTracks(tracks: PlaylistTrack[]): PlaylistTrack[] {
  let end = tracks.length;
  while (end > 0 && sameTrack(tracks[end - 1], DEFAULT_PLAYLIST_TRACK)) end--;
  return end === tracks.length ? tracks : tracks.slice(0, end);
}

/** The order clips are kept in: by start, then track, then id (so it's the same every time). */
export const byClipStart = (a: PlaylistClip, b: PlaylistClip) => a.start - b.start || a.track - b.track || a.id - b.id;

function normalizeTrack(raw: unknown, isInsert: (id: string) => boolean): PlaylistTrack {
  if (!isObject(raw)) return DEFAULT_PLAYLIST_TRACK;
  const track: PlaylistTrack = {
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, MAX_NAME) : null,
    color: isColor(raw.color) ? raw.color.toLowerCase() : null,
    size: Math.round(number(raw.size, MIN_TRACK_SIZE, MAX_TRACK_SIZE, 1) * 100) / 100,
    muted: raw.muted === true,
    // An audio track's insert, if it's still there (never the master).
    mixerTrack: typeof raw.mixerTrack === "string" && isInsert(raw.mixerTrack) ? raw.mixerTrack : null,
  };
  return sameTrack(track, DEFAULT_PLAYLIST_TRACK) ? DEFAULT_PLAYLIST_TRACK : track;
}

const CONTROLS = {
  channel: ["volume", "pan", "pitch"],
  mixer: ["volume", "pan", "stereo"],
} as const;

/**
 * An automation clip's target, if it's one. Its control may be gone (a channel deleted): it's kept, and
 * drives nothing, so undoing the deletion brings it all back.
 */
const GROSS_CONTROLS: readonly GrossControl[] = ["timeSlot", "volumeSlot", "timeMix", "volumeMix"];

export function normalizeTarget(raw: unknown): AutomationTarget | null {
  if (!isObject(raw)) return null;
  switch (raw.kind) {
    case "channel":
      return isId(raw.channel) && CONTROLS.channel.includes(raw.control as never) ? { kind: "channel", channel: raw.channel, control: raw.control as ChannelControl } : null;
    case "mixer":
      return isId(raw.track) && CONTROLS.mixer.includes(raw.control as never) ? { kind: "mixer", track: raw.track, control: raw.control as "volume" | "pan" | "stereo" } : null;
    case "send":
      return isId(raw.track) && isId(raw.to) ? { kind: "send", track: raw.track, to: raw.to } : null;
    case "effect":
      return isId(raw.effect) ? { kind: "effect", effect: raw.effect } : null;
    case "tempo":
      return { kind: "tempo" };
    case "grossBeat":
      return isId(raw.effect) && GROSS_CONTROLS.includes(raw.control as GrossControl) ? { kind: "grossBeat", effect: raw.effect, control: raw.control as GrossControl } : null;
    case "main":
      return { kind: "main" };
    case "plugin":
      if ((raw.owner !== "channel" && raw.owner !== "effect") || !isId(raw.id) || typeof raw.param !== "string" || raw.param.length > 200) return null;
      if (!Number.isInteger(raw.index) || (raw.index as number) < 0) return null;
      return { kind: "plugin", owner: raw.owner, id: raw.id, param: raw.param, index: raw.index as number, name: text(raw.name, "Parameter") };
    default:
      return null;
  }
}

export function normalizeLfo(raw: unknown): AutomationLfo {
  if (!isObject(raw)) return DEFAULT_LFO;
  return {
    enabled: raw.enabled === true,
    speed: number(raw.speed, MIN_LFO_SPEED, MAX_LFO_SPEED, DEFAULT_LFO.speed),
    tension: number(raw.tension, -1, 1, 0),
    skew: number(raw.skew, 0, 1, 0.5),
    level: number(raw.level, -1, 1, 0),
    multiply: raw.multiply === true,
  };
}

const isCurve = (v: unknown): v is CurveType => CURVE_TYPES.includes(v as CurveType);

/** A curve's points: in order, inside its length, the first at 0 (one at the middle value if there are none). */
export function normalizePoints(input: unknown, length: number): AutomationPoint[] {
  const points: AutomationPoint[] = [];
  for (const raw of Array.isArray(input) ? input.slice(0, MAX_AUTOMATION_POINTS) : []) {
    if (!isObject(raw) || !isFiniteNumber(raw.tick)) continue;
    points.push({
      tick: Math.round(clamp(raw.tick, 0, length)),
      value: number(raw.value, 0, 1, 0.5),
      tension: number(raw.tension, -1, 1, 0),
      curve: isCurve(raw.curve) ? raw.curve : "single",
    });
  }
  // Stable: points on one tick keep their order (a jump).
  points.sort((a, b) => a.tick - b.tick);
  if (!points.length) return [{ tick: 0, value: 0.5, tension: 0, curve: "single" }];
  if (points[0].tick !== 0) points[0] = { ...points[0], tick: 0 };
  return points;
}

function normalizeAutomations(input: unknown): Automation[] {
  const seen = new Set<string>();
  const automations: Automation[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (automations.length >= MAX_AUTOMATIONS) break;
    if (!isObject(raw) || !isId(raw.id) || seen.has(raw.id)) continue;
    const target = normalizeTarget(raw.target);
    if (!target) continue;
    seen.add(raw.id);
    const length = Math.round(number(raw.length, 1, MAX_PATTERN_TICKS, STEP_TICKS * 16));
    automations.push({
      id: raw.id,
      name: text(raw.name, "Automation"),
      color: isColor(raw.color) ? raw.color.toLowerCase() : null,
      target,
      length,
      points: normalizePoints(raw.points, length),
      min: number(raw.min, 0, 1, 0),
      max: number(raw.max, 0, 1, 1),
      lfo: normalizeLfo(raw.lfo),
    });
  }
  return automations;
}

/**
 * The playlist: tracks by number, and clips of patterns, audio clip channels and automation clips that are still there,
 * on tracks that exist, inside the song's reach. Clips get ids of their own if they lack one. Songs
 * from before the playlist get an empty one.
 */
function normalizePlaylist(input: unknown, patterns: Pattern[], channels: Channel[], automations: Automation[], mixer: Mixer): Playlist {
  if (!isObject(input)) return emptyPlaylist();
  const inserts = new Set(mixer.tracks.filter((t) => t.id !== MASTER_TRACK_ID).map((t) => t.id));
  const tracks = trimTracks((Array.isArray(input.tracks) ? input.tracks : []).slice(0, MAX_PLAYLIST_TRACKS).map((raw) => normalizeTrack(raw, (id) => inserts.has(id))));
  const refs = {
    pattern: new Set(patterns.map((p) => p.id)),
    audio: new Set(channels.filter((c) => c.kind === "audio").map((c) => c.id)),
    automation: new Set(automations.map((a) => a.id)),
  };
  const clips: PlaylistClip[] = [];
  const ids = new Set<number>();
  const unnamed: PlaylistClip[] = [];
  for (const raw of Array.isArray(input.clips) ? input.clips : []) {
    if (clips.length >= MAX_CLIPS) break;
    if (!isObject(raw) || typeof raw.ref !== "string") continue;
    const kind = raw.kind === "audio" || raw.kind === "pattern" || raw.kind === "automation" ? raw.kind : null;
    if (!kind || !refs[kind].has(raw.ref)) continue;
    if (!isFiniteNumber(raw.start) || !Number.isInteger(raw.track)) continue;
    const track = raw.track as number;
    const start = Math.round(raw.start);
    if (track < 0 || track >= MAX_PLAYLIST_TRACKS || start < 0 || start >= MAX_SONG_TICKS) continue;
    // Only a pattern or automation clip follows its content's length; an audio clip always has one.
    const length = kind !== "audio" && raw.length === null ? null : Math.round(number(raw.length, 1, MAX_SONG_TICKS - start, STEP_TICKS * 16));
    const offset = kind !== "audio" ? Math.round(number(raw.offset, 0, MAX_PATTERN_TICKS, 0)) : number(raw.offset, 0, MAX_AUDIO_OFFSET, 0);
    const id = Number.isInteger(raw.id) && (raw.id as number) > 0 && !ids.has(raw.id as number) ? (raw.id as number) : 0;
    const clip: PlaylistClip = { id, kind, ref: raw.ref, track, start, length, offset, muted: raw.muted === true, ...(kind === "audio" && length !== null ? clipExtras(raw, length) : {}) };
    if (id) ids.add(id);
    else unnamed.push(clip);
    clips.push(clip);
  }
  // (A loop, not a spread: a playlist can hold more ids than a call takes arguments.)
  let next = 0;
  for (const id of ids) next = Math.max(next, id);
  for (const clip of unnamed) clip.id = ++next;
  const markers = normalizeMarkers(input.markers);
  return { tracks, clips: clips.sort(byClipStart), ...(markers && { markers }) };
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
  const patterns = normalizePatterns(input.patterns, channels);
  const automations = normalizeAutomations(input.automations);
  return {
    version: 1,
    name,
    settings: {
      tempo,
      timeSignature,
      swing: number(settings.swing, 0, 1, 0),
      volume: number(settings.volume, 0, 1, DEFAULT_VOLUME),
      ...(isObject(settings.scale) && Number.isInteger(settings.scale.root) && (settings.scale.root as number) >= 0 && (settings.scale.root as number) < 12 && isScaleId(settings.scale.type)
        ? { scale: { root: settings.scale.root as number, type: settings.scale.type } }
        : {}),
    },
    channels,
    patterns,
    playlist: normalizePlaylist(input.playlist, patterns, channels, automations, mixer),
    mixer,
    automations,
  };
}
