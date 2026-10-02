/**
 * The music suite's document (a DAW project), modelled on FL Studio: the channel rack's channels
 * (instruments), patterns (notes for any of the channels), the playlist (the song's arrangement: clips
 * of patterns, audio and automation on tracks), the mixer (where the channels' sound goes) and the
 * automation clips (curves for controls over the song).
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
  /**
   * 0..1: the main volume, FL Studio's knob in the toolbar: everything the song puts out, after the
   * master track (`DEFAULT_VOLUME` leaves it as it is).
   */
  volume: number;
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
 * beside the project: `server/music/engine.ts`). An audio clip channel (`audio`, FL's "Audio clip")
 * is a file the playlist's audio clips play, streamed from disk: it has no notes, and the rack keeps it
 * in its Audio group.
 */
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
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
  /** The mixer track it plays into (a `MixerTrack` id): the master unless routed elsewhere. */
  mixerTrack: string;
  /** "#rrggbb", or null for the usual: an audio clip channel's clips take it (FL's Rename and recolor). */
  color: string | null;
}

export type ChannelKind = "sampler" | "plugin" | "audio";

export interface Note {
  /** Tells it from the channel's other notes in the pattern (a small whole number): what's selected is a set of these. */
  id: number;
  /** Ticks from the pattern's start. */
  start: number;
  /** Ticks. */
  length: number;
  /** A MIDI note; `ROOT_PITCH` is the sample's own pitch. */
  pitch: number;
  /** 0..1; `DEFAULT_VELOCITY` plays the sample as it is. */
  velocity: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  /** Kept, but not played (the Piano roll's mute tool). */
  muted: boolean;
}

/** Notes for any of the channels, looped while it plays. */
export interface Pattern {
  id: string;
  name: string;
  /**
   * Its length in steps (sixteenth notes), or null for FL Studio's Auto: a bar, or up to the end of
   * the two bars the last note sounds in (`patternSteps`). A set length is the least it is: notes past it take the pattern to
   * the end of their bar, as in FL Studio.
   */
  length: number | null;
  /** Each channel's notes (by channel id), in order of `start`. Channels without notes are absent. */
  notes: Record<string, Note[]>;
  /** "#rrggbb", or null for the usual: its clips in the Playlist take it, as in FL Studio. */
  color: string | null;
}

/**
 * An effect in a mixer track's slot: an effect plugin, or one of ours, whose settings are in the song
 * (Gross Beat: its `plugin` is `GROSS_BEAT_PLUGIN` and its settings `grossBeat`; Auto-Tune:
 * `AUTO_TUNE_PLUGIN` and `autoTune`).
 */
export interface MixerEffect {
  /** Names its settings' file beside the project (`plugins/<id>.bin`), as a plugin channel's id does. */
  id: string;
  plugin: PluginRef;
  /** Off, it's bypassed: the plugin stays loaded and the sound goes past it untouched. */
  enabled: boolean;
  /** 0..1: how much of the effect's sound is heard against the sound coming in (FL's slot mix knob). */
  mix: number;
  /** Gross Beat's settings, on a Gross Beat (absent on a plugin). */
  grossBeat?: GrossBeat;
  /** Auto-Tune's settings, on an Auto-Tune (absent on a plugin). */
  autoTune?: AutoTune;
}

/**
 * Auto-Tune's Input Type (`docs/antares/auto-tune.md`): the voice's range, which is where it listens for a
 * pitch (and, the lower it reaches, the more it looks ahead: its latency).
 */
