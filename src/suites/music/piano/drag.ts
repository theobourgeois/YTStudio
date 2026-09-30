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
  sliceNotes,
  stretchNotes,
} from "@shared/music/notes";
import type { Note } from "@shared/music/types";
import { sliceLine } from "./geometry";
import type { PianoDrag } from "./store";

/**
 * The notes after a drag, and the ones it made (to select them). `grid` is the snap, for the slice
 * tool's cuts. A selection rectangle changes no notes.
 */
export function applyDrag(notes: Note[], drag: PianoDrag | null, grid: number): Created {
  const same = (list: Note[]): Created => ({ notes: list, created: [] });
  if (!drag) return same(notes);
  switch (drag.kind) {
    case "move":
      return drag.clone ? cloneNotes(notes, drag.ids, drag.ticks, drag.semitones) : same(moveNotes(notes, drag.ids, drag.ticks, drag.semitones));
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
    case "slice":
      return sliceNotes(notes, sliceLine(drag.a, drag.b, grid));
    case "rect":
      return same(notes);
  }
}

/** What a selection rectangle selects: the notes it touches, with (`add`) what was selected before. */
export function rectSelection(notes: readonly Note[], drag: Extract<PianoDrag, { kind: "rect" }>, selected: ReadonlySet<number>): Set<number> {
  const inside = notesInRect(notes, Math.min(drag.from, drag.to), Math.max(drag.from, drag.to), Math.min(drag.low, drag.high), Math.max(drag.low, drag.high));
  return new Set(drag.add ? [...selected, ...inside] : inside);
}
