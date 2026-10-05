/**
 * The audio engine as the tab sees it (`/api/engine`). The engine is a native program (`engine/`) the
 * server runs: it owns the audio device and hosts the plugins (VST3, Audio Units), which no browser
 * can load. It plays the open song (one pattern, looped: `compile.ts`), and has a test bench for
 * plugins: one instrument into one effect, played by hand.
 *
 * The server and the engine exchange one JSON object per line: `{ id, cmd, ...params }` in, and
 * `{ id, ok: true, result }` or `{ id, ok: false, error }` out, plus events on its own (`EngineEvent`).
 */
import type { PlayMode } from "./compile.ts";
import type { MediaAsset } from "../types.ts";
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
  /** Its kind of driver ("ASIO", "Windows Audio", "CoreAudio"...), or null offline. Older engines say nothing. */
  deviceType?: string | null;
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
  /** The input device's name (recording), or null when none is open. */
  input: string | null;
  /** How many of its input channels are open (all of them, when there's one). */
  inputChannels: number;
  /** From a sound reaching the input device to the engine, as the device reports it. */
  inputLatencyMs: number;
  /** A recording in progress (the `record` command), or null. */
  recording: { id: string } | null;
  /**
   * The engine was built before its source last changed (a checkout's: run `pnpm engine:build`, then
   * restart `pnpm dev`, or what the app asks of it may be missing). Absent otherwise.
   */
  outdated?: boolean;
  /** Samples the song's sound comes out late by: its plugins' delays, compensated so everything lines up (`Song::compensate`). */
  songLatency: number;
  tone: boolean;
  /** The output's level (0..1+), falling back slowly: a meter. */
  peak: number;
  transport: EngineTransport & { metronome: boolean };
  /** An export rendering (playback stops meanwhile): samples of the song written, out of `frames`. */
  exporting?: { id: string; done: number; frames: number } | null;
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

/** The meter of the selected tracks' sound added up (`meterTracks`), among `EngineMeters`. */
export const SELECTION_METER = "@selection";

/** The effects in the song's mixer, as the engine has them (by effect id, `MixerEffect.id`). */
export interface EngineEffects {
  /**
   * Ready to run. `editorOpen`: the plugin's own window is showing. `latency`: the samples it delays its sound
   * by. `sidechain`: it has a sidechain input, which hears its slot's key (`docs/sidechain.md`).
   */
  loaded: { effect: string; name: string; editorOpen: boolean; latency: number; sidechain?: boolean }[];
  /** Effect ids whose plugin is still being loaded. */
  loading: string[];
  /** Effects whose plugin couldn't be loaded, and why. */
  failed: { effect: string; error: string }[];
}

export interface EngineTransport {
  playing: boolean;
  /** Where the loop is, in ticks from its start (what the engine is computing: it's heard `outputLatencyMs` later). */
  tick: number;
  /** Seconds of count-in left before a recording's play moves (the transport holds at `tick` meanwhile); 0 or absent: none. */
  countIn?: number;
  /** The Browser's preview playing, if one is (absent from engines that don't say). */
  preview?: EnginePreview | null;
  /** Each Gross Beat in the song (by effect id): what it's playing (absent from engines that don't say). */
  grossBeats?: Record<string, EngineGrossState>;
  /** Each Auto-Tune in the song (by effect id): the pitches it heard and played lately (absent from engines that don't say). */
  autoTunes?: Record<string, EngineAutoTuneState>;
  /** Each EchoBoy in the song (by effect id): its levels in and out, for its LEDs (absent from engines that don't say). */
  echoBoys?: Record<string, EngineEchoLevels>;
  /** Each OTT in the song (by effect id): its bands' levels and gains, for its display (absent from engines that don't say). */
  otts?: Record<string, EngineOttState>;
  /** Each Pro-C in the song (by effect id): its levels and gain reduction since the last event, for its display (absent from engines that don't say). */
  proCs?: Record<string, EngineProCState>;
  /** Each Reverb in the song (by effect id): its meters, ducking and (watched: `verbWatch`) its tail's spectrum (absent from engines that don't say). */
  reverbs?: Record<string, EngineReverbState>;
  /** Each Pro-Q being watched (`eqWatch`), by effect id: its spectra and its dynamic bands (absent from engines that don't say). */
  eq?: Record<string, EngineEqState>;
  /** Each PanMan in the song (by effect id): where it's put the sound (absent from engines that don't say). */
  panMen?: Record<string, EnginePanState>;
  /** Each Pitch Wheel in the song (by effect id): where its wheels actually are, and its notes (absent from engines that don't say). */
  pitchWheels?: Record<string, EnginePitchWheelState>;
  /** Each modulator's level now (0..1, by id: `docs/sidechain.md`), which linked controls show (absent from engines that don't say). */
  modulators?: Record<string, number>;
}

