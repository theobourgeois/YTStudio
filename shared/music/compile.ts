/**
 * A song as the audio engine plays it (`EngineSong`): one pattern looped (pattern mode), or the playlist
 * (song mode), with everything musical already decided here, in tested TypeScript: swing, mutes, what
 * volume, pan and velocity mean as gains, the arrangement flattened into notes on the song's time, and
 * the mixer's routing as an order to run its tracks in. The engine (`engine/src/Song.cpp`) only has to
 * play samples and audio clips at the right moments and add up tracks as it's told.
 */
import { type AutomationIndex, automationIndex, clipAtTick, controlAt, controlBreaks, controlOf, isAutomated, placedValue, targetKey } from "./automation.ts";
import { modulatedFraction, modulationIndex } from "./modulation.ts";
import { clipContext, clipLength, songTicks, trackAt } from "./playlist.ts";
import { audioPlayback } from "./stretch.ts";
import { LANE_FINEST, sampleLane } from "./sampling.ts";
import { type TempoMap, engineTick, tempoMap } from "./tempo.ts";
import { type EngineAutoTune, engineAutoTune, engineControlValue } from "./auto-tune.ts";
import { ECHO_CONTROL_SPECS, ECHO_LANES, type EchoLane, type EngineEchoBoy, LANES_OF, engineEchoBoy } from "./echo-boy.ts";
import { type EngineGrossBeat, engineGrossBeat } from "./gross-beat.ts";
import { type EngineEq, engineProQ } from "./pro-q.ts";
import { type EngineOtt, OTT_CONTROL_SPECS, OTT_LANES, OTT_LANES_OF, type OttLane, engineOtt } from "./ott.ts";
import { type EngineProL, PRO_L_CONTROL_SPECS, PRO_L_LANES, engineProL } from "./pro-l.ts";
import { type EngineProC, PRO_C_CONTROL_SPECS, PRO_C_LANES, PRO_C_LANES_OF, type ProCLane, engineProC } from "./pro-c.ts";
import { type EngineReverb, REVERB_CONTROL_SPECS, REVERB_LANES, REVERB_LANES_OF, REVERB_LANE_NAMES, type ReverbLane, engineReverb, reverbSeed } from "./reverb.ts";
import { type EnginePitchWheel, controlValue as pitchWheelValue, engineControlValue as engineWheelValue, enginePitchWheel } from "./pitch-wheel.ts";
import { GROSS_SLOTS } from "./gross-beat-presets.ts";
import { AUTO_TUNE_CONTROL_INFO } from "./auto-tune-presets.ts";
import { type EnginePanMan, enginePanMan, isPatternMode, panShape } from "./panman.ts";
import { PAN_ENGINE_CONTROLS, PAN_LANE_SCALE, PAN_SHAPING_CONTROLS } from "./panman-presets.ts";
import { DEFAULT_FADER, DEFAULT_VELOCITY, DEFAULT_VOLUME, MASTER_TRACK_ID, patternSteps, precomputedUntouched, routeOf } from "./project.ts";
import { type Lfo, MOD_TARGETS, type ModEnvelope, type SampleLoop, type SamplerFilter, samplerOf } from "./sampler.ts";
import { autoGain } from "./pro-q-filters.ts";
import { heardMixer } from "./solo.ts";
import { hasGain } from "./pro-q-presets.ts";
import {
  AUTO_TUNE_CONTROLS,
  type AutoTuneControl,
  type AutomationTarget,
  type Channel,
  type EchoControl,
  type Envelope,
  type EqBand,
  type EqControl,
  type GrossControl,
  type MixerTrack,
  type MusicProject,
  OTT_CONTROLS,
  PRO_C_CONTROLS,
  PRO_L_CONTROLS,
  type ProLControl,
  type ProLState,
  REVERB_CONTROLS,
  type ReverbState,
  type PanControl,
  type ProCState,
  PITCH_WHEEL_CONTROLS,
  type PitchWheelControl,
  PPQ,
  type Pattern,
  type Precomputed,
  type SidechainTap,
  ROOT_PITCH,
  STEP_TICKS,
} from "./types.ts";

/** What play plays (the toolbar's PAT / SONG): the current pattern, looped, or the playlist. */
export type PlayMode = "pattern" | "song";

export interface EngineChannel {
  id: string;
  /** Its name, for its plugin's window title. */
  name: string;
  /** The sample to play: a media id here, which the server turns into the file's path. Null is silence. */
  sample: string | null;
  /**
   * An audio clip's channel: its file is streamed from disk as its clips play (`EngineSong.audioClips`),
   * never read whole into memory, and it plays no notes.
   */
  stream: boolean;
  /**
   * Whether any note of the song plays it. An audio clip's channel can be played from notes too (as FL's
   * can): then the engine has its file in memory, as a sampler's, as well as streaming it for its clips.
   */
  playsNotes: boolean;
  /** Linear gains of each side (volume, pan and mute together). */
  gainLeft: number;
  gainRight: number;
  /** Semitones added to every note. */
  pitch: number;
  /** Null: every note plays its whole sample. Its delay, hold and tensions as `Envelope`'s (absent: 0). */
  envelope: Omit<Envelope, "enabled"> | null;
  /** A sampler's loop (fractions of its prepared sample), filter, and the envelopes and LFOs that are on (`shared/music/sampler.ts`). */
  loop?: SampleLoop;
  filter?: SamplerFilter;
  mods?: EngineMods;
  /** A new note silences the channel's notes still sounding. */
  cutSelf: boolean;
  /** How the sample is prepared before it plays, or null to play it as it is. */
  precomputed: Precomputed | null;
  /**
   * A plugin channel's instrument: the engine's id for it, and where its state is kept (a path, which
   * the server fills in). Null for a sampler.
   */
  plugin: { id: string; state: string } | null;
  /** Index into `EngineSong.tracks`: the mixer track it plays into. */
  track: number;
}

/** A sampler's envelopes and LFOs that are on, by target: what the engine plays. */
export interface EngineMods {
  volumeLfo?: Lfo;
  pan?: { envelope?: ModEnvelope; lfo?: Lfo };
  cutoff?: { envelope?: ModEnvelope; lfo?: Lfo };
  resonance?: { envelope?: ModEnvelope; lfo?: Lfo };
  pitch?: { envelope?: ModEnvelope; lfo?: Lfo };
}

/** An effect in a mixer track's slot. */
export interface EngineEffect {
  /** The effect's id (`MixerEffect.id`), which the engine keeps its plugin instance by. */
  id: string;
  /** The plugin, and where its state is kept (a path, which the server fills in). */
  plugin: { id: string; state: string };
  /** Off: bypassed, but still loaded. */
  enabled: boolean;
  /** 0..1 of the effect's sound against what comes in. */
  mix: number;
  /**
   * Its key (`docs/sidechain.md`): an earlier track's sound (its index in `EngineSong.tracks`), taken before
   * its effects, after them, or after its fader. Pro-C's External and a plugin's sidechain input hear it.
   */
  key?: { track: number; tap: SidechainTap };
  /** A Gross Beat (ours, run by the engine itself: its `plugin.id` is `GROSS_BEAT_PLUGIN`'s): its settings and envelopes. */
  grossBeat?: EngineGrossBeat;
  /** An Auto-Tune (ours too, `AUTO_TUNE_PLUGIN`): its settings in the engine's units. */
  autoTune?: EngineAutoTune;
  /** An EchoBoy (ours, run by the engine itself: its `plugin.id` is `ECHO_BOY_PLUGIN`'s): its delay lines, style and levels. */
  echoBoy?: EngineEchoBoy;
  /** A Pro-Q (ours, run by the engine itself: its `plugin.id` is `PRO_Q_PLUGIN`'s): its bands and settings. */
  eq?: EngineEq;
  /** An OTT (ours, `OTT_PLUGIN`): its gains and its bands' laws, in the engine's units. */
  ott?: EngineOtt;
  /** A Pro-C (ours, `PRO_C_PLUGIN`): its style as blocks and numbers, its key's track. */
  proC?: EngineProC;
  /** A YT-L (ours, `PRO_L_PLUGIN`): its style as numbers, its knobs in the engine's units. */
  proL?: EngineProL;
  /** A PanMan (ours, likewise: `PANMAN_PLUGIN`'s id): its settings and pattern. */
  panMan?: EnginePanMan;
  /** A Reverb (ours, `REVERB_PLUGIN`): its network, decay and vocal tools as numbers, its ducking key's track. */
  reverb?: EngineReverb;
  /** A Pitch Wheel (ours too, `PITCH_WHEEL_PLUGIN`): its wheels, and where its notes come from. */
  pitchWheel?: EnginePitchWheel;
}

