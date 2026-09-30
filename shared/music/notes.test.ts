import { describe, expect, it } from "vitest";
import {
  HIGHEST_PITCH,
  MAX_TICK,
  addNotes,
  chopNotes,
  cloneNotes,
  copyNotes,
  discardLengths,
  duplicateNotes,
  glueNotes,
  legatoNotes,
  moveNotes,
  noteBounds,
  notesInRect,
  notesInTime,
  orAll,
  pasteNotes,
  quantizeNotes,
  removeNotes,
  resizeNotes,
  rotateNotes,
  setNoteProps,
  setNoteValues,
  sliceNotes,
  stretchNotes,
} from "./notes.ts";
import { byStart } from "./project.ts";
import type { Note } from "./types.ts";

const BAR = 384;
/** Notes from a short description: [start, length, pitch]. Ids are 1, 2, 3... in the order given. */
const make = (...specs: [number, number, number][]): Note[] =>
  specs.map(([start, length, pitch], i) => ({ id: i + 1, start, length, pitch, velocity: 0.78, pan: 0, muted: false })).sort(byStart);
const ids = (...list: number[]) => new Set(list);
/** A list as [id, start, length, pitch], to compare. */
const shape = (notes: Note[]) => notes.map((n) => [n.id, n.start, n.length, n.pitch]);
const sorted = (notes: Note[]) => notes.every((n, i) => i === 0 || byStart(notes[i - 1], n) <= 0);
const unique = (notes: Note[]) => new Set(notes.map((n) => n.id)).size === notes.length;

const melody = () => make([0, 96, 60], [96, 96, 64], [192, 48, 67], [240, 144, 72]);

describe("looking at notes", () => {
  it("finds what they span, the ones a rectangle touches and the ones a time range starts", () => {
    const notes = melody();
    expect(noteBounds(notes)).toEqual({ start: 0, end: 384, low: 60, high: 72 });
    expect(noteBounds(notes, ids(2, 3))).toEqual({ start: 96, end: 240, low: 64, high: 67 });
    expect(noteBounds(notes, ids(99))).toBeNull();
    expect(noteBounds([])).toBeNull();
    // Touching counts: a note that ends inside the rectangle, or starts inside it.
    expect(notesInRect(notes, 90, 200, 60, 67)).toEqual([1, 2, 3]);
    expect(notesInRect(notes, 96, 192, 64, 64)).toEqual([2]);
    expect(notesInRect(notes, 96, 96, 0, 127)).toEqual([]);
    expect(notesInTime(notes, 96, 240)).toEqual([2, 3]);
    expect([...orAll(notes, ids())]).toEqual([1, 2, 3, 4]);
    expect([...orAll(notes, ids(2))]).toEqual([2]);
  });
});

describe("adding and removing", () => {
  it("adds notes with ids of their own, kept in order, within what a note can be", () => {
    const { notes, created } = addNotes(melody(), [
      { start: 48.4, length: 0, pitch: 200, velocity: 3 },
      { start: -5, length: 24, pitch: 61 },
    ]);
    expect(created).toEqual([5, 6]);
    expect(sorted(notes)).toBe(true);
    expect(notes.find((n) => n.id === 5)).toEqual({ id: 5, start: 48, length: 1, pitch: HIGHEST_PITCH, velocity: 1, pan: 0, muted: false });
    expect(notes.find((n) => n.id === 6)).toMatchObject({ start: 0, velocity: 0.78 });
    const same = melody();
    expect(addNotes(same, []).notes).toBe(same);
  });

  it("removes notes, or nothing", () => {
    const notes = melody();
    expect(shape(removeNotes(notes, ids(1, 3)))).toEqual([
      [2, 96, 96, 64],
      [4, 240, 144, 72],
    ]);
    expect(removeNotes(notes, ids())).toBe(notes);
    expect(removeNotes(notes, ids(99))).toBe(notes);
  });
});