export const AUTO_TUNE_INPUTS = ["soprano", "altoTenor", "lowMale", "instrument", "bass"] as const;
export type AutoTuneInput = (typeof AUTO_TUNE_INPUTS)[number];
/** Auto-Tune Pro's scales (its "modern" set). */
export const AUTO_TUNE_SCALES = [
  "chromatic",
  "major",
  "minor",
  "harmonicMinor",
  "melodicMinor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "majorPentatonic",
  "minorPentatonic",
  "blues",
  "wholeTone",
  "diminished",
] as const;
export type AutoTuneScale = (typeof AUTO_TUNE_SCALES)[number];
/** A note of the scale: tuned to (On), passed as it's sung (Bypass), or never a target (Remove). */
export type AutoTuneNote = "tune" | "bypass" | "remove";
export const VIBRATO_SHAPES = ["none", "sine", "square", "saw"] as const;
export type VibratoShape = (typeof VIBRATO_SHAPES)[number];

/** Auto-Tune's Create Vibrato: a vibrato it adds to the tuned note, started again on each new note. */
export interface AutoTuneVibrato {
  shape: VibratoShape;
  /** Hz, 0.1..10. */
  rate: number;
  /** Milliseconds from the note's start before it begins (Onset Delay), and to come in fully (Onset Rate): 0..1500. */
  delay: number;
  onset: number;
  /** 0..1: how much its rate and depth wander, note to note. */
  variation: number;
  /** Cents, 0..100: its depth (Pitch Amount). */
  pitch: number;
  /** 0..0.3: how much its level moves with it (Amplitude Amount). */
  amplitude: number;
  /** 0..1: how much its formants move with it (Formant Amount). */
  formant: number;
}

/** Auto-Tune's settings (Antares Auto-Tune Pro's Auto mode). */
export interface AutoTune {
  input: AutoTuneInput;
  /** The scale's first note, 0 (C) .. 11 (B). */
  key: number;
  scale: AutoTuneScale;
  /** Each pitch class's note (C first): the scale's, as `key` and `scale` make it, until edited. */
  notes: AutoTuneNote[];
  /** Cents, -100..100: the tuning's reference moved from A4 = 440 Hz (Detune). */
  detune: number;
  /** Milliseconds, 0..400: how long a note takes to be pulled to its target; 0 is instant (the hard-tuned sound). */
  retuneSpeed: number;
  /** 0..1: Retune Speed slowed on the sustain of long notes, so short ones snap and long ones keep their life. */
  humanize: number;
  /** 0..1: only what's sung near a note is tuned; 0 tunes everything. */
  flexTune: number;
  /** dB, -12..12: the singer's own vibrato made narrower or wider. */
  naturalVibrato: number;
  /** 0..1: how unclear a pitch may be and still be tracked, from Choosy (0) to Relaxed (1). */
  tracking: number;
  /** Semitones, -12..12, added to the tuned note. */
  transpose: number;
  /** The voice's formants kept where they are when its pitch moves (off, they move with it). */
  formant: boolean;
  /** 0.5..1.8: the throat modelled longer (deeper, above 1) or shorter (brighter); with Formant on. */
  throat: number;
  /** The Auto-Tune 5 sound: sharper between notes; Formant, Throat, Transpose and Flex-Tune are off. */
  classic: boolean;
  /** The target is chosen from the sung pitch's centre, so a wide vibrato doesn't switch notes. */
  ignoreVibrato: boolean;
  vibrato: AutoTuneVibrato;
}

/**
 * A Gross Beat slot (`docs/fl-studio/gross-beat.md`): an envelope a bar long (`GROSS_TICKS`, 4 beats) that
 * repeats while it plays. A time slot's values say where the sound is read from: 1 is now, 0 is
 * `GROSS_DEPTH` beats back. A volume slot's are its level: 1 full, 0 silent.
 */
export interface GrossBeatSlot {
  name: string;
  /** As an automation clip's (the same curve types): in order of `tick`, the first at 0. */
  points: AutomationPoint[];
}

/** What Gross Beat's HOLD button repeats: nothing, the bar just played, or the next bar. */
export type GrossHold = "off" | "last" | "next";

