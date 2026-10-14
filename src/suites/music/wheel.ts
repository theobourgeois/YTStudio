import { type RefObject, useEffect, useRef } from "react";
import { clamp } from "@shared/math";
import { addWindowListener } from "@/lib/window-events";

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

type PreciseLike = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode"> & { wheelDeltaX?: number; wheelDeltaY?: number };

/**
 * Whether a wheel event is a trackpad's (or a Magic Mouse's): pixels that follow the fingers, many a
 * second, rather than a wheel's notches. Chromium's old `wheelDelta` tells: 120 a notch, but -3 × the
 * pixels for a trackpad's. Elsewhere, small pixel deltas.
 */
export function isPreciseWheel(e: PreciseLike): boolean {
  if (e.deltaMode !== 0) return false;
  const legacy = e.wheelDeltaY || e.wheelDeltaX;
  if (legacy) return Math.abs(legacy + 3 * (e.wheelDeltaY ? e.deltaY : e.deltaX)) < 1.5;
  return Math.abs(e.deltaY) < 50 && Math.abs(e.deltaX) < 50;
}

let controlDown = false;
let watching = false;

/**
 * Keep track of the Control key itself, so a pinch can be told from Ctrl+wheel (`isPinch`). Once is
 * enough: it listens in every window for the page's life.
 */
export function watchControlKey() {
  if (watching) return;
  watching = true;
  const note = (e: KeyboardEvent | PointerEvent) => (controlDown = e.ctrlKey);
  addWindowListener("keydown", note, true);
  addWindowListener("keyup", note, true);
  addWindowListener("pointermove", note, true);
  addWindowListener("blur", () => (controlDown = false));
}

/**
 * Whether a wheel event is a trackpad's pinch: Chromium sends one as a wheel with `ctrlKey` set while
 * the Control key isn't down (`watchControlKey` must be watching).
 */
export const isPinch = (e: Pick<WheelEvent, "ctrlKey">) => e.ctrlKey && !controlDown;

/** A pinch's deltas are the log of its scale, a hundred to one (Chromium's): this many make e (×2.7). */
const PINCH_PX = 100;
/** Pixels of a trackpad's two-finger scroll (with Ctrl or ⌘) that zoom by e: a short swipe about doubles it. */
const PRECISE_ZOOM_PX = 250;
/** A wheel's notch zooms 10%, and one event never more than two notches' worth. */
const NOTCH_ZOOM = 1.1;

/**
 * How much a zooming wheel event (Ctrl or ⌘ held, or a pinch) zooms by. A pinch follows the fingers:
 * the content grows as they part. A trackpad's two-finger scroll zooms in proportion to how far it
 * went, so it's as smooth as the scroll. A wheel zooms 10% a notch, whatever size its deltas come in
 * (a Windows mouse's 100 px, a Mac mouse's few px, Firefox's lines).
 */
export function wheelZoom(e: PreciseLike, pinch: boolean): number {
  const delta = e.deltaY || e.deltaX;
  if (!delta) return 1;
  if (pinch) return Math.exp(-clamp(e.deltaY, -PINCH_PX, PINCH_PX) / PINCH_PX);
  if (isPreciseWheel(e)) return Math.exp(-clamp(delta, -PRECISE_ZOOM_PX / 4, PRECISE_ZOOM_PX / 4) / PRECISE_ZOOM_PX);
  const legacy = e.wheelDeltaY || e.wheelDeltaX;
  const notches = legacy ? legacy / 120 : e.deltaMode === 0 ? -delta / 100 : -Math.sign(delta);
  return NOTCH_ZOOM ** clamp(notches, -2, 2);
}

/** How long the wheel is still before the next event starts another scroll (and its axis is chosen again). */
const RAIL_GAP_MS = 150;
/** Pixels a scroll goes before its axis is chosen. */
const RAIL_DECIDE_PX = 8;
/** How much more one way than the other a scroll must go to be held to that axis. */
const RAIL_RATIO = 2;

/**
 * A trackpad's scroll held to the axis it set off along, as a Mac's own lists are: fingers moved up
 * the pad drift a little sideways too, which would move the view along time while it's scrolled up
 * the keys. A scroll that sets off diagonally stays free. Give it each scroll (px) and when it came.
 */
export function createRails() {
  let axis: "x" | "y" | "free" | null = null;
  let last = -Infinity;
  const sum = { x: 0, y: 0 };
  const hold = (scroll: { x: number; y: number }, to: "x" | "y" | "free") => (to === "x" ? { x: scroll.x, y: 0 } : to === "y" ? { x: 0, y: scroll.y } : scroll);
  return (scroll: { x: number; y: number }, now: number): { x: number; y: number } => {
    if (now - last > RAIL_GAP_MS) {
      axis = null;
      sum.x = sum.y = 0;
    }
    last = now;
    if (axis) return hold(scroll, axis);
    sum.x += Math.abs(scroll.x);
    sum.y += Math.abs(scroll.y);
    const leaning = sum.y > RAIL_RATIO * sum.x ? "y" : sum.x > RAIL_RATIO * sum.y ? "x" : "free";
    if (sum.x + sum.y >= RAIL_DECIDE_PX) axis = leaning;
    return hold(scroll, leaning);
  };
}

/** A wheel's turn up and down (+ is down), or sideways while Shift is held (Windows sends it so). */
export function wheelTurn(e: Pick<WheelEvent, "deltaX" | "deltaY" | "shiftKey">): number {
  return e.deltaY || (e.shiftKey ? e.deltaX : 0);
}

/** The least a wheel's notch has been (px): a bigger event is several notches at once (a quick turn, sent together). */
let notch = Infinity;
/** Forget the notch learnt (tests). */
export const forgetWheelNotch = () => void (notch = Infinity);

/** Steps up (+) or down (-) in a wheel event, carrying what's left of a trackpad's deltas in `rest`. */
export function wheelSteps(deltaY: number, deltaMode: number, rest: { current: number }): number {
  // Lines and pages are a notch at least.
  const delta = deltaMode === 0 ? deltaY : deltaY * WHEEL_STEP;
  if (Math.abs(delta) >= WHEEL_STEP) {
    rest.current = 0;
    // Windows sends a quick turn's notches as one event (two notches, 200 px): each is a step.
    if (deltaMode === 0) notch = Math.min(notch, Math.abs(delta));
    const steps = deltaMode === 0 ? Math.max(1, Math.round(Math.abs(delta) / notch)) : 1;
    return delta < 0 ? steps : -steps;
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
