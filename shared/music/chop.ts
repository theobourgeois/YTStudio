/**
 * The Piano roll's Chopper (`docs/fl-studio/piano-roll.md`, Alt+U): long notes cut into a rhythm, a chop
 * pattern. A pattern is a cycle of pieces, some of them rests, each with levels (velocity, pan) that the
 * Levels knobs give the pieces some or all of. Pure, like the rest of `notes.ts`, which Quick chop is in.
 */
import { clamp } from "../math.ts";
import { type Created, type NewNote, type NoteIds, addNotes, orAll } from "./notes.ts";
import { byStart } from "./project.ts";
import { STEP_TICKS, type Note } from "./types.ts";

/** One piece of a chop pattern. */
export interface ChopPiece {
  /** Steps (sixteenth notes): fractions are fine as long as they come to whole ticks (a third of a step is 8). */
  steps: number;
  /** A gap: what of a note falls here is cut out. */
  rest?: boolean;
  /** 0..1, of the note's velocity (absent: 1, all of it). */
  velocity?: number;
  /** -1 (left) .. 1 (right), added to the note's (absent: 0). */
  pan?: number;
}

export interface ChopPattern {
  id: string;
  name: string;
  /** What it's for, in a few words (the menu and the assistant show it). */
  hint: string;
  /** Its pieces, one cycle; empty for Default, which is the snap. */
  pieces: ChopPiece[];
}

const n = (count: number, piece: ChopPiece): ChopPiece[] => Array.from({ length: count }, () => piece);

/** The Chopper's patterns: Default first, which cuts at the snap as Quick chop does. */
export const CHOP_PATTERNS: readonly ChopPattern[] = [
  { id: "default", name: "Default", hint: "Pieces the snap long, as Quick chop", pieces: [] },
  { id: "triplets", name: "Triplets", hint: "Three to a beat's half: sixteenth triplets", pieces: [{ steps: 2 / 3 }, { steps: 2 / 3, velocity: 0.75 }, { steps: 2 / 3, velocity: 0.75 }] },
  { id: "dotted", name: "Dotted", hint: "Dotted sixteenths, across the beat", pieces: [{ steps: 1.5 }] },
  { id: "gallop", name: "Gallop", hint: "An eighth then two sixteenths", pieces: [{ steps: 2 }, { steps: 1, velocity: 0.7 }, { steps: 1, velocity: 0.8 }] },
  { id: "reverse-gallop", name: "Reverse gallop", hint: "Two sixteenths then an eighth", pieces: [{ steps: 1, velocity: 0.8 }, { steps: 1, velocity: 0.7 }, { steps: 2 }] },
  { id: "3-3-2", name: "3-3-2", hint: "The tresillo: dotted eighths and an eighth to a half bar", pieces: [{ steps: 3 }, { steps: 3, velocity: 0.8 }, { steps: 2, velocity: 0.9 }] },
  {
    id: "trap-roll",
    name: "Trap roll",
    hint: "Hats speeding up over two beats: eighths, sixteenth triplets, then thirty-seconds",
    pieces: [
      { steps: 2 },
      { steps: 2, velocity: 0.8 },
      { steps: 2 / 3, velocity: 0.9 },
      { steps: 2 / 3, velocity: 0.7 },
      { steps: 2 / 3, velocity: 0.8 },
      { steps: 0.5, velocity: 0.6 },
      { steps: 0.5, velocity: 0.7 },
      { steps: 0.5, velocity: 0.8 },
      { steps: 0.5, velocity: 0.9 },
    ],
  },
  {
    id: "stutter",
    name: "Stutter",
    hint: "A beat that starts fast and slows: four, two, then one to a step",
    pieces: [...n(4, { steps: 0.25, velocity: 0.7 }), ...n(2, { steps: 0.5, velocity: 0.85 }), { steps: 1 }, { steps: 1, velocity: 0.9 }],
  },
  {
    id: "ramp",
    name: "Ramp",
    hint: "Thirty-seconds over a beat, rising from soft to loud",
    pieces: [0.35, 0.45, 0.55, 0.65, 0.72, 0.8, 0.9, 1].map((velocity) => ({ steps: 0.5, velocity })),
  },
  { id: "offbeat", name: "Offbeats", hint: "Only the eighths off the beat", pieces: [{ steps: 2, rest: true }, { steps: 2 }] },
  {
    id: "gate",
    name: "Gate",
    hint: "A trance gate: sixteenths on and off over a bar",
    pieces: [true, true, false, true, false, true, true, false, true, false, true, true, false, true, false, true].map((on) => ({ steps: 1, rest: !on })),
  },
  {
    id: "ping-pong",
    name: "Ping-pong",
    hint: "Sixteenths panned from side to side",
    pieces: [{ steps: 1, pan: -1 }, { steps: 1, pan: 1, velocity: 0.8 }],
  },
];

