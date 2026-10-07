/**
 * Convert to notes (docs/fl-studio/stems-and-notes.md; FL Studio's Edison "Convert to score and dump to piano
 * roll"): what the server heard in an audio clip's file (`transcribe.ts`) made into a pattern of notes in the
 * song's time, on a sampler of its own (a tone, or the starter kit's kick, snare and hat for drums), placed under
 * the clip. The sampler is a placeholder: replace it with any instrument (the channel's Replace).
 */
import { clamp } from "../math.ts";
import { STEP_TICKS, ROOT_PITCH, type MusicProject } from "./types.ts";
import { addChannels, addPattern, setChannelNotes } from "./edits.ts";
import { addNotes, type NewNote } from "./notes.ts";
import { addClips, clipContext, clipEnd } from "./playlist.ts";
import { DEFAULT_VELOCITY, MAX_NAME, MAX_PATTERN_TICKS, MAX_PLAYLIST_TRACKS } from "./project.ts";
import { type SongScale, snapToScale } from "./scales.ts";
import { type Drum, HIGHEST_KEY, type HeardAudio, type HeardNote, LOWEST_KEY, type PickSettings, minFramesOf, pickDrumHits, pickNotes } from "./transcribe.ts";

export const CONVERT_KINDS = ["melodic", "drums"] as const;
export type ConvertKind = (typeof CONVERT_KINDS)[number];

/** Convert to notes' settings (its window's; the assistant's `convert_to_notes`). */
export interface ConvertSettings {
  /** Notes of any pitch (Basic Pitch), or drum hits (kick, snare, hat). */
  kind: ConvertKind;
  /** 0..1: how readily a sound counts as a note or a hit (0.5: Basic Pitch's own thresholds). */
  sensitivity: number;
  /** Notes shorter than this many milliseconds are dropped (melodic). */
  shortest: number;
  /** The lowest and highest MIDI notes kept (melodic). */
  lowest: number;
  highest: number;
  /** Starts and ends moved onto a grid of this many ticks; 0 leaves them where they were heard. */
  quantize: number;
  /** Pitches moved to the song's scale, when it has one (melodic). */
  snapToScale: boolean;
}

export const DEFAULT_CONVERT: ConvertSettings = {
  kind: "melodic",
  sensitivity: 0.5,
  shortest: 128,
  lowest: LOWEST_KEY,
  highest: HIGHEST_KEY,
  quantize: STEP_TICKS,
  snapToScale: false,
};

/** Settings as given (the assistant's, or kept from an older version), each within its range. */
export function convertSettings(input: Partial<Record<keyof ConvertSettings, unknown>>, base: ConvertSettings = DEFAULT_CONVERT): ConvertSettings {
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback);
  const lowest = Math.round(num(input.lowest, base.lowest, LOWEST_KEY, HIGHEST_KEY));
  return {
    kind: input.kind === "drums" || input.kind === "melodic" ? input.kind : base.kind,
    sensitivity: num(input.sensitivity, base.sensitivity, 0, 1),
    shortest: num(input.shortest, base.shortest, 10, 2000),
    lowest,
    highest: Math.round(num(input.highest, base.highest, lowest, HIGHEST_KEY)),
    quantize: Math.round(num(input.quantize, base.quantize, 0, 4 * 96 * 4)),
    snapToScale: typeof input.snapToScale === "boolean" ? input.snapToScale : base.snapToScale,
  };
}

/**
 * Basic Pitch's thresholds for a sensitivity: 0.5 is its own (an onset at 0.5, a note lasting while above 0.3);
 * more sensitive lowers both (0.1 and 0.1 at 1), less raises them (0.9 and 0.5 at 0).
 */
export const pickSettings = (settings: ConvertSettings): PickSettings => ({
  onsetThreshold: clamp(0.5 + (0.5 - settings.sensitivity) * 0.8, 0.05, 0.95),
  frameThreshold: clamp(0.3 + (0.5 - settings.sensitivity) * 0.4, 0.05, 0.95),
  minFrames: minFramesOf(settings.shortest),
  lowest: settings.lowest,
  highest: settings.highest,
});

/** The part of the file converted and how its seconds become the song's ticks (an audio clip's, or the whole file at its channel's speed). */
export interface ConvertWindow {
  /** File seconds from and to. */
  from: number;
  to: number;
  /** File seconds a tick of the song plays (`ClipContext.fileSecondsPerTick`). */
  secondsPerTick: number;
}

/** One channel's notes in the pattern made: the melody's, or one drum's. */
export interface ConvertedPart {
  drum: Drum | null;
  notes: NewNote[];
}

