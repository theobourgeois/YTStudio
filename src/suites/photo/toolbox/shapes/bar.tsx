/**
 * The shape tools' options bar (docs/photo/tools/shapes.md): the style of new shapes, or of the selected shape layers
 * when there are some (Photoshop's and Excalidraw's way: a change restyles them, one undo step, and is what the next
 * shape gets too).
 */
import { useRef } from "react";
import { restyleShapes, type ShapeKind, shapeKind } from "@shared/photo/shapes";
import type { ShapeLayer } from "@shared/photo/types";
import { useShallow } from "zustand/react/shallow";
import { useColours } from "../../colours";
import { type PhotoGesture, photoGesture, usePhoto, usePhotoDoc } from "../../store";
import { usePhotoUi } from "../../ui";
import { type ControlSet, type ControlValues, type OnShapeChange, ShapeControls } from "./controls";
import { type ShapeOptions, patchOf, useShapeOptions } from "./options";

/** The controls a kind of shape has. */
export const controlSet = (kind: ShapeKind): ControlSet => ({ fill: kind === "rectangle" || kind === "ellipse", radius: kind === "rectangle", heads: kind === "line" || kind === "arrow" });

/** A layer's paint and geometry as the controls show them (what it doesn't have: the options'). */
export function valuesOf(layer: ShapeLayer, options: ShapeOptions): ControlValues {
  const p = layer.paint;
  const s = layer.shape;
  return {
    ...p,
    fill: p.fill ?? "none",
    stroke: p.stroke ?? "none",
    radius: s.type === "rect" ? s.radius : options.radius,
    startHead: s.type === "line" ? s.startHead : options.startHead,
    endHead: s.type === "line" ? s.endHead : options.endHead,
  };
}

/** The selected shape layers' ids, and the active one when it's a shape. */
export function useSelectedShapes(): { ids: string[]; active: ShapeLayer | null } {
  const selected = usePhotoUi(useShallow((s) => s.selectedLayerIds));
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const ids = usePhotoDoc(useShallow((d) => d.layers.filter((l) => l.kind === "shape" && selected.includes(l.id)).map((l) => l.id)));
  const active = usePhotoDoc((d) => {
    const l = d.layers.find((x) => x.id === activeId);
    return l?.kind === "shape" ? l : null;
  });
  return { ids, active };
}

/**
 * A change of the controls on shape layers `ids()`: one undo step for a one-off, one for a drag (begin, move…, end).
 * `remember` keeps it in the options too (the options bar's; Properties' changes are the layer's alone).
 */
export function useShapeChange(ids: () => readonly string[], remember: boolean): OnShapeChange {
  const gesture = useRef<PhotoGesture | null>(null);
  return (patch, phase) => {
    if (phase === "end") {
      gesture.current?.end();
      gesture.current = null;
      return;
    }
    if (remember) useShapeOptions.getState().set(patch);
    const targets = ids();
    if (!targets.length) return;
    const { paint, geometry } = patchOf(patch, useColours.getState().foreground);
    const edit = (d: Parameters<typeof restyleShapes>[0]) => restyleShapes(d, targets, paint, geometry);
    if (phase === "once") return usePhoto.getState().commit(edit);
    if (phase === "begin") {
      gesture.current?.end();
      gesture.current = photoGesture();
      gesture.current.begin();
    }
    gesture.current?.apply(edit);
  };
}

export function ShapeOptionsBar({ kind }: { kind: ShapeKind }) {
  const options = useShapeOptions();
  const foreground = useColours((s) => s.foreground);
  const { ids, active } = useSelectedShapes();
  const onChange = useShapeChange(() => usePhotoUi.getState().selectedLayerIds.filter((id) => ids.includes(id)), true);
  const values = active ? valuesOf(active, options) : options;
  // The selected shape's controls when there is one (an arrow shows its heads whatever the tool), else the tool's.
  const set = controlSet(active ? shapeKind(active) : kind);
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="shape" data-tool-options-for={kind} data-restyling={ids.length || undefined}>
      <ShapeControls values={values} set={set} foreground={foreground} onChange={onChange} />
    </div>
  );
}
