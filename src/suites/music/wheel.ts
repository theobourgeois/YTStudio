import { type RefObject, useEffect, useRef } from "react";
import { clamp } from "@shared/math";

/** A wheel's delta (px) that makes one step: a mouse's notch is at least this, a trackpad's small deltas add up to it. */
export const WHEEL_STEP = 40;
/** How long the wheel is still before the scrolls so far count as one change (one undo step). */
const WHEEL_SETTLE_MS = 400;

export interface WheelValue {
  /** The value now, read when a run of scrolls starts. */
  value: () => number;
  min: number;
  max: number;
  /** How much a step changes it; `fine` while Ctrl or ⌘ is held. */
  step: (fine: boolean) => number;
  onBegin: () => void;
  onDrag: (value: number) => void;
  onEnd: () => void;
}

/** How far a line (`deltaMode` 1, Firefox's) and a page (2) of a wheel scroll, in pixels. */
const LINE_PX = WHEEL_STEP;
const PAGE_PX = 800;

type WheelLike = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">;

/**
 * A wheel event's travel in pixels, sideways (`x`) and down (`y`), whatever its unit. Shift turns a
 * vertical wheel sideways: Chromium on Windows (and macOS) already gives it as `deltaX` with `deltaY` 0,
 * other browsers don't, so it's taken either way. A Windows mouse's notch is about 100 px; a Mac
 * trackpad's deltas are a few px each.
 */
export function wheelScroll(e: WheelLike): { x: number; y: number } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
  const x = e.deltaX * unit;
  const y = e.deltaY * unit;
  return e.shiftKey ? { x: x || y, y: 0 } : { x, y };
}

/** A wheel's turn up and down (+ is down), or sideways while Shift is held (Windows sends it so). */
export function wheelTurn(e: Pick<WheelEvent, "deltaX" | "deltaY" | "shiftKey">): number {
  return e.deltaY || (e.shiftKey ? e.deltaX : 0);
}

/** Steps up (+) or down (-) in a wheel event, carrying what's left of a trackpad's deltas in `rest`. */
export function wheelSteps(deltaY: number, deltaMode: number, rest: { current: number }): number {
  // Lines and pages are a notch at least.
  const delta = deltaMode === 0 ? deltaY : deltaY * WHEEL_STEP;
  if (Math.abs(delta) >= WHEEL_STEP) {
    rest.current = 0;
    return delta < 0 ? 1 : -1;
  }
  rest.current += delta;
  const steps = Math.trunc(rest.current / WHEEL_STEP);
  rest.current -= steps * WHEEL_STEP;
  return -steps;
}

/**
 * Scrolling over a control that's dragged up and down (a knob, a fader, an LCD) changes it too, as in
 * FL Studio: up for more, a notch a step, Ctrl or ⌘ for fine steps. Scrolls in a row are one change,
 * like a drag, ended once the wheel has been still a moment. The page doesn't scroll under it.
 */
export function useWheelValue(ref: RefObject<HTMLElement | null>, handlers: WheelValue, enabled = true) {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    const rest = { current: 0 };
    let current: number | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const end = () => {
      settle = null;
      current = null;
      latest.current.onEnd();
    };
    const onWheel = (e: WheelEvent) => {
      const turn = wheelTurn(e);
      if (turn === 0) return;
      e.preventDefault();
      const steps = wheelSteps(turn, e.deltaMode, rest);
      if (!steps) return;
      const h = latest.current;
      if (current === null) {
        current = h.value();
        h.onBegin();
      }
      if (settle) clearTimeout(settle);
      settle = setTimeout(end, WHEEL_SETTLE_MS);
      current = clamp(current + steps * h.step(e.ctrlKey || e.metaKey), h.min, h.max);
      h.onDrag(current);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      if (settle) {
        clearTimeout(settle);
        end();
      }
    };
  }, [ref, enabled]);
}
