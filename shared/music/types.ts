/**
 * The music suite's document (a DAW project), modelled on FL Studio: the channel rack's channels
 * (instruments) and patterns (notes for any of the channels). The playlist and the mixer come next.
 * Validated by `normalizeMusicProject`; edited by the pure functions in `edits.ts`.
 *
 * Musical time is in ticks, whole numbers, `PPQ` to a quarter note: never seconds, so nothing moves
 * when the tempo changes.
 */

/** Ticks per quarter note, as in FL Studio. */
export const PPQ = 96;
/** A step of the step sequencer: a sixteenth note. */
export const STEP_TICKS = PPQ / 4;
/** The note a sample plays at its own pitch (FL Studio's root note, C5). */
export const ROOT_PITCH = 60;

export interface MusicSettings {
  /** Beats per minute. */
  tempo: number;
  /** Beats per bar, and the note that gets the beat ([4, 4], [6, 8]...). */
  timeSignature: [number, number];
  /** 0..1: how late every second step plays (the channel rack's swing knob). */
  swing: number;
}

/** A sampler's volume envelope. Off, a note plays its whole sample whatever its length. */
export interface Envelope {
  enabled: boolean;
  /** Seconds. */
  attack: number;
  decay: number;
  /** 0..1 of the peak. */
  sustain: number;
  /** Seconds, after the note ends. */
  release: number;
}

/**
 * What's done to a sampler's sample before it plays (FL Studio's "precomputed effects"): the sample is
 * trimmed, reversed, normalised and faded once, not as it plays.
 */
export interface Precomputed {
  /** Raise the sample's level until its loudest point is full scale. */
  normalize: boolean;
  reverse: boolean;
  /** Where the sample starts, 0..1 of its length (SMP START). */
  start: number;
  /** How much of what's left after `start` is kept, 0..1 (LENGTH). */
  length: number;
  /** Fades at each end, 0..1 of the kept part (IN, OUT). */
  fadeIn: number;
  fadeOut: number;
}

/** Which plugin a plugin channel plays: one the audio engine found on this computer. */
export interface PluginRef {
  /** The engine's id for it (`EnginePlugin.id`): its format, name and identifiers. */
  id: string;
  /** Its name and format ("VST3", "AudioUnit"), to show when it isn't installed here. */
  name: string;
  format: string;
}

/**
 * A row of the channel rack: an instrument, FL Studio's "generator". A sampler plays one sample; a
 * plugin channel plays an instrument plugin (its own settings are the plugin's, kept by the engine
 * beside the project: `server/music/engine.ts`).
 */
export interface Channel {
  id: string;
  name: string;
  kind: "sampler" | "plugin";
  /** A plugin channel's instrument; null for a sampler. */
  plugin: PluginRef | null;
  /** The project media a sampler plays (an audio file), or null: silent until it's given one. */
  sampleId: string | null;
  /** 0..1; `DEFAULT_VOLUME` plays the sample as it is. */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Semitones added to every note (fractions are cents). */
  pitch: number;
  muted: boolean;
  /** A new note silences the channel's notes still sounding (a closed hat cutting an open one). */
  cutSelf: boolean;
  envelope: Envelope;
  precomputed: Precomputed;
}

export interface Note {
  /** Ticks from the pattern's start. */
  start: number;
  /** Ticks. */
  length: number;
  /** A MIDI note; `ROOT_PITCH` is the sample's own pitch. */
  pitch: number;
  /** 0..1; `DEFAULT_VELOCITY` plays the sample as it is. */
  velocity: number;
}

/** Notes for any of the channels, looped while it plays. */
export interface Pattern {
  id: string;
  name: string;
  /**
   * Its length in steps (sixteenth notes), or null for FL Studio's Auto: as long as the last bar with
   * a note in it (`patternSteps`). Notes past a set length stay, unheard.
   */
  length: number | null;
  /** Each channel's notes (by channel id), in order of `start`. Channels without notes are absent. */
  notes: Record<string, Note[]>;
}

export interface MusicProject {
  version: 1;
  name: string;
  settings: MusicSettings;
  /** In the channel rack's order. */
  channels: Channel[];
  /** Always at least one. */
  patterns: Pattern[];
}
