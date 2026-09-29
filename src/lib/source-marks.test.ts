import { describe, expect, it } from "vitest";
import { dragMark, markedRange, parseMarks, setMark } from "./source-marks.ts";

describe("source marks", () => {
  it("selects the part between In and Out, defaulting to the file's edges", () => {
    expect(markedRange(undefined, 10)).toBeNull();
    expect(markedRange({}, 10)).toBeNull();
    expect(markedRange({ in: 2 }, 10)).toEqual({ in: 2, out: 10 });
    expect(markedRange({ out: 4 }, 10)).toEqual({ in: 0, out: 4 });
    expect(markedRange({ in: 2, out: 4 }, 10)).toEqual({ in: 2, out: 4 });
    // Marks past the end of a file (it changed length) are held inside it.
    expect(markedRange({ in: 2, out: 40 }, 10)).toEqual({ in: 2, out: 10 });
    // Too short to be a clip: the whole file.
    expect(markedRange({ in: 5, out: 5.01 }, 10)).toBeNull();
  });

  it("marks In and Out, clearing the other one when it'd be on the wrong side", () => {
    let marks = setMark(undefined, "in", 2, 10);
    expect(marks).toEqual({ in: 2 });
    marks = setMark(marks, "out", 6, 10);
    expect(marks).toEqual({ in: 2, out: 6 });
    // In after Out: Out goes (Premiere).
    expect(setMark(marks, "in", 7, 10)).toEqual({ in: 7 });
    // Out before In: In goes.
    expect(setMark(marks, "out", 1, 10)).toEqual({ out: 1 });
    // At the file's own edges it's no mark.
    expect(setMark({ in: 2 }, "in", 0, 10)).toEqual({});
    expect(setMark({ in: 2 }, "out", 10, 10)).toEqual({ in: 2 });
  });

  it("drags a mark up to the other one, never past it", () => {
    expect(dragMark({ in: 2, out: 6 }, "in", 8, 10)).toEqual({ in: 5.9, out: 6 });
    expect(dragMark({ in: 2, out: 6 }, "out", 0, 10)).toEqual({ in: 2, out: 2.1 });
    expect(dragMark({ in: 2, out: 6 }, "in", -3, 10)).toEqual({ out: 6 });
    expect(dragMark(undefined, "out", 4.5, 10)).toEqual({ out: 4.5 });
  });

  it("reads back only valid marks", () => {
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks({ a: { in: 1, out: 3 }, b: { in: "x" }, c: null, d: { out: 2, junk: 1 }, e: { in: -1 } })).toEqual({
      a: { in: 1, out: 3 },
      d: { out: 2 },
    });
  });
});
