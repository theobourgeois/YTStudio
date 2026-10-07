import { describe, expect, it } from "vitest";
import { createPhotoProject } from "@shared/photo/project";
import { placedShape } from "@shared/photo/shapes";
import type { PhotoProject, ShapeLayer } from "@shared/photo/types";
import { addShapeTool, defaultStrokeWidth, setShapeTool } from "./shape-tool-edits";
import { describePhoto } from "./tool-edits";

const env = { assets: [], foreground: "#123456" };
const doc = createPhotoProject("Annotate", { width: 1200, height: 900 });
const shapeOf = (d: PhotoProject, id: string) => d.layers.find((l) => l.id === id) as ShapeLayer;

describe("add_shape", () => {
  it("boxes something: a rectangle by its box, in the foreground colour, a stroke that reads on this canvas", () => {
    const r = addShapeTool(doc, { kind: "rectangle", x: 100, y: 50, width: 300, height: 200, radius: 12 }, env);
    const layer = shapeOf(r.doc, r.layerId);
    expect(placedShape(layer)).toMatchObject({ type: "rect", cx: 250, cy: 150, width: 300, height: 200, radius: 12 });
    expect(layer.paint).toMatchObject({ stroke: "#123456", strokeWidth: defaultStrokeWidth(doc.canvas), fill: null });
    expect(defaultStrokeWidth(doc.canvas)).toBe(6);
    expect(r.text).toMatch(/Added rectangle layer .* "Rectangle" on top\.\n {3}rectangle x 100..400, y 50..250 \(300×200\), corner radius 12/);
  });

  it("points at something: an arrow from A to B, its head at B; a line with heads of its own", () => {
    const a = addShapeTool(doc, { kind: "arrow", from: [100, 800], to: [500, 400], stroke: "#FF0000", stroke_width: 10, sloppiness: "artist", name: "Look" }, env);
    const arrow = shapeOf(a.doc, a.layerId);
    const p = placedShape(arrow);
    expect(p).toMatchObject({ type: "line", from: { x: 100, y: 800 }, to: { x: 500, y: 400 }, startHead: "none", endHead: "arrow" });
    expect(arrow).toMatchObject({ name: "Look", paint: { stroke: "#ff0000", strokeWidth: 10, sloppiness: 1 } });
    const l = addShapeTool(a.doc, { kind: "line", from: { x: 0, y: 0 }, to: [10, 10], start_head: "circle", bend: 5, above: a.layerId }, env);
    expect(shapeOf(l.doc, l.layerId).shape).toMatchObject({ startHead: "circle", endHead: "none", bend: 5 });
  });

  it("says what's missing or wrong", () => {
    expect(() => addShapeTool(doc, {}, env)).toThrow(/kind is required: rectangle, ellipse, line, arrow/);
    expect(() => addShapeTool(doc, { kind: "rectangle", x: 1 }, env)).toThrow(/x, y \(its top-left corner\), width and height/);
    expect(() => addShapeTool(doc, { kind: "arrow", from: [1, 2] }, env)).toThrow(/from and to/);
    expect(() => addShapeTool(doc, { kind: "arrow", from: [1, 2], to: "there" }, env)).toThrow(/to must be a point/);
    expect(() => addShapeTool(doc, { kind: "ellipse", x: 0, y: 0, width: 10, height: 10, stroke: "red" }, env)).toThrow(/"#rrggbb" or "none"/);
    expect(() => addShapeTool(doc, { kind: "ellipse", x: 0, y: 0, width: -10, height: 10 }, env)).toThrow(/more than 0/);
    expect(() => addShapeTool(doc, { kind: "arrow", from: [0, 0], to: [1, 1], end_head: "spear" }, env)).toThrow(/end_head must be one of none, arrow/);
  });
});

describe("set_shape", () => {
  const base = addShapeTool(doc, { kind: "rectangle", x: 100, y: 100, width: 200, height: 100 }, env);
  const arrow = addShapeTool(base.doc, { kind: "arrow", from: [0, 0], to: [100, 0] }, env);

  it("changes part of a box and keeps the rest, and its paint", () => {
    const r = setShapeTool(arrow.doc, { layer: base.layerId, width: 400, fill: "#00ff00", dash: "dashed", stroke: "none", rotation: 15 }, env);
    const layer = shapeOf(r.doc, base.layerId);
    expect(placedShape(layer)).toMatchObject({ cx: 300, cy: 150, width: 400, height: 100, rotation: 15 });
    expect(layer.paint).toMatchObject({ fill: "#00ff00", dash: "dashed", stroke: null });
    const ellipse = setShapeTool(r.doc, { layer: "Rectangle", kind: "ellipse" }, env);
    expect(shapeOf(ellipse.doc, base.layerId).shape).toEqual({ type: "ellipse" });
    expect(setShapeTool(ellipse.doc, { layer: base.layerId, kind: "ellipse" }, env).doc).toBe(ellipse.doc);
  });

  it("moves a line's ends, bends it, and makes it an arrow or a line", () => {
    const r = setShapeTool(arrow.doc, { layer: arrow.layerId, to: [300, 200], bend: -40, start_head: "bar" }, env);
    expect(placedShape(shapeOf(r.doc, arrow.layerId))).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 300, y: 200 }, startHead: "bar", endHead: "arrow" });
    expect((placedShape(shapeOf(r.doc, arrow.layerId)) as { bend: number }).bend).toBeCloseTo(-40, 6);
    const plain = setShapeTool(r.doc, { layer: arrow.layerId, kind: "line" }, env);
    expect(shapeOf(plain.doc, arrow.layerId).shape).toMatchObject({ startHead: "none", endHead: "none" });
    const again = setShapeTool(plain.doc, { layer: arrow.layerId, kind: "arrow" }, env);
    expect(shapeOf(again.doc, arrow.layerId).shape).toMatchObject({ endHead: "arrow" });
  });

  it("refuses what a kind doesn't have, and layers that aren't shapes", () => {
    expect(() => setShapeTool(arrow.doc, { layer: arrow.layerId, width: 3 }, env)).toThrow(/has no width: give from, to and bend/);
    expect(() => setShapeTool(arrow.doc, { layer: base.layerId, from: [0, 0] }, env)).toThrow(/has no from/);
    expect(() => setShapeTool(arrow.doc, { layer: base.layerId, kind: "arrow" }, env)).toThrow(/can't become a arrow/);
    const withPixels = { ...arrow.doc, layers: [...arrow.doc.layers, { id: "p", kind: "pixel" as const, name: "Paint", visible: true, opacity: 1, surface: null, size: { width: 10, height: 10 }, transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 } }] };
    expect(() => setShapeTool(withPixels, { layer: "Paint", stroke: "#000000" }, env)).toThrow(/is a pixel layer, not a shape/);
  });

  it("is described by get_photo", () => {
    const text = describePhoto(arrow.doc, [], [arrow.layerId]);
    expect(text).toContain(`${arrow.layerId} "Arrow": shape layer (a vector: edit it with set_shape)`);
    expect(text).toContain("arrow from (0, 0) to (100, 0), heads: arrow at its end");
    expect(text).toContain("rectangle x 100..300, y 100..200 (200×100)");
    expect(text).toMatch(/stroke #123456 6 px, no fill/);
  });
});