export const DEFAULT_CHOP_PATTERN = CHOP_PATTERNS[0];

export const chopPattern = (id: string): ChopPattern | undefined => CHOP_PATTERNS.find((p) => p.id === id);

/** Time mul's settings, from the knob's left end to its right: how much faster the pattern goes. */
export const TIME_MULS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3, 4] as const;
export const DEFAULT_TIME_MUL = 1;

export interface ChopOptions {
  /** The pattern's pieces, in ticks (`chopPieces`). */
  pieces: TickPiece[];
  /** The rhythm counted from the pattern's start (FL's Absolute pattern), rather than from each note's. */
  absolute: boolean;
  /** How much of the pieces' levels they get, 0..1 (the Levels knobs). */
  velocity: number;
  pan: number;
}

export interface TickPiece {
  length: number;
  rest: boolean;
  velocity: number;
  pan: number;
}

/**
 * A pattern's pieces in ticks, `timeMul` times as fast (Default's is one piece the `grid` long). Null when
 * that would make a piece shorter than a tick, or there's no grid to cut at.
 */
export function chopPieces(pattern: ChopPattern, timeMul: number, grid: number): TickPiece[] | null {
  const written = pattern.pieces.length ? pattern.pieces : [{ steps: grid / STEP_TICKS }];
  const pieces = written.map((piece) => ({
    length: Math.round((piece.steps * STEP_TICKS) / timeMul),
    rest: !!piece.rest,
    velocity: clamp(piece.velocity ?? 1, 0, 1),
    pan: clamp(piece.pan ?? 0, -1, 1),
  }));
  return pieces.every((p) => p.length >= 1) && pieces.some((p) => !p.rest) ? pieces : null;
}

/** The most pieces one chop makes, so a fast pattern on long notes can't make millions. */
export const MAX_CHOPPED = 50_000;

/**
 * Chop: each note (the selection, or all of them) cut where the pattern's pieces end, the parts under a
 * rest cut out, and each piece given its share of the piece's levels. A note the pattern doesn't cut keeps
 * its length but still takes its piece's levels (it's that piece). The first piece of each note keeps the
 * note's id; every piece is in `created`, to be selected.
 */
export function chopToPattern(notes: Note[], ids: NoteIds, options: ChopOptions): Created {
  const { pieces, absolute } = options;
  const cycle = pieces.reduce((sum, p) => sum + p.length, 0);
  if (!pieces.length || cycle < 1 || pieces.every((p) => p.rest)) return { notes, created: [] };
  const chosen = orAll(notes, ids);
  // Where each piece starts in the cycle, to find the one a tick is in.
  const starts: number[] = [];
  pieces.reduce((at, p) => (starts.push(at), at + p.length), 0);

  const level = (note: Pick<Note, "velocity" | "pan">, piece: TickPiece) => ({
    velocity: clamp(note.velocity * (1 - options.velocity * (1 - piece.velocity)), 0, 1),
    pan: clamp(note.pan + options.pan * piece.pan, -1, 1),
  });

  const kept: Note[] = [];
  const added: NewNote[] = [];
  const keptIds: number[] = [];
  let changed = false;
  let made = 0;
  for (const note of notes) {
    if (!chosen.has(note.id) || made > MAX_CHOPPED) {
      kept.push(note);
      continue;
    }
    const origin = absolute ? 0 : note.start;
    const end = note.start + note.length;
    // The piece the note starts in, and where that piece started.
    const into = (((note.start - origin) % cycle) + cycle) % cycle;
    let index = 0;
    while (index + 1 < pieces.length && starts[index + 1] <= into) index++;
    let at = note.start - (into - starts[index]);
    let first = true;
    while (at < end) {
      const piece = pieces[index];
      const from = Math.max(at, note.start);
      const to = Math.min(at + piece.length, end);
      if (!piece.rest && to > from) {
        const part = { ...note, start: from, length: to - from, ...level(note, piece) };
        if (first) {
          kept.push(part);
          keptIds.push(note.id);
          first = false;
        } else added.push(part);
        made++;
      }
      at += piece.length;
      index = (index + 1) % pieces.length;
    }
    const after = first ? null : kept[kept.length - 1];
    if (!after || after.start !== note.start || after.length !== note.length || after.velocity !== note.velocity || after.pan !== note.pan) changed = true;
    else kept[kept.length - 1] = note;
  }
  if (!changed && !added.length) return { notes, created: [] };
  // A note starting in a rest starts later now: back in order (adding notes sorts them anyway).
  const result = added.length ? addNotes(kept, added) : { notes: kept.sort(byStart), created: [] };
  return { notes: result.notes, created: [...keptIds, ...result.created] };
}
