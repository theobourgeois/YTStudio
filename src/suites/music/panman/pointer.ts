/**
 * Editing PanMan's editors by mouse, as its manual says (`docs/soundtoys/panman.md`), with FL's right
 * button removing as everywhere in the music suite.
 *
 * The Rhythm Step Editor: a click on an empty grid line adds a point (dragged while held); drag a point to
 * move it, up and down its position, sideways its time on the grid (Ctrl/⌘: off it); one dropped on
 * another's tick goes back. Alt+click or a right-click deletes one.
 *
 * The Rhythm Editor: a click on empty space adds an event a grid cell long (dragged, longer); a click on an
 * event deletes it (so does a right-click); drag its edges to resize it, or Alt-drag (its left side held),
 * Shift-drag (its right side held), Alt+Shift-drag or a plain drag (moved).
 *
 * Each drag is drawn as it goes (`PanDrag`) and made one edit when it's let go.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { addShapeEvent, addStepPoint, deleteShapeEvent, deleteStepPoint, editShapeEvents, editStepPoints, moveStepPoint, setShapeEvent } from "@shared/music/panman";
import type { PanShapeEvent, PanStepPoint } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { useMusic } from "../store";
import { type EditorBox, hitEvent, hitPoint, snapEdge, snapTick, xTick, yValue } from "./geometry";
import { usePanUi } from "./store";

export interface EditorTarget {
  effectId: string;
  box: EditorBox;
  /** The grid (ticks) and the pattern's length (the editor's bars). */
  grid: number;
  length: number;
}

const commit = (update: Parameters<ReturnType<typeof useMusic.getState>["commit"]>[0]) => useMusic.getState().commit(update);
const cancel = () => usePanUi.setState({ drag: null });

function local(element: HTMLElement, ev: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

/** The pointer over the step editor: a hand on a point, else a cross. */
export const stepCursor = (t: EditorTarget, points: readonly PanStepPoint[], x: number, y: number) => (hitPoint(points, t.box, x, y) >= 0 ? "grab" : "crosshair");

/** A press on the Rhythm Step Editor at `x`, `y` px inside it, over `points` (what it shows). */
export function stepPointerDown(e: ReactPointerEvent<HTMLElement>, element: HTMLElement, t: EditorTarget, points: PanStepPoint[], x: number, y: number) {
  const hit = hitPoint(points, t.box, x, y);
  if (e.button === 2 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    if (hit >= 0) commit((s) => editStepPoints(s, t.effectId, (shown) => deleteStepPoint(shown, hit)));
    return;
  }
  if (e.button !== 0) return;
  // On a point: it's dragged. Elsewhere: a point on the grid line nearest, dragged while held.
  let base = points;
  let index = hit;
  if (hit < 0) {
    const tick = snapTick(t.box, xTick(t.box, x), t.grid);
    base = addStepPoint(points, tick, yValue(t.box, y));
    index = base.findIndex((p) => p.tick === tick);
    if (base === points || index < 0) return;
  }
  const show = (next: PanStepPoint[]) => usePanUi.setState({ drag: { effectId: t.effectId, editor: "step", points: next } });
  const finish = () => {
    const drag = usePanUi.getState().drag;
    cancel();
    if (drag?.editor === "step") commit((s) => editStepPoints(s, t.effectId, () => drag.points));
  };
  show(base);
  startPointerDrag(e, {
    threshold: 0,
    cursor: "grabbing",
    onMove(ev) {
      const at = local(element, ev);
      const free = ev.ctrlKey || ev.metaKey;
      show(moveStepPoint(base, index, snapTick(t.box, xTick(t.box, at.x), t.grid, !free), yValue(t.box, at.y)));
    },
    onEnd: finish,
    onClick: finish,
    onCancel: cancel,
  });
}

/** The pointer over the Rhythm Editor: resizing on an event's edges, a hand on its body, else a cross. */
export function shapeCursor(t: EditorTarget, events: readonly PanShapeEvent[], x: number) {
  const hit = hitEvent(events, t.box, x);
  return !hit ? "crosshair" : hit.part === "body" ? "grab" : "ew-resize";
}

/** A press on the Rhythm Editor at `x` px inside it, over `events` (what it shows). */
export function shapePointerDown(e: ReactPointerEvent<HTMLElement>, element: HTMLElement, t: EditorTarget, events: PanShapeEvent[], x: number) {
  const hit = hitEvent(events, t.box, x);
  if (e.button === 2) {
    e.preventDefault();
    if (hit) commit((s) => editShapeEvents(s, t.effectId, (shown) => deleteShapeEvent(shown, hit.index)));
    return;
  }
  if (e.button !== 0) return;
  const show = (next: PanShapeEvent[]) => usePanUi.setState({ drag: { effectId: t.effectId, editor: "shape", events: next } });
  const finish = () => {
    const drag = usePanUi.getState().drag;
    cancel();
    if (drag?.editor === "shape") commit((s) => editShapeEvents(s, t.effectId, () => drag.events));
  };
  const tickAt = (ev: { clientX: number; clientY: number }, free = false) => snapTick(t.box, xTick(t.box, local(element, ev).x), t.grid, !free);

  if (!hit) {
    // A new event a grid cell long, made longer by dragging right.
    const start = snapTick(t.box, xTick(t.box, x), t.grid);
    const base = addShapeEvent(events, start, t.grid);
    const index = base.findIndex((ev) => ev.tick === start);
    if (base === events || index < 0) return;
    show(base);
    startPointerDrag(e, {
      threshold: 3,
      cursor: "ew-resize",
      onMove: (ev) => show(setShapeEvent(base, index, start, Math.max(start + t.grid, snapEdge(t.box, xTick(t.box, local(element, ev).x), t.grid)), t.length)),
      onEnd: finish,
      onClick: finish,
      onCancel: cancel,
    });
    return;
  }

  // On an event: what the drag does, from where it was pressed and the keys held.
  const event = events[hit.index];
  const end = event.tick + event.length;
  const pressed = xTick(t.box, x);
  const mode = e.altKey && e.shiftKey ? "move" : e.altKey ? "end" : e.shiftKey ? "start" : hit.part === "body" ? "move" : hit.part;
  startPointerDrag(e, {
    threshold: 3,
    cursor: mode === "move" ? "grabbing" : "ew-resize",
    onMove(ev) {
      const free = ev.ctrlKey || ev.metaKey;
      const tick = xTick(t.box, local(element, ev).x);
      if (mode === "move") {
        const from = snapTick(t.box, event.tick + (tick - pressed), t.grid, !free);
        show(setShapeEvent(events, hit.index, from, from + event.length, t.length));
      } else if (mode === "start") show(setShapeEvent(events, hit.index, tickAt(ev, free), end, t.length));
      else show(setShapeEvent(events, hit.index, event.tick, snapEdge(t.box, tick, t.grid, !free), t.length));
    },
    onEnd: finish,
    // A click on an event deletes it (the manual's).
    onClick: () => commit((s) => editShapeEvents(s, t.effectId, (shown) => deleteShapeEvent(shown, hit.index))),
    onCancel: cancel,
  });
}
