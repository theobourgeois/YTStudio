/**
 * Shape layers as the assistant reads them (`get_photo`, and what `add_shape` and `set_shape` answer): what kind,
 * where on the canvas in its pixels (a box, or a line's ends), and how it's painted. Pure.
 */
import { shapeBounds } from "./shape-drawing.ts";
import { placedShape, shapeKind } from "./shapes.ts";
import type { ShapeLayer, ShapePaint } from "./types.ts";

const r = (n: number) => Math.round(n * 10) / 10;

/** Its paint in a few words: "stroke #ff0000 8 px dashed, no fill, hand-drawn (artist)". */
export function describePaint(p: ShapePaint, line: boolean): string {
  const parts = [p.stroke && p.strokeWidth > 0 ? `stroke ${p.stroke} ${r(p.strokeWidth)} px${p.dash === "solid" ? "" : ` ${p.dash}`}${line || p.align === "centre" ? "" : ` ${p.align}`}` : "no stroke"];
  if (!line) parts.push(p.fill ? `fill ${p.fill}${p.sloppiness && p.fillStyle !== "solid" ? ` (${p.fillStyle})` : ""}` : "no fill");
  if (p.sloppiness) parts.push(`hand-drawn (${p.sloppiness === 1 ? "artist" : "cartoonist"})`);
  if (p.cap !== "round" || p.join !== "miter") parts.push(`caps ${p.cap}, corners ${p.join}`);
  return parts.join(", ");
}

/** The shape's geometry on the canvas: "rectangle x 100..300, y 50..150 (200×100), corner radius 12" or "arrow from (10, 20) to (300, 40)". */
export function describeGeometry(layer: ShapeLayer): string {
  const kind = shapeKind(layer);
  const p = placedShape(layer);
  if (p.type === "line") {
    const heads = [p.startHead !== "none" ? `${p.startHead} at its start` : "", p.endHead !== "none" ? `${p.endHead} at its end` : ""].filter(Boolean).join(", ");
    return `${kind} from (${r(p.from.x)}, ${r(p.from.y)}) to (${r(p.to.x)}, ${r(p.to.y)})${p.bend ? `, bent ${r(p.bend)} px to its left` : ""}${heads ? `, heads: ${heads}` : ""}`;
  }
  const box = `x ${r(p.cx - p.width / 2)}..${r(p.cx + p.width / 2)}, y ${r(p.cy - p.height / 2)}..${r(p.cy + p.height / 2)} (${r(p.width)}×${r(p.height)})`;
  return `${kind} ${box}${p.rotation ? `, turned ${r(p.rotation)}°` : ""}${p.type === "rect" && p.radius ? `, corner radius ${r(p.radius)}` : ""}`;
}

/** A shape layer's lines under its heading in `get_photo`. */
export function describeShapeLines(layer: ShapeLayer): string[] {
  const b = shapeBounds(layer);
  return [
    `   ${describeGeometry(layer)}`,
    `   ${describePaint(layer.paint, layer.shape.type === "line")}`,
    b ? `   draws within x ${r(b.x0)}..${r(b.x1)}, y ${r(b.y0)}..${r(b.y1)}` : "   draws nothing (no stroke, no fill)",
  ];
}
