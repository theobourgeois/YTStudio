/**
 * Free Transform's Warp (Edit › Transform › Warp, Photoshop's): the layer's patch on the canvas, its grid curves at the
 * thirds, its control net, and its 16 points to drag (a corner takes its tangents along). Each drag is part of the
 * session's one step; dragging a point makes the warp custom. Pure maths in `shared/photo/warp.ts`.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { setTransform } from "@shared/photo/edits";
import type { Size } from "@shared/photo/geometry";
import { apply, invert, layerMatrix, layerPoint } from "@shared/photo/layers";
import { invertHomography, isProjective, layerProjection, project } from "@shared/photo/projective";
import type { PlacedLayer } from "@shared/photo/types";
import { identityPoints, isWarpCorner, moveWarpPoint } from "@shared/photo/warp";
import { startPointerDrag } from "@/lib/pointer-drag";
import { sessionGesture } from "../free-transform";
import { usePhoto } from "../store";
import { usePhotoUi } from "../ui";

/** Document point → the layer's warped normalised space (before its place): where its control points are. */
function toWarpSpace(layer: PlacedLayer, size: Size, p: { x: number; y: number }): [number, number] | null {
  const t = layer.transform;
  const q = isProjective(t) ? project(invertHomography(layerProjection(t, size)), p.x, p.y) : apply(invert(layerMatrix(t, size)), p.x, p.y);
  return q && [q.x / size.width, q.y / size.height];
}

/** A normalised warped-space point on the document (its place applied, no warp: control points live before it). */
function placed(layer: PlacedLayer, size: Size, w: [number, number]) {
  const plain = { ...layer.transform, warp: undefined };
  return layerPoint(plain, size, w[0] * size.width, w[1] * size.height);
}

export function WarpOverlay({ layer, size, docPoint }: { layer: PlacedLayer; size: Size; docPoint: (x: number, y: number) => { x: number; y: number } }) {
  const view = usePhotoUi((s) => s.view);
  if (!view) return null;
  const dpr = devicePixelRatio;
  const css = (p: { x: number; y: number }) => ({ x: ((p.x - view.x) * view.zoom) / dpr, y: ((p.y - view.y) * view.zoom) / dpr });
  const points = layer.transform.warp?.points ?? identityPoints();
  // The patch's grid: curves at the thirds each way, through the warp and the place.
  const curve = (f: (s: number) => [number, number]) =>
    Array.from({ length: 33 }, (_, i) => {
      const [u, v] = f(i / 32);
      const p = css(layerPoint(layer.transform, size, u * size.width, v * size.height));
      return `${p.x},${p.y}`;
    }).join(" ");
  const lines = [0, 1 / 3, 2 / 3, 1].flatMap((k) => [curve((s) => [s, k]), curve((s) => [k, s])]);
  const net = points.map((p) => css(placed(layer, size, p)));

  const drag = (k: number) => (e: ReactPointerEvent<SVGElement>) => {
    e.stopPropagation();
    const gesture = sessionGesture();
    if (!gesture) return;
    const before = usePhoto.getState().history!.doc.doc;
    const start = layer.transform.warp?.points ?? identityPoints();
    startPointerDrag(e, {
      threshold: 0,
      cursor: "move",
      onMove: (ev) => {
        const to = toWarpSpace(layer, size, docPoint(ev.clientX, ev.clientY));
        if (!to) return;
        gesture.apply((d) => setTransform(d, layer.id, { warp: { points: moveWarpPoint(start, k, to), style: null } }));
      },
      onCancel: () => gesture.apply(() => before),
    });
  };

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-warp-overlay={layer.id}>
      {lines.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke="var(--brand)" strokeWidth={i < 2 || i > 5 ? 1 : 0.75} strokeOpacity={i < 2 || i > 5 ? 1 : 0.6} />
      ))}
      {/* The control net: each anchor's tangents. */}
      {[0, 3, 12, 15].flatMap((c) =>
        [c + (c % 4 === 0 ? 1 : -1), c + (c < 4 ? 4 : -4)].map((n) => <line key={`${c}-${n}`} x1={net[c].x} y1={net[c].y} x2={net[n].x} y2={net[n].y} stroke="var(--brand)" strokeWidth={1} strokeDasharray="2 2" />),
      )}
      {net.map((p, k) =>
        isWarpCorner(k) ? (
          <rect key={k} x={p.x - 4} y={p.y - 4} width={8} height={8} fill="white" stroke="var(--brand)" className="pointer-events-auto" style={{ cursor: "move" }} onPointerDown={drag(k)} data-warp-point={k} />
        ) : (
          <circle key={k} cx={p.x} cy={p.y} r={4} fill="white" stroke="var(--brand)" className="pointer-events-auto" style={{ cursor: "move" }} onPointerDown={drag(k)} data-warp-point={k} />
        ),
      )}
    </svg>
  );
}
