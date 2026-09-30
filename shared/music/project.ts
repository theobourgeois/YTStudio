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
export const MAX_NAME = 80;
/** Limits of an envelope's times, in seconds. */
export const MAX_ENVELOPE_TIME = 10;

export const DEFAULT_ENVELOPE: Envelope = { enabled: false, attack: 0, decay: 0.2, sustain: 1, release: 0.05 };
export const DEFAULT_PRECOMPUTED: Precomputed = { normalize: false, reverse: false, start: 0, length: 1, fadeIn: 0, fadeOut: 0 };
/** The most a sample's start can be moved, so something is always left to play. */
export const MAX_SAMPLE_START = 0.99;
export const MIN_SAMPLE_LENGTH = 0.01;

/** Steps in one bar of a time signature (16 in 4/4, 12 in 3/4 and 6/8). */
export const stepsPerBar = ([beats, unit]: MusicSettings["timeSignature"]) => Math.max(1, Math.round((beats * 16) / unit));

/** The pattern every song starts with (a fixed id, so an empty song is always the same document). */
export const FIRST_PATTERN_ID = "pat_1";

export function createPattern(name: string, id = createId("pat")): Pattern {
  return { id, name, length: null, notes: {} };
}

/**
 * How long a pattern is, in steps: its set length, or (Auto) up to the end of the last bar with a
 * note in it, and a bar at least.
 */
export function patternSteps(pattern: Pattern, timeSignature: MusicSettings["timeSignature"]): number {
  if (pattern.length !== null) return pattern.length;
  const bar = stepsPerBar(timeSignature);
  let last = 0;
  for (const notes of Object.values(pattern.notes)) if (notes.length) last = Math.max(last, notes[notes.length - 1].start);
  return Math.min(MAX_STEPS, (Math.floor(last / STEP_TICKS / bar) + 1) * bar);
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
  };
}

/** A channel playing an instrument plugin. */
export function createPluginChannel(plugin: PluginRef, id = createId("chan")): Channel {
  return { ...createChannel(plugin.name, null, id), kind: "plugin", plugin };
}

export function createMusicProject(name = DEFAULT_PROJECT_NAME): MusicProject {
  const settings: MusicSettings = { tempo: DEFAULT_TEMPO, timeSignature: [4, 4], swing: 0 };
  return { version: 1, name, settings, channels: [], patterns: [createPattern("Pattern 1", FIRST_PATTERN_ID)] };
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

function normalizeChannels(input: unknown, isSample: (id: string) => boolean): Channel[] {
  if (!Array.isArray(input)) return [];
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
    });
  }
  return channels;
}

function normalizeNotes(input: unknown, end: number): Note[] {
  if (!Array.isArray(input)) return [];
  const notes: Note[] = [];
  for (const raw of input) {
    if (!isObject(raw) || !isFiniteNumber(raw.start)) continue;
    const start = Math.round(raw.start);
    if (start < 0 || start >= end) continue;
    notes.push({
      start,
      length: Math.round(number(raw.length, 1, end, STEP_TICKS)),
      pitch: Math.round(number(raw.pitch, 0, 127, ROOT_PITCH)),
      velocity: number(raw.velocity, 0, 1, DEFAULT_VELOCITY),
    });
  }
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

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
      const valid = normalizeNotes(list, MAX_STEPS * STEP_TICKS);
      if (valid.length) notes[channelId] = valid;
    }
    patterns.push({ id: raw.id, name: text(raw.name, `Pattern ${patterns.length + 1}`), length, notes });
  }
  return patterns.length ? patterns : [createPattern("Pattern 1", FIRST_PATTERN_ID)];
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
  const channels = normalizeChannels(input.channels, isSample);
  return {
    version: 1,
    name,
    settings: { tempo, timeSignature, swing: number(settings.swing, 0, 1, 0) },
    channels,
    patterns: normalizePatterns(input.patterns, channels),
  };
}
