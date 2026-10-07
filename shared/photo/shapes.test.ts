import { describe, expect, it } from "vitest";
import { createPhotoProject, normalizePhotoProject } from "./project.ts";
import { compileRender } from "./render-plan.ts";
import { describeGeometry, describePaint } from "./shape-describe.ts";
import { MAX_RASTER_SIDE, flatten, hitShape, pathData, shapeBounds, shapeDrawing, shapeRaster } from "./shape-drawing.ts";
import {
  DEFAULT_PAINT,
  addShapeLayer,
  clickedShape,
  dragBox,
  dragLineEnd,
  makeShapeLayer,
  nextShapeName,
  normalizePaint,
  placedShape,
  restyleShapes,
  setShapeLayer,
  shapeKind,
  shapeSeed,
  withPlacedBox,
  withPlacedLine,
} from "./shapes.ts";
import { PHOTO_VERSION, type ShapeLayer } from "./types.ts";

const doc = createPhotoProject("Shapes", { width: 1000, height: 800 });
const rect = (paint = {}, box = { x0: 100, y0: 100, x1: 300, y1: 200 }) => makeShapeLayer(doc, { id: "r1", kind: "rectangle", box, paint });
const arrow = (from = { x: 100, y: 400 }, to = { x: 600, y: 400 }, extra = {}) => makeShapeLayer(doc, { id: "a1", kind: "arrow", from, to, ...extra });
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("shape layers in the document", () => {
  it("is version 7, and survives a save and a load as it was", () => {
    expect(PHOTO_VERSION).toBe(7);
    const withShapes = addShapeLayer(addShapeLayer(doc, rect({ fill: "#ff0000", sloppiness: 1 })), arrow());
    const again = normalizePhotoProject(JSON.parse(JSON.stringify(withShapes)));
    expect(again.layers).toEqual(withShapes.layers);
    expect(again.version).toBe(7);
  });

  it("repairs a shape's paint and box, and leaves out one with a shape it doesn't know", () => {
    const problems: string[] = [];
    const repaired = normalizePhotoProject(
      {
        version: 7,
        canvas: { width: 100, height: 100 },
        layers: [
          { kind: "shape", id: "s", shape: { type: "rect", radius: -5 }, size: { width: 0, height: "x" }, paint: { fill: "red", stroke: "#ABCDEF", strokeWidth: 5000, dash: "wavy", sloppiness: 7 }, style: { enabled: true, effects: [{ id: "fx1", type: "drop-shadow", version: 1, enabled: true, params: {} }] } },
          { kind: "shape", id: "t", shape: { type: "star" } },
          { kind: "shape", id: "u", shape: { type: "line", from: [0, "a"], startHead: "spear", endHead: "arrow" } },
        ],
      },
      (p) => problems.push(p),
    );
    expect(repaired.layers.map((l) => l.id)).toEqual(["s", "u"]);
    const s = repaired.layers[0] as ShapeLayer;
    expect(s.shape).toEqual({ type: "rect", radius: 0 });
    expect(s.size).toEqual({ width: 1, height: 100 });
    expect(s.paint).toMatchObject({ fill: null, stroke: "#abcdef", strokeWidth: 1000, dash: "solid", sloppiness: 0 });
    expect(s.style?.effects.map((e) => e.type)).toEqual(["drop-shadow"]);
    const u = repaired.layers[1] as ShapeLayer;
    expect(u.shape).toMatchObject({ type: "line", from: [0, 50], startHead: "none", endHead: "arrow" });
    expect(shapeKind(u)).toBe("arrow");
    expect(problems.join(" ")).toMatch(/shape this app knows/);
    // A newer document is refused, as ever.
    expect(() => normalizePhotoProject({ version: 8 })).toThrow(/newer/);
  });

  it("names shapes after their kind, and adds them above the active layer", () => {
    const one = addShapeLayer(doc, rect());
    expect(one.layers[0].name).toBe("Rectangle");
    expect(nextShapeName(one, "rectangle")).toBe("Rectangle 2");
    expect(nextShapeName(one, "arrow")).toBe("Arrow");
    const two = addShapeLayer(one, arrow(), "r1");
    expect(two.layers.map((l) => l.id)).toEqual(["r1", "a1"]);
    expect(addShapeLayer(two, arrow())).toBe(two);
  });
});