/**
 * What a Pitch Wheel is doing, as it's heard: each voice's actual pitch (semitones; its note, or -1 for
 * Single's voice when no note plays it), the Timbre wheel's actual shift, how loud what comes in is (0..1,
 * the input light) and whether notes are held (the MIDI light). `latency`: samples it comes out late by.
 */
export interface EnginePitchWheelState {
  latency: number;
  pitch: number;
  timbre: number;
  voices: { key: number; pitch: number }[];
  input: number;
  notes: number[];
}

/**
 * What an Auto-Tune heard and played lately: its latest pitch readings, oldest first, each
 * `[number, sung, tuned, target]` (MIDI notes, fractions are cents; -1 where there was no pitch), numbered
 * so a reading said twice is seen once, `step` seconds apart. `latency`: samples it looks ahead (its sound
 * is that much late, compensated).
 */
export interface EngineAutoTuneState {
  latency: number;
  step: number;
  points: [number, number, number, number][];
}

/** What an EchoBoy hears: the peaks (each side, 1 full scale, falling) into its echo and out of it. */
export interface EngineEchoLevels {
  input: [number, number];
  output: [number, number];
}

/**
 * What an OTT hears: each band's level (dB of its mean square, as its compressors hear it) and the gain
 * it gives it now (dB, its H / M / L gain in), low, mid, high; and the peaks in and out (falling).
 */
export interface EngineOttState {
  bands: { level: number; gain: number }[];
  input: [number, number];
  output: [number, number];
}

/**
 * What a Pro-C did since the last event: `points` of its level display (each `[input, output, reduction]`
 * in dB: a slice's peaks in and out, and its most reduction, a negative one a boost), every `step`
 * seconds, oldest first; and now: the reduction (dB), the key's level (dB, the Threshold's ring), the
 * level the gain computer hears (dB, the knee display's dot), the threshold it's at (Auto Threshold moves
 * it), the peaks in and out (each side, 1 full scale, falling), and its latency (samples). `match`: a
 * measured make-up (`compMatch`) as it goes, the loudness in and out (dB) and whether it's done.
 */
export interface EngineProCState {
  step: number;
  points: [number, number, number][];
  reduction: number;
  key: number;
  level: number;
  threshold: number;
  input: [number, number];
  output: [number, number];
  latency: number;
  match?: { input: number; output: number; done: boolean };
}

/**
 * What a Reverb is doing, for its window (`docs/reverb/reverb.md` 4.7): the peaks into it and out of its
 * wet sound (each side, 1 full scale, falling), the ducker's reduction (dB, ≤ 0), the key's level and the
 * threshold it ducks at (dB; Auto moves it), the de-esser's reduction (dB, ≥ 0), how much shorter
 * Auto-Decay has made the tail (×T60, 1: not), whether the loop's guard clipped, whether it's frozen,
 * and, while its window is open, the wet sound's spectrum (dB at `EQ_SPECTRUM_POINTS` log-spaced
 * frequencies, as Pro-Q's analyzer; null when nothing's come through since).
 */
export interface EngineReverbState {
  input: [number, number];
  output: [number, number];
  duck: number;
  key: number;
  threshold: number;
  deEss: number;
  decay: number;
  clip: boolean;
  frozen: boolean;
  spectrum?: number[] | null;
}

/**
 * What a watched Pro-Q hears: its spectra before and after it (dB at `EQ_SPECTRUM_POINTS` log-spaced
 * frequencies, a full-scale sine reading 0; null when nothing's come through since), its output's peak
 * per side, and each dynamic band (by number): how far its gain has moved now (dB) and the level of the
 * sound in its range (dB), which its threshold is set against.
 */
export interface EngineEqState {
  pre: number[] | null;
  post: number[] | null;
  peak: [number, number];
  bands: Record<string, { gain: number; level: number }>;
}

