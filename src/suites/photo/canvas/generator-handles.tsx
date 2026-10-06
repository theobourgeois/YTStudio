/**
 * A generator's handles on the canvas (docs/photo/f4-light.md, "UI"): a flare's source as a crosshair, its optical
 * centre as a small circle, and the axis between them that its elements line up on. A handle is dragged in
 * document pixels (the same point at any zoom), snapping to the canvas's centre and edges and to other layers
 * (Control: not), one undo step a drag; Escape cancels it.
 */
import { handlePoint, setHandle } from "@shared/photo/edits";
import { effectDefinition } from "@shared/photo/effects/index";
import type { GeneratorLayer } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { photoGesture, usePhoto, usePhotoDoc } from "../store";
import { usePhotoUi } from "../ui";
import { snapPoint } from "./snap";

export function GeneratorHandles({ docPoint, snap }: { docPoint: (x: number, y: number) => { x: number; y: number }; snap: (e: { ctrlKey: boolean }) => { targets: Parameters<typeof snapPoint>[1]; threshold: number } | null }) {
  const view = usePhotoUi((s) => s.view);
  const activeId = usePhotoUi((s) => s.selectedLayerId);
  const layer = usePhotoDoc((d) => d.layers.find((l): l is GeneratorLayer => l.id === activeId && l.kind === "generator"));
  const doc = usePhotoDoc((d) => d);
  if (!view || !layer || !layer.visible) return null;
  const def = effectDefinition(layer.effect.type);
  const handles = (def?.params ?? []).flatMap((p) => (p.kind === "point" && p.handle ? [{ key: p.key, label: p.label, at: handlePoint(doc, layer, p.key) }] : [])).filter((h) => h.at);
  if (!handles.length) return null;
  const dpr = devicePixelRatio;
  const screen = ([x, y]: [number, number]) => ({ x: ((x - view.x) * view.zoom) / dpr, y: ((y - view.y) * view.zoom) / dpr });
  const drag = (key: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const gesture = photoGesture();
    const done = () => usePhotoUi.getState().setGuides([]);
    startPointerDrag(e, {
      threshold: 0,
      cursor: "grabbing",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const p = docPoint(ev.clientX, ev.clientY);
        const s = snap(ev);
        const r = s ? snapPoint(p, s.targets, s.threshold) : { ...p, guides: [] };
        usePhotoUi.getState().setGuides(r.guides);
        gesture.apply((d) => setHandle(d, layer.id, key, [Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100]));
      },
      onEnd: () => {
        done();
        gesture.end();
      },
      onCancel: () => {
        done();
        gesture.cancel();
      },
    });
  };
  const source = handles.find((h) => h.key === "source");
  const centre = handles.find((h) => h.key === "centre");
  const a = source?.at ? screen(source.at) : null;
  const b = centre?.at ? screen(centre.at) : null;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-generator-handles={layer.id}>
      {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.5} strokeDasharray="3 4" strokeWidth={1} />}
      {handles.map((h) => {
        const p = screen(h.at!);
        const follows = layer.effect.params[h.key] === null;
        return (
          <g key={h.key} className="pointer-events-auto cursor-move" onPointerDown={drag(h.key)} data-handle={h.key} data-at={h.at!.join(",")} aria-label={h.label}>
            <circle cx={p.x} cy={p.y} r={12} fill="transparent" />
            {h.key === "source" ? (
              <>
                <circle cx={p.x} cy={p.y} r={7} fill="none" stroke="black" strokeWidth={3} strokeOpacity={0.5} />
                <circle cx={p.x} cy={p.y} r={7} fill="none" stroke="white" strokeWidth={1.5} />
                <path d={`M${p.x - 11} ${p.y}h22M${p.x} ${p.y - 11}v22`} stroke="white" strokeWidth={1.5} />
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r={4.5} fill={follows ? "transparent" : "white"} stroke="var(--brand)" strokeWidth={1.5} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Whether the active layer is a visible generator (the Move tool moves its handles then). */
export const activeGenerator = () => {
  const id = usePhotoUi.getState().selectedLayerId;
  const layer = usePhoto.getState().history?.doc.doc.layers.find((l) => l.id === id);
  return layer?.kind === "generator" ? layer : null;
};