describe("where a shape is", () => {
  it("places a box by its transform: the scale grows the box, never the radius", () => {
    const r = { ...rect({}, { x0: 0, y0: 0, x1: 200, y1: 100 }), shape: { type: "rect" as const, radius: 12 } };
    const turned: ShapeLayer = { ...r, transform: { x: 500, y: 300, scaleX: 2, scaleY: -1.5, rotation: 30 } };
    expect(placedShape(turned)).toEqual({ type: "rect", cx: 500, cy: 300, width: 400, height: 150, rotation: 30, radius: 12 });
    // Baked back: the same place, at 100% (mirroring kept).
    const baked = withPlacedBox(turned, { cx: 500, cy: 300, width: 400, height: 150 });
    expect(baked.size).toEqual({ width: 400, height: 150 });
    expect(baked.transform).toEqual({ x: 500, y: 300, scaleX: 1, scaleY: -1, rotation: 30 });
  });

  it("keeps a line's ends and bend through its transform, and makes them again from the canvas", () => {
    const line = arrow({ x: 100, y: 400 }, { x: 500, y: 100 }, { bend: 40 });
    const p = placedShape(line);
    if (p.type !== "line") throw new Error("a line");
    close(p.from, { x: 100, y: 400 });
    close(p.to, { x: 500, y: 100 });
    expect(p.bend).toBeCloseTo(40, 6);
    // A level line still has a box.
    const level = arrow({ x: 10, y: 50 }, { x: 90, y: 50 });
    expect(level.size).toEqual({ width: 80, height: 1 });
    // Turned and scaled by the Move tool: the ends follow, the bend scales with it.
    const moved: ShapeLayer = { ...line, transform: { ...line.transform, rotation: 90, scaleX: 2, scaleY: 2 } };
    const q = placedShape(moved);
    if (q.type !== "line") throw new Error("a line");
    expect(Math.hypot(q.to.x - q.from.x, q.to.y - q.from.y)).toBeCloseTo(1000, 6);
    expect(q.bend).toBeCloseTo(80, 6);
    // Edited by its handles: the new ends on the canvas, at 100% again.
    const edited = withPlacedLine(moved, { x: 0, y: 0 }, { x: 300, y: 400 });
    const e = placedShape(edited);
    if (e.type !== "line") throw new Error("a line");
    close(e.from, { x: 0, y: 0 });
    close(e.to, { x: 300, y: 400 });
    expect(e.bend).toBeCloseTo(80, 6);
    expect(edited.transform).toMatchObject({ scaleX: 1, scaleY: 1, rotation: 0 });
  });

  it("draws as Photoshop's tools do: Shift squares and snaps to 45°, Alt from the centre", () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 50, y: 30 })).toEqual({ x0: 10, y0: 10, x1: 50, y1: 30 });
    expect(dragBox({ x: 10, y: 10 }, { x: 50, y: -20 }, { square: true })).toEqual({ x0: 10, y0: -30, x1: 50, y1: 10 });
    expect(dragBox({ x: 100, y: 100 }, { x: 130, y: 120 }, { fromCentre: true })).toEqual({ x0: 70, y0: 80, x1: 130, y1: 120 });
    close(dragLineEnd({ x: 0, y: 0 }, { x: 100, y: 10 }, true), { x: 100, y: 0 });
    const diagonal = dragLineEnd({ x: 0, y: 0 }, { x: 100, y: 90 }, true);
    expect(diagonal.x).toBeCloseTo(diagonal.y, 9);
    expect(dragLineEnd({ x: 0, y: 0 }, { x: 100, y: 10 }, false)).toEqual({ x: 100, y: 10 });
    expect(clickedShape("rectangle", { x: 500, y: 400 }, { width: 1000, height: 800 }).box).toEqual({ x0: 420, y0: 320, x1: 580, y1: 480 });
    expect(clickedShape("arrow", { x: 500, y: 400 }, { width: 1000, height: 800 })).toEqual({ from: { x: 500, y: 400 }, to: { x: 700, y: 400 } });
  });
});

describe("restyling", () => {
  it("patches the shapes selected and nothing else, the same document when nothing changes", () => {
    const d = addShapeLayer(addShapeLayer(doc, rect()), arrow());
    const red = restyleShapes(d, ["r1", "a1"], { stroke: "#ff0000", strokeWidth: 3 }, { radius: 20, endHead: "triangle" });
    const [r, a] = red.layers as ShapeLayer[];
    expect(r.paint.stroke).toBe("#ff0000");
    expect(r.shape).toEqual({ type: "rect", radius: 20 });
    expect(a.paint.strokeWidth).toBe(3);
    expect(a.shape).toMatchObject({ endHead: "triangle", startHead: "none" });
    expect(restyleShapes(red, ["r1", "a1"], { stroke: "#ff0000" }, { radius: 20 })).toBe(red);
    expect(restyleShapes(red, ["nothing"], { stroke: "#00ff00" })).toBe(red);
    expect(normalizePaint({ ...DEFAULT_PAINT, strokeWidth: -2 }).strokeWidth).toBe(0);
    expect(setShapeLayer(red, red.layers[0] as ShapeLayer)).toBe(red);
  });
});

