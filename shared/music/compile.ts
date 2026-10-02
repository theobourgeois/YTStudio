/**
 * A song as the audio engine plays it (`EngineSong`): one pattern looped (pattern mode), or the playlist
 * (song mode), with everything musical already decided here, in tested TypeScript: swing, mutes, what
 * volume, pan and velocity mean as gains, the arrangement flattened into notes on the song's time, and
 * the mixer's routing as an order to run its tracks in. The engine (`engine/src/Song.cpp`) only has to
 * play samples and audio clips at the right moments and add up tracks as it's told.
 */
import { automationIndex, clipAtTick, controlBreaks, controlOf, placedValue, targetKey } from "./automation.ts";
import { clipContext, clipLength, pitchSpeed, songTicks, trackAt } from "./playlist.ts";
import { LANE_FINEST, sampleLane } from "./sampling.ts";
import { type EngineGrossBeat, engineGrossBeat } from "./gross-beat.ts";
import { GROSS_SLOTS } from "./gross-beat-presets.ts";
import { type EnginePanMan, enginePanMan } from "./panman.ts";
import { PAN_CONTROL_IDS } from "./panman-presets.ts";
import { DEFAULT_FADER, DEFAULT_VELOCITY, DEFAULT_VOLUME, MASTER_TRACK_ID, patternSteps, precomputedUntouched } from "./project.ts";
import { type AutomationTarget, type Channel, type GrossControl, type MixerTrack, type PanControl, type MusicProject, PPQ, type Pattern, type Precomputed, ROOT_PITCH, STEP_TICKS } from "./types.ts";

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
  /** Null: every note plays its whole sample. */
  envelope: { attack: number; decay: number; sustain: number; release: number } | null;
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
  /** A Gross Beat (ours, run by the engine itself: its `plugin.id` is `GROSS_BEAT_PLUGIN`'s): its settings and envelopes. */
  grossBeat?: EngineGrossBeat;
  /** A PanMan (ours, likewise: `PANMAN_PLUGIN`'s id): its settings and pattern. */
  panMan?: EnginePanMan;
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
  sends: { track: number; gain: number }[];
  /** Milliseconds added to its plugins' reported delay (`MixerTrack.latencyOffset`); the engine compensates for both. */
  latencyOffset: number;
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
   * How fast it plays its file: its channel's pitch as a ratio (`pitchSpeed`; 2 is an octave up, twice as
   * fast), as FL's Resample does. Seconds of the file per second of the song.
   */
  speed: number;
}

/**
 * What an automation lane drives in the engine, in the engine's own units: a channel's two gains, a mixer
 * track's gain matrix (`EngineTrack.gains`), a send's gain, an effect's mix, a Gross Beat's slot (its
 * number, 0..35) or mix (0..1), or a plugin's parameter (0..1, or -1 where the plugin keeps its own value:
 * before any clip of it).
 */