/**
 * A mixer track: what the channels and sends into it add up to goes through its effects, then
 * `gains` (the fader, pan and mute), then into each of `sends`.
 */
export interface EngineTrack {
  id: string;
  /** Its name, for its effects' windows' titles. */
  name: string;
  /** Its effects, in order (empty slots left out). */
  effects: EngineEffect[];
  /**
   * The stereo out from the stereo in, `[left→left, right→left, left→right, right→right]`: the
   * fader's gain and the pan (which moves one side into the other), or zeros when muted.
   */
  gains: [number, number, number, number];
  /** Indexes into `EngineSong.tracks` (always later ones) and the gain of each. */
  /** `preFader`: taken before `gains` (silent while the track is muted). */
  sends: { track: number; gain: number; preFader?: boolean }[];
  /** Milliseconds added to its plugins' reported delay (`MixerTrack.latencyOffset`); the engine compensates for both. */
  latencyOffset: number;
  /**
   * A track another's solo silences that keys an effect after its fader: its gains as if it weren't soloed
   * out, for that key (a solo never stops a duck). Absent: its keys take `gains`.
   */
  keyGains?: [number, number, number, number];
  /**
   * Its input on the audio device, or null: the device's input channels (one is heard on both sides),
   * whether it's heard (`monitor`: added in before its effects, so it's heard through them) and
   * whether it's armed (recorded, dry, when a recording starts).
   */
  input: EngineInput | null;
}

export interface EngineInput {
  channels: number[];
  monitor: boolean;
  armed: boolean;
}

export interface EngineNote {
  /** Index into `channels`. */
  channel: number;
  /** Ticks from the loop's start (after swing, so it may be a fraction). */
  tick: number;
  /** Ticks. */
  length: number;
  /** Semitones from the sample's own pitch. */
  pitch: number;
  /** Linear gain. */
  gain: number;
  /** For a plugin: the MIDI note, and its velocity (0..1). */
  key: number;
  velocity: number;
  /** -1 (left) .. 1 (right), on top of the channel's own pan. */
  pan: number;
}

/** An audio clip on the playlist, as the engine plays it: its channel's file, from `seconds` in, at `tick`. */
export interface EngineAudioClip {
  /** Index into `channels` (an audio clip's channel, `stream`). */
  channel: number;
  /** Ticks from the loop's start; negative for a clip that began before the loop does (it's heard from there). */
  tick: number;
  /** Ticks. */
  length: number;
  /** Where in its file the clip is at `tick`, in seconds. */
  seconds: number;
  /**
   * How fast it plays its file, seconds of the file per second of the song (`audioPlayback`): its stretch
   * (at another tempo than its own, faster or slower). Its channel's pitch never changes it.
   */
  speed: number;
  /**
   * Through the engine's time stretcher: played at `speed`, its pitch shifted by `transpose` semitones
   * (Stretch mode, or its channel pitched). Otherwise (absent) it's read faster or slower, its pitch going
   * with it (Resample).
   */
  keepPitch?: boolean;
  transpose?: number;
  /** Its own gain (absent: 1), and its fades: ticks from its start and before its end, and their tensions (`fadeShape`). */
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  fadeInTension?: number;
  fadeOutTension?: number;
}

/**
 * What an automation lane drives in the engine, in the engine's own units: a channel's two gains or a
 * sampler's pitch (semitones), a mixer
 * track's gain matrix (`EngineTrack.gains`), a send's gain, an effect's mix, a Gross Beat's slot (its
 * number, 0..35), mix (0..1), attack or release (seconds) or tension (-1..1), an Auto-Tune's control (`engineControlValue`), a PanMan's control (in its units
 * over `PAN_LANE_SCALE`: the offset and width as fractions of 105° and 210°, the rate in Hz, the gains in dB), or a
 * plugin's parameter (0..1, or -1 where the plugin keeps its own value:
 * before any clip of it).
 */
export type EngineLaneTarget =
  | { kind: "channel"; channel: number }
  | { kind: "pitch"; channel: number }
  | { kind: "track"; track: number }
  | { kind: "send"; track: number; send: number }
  | { kind: "mix"; track: number; effect: number }
  | { kind: "gross"; track: number; effect: number; control: GrossControl }
  | { kind: "tune"; track: number; effect: number; control: AutoTuneControl }
  | { kind: "echo"; track: number; effect: number; control: EchoLane }
  /** A Pro-Q band's frequency (log2 Hz), gain or range (dB) or Q (log2), by band number; or its output (dB) or pan (-1..1), band 0. */
  | { kind: "eq"; track: number; effect: number; band: number; control: EqControl }
  /** An OTT's lane (`OttLane`): its gains, or a value a band (low, mid, high). */
  | { kind: "ott"; track: number; effect: number; control: OttLane }
  /** A Pro-C's lane (`ProCLane`): one value, or two (a slope and its loop gain; a gain per side). */
  | { kind: "comp"; track: number; effect: number; control: ProCLane }
  /** A YT-L's lane (`PRO_L_LANES`): one value in the engine's units (dB, seconds, 0..1). */
  | { kind: "limiter"; track: number; effect: number; control: ProLControl }
  /** A PanMan's control; or its pattern (`shape`: `PAN_SHAPE_POINTS` positions evenly over it), Smoothing, Feel or Groove automated. */
  | { kind: "panman"; track: number; effect: number; control: PanControl | "shape" }
  | { kind: "wheel"; track: number; effect: number; control: PitchWheelControl }
  /** A Reverb's lane (`ReverbLane`): its values in the engine's units (Hz, seconds, linear gains; the ten T60s). */
  | { kind: "verb"; track: number; effect: number; control: ReverbLane }
  | { kind: "param"; owner: "channel" | "effect"; id: string; param: string; index: number };

/**
 * A control automated over the song (`docs/fl-studio/automation.md`), as straight lines between points:
 * at `ticks[i]` (from the loop's start, in order; two on one tick are a jump) it's `values[i * n .. i * n + n]`,
 * `n` being how many values its target takes (2 for a channel, 4 for a track, else 1).
 */
export interface EngineLane {
  target: EngineLaneTarget;
  ticks: number[];
  values: number[];
  /**
   * Moved by a modulator (`docs/sidechain.md`; its index in `EngineSong.modulators`): each point is then
   * `steps` sets of values, at the modulator's level 0, 1/(steps−1) … 1, which the engine reads between at
   * its level; `base` is that grid at the controls' own values (while the song is stopped, or in pattern mode
   * where automation doesn't play). A plugin parameter's lane has no grid: `amount` is added at the level.
   */
  modulator?: number;
  steps?: number;
  base?: number[];
  amount?: number;
}

/** A modulator as the engine follows it: a track's sound at a tap, or a channel's notes (`docs/sidechain.md`). */
export interface EngineModulator {
  id: string;
  /** Its source: a track (index into `EngineSong.tracks`) at a tap, or a channel (index into `channels`). */
  track?: number;
  tap?: SidechainTap;
  channel?: number;
  /** Seconds, as the document's; `gain` linear. */
  attack: number;
  release: number;
  gain: number;
  tension: number;
}

/** How many values a lane's target takes at each point. */
export const laneSize = (target: EngineLaneTarget) => (target.kind === "channel" ? 2 : target.kind === "track" ? 4 : 1);

/** A part of the pattern to play on its own, in ticks: the Piano roll's time selection. */
export interface LoopRange {
  start: number;
  end: number;
}

