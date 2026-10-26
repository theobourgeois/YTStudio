/**
 * Pro-Q's display under the mouse (`docs/fabfilter/pro-q.md`, FabFilter's gestures):
 *
 *   drag a dot             frequency and gain of the selected bands (gains scaled together); a gainless
 *                          band's height is its Q. Shift: fine. Alt: one axis. Cmd/Ctrl: Q.
 *   click a dot            select it; Cmd/Ctrl-click: in or out; Shift-click: a range
 *   Alt-click a dot        bypass it; Cmd+Alt: next shape; Alt+Shift: next slope
 *   drag the ▲▼ handle     a dynamic band's range
 *   drag the yellow curve  a new band, dragged (a shelf at either end); Alt: dynamic
 *   double-click / Cmd-click the background   a new band (a Notch at the bottom, a cut at either side)
 *   drag the background    select the bands in the rectangle; a click there deselects
 *   wheel                  Q of the band under the pointer, or the selection; Cmd/Ctrl: gain; Alt: range
 *   the frequency scale    up/down zooms where it's pressed, sideways scrolls; double-click: all of it
 *
 * Every drag is one undo step, heard as it goes (`songGesture`).
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "@shared/math";
import { EQ_MAX_GAIN, EQ_MAX_Q, EQ_MIN_Q, hasGain } from "@shared/music/pro-q-presets";
import { dragBands, editProQ, fitBand, nextShape, nextSlope, scaleQ, updateBands } from "@shared/music/pro-q";
import type { EqBand, ProQ } from "@shared/music/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { CURSOR } from "../cursors";
import { songGesture } from "../store";
import { clickBand, createBand, editEq, proQOf, selectBands, selected } from "./actions";
import { type EqView, bandAt, dbAt, dotOf, FULL, hzAt, qAtHeight, qHeight, scrolled, shapeForClick, shapeForCurveDrag, xOf, yOf, zoomed } from "./geometry";
import { eqView, useEqUi } from "./store";

/** What a press on the display needs to know: whose display, and how it's laid out now. */
export interface DisplayContext {
  effectId: string;
  view: () => EqView;
  /** The pointer's place on the display (px from its top left). */
  local: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  /** The yellow curve's height (dB) at x px, for grabbing it. */
  curveAt: (x: number) => number;
  /** A peak Spectrum Grab offers near (x, y), if it's holding the spectrum. */
  peakAt: (x: number, y: number) => { hz: number; db: number; q: number } | null;
}

/** How near the pointer must be to the yellow curve to grab it. */
const CURVE_GRAB = 6;

/** The dynamic range handle of a band under (x, y), if one is. */
export function rangeHandleAt(view: EqView, bands: readonly EqBand[], x: number, y: number): EqBand | null {
  for (const band of bands) {
    if (band.range === 0 || !band.dynamics || !hasGain(band.shape)) continue;
    const dot = dotOf(view, band);
    if (Math.abs(x - dot.x) <= 6 && Math.abs(y - yOf(view, band.gain + band.range)) <= 7) return band;
  }
  return null;
}

/** What the pointer is over (for the cursor and the hover): a band's dot, its range handle, the curve, the scale, nothing. */
export function hoverAt(ctx: DisplayContext, pq: ProQ, x: number, y: number): { kind: "band" | "range"; band: EqBand } | { kind: "curve" | "scale" | "none" } {
  const view = ctx.view();
  const handle = rangeHandleAt(view, pq.bands, x, y);
  if (handle) return { kind: "range", band: handle };
  const band = bandAt(view, pq.bands, x, y);
  if (band) return { kind: "band", band };
  if (y > view.height - view.bottom) return { kind: "scale" };
  if (Math.abs(yOf(view, ctx.curveAt(x)) - y) <= CURVE_GRAB) return { kind: "curve" };
  return { kind: "none" };
}