/** Gross Beat's settings: which slots play, its knobs and options, and its slots that aren't their presets. */
export interface GrossBeat {
  /** The time and volume slots picked (0..`GROSS_SLOTS` - 1): what plays, and what the panel edits. */
  timeSlot: number;
  volumeSlot: number;
  /** 0..1: how much of each envelope is used (FL's Time and Volume knobs). */
  timeMix: number;
  volumeMix: number;
  /** Seconds the volume takes to rise (0..0.5) and to fall (0..1): smoothing its envelope (ATT, REL). */
  attack: number;
  release: number;
  /** -1..1: how that smoothing bends (TNS). */
  tension: number;
  /** Each slot changed from its preset, by number; null is its preset (`GROSS_TIME_PRESETS`...). */
  time: (GrossBeatSlot | null)[];
  volume: (GrossBeatSlot | null)[];
  /** Picking a time slot picks the volume slot of the same number, and back. */
  linkSlots: boolean;
  /** A slot plays once (a bar), then slot 1 plays. */
  oneShot: boolean;
  hold: GrossHold;
  /** Beats: a slot picked while playing starts on the next multiple of it (0: at once). */
  trigSync: number;
  /** Beats: where in its envelope it starts is where the song is inside this length (0: its start). */
  posSync: number;
  /** A jump fades across (FL's Click reduction). */
  clickReduction: boolean;
  /** What's played after a jump is read the attack time earlier, so its start isn't lost under the smoothing. */
  attackCompensation: boolean;
  removeDc: boolean;
  /** Sinc rather than Hermite reading between samples (FL's HQ resampling). */
  hq: boolean;
}

export type MixerDock = "left" | "middle" | "right";

/** A mixer track sending its sound (after its fader) to another. */
export interface MixerSend {
  /** The track it goes to. */
  to: string;
  /** 0..1, as a knob: 1 sends it as it is. At 0 the link is kept but silent (FL's sidechain-only send). */
  level: number;
}

/**
 * A track of the mixer, FL Studio's: channels play into it, then its sound goes through its effects,
 * its fader and pan, and on to the tracks it sends to.
 */
export interface MixerTrack {
  id: string;
  /** Null until it's renamed: then it's called by its number ("Insert 3"), as in FL Studio. */
  name: string | null;
  /** Its colour ("#rrggbb", one of `TRACK_COLORS` from the menu), or null for none. */
  color: string | null;
  /**
   * Which of the mixer's docks it's shown in (FL Studio's): the left and right ones stay where they are
   * while the middle one scrolls. Its number doesn't change. The master is always on the left.
   */
  dock: MixerDock;
  /** A divider before it (FL's Separator), to set tracks apart. */
  separator: boolean;
  /** The group it's in (`Mixer.groups`), or null. */
  group: string | null;
  /** 0..1, the fader; `DEFAULT_FADER` leaves the sound as it is. */
  volume: number;
  /** -1 (left) .. 1 (right). */
  pan: number;
  muted: boolean;
  /** Its sound's sign flipped (FL's invert phase): a kick recorded out of phase with another, say. */
  invert: boolean;
  /** Its left and right swapped. */
  swap: boolean;
  /**
   * FL's stereo separation, -1..1: 0 leaves it as it is, towards 1 narrows it to mono, towards -1
   * widens it (the difference between the sides is raised, up to twice).
   */
  stereo: number;
  /**
   * Milliseconds added to the delay its plugins report, for one that reports it wrong (FL's manual
   * delay compensation): positive when its sound is later than they say (the other tracks wait for
   * it), negative when it's earlier (it waits for them).
   */
  latencyOffset: number;
  /**
   * The audio device's input it takes (FL's Input), recorded when the track is armed: null for none. The
   * master never has one (it gets everything: what it recorded would be the whole song).
   */
  input: MixerInput | null;
  /** When its input is heard, through its effects and on (FL's Monitor external input). */
  monitor: InputMonitor;
  /**
   * Milliseconds a take recorded on it is moved earlier (FL's input delay compensation), for what the
   * device's reported latency doesn't account for; negative moves it later.
   */
  inputOffset: number;
  /** Its `EFFECT_SLOTS` slots, in the order the sound goes through them; null is an empty slot. */
  effects: (MixerEffect | null)[];
  /**
   * Where its sound goes: the master by default, any other tracks too, or nowhere. Never round in a
   * loop (the edits refuse one). The master sends nowhere: it's what's heard.
   */
  sends: MixerSend[];
}