export interface EngineSong {
  tempo: number;
  /** Ticks per quarter note. */
  ppq: number;
  /** The loop's length, in ticks. */
  loopTicks: number;
  /** Where in the pattern the loop starts (0 unless only a part of it plays): the engine's ticks count from here. */
  offsetTicks: number;
  /** Ticks per beat and per bar (the metronome). */
  beatTicks: number;
  barTicks: number;
  channels: EngineChannel[];
  /** In order of `tick`. */
  notes: EngineNote[];
  /** The playlist's audio clips (song mode), in order of `tick`. */
  audioClips: EngineAudioClip[];
  /**
   * The mixer's tracks in the order to run them: every track after all those sending to it, and the
   * master last (what it puts out is what's heard).
   */
  tracks: EngineTrack[];
  /**
   * The automated controls (song mode only) and the modulated ones (both modes): what they are over the loop.
   * Without one, a control is as `channels` and `tracks` say.
   */
  lanes: EngineLane[];
  /** The modulators the lanes name (absent: none). */
  modulators?: EngineModulator[];
  /**
   * With tempo clips (song mode, `warpSong`): the metronome's beats, in order, and those that start a bar,
   * from the loop's start, as they no longer fall every `beatTicks`. Absent: they do.
   */
  clicks?: number[];
  barClicks?: number[];
}

/**
 * A level (0..1) as a gain: `unity` plays the sample as it is, above it is louder (up to +4 dB at 1),
 * and the curve is squared so the low end of a knob isn't all of the audible range.
 */
export const levelGain = (level: number, unity: number) => (level / unity) ** 2;

/** How much of each side a pan leaves: the centre is both at full, as in FL Studio. */
export const panGains = (pan: number): [number, number] => [Math.min(1, 1 - pan), Math.min(1, 1 + pan)];

/**
 * A mixer fader's gain: `DEFAULT_FADER` leaves the sound as it is, the top adds about 6 dB, and the curve
 * is cubed, as faders are, so most of its travel is the range that's used.
 */
export const faderGain = (volume: number) => (volume / DEFAULT_FADER) ** 3;

/**
 * A mixer track's pan as gains, `[left→left, right→left, left→right, right→right]`. FL Studio's mixer
 * pan moves one side into the other, so fully to one side is both sides summed there; each side moves
 * as a mono sound would under the circular pan law (sin/cos), so the centre leaves the sound alone.
 */
export function mixerPanGains(pan: number): [number, number, number, number] {
  const angle = (Math.abs(pan) * Math.PI) / 2;
  const stay = Math.cos(angle);
  const cross = Math.sin(angle);
  // Panned right, the left side moves over; panned left, the right side does.
  return pan >= 0 ? [stay, 0, cross, 1] : [1, cross, 0, stay];
}

/** A stereo matrix, `[left→left, right→left, left→right, right→right]`. */
type Matrix = [number, number, number, number];

/** `a` after `b`: the sound through `b`, then through `a`. */
const after = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];

/**
 * What FL's track does to its sound after its effects, before its fader and pan: invert phase, swap the
 * sides, stereo separation (the sides' difference scaled: 0 at full narrowing, mono; twice at full widening).
 */
export function stereoGains(track: Pick<MixerTrack, "invert" | "swap" | "stereo">): Matrix {
  const sign = track.invert ? -1 : 1;
  let gains: Matrix = track.swap ? [0, sign, sign, 0] : [sign, 0, 0, sign];
  if (track.stereo !== 0) {
    // 1 as it is, 0 mono (narrowed all the way), 2 twice as wide.
    const width = 1 - track.stereo;
    const same = (1 + width) / 2;
    const cross = (1 - width) / 2;
    gains = after([same, cross, cross, same], gains);
  }
  return gains;
}

/**
 * The mixer's tracks in an order to run them: each after every track that sends to it (the sends never
 * make a loop: `normalizeMusicProject` and the edits see to that), otherwise as the mixer has them, and
 * the master last.
 */
export function trackOrder(tracks: readonly MixerTrack[]): MixerTrack[] {
  // Where each track's sound goes on to: its sends, and the tracks it keys (a key is heard before its track runs).
  const next = routeOf(tracks);
  const waiting = new Map<string, number>(tracks.map((t) => [t.id, 0]));
  for (const track of tracks) for (const to of next(track.id)) waiting.set(to, (waiting.get(to) ?? 0) + 1);
  const order: MixerTrack[] = [];
  const done = new Set<string>();
  // Repeatedly take the first track nothing is still waiting to send to (a few hundred tracks at most).
  while (order.length < tracks.length) {
    const ready = tracks.find((t) => !done.has(t.id) && t.id !== MASTER_TRACK_ID && waiting.get(t.id) === 0);
    if (!ready) break;
    done.add(ready.id);
    order.push(ready);
    for (const to of next(ready.id)) waiting.set(to, waiting.get(to)! - 1);
  }
  const master = tracks.find((t) => t.id === MASTER_TRACK_ID);
  if (master) order.push(master);
  // Only a loop (which can't be) would leave tracks out: they'd go last, sending only to later tracks.
  for (const track of tracks) if (!done.has(track.id) && track !== master) order.splice(order.length - 1, 0, track);
  return order;
}

/**
 * A track's input as the engine takes it: heard always, never, or while it's armed (FL's Monitor
 * external input), and recorded when it's armed. Null without one.
 */
export function engineInput(track: MixerTrack, armed: boolean): EngineInput | null {
  if (!track.input || track.id === MASTER_TRACK_ID) return null;
  const { channel, stereo } = track.input;
  return { channels: stereo ? [channel, channel + 1] : [channel], monitor: track.monitor === "on" || (track.monitor === "armed" && armed), armed };
}

/**
 * How the master is listened to while mixing (the tab's switches, never the song's: an export doesn't have
 * them). `mono` sums it to mono, to check the mix there (Logic's, Studio One's); `dim` turns it down by
 * `DIM_DB`, to talk over it.
 */
export interface Listening {
  mono?: boolean;
  dim?: boolean;
}
/** How far Dim turns the master down. */
export const DIM_DB = -20;

/** A mixer track's gain matrix from its fader, pan and stereo separation (and the main volume and the listening switches, for the master). */
function trackGains(track: Pick<MixerTrack, "invert" | "swap" | "stereo" | "pan" | "volume" | "muted">, main: number, listening: Listening = {}): EngineTrack["gains"] {
  const gain = track.muted ? 0 : faderGain(track.volume) * main * (listening.dim ? 10 ** (DIM_DB / 20) : 1);
  const gains = after(mixerPanGains(track.pan), stereoGains(track));
  // Summed to mono after everything else: each side out is the average of both.
  const heard = listening.mono ? after(stereoGains({ invert: false, swap: false, stereo: 1 }), gains) : gains;
  return heard.map((g) => g * gain) as EngineTrack["gains"];
}

/** A channel's gains on each side, from its volume and pan. */
function channelGains(channel: Pick<Channel, "muted" | "volume" | "pan">): [number, number] {
  const gain = channel.muted ? 0 : levelGain(channel.volume, DEFAULT_VOLUME);
  const [left, right] = panGains(channel.pan);
  return [gain * left, gain * right];
}