/** The notes heard, in ticks from the window's start (each part's, in order: the melody, or kick, snare, hat). */
export function convertedParts(heard: HeardAudio, settings: ConvertSettings, window: ConvertWindow, scale?: SongScale | null): ConvertedPart[] {
  const toNotes = (heardNotes: readonly HeardNote[], drum: boolean): NewNote[] => {
    const loudest = Math.max(1e-6, ...heardNotes.map((n) => n.level));
    const grid = settings.quantize;
    const made: NewNote[] = [];
    for (const n of heardNotes) {
      if (n.end <= window.from || n.start >= window.to) continue;
      let start = (Math.max(n.start, window.from) - window.from) / window.secondsPerTick;
      let end = (Math.min(n.end, window.to) - window.from) / window.secondsPerTick;
      if (grid >= 1) {
        start = Math.round(start / grid) * grid;
        end = drum ? start + grid : Math.max(start + grid, Math.round(end / grid) * grid);
      } else if (drum) end = start + STEP_TICKS;
      start = Math.round(start);
      const length = Math.max(1, Math.round(end) - start);
      if (start >= MAX_PATTERN_TICKS) continue;
      const pitch = drum ? ROOT_PITCH : scale && settings.snapToScale ? snapToScale(scale, n.pitch) : n.pitch;
      made.push({ start, length, pitch, velocity: clamp((n.level / loudest) * DEFAULT_VELOCITY, 0.05, 1) });
    }
    return tidyNotes(made);
  };
  if (settings.kind === "melodic") return [{ drum: null, notes: toNotes(pickNotes(heard, pickSettings(settings)), false) }];
  const hits = pickDrumHits(heard, settings.sensitivity);
  return (["kick", "snare", "hat"] as const).map((drum) => ({
    drum,
    notes: toNotes(
      hits.filter((h) => h.drum === drum).map((h) => ({ start: h.time, end: h.time + STEP_TICKS * window.secondsPerTick, pitch: ROOT_PITCH, level: h.level })),
      true,
    ),
  }));
}

/**
 * Notes in order, without two of a pitch starting together (the louder kept) and with each note ending by the
 * next of its pitch (quantizing can push them into each other).
 */
function tidyNotes(notes: NewNote[]): NewNote[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch || (b.velocity ?? 0) - (a.velocity ?? 0));
  const out: NewNote[] = [];
  const lastOf = new Map<number, NewNote>();
  for (const note of sorted) {
    const last = lastOf.get(note.pitch);
    if (last && last.start === note.start) continue;
    if (last && last.start + last.length > note.start) last.length = note.start - last.start;
    const copy = { ...note };
    out.push(copy);
    lastOf.set(note.pitch, copy);
  }
  return out;
}

/** A channel made for the notes: its id, name and sample (the tone, or a kit drum). */
export interface ConvertChannel {
  id: string;
  name: string;
  sampleId: string | null;
}

/**
 * The conversion in the song: a sampler channel for each part with notes, a new pattern holding them, and (`place`)
 * a clip of it under the audio clip it came from, on the first free track below it, as long as that clip. One
 * edit. Parts without notes make nothing; with none at all the song is returned as it was.
 */
export function addConvertedPattern(
  song: MusicProject,
  pattern: { id: string; name: string },
  parts: readonly { channel: ConvertChannel; notes: readonly NewNote[] }[],
  place: { clipId: number } | null,
): MusicProject {
  const used = parts.filter((p) => p.notes.length);
  if (!used.length) return song;
  let next = addChannels(
    song,
    used.map((p) => ({ id: p.channel.id, name: p.channel.name, sampleId: p.channel.sampleId })),
  );
  next = addPattern(next, { id: pattern.id, name: pattern.name.slice(0, MAX_NAME) });
  for (const part of used) next = setChannelNotes(next, pattern.id, part.channel.id, (notes) => addNotes(notes, part.notes).notes);
  const clip = place && song.playlist.clips.find((c) => c.id === place.clipId);
  if (!clip) return next;
  const ctx = clipContext(next);
  const start = clip.start;
  const end = clipEnd(clip, ctx);
  const busy = (track: number) => next.playlist.clips.some((c) => c.track === track && c.start < end && clipEnd(c, ctx) > start);
  let track = clip.track + 1;
  while (track < MAX_PLAYLIST_TRACKS - 1 && busy(track)) track++;
  const added = addClips(next.playlist.clips, [{ kind: "pattern", ref: pattern.id, track: Math.min(track, MAX_PLAYLIST_TRACKS - 1), start, length: end - start, offset: 0 }]);
  return { ...next, playlist: { ...next.playlist, clips: added.clips } };
}