describe("what a shape draws", () => {
  it("strokes centred, inside (clipped) or outside (under its fill)", () => {
    const centre = shapeDrawing(rect());
    expect(centre.items.map((i) => i.kind)).toEqual(["stroke"]);
    expect(centre.bounds).toMatchObject({ x0: expect.closeTo(100 - 4 * 2.6 - 2, 6) });
    const inside = shapeDrawing(rect({ align: "inside", fill: "#00ff00" }));
    expect(inside.items.map((i) => i.kind)).toEqual(["fill", "stroke"]);
    expect(inside.items[1]).toMatchObject({ width: 16, clip: { outside: false } });
    const outside = shapeDrawing(rect({ align: "outside", fill: "#00ff00" }));
    expect(outside.items.map((i) => i.kind)).toEqual(["stroke", "fill"]);
    expect(shapeDrawing(rect({ align: "outside" })).items[0]).toMatchObject({ clip: { outside: true } });
    expect(shapeDrawing(rect({ stroke: null })).bounds).toBeNull();
  });

  it("rounds a rectangle's corners, at most to half its shorter side", () => {
    const round = { ...rect(), shape: { type: "rect" as const, radius: 500 } };
    const path = shapeDrawing(round).items[0].path;
    expect(path.filter((c) => c[0] === "C")).toHaveLength(4);
    // Radius 50 (half of 100): the top edge's straight part is 200 − 2·50 long.
    expect(path[0]).toEqual(["M", 150, 100]);
    expect(path[1]).toEqual(["L", 250, 100]);
  });

  it("dashes and dots by the stroke's width, whatever the cap adds", () => {
    expect(shapeDrawing(rect({ dash: "dashed", cap: "butt" })).items[0]).toMatchObject({ dash: [30, 22], cap: "butt" });
    expect(shapeDrawing(rect({ dash: "dashed", cap: "round" })).items[0]).toMatchObject({ dash: [22, 30] });
    expect(shapeDrawing(rect({ dash: "dotted", cap: "butt" })).items[0]).toMatchObject({ dash: [0, 20], cap: "round" });
  });

  it("ends an arrow at its tip, a filled head's line stopping inside it", () => {
    const open = shapeDrawing(arrow());
    expect(open.items.map((i) => i.kind)).toEqual(["stroke", "stroke"]);
    const [body, head] = open.items;
    expect(body.path.at(-1)).toEqual(["L", 600, 400]);
    // The head's wings meet at the tip, 25° either side, 38 px long (3 × 8 + 14).
    expect(head.path[1]).toEqual(["L", 600, 400]);
    expect(head.path[0][1]).toBeCloseTo(600 - 38 * Math.cos((25 * Math.PI) / 180), 6);
    const filled = shapeDrawing(arrow(undefined, undefined, { startHead: "circle", endHead: "triangle" }));
    expect(filled.items.map((i) => i.kind)).toEqual(["stroke", "fill", "stroke", "fill"]);
    const end = filled.items[0].path.at(-1)!;
    expect(end[1]).toBeCloseTo(600 - 38 * 0.8, 6);
    // Heads shrink on short lines.
    const short = shapeDrawing(arrow({ x: 0, y: 0 }, { x: 20, y: 0 }));
    expect(short.items[1].path[0][1]).toBeGreaterThan(20 - 13);
  });

  it("points a bent arrow's head along the curve as it arrives", () => {
    const bent = shapeDrawing(arrow({ x: 0, y: 0 }, { x: 400, y: 0 }, { bend: 100 }));
    expect(bent.items[0].path[1][0]).toBe("C");
    const [l, tip, r] = bent.items[1].path.map((c) => [c[1], c[2]] as [number, number]);
    expect(tip).toEqual([400, 0]);
    // Bent to the left (up, y down): it arrives going down and right, so its wings sit up and to the left of it.
    expect((l[1] + r[1]) / 2).toBeLessThan(0);
  });

  it("is drawn by hand the same every time, and differently for another layer", () => {
    const sloppy = rect({ sloppiness: 2, fill: "#ffcc00", fillStyle: "hachure" });
    const a = shapeDrawing(sloppy);
    const b = shapeDrawing(JSON.parse(JSON.stringify(sloppy)));
    expect(b).toEqual(a);
    expect(shapeDrawing({ ...sloppy, id: "r2" })).not.toEqual(a);
    // Hachure under a rough outline: many lines, then the stroke's two passes.
    expect(a.items.map((i) => i.kind)).toEqual(["stroke", "stroke"]);
    expect(a.items[0].path.filter((c) => c[0] === "M").length).toBeGreaterThan(10);
    expect(shapeSeed("r1")).toBe(shapeSeed("r1"));
    expect(shapeSeed("")).toBeGreaterThan(0);
  });

  it("turns paths into polylines and SVG", () => {
    expect(flatten([["M", 0, 0], ["L", 10, 0], ["C", 10, 5, 5, 10, 0, 10], ["Z"]], 2)).toEqual([[[0, 0], [10, 0], [6.875, 6.875], [0, 10], [0, 0]]]);
    expect(pathData([["M", 0, 0.123], ["L", 10, 0], ["Z"]])).toBe("M0 0.12L10 0Z");
  });
});

