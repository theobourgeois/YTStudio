/**
 * A song as the audio engine plays it (`EngineSong`): one pattern, looped, with everything musical
 * already decided here, in tested TypeScript: swing, mutes, what volume, pan and velocity mean as
 * gains, and the mixer's routing as an order to run its tracks in. The engine (`engine/src/Song.cpp`)
 * only has to play samples at the right moments and add up tracks as it's told.
 */
import { DEFAULT_FADER, DEFAULT_PRECOMPUTED, DEFAULT_VELOCITY, DEFAULT_VOLUME, MASTER_TRACK_ID, patternSteps } from "./project.ts";
import { type Channel, type MixerTrack, type MusicProject, PPQ, type Pattern, type Precomputed, ROOT_PITCH, STEP_TICKS } from "./types.ts";

export interface EngineChannel {
  id: string;
  /** Its name, for its plugin's window title. */
  name: string;
  /** The sample to play: a media id here, which the server turns into the file's path. Null is silence. */
  sample: string | null;
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
  /**
   * The mixer's tracks in the order to run them: every track after all those sending to it, and the
   * master last (what it puts out is what's heard).
   */
  tracks: EngineTrack[];
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

function engineTracks(song: MusicProject): { tracks: EngineTrack[]; index: Map<string, number> } {
  const ordered = trackOrder(song.mixer.tracks);
  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const numbers = new Map(song.mixer.tracks.map((t, i) => [t.id, i]));
  const tracks = ordered.map((track): EngineTrack => {
    const gain = track.muted ? 0 : faderGain(track.volume);
    const number = numbers.get(track.id)!;
    return {
      id: track.id,
      name: track.name ?? (number === 0 ? "Master" : `Insert ${number}`),
      effects: track.effects.flatMap((e) => (e ? [{ id: e.id, plugin: { id: e.plugin.id, state: "" }, enabled: e.enabled, mix: e.mix }] : [])),
      gains: mixerPanGains(track.pan).map((g) => g * gain) as EngineTrack["gains"],
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

function engineChannel(channel: Channel, track: number): EngineChannel {
  const gain = channel.muted ? 0 : levelGain(channel.volume, DEFAULT_VOLUME);
  const [left, right] = panGains(channel.pan);
  const { enabled, ...envelope } = channel.envelope;
  const untouched = (Object.keys(DEFAULT_PRECOMPUTED) as (keyof Precomputed)[]).every((key) => channel.precomputed[key] === DEFAULT_PRECOMPUTED[key]);
  return {
    id: channel.id,
    name: channel.name,
    sample: channel.sampleId,
    gainLeft: gain * left,
    gainRight: gain * right,
    pitch: channel.pitch,
    envelope: enabled ? envelope : null,
    cutSelf: channel.cutSelf,
    precomputed: untouched ? null : channel.precomputed,
    plugin: channel.kind === "plugin" && channel.plugin ? { id: channel.plugin.id, state: "" } : null,
    track,
  };
}

/**
 * The song playing `patternId` on a loop (or its first pattern): the whole pattern, or only `loop`,
 * a part of it (notes that start in it play; one already sounding when it starts doesn't).
 */
export function compileSong(song: MusicProject, patternId: string | null, loop: LoopRange | null = null): EngineSong {
  const pattern = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const [beats, unit] = song.settings.timeSignature;
  const beatTicks = (PPQ * 4) / unit;
  const patternTicks = patternSteps(pattern, song.settings.timeSignature) * STEP_TICKS;
  const from = loop && loop.end > loop.start ? Math.max(0, loop.start) : 0;
  const to = loop && loop.end > loop.start ? loop.end : patternTicks;
  const loopTicks = to - from;
  const notes: EngineNote[] = [];
  song.channels.forEach((channel, index) => {
    for (const note of pattern.notes[channel.id] ?? []) {
      // Past the end (of the loop, or of a set length): kept in the song, not played.
      if (note.start >= to) break;
      if (note.start < from || note.muted) continue;
      notes.push({
        channel: index,
        tick: swungTick(note.start, song.settings.swing) - from,
        length: note.length,
        pitch: note.pitch - ROOT_PITCH,
        gain: levelGain(note.velocity, DEFAULT_VELOCITY),
        key: note.pitch,
        velocity: note.velocity,
        pan: note.pan,
      });
    }
  });
  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  const { tracks, index } = engineTracks(song);
  const master = index.get(MASTER_TRACK_ID)!;
  return {
    tempo: song.settings.tempo,
    ppq: PPQ,
    loopTicks,
    offsetTicks: from,
    beatTicks,
    barTicks: beatTicks * beats,
    channels: song.channels.map((channel) => engineChannel(channel, index.get(channel.mixerTrack) ?? master)),
    notes,
    tracks,
  };
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
