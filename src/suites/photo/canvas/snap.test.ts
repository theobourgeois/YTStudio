import { describe, expect, it } from "vitest";
import { bounds } from "@shared/photo/layers";
import { isDefaultName, projectNameOf } from "../media";
import { resizeCursor } from "./cursors";
import { movedWithSnap, scaledWithSnap } from "./handles";
import { guidesOf, snapMove, snapResize, snapPoint, snapTargets } from "./snap";

const canvas = { width: 1000, height: 800 };
// Another layer at x 600..800, y 100..300.
const targets = snapTargets(canvas, [{ x0: 600, y0: 100, x1: 800, y1: 300 }]);
const size = { width: 200, height: 100 };
const at = (x: number, y: number) => ({ x, y, scaleX: 1, scaleY: 1, rotation: 0 });

describe("smart guides", () => {
  it("snap a moved box's nearest edge or centre to the canvas and other layers, within the threshold", () => {
    // Left edge 3 px from the canvas's: snaps to it; a vertical guide along the canvas's edge.
    const s = snapMove({ x0: 3, y0: 400, x1: 203, y1: 500 }, targets, 6);
    expect(s.dx).toBe(-3);
    expect(s.guides).toContainEqual({ axis: "x", at: 0, from: 0, to: 800 });
    // Centre near the canvas's centre (500, 400): both axes.
    const c = snapMove({ x0: 402, y0: 348, x1: 602, y1: 448 }, targets, 6);
    expect([c.dx, c.dy]).toEqual([-2, 2]);
    // Too far: nothing.
    expect(snapMove({ x0: 30, y0: 30, x1: 60, y1: 60 }, targets, 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    // To another layer: its top edge, the guide joining the two.
    const l = snapMove({ x0: 100, y0: 104, x1: 300, y1: 204 }, targets, 6);
    expect(l.dy).toBe(-4);
    expect(l.guides).toContainEqual({ axis: "y", at: 100, from: 100, to: 800 });
    // Constrained to x: y never snaps.
    expect(snapMove({ x0: 100, y0: 104, x1: 300, y1: 204 }, targets, 6, { x: true, y: false }).dy).toBe(0);
  });

  it("snap only a resized box's moving edges, the nearer one when a corner keeps its proportions", () => {
    const box = { x0: 100, y0: 100, x1: 597, y1: 296 };
    expect(snapResize(box, { x: "x1", y: null }, targets, 6)).toMatchObject({ dx: 3, dy: 0 });
    expect(snapResize(box, { x: "x1", y: "y1" }, targets, 6)).toMatchObject({ dx: 3, dy: 4 });
    expect(snapResize(box, { x: "x1", y: "y1" }, targets, 6, true)).toMatchObject({ dx: 3, dy: 0 });
    expect(guidesOf({ x0: 0, y0: 0, x1: 600, y1: 50 }, targets, { x: [600], y: [] })).toEqual([{ axis: "x", at: 600, from: 0, to: 300 }]);
  });

  it("move a layer onto a target, along one axis when Shift constrains it", () => {
    // A 200 × 100 layer centred at (102, 300): its left edge 2 px from the canvas's.
    const r = movedWithSnap(at(102, 300), size, 0, 0, false, { targets, threshold: 6 });
    expect(r.t.x).toBe(100);
    expect(bounds(r.t, size).x0).toBe(0);
    expect(movedWithSnap(at(102, 300), size, 0, 0, false, null).t.x).toBe(102);
  });

  it("resize onto a target exactly: an edge handle, and a corner keeping its proportions", () => {
    const snap = { targets, threshold: 6 };
    // The right edge dragged to x 597: snaps to the other layer's left edge, 600.
    const edge = scaledWithSnap(at(300, 500), size, { u: 1, v: 0.5 }, { x: 597, y: 500 }, {}, snap);
    expect(bounds(edge.t, size).x1).toBeCloseTo(600, 9);
    expect(bounds(edge.t, size).x0).toBeCloseTo(200, 9);
    expect(edge.guides.some((g) => g.axis === "x" && g.at === 600)).toBe(true);
    // The bottom-right corner, proportions kept: the right edge lands on 600, the height follows.
    const corner = scaledWithSnap(at(300, 500), size, { u: 1, v: 1 }, { x: 597, y: 560 }, {}, snap);
    const b = bounds(corner.t, size);
    expect(b.x1).toBeCloseTo(600, 9);
    expect((b.x1 - b.x0) / (b.y1 - b.y0)).toBeCloseTo(2, 9);
    expect([b.x0, b.y0]).toEqual([200, 450]);
    // From the centre: the centre stays.
    const centred = scaledWithSnap(at(300, 500), size, { u: 1, v: 0.5 }, { x: 597, y: 500 }, { fromCentre: true }, snap);
    expect(centred.t.x).toBeCloseTo(300, 9);
    expect(bounds(centred.t, size).x1).toBeCloseTo(600, 9);
    // A layer turned 30° doesn't snap its edges (its box isn't its outline).
    const turned = scaledWithSnap({ ...at(300, 500), rotation: 30 }, size, { u: 1, v: 0.5 }, { x: 597, y: 500 }, {}, snap);
    expect(turned.guides).toEqual([]);
  });
});

describe("the Move tool's cursors", () => {
  it("point along each handle's pull, turned with the layer", () => {
    expect(resizeCursor(0)).toBe("ew-resize");
    expect(resizeCursor(180)).toBe("ew-resize");
    expect(resizeCursor(45)).toBe("nwse-resize");
    expect(resizeCursor(-135)).toBe("nwse-resize");
    expect(resizeCursor(90)).toBe("ns-resize");
    expect(resizeCursor(135)).toBe("nesw-resize");
    expect(resizeCursor(-45)).toBe("nesw-resize");
    // A corner of a layer turned 45°: its pull is straight down, so the cursor is the vertical one.
    expect(resizeCursor(45 + 45)).toBe("ns-resize");
  });
});

describe("a photo's name", () => {
  it("is the image's when it hasn't been named", () => {
    expect(isDefaultName("Untitled")).toBe(true);
    expect(isDefaultName("Untitled 3")).toBe(true);
    expect(isDefaultName("Cover")).toBe(false);
    expect(projectNameOf("Screenshot 2026-10-05 at 8.57.28 PM.png")).toBe("Screenshot 2026-10-05 at 8.57.28 PM");
    expect(projectNameOf("holiday.final.JPG")).toBe("holiday.final");
  });
});

describe("snapPoint", () => {
  it("snaps a handle to the canvas's centre and edges within the threshold, on each axis alone", () => {
    const targets = snapTargets({ width: 1000, height: 800 }, []);
    expect(snapPoint({ x: 503, y: 300 }, targets, 5)).toEqual({ x: 500, y: 300, guides: [{ axis: "x", at: 500, from: 0, to: 800 }] });
    expect(snapPoint({ x: 2, y: 797 }, targets, 5)).toMatchObject({ x: 0, y: 800 });
    expect(snapPoint({ x: 300, y: 300 }, targets, 5)).toEqual({ x: 300, y: 300, guides: [] });
  });
});
