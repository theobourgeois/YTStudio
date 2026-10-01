/**
 * A song as the audio engine plays it (`EngineSong`): one pattern looped (pattern mode), or the playlist
 * (song mode), with everything musical already decided here, in tested TypeScript: swing, mutes, what
 * volume, pan and velocity mean as gains, the arrangement flattened into notes on the song's time, and
 * the mixer's routing as an order to run its tracks in. The engine (`engine/src/Song.cpp`) only has to
 * play samples and audio clips at the right moments and add up tracks as it's told.
 */
import { automationIndex, clipAtTick, controlBreaks, controlOf, placedValue, targetKey } from "./automation.ts";
import { clipContext, clipLength, pitchSpeed, songTicks, trackAt } from "./playlist.ts";
import { DEFAULT_FADER, DEFAULT_VELOCITY, DEFAULT_VOLUME, MASTER_TRACK_ID, patternSteps, precomputedUntouched } from "./project.ts";
import { type AutomationTarget, type Channel, type MixerTrack, type MusicProject, PPQ, type Pattern, type Precomputed, ROOT_PITCH, STEP_TICKS } from "./types.ts";

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
 * track's gain matrix (`EngineTrack.gains`), a send's gain, an effect's mix, or a plugin's parameter (0..1,
 * or -1 where the plugin keeps its own value: before any clip of it).
 */
export type EngineLaneTarget =
  | { kind: "channel"; channel: number }
  | { kind: "track"; track: number }
  | { kind: "send"; track: number; send: number }
  | { kind: "mix"; track: number; effect: number }
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

function engineTracks(song: MusicProject): { tracks: EngineTrack[]; index: Map<string, number> } {
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
      effects: track.effects.flatMap((e) => (e ? [{ id: e.id, plugin: { id: e.plugin.id, state: "" }, enabled: e.enabled, mix: e.mix }] : [])),
      gains: trackGains(track, main),
      latencyOffset: track.latencyOffset,
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
 * already sounding when it starts isn't.
 */
export function compileSong(song: MusicProject, patternId: string | null, loop: LoopRange | null = null, mode: PlayMode = "pattern", held: ReadonlySet<string> = NONE_HELD): EngineSong {
  const pattern = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const [beats, unit] = song.settings.timeSignature;
  const beatTicks = (PPQ * 4) / unit;
  const length = mode === "song" ? songTicks(song) : patternSteps(pattern, song.settings.timeSignature) * STEP_TICKS;
  const from = loop && loop.end > loop.start ? Math.max(0, loop.start) : 0;
  const to = loop && loop.end > loop.start ? loop.end : length;
  const notes = mode === "song" ? songNotes(song, from, to) : patternNotes(song, pattern, from, to);
  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  const played = new Set(notes.map((n) => n.channel));
  const { tracks, index } = engineTracks(song);
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

/** How far a lane may be from the control it draws (in its own units: a gain, a plugin's 0..1), between its points. */
const LANE_TOLERANCE = 1e-3;
/** A lane is looked at every `step` ticks at least (a beat, or closer for an LFO), then closer where it bends, down to `LANE_FINEST`. */
const LANE_FINEST = 1 / 8;
/** Just before a tick: the value a control arrives at, before it jumps. */
const JUST_BEFORE = 1e-6;

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
      add({ kind: "mix", track: t, effect: effectIndex++ }, [automated(mixTarget)], (tick) => [mix(tick)]);
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

/**
 * A function of the song's ticks drawn as straight lines between points, from `from` to `to`, counted from
 * `from`: looked at every `step` ticks and more closely where a straight line would be further than
 * `LANE_TOLERANCE` from it, then thinned where the lines are straight. At each of `breaks` (where it may
 * jump) it has two points on the tick: what it arrives at, and what it jumps to.
 */
export function sampleLane(value: (tick: number) => number[], breaks: readonly number[], from: number, to: number, step = PPQ): { ticks: number[]; values: number[] } {
  const edges = [from, ...breaks.filter((b) => b > from && b < to), to];
  const ticks: number[] = [];
  const values: number[] = [];
  for (let e = 0; e + 1 < edges.length; e++) {
    const a = edges[e];
    const b = edges[e + 1];
    // One run of points without jumps: sampled, refined, thinned.
    const run: { tick: number; value: number[] }[] = [];
    const steps = Math.max(1, Math.ceil((b - a) / step));
    let previous = { tick: a, value: value(a) };
    run.push(previous);
    // Looked at in quarters, not only the middle: an S (a smooth or double curve, half a wave) crosses its
    // straight line there, as if it were one.
    const refine = (left: { tick: number; value: number[] }, right: { tick: number; value: number[] }) => {
      if (right.tick - left.tick <= LANE_FINEST) return;
      const span = right.tick - left.tick;
      const middle = { tick: left.tick + span / 2, value: value(left.tick + span / 2) };
      const off = (at: number, got: number[]) => got.some((v, i) => Math.abs(v - (left.value[i] + (right.value[i] - left.value[i]) * at)) > LANE_TOLERANCE);
      if (!off(0.5, middle.value) && !off(0.25, value(left.tick + span / 4)) && !off(0.75, value(left.tick + (span * 3) / 4))) return;
      refine(left, middle);
      run.push(middle);
      refine(middle, right);
    };
    for (let k = 1; k <= steps; k++) {
      const tick = k === steps ? b : a + ((b - a) * k) / steps;
      const next = { tick, value: value(k === steps ? b - JUST_BEFORE : tick) };
      refine(previous, next);
      run.push(next);
      previous = next;
    }
    for (const point of thin(run)) {
      // Rounded (what's sent to the engine on every edit is smaller): far finer than a sample, or a gain heard.
      const tick = Math.round((point.tick - from) * 1e4) / 1e4;
      const rounded = point.value.map((v) => Math.round(v * 1e6) / 1e6);
      const n = rounded.length;
      // Where the last run ended on the value this one starts at, there's no jump: one point does.
      if (ticks.length && ticks[ticks.length - 1] === tick && rounded.every((v, c) => v === values[values.length - n + c])) continue;
      ticks.push(tick);
      values.push(...rounded);
    }
  }
  return { ticks, values };
}

/** Douglas–Peucker: the points of a polyline that keep it within `LANE_TOLERANCE` of what it was. */
function thin(run: { tick: number; value: number[] }[]): { tick: number; value: number[] }[] {
  if (run.length <= 2) return run;
  const keep = new Uint8Array(run.length);
  keep[0] = keep[run.length - 1] = 1;
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const f = (run[k].tick - run[i].tick) / (run[j].tick - run[i].tick || 1);
      let off = 0;
      for (let c = 0; c < run[k].value.length; c++) off = Math.max(off, Math.abs(run[k].value[c] - (run[i].value[c] + (run[j].value[c] - run[i].value[c]) * f)));
      if (off > worst) {
        worst = off;
        at = k;
      }
    }
    if (worst > LANE_TOLERANCE) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return run.filter((_, i) => keep[i]);
}
