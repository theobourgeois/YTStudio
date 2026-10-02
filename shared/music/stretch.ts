/**
 * Stretching audio clips (`docs/fl-studio/playlist.md`, Stretching audio clips): how fast an audio clip goes
 * through its file, and in which mode. A clip plays by its own stretch (FL 2025's variant, made by stretching
 * it in the Playlist) or else its channel's (the channel window's Time stretching). The stretch's `tempo` is
 * the song's tempo at which the file plays at its own speed, so a stretched clip stays on its bars whatever
 * the tempo; its window (`offset`, seconds of the file) never changes with it.
 */
import { clamp } from "../math.ts";
import { type AudioStretch, type StretchMode, STRETCH_MODES } from "./types.ts";

/** The modes' names, as FL's MODE menu says them. */
export const STRETCH_MODE_NAMES: Record<StretchMode, string> = { resample: "Resample", stretch: "Stretch" };

export const isStretchMode = (value: unknown): value is StretchMode => STRETCH_MODES.includes(value as StretchMode);

/** The tempi a stretch can be at (FL's TIME reaches far further than its sound is good for). */
export const MIN_STRETCH_TEMPO = 5;
export const MAX_STRETCH_TEMPO = 4000;
/** How much faster or slower a file can play: the engine's limits. */
export const MIN_AUDIO_SPEED = 1 / 16;
export const MAX_AUDIO_SPEED = 16;

/** How much faster a file read `semitones` higher goes (a sampler's notes: pitch and speed together). */
export const pitchSpeed = (semitones: number) => 2 ** (semitones / 12);

/** How an audio clip plays its file. */
export interface AudioPlayback {
  /** Seconds of the file a second of the song plays. */
  speed: number;
  /** Semitones its pitch is shifted by on top, its time kept (Stretch mode's channel pitch). */
  transpose: number;
  /** Stretched with its pitch kept (the engine's time stretcher); otherwise read faster or slower (Resample). */
  keepPitch: boolean;
}

/**
 * How a clip with stretch `stretch` (its own, or its channel's) plays its file at `tempo`, its channel pitched
 * by `pitch` semitones. Its channel's pitch only ever moves its pitch, never its time, as FL's does (Théo):
 * only a stretch changes its speed. In Stretch mode that keeps its pitch; in Resample the speed moves the
 * pitch too (faster is higher), and the channel's pitch is on top. Played as it is (through no stretcher)
 * when nothing asks for one.
 */
export function audioPlayback(stretch: AudioStretch | null | undefined, pitch: number, tempo: number): AudioPlayback {
  const ratio = stretch?.tempo ? tempo / stretch.tempo : 1;
  const speed = clamp(ratio, MIN_AUDIO_SPEED, MAX_AUDIO_SPEED);
  if (stretch?.mode === "stretch") return { speed, transpose: pitch, keepPitch: Math.abs(speed - 1) > 1e-9 || pitch !== 0 };
  if (pitch === 0) return { speed, transpose: 0, keepPitch: false };
  // Resampled and pitched: the stretcher plays it at its speed, as high as the speed makes it and its pitch on top.
  return { speed, transpose: pitch + 12 * Math.log2(speed), keepPitch: true };
}

/** A stretch's tempo kept in range and to a millionth (so a song saved and loaded is the same song). */
export const stretchTempo = (tempo: number) => Math.round(clamp(tempo, MIN_STRETCH_TEMPO, MAX_STRETCH_TEMPO) * 1e6) / 1e6;

/** A stretch from untrusted storage, or undefined (none). */
export function normalizeStretch(input: unknown): AudioStretch | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const mode = STRETCH_MODES.includes(raw.mode as StretchMode) ? (raw.mode as StretchMode) : null;
  if (!mode) return undefined;
  const tempo = typeof raw.tempo === "number" && Number.isFinite(raw.tempo) && raw.tempo > 0 ? stretchTempo(raw.tempo) : null;
  return { mode, tempo };
}

export const sameStretch = (a: AudioStretch | null | undefined, b: AudioStretch | null | undefined) =>
  a === b || (!!a && !!b && a.mode === b.mode && a.tempo === b.tempo);

/**
 * The stretch that makes a clip play its content in `length / newLength` of the time it takes now: what
 * stretching an edge does (its content stays, only its speed changes). `fileSecondsPerTick` is how fast it
 * goes through its file now; `mode` the stretch's (the one it has, or the one new stretches get).
 * The result may be clamped (the speed's limits): `length` says how long the clip then is.
 */
export function stretchedTo(
  now: { fileSecondsPerTick: number; length: number },
  newLength: number,
  mode: StretchMode,
  song: { tempo: number; secondsPerTick: number },
): { stretch: AudioStretch; length: number } {
  // Seconds of the file a tick must play to fit the same content into `newLength`.
  const wanted = (now.fileSecondsPerTick * now.length) / Math.max(1, newLength);
  const lowest = Math.max(MIN_STRETCH_TEMPO, song.tempo / MAX_AUDIO_SPEED);
  const highest = Math.min(MAX_STRETCH_TEMPO, song.tempo / MIN_AUDIO_SPEED);
  const tempo = stretchTempo(clamp((song.secondsPerTick * song.tempo) / wanted, lowest, highest));
  const actual = (song.secondsPerTick * song.tempo) / tempo;
  return { stretch: { mode, tempo }, length: Math.max(1, Math.round((now.fileSecondsPerTick * now.length) / actual)) };
}

/**
 * The tempo a file `seconds` long was made at, from a detected tempo (`bpm`, null when none was heard):
 * rounded so the file is a whole number of beats when that's within 4% (what makes a loop loop), else
 * as heard. With none heard, the whole number of beats (a power of two) that puts it nearest 120 BPM, as a
 * loop most likely is. Null for a file too short to tell.
 */
export function fileTempo(seconds: number, bpm: number | null): number | null {
  if (!(seconds > 0.05)) return null;
  if (bpm && bpm > 0) {
    const beats = Math.round((seconds * bpm) / 60);
    const fitted = (beats * 60) / seconds;
    return stretchTempo(beats >= 1 && Math.abs(fitted - bpm) / bpm <= 0.04 ? fitted : bpm);
  }
  let best: number | null = null;
  for (let beats = 1; beats <= 256; beats *= 2) {
    const tempo = (beats * 60) / seconds;
    if (best === null || Math.abs(Math.log2(tempo / 120)) < Math.abs(Math.log2(best / 120))) best = tempo;
  }
  return best === null ? null : stretchTempo(best);
}

/** The stretch tempo that makes `seconds` of a file last `beats` beats of the song (FL's TIME menu: Beat/Bar #). */
export const tempoForBeats = (seconds: number, beats: number) => stretchTempo((beats * 60) / Math.max(1e-3, seconds));

/** The stretch tempo for a file made at `fileTempo` BPM (FL's Autodetect): that tempo (its channel's pitch changes no speed). */
export const tempoOfFile = (fileTempo: number) => stretchTempo(fileTempo);
