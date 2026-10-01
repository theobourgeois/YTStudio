/**
 * The audio engine as the tab sees it (`/api/engine`). The engine is a native program (`engine/`) the
 * server runs: it owns the audio device and hosts the plugins (VST3, Audio Units), which no browser
 * can load. It plays the open song (one pattern, looped: `compile.ts`), and has a test bench for
 * plugins: one instrument into one effect, played by hand.
 *
 * The server and the engine exchange one JSON object per line: `{ id, cmd, ...params }` in, and
 * `{ id, ok: true, result }` or `{ id, ok: false, error }` out, plus events on its own (`EngineEvent`).
 */
import type { MusicProject } from "./types.ts";

/** A plugin found on this computer. */
export interface EnginePlugin {
  /** Names the plugin across scans (its format, name and ids). */
  id: string;
  name: string;
  /** "VST3" or "AudioUnit". */
  format: string;
  manufacturer: string;
  category: string;
  /** It makes sound from notes (else it's an effect). */
  isInstrument: boolean;
}

export const ENGINE_SLOTS = ["instrument", "effect"] as const;
/** Where a plugin goes in the spike's chain: the instrument plays into the effect. */
export type EngineSlot = (typeof ENGINE_SLOTS)[number];

export interface LoadedPlugin extends EnginePlugin {
  /** Its window is showing. */
  editorOpen: boolean;
  /** The delay it adds, which the mixer will compensate for. */
  latencySamples: number;
  /** A state was saved for this slot (`saveState`) and can be restored. */
  hasSavedState: boolean;
}

export interface EngineStatus {
  /** The output device's name, or null when there's none. */
  device: string | null;
  /** No device at all: sound is only computed on request (`EngineRender`), for tests and the export. */
  offline: boolean;
  /** How much of each block's time the audio thread spends computing it (0..1): near 1, sound breaks up. */
  cpu: number;
  /** Blocks the device had to go without since the engine started. */
  dropouts: number;
  sampleRate: number;
  bufferSize: number;
  /** From a note reaching the engine to its sound leaving the device, at worst (the song's own delay included). */
  outputLatencyMs: number;
  /** Samples the song's sound comes out late by: its plugins' delays, compensated so everything lines up (`Song::compensate`). */
  songLatency: number;
  tone: boolean;
  /** The output's level (0..1+), falling back slowly: a meter. */
  peak: number;
  transport: EngineTransport & { metronome: boolean };
  channels: EngineChannels;
  effects: EngineEffects;
  /** A plugin scan in progress. */
  scanning: { progress: number; name: string } | null;
  pluginCount: number;
  instrument: LoadedPlugin | null;
  effect: LoadedPlugin | null;
}

/** The song's plugin channels, as the engine has them. */
export interface EngineChannels {
  /** Ready to play. `editorOpen`: the plugin's own window is showing. `latency`: the samples it delays its sound by. */
  loaded: { channel: string; name: string; editorOpen: boolean; latency: number }[];
  /** Channel ids whose plugin is still being loaded. */
  loading: string[];
  /** Channels whose plugin couldn't be loaded (it isn't installed here, or it failed), and why. */
  failed: { channel: string; error: string }[];
}

/**
 * The mixer's meters: each track's loudest level on each side (0..1+, after its fader) since the engine
 * last said, by track id. Tracks that were silent are left out.
 */
export type EngineMeters = Record<string, [number, number]>;

/** The effects in the song's mixer, as the engine has them (by effect id, `MixerEffect.id`). */
export interface EngineEffects {
  /** Ready to run. `editorOpen`: the plugin's own window is showing. `latency`: the samples it delays its sound by. */
  loaded: { effect: string; name: string; editorOpen: boolean; latency: number }[];
  /** Effect ids whose plugin is still being loaded. */
  loading: string[];
  /** Effects whose plugin couldn't be loaded, and why. */
  failed: { effect: string; error: string }[];
}

export interface EngineTransport {
  playing: boolean;
  /** Where the loop is, in ticks from its start (what the engine is computing: it's heard `outputLatencyMs` later). */
  tick: number;
}

/**
 * A key pressed in a plugin's window that the plugin didn't use, named as the page names keys: the app
 * runs its shortcut (Space plays, as in FL Studio). Only the keys shortcuts use are sent.
 */
