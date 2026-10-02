import { describe, expect, it } from "vitest";
import { byStart } from "@shared/music/project";
import type { Note } from "@shared/music/types";
import { applyDrag, rectSelection } from "./drag";

const make = (...specs: [number, number, number][]): Note[] =>
  specs.map(([start, length, pitch], i) => ({ id: i + 1, start, length, pitch, velocity: 0.78, pan: 0, muted: false })).sort(byStart);
const ids = (...list: number[]) => new Set(list);
const shape = (notes: Note[]) => notes.map((n) => [n.id, n.start, n.length, n.pitch]);

describe("applyDrag", () => {
  const notes = make([0, 96, 60], [96, 96, 64], [192, 96, 67]);

  it("leaves the notes alone without a drag, for a selection rectangle, or while scrubbing", () => {
    expect(applyDrag(notes, null).notes).toBe(notes);
    expect(applyDrag(notes, { kind: "rect", from: 0, to: 500, low: 0, high: 127, add: false }).notes).toBe(notes);
    expect(applyDrag(notes, { kind: "playback", tick: 100 }).notes).toBe(notes);
  });

  it("moves, or clones when Shift is held: the clones are what it made", () => {
    expect(shape(applyDrag(notes, { kind: "move", ids: ids(1), ticks: 48, semitones: 2, clone: false }).notes)[0]).toEqual([1, 48, 96, 62]);
    const cloned = applyDrag(notes, { kind: "move", ids: ids(1, 2), ticks: 384, semitones: 0, clone: true });
    expect(cloned.created).toEqual([4, 5]);
    expect(cloned.notes).toHaveLength(5);
  });

  it("resizes, stretches, erases, mutes and sets values", () => {
    expect(applyDrag(notes, { kind: "resize", ids: ids(1, 2), ticks: -48 }).notes.map((n) => n.length)).toEqual([48, 48, 96]);
    expect(applyDrag(notes, { kind: "stretch", ids: ids(1, 2, 3), factor: 0.5, anchor: 0 }).notes.map((n) => n.start)).toEqual([0, 48, 96]);
    expect(applyDrag(notes, { kind: "erase", ids: ids(2) }).notes.map((n) => n.id)).toEqual([1, 3]);
    expect(applyDrag(notes, { kind: "mute", ids: ids(3), muted: true }).notes.map((n) => n.muted)).toEqual([false, false, true]);
    expect(applyDrag(notes, { kind: "values", values: new Map([[2, { velocity: 0.2 }]]) }).notes[1].velocity).toBe(0.2);
  });

  it("adds the notes being drawn, and slices the rows the line crosses where it is", () => {
    const added = applyDrag(notes, { kind: "add", notes: [{ start: 300, length: 24, pitch: 72 }] });
    expect(added.created).toEqual([4]);
    const sliced = applyDrag(notes, { kind: "slice", tick: 48, low: 61, high: 59, column: false });
    expect(shape(sliced.notes)).toEqual([
      [1, 0, 48, 60],
      [4, 48, 48, 60],
      [2, 96, 96, 64],
      [3, 192, 96, 67],
    ]);
    // Up to E5 and through G5, it cuts both where they're crossed; a cut at a note's edge isn't one.
    const two = applyDrag(notes, { kind: "slice", tick: 240, low: 60, high: 67, column: false });
    expect(two.created).toEqual([4]);
    expect(applyDrag(notes, { kind: "slice", tick: 96, low: 60, high: 64, column: false }).notes).toBe(notes);
    // Shift: the whole column, whatever rows the line was dragged across.
    const column = applyDrag(notes, { kind: "slice", tick: 240, low: 60, high: 60, column: true });
    expect(shape(column.notes)).toEqual([
      [1, 0, 96, 60],
      [2, 96, 96, 64],
      [3, 192, 48, 67],
      [4, 240, 48, 67],
    ]);
  });

  it("selects what a rectangle touches, in whichever direction it was dragged", () => {
    const rect = { kind: "rect" as const, from: 250, to: 100, low: 70, high: 62, add: false };
    expect([...rectSelection(notes, rect, ids(1))]).toEqual([2, 3]);
    expect([...rectSelection(notes, { ...rect, add: true }, ids(1))].sort()).toEqual([1, 2, 3]);
  });
});

describe("moving notes with the song's scale", () => {
  it("lands each on its nearest note of the scale when it's moved up or down, not along", () => {
    const notes = make([0, 96, 60], [96, 96, 64]);
    const cMajor = { root: 0, type: "major" as const };
    // Up a semitone: C to C# (B... no: C# isn't in C major: to C) and E to F.
    expect(shape(applyDrag(notes, { kind: "move", ids: ids(1, 2), ticks: 0, semitones: 1, clone: false, scale: cMajor }).notes)).toEqual([
      [1, 0, 96, 60],
      [2, 96, 96, 65],
    ]);
    // Along only: they stay as they are.
    const along = make([0, 96, 61]);
    expect(shape(applyDrag(along, { kind: "move", ids: ids(1), ticks: 24, semitones: 0, clone: false, scale: cMajor }).notes)).toEqual([[1, 24, 96, 61]]);
    // Without a scale (Alt): anywhere.
    expect(shape(applyDrag(notes, { kind: "move", ids: ids(1), ticks: 0, semitones: 1, clone: false, scale: null }).notes)[0]).toEqual([1, 0, 96, 61]);
  });
});
