import { describe, expect, it } from "vitest";
import { addEffect, clipKind, normalizeEffects, removeEffect, setParams, shapeEffects, solidEffects } from "./effects.ts";
import { polygonArea, flatten, parseSvgPathData, polygonPath } from "./path.ts";
import { shapeBounds, shapeContains, shapeDrawingAt, shapePath, shapesChange } from "./shapes.ts";
import { MAIN_TRACK_ID, addLayerClip, createDefaultProject, newLayerClip } from "./timeline.ts";
import type { Clip, ParamValues, Project } from "./types.ts";

const FRAME = { width: 1080, height: 1920 };
const make = (params: ParamValues = {}): Project => addLayerClip(createDefaultProject(), { ...newLayerClip("shape", 0, 5, params), id: "s" }).project;
const only = (p: Project) => p.clips[0];
const areaOf = (d: string) => parseSvgPathData(d).reduce((sum, path) => sum + polygonArea(flatten(path, 0.05)), 0);

describe("shape layers", () => {
  it("are clips of their own kind, with one shape to start with", () => {
    const clip = only(make());
    expect(clipKind(clip)).toBe("shape");
    expect(clip.trackId).toBe(MAIN_TRACK_ID);
    expect(clip.effects.map((e) => e.id)).toEqual(["motion", "opacity", "volume", "vector-shape"]);
    // The last shape can't be removed: it's what the clip is.
    expect(removeEffect(make(), "s", "vector-shape")).toEqual(make());
  });

  it("draw each kind of shape where it's put, in px of the frame at 1080p", () => {
    const rect = shapeDrawingAt(only(make({ size: [200, 100] })), 0, FRAME);
    expect(rect).toMatchObject({ width: 1080, height: 1920, ops: [{ fill: "rgba(255, 255, 255, 1)" }] });
    expect(rect.ops[0].stroke).toBeUndefined();
    expect(areaOf(rect.ops[0].d)).toBeCloseTo(20_000, 0);
    expect(shapeBounds(only(make({ size: [200, 100] })), 0, FRAME)).toEqual({ x: 440, y: 910, width: 200, height: 100 });

    const ellipse = shapeDrawingAt(only(make({ kind: "ellipse", size: [200, 100], position: [0.25, 0.25] })), 0, FRAME);
    expect(areaOf(ellipse.ops[0].d)).toBeCloseTo(Math.PI * 100 * 50, -2);
    expect(shapeBounds(only(make({ kind: "ellipse", size: [200, 100], position: [0.25, 0.25] })), 0, FRAME)!.x).toBeCloseTo(170);

    expect(shapePath({ ...only(make({ kind: "star", points: 5 })).effects[3].params }, FRAME).vertices).toHaveLength(10);
    expect(shapePath({ ...only(make({ kind: "polygon", points: 6 })).effects[3].params }, FRAME).vertices).toHaveLength(6);
    // A drawn path's points are fractions of the frame.
    const path = shapeDrawingAt(only(make({ kind: "path", path: polygonPath([[0, 0], [1, 0], [1, 1]], true) })), 0, FRAME);
    expect(path.ops[0].d).toBe("M0 0 L1080 0 L1080 1920 Z");
  });

  it("paint fills, gradients and strokes", () => {
    const clip = only(
      make({ size: [200, 200], fillColor: "#ff0000", fillOpacity: 0.5, gradient: "linear", gradientColor: "#0000ff", gradientAngle: 0, strokeWidth: 8, strokeColor: "#00ff00", dash: 10, lineJoin: "round" }),
    );
    const [op] = shapeDrawingAt(clip, 0, FRAME).ops;
    expect(op.fill).toEqual({ type: "linear", from: [440, 960], to: [640, 960], stops: [[0, "rgba(255, 0, 0, 0.5)"], [1, "rgba(0, 0, 255, 0.5)"]] });
    expect(op).toMatchObject({ stroke: "rgba(0, 255, 0, 1)", strokeWidth: 8, join: "round", dash: [10, 10] });
    // The handles go around the stroke too.
    expect(shapeBounds(clip, 0, FRAME)).toEqual({ x: 436, y: 856, width: 208, height: 208 });
    expect(shapeDrawingAt(only(make({ fill: false })), 0, FRAME).ops).toEqual([]);
  });

  it("run the operators over every shape before them, in order", () => {
    let p = make({ size: [200, 200], position: [0.5, 0.5] });
    p = addEffect(p, ["s"], "vector-shape", { kind: "ellipse", size: [200, 200], position: [0.5 + 100 / 1080, 0.5] }).project;
    expect(shapeDrawingAt(only(p), 0, FRAME).ops).toHaveLength(2);
    // Merged into one shape, painted like the first.
    p = addEffect(p, ["s"], "merge-paths", { mode: "intersect" }).project;
    const merged = shapeDrawingAt(only(p), 0, FRAME).ops;
    expect(merged).toHaveLength(1);
    // The half of the circle inside the square.
    expect(areaOf(merged[0].d)).toBeCloseTo((Math.PI * 100 * 100) / 2, -2);

    // Three copies, each 300 px further right and fainter (the last one gone); "below" draws the later ones first.
    p = addEffect(p, ["s"], "repeater", { copies: 3, position: [300, 0], endOpacity: 0 }).project;
    const copies = shapeDrawingAt(only(p), 0, FRAME).ops;
    expect(copies.map((op) => op.transform?.[4] ?? 0)).toEqual([300, 0]);
    expect(copies.map((op) => op.opacity ?? 1)).toEqual([0.5, 1]);
    // A shape added after the repeater isn't repeated.
    p = addEffect(p, ["s"], "vector-shape").project;
    expect(shapeDrawingAt(only(p), 0, FRAME).ops).toHaveLength(3);
  });

  it("trim, offset and round paths", () => {
    const base = make({ size: [200, 200], fill: false, strokeWidth: 4 });
    const trimmed = shapeDrawingAt(only(addEffect(base, ["s"], "trim-paths", { end: 0.5 }).project), 0, FRAME).ops[0];
    // Two of the square's four sides, left open.
    expect(trimmed.d).not.toMatch(/Z$/);
    expect(parseSvgPathData(trimmed.d)[0].vertices).toHaveLength(3);
    const grown = shapeDrawingAt(only(addEffect(make({ size: [200, 200] }), ["s"], "offset-paths", { amount: 10 }).project), 0, FRAME).ops[0];
    expect(areaOf(grown.d)).toBeCloseTo(220 * 220, -1);
    const round = shapeDrawingAt(only(addEffect(make({ size: [200, 200] }), ["s"], "round-corners", { radius: 50 }).project), 0, FRAME).ops[0];
    expect(areaOf(round.d)).toBeLessThan(200 * 200 - 1000);
    expect(shapeDrawingAt(only(addEffect(base, ["s"], "trim-paths", { end: 0 }).project), 0, FRAME).ops).toEqual([]);
  });

  it("know when they move (keyframes, or a wiggle)", () => {
    const still = make();
    expect(shapesChange(only(still), 0, 1)).toBe(false);
    const wiggly = addEffect(still, ["s"], "wiggle-paths").project;
    expect(shapesChange(only(wiggly), 0, 1)).toBe(true);
    expect(shapeDrawingAt(only(wiggly), 0, FRAME).ops[0].d).not.toBe(shapeDrawingAt(only(wiggly), 0.5, FRAME).ops[0].d);
    // The same moment draws the same thing.
    expect(shapeDrawingAt(only(wiggly), 0.5, FRAME)).toBe(shapeDrawingAt(only(wiggly), 0.5, FRAME));
    expect(shapeDrawingAt({ ...only(wiggly), effects: [...only(wiggly).effects] }, 0.5, FRAME)).toEqual(shapeDrawingAt(only(wiggly), 0.5, FRAME));
  });

  it("are hit by what they draw, not by their frame", () => {
    const clip = only(make({ size: [200, 200] }));
    expect(shapeContains(clip, 0, FRAME, [540, 960])).toBe(true);
    expect(shapeContains(clip, 0, FRAME, [100, 100])).toBe(false);
    const outline = only(setParams(make({ size: [200, 200] }), "s", "vector-shape", { fill: false, strokeWidth: 10 }));
    expect(shapeContains(outline, 0, FRAME, [540, 960])).toBe(false);
    expect(shapeContains(outline, 0, FRAME, [443, 960])).toBe(true);
    expect(shapeContains(outline, 0, FRAME, [452, 960], 8)).toBe(true);
  });

  it("only keep a shape layer's contents on shape layers", () => {
    const stray = normalizeEffects([...solidEffects(), { id: "trim-paths", type: "trim-paths", enabled: true, params: {} }]);
    expect(stray.map((e) => e.type)).toEqual(["motion", "opacity", "volume", "solid"]);
    const mixed = normalizeEffects([...shapeEffects(), { id: "solid", type: "solid", enabled: true, params: {} }, { id: "zig-zag", type: "zig-zag", enabled: true, params: {} }]);
    expect(mixed.map((e) => e.type)).toEqual(["motion", "opacity", "volume", "vector-shape", "zig-zag"]);
    const clip: Clip = { ...only(make()), effects: mixed };
    expect(clipKind(clip)).toBe("shape");
    // Operators don't go on anything else.
    const video = { ...createDefaultProject(), clips: [{ id: "v", assetId: "a", trackId: MAIN_TRACK_ID, start: 0, in: 0, out: 5, effects: normalizeEffects([]) }] };
    expect(addEffect(video, ["v"], "repeater").added.size).toBe(0);
  });
});
