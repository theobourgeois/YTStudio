/**
 * Editing a slot's envelope on Gross Beat's mapping panel, FL's way (`docs/fl-studio/gross-beat.md`):
 * right-click (and drag) adds a point (Shift: on the line); drag a point to move it (Shift: only along,
 * its value kept; Ctrl/⌘: only up and down; Alt: off the grid), Alt+click deletes it, right-click opens
 * its menu; drag a tension handle to bend its segment (Ctrl/⌘: finely), right-click straightens it. With
 * step editing on, a drag paints a step in each grid cell it crosses (Shift: pulses); with slide on, the
 * points after a moved one go along. Frozen, nothing changes. Each drag is drawn as it goes and made one
 * edit when it's let go.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { addPoint, curveValue, deletePoint, movePoint, updatePoint } from "@shared/music/automation";
import { type GrossKind, editGrossSlot, paintStep, slidePoint } from "@shared/music/gross-beat";
import { GROSS_TICKS } from "@shared/music/gross-beat-presets";
import type { AutomationPoint } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type CurveBox, curveTick, curveValueAt, draggedTension, hitCurve } from "../automation/curve-geometry";
import { useMusic } from "../store";
import { snapTick, snapValue, stepCell } from "./geometry";
import { type GrossView, useGrossUi } from "./store";

export interface PanelTarget {
  effectId: string;
  kind: GrossKind;
  slot: number;
  points: AutomationPoint[];
  box: CurveBox;
  view: GrossView;
}

const show = (t: PanelTarget, points: AutomationPoint[]) => useGrossUi.setState({ drag: { effectId: t.effectId, kind: t.kind, slot: t.slot, points } });
const cancel = () => useGrossUi.setState({ drag: null });
/** The drag's points, as one edit of the slot. */
function finish() {
  const drag = useGrossUi.getState().drag;
  useGrossUi.setState({ drag: null });
  if (drag) useMusic.getState().commit((song) => editGrossSlot(song, drag.effectId, drag.kind, drag.slot, () => drag.points));
}
const commit = (t: PanelTarget, change: (points: AutomationPoint[]) => AutomationPoint[]) =>
  useMusic.getState().commit((song) => editGrossSlot(song, t.effectId, t.kind, t.slot, change));

/** The pointer over the panel: on a point, the arrow; on a tension handle, up and down; elsewhere a cross (frozen: not allowed). */
export function panelCursor(t: PanelTarget, x: number, y: number): string {
  if (t.view.freeze) return "not-allowed";
  const hit = hitCurve(t.points, t.box, x, y);
  return !hit ? "crosshair" : hit.kind === "point" ? "default" : "ns-resize";
}

/** A press on the panel, at `x`, `y` px inside it. */
export function panelPointerDown(e: ReactPointerEvent<HTMLElement>, element: HTMLElement, t: PanelTarget, x: number, y: number) {
  const { view, box, points } = t;
  if (view.freeze) return;
  const local = (ev: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const tickAt = (px: number, free: boolean) => snapTick(curveTick(box, px), view.snap, free);
  const valueAt = (py: number, free: boolean) => snapValue(curveValueAt(box, py), t.kind, view.snap, free);
  const hit = hitCurve(points, box, x, y);

  /** Drag the point at `index` of `base` (one just added, or one pressed). */
  const dragPoint = (base: AutomationPoint[], index: number, button: 0 | 2, onClick: () => void) => {
    const from = base[index];
    startPointerDrag(e, {
      button,
      threshold: button === 2 ? 0 : 2,
      cursor: "default",
      onMove(ev) {
        const q = local(ev);
        const tick = ev.ctrlKey || ev.metaKey ? from.tick : tickAt(q.x, ev.altKey);
        const value = ev.shiftKey ? from.value : valueAt(q.y, ev.altKey);
        show(t, view.slide ? slidePoint(base, index, tick, value) : movePoint(base, index, tick, value, GROSS_TICKS));
      },
      onEnd: finish,
      onClick,
      onCancel: cancel,
    });
  };

  if (e.button === 2) {
    if (hit?.kind === "point") {
      useGrossUi.setState({ pointMenu: { effectId: t.effectId, kind: t.kind, slot: t.slot, index: hit.index, x, y } });
      return;
    }
    if (hit?.kind === "tension") return commit(t, (list) => updatePoint(list, hit.index, { tension: 0 }));
    // A new point where it's pressed (Shift: on the line), moved while the button's held.
    const tick = tickAt(x, e.altKey);
    const added = addPoint(points, tick, e.shiftKey ? curveValue(points, tick) : valueAt(y, e.altKey), GROSS_TICKS);
    if (added.index < 0) return;
    show(t, added.points);
    dragPoint(added.points, added.index, 2, finish);
    return;
  }
  if (e.button !== 0) return;

  if (hit?.kind === "point") {
    // Alt+click, not moved: it goes. Moved with Alt held, it's off the grid.
    dragPoint(points, hit.index, 0, () => {
      cancel();
      if (e.altKey) commit(t, (list) => deletePoint(list, hit.index));
    });
    return;
  }
  if (hit?.kind === "tension") {
    const start = points[hit.index].tension;
    startPointerDrag(e, {
      threshold: 1,
      cursor: "ns-resize",
      onMove(ev) {
        show(t, updatePoint(points, hit.index, { tension: draggedTension(points, hit.index, start, y - local(ev).y, ev.ctrlKey || ev.metaKey) }));
      },
      onEnd: finish,
      onClick: cancel,
      onCancel: cancel,
    });
    return;
  }
  if (!view.step) return;

  // Step editing: each cell the drag crosses holds the value where the pointer is (Shift: a pulse, back to
  // the top for time, silence for volume, in its second half). Painted from the points before the drag.
  const painted = new Map<number, number>();
  const paint = (px: number, py: number, pulse: boolean) => {
    const cell = stepCell(Math.max(0, Math.min(GROSS_TICKS - 1, curveTick(box, px))), view.snap);
    painted.set(cell.from, valueAt(py, false));
    let next = points;
    for (const [from, value] of painted) next = paintStep(next, from, from + (cell.to - cell.from), value, pulse, t.kind === "time" ? 1 : 0);
    show(t, next);
  };
  paint(x, y, e.shiftKey);
  startPointerDrag(e, {
    threshold: 0,
    cursor: "crosshair",
    onMove(ev) {
      const q = local(ev);
      paint(q.x, q.y, ev.shiftKey);
    },
    onEnd: finish,
    onClick: finish,
    onCancel: cancel,
  });
}
