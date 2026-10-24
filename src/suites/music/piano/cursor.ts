/**
 * The Piano roll's keyboard cursor: a cell of the grid (a tick and a pitch) the arrows move, where Enter
 * puts a note and step edit writes what's played, as a text editor's caret is where typing goes. Pure,
 * so it's tested; `actions.ts` keeps it in `usePiano` and the grid draws it.
 */
import { clamp } from "@shared/math";
import { HIGHEST_PITCH, LOWEST_PITCH, MAX_TICK } from "@shared/music/notes";
import { type SongScale, inScale } from "@shared/music/scales";
import type { Note } from "@shared/music/types";
import type { PianoView } from "./geometry";

export interface PianoCursor {
  tick: number;
  pitch: number;
}

/** The cursor moved along by `steps` grid units, landing on the grid. */
export function cursorAlong(cursor: PianoCursor, steps: number, grid: number): PianoCursor {
  const on = Math.round(cursor.tick / grid) * grid;
  // Off the grid (the snap changed), the first step goes to the grid line in that direction.
  const from = Math.abs(on - cursor.tick) < 1e-6 ? on : steps > 0 ? Math.floor(cursor.tick / grid) * grid : Math.ceil(cursor.tick / grid) * grid;
  return { ...cursor, tick: clamp(from + steps * grid, 0, MAX_TICK - grid) };
}

/**
 * The cursor moved up or down: by semitones, or with a scale by its notes (a pitch off the scale goes to
 * its nearest one that way first), as FL's Snap to scale draws.
 */
export function cursorUpDown(cursor: PianoCursor, steps: number, scale: SongScale | null | undefined): PianoCursor {
  if (!scale) return { ...cursor, pitch: clamp(cursor.pitch + steps, LOWEST_PITCH, HIGHEST_PITCH) };
  let pitch = cursor.pitch;
  const direction = Math.sign(steps);
  for (let left = Math.abs(steps); left > 0; ) {
    const next = pitch + direction;
    if (next < LOWEST_PITCH || next > HIGHEST_PITCH) break;
    pitch = next;
    if (inScale(scale, pitch)) left--;
  }
  return { ...cursor, pitch };
}

/** The note under the cursor: at its pitch and sounding at its tick (the latest to start, where two overlap). */
export function noteAtCursor(notes: readonly Note[], cursor: PianoCursor): Note | null {
  let found: Note | null = null;
  for (const note of notes) {
    if (note.start > cursor.tick) break;
    if (note.pitch === cursor.pitch && cursor.tick < note.start + note.length) found = note;
  }
  return found;
}

/**
 * The note after (or before) the cursor, reading the notes as a score: by start, then low to high at the
 * same start, so Tab walks a chord from its root up before moving on.
 */
export function noteBeside(notes: readonly Note[], cursor: PianoCursor, direction: -1 | 1): Note | null {
  const order = (a: { start: number; pitch: number }, b: { start: number; pitch: number }) => a.start - b.start || a.pitch - b.pitch;
  const here = { start: cursor.tick, pitch: cursor.pitch };
  let best: Note | null = null;
  for (const note of notes) {
    const after = order(note, here) * direction > 0;
    if (after && (!best || order(note, best) * direction < 0)) best = note;
  }
  return best;
}

/** How much room the view keeps round the cursor when it scrolls to show it: a little, so what's next shows too. */
const MARGIN_PX = 48;
const MARGIN_ROWS = 2;

/** The view scrolled (if it must) so the cursor's cell is in it, with a little room round it. */
export function viewShowing(view: PianoView, cursor: PianoCursor, grid: number, width: number, height: number): PianoView {
  let { scrollTick, topPitch } = view;
  const margin = Math.min(MARGIN_PX, width / 4) / view.pxPerTick;
  const span = width / view.pxPerTick;
  if (cursor.tick < scrollTick + margin) scrollTick = Math.max(0, cursor.tick - margin);
  else if (cursor.tick + grid > scrollTick + span - margin) scrollTick = cursor.tick + grid - span + margin;
  const rows = height / view.rowHeight;
  const margins = Math.min(MARGIN_ROWS, Math.floor(rows / 4));
  if (cursor.pitch > topPitch - margins) topPitch = Math.min(HIGHEST_PITCH, cursor.pitch + margins);
  else if (cursor.pitch < topPitch - rows + 1 + margins) topPitch = Math.max(LOWEST_PITCH + Math.floor(rows) - 1, cursor.pitch + Math.ceil(rows) - 1 - margins);
  return scrollTick === view.scrollTick && topPitch === view.topPitch ? view : { ...view, scrollTick, topPitch };
}

/** Where the cursor starts when the keyboard first moves it: on the first selected note, else at the view's left edge, mid-height. */
export function startingCursor(view: PianoView, notes: readonly Note[], selected: ReadonlySet<number>, grid: number, height: number): PianoCursor {
  const note = notes.find((n) => selected.has(n.id));
  if (note) return { tick: note.start, pitch: note.pitch };
  const tick = Math.ceil(view.scrollTick / grid - 1e-9) * grid;
  const pitch = clamp(Math.round(view.topPitch - height / view.rowHeight / 2), LOWEST_PITCH, HIGHEST_PITCH);
  return { tick, pitch };
}
