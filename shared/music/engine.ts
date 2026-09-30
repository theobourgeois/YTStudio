/**
 * The audio engine as the tab sees it (`/api/engine`). The engine is a native program (`engine/`) the
 * server runs: it owns the audio device and hosts the plugins (VST3, Audio Units), which no browser
 * can load. For now it's a spike: one instrument into one effect, played by hand.
 *
 * The server and the engine exchange one JSON object per line: `{ id, cmd, ...params }` in, and
 * `{ id, ok: true, result }` or `{ id, ok: false, error }` out, plus `{ event, status }` on its own.
 */

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
  /** From a note reaching the engine to its sound leaving the device, at worst. */
  outputLatencyMs: number;
  tone: boolean;
  /** The loudest output sample (0..1+) since the status was last asked for. */
  peak: number;
  /** A plugin scan in progress. */
  scanning: { progress: number; name: string } | null;
  pluginCount: number;
  instrument: LoadedPlugin | null;
  effect: LoadedPlugin | null;
}

/** What an offline engine computed: `frames` samples, measured over both channels. */
export interface EngineRender {
  frames: number;
  sampleRate: number;
  peak: number;
  rms: number;
}

/** What `POST /api/engine/<command>` takes. Every command answers with the `EngineStatus`. */
export interface EngineCommands {
  status: Record<string, never>;
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
