import { describe, expect, it } from "vitest";
import type { Note } from "@shared/music/types";
import { cursorAlong, cursorUpDown, noteAtCursor, noteBeside, startingCursor, viewShowing } from "./cursor";

const note = (id: number, start: number, pitch: number, length = 24): Note => ({ id, start, pitch, length, velocity: 0.8, pan: 0, muted: false });
const view = { scrollTick: 0, pxPerTick: 1, topPitch: 72, rowHeight: 10 };

describe("the piano roll's cursor", () => {
  it("moves along by the grid, onto it from off it", () => {
    expect(cursorAlong({ tick: 24, pitch: 60 }, 1, 24)).toEqual({ tick: 48, pitch: 60 });
    expect(cursorAlong({ tick: 24, pitch: 60 }, -2, 24)).toEqual({ tick: 0, pitch: 60 });
    // Off a coarser grid: to the line that way first.
    expect(cursorAlong({ tick: 30, pitch: 60 }, 1, 96)).toEqual({ tick: 96, pitch: 60 });
    expect(cursorAlong({ tick: 30, pitch: 60 }, -1, 96)).toEqual({ tick: 0, pitch: 60 });
  });

  it("moves up and down by semitones, or by a scale's notes", () => {
    expect(cursorUpDown({ tick: 0, pitch: 60 }, 1, null).pitch).toBe(61);
    expect(cursorUpDown({ tick: 0, pitch: 127 }, 1, null).pitch).toBe(127);
    const cMajor = { root: 0, type: "major" } as const;
    // C → D → E → F, skipping the black keys.
    expect(cursorUpDown({ tick: 0, pitch: 60 }, 1, cMajor).pitch).toBe(62);
    expect(cursorUpDown({ tick: 0, pitch: 60 }, 3, cMajor).pitch).toBe(65);
    expect(cursorUpDown({ tick: 0, pitch: 60 }, -1, cMajor).pitch).toBe(59);
    // Off the scale (C#): to its nearest note that way.
    expect(cursorUpDown({ tick: 0, pitch: 61 }, 1, cMajor).pitch).toBe(62);
  });

  it("knows the note under it", () => {
    const notes = [note(1, 0, 60, 96), note(2, 48, 60), note(3, 0, 64)];
    expect(noteAtCursor(notes, { tick: 24, pitch: 60 })?.id).toBe(1);
    expect(noteAtCursor(notes, { tick: 50, pitch: 60 })?.id).toBe(2);
    expect(noteAtCursor(notes, { tick: 96, pitch: 60 })).toBeNull();
    expect(noteAtCursor(notes, { tick: 0, pitch: 62 })).toBeNull();
  });

  it("finds the note beside it, a chord from the bottom up", () => {
    const notes = [note(1, 0, 60), note(2, 0, 64), note(3, 0, 67), note(4, 96, 62)];
    expect(noteBeside(notes, { tick: 0, pitch: 60 }, 1)?.id).toBe(2);
    expect(noteBeside(notes, { tick: 0, pitch: 67 }, 1)?.id).toBe(4);
    expect(noteBeside(notes, { tick: 96, pitch: 62 }, 1)).toBeNull();
    expect(noteBeside(notes, { tick: 96, pitch: 62 }, -1)?.id).toBe(3);
    expect(noteBeside(notes, { tick: 48, pitch: 0 }, -1)?.id).toBe(3);
  });

  it("scrolls the view to keep it in sight, with room round it", () => {
    // 400 ticks and 30 rows show: 72 down to 43.
    expect(viewShowing(view, { tick: 100, pitch: 60 }, 24, 400, 300)).toBe(view);
    expect(viewShowing(view, { tick: 500, pitch: 60 }, 24, 400, 300).scrollTick).toBe(500 + 24 - 400 + 48);
    expect(viewShowing({ ...view, scrollTick: 200 }, { tick: 100, pitch: 60 }, 24, 400, 300).scrollTick).toBe(52);
    expect(viewShowing(view, { tick: 0, pitch: 80 }, 24, 400, 300).topPitch).toBe(82);
    expect(viewShowing(view, { tick: 0, pitch: 30 }, 24, 400, 300).topPitch).toBe(30 + 29 - 2);
  });

  it("starts on the first selected note, else at the view's left, mid-height", () => {
    expect(startingCursor(view, [note(1, 48, 50)], new Set([1]), 24, 300)).toEqual({ tick: 48, pitch: 50 });
    expect(startingCursor({ ...view, scrollTick: 30 }, [], new Set(), 24, 300)).toEqual({ tick: 48, pitch: 57 });
  });
});
