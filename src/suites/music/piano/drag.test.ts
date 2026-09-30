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

  it("leaves the notes alone without a drag, or for a selection rectangle", () => {
    expect(applyDrag(notes, null, 24).notes).toBe(notes);
    expect(applyDrag(notes, { kind: "rect", from: 0, to: 500, low: 0, high: 127, add: false }, 24).notes).toBe(notes);
  });

  it("moves, or clones when Shift is held: the clones are what it made", () => {
    expect(shape(applyDrag(notes, { kind: "move", ids: ids(1), ticks: 48, semitones: 2, clone: false }, 24).notes)[0]).toEqual([1, 48, 96, 62]);
    const cloned = applyDrag(notes, { kind: "move", ids: ids(1, 2), ticks: 384, semitones: 0, clone: true }, 24);
    expect(cloned.created).toEqual([4, 5]);
    expect(cloned.notes).toHaveLength(5);
  });

  it("resizes, stretches, erases, mutes and sets values", () => {
    expect(applyDrag(notes, { kind: "resize", ids: ids(1, 2), ticks: -48 }, 24).notes.map((n) => n.length)).toEqual([48, 48, 96]);
    expect(applyDrag(notes, { kind: "stretch", ids: ids(1, 2, 3), factor: 0.5, anchor: 0 }, 24).notes.map((n) => n.start)).toEqual([0, 48, 96]);
    expect(applyDrag(notes, { kind: "erase", ids: ids(2) }, 24).notes.map((n) => n.id)).toEqual([1, 3]);
    expect(applyDrag(notes, { kind: "mute", ids: ids(3), muted: true }, 24).notes.map((n) => n.muted)).toEqual([false, false, true]);
    expect(applyDrag(notes, { kind: "values", values: new Map([[2, { velocity: 0.2 }]]) }, 24).notes[1].velocity).toBe(0.2);
  });

  it("adds the notes being drawn, and slices along the line", () => {
    const added = applyDrag(notes, { kind: "add", notes: [{ start: 300, length: 24, pitch: 72 }] }, 24);
    expect(added.created).toEqual([4]);
    const sliced = applyDrag(notes, { kind: "slice", a: { tick: 50, pitch: 61 }, b: { tick: 50, pitch: 59 } }, 24);
    expect(shape(sliced.notes)).toEqual([
      [1, 0, 48, 60],
      [4, 48, 48, 60],
      [2, 96, 96, 64],
      [3, 192, 96, 67],
    ]);
  });

  it("selects what a rectangle touches, in whichever direction it was dragged", () => {
    const rect = { kind: "rect" as const, from: 250, to: 100, low: 70, high: 62, add: false };
    expect([...rectSelection(notes, rect, ids(1))]).toEqual([2, 3]);
    expect([...rectSelection(notes, { ...rect, add: true }, ids(1))].sort()).toEqual([1, 2, 3]);
  });
});
