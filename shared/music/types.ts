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
 * An effect in a mixer track's slot: an effect plugin, or one of ours (Gross Beat: its `plugin` is
 * `GROSS_BEAT_PLUGIN`, and its settings are `grossBeat`, in the song; PanMan likewise, `panMan`).
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
  /** PanMan's settings, on a PanMan (absent on a plugin). */
  panMan?: PanMan;
}

/** PanMan's modes (`docs/soundtoys/panman.md`): what moves the sound. */
export type PanManMode = "lfo" | "rhythmStep" | "rhythmShape" | "pingPong" | "random" | "step";
/** PanMan's Direction buttons: ◀ right to left (a ramp down), ◀▶ back and forth, ▶ left to right (a ramp up). */
export type PanDirection = "down" | "both" | "up";
/** The Rhythm Step Editor's Smoothing Mode: the shape of a move from one point to the next. */
export type PanCurve = "linear" | "sine" | "exp" | "sym" | "rev";
/** PanMan's Analog Style: its saturation. */
export type PanStyle = "clean" | "fat" | "squash" | "dirt" | "crunch" | "shred" | "pump";

/** A point of the Rhythm Step Editor: a tick of its bars, and a position, -1 (L) to 1 (R) of the Width around the Offset. */
export interface PanStepPoint {
  tick: number;
  value: number;
}

/** An event of the Rhythm Editor (Rhythm Shape): one cycle of the direction's shape, from `tick`, `length` ticks long. */
export interface PanShapeEvent {
  tick: number;
  length: number;
}

/**
 * PanMan's settings (`docs/soundtoys/panman.md`), Soundtoys' auto-panner, ours. Positions are degrees
 * (±90 hard left / right, ±105 beyond the speakers), levels dB, times seconds.
 */
export interface PanMan {
  /** The factory preset last chosen (`PANMAN_PRESETS` by name): the preset bar's name, what Revert goes back to. */
  preset: string;
  mode: PanManMode;
  /** -105..105: the base position. */
  offset: number;
  /** 0..210: how far around the offset it moves. */
  width: number;
  /** 0..1, Hard to Soft. */
  smoothing: number;
  /** -1..1: Rhythm Step's Rush to Drag (a 16th note either way). */
  feel: number;
  /** -1..1: Rhythm Shape's Shuffle to Swing (every second event, to a triplet). */
  groove: number;
  /** Hz, 0.01..10: the LFO's rate. */
  rate: number;
  direction: PanDirection;
  /** A rhythm's id (`PAN_RHYTHMS`): each step, event or random move lasts it. */
  rhythm: string;
  /** 2..16: Rhythm Step's positions before it repeats. */
  steps: number;
  /** The editor's pattern plays (Rhythm Step's points, Rhythm Shape's events) rather than the one the knobs make. */
  custom: boolean;
  /** In time with the song (the MIDI switch); off, at `tempo`. */
  sync: boolean;
  /** BPM (Tap Tempo), when not in time with the song. */
  tempo: number;
  /** dB, -40..0: PingPong's and Step's trigger level (0: the sound doesn't trigger). */
  trigger: number;
  /** 1..12: triggers to a move. */
  divider: number;
  /** The trigger's filter (what it listens to): its type, cutoff (Hz) and gain (dB); `monitor` plays it, unpanned. */
  filter: "hpf" | "off" | "lpf";
  cutoff: number;
  filterGain: number;
  monitor: boolean;
  /** The dynamics (LFO and the rhythms): threshold (dB), attack and release (s), Env or Gate, and how far the level moves the offset (degrees), width (degrees) and rate (octaves). */
  threshold: number;
  attack: number;
  release: number;
  gate: boolean;
  offsetMod: number;
  widthMod: number;
  rateMod: number;
  style: PanStyle;
  /** dB, -24..24. */
  input: number;
  output: number;
  /** The Rhythm Step Editor: its bars, their beats, its Smoothing Mode, and its points (sorted, one per tick). */
  stepPattern: { bars: number; beatsPerBar: number; curve: PanCurve; points: PanStepPoint[] };
  /** The Rhythm Editor (Rhythm Shape): its bars, their beats, and its events (sorted, not overlapping). */
  shapePattern: { bars: number; beatsPerBar: number; events: PanShapeEvent[] };
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
  | { kind: "panMan"; effect: string; control: PanControl }
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

/** PanMan's controls an automation clip can drive. */
export type PanControl = "offset" | "width" | "rate" | "input" | "output";

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
