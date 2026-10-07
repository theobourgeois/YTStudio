/**
 * A shape layer's Shape section in Properties (Photoshop's Live Shape Properties, docs/photo/tools/shapes.md): its
 * place in pixels (a box's W, H, X, Y and angle; a line's ends and bend), its style (the options bar's controls, for
 * this layer alone), and Rasterize. Each typed value is one undo step; a drag of a number one too.
 */
import { PiPaintBrush } from "react-icons/pi";
import { type PlacedShape, placedShape, setShapeLayer, shapeKind, withPlacedBox, withPlacedLine } from "@shared/photo/shapes";
import type { ShapeLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { useColours } from "../../colours";
import { layerActions } from "../../layer-actions";
import { NumberField } from "../../panels/fields";
import { usePhoto } from "../../store";
import { controlSet, useShapeChange, valuesOf } from "./bar";
import { ShapeControls } from "./controls";
import { useShapeOptions } from "./options";

const round = (n: number) => Math.round(n * 10) / 10;

export function ShapeSection({ layer }: { layer: ShapeLayer }) {
  const options = useShapeOptions();
  const foreground = useColours((s) => s.foreground);
  const onChange = useShapeChange(() => [layer.id], false);
  const kind = shapeKind(layer);
  const p = placedShape(layer);
  const commit = (next: ShapeLayer) => usePhoto.getState().commit((d) => setShapeLayer(d, next));
  return (
    <div className="flex flex-col gap-2" data-shape-properties={kind}>
      {p.type === "line" ? <LineFields layer={layer} p={p} commit={commit} /> : <BoxFields layer={layer} p={p} commit={commit} />}
      <ShapeControls values={valuesOf(layer, options)} set={controlSet(kind)} foreground={foreground} onChange={onChange} className="flex-wrap whitespace-normal" />
      <Button size="sm" variant="outline" className="self-start" onClick={() => void layerActions.convertToPixels(layer.id)} title="Make it pixels (Photoshop's Rasterize Layer): it can be painted on, but not reshaped">
        <PiPaintBrush /> Rasterize
      </Button>
    </div>
  );
}

function BoxFields({ layer, p, commit }: { layer: ShapeLayer; p: Extract<PlacedShape, { type: "rect" | "ellipse" }>; commit: (l: ShapeLayer) => void }) {
  const box = { cx: p.cx, cy: p.cy, width: p.width, height: p.height, rotation: p.rotation };
  const set = (patch: Partial<typeof box>) => commit(withPlacedBox(layer, { ...box, ...patch }));
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="W" value={round(p.width)} onCommit={(width) => set({ width: Math.max(1, width), cx: p.cx - p.width / 2 + Math.max(1, width) / 2 })} suffix="px" />
      <NumberField label="H" value={round(p.height)} onCommit={(height) => set({ height: Math.max(1, height), cy: p.cy - p.height / 2 + Math.max(1, height) / 2 })} suffix="px" />
      <NumberField label="X" value={round(p.cx - p.width / 2)} onCommit={(x) => set({ cx: x + p.width / 2 })} suffix="px" />
      <NumberField label="Y" value={round(p.cy - p.height / 2)} onCommit={(y) => set({ cy: y + p.height / 2 })} suffix="px" />
      <NumberField label="Angle" value={round(p.rotation)} onCommit={(rotation) => set({ rotation })} suffix="°" />
    </div>
  );
}

function LineFields({ layer, p, commit }: { layer: ShapeLayer; p: Extract<PlacedShape, { type: "line" }>; commit: (l: ShapeLayer) => void }) {
  const set = (from = p.from, to = p.to, bend = p.bend) => commit(withPlacedLine(layer, from, to, bend));
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField label="From X" value={round(p.from.x)} onCommit={(x) => set({ ...p.from, x })} suffix="px" />
      <NumberField label="From Y" value={round(p.from.y)} onCommit={(y) => set({ ...p.from, y })} suffix="px" />
      <NumberField label="To X" value={round(p.to.x)} onCommit={(x) => set(p.from, { ...p.to, x })} suffix="px" />
      <NumberField label="To Y" value={round(p.to.y)} onCommit={(y) => set(p.from, { ...p.to, y })} suffix="px" />
      <NumberField label="Bend" value={round(p.bend)} onCommit={(bend) => set(p.from, p.to, bend)} suffix="px" />
      <NumberField label="Length" value={round(Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y))} disabled onCommit={() => {}} suffix="px" />
    </div>
  );
}
