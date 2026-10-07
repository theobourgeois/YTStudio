/**
 * Drawing with the shape tools (docs/photo/tools/shapes.md, "The tools"): a drag draws a new shape layer above the
 * active one, from corner to corner or end to end (Shift: a square, a circle, 45° steps; Alt: from the centre), one
 * undo step, selected; Escape drops it. A click on a shape selects it; a click on nothing makes a shape of a
 * default size there. The tool stays.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { createId } from "@shared/ids";
import { hitShape } from "@shared/photo/shape-drawing";
import { CLICK_TRAVEL, type NewShape, type Point, type ShapeKind, addShapeLayer, clickedShape, dragBox, dragLineEnd, makeShapeLayer } from "@shared/photo/shapes";
import type { PhotoProject, ShapeLayer } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useColours } from "../../colours";
import { currentDoc, photoGesture, usePhoto } from "../../store";
import { usePhotoUi } from "../../ui";
import type { DocPointOf } from "../kit";
import { paintOf, useShapeOptions } from "./options";

/** How near a shape's stroke a click picks it, in CSS pixels. */
export const PICK_CSS_PX = 6;

/** Document pixels per CSS pixel at the current zoom. */
export const cssToDoc = (px: number) => (px * devicePixelRatio) / (usePhotoUi.getState().view?.zoom ?? 1);

/** The topmost visible shape layer whose stroke or fill is under (x, y). */
export function shapeAt(doc: PhotoProject, at: Point, tolerance: number): ShapeLayer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.kind === "shape" && l.visible && hitShape(l, at.x, at.y, tolerance)) return l;
  }
  return null;
}

const whole = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** What a drag from `start` to `end` draws (whole pixels, so an even stroke on a box's edge is crisp). */
export function drawnShape(kind: ShapeKind, start: Point, end: Point, mods: { shift: boolean; alt: boolean }): Pick<NewShape, "box" | "from" | "to"> {
  const s = whole(start);
  if (kind === "line" || kind === "arrow") return { from: s, to: whole(dragLineEnd(s, end, mods.shift)) };
  const b = dragBox(s, whole(end), { square: mods.shift, fromCentre: mods.alt });
  return { box: { x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) } };
}

/** The new shape's settings from the options: its paint, a rectangle's radius, an arrow's heads (a line has none). */
function fromOptions(kind: ShapeKind): Omit<NewShape, "id" | "kind"> {
  const o = useShapeOptions.getState();
  const paint = paintOf(o, useColours.getState().foreground);
  return {
    paint,
    radius: o.radius,
    startHead: kind === "arrow" ? o.startHead : "none",
    endHead: kind === "arrow" ? (o.startHead === "none" && o.endHead === "none" ? "arrow" : o.endHead) : "none",
  };
}

export function drawShape(e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf, kind: ShapeKind) {
  const base = currentDoc();
  if (!base) return;
  const ui = usePhotoUi.getState();
  const start = docPoint(e.clientX, e.clientY);
  const above = ui.selectedLayerId;
  const before = { ids: ui.selectedLayerIds, active: ui.selectedLayerId };
  const id = createId("layer");
  const settings = fromOptions(kind);
  const made = (geometry: Pick<NewShape, "box" | "from" | "to">) => makeShapeLayer(base, { id, kind, ...settings, ...geometry });
  const gesture = photoGesture();
  let shown = false;
  startPointerDrag(e, {
    threshold: CLICK_TRAVEL,
    cursor: "crosshair",
    onStart: () => gesture.begin(),
    onMove: (ev) => {
      const layer = made(drawnShape(kind, start, docPoint(ev.clientX, ev.clientY), { shift: ev.shiftKey, alt: ev.altKey }));
      // Absolute: the document as it was, with the shape as it's drawn now.
      gesture.apply(() => addShapeLayer(base, layer, above));
      if (!shown) {
        shown = true;
        usePhotoUi.getState().select(id);
      }
    },
    onEnd: () => gesture.end(),
    onCancel: () => {
      gesture.cancel();
      usePhotoUi.getState().setSelection(before.ids, before.active);
    },
    onClick: () => {
      const hit = shapeAt(base, start, cssToDoc(PICK_CSS_PX));
      if (hit) return usePhotoUi.getState().select(hit.id);
      // Figma's click: a shape of a default size, there.
      const layer = made(clickedShape(kind, whole(start), base.canvas));
      usePhoto.getState().commit((d) => addShapeLayer(d, layer, above));
      usePhotoUi.getState().select(id);
    },
  });
}