describe("moving and resizing", () => {
  it("moves notes in time and pitch, and keeps the list in order", () => {
    const moved = moveNotes(melody(), ids(1), 300, 5);
    expect(shape(moved)).toEqual([
      [2, 96, 96, 64],
      [3, 192, 48, 67],
      [4, 240, 144, 72],
      [1, 300, 96, 65],
    ]);
    const notes = melody();
    expect(moveNotes(notes, ids(1), 0, 0)).toBe(notes);
    expect(moveNotes(notes, ids(), 10, 1)).toBe(notes);
  });

  it("moves them together: against an edge, the whole shape stops", () => {
    const notes = melody();
    // The first can't go before the start, so none of them moves left at all.
    expect(moveNotes(notes, ids(1, 2, 3, 4), -50, 0)).toBe(notes);
    // Note 2 can go back 96 and no further; the others moving with it keep their distance.
    expect(shape(moveNotes(notes, ids(2, 3), -500, 0)).filter(([id]) => id !== 1 && id !== 4)).toEqual([
      [2, 0, 96, 64],
      [3, 96, 48, 67],
    ]);
    // Up: the highest note (72) reaches the top of the keyboard and the chord keeps its shape.
    const up = moveNotes(notes, ids(1, 4), 0, 100);
    expect(up.find((n) => n.id === 4)!.pitch).toBe(127);
    expect(up.find((n) => n.id === 1)!.pitch).toBe(60 + 55);
    expect(moveNotes(notes, ids(1), 0, -100).find((n) => n.id === 1)!.pitch).toBe(0);
    expect(moveNotes(notes, ids(4), MAX_TICK * 2, 0).find((n) => n.id === 4)!.start).toBe(MAX_TICK - 1);
  });

  it("resizes notes by an amount, none shorter than the least allowed", () => {
    const notes = melody();
    expect(shape(resizeNotes(notes, ids(1, 3), 24))).toEqual([
      [1, 0, 120, 60],
      [2, 96, 96, 64],
      [3, 192, 72, 67],
      [4, 240, 144, 72],
    ]);
    const short = resizeNotes(notes, ids(1, 3), -90, 24);
    expect(short.find((n) => n.id === 1)!.length).toBe(24);
    expect(short.find((n) => n.id === 3)!.length).toBe(24);
    expect(resizeNotes(notes, ids(1), 0)).toBe(notes);
    expect(discardLengths(notes, ids(), 24).map((n) => n.length)).toEqual([24, 24, 24, 24]);
  });

  it("sets properties outright, and a value per note", () => {
    const notes = melody();
    const muted = setNoteProps(notes, ids(2, 3), { muted: true, velocity: 2, pan: -0.5 });
    expect(muted.filter((n) => n.muted).map((n) => n.id)).toEqual([2, 3]);
    expect(muted.find((n) => n.id === 2)).toMatchObject({ velocity: 1, pan: -0.5 });
    expect(setNoteProps(notes, ids(1), { velocity: 0.78 })).toBe(notes);
    const drawn = setNoteValues(
      notes,
      new Map([
        [1, { velocity: 0.1 }],
        [4, { velocity: 0.9 }],
        [99, { velocity: 0.5 }],
      ]),
    );
    expect(drawn.map((n) => n.velocity)).toEqual([0.1, 0.78, 0.78, 0.9]);
    expect(setNoteValues(notes, new Map())).toBe(notes);
    // The properties dialog can move a note: the list is put back in order.
    expect(sorted(setNoteProps(notes, ids(1), { start: 500 }))).toBe(true);
  });

  it("stretches notes about a point: their distance from it and their length both", () => {
    const notes = melody();
    expect(shape(stretchNotes(notes, ids(1, 2, 3, 4), 2, 0))).toEqual([
      [1, 0, 192, 60],
      [2, 192, 192, 64],
      [3, 384, 96, 67],
      [4, 480, 288, 72],
    ]);
    expect(shape(stretchNotes(notes, ids(2, 3), 0.5, 96)).filter(([id]) => id === 2 || id === 3)).toEqual([
      [2, 96, 48, 64],
      [3, 144, 24, 67],
    ]);
    expect(stretchNotes(notes, ids(1), 1, 0)).toBe(notes);
    expect(stretchNotes(notes, ids(1), 0, 0)).toBe(notes);
  });

  it("rotates notes round a span", () => {
    const notes = make([0, 24, 60], [360, 24, 60]);
    expect(rotateNotes(notes, ids(), 24, BAR).map((n) => n.start)).toEqual([0, 24]);
    expect(rotateNotes(notes, ids(), -24, BAR).map((n) => n.start)).toEqual([336, 360]);
  });
});