/**
 * What a PanMan is doing: the position it's heard at (degrees: ±90 hard left / right, ±105 beyond), the
 * least and most since the engine last said (the meter's trails), the input's and output's peaks since
 * (linear, after Input / Output), the level its Threshold or Trigger knob sees (dB), and its divider's count.
 */
export interface EnginePanState {
  position: number;
  least: number;
  most: number;
  input: number;
  output: number;
  level: number;
  count: number;
}

/**
 * What a Gross Beat is playing: its time and volume slots (0..35), the slot each kind will switch to at
 * its next sync point (null: none waiting), and where each envelope is, in ticks into its bar (0..384,
 * as computed: heard `outputLatencyMs` later). Its HOLD is on while `holding`.
 */
export interface EngineGrossState {
  time: number;
  volume: number;
  queuedTime: number | null;
  queuedVolume: number | null;
  timeTick: number;
  volumeTick: number;
  holding: boolean;
}

/** A file the Browser is previewing (`POST /api/browser/preview`), as far as the engine has played it. */
export interface EnginePreview {
  /** The tab's name for this preview (`PreviewFileRequest.id`). */
  id: string;
  /** Where it is in the file, in seconds (heard `outputLatencyMs` later). */
  seconds: number;
  /** The file's length, in seconds. */
  duration: number;
}

/** Hear one of a song's own media files on its own (`POST /api/engine/previewSample`): an audio clip's channel. */
export interface PreviewSampleRequest {
  projectId: string;
  sampleId: string;
  /** Its channel's gains (volume and pan, 0..4), heard as its clips are. Default: as it is. */
  gainLeft?: number;
  gainRight?: number;
  /** Read faster or slower, its pitch going with it (1: as it is). */
  speed?: number;
  /** Its channel's pitch, in semitones: higher or lower, its time kept, as its clips are. */
  transpose?: number;
  /** Seconds into the file (default: its start). */
  start?: number;
  /** The tab's name for it, given back in `EnginePreview.id`. */
  id?: string;
  /** Its channel's id: heard where its clips play, through its mixer track and its effects (default: straight out). */
  channel?: string;
}

/** Detect the tempo of one of a song's own media files (`POST /api/engine/tempo`): FL's TIME menu's Autodetect. */
export interface DetectTempoRequest {
  projectId: string;
  sampleId: string;
}

/** What was heard: the tempo (null when no steady beat was), how sure (0..1), and the file's length. */
export interface DetectedTempo {
  bpm: number | null;
  confidence: number;
  seconds: number;
}

/** Preview one of the Browser's files (`POST /api/browser/preview`), cutting off the last one. */
export interface PreviewFileRequest {
  path: string;
  /** Seconds into the file (default: its start). */
  start?: number;
  /** The tab's name for it, given back in `EnginePreview.id`. */
  id?: string;
}

/**
 * A key pressed in a plugin's window that the plugin didn't use, named as the page names keys: the app
 * runs its shortcut (Space plays, as in FL Studio). Only the keys shortcuts use are sent.
 */
