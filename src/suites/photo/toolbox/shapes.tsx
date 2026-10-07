/**
 * The shape tools (U, docs/photo/tools/shapes.md): Rectangle, Ellipse, Line and Arrow. Each draws shape layers
 * (`shapes/draw.ts`), shows the selected shapes' handles (`shapes/overlay.tsx`) and its options (`shapes/bar.tsx`).
 */
import type { ShapeKind } from "@shared/photo/shapes";
import type { ToolKit } from "./kit";
import { ShapeOptionsBar } from "./shapes/bar";
import { drawShape } from "./shapes/draw";
import { ShapeHandles } from "./shapes/overlay";

const kitOf = (kind: ShapeKind): ToolKit => ({
  Options: () => <ShapeOptionsBar kind={kind} />,
  press: (e, docPoint) => drawShape(e, docPoint, kind),
  Overlay: ShapeHandles,
  cursor: "cursor-crosshair",
});

export const rectangleShapeKit: ToolKit = kitOf("rectangle");
export const ellipseShapeKit: ToolKit = kitOf("ellipse");
export const lineShapeKit: ToolKit = kitOf("line");
export const arrowShapeKit: ToolKit = kitOf("arrow");
