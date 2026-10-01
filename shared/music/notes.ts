/**
 * What the Piano roll does to a channel's notes in a pattern (`docs/fl-studio/piano-roll.md`): every
 * operation is a pure function of the note list, which it never changes in place, returning **the same
 * list** when there's nothing to do. `editNotes` applies one to a song.
 *
 * Notes are told apart by `id`, and what's selected is a set of ids. Operations that make notes say
 * which (`Created`), so the new ones can be selected. Lists stay in `byStart` order, and everything
 * here is a single pass over the list (or a sort of it): a pattern can have many thousands of notes.
 */
import { clamp } from "../math.ts";
import { setChannelNotes } from "./edits.ts";
import { DEFAULT_VELOCITY, MAX_PATTERN_TICKS, byStart, nextNoteId } from "./project.ts";
import type { MusicProject, Note } from "./types.ts";

export type NoteIds = ReadonlySet<number>;

/** A new note list, and the ids of the notes it gained. */
export interface Created {
  notes: Note[];
  created: number[];
}

/** Notes start before this tick. */
export const MAX_TICK = MAX_PATTERN_TICKS;
export const LOWEST_PITCH = 0;
export const HIGHEST_PITCH = 127;

const nothing = (notes: Note[]): Created => ({ notes, created: [] });

/** The ids an operation acts on: the selection, or every note when nothing is selected (as in FL Studio). */
export const orAll = (notes: readonly Note[], ids: NoteIds): NoteIds => (ids.size ? ids : new Set(notes.map((n) => n.id)));

/** Apply a Piano roll operation to a channel's notes in a pattern. */
export const editNotes = (song: MusicProject, patternId: string, channelId: string, update: (notes: Note[]) => Note[]): MusicProject =>
  setChannelNotes(song, patternId, channelId, update);

// ---------------------------------------------------------------------------
// Looking
// ---------------------------------------------------------------------------

export interface NoteBounds {
  /** Ticks: the earliest start and the latest end. */
  start: number;
  end: number;
  /** The lowest and highest pitch. */
  low: number;
  high: number;
}

/** What the given notes span, or null if there are none. */
export function noteBounds(notes: readonly Note[], ids?: NoteIds): NoteBounds | null {
  let bounds: NoteBounds | null = null;
  for (const note of notes) {
    if (ids && !ids.has(note.id)) continue;
    const end = note.start + note.length;
    if (!bounds) bounds = { start: note.start, end, low: note.pitch, high: note.pitch };
    else {
      if (note.start < bounds.start) bounds.start = note.start;
      if (end > bounds.end) bounds.end = end;
      if (note.pitch < bounds.low) bounds.low = note.pitch;
      if (note.pitch > bounds.high) bounds.high = note.pitch;
    }
  }
  return bounds;
}

/** The notes a rectangle touches: any part of them in `[from, to)` ticks, on a pitch from `low` to `high`. */
export function notesInRect(notes: readonly Note[], from: number, to: number, low: number, high: number): number[] {
  const found: number[] = [];
  for (const note of notes) {
    if (note.start >= to) break;
    if (note.start + note.length > from && note.pitch >= low && note.pitch <= high) found.push(note.id);
  }
  return found;
}