/**
 * A mixer track's input on the audio device: input `channel` (0 is the device's first) heard on both
 * sides, or with `stereo` the pair from it (`channel` left, the next right). By number, so a song moved
 * to another device takes its inputs in the same places; one the device doesn't have is silent.
 */
export interface MixerInput {
  channel: number;
  stereo: boolean;
}

/** FL's Monitor external input: never, only while the track is armed (the default), or always. */
export type InputMonitor = "off" | "armed" | "on";

/** A named group of mixer tracks (FL's Create group): a band with its name across their tops, dividers at its edges. */
export interface MixerGroup {
  id: string;
  name: string;
}

export interface Mixer {
  /** The master first, then the insert tracks in their order (their numbers: 1, 2, 3...). */
  tracks: MixerTrack[];
  groups: MixerGroup[];
}

/**
 * A track of the playlist (FL Studio's): bound to nothing, so any clip goes on any track. Tracks are
 * numbered (`PlaylistClip.track` is the index); one that's never been touched has no entry
 * (`Playlist.tracks` is only as long as the last one that has been), and is `DEFAULT_PLAYLIST_TRACK`.
 */
export interface PlaylistTrack {
  /** Null until it's renamed: it's then called by its number ("Track 3"), as in FL Studio. */
  name: string | null;
  /** "#rrggbb", or null for the playlist's own colour. */
  color: string | null;
  /** Its height, as a share of the tracks' height (FL's track Size): 1 is the usual. */
  size: number;
  /** Every clip on it is silent (a clip's own mute is separate). Solo is a state of these, as for channels. */
  muted: boolean;
  /**
   * The mixer track it's linked to (FL's Track mode → Audio track), by id, or null: that track's input
   * and arm show on its header, and what it records lands on it.
   */
  mixerTrack: string | null;
}

export type PlaylistClipKind = "pattern" | "audio" | "automation";

/**
 * A clip on the playlist: a window onto a pattern, an audio file or an automation clip's curve, placed at `start` on a track. Its
 * content starts `offset` before its window (a clip resized from the left, sliced or slip-edited shows a
 * later part of it); what's outside the window is still there, and comes back when it's widened.
 */
export interface PlaylistClip {
  /** Tells it from the other clips (a small whole number, as notes have): what's selected is a set of these. */
  id: number;
  kind: PlaylistClipKind;
  /** The pattern's id, the audio clip channel's id, or the automation clip's (`Automation.id`). */
  ref: string;
  /** The track's number (0 is the first). */
  track: number;
  /** Ticks, in the song. */
  start: number;
  /**
   * Ticks. Null for a pattern clip that's as long as its pattern (from `offset` to its end), as FL
   * Studio's are until they're resized: it follows the pattern as it grows and shrinks. An automation
   * clip follows its curve's length the same way.
   */
  length: number | null;
  /** How far into its content the window starts: ticks of the pattern or the curve, or seconds of the audio file. */
  offset: number;
  /** Kept, but not played (the playlist's mute tool). */
  muted: boolean;
}

/** The song's arrangement: what plays in song mode. */
export interface Playlist {
  /** By number; past the end of the list, tracks are as new. */
  tracks: PlaylistTrack[];
  /** In order of `start` (then track, then id). */
  clips: PlaylistClip[];
}

/**
 * The control an automation clip drives (`docs/fl-studio/automation.md`): a channel's volume or pan, a
 * mixer track's fader, pan or stereo separation, a send's level, an effect slot's mix, the main volume,
 * or one of a plugin's own parameters (a plugin channel's instrument's, or an effect's).
 */