/** Gross Beat's slots that can play in this song, by effect id: the picked ones, and in song mode those its automation reaches. */
function grossSlots(song: MusicProject, mode: PlayMode): Map<string, { time: Set<number>; volume: Set<number> }> {
  const slots = new Map<string, { time: Set<number>; volume: Set<number> }>();
  const index = mode === "song" ? automationIndex(song) : null;
  /** The slots an automation of `control` reaches: between its lowest and highest points (an LFO's: any). */
  const reached = (effectId: string, control: GrossControl, into: Set<number>) => {
    for (const placed of index?.get(targetKey({ kind: "grossBeat", effect: effectId, control })) ?? []) {
      const a = placed.automation;
      let low = 1;
      let high = 0;
      for (const p of a.points) {
        low = Math.min(low, p.value);
        high = Math.max(high, p.value);
      }
      if (a.lfo.enabled && a.lfo.level) [low, high] = [0, 1];
      const at = (v: number) => Math.round(Math.min(1, Math.max(0, a.min + v * (a.max - a.min))) * (GROSS_SLOTS - 1));
      const [from, to] = [at(low), at(high)].sort((x, y) => x - y);
      for (let n = from; n <= to; n++) into.add(n);
    }
  };
  for (const track of song.mixer.tracks)
    for (const effect of track.effects) {
      const gb = effect?.grossBeat;
      if (!effect || !gb) continue;
      const time = new Set([gb.timeSlot]);
      const volume = new Set([gb.volumeSlot]);
      reached(effect.id, "timeSlot", time);
      reached(effect.id, "volumeSlot", volume);
      // Linked, the volume slot follows the time slot's automation (and back).
      if (gb.linkSlots) {
        reached(effect.id, "timeSlot", volume);
        reached(effect.id, "volumeSlot", time);
      }
      // One-shot goes back to slot 1 when it's done.
      if (gb.oneShot) {
        time.add(0);
        volume.add(0);
      }
      slots.set(effect.id, { time, volume });
    }
  return slots;
}

/** Each grouped track's VCA gain (its group's VCA fader), by id: tracks without one aren't listed. */
function vcaGains(song: MusicProject): Map<string, number> {
  const groups = new Map(song.mixer.groups.flatMap((g) => (g.vca === undefined ? [] : [[g.id, faderGain(g.vca)] as const])));
  const gains = new Map<string, number>();
  if (groups.size) for (const track of song.mixer.tracks) if (track.group && groups.has(track.group)) gains.set(track.id, groups.get(track.group)!);
  return gains;
}

function engineTracks(
  song: MusicProject,
  armed: ReadonlySet<string>,
  mode: PlayMode = "pattern",
  listening: Listening = {},
  soloedOut: ReadonlySet<string> = new Set(),
): { tracks: EngineTrack[]; index: Map<string, number> } {
  const gross = grossSlots(song, mode);
  const ordered = trackOrder(song.mixer.tracks);
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const numbers = new Map(song.mixer.tracks.map((t, i) => [t.id, i]));
  const vca = vcaGains(song);
  // Tracks keying an effect after their fader: one the solo silences keeps its gains for that key.
  const fadedKeys = new Set(song.mixer.tracks.flatMap((t) => t.effects.flatMap((e) => (e?.sidechain?.tap === "postFader" ? [e.sidechain.track] : []))));
  const tracks = ordered.map((track): EngineTrack => {
    // The main volume is the master's, after its fader; a group's VCA fader its tracks'.
    const main = track.id === MASTER_TRACK_ID ? levelGain(song.settings.volume, DEFAULT_VOLUME) : (vca.get(track.id) ?? 1);
    const number = numbers.get(track.id)!;
    return {
      id: track.id,
      name: track.name ?? (number === 0 ? "Master" : `Insert ${number}`),
      effects: track.effects.flatMap((e): EngineEffect[] => {
        if (!e) return [];
        const effect: EngineEffect = { id: e.id, plugin: { id: e.plugin.id, state: "" }, enabled: e.enabled, mix: e.mix };
        // Its key: an earlier track (the order puts every source first; a key that isn't, from a song that slipped past the edits, is dropped).
        const source = e.sidechain ? index.get(e.sidechain.track) : undefined;
        if (e.sidechain && source !== undefined && source < index.get(track.id)!) effect.key = { track: source, tap: e.sidechain.tap };
        const slots = gross.get(e.id);
        if (e.autoTune) return [{ ...effect, autoTune: engineAutoTune(e.autoTune) }];
        if (e.echoBoy) return [{ ...effect, echoBoy: engineEchoBoy(e.echoBoy, song.settings.tempo) }];
        if (e.proQ) return [{ ...effect, eq: engineProQ(e.proQ) }];
        if (e.ott) return [{ ...effect, ott: engineOtt(e.ott) }];
        if (e.proC) return [{ ...effect, proC: engineProC(e.proC) }];
        if (e.proL) return [{ ...effect, proL: engineProL(e.proL) }];
        if (e.panMan) return [{ ...effect, panMan: enginePanMan(e.panMan, e.id) }];
        if (e.reverb) return [{ ...effect, reverb: engineReverb(e.reverb, song.settings.tempo, reverbSeed(e.id)) }];
        if (e.pitchWheel) {
          // Notes from a channel the song no longer has: none.
          const wheel = enginePitchWheel(e.pitchWheel);
          return [{ ...effect, pitchWheel: wheel.notesFrom && !song.channels.some((c) => c.id === wheel.notesFrom) ? { ...wheel, notesFrom: null } : wheel }];
        }
        return [e.grossBeat && slots ? { ...effect, grossBeat: engineGrossBeat(e.grossBeat, slots.time, slots.volume) } : effect];
      }),
      gains: trackGains(track, main, track.id === MASTER_TRACK_ID ? listening : {}),
      ...(soloedOut.has(track.id) && fadedKeys.has(track.id) && { keyGains: trackGains({ ...track, muted: false }, main) }),
      latencyOffset: track.latencyOffset,
      input: engineInput(track, armed.has(track.id)),
      sends: track.sends.flatMap((send) => {
        const to = index.get(send.to);
        if (to === undefined || to <= index.get(track.id)!) return [];
        // Before the fader, but not past the mute (nor a solo that silences the track).
        if (send.preFader) return [{ track: to, gain: track.muted ? 0 : levelGain(send.level, 1), preFader: true }];
        return [{ track: to, gain: levelGain(send.level, 1) }];
      }),
    };
  });
  return { tracks, index };
}

/** A modulator's level (0..1) by its index in the song's list: what a modulated lane is worked out at. */
type Level = (modulator: number) => number;
const NO_AUTOMATION: AutomationIndex = new Map();
const NO_MODULATION: ReturnType<typeof modulationIndex> = new Map();
/** A modulated lane's grid: at most this many levels (fewer for wide lanes, a point holding at most `LANE_MAX_VALUES`: the engine's `Song::Lane::maxSize`). */
const MOD_STEPS = 17;
const LANE_MAX_VALUES = 128;

/**
 * The modulators the engine follows, and each one's index there by its index in the song: those whose
 * source is in this song (a track that's run, a channel).
 */
function engineModulators(song: MusicProject, trackIndex: Map<string, number>): { list: EngineModulator[]; index: Map<number, number> } {
  const list: EngineModulator[] = [];
  const index = new Map<number, number>();
  song.modulators.forEach((m, i) => {
    if (!m.links.length) return;
    const knobs = { attack: m.attack, release: m.release, gain: 10 ** (m.gain / 20), tension: m.tension };
    if (m.source.kind === "track") {
      const track = trackIndex.get(m.source.track);
      if (track === undefined) return;
      index.set(i, list.length);
      list.push({ id: m.id, track, tap: m.source.tap, ...knobs });
    } else {
      const source = m.source;
      const channel = song.channels.findIndex((c) => c.id === source.channel);
      if (channel < 0) return;
      index.set(i, list.length);
      list.push({ id: m.id, channel, ...knobs });
    }
  });
  return { list, index };
}

/** The most a step is delayed by swing: half a step, at full swing. */
const MAX_SWING = STEP_TICKS / 2;

/** Where a note plays with swing: every second step (the off sixteenths) is late. */
export const swungTick = (start: number, swing: number) => (start % (2 * STEP_TICKS) === STEP_TICKS ? start + swing * MAX_SWING : start);

