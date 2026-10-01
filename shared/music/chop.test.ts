import { describe, expect, it } from "vitest";
import { CHOP_PATTERNS, type ChopOptions, chopPattern, chopPieces, chopToPattern } from "./chop.ts";
import { chopNotes } from "./notes.ts";
import { STEP_TICKS, type Note } from "./types.ts";

const note = (id: number, start: number, length: number, extra: Partial<Note> = {}): Note => ({ id, start, length, pitch: 60, velocity: 0.8, pan: 0, muted: false, ...extra });
const none = new Set<number>();
const options = (id: string, extra: Partial<ChopOptions> = {}, timeMul = 1, grid = STEP_TICKS): ChopOptions => ({
  pieces: chopPieces(chopPattern(id)!, timeMul, grid)!,
  absolute: true,
  velocity: 0,
  pan: 0,
  ...extra,
});
const spans = (notes: Note[]) => notes.map((n) => [n.start, n.length]);

describe("chop patterns", () => {
  it("are all whole ticks, with something to play", () => {
    for (const pattern of CHOP_PATTERNS) {
      const pieces = chopPieces(pattern, 1, STEP_TICKS);
      expect(pieces, pattern.id).not.toBeNull();
      for (const [i, piece] of pattern.pieces.entries()) expect(Number.isInteger(piece.steps * STEP_TICKS), `${pattern.id} ${i}`).toBe(true);
    }
    expect(new Set(CHOP_PATTERNS.map((p) => p.id)).size).toBe(CHOP_PATTERNS.length);
  });

  it("go faster with Time mul, and refuse pieces under a tick", () => {
    expect(chopPieces(chopPattern("gallop")!, 2, STEP_TICKS)!.map((p) => p.length)).toEqual([24, 12, 12]);
    expect(chopPieces(chopPattern("gallop")!, 1 / 2, STEP_TICKS)!.map((p) => p.length)).toEqual([96, 48, 48]);
    expect(chopPieces(chopPattern("default")!, 1, 12)!.map((p) => p.length)).toEqual([12]);
    expect(chopPieces(chopPattern("default")!, 4, 1)).toBeNull();
  });
});

describe("chopToPattern", () => {
  it("cuts as Quick chop does with Default", () => {
    const notes = [note(1, 0, 96), note(2, 96, 30)];
    const chopped = chopToPattern(notes, none, options("default"));
    expect(spans(chopped.notes)).toEqual(spans(chopNotes(notes, none, STEP_TICKS).notes));
    expect(chopped.notes.find((n) => n.start === 0)!.id).toBe(1);
    expect(chopped.created).toHaveLength(6);
  });

  it("cuts in the pattern's rhythm, counted from the pattern's start", () => {
    // A gallop is 48, 24, 24 ticks: a note from 24 starts half way through its first piece.
    const chopped = chopToPattern([note(1, 24, 168)], none, options("gallop"));
    expect(spans(chopped.notes)).toEqual([[24, 24], [48, 24], [72, 24], [96, 48], [144, 24], [168, 24]]);
  });

  it("starts the rhythm at each note without Absolute pattern", () => {
    const chopped = chopToPattern([note(1, 24, 96)], none, options("gallop", { absolute: false }));
    expect(spans(chopped.notes)).toEqual([[24, 48], [72, 24], [96, 24]]);
  });

  it("cuts out what falls in a rest, and drops a note that's all rest", () => {
    // Offbeats: 48 off, 48 on.
    const chopped = chopToPattern([note(1, 0, 192), note(2, 0, 24, { pitch: 62 })], none, options("offbeat"));
    expect(spans(chopped.notes)).toEqual([[48, 48], [144, 48]]);
    expect(chopped.notes.map((n) => n.pitch)).toEqual([60, 60]);
  });

  it("gives the pieces as much of the pattern's levels as the knobs say", () => {
    const at = (velocity: number, pan: number) => chopToPattern([note(1, 0, 48)], none, options("ping-pong", { velocity, pan })).notes;
    expect(at(0, 0).map((n) => [n.velocity, n.pan])).toEqual([[0.8, 0], [0.8, 0]]);
    expect(at(1, 1).map((n) => [n.velocity, n.pan])).toEqual([[0.8, -1], [0.8 * 0.8, 1]]);
    expect(at(0.5, 0.5).map((n) => n.pan)).toEqual([-0.5, 0.5]);
  });

  it("chops only the selection when there is one, and keeps the list in order", () => {
    const notes = [note(1, 0, 96), note(2, 0, 96, { pitch: 64 })];
    const chopped = chopToPattern(notes, new Set([2]), options("default"));
    expect(chopped.notes.filter((n) => n.pitch === 60)).toEqual([notes[0]]);
    expect(chopped.notes.filter((n) => n.pitch === 64)).toHaveLength(4);
    expect(chopped.notes.every((n, i, all) => i === 0 || all[i - 1].start <= n.start)).toBe(true);
    expect(new Set(chopped.notes.map((n) => n.id)).size).toBe(chopped.notes.length);
  });

  it("returns the same list when nothing changes", () => {
    const notes = [note(1, 0, 24), note(2, 24, 12)];
    expect(chopToPattern(notes, none, options("default")).notes).toBe(notes);
  });

  it("stops at a limit on the pieces made", () => {
    const notes = Array.from({ length: 30 }, (_, i) => note(i + 1, 0, 96 * 4 * 64, { pitch: 30 + i }));
    const chopped = chopToPattern(notes, none, options("ramp", {}, 4));
    expect(chopped.notes.length).toBeLessThan(60_000);
  });
});