export type AutomationTarget =
  | { kind: "channel"; channel: string; control: "volume" | "pan" }
  | { kind: "mixer"; track: string; control: "volume" | "pan" | "stereo" }
  | { kind: "send"; track: string; to: string }
  | { kind: "effect"; effect: string }
  | { kind: "grossBeat"; effect: string; control: GrossControl }
  | { kind: "autoTune"; effect: string; control: AutoTuneControl }
  | { kind: "main" }
  | {
      kind: "plugin";
      /** Whose plugin: a plugin channel's (by channel id) or a mixer effect's (by effect id). */
      owner: "channel" | "effect";
      id: string;
      /** The parameter's id as the plugin gives it (it stays the same across versions), its index as a fallback, and its name to show. */
      param: string;
      index: number;
      name: string;
    };

/** Gross Beat's controls an automation clip can drive: the slots playing and the two mix knobs. */
export type GrossControl = "timeSlot" | "volumeSlot" | "timeMix" | "volumeMix";

/** Auto-Tune's controls an automation clip can drive (the key too, for a song that changes key). */
export const AUTO_TUNE_CONTROLS = ["retuneSpeed", "humanize", "flexTune", "naturalVibrato", "transpose", "throat", "key"] as const;
export type AutoTuneControl = (typeof AUTO_TUNE_CONTROLS)[number];

/** How a segment of an automation clip's curve goes from one point to the next: FL Studio's curve types. */
export const CURVE_TYPES = ["single", "double", "altSingle", "altDouble", "hold", "stairs", "smoothStairs", "pulse", "wave", "halfSine", "smooth"] as const;
export type CurveType = (typeof CURVE_TYPES)[number];

/** A point of an automation clip's curve. Its `curve` and `tension` shape the segment arriving at it (from the point before). */
export interface AutomationPoint {
  /** Ticks into the curve, whole. */
  tick: number;
  /** 0..1 of the clip's range (between its `min` and `max`). */
  value: number;
  /** -1..1: how the segment bends (or, for stairs, pulses and waves, how many steps or cycles it has). 0 is straight. */
  tension: number;
  curve: CurveType;
}

/** An automation clip's LFO (FL's): an oscillator added to its curve, or multiplying it, without changing its points. */
export interface AutomationLfo {
  enabled: boolean;
  /** Cycles per bar. */
  speed: number;
  /** -1..1: its shape, from peaky (-1) through a triangle-ish sine (0) to square (1). */
  tension: number;
  /** 0..1: where in its cycle it peaks; 0.5 is even, either end a saw. */
  skew: number;
  /** -1..1: how much of it there is (negative is upside down); 0 is none. */
  level: number;
  /** It scales the curve (for a one-sided control: volume) rather than adding to it (two-sided: pan). */
  multiply: boolean;
}

/**
 * An automation clip (FL Studio's): a curve over time for one control. Its clips on the playlist
 * (`PlaylistClip.kind: "automation"`) all play this curve, as a pattern's clips play its notes.
 */
export interface Automation {
  id: string;
  name: string;
  /** "#rrggbb", or null for the usual: its clips take it. */
  color: string | null;
  target: AutomationTarget;
  /** The curve's length, in ticks (its clips that follow it are as long). */
  length: number;
  /** In order of `tick`, at least one; the first is at 0. Past the last, the value stays. */
  points: AutomationPoint[];
  /** The part of the control's range its 0..1 covers (FL's Min / Max). */
  min: number;
  max: number;
  lfo: AutomationLfo;
}

export interface MusicProject {
  version: 1;
  name: string;
  settings: MusicSettings;
  /** In the channel rack's order. */
  channels: Channel[];
  /** Always at least one. */
  patterns: Pattern[];
  playlist: Playlist;
  mixer: Mixer;
  /** The automation clips, in the Picker's order. */
  automations: Automation[];
}
