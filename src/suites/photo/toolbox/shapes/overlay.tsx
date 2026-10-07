/**
 * The shape tools' handles over the canvas (docs/photo/tools/shapes.md, "With a shape selected"): the selected shapes'
 * outlines, and the active one's handles. A rectangle's or an ellipse's box resizes from its eight handles (Shift
 * keeps its proportions, Alt resizes about its centre) and a rectangle's corner widget rounds it; a line's ends move
 * (Shift: 45° steps from the other end) and its middle bends it. Each drag is one undo step; Escape drops it.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { placedShape, setShapeLayer, withPlacedBox, withPlacedLine, dragLineEnd, type Point } from "@shared/photo/shapes";
import type { ShapeLayer } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useShallow } from "zustand/react/shallow";
import { resizeCursor } from "../../canvas/cursors";
import { photoGesture, usePhotoDoc } from "../../store";
import { usePhotoUi } from "../../ui";
import type { DocPointOf } from "../kit";
import { cssToDoc } from "./draw";
import { BOX_HANDLES, type BoxHandle, type PlacedBox, type PlacedLine, bendFrom, bendHandle, boxCorners, handlePoint, radiusFrom, radiusHandle, resizeBox } from "./geometry";

/** How far in from the corner the radius widget sits when the corners are square (CSS pixels). */
const RADIUS_INSET_CSS = 14;

export function ShapeHandles({ docPoint }: { docPoint: DocPointOf }) {
  const view = usePhotoUi((s) => s.view);
  const ids = usePhotoUi(useShallow((s) => s.selectedLayerIds));
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const shapes = usePhotoDoc(useShallow((d) => d.layers.filter((l): l is ShapeLayer => l.kind === "shape" && ids.includes(l.id))));
  if (!view || !shapes.length) return null;
  const dpr = devicePixelRatio;
  const css = (p: Point) => ({ x: ((p.x - view.x) * view.zoom) / dpr, y: ((p.y - view.y) * view.zoom) / dpr });
  const active = shapes.find((s) => s.id === activeId) ?? null;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-shape-handles={shapes.length}>
      {shapes.map((s) => (
        <Outline key={s.id} layer={s} css={css} />
      ))}
      {active && active.visible && <Handles layer={active} css={css} docPoint={docPoint} />}
    </svg>
  );
}

/** A shape's outline: its box (turned), its ellipse, or its line's curve. */
function Outline({ layer, css }: { layer: ShapeLayer; css: (p: Point) => Point }) {
  const p = placedShape(layer);
  if (p.type === "line") {
    const [a, b] = [css(p.from), css(p.to)];
    const c = p.control ? css(p.control) : null;
    return <path d={c ? `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`} fill="none" stroke="var(--brand)" strokeWidth={1} data-shape-outline={layer.id} />;
  }
  const corners = boxCorners(p).map(css);
  return <polygon points={corners.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth={1} data-shape-outline={layer.id} />;
}

function Handles({ layer, css, docPoint }: { layer: ShapeLayer; css: (p: Point) => Point; docPoint: DocPointOf }) {
  const p = placedShape(layer);
  /** A drag of a handle: the layer made again from where the pointer is, from the layer as it was when pressed. */
  const drag = (e: ReactPointerEvent<SVGElement>, cursor: string, next: (at: Point, ev: PointerEvent) => ShapeLayer) => {
    e.stopPropagation();
    const gesture = photoGesture();
    startPointerDrag(e, {
      threshold: 0,
      cursor,
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const made = next(docPoint(ev.clientX, ev.clientY), ev);
        gesture.apply((d) => setShapeLayer(d, made));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };
  if (p.type === "line") return <LineHandles layer={layer} p={p} css={css} drag={drag} />;
  return <BoxHandles layer={layer} p={p} css={css} drag={drag} />;
}

type Drag = (e: ReactPointerEvent<SVGElement>, cursor: string, next: (at: Point, ev: PointerEvent) => ShapeLayer) => void;

function BoxHandles({ layer, p, css, drag }: { layer: ShapeLayer; p: PlacedBox; css: (p: Point) => Point; drag: Drag }) {
  const centre = css({ x: p.cx, y: p.cy });
  const cursorOf = (h: BoxHandle) => {
    const at = css(handlePoint(p, h));
    return resizeCursor((Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI);
  };
  const radius = p.type === "rect" ? css(radiusHandle(p, cssToDoc(RADIUS_INSET_CSS))) : null;
  return (
    <>
      {BOX_HANDLES.map((h) => {
        const at = css(handlePoint(p, h));
        const cursor = cursorOf(h);
        return (
          <rect
            key={`${h.u},${h.v}`}
            x={at.x - 4}
            y={at.y - 4}
            width={8}
            height={8}
            fill="white"
            stroke="var(--brand)"
            className="pointer-events-auto"
            style={{ cursor }}
            onPointerDown={(e) => drag(e, cursor, (pointer, ev) => withPlacedBox(layer, resizeBox(p, h, pointer, { keepRatio: ev.shiftKey, fromCentre: ev.altKey })))}
            data-shape-handle={`${h.u},${h.v}`}
          />
        );
      })}
      {radius && (
        <circle
          cx={radius.x}
          cy={radius.y}
          r={4.5}
          fill="white"
          stroke="var(--brand)"
          className="pointer-events-auto"
          style={{ cursor: "default" }}
          onPointerDown={(e) => drag(e, "default", (pointer) => ({ ...layer, shape: { type: "rect", radius: radiusFrom(p, pointer) } }))}
          data-shape-handle="radius"
        >
          <title>Corner radius</title>
        </circle>
      )}
    </>
  );
}

function LineHandles({ layer, p, css, drag }: { layer: ShapeLayer; p: PlacedLine; css: (p: Point) => Point; drag: Drag }) {
  const [from, to] = [css(p.from), css(p.to)];
  const middle = css(bendHandle(p));
  const end = (which: "from" | "to") => (e: ReactPointerEvent<SVGElement>) =>
    drag(e, "move", (pointer, ev) => {
      const other = which === "from" ? p.to : p.from;
      const at = dragLineEnd(other, { x: Math.round(pointer.x), y: Math.round(pointer.y) }, ev.shiftKey);
      return which === "from" ? withPlacedLine(layer, at, p.to) : withPlacedLine(layer, p.from, at);
    });
  return (
    <>
      <circle cx={middle.x} cy={middle.y} r={4} fill="var(--brand)" stroke="white" className="pointer-events-auto" style={{ cursor: "move" }} onPointerDown={(e) => drag(e, "move", (pointer) => withPlacedLine(layer, p.from, p.to, bendFrom(p, pointer, cssToDoc(6))))} data-shape-handle="bend">
        <title>Bend</title>
      </circle>
      {(
        [
          ["from", from],
          ["to", to],
        ] as const
      ).map(([which, at]) => (
        <circle key={which} cx={at.x} cy={at.y} r={5} fill="white" stroke="var(--brand)" strokeWidth={1.5} className="pointer-events-auto" style={{ cursor: "move" }} onPointerDown={end(which)} data-shape-handle={which} />
      ))}
    </>
  );
}
