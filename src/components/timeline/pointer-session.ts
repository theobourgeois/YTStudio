/**
 * Timeline drags (clip moves, trims, scrubbing, transition edges): the shared
 * pointer-drag state machine (`@/lib/pointer-drag`) with the pointer reported
 * in lane coordinates, plus auto-scroll near the lane viewport edges.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { startPointerDrag } from "@/lib/pointer-drag";
import { HEADER_WIDTH, RULER_HEIGHT } from "./constants";
import { lanePoint, type TimelineContextValue } from "./context";
import { edgeScrollSpeed } from "./geometry";

export interface LanePoint {
  x: number;
  y: number;
}

export interface SessionHandlers {
  /** Pointer travel (px) before the drag starts. 0 = start on the first move. */
  threshold: number;
  /** Scroll when the pointer nears the lane viewport edges. */
  autoScroll?: boolean;
  /** Cursor forced on the whole document while the drag is active. */
  cursor?: string;
  /** Threshold crossed. */
  onStart?: () => void;
  /** Pointer moved (or the view auto-scrolled) after the start. */
  onMove: (p: LanePoint) => void;
  onEnd?: () => void;
  /** Escape, pointercancel, window blur, or unmount. */
  onCancel?: () => void;
  /** Released without crossing the threshold. */
  onClick?: () => void;
}

export function startPointerSession(
  e: ReactPointerEvent<HTMLElement>,
  ctx: TimelineContextValue,
  h: SessionHandlers,
): boolean {
  let last = { x: e.clientX, y: e.clientY };
  let raf = 0;
  const stopScrolling = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  const apply = () => {
    const p = lanePoint(ctx, last.x, last.y);
    if (p) h.onMove(p);
  };

  const autoScroll = () => {
    raf = 0;
    const el = ctx.scrollerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const speedX = edgeScrollSpeed(last.x - rect.left - HEADER_WIDTH, el.clientWidth - HEADER_WIDTH);
    const speedY = edgeScrollSpeed(last.y - rect.top - RULER_HEIGHT, el.clientHeight - RULER_HEIGHT);
    if (speedX === 0 && speedY === 0) return;
    const [left, top] = [el.scrollLeft, el.scrollTop];
    el.scrollLeft = left + speedX;
    el.scrollTop = top + speedY;
    if (el.scrollLeft !== left || el.scrollTop !== top) apply();
    raf = requestAnimationFrame(autoScroll);
  };

  return startPointerDrag(e, {
    threshold: h.threshold,
    cursor: h.cursor,
    onStart: h.onStart,
    onMove(ev) {
      last = { x: ev.clientX, y: ev.clientY };
      apply();
      if (h.autoScroll && !raf) raf = requestAnimationFrame(autoScroll);
    },
    onEnd() {
      stopScrolling();
      h.onEnd?.();
    },
    onCancel() {
      stopScrolling();
      h.onCancel?.();
    },
    onClick: h.onClick,
  });
}
