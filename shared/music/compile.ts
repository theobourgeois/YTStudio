/**
 * A song as the audio engine plays it (`EngineSong`): one pattern, looped, with everything musical
 * already decided here, in tested TypeScript: swing, mutes, and what volume, pan and velocity mean as
 * gains. The engine (`engine/src/Song.cpp`) only has to play samples at the right moments.
 */
import { DEFAULT_VELOCITY, DEFAULT_VOLUME } from "./project.ts";
import { type Channel, type MusicProject, PPQ, ROOT_PITCH, STEP_TICKS } from "./types.ts";

export interface EngineChannel {
  id: string;
  /** The sample to play: a media id here, which the server turns into the file's path. Null is silence. */
  sample: string | null;
  /** Linear gains of each side (volume, pan and mute together). */
  gainLeft: number;
  gainRight: number;
  /** Semitones added to every note. */
  pitch: number;
  /** Null: every note plays its whole sample. */
  envelope: { attack: number; decay: number; sustain: number; release: number } | null;
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
}

export interface EngineSong {
  tempo: number;
  /** Ticks per quarter note. */
  ppq: number;
  /** The loop's length, in ticks. */
  loopTicks: number;
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
  return { id: channel.id, sample: channel.sampleId, gainLeft: gain * left, gainRight: gain * right, pitch: channel.pitch, envelope: enabled ? envelope : null };
}

/** The song playing `patternId` on a loop (or its first pattern). */
export function compileSong(song: MusicProject, patternId: string | null): EngineSong {
  const pattern = song.patterns.find((p) => p.id === patternId) ?? song.patterns[0];
  const [beats, unit] = song.settings.timeSignature;
  const beatTicks = (PPQ * 4) / unit;
  const notes: EngineNote[] = [];
  song.channels.forEach((channel, index) => {
    for (const note of pattern.notes[channel.id] ?? []) {
      notes.push({
        channel: index,
        tick: swungTick(note.start, song.settings.swing),
        length: note.length,
        pitch: note.pitch - ROOT_PITCH,
        gain: levelGain(note.velocity, DEFAULT_VELOCITY),
      });
    }
  });
  notes.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  return {
    tempo: song.settings.tempo,
    ppq: PPQ,
    loopTicks: pattern.steps * STEP_TICKS,
    beatTicks,
    barTicks: beatTicks * beats,
    channels: song.channels.map(engineChannel),
    notes,
  };
}
