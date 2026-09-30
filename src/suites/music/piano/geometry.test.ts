import { describe, expect, it } from "vitest";
import { byStart } from "@shared/music/project";
import type { Note } from "@shared/music/types";
import {
  wheelZoomFactor,
  type PianoView,
  formatLength,
  formatPosition,
  gridTicks,
  hitNote,
  isBlackKey,
  keyAt,
  paintStarts,
  parseTime,
  pitchFromName,
  pitchName,
  pitchToY,
  snapDelta,
  snapTick,
  snapTicks,
  tickToX,
  visibleRange,
  whiteKeys,
  xToTick,
  yToPitch,
  zoomAt,
  zoomRowsAt,
  MAX_ROW_HEIGHT,
  MIN_ROW_HEIGHT,
  zoomToRange,
} from "./geometry";

const BAR = 384;
const view: PianoView = { scrollTick: 96, pxPerTick: 0.5, topPitch: 72, rowHeight: 16 };
const make = (...specs: [number, number, number][]): Note[] =>
  specs.map(([start, length, pitch], i) => ({ id: i + 1, start, length, pitch, velocity: 0.78, pan: 0, muted: false })).sort(byStart);

describe("where things are", () => {
  it("maps ticks to x and pitches to rows, and back", () => {
    expect(tickToX(view, 96)).toBe(0);
    expect(tickToX(view, 296)).toBe(100);
    expect(xToTick(view, 100)).toBe(296);
    // Pitch 72's row is the top one: y 0 to 16.
    expect(pitchToY(view, 72)).toBe(0);
    expect(pitchToY(view, 60)).toBe(192);
    expect(yToPitch(view, 0.5)).toBe(72);
    expect(yToPitch(view, 15.9)).toBe(72);
    expect(yToPitch(view, 16.1)).toBe(71);
    expect(yToPitch(view, -5000)).toBe(127);
    expect(yToPitch(view, 99999)).toBe(0);
  });

  it("names pitches FL Studio's way: 60 is C5", () => {
    expect(pitchName(60)).toBe("C5");
    expect(pitchName(61)).toBe("C#5");
    expect(pitchName(0)).toBe("C0");
    expect(pitchFromName("c5")).toBe(60);
    expect(pitchFromName("F#4")).toBe(54);
    expect(pitchFromName("Bb3")).toBe(46);
    expect(pitchFromName("H2")).toBeNull();
    expect(pitchFromName("C99")).toBeNull();
    expect([60, 61, 62, 63, 64].map(isBlackKey)).toEqual([false, true, false, true, false]);
  });

  it("draws white keys at a piano's sizes: three from C to E, four from F to B, meeting the rows at E|F and B|C", () => {
    // C5's row is y 192 to 208; the octave's rows go up from 208, 16 px each.
    const keys = whiteKeys(view, 60, 71);
    expect(keys.map((k) => k.pitch)).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(keys[0]).toEqual({ pitch: 60, top: 208 - (16 * 5) / 3, bottom: 208 });
    expect(keys[2].top).toBe(128);
    expect(keys[3].bottom).toBe(128);
    expect(keys[6].top).toBe(16);
    // Every key meets the next: no gaps, no overlaps.
    for (let i = 1; i < keys.length; i++) expect(keys[i].bottom).toBeCloseTo(keys[i - 1].top);
  });

  it("finds the key under the pointer by its true shape, black keys over the white", () => {
    const black = 30;
    // In C#5's row: on the black key, or past its end, on C5 or D5 by where the white keys meet.
    expect(keyAt(view, 10, 185, black)).toBe(61);
    expect(keyAt(view, 40, 185, black)).toBe(60);
    expect(keyAt(view, 40, 178, black)).toBe(62);
    expect(keyAt(view, 10, 170, black)).toBe(62);
    // Either side of E|F, and of B|C.
    expect(keyAt(view, 40, 129, black)).toBe(64);
    expect(keyAt(view, 40, 127, black)).toBe(65);
    expect(keyAt(view, 40, 15, black)).toBe(72);
    expect(keyAt(view, 40, 17, black)).toBe(71);
  });
});

describe("the grid and snapping", () => {
  it("shows the finest division whose lines aren't too close, coarser as it zooms out", () => {
    expect(gridTicks(2, BAR)).toBe(6);
    expect(gridTicks(1, BAR)).toBe(12);
    expect(gridTicks(0.5, BAR)).toBe(24);
    expect(gridTicks(0.2, BAR)).toBe(48);
    expect(gridTicks(0.1, BAR)).toBe(96);
    expect(gridTicks(0.03, BAR)).toBe(384);
    expect(gridTicks(0.02, BAR)).toBe(768);
  });

  it("gives each snap setting its size", () => {
    expect(snapTicks("none", 0.5, BAR)).toBe(1);
    expect(snapTicks("line", 0.5, BAR)).toBe(24);
    expect(snapTicks("cell", 0.1, BAR)).toBe(96);
    expect(snapTicks("step", 0.5, BAR)).toBe(24);
    expect(snapTicks("step/3", 0.5, BAR)).toBe(8);
    expect(snapTicks("beat/2", 0.5, BAR)).toBe(48);
    expect(snapTicks("beat", 0.5, BAR)).toBe(96);
    expect(snapTicks("bar", 0.5, BAR)).toBe(384);
  });

  it("puts a new note at the start of its cell, and an edge on the nearest line", () => {
    expect(snapTick(47, 24, "cell")).toBe(24);
    expect(snapTick(48, 24, "cell")).toBe(48);
    expect(snapTick(37, 24, "line")).toBe(48);
    expect(snapTick(35, 24, "line")).toBe(24);
    expect(snapTick(-10, 24, "cell")).toBe(0);
    // A drag moves by whole cells: a note off the grid stays as far off it.
    expect(snapDelta(30, 24)).toBe(24);
    expect(snapDelta(-40, 24)).toBe(-48);
    expect(snapDelta(7, 1)).toBe(7);
  });

  it("reads and writes positions and lengths as bar:step:tick", () => {
    expect(formatPosition(0, BAR)).toBe("1:01:00");
    expect(formatPosition(384 + 24 * 4 + 5, BAR)).toBe("2:05:05");
    expect(formatLength(72, BAR)).toBe("0:03:00");
    expect(formatLength(384 + 30, BAR)).toBe("1:01:06");
    expect(parseTime("2:05:05", BAR, true)).toBe(485);
    expect(parseTime("0:03:00", BAR, false)).toBe(72);
    expect(parseTime("1:1", BAR, true)).toBeNull();
    expect(parseTime("0:01:00", BAR, true)).toBeNull();
    expect(parseTime("a:b:c", BAR, false)).toBeNull();
  });
});