/** A press on the display. */
export function displayPointerDown(e: ReactPointerEvent<HTMLElement>, ctx: DisplayContext) {
  const pq = proQOf(ctx.effectId);
  if (!pq || (e.button !== 0 && e.button !== 1)) return;
  const { x, y } = ctx.local(e);
  const view = ctx.view();
  const mod = e.metaKey || e.ctrlKey;
  const hit = hoverAt(ctx, pq, x, y);

  // Spectrum Grab: a peak dragged becomes a Bell there, its Q from the peak's width, its gain the drag's.
  const peak = useEqUi.getState().grab?.effectId === ctx.effectId ? ctx.peakAt(x, y) : null;
  if (peak && hit.kind !== "band") {
    const id = createBand(ctx.effectId, { frequency: peak.hz, q: peak.q, gain: 0 });
    useEqUi.setState({ grab: useEqUi.getState().grab?.permanent ? useEqUi.getState().grab : null });
    if (id !== null) dragBand(e, ctx, id, 0, y);
    return;
  }

  if (hit.kind === "scale") return scalePointerDown(e, ctx);

  if (hit.kind === "range") {
    // The ▲▼ handle: the range, by height.
    const gesture = songGesture();
    const band = hit.band;
    startPointerDrag(e, {
      threshold: 0,
      cursor: CURSOR.moveV,
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const range = clamp(Math.round((dbAt(ctx.view(), ctx.local(ev).y) - band.gain) * 100) / 100, -EQ_MAX_GAIN, EQ_MAX_GAIN);
        gesture.apply((s) => editProQ(s, ctx.effectId, (p) => updateBands(p, [band.id], { range })));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
    return;
  }

  if (hit.kind === "band") {
    const band = hit.band;
    // Alt-click: bypass; Cmd+Alt: the next shape; Alt+Shift: the next slope.
    if (e.altKey && e.button === 0) {
      e.preventDefault();
      if (mod) return editEq(ctx.effectId, (p) => updateBands(p, [band.id], { shape: nextShape(band.shape) }));
      if (e.shiftKey) return editEq(ctx.effectId, (p) => updateBands(p, [band.id], { slope: nextSlope(band) }));
      return editEq(ctx.effectId, (p) => updateBands(p, [band.id], { enabled: !band.enabled }));
    }
    if (mod && !selected(ctx.effectId).includes(band.id)) return clickBand(ctx.effectId, band.id, "toggle");
    if (e.shiftKey) clickBand(ctx.effectId, band.id, "range");
    else if (!selected(ctx.effectId).includes(band.id)) clickBand(ctx.effectId, band.id, "only");
    dragBand(e, ctx, band.id, x, y, () => {
      // A click (no drag) on a band already in a selection of several: it alone; Cmd: out of it.
      if (mod) clickBand(ctx.effectId, band.id, "toggle");
      else if (!e.shiftKey) clickBand(ctx.effectId, band.id, "only");
    });
    return;
  }

  // The yellow curve: a new band where it's grabbed, dragged at once (a shelf at the ends).
  if (hit.kind === "curve" && !mod) {
    const hz = hzAt(view, x);
    const shape = shapeForCurveDrag(hz);
    const id = createBand(ctx.effectId, {
      shape,
      frequency: hz,
      gain: 0,
      q: shape === "bell" ? 1 : 1,
      ...(e.altKey && { range: -6 }),
    });
    if (id !== null) dragBand(e, ctx, id, x, y);
    return;
  }

  // Cmd-click the background: a new band there.
  if (mod) return createAt(ctx, x, y, e.altKey);

  // The background: a rectangle selects the bands in it; a click deselects.
  const additive = e.shiftKey;
  const before = selected(ctx.effectId);
  startPointerDrag(e, {
    threshold: 3,
    onMove: (ev) => {
      const p = ctx.local(ev);
      const rubber = { x0: x, y0: y, x1: p.x, y1: p.y };
      useEqUi.setState({ rubber: { effectId: ctx.effectId, ...rubber } });
      const inside = (proQOf(ctx.effectId)?.bands ?? []).filter((b) => {
        const d = dotOf(ctx.view(), b);
        return d.x >= Math.min(x, p.x) && d.x <= Math.max(x, p.x) && d.y >= Math.min(y, p.y) && d.y <= Math.max(y, p.y);
      });
      selectBands(ctx.effectId, [...new Set([...(additive ? before : []), ...inside.map((b) => b.id)])]);
    },
    onEnd: () => useEqUi.setState({ rubber: null }),
    onCancel: () => {
      useEqUi.setState({ rubber: null });
      selectBands(ctx.effectId, before);
    },
    onClick: () => {
      if (!additive) selectBands(ctx.effectId, []);
      // A permanent Spectrum Grab ends with a click on the background.
      if (useEqUi.getState().grab?.effectId === ctx.effectId) useEqUi.setState({ grab: null });
    },
  });
}

/** A double-click on the display: a new band on the background (Pro-Q's), or type a dot's values. */
export function displayDoubleClick(e: React.MouseEvent<HTMLElement>, ctx: DisplayContext, typeValues: (band: EqBand) => void) {
  const pq = proQOf(ctx.effectId);
  if (!pq) return;
  const { x, y } = ctx.local(e);
  const view = ctx.view();
  if (y > view.height - view.bottom) {
    // The frequency scale: all of it again.
    useEqUi.getState().setView(ctx.effectId, { low: FULL.low, high: FULL.high });
    return;
  }
  const band = bandAt(view, pq.bands, x, y);
  if (band) return typeValues(band);
  createAt(ctx, x, y, e.altKey);
}

/** A band where the pointer is: its shape from where (Pro-Q's), Alt: dynamic. */
function createAt(ctx: DisplayContext, x: number, y: number, dynamic: boolean) {
  const view = ctx.view();
  const shape = shapeForClick(view, x, y);
  const gainless = shape !== "bell";
  createBand(ctx.effectId, {
    shape,
    frequency: hzAt(view, x),
    gain: gainless ? 0 : clamp(Math.round(dbAt(view, y) * 100) / 100, -EQ_MAX_GAIN, EQ_MAX_GAIN),
    q: shape === "notch" ? 4 : 1,
    ...(dynamic && !gainless && { range: -6 }),
  });
}

/**
 * Drag a band's dot (and the rest of the selection with it): frequency across, gain (or a gainless band's
 * Q) up and down. Shift: fine; Alt: one axis, whichever moved most; Cmd/Ctrl: Q.
 */
function dragBand(e: ReactPointerEvent<HTMLElement>, ctx: DisplayContext, id: number, x: number, y: number, onClick?: () => void) {
  const pq = proQOf(ctx.effectId);
  if (!pq) return;
  const gesture = songGesture();
  let base: EqBand[] = pq.bands;
  let anchor = { x, y };
  let fine = false;
  startPointerDrag(e, {
    threshold: 2,
    cursor: CURSOR.grabPoint,
    onStart() {
      base = proQOf(ctx.effectId)?.bands ?? base;
      gesture.begin();
    },
    onMove(ev) {
      const view = ctx.view();
      const now = ctx.local(ev);
      // Shift: a tenth as far, from where it was pressed (switching mid-drag doesn't jump).
      if (ev.shiftKey !== fine) {
        fine = ev.shiftKey;
        anchor = now;
        base = proQOf(ctx.effectId)?.bands ?? base;
      }
      const scale = fine ? 0.1 : 1;
      let dx = (now.x - anchor.x) * scale;
      let dy = (now.y - anchor.y) * scale;
      if (ev.altKey) {
        if (Math.abs(now.x - anchor.x) > Math.abs(now.y - anchor.y)) dy = 0;
        else dx = 0;
      }
      const grabbed = base.find((b) => b.id === id);
      if (!grabbed) return;
      const ids = new Set(selected(ctx.effectId).includes(id) ? selected(ctx.effectId) : [id]);
      const from = dotOf(view, grabbed);
      const hz = dx === 0 ? null : hzAt(view, from.x + dx);
      const qMode = ev.metaKey || ev.ctrlKey || !hasGain(grabbed.shape);
      gesture.apply((s) =>
        editProQ(s, ctx.effectId, (p) => {
          let bands = dragBands(base, ids, id, hz, qMode || dy === 0 ? null : clamp(dbAt(view, from.y + dy), -EQ_MAX_GAIN, EQ_MAX_GAIN));
          if (qMode && dy !== 0) {
            // Up narrows: the grabbed band's Q follows the height, the others by as much.
            const was = hasGain(grabbed.shape) ? grabbed.q : qAtHeight(dbAt(view, from.y), view.range);
            const height = hasGain(grabbed.shape) ? qHeight(grabbed.q, view.range) + (-dy / (view.height / 2)) * view.range : dbAt(view, from.y + dy);
            const factor = clamp(qAtHeight(height, view.range), EQ_MIN_Q, EQ_MAX_Q) / was;
            bands = bands.map((b) => (ids.has(b.id) ? fitBand({ ...b, q: clamp(base.find((o) => o.id === b.id)!.q * factor, EQ_MIN_Q, EQ_MAX_Q) }) : b));
          }
          return { ...p, bands };
        }),
      );
    },
    onEnd: () => gesture.end(),
    onCancel: () => gesture.cancel(),
    onClick,
  });
}

/** A run of scrolls is one change (one undo step), ended once the wheel has been still a moment, as the app's knobs do. */
let wheel: { gesture: ReturnType<typeof songGesture>; settle: ReturnType<typeof setTimeout> } | null = null;
function wheelEdit(effectId: string, change: (pq: ProQ) => ProQ) {
  if (!wheel) {
    const gesture = songGesture();
    gesture.begin();
    wheel = { gesture, settle: setTimeout(() => {}, 0) };
  }
  clearTimeout(wheel.settle);
  wheel.settle = setTimeout(() => {
    wheel?.gesture.end();
    wheel = null;
  }, 400);
  wheel.gesture.apply((s) => editProQ(s, effectId, change));
}

/** The wheel over the display: Q (narrower up); Cmd/Ctrl: gain; Alt: the dynamic range. Shift: fine. */
export function displayWheel(e: WheelEvent, ctx: DisplayContext) {
  const pq = proQOf(ctx.effectId);
  if (!pq) return;
  const { x, y } = ctx.local(e);
  const view = ctx.view();
  const under = bandAt(view, pq.bands, x, y);
  const ids = under && !selected(ctx.effectId).includes(under.id) ? [under.id] : selected(ctx.effectId);
  if (!ids.length) return;
  e.preventDefault();
  const steps = -Math.sign(e.deltaY || e.deltaX) * (e.shiftKey ? 0.2 : 1);
  // (Alt: only shapes that can be dynamic; a band's range is how far its gain moves when loud.)
  if (e.altKey) wheelEdit(ctx.effectId, (p) => updateBandsBy(p, ids, (b) => ({ ...b, range: clamp(Math.round((b.range + steps * 0.5) * 100) / 100, -EQ_MAX_GAIN, EQ_MAX_GAIN) })));
  else if (e.metaKey || e.ctrlKey) wheelEdit(ctx.effectId, (p) => updateBandsBy(p, ids, (b) => (hasGain(b.shape) ? { ...b, gain: clamp(Math.round((b.gain + steps * 0.5) * 100) / 100, -EQ_MAX_GAIN, EQ_MAX_GAIN) } : b)));
  else wheelEdit(ctx.effectId, (p) => scaleQ(p, ids, 2 ** (steps / 8)));
}

const updateBandsBy = (pq: ProQ, ids: number[], change: (b: EqBand) => EqBand): ProQ => {
  const set = new Set(ids);
  let changed = false;
  const bands = pq.bands.map((b) => {
    if (!set.has(b.id)) return b;
    const next = fitBand(change(b));
    if (next !== b) changed = true;
    return next;
  });
  return changed ? { ...pq, bands } : pq;
};

/** The frequency scale: drag up or down to zoom where it was pressed, sideways to scroll. */
function scalePointerDown(e: ReactPointerEvent<HTMLElement>, ctx: DisplayContext) {
  const start = ctx.local(e);
  const hz = hzAt(ctx.view(), start.x);
  const from = { ...eqView(ctx.effectId) };
  startPointerDrag(e, {
    threshold: 2,
    cursor: CURSOR.move,
    onMove(ev) {
      const p = ctx.local(ev);
      const view = ctx.view();
      const zoom = zoomed(from, hz, 2 ** ((start.y - p.y) / 60));
      const moved = scrolled({ ...view, ...zoom }, p.x - start.x);
      useEqUi.getState().setView(ctx.effectId, moved);
    },
  });
}

/** Where a band's dot would be at a frequency, for keeping a dragged band under the pointer. */
export const dotX = (view: EqView, hz: number) => xOf(view, hz);
