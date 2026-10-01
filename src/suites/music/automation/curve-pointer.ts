/**
 * Editing an automation clip's curve on its clip in the Playlist, FL Studio's way
 * (`docs/fl-studio/automation.md`): drag a point (Shift: only along, Ctrl: only up and down, Alt: off the
 * grid; Alt+click deletes it), drag a tension handle to bend its segment (Ctrl: finely; a right-click
 * straightens it), right-click (and drag) on the curve to add a point (Shift: on the line, keeping its
 * value), right-click a point for its menu. Each drag is a `curve` drag, one edit when it's let go.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { addPoint, curveValue, deletePoint, editPoints, movePoint, updatePoint } from "@shared/music/automation";
import { clipEnd } from "@shared/music/playlist";
import type { Automation, AutomationPoint, PlaylistClip } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { snapTick } from "../piano/geometry";
import { type PlaylistContext, cancelDrag, commitDrag } from "../playlist/actions";
import { TITLE_HEIGHT, tickToX, trackTop } from "../playlist/geometry";
import { type PlaylistView, usePlaylist } from "../playlist/store";
import { useMusic } from "../store";
import { CURVE_PAD, type CurveBox, type CurveHit, curveTick, curveValueAt, draggedTension, hitCurve } from "./curve-geometry";

/** The least a clip's body can be (px) for its curve to be edited there (the drawing shows points from it). */
export const EDITABLE_BODY = 14 + CURVE_PAD * 2;

/** Where an automation clip's curve is on the Playlist's grid: its box, and the clip's window onto it (px). */
export interface ClipCurve {
  automation: Automation;
  box: CurveBox;
  left: number;
  right: number;
}

/** An automation clip's curve on the grid, as `draw.ts` draws it; null if its body is too small to edit in. */
export function clipCurve(p: PlaylistContext, view: PlaylistView, clip: PlaylistClip): ClipCurve | null {
  const automation = clip.kind === "automation" ? p.song.automations.find((a) => a.id === clip.ref) : undefined;
  if (!automation) return null;
  const y = Math.round(trackTop(p.layout, view, clip.track));
  const h = Math.round(trackTop(p.layout, view, clip.track + 1)) - y - 1;
  const title = Math.min(TITLE_HEIGHT, h);
  const height = h - title - 1;
  if (height < EDITABLE_BODY) return null;
  const left = tickToX(view, clip.start);
  return {
    automation,
    box: { x0: left - clip.offset * view.pxPerTick, pxPerTick: view.pxPerTick, top: y + title, height },
    left,
    right: tickToX(view, clipEnd(clip, p.ctx)),
  };
}

/** The point or handle of a clip's curve under the pointer (in the grid's px), or null; `inBody`: it's on the clip's curve area. */
export function curveUnder(p: PlaylistContext, view: PlaylistView, clip: PlaylistClip, x: number, y: number): { curve: ClipCurve; hit: CurveHit | null } | null {
  const curve = clipCurve(p, view, clip);
  if (!curve || y < curve.box.top) return null;
  return { curve, hit: hitCurve(curve.automation.points, curve.box, x, y, curve.left, curve.right) };
}

/** The pointer over a clip's curve: on a point, a hand; on a tension handle, up and down. Null elsewhere. */
export function curveCursor(p: PlaylistContext, view: PlaylistView, clip: PlaylistClip, x: number, y: number): string | null {
  const under = curveUnder(p, view, clip, x, y);
  if (!under?.hit) return null;
  return under.hit.kind === "point" ? "grab" : "ns-resize";
}

type Press = ReactPointerEvent<HTMLElement>;

/**
 * A press on an automation clip's curve (the draw and paint tools). Returns whether it was the curve's: a
 * press elsewhere on the clip (its title, its body away from points with the left button) is the clip's.
 */
export function curvePointerDown(e: Press, element: HTMLElement, p: PlaylistContext, clip: PlaylistClip, x: number, y: number): boolean {
  const { view } = usePlaylist.getState();
  const under = curveUnder(p, view, clip, x, y);
  if (!under) return false;
  const { curve, hit } = under;
  const { automation, box } = curve;
  const { points, length } = automation;
  const id = automation.id;
  // Ctrl on the body selects, as on any clip; on a point or handle it's the curve's.
  if (!hit && (e.ctrlKey || e.metaKey)) return false;

  const show = (points: AutomationPoint[]) => usePlaylist.getState().setDrag({ kind: "curve", automationId: id, points });
  const local = (ev: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  /** The curve's tick under `px`, on the snap's grid of the song (Alt: none). */
  const tickAt = (px: number, alt: boolean) => {
    const songTick = clip.start + curveTick(box, px) - clip.offset;
    return snapTick(songTick, alt ? 1 : p.grid, "line") - clip.start + clip.offset;
  };
  /** Drag the point at `index` of `base` (a point just added, or one pressed). */
  const dragPoint = (base: AutomationPoint[], index: number, button: 0 | 2, onClick: () => void) => {
    const from = base[index];
    startPointerDrag(e, {
      button,
      threshold: button === 2 ? 0 : 2,
      cursor: "grabbing",
      onMove(ev) {
        const q = local(ev);
        const tick = ev.shiftKey ? from.tick : tickAt(q.x, ev.altKey);
        const value = ev.ctrlKey || ev.metaKey ? from.value : curveValueAt(box, q.y);
        show(movePoint(base, index, tick, value, length));
      },
      onEnd: commitDrag,
      onClick,
      onCancel: cancelDrag,
    });
  };
  const commit = (change: (points: AutomationPoint[]) => AutomationPoint[]) => useMusic.getState().commit((song) => editPoints(song, id, change));

  if (e.button === 2) {
    if (hit?.kind === "point") {
      usePlaylist.setState({ pointMenu: { automationId: id, index: hit.index, x, y } });
      return true;
    }
    if (hit?.kind === "tension") {
      commit((list) => updatePoint(list, hit.index, { tension: 0 }));
      return true;
    }
    // A new point where it's pressed (Shift: on the line, its value kept), moved while it's held.
    const tick = Math.max(0, tickAt(x, e.altKey));
    const added = addPoint(points, tick, e.shiftKey ? curveValue(points, tick) : curveValueAt(box, y), length);
    if (added.index < 0) return true;
    show(added.points);
    dragPoint(added.points, added.index, 2, commitDrag);
    return true;
  }
  if (e.button !== 0 || !hit) return false;

  if (hit.kind === "point") {
    // Alt+click, not moved: it goes (FL's Right Alt+click). Moved with Alt held, it's off the grid.
    dragPoint(points, hit.index, 0, () => {
      cancelDrag();
      if (e.altKey) commit((list) => deletePoint(list, hit.index));
    });
    return true;
  }
  const start = points[hit.index].tension;
  startPointerDrag(e, {
    threshold: 1,
    cursor: "ns-resize",
    onMove(ev) {
      const up = y - local(ev).y;
      show(updatePoint(points, hit.index, { tension: draggedTension(points, hit.index, start, up, ev.ctrlKey || ev.metaKey) }));
    },
    onEnd: commitDrag,
    onClick: cancelDrag,
    onCancel: cancelDrag,
  });
  return true;
}