export type EngineLaneTarget =
  | { kind: "channel"; channel: number }
  | { kind: "track"; track: number }
  | { kind: "send"; track: number; send: number }
  | { kind: "mix"; track: number; effect: number }
  | { kind: "gross"; track: number; effect: number; control: GrossControl }
  | { kind: "panman"; track: number; effect: number; control: PanControl }
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
  /** The automated controls (song mode only): what they are over the loop. Without one, a control is as `channels` and `tracks` say. */
  lanes: EngineLane[];
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
  const waiting = new Map<string, number>(tracks.map((t) => [t.id, 0]));
  for (const track of tracks) for (const send of track.sends) waiting.set(send.to, (waiting.get(send.to) ?? 0) + 1);
  const order: MixerTrack[] = [];
  const done = new Set<string>();
  // Repeatedly take the first track nothing is still waiting to send to (a few hundred tracks at most).
  while (order.length < tracks.length) {
    const next = tracks.find((t) => !done.has(t.id) && t.id !== MASTER_TRACK_ID && waiting.get(t.id) === 0);
    if (!next) break;
    done.add(next.id);
    order.push(next);
    for (const send of next.sends) waiting.set(send.to, waiting.get(send.to)! - 1);
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

/** A mixer track's gain matrix from its fader, pan and stereo separation (and the main volume, for the master). */
function trackGains(track: Pick<MixerTrack, "invert" | "swap" | "stereo" | "pan" | "volume" | "muted">, main: number): EngineTrack["gains"] {
  const gain = track.muted ? 0 : faderGain(track.volume) * main;
  return after(mixerPanGains(track.pan), stereoGains(track)).map((g) => g * gain) as EngineTrack["gains"];
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

function engineTracks(song: MusicProject, armed: ReadonlySet<string>, mode: PlayMode = "pattern"): { tracks: EngineTrack[]; index: Map<string, number> } {
  const gross = grossSlots(song, mode);
  const ordered = trackOrder(song.mixer.tracks);
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const numbers = new Map(song.mixer.tracks.map((t, i) => [t.id, i]));
  const tracks = ordered.map((track): EngineTrack => {
    // The main volume is the master's, after its fader.
    const main = track.id === MASTER_TRACK_ID ? levelGain(song.settings.volume, DEFAULT_VOLUME) : 1;
    const number = numbers.get(track.id)!;
    return {
      id: track.id,
      name: track.name ?? (number === 0 ? "Master" : `Insert ${number}`),
      effects: track.effects.flatMap((e): EngineEffect[] => {
        if (!e) return [];
        const effect: EngineEffect = { id: e.id, plugin: { id: e.plugin.id, state: "" }, enabled: e.enabled, mix: e.mix };
        const slots = gross.get(e.id);
        if (e.panMan) return [{ ...effect, panMan: enginePanMan(e.panMan, e.id) }];
        return [e.grossBeat && slots ? { ...effect, grossBeat: engineGrossBeat(e.grossBeat, slots.time, slots.volume) } : effect];
      }),
      gains: trackGains(track, main),
      latencyOffset: track.latencyOffset,
      input: engineInput(track, armed.has(track.id)),
      sends: track.sends.flatMap((send) => {
        const to = index.get(send.to);
        return to !== undefined && to > index.get(track.id)! ? [{ track: to, gain: levelGain(send.level, 1) }] : [];
      }),
    };
  });
  return { tracks, index };
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
    cutSelf: channel.cutSelf,
    // An audio clip channel's too: prepared in memory, its clips play that instead of streaming the file.
    precomputed: untouched ? null : channel.precomputed,
    plugin: channel.kind === "plugin" && channel.plugin ? { id: channel.plugin.id, state: "" } : null,
    track,
  };
}

/**
 * The song as the engine should play it. In pattern mode, `patternId` (or the first pattern) on a loop: the
 * whole pattern, or only `loop`, a part of it. In song mode, the playlist: to the end of its last clip's bar
 * and round again, or only `loop`, a part of the song. Notes that start in the part played are heard; one
 * already sounding when it starts isn't. `armed`: the mixer tracks armed to record (the tab's, not the song's).
 */
export function compileSong(
  song: MusicProject,
  patternId: string | null,
  loop: LoopRange | null = null,
  mode: PlayMode = "pattern",
  held: ReadonlySet<string> = NONE_HELD,
  armed: ReadonlySet<string> = new Set(),
): EngineSong {
  const pattern = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const [beats, unit] = song.settings.timeSignature;
  const beatTicks = (PPQ * 4) / unit;
  const length = mode === "song" ? songTicks(song) : patternSteps(pattern, song.settings.timeSignature) * STEP_TICKS;
  const from = loop && loop.end > loop.start ? Math.max(0, loop.start) : 0;
  const to = loop && loop.end > loop.start ? loop.end : length;
  const notes = mode === "song" ? songNotes(song, from, to) : patternNotes(song, pattern, from, to);
  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  const played = new Set(notes.map((n) => n.channel));
  const { tracks, index } = engineTracks(song, armed, mode);
  const master = index.get(MASTER_TRACK_ID)!;
  return {
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
    // Automation only plays in song mode (Théo).
    lanes: mode === "song" ? automationLanes(song, index, from, to, held) : [],
  };
}

const NONE_HELD: ReadonlySet<string> = new Set();

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
      notes.push(engineNote(index, note, swungTick(note.start, song.settings.swing) - from, note.length));
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
        const at = truncated ? windowStart : swungTick(note.start, song.settings.swing);
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
    clips.push({ channel, tick: clip.start - from, length, seconds: clip.offset, speed: pitchSpeed(song.channels[channel].pitch) });
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
      const start = swungTick(note.start, song.settings.swing);
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
function automationLanes(song: MusicProject, trackIndex: Map<string, number>, from: number, to: number, held: ReadonlySet<string>): EngineLane[] {
  const index = automationIndex(song);
  if (!index.size || to <= from) return [];
  const { barTicks } = clipContext(song);
  const automated = (target: AutomationTarget) => {
    const key = targetKey(target);
    return !held.has(key) && index.has(key) ? key : null;
  };
  /** A control's value at a tick, as its own (a pan's -1..1), or its own value where no clip says. */
  const valueOf = (target: AutomationTarget, own: number) => {
    const key = targetKey(target);
    const placed = index.get(key);
    const info = controlOf(song, target);
    // Held by the hand (in a lane with other controls that aren't): its own value, as the hand has it.
    if (!placed || held.has(key)) return () => own;
    return (tick: number) => {
      const found = clipAtTick(placed, tick);
      return found ? info.toControl(placedValue(found.placed, tick, barTicks)) : own;
    };
  };
  const breaksOf = (keys: (string | null)[]) => {
    const all = new Set<number>();
    for (const key of keys) if (key) for (const tick of controlBreaks(index.get(key)!, from, to)) all.add(tick);
    return [...all].sort((a, b) => a - b);
  };
  /** How often a lane must be looked at to see its clips' LFOs (a quarter of the fastest one's cycle), else a beat. */
  const stepOf = (keys: (string | null)[]) => {
    let step = PPQ;
    for (const key of keys)
      if (key) for (const p of index.get(key)!) if (p.automation.lfo.enabled && p.automation.lfo.level) step = Math.min(step, barTicks / p.automation.lfo.speed / 4);
    return Math.max(LANE_FINEST * 4, step);
  };
  const lanes: EngineLane[] = [];
  const add = (target: EngineLaneTarget, keys: (string | null)[], value: (tick: number) => number[]) => {
    if (!keys.some(Boolean)) return;
    lanes.push({ target, ...sampleLane(value, breaksOf(keys), from, to, stepOf(keys)) });
  };

  song.channels.forEach((channel, i) => {
    if (channel.muted) return;
    const volumeTarget: AutomationTarget = { kind: "channel", channel: channel.id, control: "volume" };
    const panTarget: AutomationTarget = { kind: "channel", channel: channel.id, control: "pan" };
    const volume = valueOf(volumeTarget, channel.volume);
    const pan = valueOf(panTarget, channel.pan);
    add({ kind: "channel", channel: i }, [automated(volumeTarget), automated(panTarget)], (tick) => channelGains({ muted: false, volume: volume(tick), pan: pan(tick) }));
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
      add({ kind: "track", track: t }, keys, (tick) =>
        trackGains({ ...track, volume: controls[0].value(tick), pan: controls[1].value(tick), stereo: controls[2].value(tick) }, master ? levelGain(main(tick), DEFAULT_VOLUME) : 1),
      );
    }
    // Sends as the engine has them (to later tracks), in the same order.
    let sendIndex = 0;
    for (const send of track.sends) {
      const to = trackIndex.get(send.to);
      if (to === undefined || to <= t) continue;
      const target: AutomationTarget = { kind: "send", track: track.id, to: send.to };
      const level = valueOf(target, send.level);
      add({ kind: "send", track: t, send: sendIndex++ }, [automated(target)], (tick) => [levelGain(level(tick), 1)]);
    }
    let effectIndex = 0;
    for (const effect of track.effects) {
      if (!effect) continue;
      const mixTarget: AutomationTarget = { kind: "effect", effect: effect.id };
      const mix = valueOf(mixTarget, effect.mix);
      add({ kind: "mix", track: t, effect: effectIndex }, [automated(mixTarget)], (tick) => [mix(tick)]);
      const gb = effect.grossBeat;
      if (gb) {
        const gross = (control: GrossControl): AutomationTarget => ({ kind: "grossBeat", effect: effect.id, control });
        for (const control of ["timeMix", "volumeMix"] as const) {
          const value = valueOf(gross(control), gb[control]);
          add({ kind: "gross", track: t, effect: effectIndex, control }, [automated(gross(control))], (tick) => [value(tick)]);
        }
        // Slots, by number. Linked, a slot that isn't automated follows the other's automation.
        const time = { key: automated(gross("timeSlot")), value: valueOf(gross("timeSlot"), gb.timeSlot) };
        const volume = { key: automated(gross("volumeSlot")), value: valueOf(gross("volumeSlot"), gb.volumeSlot) };
        const timeDriver = !time.key && gb.linkSlots && volume.key ? volume : time;
        const volumeDriver = !volume.key && gb.linkSlots && time.key ? time : volume;
        add({ kind: "gross", track: t, effect: effectIndex, control: "timeSlot" }, [timeDriver.key], (tick) => [timeDriver.value(tick)]);
        add({ kind: "gross", track: t, effect: effectIndex, control: "volumeSlot" }, [volumeDriver.key], (tick) => [volumeDriver.value(tick)]);
      }
      const pm = effect.panMan;
      if (pm)
        for (const control of PAN_CONTROL_IDS) {
          const target: AutomationTarget = { kind: "panMan", effect: effect.id, control };
          const value = valueOf(target, pm[control]);
          add({ kind: "panman", track: t, effect: effectIndex, control }, [automated(target)], (tick) => [value(tick)]);
        }
      effectIndex++;
    }
  }

  // Plugins' parameters: wherever no clip says, the plugin keeps its own value (-1).
  const pluginKeys = new Set<string>();
  for (const automation of song.automations) {
    const target = automation.target;
    if (target.kind !== "plugin") continue;
    const key = automated(target);
    if (!key || pluginKeys.has(key) || !controlOf(song, target).exists) continue;
    pluginKeys.add(key);
    const placed = index.get(key)!;
    add({ kind: "param", owner: target.owner, id: target.id, param: target.param, index: target.index }, [key], (tick) => {
      const found = clipAtTick(placed, tick);
      return [found ? placedValue(found.placed, tick, barTicks) : -1];
    });
  }
  return lanes;
}