describe("a shape's pixels", () => {
  it("lists only the tiles it touches, from the document's corner, a power of two of them across", () => {
    const diagonal = shapeRaster(arrow({ x: 10, y: 10 }, { x: 2000, y: 2000 }));
    expect(diagonal.size).toEqual({ width: 2048, height: 2048 });
    // Along the diagonal only (and its neighbours where the stroke crosses a corner), not the 64 of its box.
    expect(diagonal.tiles.length).toBeLessThan(30);
    expect(diagonal.tiles.every((t) => Math.abs(t.tx - t.ty) <= 1)).toBe(true);
    // Sorted by row.
    expect(diagonal.tiles.map((t) => t.ty * 100 + t.tx)).toEqual([...diagonal.tiles.map((t) => t.ty * 100 + t.tx)].sort((a, b) => a - b));
  });

  it("makes tiles wholly inside a fill a constant of its colour", () => {
    const big = shapeRaster(rect({ fill: "#ffffff" }, { x0: 0, y0: 0, x1: 1500, y1: 1500 }));
    const constant = big.tiles.filter((t) => t.constant);
    // Tiles 1 to 4 each way: the stroke touches the outer ring.
    expect(constant.length).toBe(16);
    expect(constant[0].constant).toEqual([1, 1, 1, 1]);
    expect(big.tiles.find((t) => t.tx === 0 && t.ty === 0)?.constant).toBeNull();
    // Off the document's top-left: cut there.
    expect(shapeRaster(rect({}, { x0: -500, y0: -500, x1: -100, y1: -100 })).tiles).toEqual([]);
    expect(shapeRaster(arrow({ x: 0, y: 0 }, { x: 1e6, y: 0 })).size.width).toBe(MAX_RASTER_SIDE);
  });

  it("is a pixel layer's node in the render plan, keyed by what it draws", () => {
    const d = addShapeLayer(doc, rect({ fill: "#ff0000" }));
    const plan = compileRender(d, new Map());
    expect(plan.nodes).toHaveLength(1);
    const node = plan.nodes[0];
    expect(node).toMatchObject({ kind: "pixel", layerId: "r1", size: { width: 512, height: 256 }, transform: { x: 256, y: 128, scaleX: 1, scaleY: 1, rotation: 0 } });
    expect(node.kind === "pixel" && node.surface.startsWith("shape:")).toBe(true);
    const moved = compileRender(setShapeLayer(d, { ...(d.layers[0] as ShapeLayer), transform: { ...d.layers[0].transform!, x: 210 } } as ShapeLayer), new Map());
    expect(moved.key).not.toBe(plan.key);
  });
});

describe("hit testing", () => {
  it("is on a stroke within its width and the tolerance, inside a fill, and nowhere else", () => {
    const outline = rect();
    expect(hitShape(outline, 100, 150)).toBe(true);
    expect(hitShape(outline, 106, 150)).toBe(false);
    expect(hitShape(outline, 106, 150, 4)).toBe(true);
    expect(hitShape(outline, 200, 150, 4)).toBe(false);
    expect(hitShape(rect({ fill: "#000000" }), 200, 150)).toBe(true);
    expect(hitShape(arrow(), 350, 403)).toBe(true);
    expect(hitShape(arrow(), 350, 420)).toBe(false);
    expect(shapeBounds(arrow())).not.toBeNull();
  });
});

describe("for the assistant", () => {
  it("says where a shape is and how it's painted", () => {
    expect(describeGeometry(rect())).toBe("rectangle x 100..300, y 100..200 (200×100)");
    expect(describeGeometry(arrow())).toBe("arrow from (100, 400) to (600, 400), heads: arrow at its end");
    expect(describePaint({ ...DEFAULT_PAINT, dash: "dashed", fill: "#ff0000", sloppiness: 1 }, false)).toBe("stroke #000000 8 px dashed, fill #ff0000, hand-drawn (artist)");
  });
});