function engineChannel(channel: Channel, track: number): Omit<EngineChannel, "playsNotes"> {
  const [gainLeft, gainRight] = channelGains(channel);
  const { enabled, ...envelope } = channel.envelope;
  const untouched = precomputedUntouched(channel.precomputed);
  const stream = channel.kind === "audio";
  return {
    id: channel.id,
    name: channel.name,
    sample: channel.sampleId,
    stream,
    gainLeft,
    gainRight,
    pitch: channel.pitch,
    envelope: enabled && !stream ? envelope : null,
    ...(!stream && channel.kind === "sampler" ? samplerForEngine(channel) : {}),
    cutSelf: channel.cutSelf,
    // An audio clip channel's too: prepared in memory, its clips play that instead of streaming the file.
    precomputed: untouched ? null : channel.precomputed,
    plugin: channel.kind === "plugin" && channel.plugin ? { id: channel.plugin.id, state: "" } : null,
    track,
  };
}

/** A sampler's loop, filter and modulation as the engine takes them: only what's on. */
function samplerForEngine(channel: Channel): Pick<EngineChannel, "loop" | "filter" | "mods"> {
  const { loop, filter, mods } = samplerOf(channel);
  const out: Pick<EngineChannel, "loop" | "filter" | "mods"> = {};
  if (loop.enabled) out.loop = loop;
  if (filter.type !== "off") out.filter = filter;
  const engineMods: EngineMods = {};
  if (mods.volumeLfo.enabled) engineMods.volumeLfo = mods.volumeLfo;
  for (const target of MOD_TARGETS) {
    // The filter's targets do nothing without the filter.
    if ((target === "cutoff" || target === "resonance") && filter.type === "off") continue;
    const { envelope, lfo } = mods[target];
    if (envelope.enabled || lfo.enabled) engineMods[target] = { ...(envelope.enabled && { envelope }), ...(lfo.enabled && { lfo }) };
  }
  if (Object.keys(engineMods).length) out.mods = engineMods;
  return out;
}

/** The swing a channel's notes play with: the song's, times the channel's mix (FL's Swing mix). */
const channelSwing = (song: MusicProject, channel: Channel | undefined) => song.settings.swing * (channel?.swingMix ?? 1);

/**
 * The song as the engine should play it. In pattern mode, `patternId` (or the first pattern) on a loop: the
 * whole pattern, or only `loop`, a part of it. In song mode, the playlist: to the end of its last clip's bar
 * and round again, or only `loop`, a part of the song. Notes that start in the part played are heard; one
 * already sounding when it starts isn't. `armed`: the mixer tracks armed to record (the tab's, not the song's).
 */
export function compileSong(
  written: MusicProject,
  patternId: string | null,
  loop: LoopRange | null = null,
  mode: PlayMode = "pattern",
  held: ReadonlySet<string> = NONE_HELD,
  armed: ReadonlySet<string> = new Set(),
  listening: Listening = {},
): EngineSong {
  // The solos silence tracks as mutes would.
  const song = heardMixer(written);
  const pattern = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const [beats, unit] = song.settings.timeSignature;
  const beatTicks = (PPQ * 4) / unit;
  const length = mode === "song" ? songTicks(song) : patternSteps(pattern, song.settings.timeSignature) * STEP_TICKS;
  const from = loop && loop.end > loop.start ? Math.max(0, loop.start) : 0;
  const to = loop && loop.end > loop.start ? loop.end : length;
  const notes = transposePlugins(song, mode === "song" ? songNotes(song, from, to) : patternNotes(song, pattern, from, to), mode === "song" ? from : null, held);
  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  const played = new Set(notes.map((n) => n.channel));
  const muted = new Set(song.mixer.tracks.filter((t) => t.muted).map((t) => t.id));
  const soloedOut = new Set(written.mixer.tracks.filter((t) => !t.muted && muted.has(t.id)).map((t) => t.id));
  const { tracks, index } = engineTracks(song, armed, mode, listening, soloedOut);
  const modulators = engineModulators(song, index);
  const master = index.get(MASTER_TRACK_ID)!;
  const compiled: EngineSong = {
    tempo: song.settings.tempo,
    ppq: PPQ,
    loopTicks: to - from,
    offsetTicks: from,
    beatTicks,
    barTicks: beatTicks * beats,
    channels: song.channels.map((channel, i) => ({ ...engineChannel(channel, index.get(channel.mixerTrack) ?? master), playsNotes: played.has(i) })),
    notes,
    audioClips: mode === "song" ? audioClips(song, from, to) : [],
    tracks,
    // Automation only plays in song mode (Théo); modulation in both.
    lanes: automationLanes(song, index, from, to, held, listening, mode === "song", modulators.index),
    ...(modulators.list.length && { modulators: modulators.list }),
  };
  // Tempo clips (song mode): the engine keeps the song's own tempo, and every tick goes where it falls in time.
  const map = mode === "song" ? tempoMap(song) : null;
  return map ? warpSong(compiled, map, from, to) : compiled;
}

/** How far past the loop's end the metronome's clicks are listed (a recording going on past it). */
const CLICKS_PAST = 32;

/**
 * A song with tempo clips, as the engine plays it (`docs/fl-studio/automation.md`): its ticks (counted
 * from `from`) moved to the engine's (`engineTick`), each note's end too, so it lasts as long as it
 * should. An audio clip moves to where it starts and plays its file in real time from there (a tempo
 * change moves its end, not its sound, as in FL). The metronome's beats are listed, no longer even.
 */
function warpSong(compiled: EngineSong, map: TempoMap, from: number, to: number): EngineSong {
  const origin = engineTick(map, from);
  const at = (tick: number) => Math.round((engineTick(map, from + tick) - origin) * 1e4) / 1e4;
  const clicks: number[] = [];
  const barClicks: number[] = [];
  const { beatTicks, barTicks } = compiled;
  for (let beat = Math.ceil(from / beatTicks) * beatTicks; beat < to + CLICKS_PAST * barTicks; beat += beatTicks) {
    clicks.push(at(beat - from));
    if (beat % barTicks === 0) barClicks.push(clicks[clicks.length - 1]);
  }
  return {
    ...compiled,
    loopTicks: at(to - from),
    offsetTicks: Math.round(origin * 1e4) / 1e4,
    notes: compiled.notes.map((note) => {
      const tick = at(note.tick);
      return { ...note, tick, length: at(note.tick + note.length) - tick };
    }),
    audioClips: compiled.audioClips.map((clip) => ({ ...clip, tick: at(clip.tick) })),
    lanes: compiled.lanes.map((lane) => ({ ...lane, ticks: lane.ticks.map(at) })),
    clicks,
    barClicks,
  };
}

const NONE_HELD: ReadonlySet<string> = new Set();

/**
 * A plugin channel's PITCH moves the keys it's sent by whole semitones (a sampler's plays its sample at
 * that pitch instead; ours: FL's wrapper bends the pitch within the plugin's own bend range). In song mode
 * (`songFrom`: where the notes' ticks count from) an automated PITCH moves each note by what it is where
 * the note starts, unless the hand holds it.
 */
function transposePlugins(song: MusicProject, notes: EngineNote[], songFrom: number | null, held: ReadonlySet<string>): EngineNote[] {
  const shift = song.channels.map((c) => (c.kind === "plugin" ? Math.round(c.pitch) : 0));
  const automated = song.channels.map((c): ((tick: number) => number) | null => {
    if (c.kind !== "plugin" || songFrom === null) return null;
    const target: AutomationTarget = { kind: "channel", channel: c.id, control: "pitch" };
    if (held.has(targetKey(target)) || !isAutomated(song, target)) return null;
    const info = controlOf(song, target);
    return (tick) => {
      const fraction = controlAt(song, target, tick);
      return fraction === null ? Math.round(c.pitch) : Math.round(info.toControl(fraction));
    };
  });
  if (!shift.some((s) => s !== 0) && !automated.some(Boolean)) return notes;
  return notes.map((n) => {
    const by = automated[n.channel]?.(n.tick + (songFrom ?? 0)) ?? shift[n.channel];
    return by ? { ...n, key: Math.min(127, Math.max(0, n.key + by)) } : n;
  });
}

/** A note as the engine plays it, `tick` ticks into the loop, `length` long. */
function engineNote(channel: number, note: Pattern["notes"][string][number], tick: number, length: number): EngineNote {
  return {
    channel,
    tick,
    length,
    pitch: note.pitch - ROOT_PITCH,
    gain: levelGain(note.velocity, DEFAULT_VELOCITY),
    key: note.pitch,
    velocity: note.velocity,
    pan: note.pan,
  };
}