describe("copies", () => {
  it("clones notes elsewhere, leaving the originals", () => {
    const { notes, created } = cloneNotes(melody(), ids(1, 2), 384, 12);
    expect(created).toEqual([5, 6]);
    expect(notes).toHaveLength(6);
    expect(shape(notes.filter((n) => created.includes(n.id)))).toEqual([
      [5, 384, 96, 72],
      [6, 480, 96, 76],
    ]);
    expect(unique(notes) && sorted(notes)).toBe(true);
    const same = melody();
    expect(cloneNotes(same, ids(), 10, 0).notes).toBe(same);
  });

  it("duplicates a phrase into the bars after it", () => {
    // A bar of notes: the copy is a bar later.
    const one = duplicateNotes(melody(), ids(), BAR);
    expect(one.interval).toBe(BAR);
    expect(one.created).toEqual([5, 6, 7, 8]);
    expect(one.notes.filter((n) => one.created.includes(n.id)).map((n) => n.start)).toEqual([384, 480, 576, 624]);
    // Notes that fill half a bar still repeat a bar later: the bar they're in is what repeats.
    const half = duplicateNotes(make([96, 48, 60], [144, 48, 62]), ids(), BAR);
    expect(half.interval).toBe(BAR);
    expect(half.notes.map((n) => n.start)).toEqual([96, 144, 480, 528]);
    // A note that runs into the next bar: two bars repeat.
    expect(duplicateNotes(make([0, 400, 60]), ids(), BAR).interval).toBe(2 * BAR);
    // A phrase that starts in bar 2 repeats from there.
    expect(duplicateNotes(make([400, 24, 60]), ids(), BAR).notes.map((n) => n.start)).toEqual([400, 784]);
  });

  it("duplicates only what's selected, and by the time selection's length when there is one", () => {
    const selected = duplicateNotes(melody(), ids(3), BAR);
    expect(selected.created).toEqual([5]);
    expect(selected.notes.find((n) => n.id === 5)).toMatchObject({ start: 192 + BAR, pitch: 67 });
    const timed = duplicateNotes(melody(), ids(3), BAR, 96);
    expect(timed.interval).toBe(96);
    expect(timed.notes.find((n) => n.id === 5)!.start).toBe(288);
    // Again and again: each copy of the copies lands one interval further.
    let notes = melody();
    let chosen = ids(1);
    for (let i = 0; i < 3; i++) {
      const next = duplicateNotes(notes, chosen, BAR, 96);
      notes = next.notes;
      chosen = new Set(next.created);
    }
    expect(notes.filter((n) => n.pitch === 60).map((n) => n.start)).toEqual([0, 96, 192, 288]);
    expect(duplicateNotes([], ids(), BAR)).toMatchObject({ notes: [], created: [], interval: 0 });
  });

  it("copies notes relative to the first, and pastes them where asked", () => {
    const copied = copyNotes(melody(), ids(2, 3));
    expect(copied.map((n) => n.start)).toEqual([0, 96]);
    const { notes, created } = pasteNotes(melody(), copied, 768);
    expect(shape(notes.filter((n) => created.includes(n.id)))).toEqual([
      [5, 768, 96, 64],
      [6, 864, 48, 67],
    ]);
    expect(pasteNotes(melody(), copied, MAX_TICK).created).toEqual([]);
  });
});

describe("tools", () => {
  it("quantizes starts and ends to the grid, or starts alone", () => {
    const loose = make([5, 40, 60], [50, 20, 62], [100, 4, 64]);
    expect(shape(quantizeNotes(loose, ids(), 24))).toEqual([
      [1, 0, 48, 60],
      [2, 48, 24, 62],
      // Too short to reach another line: it keeps a cell.
      [3, 96, 24, 64],
    ]);
    expect(shape(quantizeNotes(loose, ids(), 24, "starts"))).toEqual([
      [1, 0, 40, 60],
      [2, 48, 20, 62],
      [3, 96, 4, 64],
    ]);
    expect(shape(quantizeNotes(loose, ids(2), 24)).find(([id]) => id === 1)).toEqual([1, 5, 40, 60]);
    const tight = make([0, 24, 60], [48, 48, 62]);
    expect(quantizeNotes(tight, ids(), 24)).toBe(tight);
    expect(quantizeNotes(tight, ids(), 0)).toBe(tight);
  });

  it("holds each note until the next starts (legato), chords together", () => {
    const notes = make([0, 10, 60], [0, 10, 64], [96, 200, 62], [240, 10, 65]);
    expect(shape(legatoNotes(notes, ids()))).toEqual([
      [1, 0, 96, 60],
      [2, 0, 96, 64],
      [3, 96, 144, 62],
      [4, 240, 10, 65],
    ]);
    const one = make([0, 10, 60]);
    expect(legatoNotes(one, ids())).toBe(one);
  });

  it("glues notes of a pitch that touch or overlap, and leaves the rest", () => {
    const notes = make([0, 48, 60], [48, 48, 60], [90, 30, 60], [200, 24, 60], [48, 48, 62]);
    expect(shape(glueNotes(notes, ids()))).toEqual([
      [1, 0, 120, 60],
      [5, 48, 48, 62],
      [4, 200, 24, 60],
    ]);
    // Only among what's selected.
    expect(shape(glueNotes(notes, ids(1, 2))).map(([id]) => id)).toEqual([1, 5, 3, 4]);
    const apart = make([0, 24, 60], [48, 24, 60]);
    expect(glueNotes(apart, ids())).toBe(apart);
  });

  it("chops notes into grid-sized pieces, all of them selected after", () => {
    const { notes, created } = chopNotes(make([0, 60, 60], [200, 24, 62]), ids(), 24);
    expect(shape(notes)).toEqual([
      [1, 0, 24, 60],
      [3, 24, 24, 60],
      [4, 48, 12, 60],
      [2, 200, 24, 62],
    ]);
    expect(created).toEqual([1, 3, 4]);
    const small = make([0, 24, 60]);
    expect(chopNotes(small, ids(), 24).notes).toBe(small);
  });

  it("slices notes where the cut crosses their pitch", () => {
    const notes = make([0, 96, 60], [0, 96, 62], [0, 96, 64]);
    // A slanted cut: later on higher pitches, and missing the top note.
    const { notes: cut, created } = sliceNotes(notes, (pitch) => (pitch === 64 ? null : 24 + (pitch - 60) * 12));
    expect(shape(cut)).toEqual([
      [1, 0, 24, 60],
      [2, 0, 48, 62],
      [3, 0, 96, 64],
      [4, 24, 72, 60],
      [5, 48, 48, 62],
    ]);
    expect(created).toEqual([4, 5]);
    // At a note's edge, or outside it: nothing to cut.
    expect(sliceNotes(notes, () => 0).notes).toBe(notes);
    expect(sliceNotes(notes, () => 96).notes).toBe(notes);
    expect(sliceNotes(notes, () => 48, ids(2)).created).toEqual([4]);
  });
});

