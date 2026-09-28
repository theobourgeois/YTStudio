/**
 * A tiny pointer-drag state machine shared by clip moves, trims and scrubbing:
 * pointer capture, a start threshold, edge auto-scroll, Escape / pointercancel /
 * window blur to cancel, and a guaranteed single end-or-cancel callback.
 * Only one session can be active at a time.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { HEADER_WIDTH } from "./constants";
import { lanePoint, type TimelineContextValue } from "./context";
import { edgeScrollSpeed } from "./geometry";

export interface LanePoint {
  x: number;
  y: number;
}

export interface SessionHandlers {
  /** Pointer travel (px) before the drag starts. 0 = start on the first move. */
  threshold: number;
  /** Scroll horizontally when the pointer nears the lane viewport edges. */
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

let active: { cancel: () => void } | null = null;

/** Cancel the in-flight drag, if any (e.g. when the timeline unmounts). */
export function cancelActiveSession() {
  active?.cancel();
}

export function startPointerSession(
  e: ReactPointerEvent<HTMLElement>,
  ctx: TimelineContextValue,
  h: SessionHandlers,
): boolean {
  if (e.button !== 0 || active) return false;
  const target = e.currentTarget;
  const pointerId = e.pointerId;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone; window listeners still work.
  }

  const origin = { x: e.clientX, y: e.clientY };
  let last = origin;
  let started = false;
  let done = false;
  let raf = 0;
  const root = document.documentElement;
  const prevCursor = root.style.cursor;

  const apply = () => {
    const p = lanePoint(ctx, last.x, last.y);
    if (p) h.onMove(p);
  };

  const autoScroll = () => {
    raf = 0;
    const el = ctx.scrollerRef.current;
    if (done || !el) return;
    const rect = el.getBoundingClientRect();
    const speed = edgeScrollSpeed(last.x - rect.left - HEADER_WIDTH, el.clientWidth - HEADER_WIDTH);
    if (speed === 0) return;
    const before = el.scrollLeft;
    el.scrollLeft = before + speed;
    if (el.scrollLeft !== before) apply();
    raf = requestAnimationFrame(autoScroll);
  };

  const finish = (kind: "end" | "cancel") => {
    if (done) return;
    done = true;
    active = null;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    target.removeEventListener("lostpointercapture", onLost);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
    if (!started) {
      if (kind === "end") h.onClick?.();
      return;
    }
    if (h.cursor) root.style.cursor = prevCursor;
    if (kind === "end") h.onEnd?.();
    else h.onCancel?.();
  };

  function onMove(ev: PointerEvent) {
    if (ev.pointerId !== pointerId || done) return;
    // A missed pointerup (e.g. released outside the window without capture).
    if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) {
      finish("end");
      return;
    }
    last = { x: ev.clientX, y: ev.clientY };
    if (!started) {
      if (Math.hypot(last.x - origin.x, last.y - origin.y) < h.threshold) return;
      started = true;
      if (h.cursor) root.style.cursor = h.cursor;
      h.onStart?.();
      if (done) return;
    }
    apply();
    if (h.autoScroll && !raf) raf = requestAnimationFrame(autoScroll);
  }
  function onUp(ev: PointerEvent) {
    if (ev.pointerId === pointerId) finish("end");
  }
  function onCancel(ev: PointerEvent) {
    if (ev.pointerId === pointerId) finish("cancel");
  }
  function onKey(ev: KeyboardEvent) {
    if (ev.key !== "Escape" || !started) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finish("cancel");
  }
  function onBlur() {
    finish("cancel");
  }
  function onLost() {
    // Capture can be lost if the element is re-parented; keep tracking via window listeners.
    if (done || !target.isConnected) return;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // ignore
    }
  }

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onBlur);
  target.addEventListener("lostpointercapture", onLost);
  active = { cancel: () => finish("cancel") };
  return true;
}
