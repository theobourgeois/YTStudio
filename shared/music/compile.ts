/**
 * A song as the audio engine plays it (`EngineSong`): one pattern, looped, with everything musical
 * already decided here, in tested TypeScript: swing, mutes, and what volume, pan and velocity mean as
 * gains. The engine (`engine/src/Song.cpp`) only has to play samples at the right moments.
 */
import { DEFAULT_PRECOMPUTED, DEFAULT_VELOCITY, DEFAULT_VOLUME, patternSteps } from "./project.ts";
import { type Channel, type MusicProject, PPQ, type Precomputed, ROOT_PITCH, STEP_TICKS } from "./types.ts";

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
}

/**
 * A level (0..1) as a gain: `unity` plays the sample as it is, above it is louder (up to +4 dB at 1),
 * and the curve is squared so the low end of a knob isn't all of the audible range.
 */
export const levelGain = (level: number, unity: number) => (level / unity) ** 2;

/** How much of each side a pan leaves: the centre is both at full, as in FL Studio. */
export const panGains = (pan: number): [number, number] => [Math.min(1, 1 - pan), Math.min(1, 1 + pan)];

/** The most a step is delayed by swing: half a step, at full swing. */
const MAX_SWING = STEP_TICKS / 2;

/** Where a note plays with swing: every second step (the off sixteenths) is late. */
export const swungTick = (start: number, swing: number) => (start % (2 * STEP_TICKS) === STEP_TICKS ? start + swing * MAX_SWING : start);

function engineChannel(channel: Channel): EngineChannel {
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
  return {
    tempo: song.settings.tempo,
    ppq: PPQ,
    loopTicks,
    offsetTicks: from,
    beatTicks,
    barTicks: beatTicks * beats,
    channels: song.channels.map(engineChannel),
    notes,
  };
}