/** The channels that play notes, by id, with their index in the rack: every one (an audio clip's too, as in FL Studio). */
const noteChannels = (song: MusicProject) => new Map(song.channels.map((c, i) => [c.id, i] as const));

/** Pattern mode: the pattern's notes that start in `[from, to)`, counted from `from`. */
function patternNotes(song: MusicProject, pattern: Pattern, from: number, to: number): EngineNote[] {
  const notes: EngineNote[] = [];
  for (const [channelId, index] of noteChannels(song)) {
    for (const note of pattern.notes[channelId] ?? []) {
      // Past the end (of the loop, or of a set length): kept in the song, not played.
      if (note.start >= to) break;
      if (note.start < from || note.muted) continue;
      notes.push(engineNote(index, note, swungTick(note.start, channelSwing(song, song.channels[index])) - from, note.length));
    }
  }
  return notes;
}

/**
 * Song mode: every pattern clip's notes on the song's time, in `[from, to)` and counted from `from`. A clip
 * plays its pattern from its offset to its end or the pattern's, whichever's first (stretched past its
 * pattern, it plays nothing more, Théo); a note it cuts off at its end stops there, and one that began
 * before its window (a clip sliced through it) plays from the window's start: FL's "play truncated
 * notes in clips". Muted clips, and clips on muted tracks, are silent.
 */
function songNotes(song: MusicProject, from: number, to: number): EngineNote[] {
  const ctx = clipContext(song);
  const channels = noteChannels(song);
  const patterns = new Map(song.patterns.map((p) => [p.id, p]));
  const notes: EngineNote[] = [];
  for (const clip of song.playlist.clips) {
    if (clip.start >= to) break;
    if (clip.kind !== "pattern" || clip.muted || trackAt(song, clip.track).muted) continue;
    const pattern = patterns.get(clip.ref);
    const length = clipLength(clip, ctx);
    if (!pattern || clip.start + length <= from) continue;
    const windowStart = clip.offset;
    const windowEnd = clip.offset + length;
    const contentEnd = Math.min(windowEnd, ctx.patternTicks(clip.ref));
    for (const [channelId, list] of Object.entries(pattern.notes)) {
      const index = channels.get(channelId);
      if (index === undefined) continue;
      for (const note of list) {
        if (note.start >= contentEnd) break;
        if (note.muted || note.start + note.length <= windowStart) continue;
        const truncated = note.start < windowStart;
        const at = truncated ? windowStart : swungTick(note.start, channelSwing(song, song.channels[index]));
        const tick = clip.start + at - clip.offset;
        if (tick < from || tick >= to) continue;
        const end = Math.min(note.start + note.length, windowEnd);
        notes.push(engineNote(index, note, tick - from, Math.max(1, end - (truncated ? windowStart : note.start))));
      }
    }
  }
  return notes;
}

/** Song mode: the audio clips that play in `[from, to)`, counted from `from`. */
function audioClips(song: MusicProject, from: number, to: number): EngineAudioClip[] {
  const ctx = clipContext(song);
  const channels = new Map(song.channels.flatMap((c, i) => (c.kind === "audio" && c.sampleId ? [[c.id, i] as const] : [])));
  const clips: EngineAudioClip[] = [];
  for (const clip of song.playlist.clips) {
    if (clip.start >= to) break;
    if (clip.kind !== "audio" || clip.muted || trackAt(song, clip.track).muted) continue;
    const channel = channels.get(clip.ref);
    const length = clipLength(clip, ctx);
    if (channel === undefined || clip.start + length <= from) continue;
    const { speed, keepPitch, transpose } = audioPlayback(ctx.stretchOf(clip), song.channels[channel].pitch, song.settings.tempo);
    const { gain, fadeIn, fadeOut, fadeInTension, fadeOutTension } = clip;
    clips.push({
      channel,
      tick: clip.start - from,
      length,
      seconds: clip.offset,
      speed,
      ...(keepPitch ? { keepPitch, transpose } : {}),
      ...(gain !== undefined && { gain }),
      ...(fadeIn && { fadeIn, fadeInTension: fadeInTension ?? 0 }),
      ...(fadeOut && { fadeOut, fadeOutTension: fadeOutTension ?? 0 }),
    });
  }
  return clips;
}

/**
 * The channels making a sound at a tick of the pattern (the rack lights their selectors): a note of
 * theirs is sounding there, as the engine plays it (swung, and at least a step long, so a short hit
 * still shows). Muted channels and muted notes don't sound.
 */
