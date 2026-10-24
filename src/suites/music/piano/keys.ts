/**
 * The Piano roll's keyboard shortcuts, FL Studio's (`docs/fl-studio/piano-roll.md`). Pure, so they're
 * tested; the workspace runs them while the Piano roll is the front window. "Ctrl" is Ctrl or ⌘.
 */
import type { PianoTool } from "./store";

export type PianoKeyAction =
  | { type: "tool"; tool: PianoTool }
  | {
      type:
        | "selectAll"
        | "deselect"
        | "invert"
        | "copy"
        | "cut"
        | "paste"
        | "duplicate"
        | "delete"
        | "glue"
        | "chop"
        | "chopper"
        /** FL's Alt+Q: the Quantizer. */
        | "quantizer"
        | "quantize"
        | "quantizeStarts"
        | "legato"
        | "discard"
        | "mute"
        | "unmute"
        | "ghosts"
        | "lane"
        | "nextLane"
        | "timeAround"
        | "centre"
        | "close";
    }
  /** Move the notes: a snap unit or a tick in time, semitones in pitch. */
  | { type: "nudge"; by: "snap" | "tick" | "none"; direction: -1 | 0 | 1; semitones: number }
  | { type: "rotate" | "shiftTime"; direction: -1 | 1 }
  /** The channel above or below; `withNotes`: the next that has notes in this pattern. */
  | { type: "channel"; direction: -1 | 1; withNotes: boolean }
  | { type: "zoom"; factor: number }
  | { type: "zoomPreset"; preset: 1 | 2 | 3 | 4 | 5 }
  /**
   * The keyboard cursor (`cursor.ts`): along by the grid, up or down a semitone (a scale's note with a
   * scale), or an octave; to the pattern's start or end.
   */
  | { type: "cursor"; move: "along" | "pitch" | "octave"; steps: -1 | 1 }
  | { type: "cursorEdge"; edge: "start" | "end" }
  /** Enter: a note at the cursor, then the cursor past it (`advance`); Alt+Enter keeps it there. */
  | { type: "place"; advance: boolean }
  /** Tab / Shift+Tab: the cursor to the next (previous) note, which alone is selected. */
  | { type: "nextNote"; direction: -1 | 1 }
  /** X: the note under the cursor in or out of the selection; Shift+X: every note at its pitch. */
  | { type: "toggleAtCursor" | "selectRow" }
  /** I / O: the time selection's start or end at the cursor. */
  | { type: "markIn" | "markOut" }
  /** Alt+Shift+← / →: the notes (selected, else the one under the cursor) longer or shorter by the grid; ↑ / ↓ louder or softer. */
  | { type: "length" | "velocity"; direction: -1 | 1 }
  /** F2: the note's properties (the selected or the cursor's). */
  | { type: "properties" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

const TOOLS: Record<string, PianoTool> = { P: "draw", B: "paint", D: "delete", T: "mute", C: "slice", E: "select", Z: "zoom", Y: "playback" };

export function resolvePianoKey(e: KeyLike): PianoKeyAction | null {
  const command = e.metaKey || e.ctrlKey;
  const { shiftKey: shift, altKey: alt } = e;
  // By position, so Alt (which types other characters on a Mac) doesn't hide the key.
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
  const digit = /^Digit(\d)$/.exec(e.code)?.[1];
  const horizontal = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
  const vertical = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;

  if (horizontal || vertical) {
    if (!command && !shift && !alt) return horizontal ? { type: "cursor", move: "along", steps: horizontal } : { type: "cursor", move: "pitch", steps: vertical as -1 | 1 };
    if (command && shift && !alt && vertical) return { type: "cursor", move: "octave", steps: vertical as -1 | 1 };
    if (alt && shift && !command) return horizontal ? { type: "length", direction: horizontal } : { type: "velocity", direction: vertical as -1 | 1 };
    if (command && shift && !alt && horizontal) return { type: "rotate", direction: horizontal };
    if (command && !shift && !alt) return horizontal ? { type: "shiftTime", direction: horizontal } : { type: "nudge", by: "none", direction: 0, semitones: vertical * 12 };
    if (shift && !command && !alt) return { type: "nudge", by: horizontal ? "snap" : "none", direction: horizontal, semitones: vertical };
    if (alt && !command && !shift) return { type: "nudge", by: horizontal ? "tick" : "none", direction: horizontal, semitones: vertical };
    return null;
  }

  if (e.key === "Delete" || e.key === "Backspace") return !command && !shift && !alt ? { type: "delete" } : null;
  if (e.key === "Escape") return { type: "close" };
  if (e.key === "PageUp" || e.key === "PageDown") return { type: "zoom", factor: e.key === "PageUp" ? 1.5 : 1 / 1.5 };
  if (e.key === "Enter") {
    if (command) return shift ? null : { type: "timeAround" };
    if (shift) return alt ? null : { type: "lane" };
    return { type: "place", advance: !alt };
  }
  if ((e.key === "Home" || e.key === "End") && !command && !shift && !alt) return { type: "cursorEdge", edge: e.key === "Home" ? "start" : "end" };
  if (e.key === "Tab" && !command && !alt) return { type: "nextNote", direction: shift ? -1 : 1 };
  if (e.key === "F2" && !command && !shift && !alt) return { type: "properties" };

  if (digit !== undefined && shift && !command && !alt) {
    if (digit === "0") return { type: "centre" };
    if (Number(digit) <= 5) return { type: "zoomPreset", preset: Number(digit) as 1 | 2 | 3 | 4 | 5 };
    return null;
  }

  if (command && !alt) {
    if (shift) return null;
    const commands: Record<string, PianoKeyAction["type"]> = { A: "selectAll", D: "deselect", C: "copy", X: "cut", V: "paste", B: "duplicate", G: "glue", U: "chop", Q: "quantize", L: "legato" };
    const type = commands[letter];
    return type ? ({ type } as PianoKeyAction) : null;
  }
  if (alt && !command) {
    if (letter === "M") return { type: shift ? "unmute" : "mute" };
    if (letter === "V" && !shift) return { type: "ghosts" };
    if (letter === "U" && !shift) return { type: "chopper" };
    if (letter === "Q" && !shift) return { type: "quantizer" };
    return null;
  }
  if (shift) {
    const shifted: Record<string, PianoKeyAction["type"]> = { I: "invert", Q: "quantizeStarts", D: "discard", F: "nextLane", X: "selectRow" };
    const type = shifted[letter];
    return type ? ({ type } as PianoKeyAction) : null;
  }

  if (TOOLS[letter]) return { type: "tool", tool: TOOLS[letter] };
  if (letter === "F") return { type: "nextLane" };
  if (letter === "X") return { type: "toggleAtCursor" };
  if (letter === "I" || letter === "O") return { type: letter === "I" ? "markIn" : "markOut" };
  if (letter === "G" || letter === "K") return { type: "channel", direction: letter === "G" ? -1 : 1, withNotes: false };
  if (letter === "H" || letter === "J") return { type: "channel", direction: letter === "H" ? -1 : 1, withNotes: true };
  return null;
}