describe("with a great many notes", () => {
  /** A dense pattern: 20 000 notes over 62 bars, five starting on every quarter of a step. */
  const COUNT = 20_000;
  const many = (): Note[] =>
    Array.from({ length: COUNT }, (_, i) => ({
      id: i + 1,
      start: (i % 4000) * 6,
      length: 12 + (i % 5) * 12,
      pitch: 24 + ((i * 7) % 80),
      velocity: 0.78,
      pan: 0,
      muted: false,
    })).sort(byStart);
  /** The time a piece of work takes, in ms (the best of three, so a pause elsewhere doesn't count). */
  const time = (work: () => void) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      work();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const notes = many();
  const all = new Set(notes.map((n) => n.id));
  const half = new Set(notes.filter((n) => n.id % 2).map((n) => n.id));
  /** Generous: these run in a few milliseconds; the limit only catches work that grows with the square of the notes. */
  const LIMIT_MS = 150;

  it("keeps every operation quick", () => {
    const timings: Record<string, number> = {
      select: time(() => notesInRect(notes, 3000, 9000, 40, 70)),
      bounds: time(() => noteBounds(notes, half)),
      move: time(() => moveNotes(notes, half, 96, 3)),
      resize: time(() => resizeNotes(notes, all, 12)),
      remove: time(() => removeNotes(notes, half)),
      clone: time(() => cloneNotes(notes, half, 384, 0)),
      duplicate: time(() => duplicateNotes(notes, all, BAR)),
      paste: time(() => pasteNotes(notes, copyNotes(notes, half), 9600)),
      quantize: time(() => quantizeNotes(notes, all, 24)),
      legato: time(() => legatoNotes(notes, all)),
      glue: time(() => glueNotes(notes, all)),
      chop: time(() => chopNotes(notes, all, 12)),
      slice: time(() => sliceNotes(notes, () => 9000)),
      stretch: time(() => stretchNotes(notes, half, 1.5, 0)),
      values: time(() => setNoteValues(notes, new Map([...half].map((id) => [id, { velocity: 0.5 }])))),
    };
    for (const [name, ms] of Object.entries(timings)) expect(ms, `${name} took ${ms.toFixed(1)} ms`).toBeLessThan(LIMIT_MS);
  });

  it("stays correct: ids stay unique, the list in order, nothing lost", () => {
    const duplicated = duplicateNotes(notes, half, BAR);
    expect(duplicated.notes).toHaveLength(COUNT + half.size);
    expect(unique(duplicated.notes) && sorted(duplicated.notes)).toBe(true);
    const chopped = chopNotes(notes, all, 12);
    expect(unique(chopped.notes) && sorted(chopped.notes)).toBe(true);
    // Chopping changes no sound: the pieces of each pitch cover exactly what the notes did.
    const covered = (list: Note[]) => list.reduce((sum, n) => sum + n.length, 0);
    expect(covered(chopped.notes)).toBe(covered(notes));
    const moved = moveNotes(notes, half, 96, 3);
    expect(moved).toHaveLength(COUNT);
    expect(sorted(moved)).toBe(true);
    // Moving there and back is where it started.
    expect(shape(moveNotes(moved, half, -96, -3))).toEqual(shape(notes));
    const glued = glueNotes(chopped.notes, new Set());
    expect(covered(glued)).toBeLessThanOrEqual(covered(notes));
    expect(unique(glued) && sorted(glued)).toBe(true);
  });
});
