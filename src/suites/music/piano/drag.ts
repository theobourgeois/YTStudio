/**
 * What a drag in the Piano roll does to the notes (`PianoDrag`, in `store.ts`). One function, used
 * twice: every frame to draw the notes as the drag would leave them, and once, when the drag is let
 * go, to make the edit. So what's drawn while dragging is exactly what's kept.
 */
import {
  type Created,
  addNotes,
  cloneNotes,
  moveNotes,
  notesInRect,
  removeNotes,
  resizeNotes,
  setNoteProps,
  setNoteValues,
  sliceColumn,
  sliceNotes,
  stretchNotes,
} from "@shared/music/notes";
import { snapToScale } from "@shared/music/scales";
import type { Note } from "@shared/music/types";
import type { PianoDrag } from "./store";

/** The notes in `ids` on the scale's nearest notes (a move with Snap to scale). */
function ontoScale(result: Created, ids: ReadonlySet<number>, scale: Parameters<typeof snapToScale>[0]): Created {
  let any = false;
  const notes = result.notes.map((note) => {
    if (!ids.has(note.id)) return note;
    const pitch = snapToScale(scale, note.pitch);
    if (pitch === note.pitch) return note;
    any = true;
    return { ...note, pitch };
  });
  return any ? { ...result, notes } : result;
}

/** The notes after a drag, and the ones it made (to select them). A selection rectangle and scrubbing change no notes. */
export function applyDrag(notes: Note[], drag: PianoDrag | null): Created {
  const same = (list: Note[]): Created => ({ notes: list, created: [] });
  if (!drag) return same(notes);
  switch (drag.kind) {
    case "move": {
      const moved = drag.clone ? cloneNotes(notes, drag.ids, drag.ticks, drag.semitones) : same(moveNotes(notes, drag.ids, drag.ticks, drag.semitones));
      // Moved up or down with a scale: each lands on its nearest note (moved along time only, they stay).
      return drag.scale && drag.semitones ? ontoScale(moved, drag.clone ? new Set(moved.created) : drag.ids, drag.scale) : moved;
    }
    case "resize":
      return same(resizeNotes(notes, drag.ids, drag.ticks));
    case "stretch":
      return same(stretchNotes(notes, drag.ids, drag.factor, drag.anchor));
    case "add":
      return addNotes(notes, drag.notes);
    case "erase":
      return same(removeNotes(notes, drag.ids));
    case "mute":
      return same(setNoteProps(notes, drag.ids, { muted: drag.muted }));
    case "values":
      return same(setNoteValues(notes, drag.values));
    case "slice": {
      const { tick, low, high, column } = drag;
      if (column) return sliceColumn(notes, tick);
      return sliceNotes(notes, (pitch) => (pitch >= Math.min(low, high) && pitch <= Math.max(low, high) ? tick : null));
    }
    case "rect":
    case "playback":
    case "zoom":
      return same(notes);
  }
}

/**
 * What a selection rectangle selects: the notes it touches, with (`add`) what was selected before. The
 * canvas draws it while the rectangle is dragged, so notes turn selected as it covers them.
 */
export function rectSelection(notes: readonly Note[], drag: Extract<PianoDrag, { kind: "rect" }>, selected: ReadonlySet<number>): Set<number> {
  const inside = notesInRect(notes, Math.min(drag.from, drag.to), Math.max(drag.from, drag.to), Math.min(drag.low, drag.high), Math.max(drag.low, drag.high));
  return new Set(drag.add ? [...selected, ...inside] : inside);
}