export interface EngineKey {
  /** Native typing keys also send releases. Omitted by older engines: a press. */
  down?: boolean;
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** One of a plugin's parameters that can be automated (`GET /api/engine/parameters`). */
export interface EngineParameter {
  /** Its place in the plugin's list, and its id (`AutomationTarget.param`: what names it across versions). */
  index: number;
  id: string;
  name: string;
  /** Its value now, 0..1, and as the plugin says it ("2.4 kHz"). */
  value: number;
  text: string;
}

/**
 * A song's plugin's presets (`GET /api/engine/presets`, FL's preset browser): its own programs and the
 * one it's on (none and -1 for a plugin with a single program: most VST3s keep their presets to
 * themselves), and the user's own presets for it (saved from it, the same in every song) and the one
 * last loaded or saved ("" for none).
 */
export interface PluginPresets {
  programs: string[];
  program: number;
  presets: string[];
  preset: string;
  /** Actual current patch metadata, including single-program plugins. */
  currentName?: string;
  category?: string;
}

/** What to do with a song's plugin's presets (`POST /api/engine/presets`): choose a program, or save, load or delete a preset of the user's. */
export type PresetRequest = { owner: "channel" | "effect"; id: string } & (
  | { action: "setProgram"; index: number }
  | { action: "savePreset" | "loadPreset" | "deletePreset"; name: string }
);

/** A parameter of a song's plugin (a plugin channel's, or a mixer effect's), as the engine names it. */
export interface PluginParameter {
  owner: "channel" | "effect";
  /** The channel's or the effect's id. */
  id: string;
  index: number;
  /** The parameter's id. */
  param: string;
  name: string;
  value: number;
  text: string;
}

/**
 * What the engine says on its own (`GET /api/engine/events`): where the song is, about 25 times a
 * second while it plays or anything sounds; its status when that changes by itself (a scan ending, a
 * plugin's window closed by hand); a key pressed in a plugin's window; a parameter touched in a plugin's
 * window ("touch"), or its Automate button pressed ("automate"); and that it has (re)started.
 */
export type EngineEvent =
  | ({
      event: "transport";
      peak: number;
      meters: EngineMeters;
      cpu: number;
      /**
       * A recording in progress: each recording track's input since the last event, its loudest sample
       * every 5 ms (an engine from before sent one level), for the take drawn as it grows.
       */
      recording?: { id: string; levels: Record<string, number[] | number> } | null;
    } & EngineTransport)
  | { event: "status"; status: EngineStatus }
  /**
   * The engine became the app in front (`on`: one of its plugin windows has the focus), or stopped being:
   * the desktop app stacks its own floating windows by it (`electron/floating.ts`).
   */
  | { event: "foreground"; on: boolean }
  /** A plugin's window became the active one (`owner`: "channel" or "effect"; `id` the channel's or effect's). */
  | { event: "editorFocus"; owner: "channel" | "effect"; id: string }
  | ({ event: "key" } & EngineKey)
  | ({ event: "touch" | "automate" } & PluginParameter)
  /**
   * A plugin's preset changed (its window's arrows, or a request): "preset". Its window's wrapper button
   * was pressed: "wrapper" (the tab shows the channel's settings).
   */
  | { event: "preset" | "wrapper"; owner: "channel" | "effect"; id: string }
  | EngineMidiEvent
  | EngineExportEvent
  | EngineTakeEvent
  | { event: "ready" }
  /** The engine's process ended without being asked to (a plugin crashed it): the next command starts it again. */
  | { event: "stopped" };

/**
 * A note played on a MIDI keyboard (or the typing keyboard, `midiIn`), as the engine played it: on the
 * channel it went to (null: none was selected), and where the song was (`tick`, the engine's: into the
 * loop; null while stopped; `counting`: in a recording's count-in, held where play starts).
 */
export interface MidiPlayed {
  channel: string | null;
  key: number;
  /** 0..1 (0 for a note off). */
  velocity: number;
  on: boolean;
  tick: number | null;
  counting: boolean;
  /** Times round the loop since play started. */
  pass: number;
}

/** What was played on MIDI keyboards since the engine last said (`docs/fl-studio/midi.md`). */
export interface EngineMidiEvent {
  event: "midi";
  notes: MidiPlayed[];
}

/** A MIDI input on this computer: listened to unless it's been turned off (`enabled`). `open`: it's being listened to now. */
export interface EngineMidiInput {
  id: string;
  name: string;
  enabled: boolean;
  open: boolean;
}

/** A file an export wrote (32-bit float WAV): the mix, or a mixer track's stem, by the track's id. */
export interface EngineExportFile {
  id: "mix" | (string & {});
  file: string;
  /** Its loudest sample (1 is full scale: louder clips once it's an integer format). */
  peak: number;
}

/** An export ended: written (`frames` samples at `sampleRate`, the plugins' `latency` trimmed off). */
export interface EngineExportDone {
  state: "done";
  frames: number;
  sampleRate: number;
  latency: number;
  /** How long it took. */
  seconds: number;
  files: EngineExportFile[];
  /** Channels and effects that weren't heard: their plugin or sample couldn't be had. */
  missing: string[];
}

/** How an export the engine is rendering is going (the `export` command): about ten a second, then how it ended. */
export type EngineExportEvent = { event: "export"; id: string } & (
  | { state: "rendering"; done: number; frames: number }
  | EngineExportDone
  | { state: "failed"; error: string; missing: string[] }
  | { state: "aborted"; missing: string[] }
);

/**
 * What the desktop app tells the engine about itself whenever it changes, so plugin windows act as
 * windows of its own, stacked among its floating ones (`docs/fl-studio/plugin-window.md`).
 */
export interface HostWindow {
  /**
   * The app is the one in use (one of its windows, or a plugin's, has the focus): its floating windows,
   * the plugins' too, are above the other apps' windows and stack among each other by use. Otherwise
   * they're ordinary windows, behind whatever app was switched to.
   */
  floating: boolean;
  /** The app's window isn't minimised or hidden: if it is, plugin windows hide with it. */
  visible: boolean;
  /** Where its window is on the screen, in points: plugin windows move when it does. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Windows: its HWND, as a decimal number: plugin windows belong to it (above it only, no taskbar button). */
  handle?: string;
}

/** The song to play (`POST /api/engine/song`): the tab's copy of the document, saved or not. */
/**
 * How samplers and audio clips are read between their samples, when they're pitched or at another
 * rate than the song (FL's Resampling): a straight line (cheap, faint whistles on bright sounds), a
 * curve through four samples (playback's default), or a windowed sinc that also filters out what
 * pitching up would alias (the export's default). None of them delays the sound.
 */
export const RESAMPLING = ["linear", "hermite", "sinc"] as const;
export type Resampling = (typeof RESAMPLING)[number];
export const RESAMPLING_NAMES: Record<Resampling, string> = { linear: "Linear", hermite: "Hermite (4-point)", sinc: "Sinc (32-point)" };
export const isResampling = (v: unknown): v is Resampling => RESAMPLING.includes(v as Resampling);

export interface SetSongRequest {
  projectId: string;
  song: MusicProject;
  /** The mixer tracks armed to record (the tab's state, not the song's): their inputs are heard and recorded as their monitoring says. */
  armed?: string[];
  /** The master's Mono and Dim (the tab's, not the song's: `Listening`). */
  listening?: { mono?: boolean; dim?: boolean };
  /** The pattern to loop (default: the first). */
  patternId: string | null;
  /** Only this part of it, in ticks (the Piano roll's time selection, or in song mode the Playlist's). */
  loop?: { start: number; end: number } | null;
  /** The pattern, looped (the default), or the playlist (the toolbar's PAT / SONG). */
  mode?: PlayMode;
  /** How samples are read when pitched (default: Hermite). Settings' choice for playback. */
  resampling?: Resampling;
  /**
   * Controls held by the hand (a knob being dragged), by `targetKey`: their automation is left out while
   * they're held, so the hand wins (`docs/fl-studio/automation.md`).
   */
  held?: string[];
}

export interface SetSongResponse {
  /** Channels whose sample the engine couldn't read (they're silent). */
  unreadable: string[];
  channels: EngineChannels;
  effects: EngineEffects;
  /** What plays, in the pattern's ticks (the song's, in song mode): from `start`, `ticks` long, round and round. The engine's ticks count from `start`. */
  loop: { start: number; ticks: number };
}

/**
 * Copy plugins' settings files beside a project (`POST /api/engine/states/copy`): what's turned in each
 * plugin's window is saved first, then `from`'s file becomes `to`'s (a channel's or an effect's id), so a
 * copy of a plugin (a track's effects pasted onto another) starts as the original is now.
 */
export interface CopyStatesRequest {
  projectId: string;
  copies: { from: string; to: string }[];
}

/** The audio device and what it could be instead (`GET` and `POST /api/engine/devices`). */
export interface EngineDevices {
  /** The kinds of driver this computer has ("ASIO", "Windows Audio"...: FL's Device list groups them), and the one in use. */
  types?: string[];
  type?: string | null;
  /** Inputs and outputs are separate devices (false for ASIO: a driver is chosen whole, its inputs with it). */
  separateInputs?: boolean;
  /** The device has a settings panel of its own (an ASIO driver's: buffer, clock), opened by `deviceControlPanel`. */
  controlPanel?: boolean;
  /** Added to the latency recordings leave out, in ms: what the driver doesn't report (`SetDeviceRequest.recordOffsetMs`). */
  recordOffsetMs?: number;
  outputs: string[];
  output: string | null;
  /** The input devices (recording), and the one open, or null for none. */
  inputs: string[];
  input: string | null;
  /** The open input device's channels' names, by number ("In 1", or the interface's own names). */
  inputChannels: string[];
  bufferSizes: number[];
  sampleRates: number[];
  /** MIDI keyboards (none from an offline engine). */
  midiInputs: EngineMidiInput[];
  status: EngineStatus;
}

export interface SetDeviceRequest {
  /** Another kind of driver (one of `EngineDevices.types`): its best device opens. */
  type?: string;
  output?: string;
  /** The input device to open (all its channels), or "" to close it. Opening one asks for the microphone. */
  input?: string;
  bufferSize?: number;
  sampleRate?: number;
  /** Listen to a MIDI input (by name) or not; remembered by the engine. */
  midiInput?: { name: string; enabled: boolean };
  /**
   * Recordings land this many ms earlier (negative: later) than the device's reported latency puts
   * them, -500..500: what a driver doesn't report (Ableton's Driver Error Compensation).
   */
  recordOffsetMs?: number;
}

/**
 * Record (`POST /api/engine/record`): play from `from` (ticks into the loop, as `play`) and record each
 * mixer track armed in the song last sent, dry, a file per track (and per pass round the loop, with
 * `loop`), after `countIn` ticks of the metronome's clicks. Without `loop`, play goes on past the end
 * of the loop until it's stopped. `names`: what to call each track's takes (the track's name).
 */
export interface RecordRequest {
  /** Punch in at the audio thread's current position without restarting playback. */
  continuePlayback?: boolean;
  projectId: string;
  from: number;
  countIn: number;
  loop: boolean;
  names: Record<string, string>;
  /** Notes are recorded too (the tab keeps them from `midi` events): with no armed track, only they are. */
  notes?: boolean;
}

export interface RecordResponse {
  recordingId: string;
  status: EngineStatus;
}

/**
 * A take recorded (one armed track's file, for one pass round the loop with Loop record), made the
 * project's media. Sample `skip` of the file is at `startTick` (the engine's ticks: into the loop): what
 * came before it is the device's and the song's latency, to leave out. `final`: the last of its
 * recording (play stopped). `media` is null if it couldn't be kept (`error` says why).
 */
export interface EngineTakeEvent {
  event: "take";
  recordingId: string;
  projectId: string;
  track: string;
  media: MediaAsset | null;
  error?: string;
  startTick: number;
  skip: number;
  frames: number;
  sampleRate: number;
  pass: number;
  final: boolean;
}

/** What an offline engine computed: `frames` samples, measured over both channels. */
export interface EngineRender {
  frames: number;
  sampleRate: number;
  peak: number;
  rms: number;
  /** A recording's tracks' peaks since the last render: their loudest sample every 5 ms, by track id. */
  levels?: Record<string, number[]>;
  /** Each mixer track's loudest level over these samples. */
  meters: EngineMeters;
  /** The watched Pro-Qs' state after these samples (`EngineEqState`, by effect id). */
  eq?: Record<string, EngineEqState>;
  transport: EngineTransport & { metronome: boolean };
}

/** The metronome's sounds (its right-click menu), each made by the engine; the bar's first beat is higher or louder. */
export const METRONOME_SOUNDS = [
  { id: "beep", name: "Beep" },
  { id: "tick", name: "Tick" },
  { id: "tap", name: "Tap" },
  { id: "hihat", name: "Hi-hat" },
  { id: "cowbell", name: "Cowbell" },
] as const;
export type MetronomeSound = (typeof METRONOME_SOUNDS)[number]["id"];
export const DEFAULT_METRONOME_SOUND: MetronomeSound = "beep";
export const isMetronomeSound = (value: unknown): value is MetronomeSound => METRONOME_SOUNDS.some((s) => s.id === value);

/** What `POST /api/engine/<command>` takes. Every command answers with the `EngineStatus`. */
export interface EngineCommands {
  status: Record<string, never>;
  /** Play the song from `from` ticks into its loop, or its start (nothing happens if it's playing); or stop and go back to the start. */
  play: { from?: number };
  /**
   * Stop. `reset`: every sound stops, the effects' tails too (FL's Stop pressed while stopped): each plugin
   * is reset and our effects (EchoBoy's lines, Gross Beat's buffer...) start again from silence.
   */
  stop: { reset?: boolean };
  /** The metronome on or off, in `sound` (default: the one it has). `audition`: one click of it now (a bar's), playing or not. */
  metronome: { on: boolean; sound?: MetronomeSound; audition?: boolean };
  /** Stop the Browser's preview (it's started by `POST /api/browser/preview`, which checks the file). */
  stopPreview: Record<string, never>;
  /** The Browser's preview volume, 0..1, at once. */
  previewVolume: { volume: number };
  /** Play a channel's sample once, now. `pitch` is semitones from its own pitch, `velocity` 0..1. */
  trigger: { channel: string; pitch?: number; velocity?: number };
  /**
   * A key held on a channel (the Piano roll's keyboard, a note being drawn): `on` starts it and, for a
   * plugin, it sounds until it's turned off. `key` is a MIDI note.
   */
  preview: { channel: string; key: number; on: boolean; velocity?: number };
  /** The channel MIDI keyboards play (the rack's selected one), or none. */
  midiTarget: { channel: string | null };
  typingKeyboard: { on: boolean };
  /**
   * MIDI messages as a keyboard would send them (a status byte, then its data: `[0x90, 60, 100]` is a
   * middle C): played on the MIDI target and told back in `midi` events. The typing keyboard's notes.
   */
  midiIn: { messages: number[][] };
  /** A plugin's window in front of the other windows, without the keyboard (the app puts its windows back in order). */
  raiseEditor: { owner: "channel" | "effect"; target: string };
  /** Show or close the window of a plugin channel's plugin. */
  channelEditor: { channel: string; open: boolean };
  /** Show or close the window of an effect in the mixer (by `MixerEffect.id`). */
  effectEditor: { effect: string; open: boolean };
  /**
   * A Gross Beat's live controls, held by the hand (not the song's): HOLD (`hold`: the bar repeat, while
   * it's true) and the scratching clock (`scratch`: an offset in beats, 0 down to -8, added to the time
   * envelope's; 0 lets go).
   */
  grossBeat: { effect: string; hold?: boolean; scratch?: number };
  /** A PanMan's Manual Trigger (`trigger`: a trigger now, if the sound is under its Trigger's level). Live, not the song's. */
  panMan: { effect: string; trigger?: boolean };
  /**
   * The Pro-Qs whose sound the engine measures (their windows are open, or another's shows their
   * spectrum): each with its analyzer's FFT length. The rest aren't measured.
   */
  eqWatch: { effects: { effect: string; size: number }[] };
  /**
   * A Pro-Q band soloed while its solo button is held (null lets go): only the part of the sound it works
   * on is heard, `gain` dB louder or softer (the solo's listening level).
   */
  eqSolo: { effect: string; band: number | null; gain?: number };
  /**
   * A Pro-C's listening (live, never in a song or an export): `key` plays its side chain as the detector
   * hears it (after its EQ and link), `triggering` what the compression takes away; `off` lets go.
   */
  compAudition: { effect: string; mode: "off" | "key" | "triggering" };
  /** Measure a Pro-C's loudness in and out while it plays, for `seconds` (Match: the tab sets Wet Gain from it). */
  compMatch: { effect: string; seconds: number };
  /** The Reverbs whose windows are open: their wet sound is measured for the Decay display's analyzer (Pro-Q's FFT, `size` long). */
  verbWatch: { effects: { effect: string; size: number }[] };
  /**
   * A Reverb's live controls (never in the song or an export): Freeze held (momentary: F, or Alt-click),
   * Kill held (its input muted, the tail heard), or a click played through it (`audition`, the Shape
   * display's double-click).
   */
  verb: { effect: string; freeze?: boolean; kill?: boolean; audition?: boolean };
  /**
   * A Pitch Wheel's live controls, held by the hand (the song has the wheels where they're let go):
   * `pitch` and `timbre` hold a wheel's pointer (semitones, snapped) for a quarter of a second (renewed
   * while it's held); `jump` puts the actual pitch on it at once (a typed value); `key` with `on` plays or
   * lets go a note of its keyboard.
   */
  pitchWheel: { effect: string; pitch?: number; timbre?: number; jump?: boolean; key?: number; on?: boolean };
  /**
   * The tracks the mixer's selection meter adds up (the selected ones, by id): their sound after their
   * faders, together, is measured as the meter "@selection" (`EngineMeters`).
   */
  meterTracks: { tracks: string[] };
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