export interface EngineKey {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * What the engine says on its own (`GET /api/engine/events`): where the song is, about 25 times a
 * second while it plays or anything sounds; its status when that changes by itself (a scan ending, a
 * plugin's window closed by hand); a key pressed in a plugin's window; and that it has (re)started.
 */
export type EngineEvent =
  | ({ event: "transport"; peak: number; meters: EngineMeters; cpu: number } & EngineTransport)
  | { event: "status"; status: EngineStatus }
  | ({ event: "key" } & EngineKey)
  | { event: "ready" };

/**
 * The desktop app's window, which it tells the engine about whenever it changes, so plugin windows act
 * as if they were part of it: floating above it while it (or they) are in use, hidden while another app
 * is or it's minimised, moving along with it (`docs/fl-studio/plugin-window.md`).
 */
export interface HostWindow {
  /** It's the window in front (it has the focus). */
  active: boolean;
  /** Neither minimised nor hidden. */
  visible: boolean;
  /** Where it is on the screen, in points. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** The song to play (`POST /api/engine/song`): the tab's copy of the document, saved or not. */
export interface SetSongRequest {
  projectId: string;
  song: MusicProject;
  /** The pattern to loop (default: the first). */
  patternId: string | null;
  /** Only this part of it, in ticks (the Piano roll's time selection). */
  loop?: { start: number; end: number } | null;
}

export interface SetSongResponse {
  /** Channels whose sample the engine couldn't read (they're silent). */
  unreadable: string[];
  channels: EngineChannels;
  effects: EngineEffects;
  /** What plays, in the pattern's ticks: from `start`, `ticks` long, round and round. The engine's ticks count from `start`. */
  loop: { start: number; ticks: number };
}

/** The audio device and what it could be instead (`GET` and `POST /api/engine/devices`). */
export interface EngineDevices {
  outputs: string[];
  output: string | null;
  bufferSizes: number[];
  sampleRates: number[];
  status: EngineStatus;
}

export interface SetDeviceRequest {
  output?: string;
  bufferSize?: number;
  sampleRate?: number;
}

/** What an offline engine computed: `frames` samples, measured over both channels. */
export interface EngineRender {
  frames: number;
  sampleRate: number;
  peak: number;
  rms: number;
  /** Each mixer track's loudest level over these samples. */
  meters: EngineMeters;
  transport: EngineTransport & { metronome: boolean };
}

/** What `POST /api/engine/<command>` takes. Every command answers with the `EngineStatus`. */
export interface EngineCommands {
  status: Record<string, never>;
  /** Play the song from `from` ticks into its loop, or its start (nothing happens if it's playing); or stop and go back to the start. */
  play: { from?: number };
  stop: Record<string, never>;
  metronome: { on: boolean };
  /** Play a channel's sample once, now. `pitch` is semitones from its own pitch, `velocity` 0..1. */
  trigger: { channel: string; pitch?: number; velocity?: number };
  /**
   * A key held on a channel (the Piano roll's keyboard, a note being drawn): `on` starts it and, for a
   * plugin, it sounds until it's turned off. `key` is a MIDI note.
   */
  preview: { channel: string; key: number; on: boolean; velocity?: number };
  /** Show or close the window of a plugin channel's plugin. */
  channelEditor: { channel: string; open: boolean };
  /** Show or close the window of an effect in the mixer (by `MixerEffect.id`). */
  effectEditor: { effect: string; open: boolean };
  /** Play a test tone (through the effect). */
  tone: { on: boolean };
  /** Look for plugins; the status says how far along it is. `rescan` forgets the known ones first. */
  scan: { rescan?: boolean };
  load: { slot: EngineSlot; pluginId: string };
  unload: { slot: EngineSlot };
  /** Show or close a plugin's own window. */
  editor: { slot: EngineSlot; open: boolean };
  /** `pitch` is a MIDI note (60 = middle C), `velocity` 0..1. */
  note: { pitch: number; on: boolean; velocity?: number };
  saveState: { slot: EngineSlot };
  restoreState: { slot: EngineSlot };
}

export type EngineCommand = keyof EngineCommands;