describe("notes on screen", () => {
  const notes = make([0, 600, 60], [96, 96, 64], [100, 96, 64], [400, 48, 67], [800, 24, 60]);

  it("finds the notes that can be in view, including a long one that started before it", () => {
    expect(visibleRange(notes, 300, 500)).toEqual([0, 4]);
    expect(visibleRange(notes, 700, 900)).toEqual([2, 5]);
    expect(visibleRange([], 0, 100)).toEqual([0, 0]);
  });

  it("finds the note under the pointer, and whether it's on its edge", () => {
    const flat: PianoView = { scrollTick: 0, pxPerTick: 1, topPitch: 72, rowHeight: 10 };
    const y = (pitch: number) => pitchToY(flat, pitch) + 5;
    expect(hitNote(notes, flat, 300, y(60))).toMatchObject({ note: { id: 1 }, edge: false });
    expect(hitNote(notes, flat, 597, y(60))).toMatchObject({ note: { id: 1 }, edge: true });
    expect(hitNote(notes, flat, 300, y(61))).toBeNull();
    expect(hitNote(notes, flat, 700, y(60))).toBeNull();
    // Two overlap at 150: the one on top (later in the list), unless the other is selected.
    expect(hitNote(notes, flat, 150, y(64))?.note.id).toBe(3);
    expect(hitNote(notes, flat, 150, y(64), new Set([2]))?.note.id).toBe(2);
    // A short note's edge is never more than half of it.
    expect(hitNote(notes, flat, 805, y(60))).toMatchObject({ note: { id: 5 }, edge: false });
    expect(hitNote(notes, flat, 820, y(60))).toMatchObject({ note: { id: 5 }, edge: true });
  });

  it("lays a paint stroke's notes end to end", () => {
    expect(paintStarts(0, 100, 24, 24)).toEqual([0, 24, 48, 72, 96]);
    expect(paintStarts(0, 100, 48, 24)).toEqual([0, 48, 96]);
    // Leftwards, the first note stays where the stroke began.
    expect(paintStarts(96, 10, 48, 24)).toEqual([0, 48, 96]);
    expect(paintStarts(50, 50, 96, 24)).toEqual([48]);
    // Notes shorter than a cell: one per cell.
    expect(paintStarts(0, 50, 6, 24)).toEqual([0, 24, 48]);
  });
});

describe("zooming", () => {
  it("zooms by the wheel in proportion to how far it turned, a notch at 10%", () => {
    expect(wheelZoomFactor(-120)).toBeCloseTo(1.1);
    expect(wheelZoomFactor(120)).toBeCloseTo(1 / 1.1);
    expect(wheelZoomFactor(-4)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-4)).toBeLessThan(1.01);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(1.1);
    expect(wheelZoomFactor(-5000)).toBeCloseTo(1.21);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("keeps the tick under the pointer where it is", () => {
    const zoomed = zoomAt(view, 200, 1);
    expect(zoomed.pxPerTick).toBe(1);
    expect(xToTick(zoomed, 200)).toBe(xToTick(view, 200));
    expect(zoomAt(view, 0, 1000).pxPerTick).toBe(8);
    expect(zoomAt({ ...view, scrollTick: 0 }, 300, 0.25).scrollTick).toBe(0);
  });

  it("zooms the keys about the pointer, within limits", () => {
    const taller = zoomRowsAt(view, 150, view.rowHeight * 2);
    expect(taller.rowHeight).toBe(view.rowHeight * 2);
    expect(taller.topPitch - 150 / taller.rowHeight).toBeCloseTo(view.topPitch - 150 / view.rowHeight, 9);
    expect(zoomRowsAt(view, 0, 1000).rowHeight).toBe(MAX_ROW_HEIGHT);
    expect(zoomRowsAt(view, 0, 1).rowHeight).toBe(MIN_ROW_HEIGHT);
    // Never scrolled past the top key.
    expect(zoomRowsAt({ ...view, topPitch: 128 }, 400, 6).topPitch).toBeLessThanOrEqual(128);
  });

  it("fits a range of time in the width", () => {
    const fitted = zoomToRange(view, 384, 768, 800);
    expect(tickToX(fitted, 384)).toBeGreaterThan(0);
    expect(tickToX(fitted, 768)).toBeLessThan(800);
    expect(tickToX(fitted, 768) - tickToX(fitted, 384)).toBeCloseTo(800 * 0.92, 5);
  });
});
