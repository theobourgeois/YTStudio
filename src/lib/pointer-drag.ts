/**
 * A pointer-drag state machine shared by every drag in the app (timeline
 * clips and trims, the canvas handles...): pointer capture, a start
 * threshold, a forced cursor, Escape / pointercancel / window blur to cancel,
 * and a guaranteed single end-or-cancel callback. Only one drag can be active
 * at a time.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

export interface DragHandlers {
  /** The mouse button that drags: 0, the primary one (the default), 1 the middle one (panning), or 2, the secondary (FL Studio's erase). */
  button?: 0 | 1 | 2;
  /** Pointer travel (px) before the drag starts. 0 = start on the first move. */
  threshold: number;
  /** Cursor forced on the whole document while the drag is active. */
  cursor?: string;
  /**
   * Lock the pointer (hidden, held where it was pressed) from the press on, so the drag goes on past the
   * screen's edges, as FL Studio's knobs and number displays do: read `travel`, not the event's position.
   */
  lock?: boolean;
  /** Threshold crossed (before the first `onMove`). */
  onStart?: () => void;
  /** Pointer moved after the start. `travel` is how far it's moved since the press (counted while it's locked). */
  onMove: (ev: PointerEvent, travel: { x: number; y: number }) => void;
  onEnd?: () => void;
  /** Escape, pointercancel, window blur, `cancelActiveDrag`, or another drag taking over. */
  onCancel?: () => void;
  /** Released without crossing the threshold. */
  onClick?: () => void;
}

let active: { cancel: () => void } | null = null;

/** Cancel the in-flight drag, if any (e.g. when the view it belongs to unmounts). */
export function cancelActiveDrag() {
  active?.cancel();
}

/** Start tracking a drag from a press of its button (the primary one by default). Returns false when it can't start. */
export function startPointerDrag(e: ReactPointerEvent<Element>, h: DragHandlers): boolean {
  const button = h.button ?? 0;
  if (e.button !== button || active) return false;
  const target = e.currentTarget;
  const pointerId = e.pointerId;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone; window listeners still work.
  }

  const origin = { x: e.clientX, y: e.clientY };
  const travel = { x: 0, y: 0 };
  const locked = () => h.lock === true && document.pointerLockElement === target;
  if (h.lock) {
    try {
      // A promise in Chromium (refused without a press, or in some embedders): the drag then works as usual.
      void (target.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      // ignore
    }
  }
  let started = false;
  let done = false;
  const root = document.documentElement;
  const prevCursor = root.style.cursor;

  const finish = (kind: "end" | "cancel") => {
    if (done) return;
    done = true;
    active = null;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("pointerlockchange", onLockChange);
    target.removeEventListener("lostpointercapture", onLost);
    if (h.lock && document.pointerLockElement === target) document.exitPointerLock();
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
    if (ev.pointerType === "mouse" && (ev.buttons & (button === 2 ? 2 : button === 1 ? 4 : 1)) === 0) {
      finish("end");
      return;
    }
    if (locked()) {
      travel.x += ev.movementX;
      travel.y += ev.movementY;
    } else {
      travel.x = ev.clientX - origin.x;
      travel.y = ev.clientY - origin.y;
    }
    if (!started) {
      if (Math.hypot(travel.x, travel.y) < h.threshold) return;
      started = true;
      if (h.cursor) root.style.cursor = h.cursor;
      h.onStart?.();
      if (done) return;
    }
    h.onMove(ev, travel);
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
  // Escape while locked goes to the browser (which unlocks), not to the page.
  function onLockChange() {
    if (!document.pointerLockElement && started) finish("cancel");
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
  if (h.lock) document.addEventListener("pointerlockchange", onLockChange);
  target.addEventListener("lostpointercapture", onLost);
  active = { cancel: () => finish("cancel") };
  return true;
}