export function soundingChannels(song: MusicProject, pattern: Pattern, tick: number): Set<string> {
  const sounding = new Set<string>();
  for (const channel of song.channels) {
    if (channel.muted) continue;
    for (const note of pattern.notes[channel.id] ?? []) {
      // Sorted by start: nothing later can have started (swing moves a note later by less than a step).
      if (note.start > tick) break;
      const start = swungTick(note.start, channelSwing(song, channel));
      if (!note.muted && tick >= start && tick < start + Math.max(note.length, STEP_TICKS)) {
        sounding.add(channel.id);
        break;
      }
    }
  }
  return sounding;
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

/**
 * The automated controls as the engine plays them: for each engine target whose controls any clip drives
 * (and that isn't being held by the hand: `held`, by `targetKey`), what it is from `from` to `to` of the
 * song, worked out from `controlAt` and drawn as straight lines close enough to it. A channel's volume
 * and pan make one lane of its gains, a track's fader, pan and stereo separation (and the master's main
 * volume) one of its matrix.
 */
function automationLanes(
  song: MusicProject,
  trackIndex: Map<string, number>,
  from: number,
  to: number,
  held: ReadonlySet<string>,
  listening: Listening,
  automate: boolean,
  modulators: ReadonlyMap<number, number>,
): EngineLane[] {
  const index = automate ? automationIndex(song) : NO_AUTOMATION;
  // The modulated controls, by `targetKey` (those of modulators the engine follows).
  const mods = modulators.size ? modulationIndex(song) : NO_MODULATION;
  if ((!index.size && !mods.size) || to <= from) return [];
  const { barTicks } = clipContext(song);
  const vca = vcaGains(song);
  /** A control's key when a lane is needed for it: automated (and not held by the hand), or modulated. */
  const automated = (target: AutomationTarget) => {
    const key = targetKey(target);
    if (mods.has(key) && modulators.has(mods.get(key)!.index)) return key;
    return !held.has(key) && index.has(key) ? key : null;
  };
  // Working out the lanes' own values (stopped, pattern mode): automation left out.
  let ownOnly = false;
  /**
   * A control's value at a tick, as its own (a pan's -1..1), or its own value where no clip says; moved by its
   * modulator at the level `eOf` gives that modulator (by its index in the song).
   */
  const valueOf = (target: AutomationTarget, own: number) => {
    const key = targetKey(target);
    const placed = index.get(key);
    const info = controlOf(song, target);
    const link = mods.get(key);
    // Held by the hand (in a lane with other controls that aren't): its own value, as the hand has it.
    const base = !placed || held.has(key) ? () => own : (tick: number) => {
      if (ownOnly) return own;
      const found = clipAtTick(placed, tick);
      return found ? info.toControl(placedValue(found.placed, tick, barTicks)) : own;
    };
    if (!link) return (tick: number, _eOf?: Level) => base(tick);
    return (tick: number, eOf?: Level) => {
      const v = base(tick);
      const e = eOf ? eOf(link.index) : 0;
      return e ? info.toControl(modulatedFraction(info.fromControl(v), link.link.amount, e)) : v;
    };
  };
  const breaksOf = (keys: (string | null)[]) => {
    const all = new Set<number>();
    for (const key of keys) if (key) for (const tick of controlBreaks(index.get(key) ?? [], from, to)) all.add(tick);
    return [...all].sort((a, b) => a - b);
  };
  /** How often a lane must be looked at to see its clips' LFOs (a quarter of the fastest one's cycle), else a beat. */
  const stepOf = (keys: (string | null)[]) => {
    let step = PPQ;
    for (const key of keys)
      if (key) for (const p of index.get(key) ?? []) if (p.automation.lfo.enabled && p.automation.lfo.level) step = Math.min(step, barTicks / p.automation.lfo.speed / 4);
    return Math.max(LANE_FINEST * 4, step);
  };
  const lanes: EngineLane[] = [];
  const add = (target: EngineLaneTarget, keys: (string | null)[], value: (tick: number, eOf?: Level) => number[]) => {
    if (!keys.some(Boolean)) return;
    // The first modulator moving any of its controls (the engine follows it), if it fits a grid.
    const modulated = keys.find((key) => key && mods.has(key) && modulators.has(mods.get(key)!.index));
    const songIndex = modulated ? mods.get(modulated)!.index : -1;
    const size = value(from).length;
    const steps = Math.min(MOD_STEPS, Math.floor(LANE_MAX_VALUES / size));
    if (songIndex < 0 || steps < 2) {
      if (keys.some((key) => key && index.has(key) && !held.has(key))) lanes.push({ target, ...sampleLane((tick) => value(tick), breaksOf(keys), from, to, stepOf(keys)) });
      return;
    }
    const grid = (tick: number) => Array.from({ length: steps }, (_, k) => value(tick, (i) => (i === songIndex ? k / (steps - 1) : 0))).flat();
    ownOnly = true;
    const base = grid(from);
    ownOnly = false;
    lanes.push({ target, ...sampleLane(grid, breaksOf(keys), from, to, stepOf(keys)), modulator: modulators.get(songIndex)!, steps, base: base.map((v) => Math.round(v * 1e6) / 1e6) });
  };

  song.channels.forEach((channel, i) => {
    if (channel.muted) return;
    const volumeTarget: AutomationTarget = { kind: "channel", channel: channel.id, control: "volume" };
    const panTarget: AutomationTarget = { kind: "channel", channel: channel.id, control: "pan" };
    const volume = valueOf(volumeTarget, channel.volume);
    const pan = valueOf(panTarget, channel.pan);
    add({ kind: "channel", channel: i }, [automated(volumeTarget), automated(panTarget)], (tick, eOf) => channelGains({ muted: false, volume: volume(tick, eOf), pan: pan(tick, eOf) }));
    // A sampler's pitch bends its voices as they sound (a plugin channel's moves its notes' keys: `transposePlugins`).
    if (channel.kind !== "plugin") {
      const pitchTarget: AutomationTarget = { kind: "channel", channel: channel.id, control: "pitch" };
      const pitch = valueOf(pitchTarget, channel.pitch);
      add({ kind: "pitch", channel: i }, [automated(pitchTarget)], (tick, eOf) => [pitch(tick, eOf)]);
    }
  });

  for (const track of song.mixer.tracks) {
    const t = trackIndex.get(track.id)!;
    if (!track.muted) {
      const controls = (["volume", "pan", "stereo"] as const).map((control) => {
        const target: AutomationTarget = { kind: "mixer", track: track.id, control };
        return { key: automated(target), value: valueOf(target, track[control]) };
      });
      const master = track.id === MASTER_TRACK_ID;
      const mainTarget: AutomationTarget = { kind: "main" };
      const main = valueOf(mainTarget, song.settings.volume);
      const keys = [...controls.map((c) => c.key), master ? automated(mainTarget) : null];
      add({ kind: "track", track: t }, keys, (tick, eOf) =>
        trackGains({ ...track, volume: controls[0].value(tick, eOf), pan: controls[1].value(tick, eOf), stereo: controls[2].value(tick, eOf) }, master ? levelGain(main(tick, eOf), DEFAULT_VOLUME) : (vca.get(track.id) ?? 1), master ? listening : {}),
      );
    }
    // Sends as the engine has them (to later tracks), in the same order.
    let sendIndex = 0;
    for (const send of track.sends) {
      const to = trackIndex.get(send.to);
      if (to === undefined || to <= t) continue;
      const target: AutomationTarget = { kind: "send", track: track.id, to: send.to };
      const level = valueOf(target, send.level);
      const silent = send.preFader && track.muted;
      add({ kind: "send", track: t, send: sendIndex++ }, [automated(target)], (tick, eOf) => [silent ? 0 : levelGain(level(tick, eOf), 1)]);
    }
    let effectIndex = 0;
    for (const effect of track.effects) {
      if (!effect) continue;
      const mixTarget: AutomationTarget = { kind: "effect", effect: effect.id };
      const mix = valueOf(mixTarget, effect.mix);
      add({ kind: "mix", track: t, effect: effectIndex }, [automated(mixTarget)], (tick, eOf) => [mix(tick, eOf)]);
      const gb = effect.grossBeat;
      if (gb) {
        const gross = (control: GrossControl): AutomationTarget => ({ kind: "grossBeat", effect: effect.id, control });
        for (const control of ["timeMix", "volumeMix", "attack", "release", "tension"] as const) {
          const value = valueOf(gross(control), gb[control]);
          add({ kind: "gross", track: t, effect: effectIndex, control }, [automated(gross(control))], (tick, eOf) => [value(tick, eOf)]);
        }
        // Slots, by number. Linked, a slot that isn't automated follows the other's automation.
        const time = { key: automated(gross("timeSlot")), value: valueOf(gross("timeSlot"), gb.timeSlot) };
        const volume = { key: automated(gross("volumeSlot")), value: valueOf(gross("volumeSlot"), gb.volumeSlot) };
        const timeDriver = !time.key && gb.linkSlots && volume.key ? volume : time;
        const volumeDriver = !volume.key && gb.linkSlots && time.key ? time : volume;
        add({ kind: "gross", track: t, effect: effectIndex, control: "timeSlot" }, [timeDriver.key], (tick, eOf) => [timeDriver.value(tick, eOf)]);
        add({ kind: "gross", track: t, effect: effectIndex, control: "volumeSlot" }, [volumeDriver.key], (tick, eOf) => [volumeDriver.value(tick, eOf)]);
      }
      const at = effect.autoTune;
      if (at)
        for (const control of AUTO_TUNE_CONTROLS) {
          const target: AutomationTarget = { kind: "autoTune", effect: effect.id, control };
          const value = valueOf(target, AUTO_TUNE_CONTROL_INFO[control].get(at));
          add({ kind: "tune", track: t, effect: effectIndex, control }, [automated(target)], (tick, eOf) => [engineControlValue(control, value(tick, eOf))]);
        }
      const pw = effect.pitchWheel;
      if (pw)
        for (const control of PITCH_WHEEL_CONTROLS) {
          const target: AutomationTarget = { kind: "pitchWheel", effect: effect.id, control };
          const value = valueOf(target, pitchWheelValue(pw, control));
          add({ kind: "wheel", track: t, effect: effectIndex, control }, [automated(target)], (tick, eOf) => [engineWheelValue(pw, control, value(tick, eOf))]);
        }
      const eb = effect.echoBoy;
      if (eb) {
        // Each engine lane from the controls that move it: the settings at the tick, as the engine has them.
        const controls = (Object.keys(ECHO_CONTROL_SPECS) as EchoControl[]).map((control) => {
          const target: AutomationTarget = { kind: "echoBoy", effect: effect.id, control };
          return { control, key: automated(target), value: valueOf(target, ECHO_CONTROL_SPECS[control].get(eb)) };
        });
        for (const lane of Object.keys(ECHO_LANES) as EchoLane[]) {
          // (Only Rhythm Echo has taps.)
          if (lane === "taps" && eb.mode !== "rhythm") continue;
          const moving = controls.filter((c) => LANES_OF[c.control].includes(lane));
          add({ kind: "echo", track: t, effect: effectIndex, control: lane }, moving.map((c) => c.key), (tick, eOf) => {
            const at = moving.reduce((settings, c) => (c.key ? ECHO_CONTROL_SPECS[c.control].set(settings, c.value(tick, eOf), song.settings.tempo) : settings), eb);
            return ECHO_LANES[lane](engineEchoBoy(at, song.settings.tempo));
          });
        }
      }
      const pq = effect.proQ;
      if (pq) {
        // Each band's automated controls, in the engine's units (frequency and Q as log2: lanes keep within ±64).
        // Gain Scale, automated, moves every band's gain and range lane (it's folded into them: the engine has no lane of its own for it).
        const scaleTarget: AutomationTarget = { kind: "proQ", effect: effect.id, band: 0, control: "gainScale" };
        const scaleKey = automated(scaleTarget);
        const scaleAt = valueOf(scaleTarget, pq.gainScale);
        const lane = (band: number, control: EqControl, own: number, toEngine: (v: number, tick: number, eOf?: Level) => number, scaled = false) => {
          const target: AutomationTarget = { kind: "proQ", effect: effect.id, band, control };
          const value = valueOf(target, own);
          add({ kind: "eq", track: t, effect: effectIndex, band, control }, [automated(target), scaled ? scaleKey : null], (tick, eOf) => [toEngine(value(tick, eOf), tick, eOf)]);
        };
        const scale = (b: EqBand, tick: number, eOf?: Level) => (hasGain(b.shape) ? scaleAt(tick, eOf) : 1);
        for (const b of pq.bands) {
          if (!b.enabled) continue;
          lane(b.id, "frequency", b.frequency, Math.log2);
          lane(b.id, "gain", b.gain, (v, tick, eOf) => v * scale(b, tick, eOf), true);
          lane(b.id, "q", b.q, Math.log2);
          lane(b.id, "range", b.range, (v, tick, eOf) => v * scale(b, tick, eOf), true);
        }
        const auto = pq.autoGain ? autoGain(pq) : 0;
        lane(0, "output", pq.output, (v) => v + auto);
        lane(0, "pan", pq.pan, (v) => v);
      }
      const ott = effect.ott;
      if (ott) {
        // As EchoBoy's: each engine lane from the controls that move it, the settings at the tick as the engine has them.
        const controls = OTT_CONTROLS.map((control) => {
          const target: AutomationTarget = { kind: "ott", effect: effect.id, control };
          return { control, key: automated(target), value: valueOf(target, OTT_CONTROL_SPECS[control].get(ott)) };
        });
        for (const lane of Object.keys(OTT_LANES) as OttLane[]) {
          const moving = controls.filter((c) => OTT_LANES_OF[c.control].includes(lane));
          add({ kind: "ott", track: t, effect: effectIndex, control: lane }, moving.map((c) => c.key), (tick, eOf) => {
            const at = moving.reduce((settings, c) => (c.key ? OTT_CONTROL_SPECS[c.control].set(settings, c.value(tick, eOf)) : settings), ott);
            return OTT_LANES[lane](engineOtt(at));
          });
        }
      }
      const pc = effect.proC;
      if (pc) {
        // As OTT's: each engine lane from the controls that move it, the settings at the tick as the engine has them.
        const controls = PRO_C_CONTROLS.map((control) => {
          const target: AutomationTarget = { kind: "proC", effect: effect.id, control };
          return { control, key: automated(target), value: valueOf(target, PRO_C_CONTROL_SPECS[control].get(pc)) };
        });
        for (const lane of Object.keys(PRO_C_LANES) as ProCLane[]) {
          const moving = controls.filter((c) => PRO_C_LANES_OF[c.control].includes(lane));
          add({ kind: "comp", track: t, effect: effectIndex, control: lane }, moving.map((c) => c.key), (tick, eOf) => {
            const at = moving.reduce((settings, c) => (c.key ? PRO_C_CONTROL_SPECS[c.control].set(settings, c.value(tick, eOf)) : settings), pc as ProCState);
            return PRO_C_LANES[lane](engineProC(at));
          });
        }
      }
      const pl = effect.proL;
      if (pl) {
        // Each control its own lane, in the engine's units (Attack and Release as the release stage has them).
        for (const control of PRO_L_CONTROLS) {
          const target: AutomationTarget = { kind: "proL", effect: effect.id, control };
          const key = automated(target);
          if (!key) continue;
          const value = valueOf(target, PRO_L_CONTROL_SPECS[control].get(pl));
          add({ kind: "limiter", track: t, effect: effectIndex, control }, [key], (tick, eOf) => {
            const at = PRO_L_CONTROL_SPECS[control].set(pl as ProLState, value(tick, eOf));
            return PRO_L_LANES[control](engineProL(at), at);
          });
        }
      }
      const rv = effect.reverb;
      if (rv) {
        // As OTT's: each engine lane from the controls that move it, the settings at the tick as the engine has them.
        const controls = REVERB_CONTROLS.map((control) => {
          const target: AutomationTarget = { kind: "reverb", effect: effect.id, control };
          return { control, key: automated(target), value: valueOf(target, REVERB_CONTROL_SPECS[control].get(rv)) };
        });
        for (const lane of REVERB_LANE_NAMES) {
          const moving = controls.filter((c) => REVERB_LANES_OF[c.control].includes(lane));
          add({ kind: "verb", track: t, effect: effectIndex, control: lane }, moving.map((c) => c.key), (tick) => {
            const at = moving.reduce((settings, c) => (c.key ? REVERB_CONTROL_SPECS[c.control].set(settings, c.value(tick)) : settings), rv as ReverbState);
            return REVERB_LANES[lane](engineReverb(at, song.settings.tempo, 0, true));
          });
        }
      }
      const pm = effect.panMan;
      if (pm) {
        for (const control of PAN_ENGINE_CONTROLS) {
          const target: AutomationTarget = { kind: "panMan", effect: effect.id, control };
          const value = valueOf(target, pm[control]);
          const scale = PAN_LANE_SCALE[control];
          add({ kind: "panman", track: t, effect: effectIndex, control }, [automated(target)], (tick, eOf) => [value(tick, eOf) / scale]);
        }
        // Smoothing, Feel and Groove reshape a pattern mode's pattern: automated, it's sent whole, evenly sampled.
        if (isPatternMode(pm.mode)) {
          const shaping = PAN_SHAPING_CONTROLS.map((control) => {
            const target: AutomationTarget = { kind: "panMan", effect: effect.id, control };
            return { control, key: automated(target), value: valueOf(target, pm[control]) };
          });
          add({ kind: "panman", track: t, effect: effectIndex, control: "shape" }, shaping.map((c) => c.key), (tick, eOf) => {
            const at = shaping.reduce((settings, c) => (c.key ? { ...settings, [c.control]: c.value(tick, eOf) } : settings), pm);
            return panShape(at);
          });
        }
      }
      effectIndex++;
    }
  }

  // Plugins' parameters: wherever no clip says, the plugin keeps its own value (-1). A modulated one moves
  // from that by its amount in the plugin's own 0..1 (the engine adds it: only the plugin knows its value).
  const pluginKeys = new Set<string>();
  const pluginTargets = [...song.automations.map((a) => a.target), ...[...mods.values()].map((m) => m.link.target)];
  for (const target of pluginTargets) {
    if (target.kind !== "plugin") continue;
    const key = targetKey(target);
    if (pluginKeys.has(key) || !controlOf(song, target).exists) continue;
    const placed = !held.has(key) ? index.get(key) : undefined;
    const link = mods.get(key);
    const modulator = link ? modulators.get(link.index) : undefined;
    if (!placed && modulator === undefined) continue;
    pluginKeys.add(key);
    const laneTarget: EngineLaneTarget = { kind: "param", owner: target.owner, id: target.id, param: target.param, index: target.index };
    const points = placed
      ? sampleLane((tick) => {
          const found = clipAtTick(placed, tick);
          return [found ? placedValue(found.placed, tick, barTicks) : -1];
        }, breaksOf([key]), from, to, stepOf([key]))
      : { ticks: [0], values: [-1] };
    lanes.push({ target: laneTarget, ...points, ...(modulator !== undefined && link && { modulator, amount: link.link.amount }) });
  }
  return lanes;
}
