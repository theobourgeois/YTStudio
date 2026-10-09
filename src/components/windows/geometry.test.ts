import { describe, expect, it } from "vitest";
import { cascade, edgeSnap, magnetise, resizeRect, snappedRect, unsnapAt, fittedRect } from "./geometry";

const desktop = { width: 1000, height: 700 };

describe("magnetise", () => {
  it("sticks edges to the desktop's when they're near", () => {
    expect(magnetise({ x: 6, y: -3 + 8, width: 200, height: 100 }, desktop, [])).toMatchObject({ x: 0, y: 0 });
    expect(magnetise({ x: 795, y: 595, width: 200, height: 100 }, desktop, [])).toMatchObject({ x: 800, y: 600 });
  });

  it("leaves a window alone away from every edge", () => {
    expect(magnetise({ x: 100, y: 100, width: 200, height: 100 }, desktop, [])).toMatchObject({ x: 100, y: 100 });
  });

  it("sticks to another window beside it, but not to one far above or below", () => {
    const other = { x: 400, y: 100, width: 200, height: 200 };
    // Side by side: its left edge meets the other's right.
    expect(magnetise({ x: 606, y: 150, width: 100, height: 100 }, desktop, [other]).x).toBe(600);
    // Far below the other one: nothing to stick to.
    expect(magnetise({ x: 606, y: 500, width: 100, height: 100 }, desktop, [other]).x).toBe(606);
    // Just under it: its top meets the other's bottom, and its left edge the other's left.
    expect(magnetise({ x: 405, y: 305, width: 100, height: 100 }, desktop, [other])).toMatchObject({ x: 400, y: 300 });
  });

  it("picks the nearest edge", () => {
    const other = { x: 300, y: 0, width: 100, height: 700 };
    expect(magnetise({ x: 95, y: 200, width: 198, height: 50 }, desktop, [other]).x).toBe(102);
  });
});

describe("edgeSnap", () => {
  it("fills the desktop at the top and halves it at the sides", () => {
    expect(edgeSnap({ x: 500, y: 0 }, desktop)).toBe("full");
    expect(edgeSnap({ x: 0, y: 300 }, desktop)).toBe("left");
    expect(edgeSnap({ x: 999, y: 300 }, desktop)).toBe("right");
    expect(edgeSnap({ x: 500, y: 300 }, desktop)).toBeNull();
  });

  it("gives the rectangles the snaps fill", () => {
    expect(snappedRect("full", desktop)).toEqual({ x: 0, y: 0, width: 1000, height: 700 });
    expect(snappedRect("left", desktop)).toEqual({ x: 0, y: 0, width: 500, height: 700 });
    expect(snappedRect("right", desktop)).toEqual({ x: 500, y: 0, width: 500, height: 700 });
  });
});

describe("resizeRect", () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };
  const min = { width: 200, height: 150 };

  it("moves only the edges dragged", () => {
    expect(resizeRect(start, "e", 50, 99, min, desktop)).toEqual({ x: 100, y: 100, width: 450, height: 300 });
    expect(resizeRect(start, "sw", -50, 20, min, desktop)).toEqual({ x: 50, y: 100, width: 450, height: 320 });
    expect(resizeRect(start, "n", 0, -40, min, desktop)).toEqual({ x: 100, y: 60, width: 400, height: 340 });
  });

  it("never goes under the smallest size, keeping the opposite edge still", () => {
    expect(resizeRect(start, "w", 350, 0, min, desktop)).toEqual({ x: 300, y: 100, width: 200, height: 300 });
    expect(resizeRect(start, "se", -999, -999, min, desktop)).toEqual({ x: 100, y: 100, width: 200, height: 150 });
  });

  it("stops at the desktop's edges", () => {
    expect(resizeRect(start, "nw", -500, -500, min, desktop)).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(resizeRect(start, "se", 5000, 5000, min, desktop)).toEqual({ x: 100, y: 100, width: 900, height: 600 });
  });
});

describe("unsnapAt", () => {
  it("keeps the pointer at the same fraction across the window", () => {
    expect(unsnapAt({ x: 500, y: 40 }, { fraction: 0.5, dy: 12 }, { width: 400, height: 300 })).toEqual({ x: 300, y: 28, width: 400, height: 300 });
  });
});

describe("cascade", () => {
  const size = { width: 400, height: 300 };

  it("steps down and right from its origin", () => {
    expect(cascade(0, { x: 120, y: 190 }, 28, size, desktop)).toEqual({ x: 120, y: 190 });
    expect(cascade(2, { x: 120, y: 190 }, 28, size, desktop)).toEqual({ x: 176, y: 246 });
  });

  it("starts again from the top rather than open past the desktop's bottom", () => {
    // Room for 210 / 28 = 7 steps below the first: the 9th window is the cascade's second.
    expect(cascade(7, { x: 120, y: 190 }, 28, size, desktop)).toEqual({ x: 316, y: 386 });
    expect(cascade(8, { x: 120, y: 190 }, 28, size, desktop)).toEqual({ x: 120, y: 190 });
    expect(cascade(9, { x: 120, y: 190 }, 28, size, desktop)).toEqual({ x: 148, y: 218 });
    for (let i = 0; i < 50; i++) expect(cascade(i, { x: 120, y: 190 }, 28, size, desktop).y + size.height).toBeLessThanOrEqual(desktop.height);
  });

  it("moves its origin up on a desktop too small for it", () => {
    expect(cascade(3, { x: 120, y: 190 }, 28, size, { width: 1000, height: 350 })).toEqual({ x: 120, y: 50 });
    expect(cascade(3, { x: 120, y: 190 }, 28, size, { width: 300, height: 200 })).toEqual({ x: 0, y: 0 });
  });
});

describe("fittedRect", () => {
  it("opens at the size it likes when there's room, centred a little above the middle", () => {
    expect(fittedRect({ width: 900, height: 700 }, { width: 640, height: 460 }, { width: 1600, height: 1000 })).toEqual({ x: 350, y: 100, width: 900, height: 700 });
  });

  it("fits a smaller desktop, a margin all round, never below its minimum", () => {
    expect(fittedRect({ width: 900, height: 700 }, { width: 640, height: 460 }, { width: 1000, height: 600 })).toEqual({ x: 50, y: 11, width: 900, height: 568 });
    expect(fittedRect({ width: 900, height: 700 }, { width: 640, height: 460 }, { width: 500, height: 300 })).toEqual({ x: 0, y: 0, width: 640, height: 460 });
  });
});