/** The notes that start in `[from, to)`: what a time selection selects. */
export function notesInTime(notes: readonly Note[], from: number, to: number): number[] {
  const found: number[] = [];
  for (const note of notes) {
    if (note.start >= to) break;
    if (note.start >= from) found.push(note.id);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Adding and removing
// ---------------------------------------------------------------------------

export type NewNote = Pick<Note, "start" | "length" | "pitch"> & Partial<Pick<Note, "velocity" | "pan" | "muted">>;

const tidy = (note: NewNote, id: number): Note => ({
  id,
  start: clamp(Math.round(note.start), 0, MAX_TICK - 1),
  length: Math.max(1, Math.round(note.length)),
  pitch: clamp(Math.round(note.pitch), LOWEST_PITCH, HIGHEST_PITCH),
  velocity: clamp(note.velocity ?? DEFAULT_VELOCITY, 0, 1),
  pan: clamp(note.pan ?? 0, -1, 1),
  muted: note.muted ?? false,
});

/** Add notes, with ids of their own. */
export function addNotes(notes: Note[], added: readonly NewNote[]): Created {
  if (!added.length) return nothing(notes);
  const first = nextNoteId(notes);
  const made = added.map((note, i) => tidy(note, first + i));
  return { notes: [...notes, ...made].sort(byStart), created: made.map((n) => n.id) };
}

export function removeNotes(notes: Note[], ids: NoteIds): Note[] {
  if (!ids.size) return notes;
  const kept = notes.filter((n) => !ids.has(n.id));
  return kept.length === notes.length ? notes : kept;
}

// ---------------------------------------------------------------------------
// Changing the notes there are
// ---------------------------------------------------------------------------

/** Apply `change` to the notes in `ids`, re-sorting only if one was changed. */
function mapNotes(notes: Note[], ids: NoteIds, change: (note: Note) => Note): Note[] {
  if (!ids.size) return notes;
  let any = false;
  const next = notes.map((note) => {
    if (!ids.has(note.id)) return note;
    const changed = change(note);
    any ||= changed !== note;
    return changed;
  });
  return any ? next.sort(byStart) : notes;
}

/**
 * Move notes in time and pitch. They move together: if one would leave the pattern (before its start,
 * or off either end of the keyboard), they all stop there, so a shape never gets squashed.
 */
export function moveNotes(notes: Note[], ids: NoteIds, ticks: number, semitones: number): Note[] {
  const bounds = noteBounds(notes, ids);
  if (!bounds) return notes;
  const dt = clamp(Math.round(ticks), -bounds.start, MAX_TICK - 1 - bounds.start);
  const dp = clamp(Math.round(semitones), LOWEST_PITCH - bounds.low, HIGHEST_PITCH - bounds.high);
  if (!dt && !dp) return notes;
  return mapNotes(notes, ids, (note) => ({ ...note, start: note.start + dt, pitch: note.pitch + dp }));
}

/** Make notes longer or shorter by `ticks`, none shorter than `min`. */
export function resizeNotes(notes: Note[], ids: NoteIds, ticks: number, min = 1): Note[] {
  const by = Math.round(ticks);
  return mapNotes(notes, ids, (note) => {
    const length = Math.max(Math.max(1, min), note.length + by);
    return length === note.length ? note : { ...note, length };
  });
}

/** Make notes as short as `length` (Discard lengths: the snap's size, or a tick). */
export const discardLengths = (notes: Note[], ids: NoteIds, length: number): Note[] =>
  mapNotes(notes, orAll(notes, ids), (note) => (note.length === Math.max(1, Math.round(length)) ? note : { ...note, length: Math.max(1, Math.round(length)) }));

export type NotePatch = Partial<Pick<Note, "velocity" | "pan" | "muted" | "start" | "length" | "pitch">>;

/** Set properties of notes outright (the properties dialog, mute). */
export function setNoteProps(notes: Note[], ids: NoteIds, patch: NotePatch): Note[] {
  return mapNotes(notes, ids, (note) => {
    const next = tidy({ ...note, ...patch }, note.id);
    return (Object.keys(next) as (keyof Note)[]).every((key) => next[key] === note[key]) ? note : next;
  });
}

/** Set each note's own value of a property (the event editor, where a drag gives every note a different one). */
export function setNoteValues(notes: Note[], values: ReadonlyMap<number, NotePatch>): Note[] {
  if (!values.size) return notes;
  return mapNotes(notes, new Set(values.keys()), (note) => {
    const next = tidy({ ...note, ...values.get(note.id) }, note.id);
    return (Object.keys(next) as (keyof Note)[]).every((key) => next[key] === note[key]) ? note : next;
  });
}

/**
 * Stretch notes in time about `anchor`: a note's distance from it and its length are both multiplied
 * by `factor` (the selection's stretch handle).
 */
export function stretchNotes(notes: Note[], ids: NoteIds, factor: number, anchor: number): Note[] {
  if (!(factor > 0) || factor === 1) return notes;
  return mapNotes(notes, ids, (note) => ({
    ...note,
    start: clamp(Math.round(anchor + (note.start - anchor) * factor), 0, MAX_TICK - 1),
    length: Math.max(1, Math.round(note.length * factor)),
  }));
}

/** Move notes `ticks` along, wrapping round `[0, span)` (Rotate left / right). */
export function rotateNotes(notes: Note[], ids: NoteIds, ticks: number, span: number): Note[] {
  if (span <= 0 || !ticks) return notes;
  return mapNotes(notes, orAll(notes, ids), (note) => (note.start < span ? { ...note, start: (((note.start + ticks) % span) + span) % span } : note));
}

// ---------------------------------------------------------------------------
// Copies
// ---------------------------------------------------------------------------

/** Copies of notes, moved by `ticks` and `semitones` (Shift+drag): the originals stay. */
export function cloneNotes(notes: Note[], ids: NoteIds, ticks: number, semitones: number): Created {
  const copied = notes.filter((n) => ids.has(n.id));
  const bounds = noteBounds(copied);
  if (!bounds) return nothing(notes);
  const dt = clamp(Math.round(ticks), -bounds.start, MAX_TICK - 1 - bounds.start);
  const dp = clamp(Math.round(semitones), LOWEST_PITCH - bounds.low, HIGHEST_PITCH - bounds.high);
  return addNotes(
    notes,
    copied.map((n) => ({ ...n, start: n.start + dt, pitch: n.pitch + dp })),
  );
}

/**
 * Duplicate to the right (Ctrl+B): copies of the selected notes (or of all of them) placed `interval`
 * later. Without an interval (no time selection), it's what the notes span, from the first's start to
 * the last's end, rounded up to the snap's `grid`: the copy starts straight after the original.
 */
export function duplicateNotes(notes: Note[], ids: NoteIds, grid: number, interval?: number): Created & { interval: number } {
  const chosen = orAll(notes, ids);
  const bounds = noteBounds(notes, chosen);
  if (!bounds) return { ...nothing(notes), interval: 0 };
  const step = Math.max(1, Math.round(grid));
  const by = interval && interval > 0 ? Math.round(interval) : Math.max(step, Math.ceil((bounds.end - bounds.start) / step) * step);
  // A copy that would start past the end of what a pattern can hold isn't made.
  const copies = notes.filter((n) => chosen.has(n.id) && n.start + by < MAX_TICK).map((n) => ({ ...n, start: n.start + by }));
  return { ...addNotes(notes, copies), interval: by };
}

/** Notes as they're copied: relative to the first one's start, so they can be pasted anywhere. */
export function copyNotes(notes: readonly Note[], ids: NoteIds): Note[] {
  const copied = notes.filter((n) => ids.has(n.id));
  const start = copied.length ? copied[0].start : 0;
  return copied.map((n) => ({ ...n, start: n.start - start }));
}

/** Paste copied notes with the first at `at`. */
export const pasteNotes = (notes: Note[], copied: readonly Note[], at: number): Created =>
  addNotes(
    notes,
    copied.filter((n) => n.start + at < MAX_TICK).map((n) => ({ ...n, start: n.start + at })),
  );

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Quantize: move notes onto a grid. "both" moves each note's start and end to the nearest line (a note
 * that would vanish keeps one grid cell); "starts" moves the start and keeps the length.
 */
export function quantizeNotes(notes: Note[], ids: NoteIds, grid: number, mode: "both" | "starts" = "both"): Note[] {
  if (!(grid >= 1)) return notes;
  const snap = (tick: number) => Math.round(tick / grid) * grid;
  return mapNotes(notes, orAll(notes, ids), (note) => {
    const start = clamp(Math.round(snap(note.start)), 0, MAX_TICK - 1);
    const end = mode === "starts" ? start + note.length : Math.round(snap(note.start + note.length));
    const length = Math.max(1, end > start ? end - start : Math.round(grid));
    return start === note.start && length === note.length ? note : { ...note, start, length };
  });
}

/** Quick legato: each note is held until the next one starts (notes that start together are a chord: they all are). */
export function legatoNotes(notes: Note[], ids: NoteIds): Note[] {
  const chosen = orAll(notes, ids);
  const starts = [...new Set(notes.filter((n) => chosen.has(n.id)).map((n) => n.start))].sort((a, b) => a - b);
  if (starts.length < 2) return notes;
  const next = new Map(starts.map((start, i) => [start, starts[i + 1]]));
  return mapNotes(notes, chosen, (note) => {
    const until = next.get(note.start);
    return until === undefined || until - note.start === note.length ? note : { ...note, length: until - note.start };
  });
}

/**
 * Glue: notes of the same pitch that touch or overlap become one, from the first's start to the last's
 * end, keeping the first's properties.
 */
export function glueNotes(notes: Note[], ids: NoteIds): Note[] {
  const chosen = orAll(notes, ids);
  /** The note being grown on each pitch. */
  const open = new Map<number, Note>();
  const gone = new Set<number>();
  const grown = new Map<number, number>();
  // In order of start, so each note only has to be compared with the last one on its pitch.
  for (const note of notes) {
    if (!chosen.has(note.id)) continue;
    const before = open.get(note.pitch);
    const beforeEnd = before ? before.start + (grown.get(before.id) ?? before.length) : -1;
    if (before && note.start <= beforeEnd) {
      grown.set(before.id, Math.max(beforeEnd, note.start + note.length) - before.start);
      gone.add(note.id);
    } else open.set(note.pitch, note);
  }
  if (!gone.size) return notes;
  return notes.filter((n) => !gone.has(n.id)).map((n) => (grown.has(n.id) ? { ...n, length: grown.get(n.id)! } : n));
}

/** Quick chop: cut each note into pieces a grid cell long (the last one is what's left). */
export function chopNotes(notes: Note[], ids: NoteIds, grid: number): Created {
  const size = Math.round(grid);
  if (!(size >= 1)) return nothing(notes);
  const chosen = orAll(notes, ids);
  const pieces: NewNote[] = [];
  const next = notes.map((note) => {
    if (!chosen.has(note.id) || note.length <= size) return note;
    for (let at = size; at < note.length; at += size) pieces.push({ ...note, start: note.start + at, length: Math.min(size, note.length - at) });
    return { ...note, length: size };
  });
  if (!pieces.length) return nothing(notes);
  const added = addNotes(next, pieces);
  // The first piece of each note keeps its id, and stays selected with the rest.
  return { notes: added.notes, created: [...notes.filter((n) => chosen.has(n.id) && n.length > size).map((n) => n.id), ...added.created] };
}

/**
 * Slice: cut notes in two where `cutAt` says, for their pitch (the slice tool's line crosses each row
 * at its own time). A cut at a note's very start or end, or outside it, leaves it whole.
 */
export function sliceNotes(notes: Note[], cutAt: (pitch: number) => number | null, ids?: NoteIds): Created {
  const tails: NewNote[] = [];
  const next = notes.map((note) => {
    if (ids?.size && !ids.has(note.id)) return note;
    const at = cutAt(note.pitch);
    if (at === null) return note;
    const cut = Math.round(at);
    if (cut <= note.start || cut >= note.start + note.length) return note;
    tails.push({ ...note, start: cut, length: note.start + note.length - cut });
    return { ...note, length: cut - note.start };
  });
  if (!tails.length) return nothing(notes);
  return addNotes(next, tails);
}
