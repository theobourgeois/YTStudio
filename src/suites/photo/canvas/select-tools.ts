/**
 * The selection tools on the canvas (docs/photo/selections.md), Photoshop's way: a press with Shift adds, with Alt
 * subtracts, with both intersects (else the options bar's mode). The Marquees drag a box (Shift after the press: a
 * square or circle; Alt after it: from the centre); the Lasso follows the pointer; the Polygonal Lasso clicks corners
 * (a double-click, a click on the first corner or Enter closes it; Backspace takes the last corner back; Escape drops
 * it); the Magic Wand clicks; Quick Selection paints, the selection growing to the photo's edges as it goes. What's
 * being made shows as ants of its own (`selectionDraft`) until it's let go: then it's one undo step.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { dabsAlong } from "@shared/photo/quick-select";
import { modeFor, rectSelection } from "@shared/photo/selection";
import { traceOutline } from "@shared/photo/selection-outline";
import { ellipseSelection, featherSelection, polygonSelection } from "@shared/photo/selection-shapes";
import type { PhotoSelection, SelectionMode } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type QuickSession, applySelection, quickSelectionResult, startQuickSelection, useSelectOptions, wandAt } from "../selecting";
import { currentDoc, photoGesture, usePhoto } from "../store";
import { type SelectionDraft, usePhotoUi } from "../ui";

type DocPoint = (clientX: number, clientY: number) => { x: number; y: number };

const options = () => useSelectOptions.getState();
const setDraft = (draft: SelectionDraft | null) => usePhotoUi.getState().setSelectionDraft(draft);

/** A shape drawn by a tool, feathered by the options bar's Feather, meeting the selection by `mode`. */
function finish(shape: PhotoSelection | null, mode: SelectionMode) {
  const doc = currentDoc();
  const feather = options().feather;
  applySelection(shape && feather > 0 && doc ? featherSelection(shape, feather, doc.canvas) : shape, mode);
}

/** The Rectangular and Elliptical Marquees. A click (no drag) in New mode deselects, as Photoshop's. */
export function selectBox(e: ReactPointerEvent, docPoint: DocPoint, shape: "rect" | "ellipse") {
  const doc = currentDoc();
  if (!doc) return;
  const mode = modeFor(e, options().mode);
  const start = docPoint(e.clientX, e.clientY);
  const boxOf = (ev: PointerEvent) => {
    const p = docPoint(ev.clientX, ev.clientY);
    let dx = p.x - start.x;
    let dy = p.y - start.y;
    // Shift and Alt pressed after the press constrain; held from it, they chose the mode.
    if (ev.shiftKey && !e.shiftKey) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * side;
      dy = Math.sign(dy || 1) * side;
    }
    const a = ev.altKey && !e.altKey ? { x: start.x - dx, y: start.y - dy } : start;
    const b = { x: start.x + dx, y: start.y + dy };
    const round = (q: { x: number; y: number }) => ({ x: Math.round(q.x), y: Math.round(q.y) });
    return { a: round(a), b: round(b) };
  };
  // A plain rectangle replacing the selection is the selection itself as it's dragged (exact, its own undo step).
  if (shape === "rect" && mode === "new" && options().feather === 0) {
    const gesture = photoGesture();
    startPointerDrag(e, {
      threshold: 2,
      cursor: "crosshair",
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const { a, b } = boxOf(ev);
        const selection = rectSelection(a, b, doc.canvas);
        gesture.applyState((s) => ({ ...s, selection }));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
      onClick: () => usePhoto.getState().select(null),
    });
    return;
  }
  let last: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  startPointerDrag(e, {
    threshold: 2,
    cursor: "crosshair",
    onMove: (ev) => {
      last = boxOf(ev);
      const { a, b } = last;
      setDraft({ kind: shape, box: { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) } });
    },
    onEnd: () => {
      setDraft(null);
      if (!last) return;
      const { a, b } = last;
      finish(shape === "rect" ? rectSelection(a, b, doc.canvas) : ellipseSelection(a, b, doc.canvas, options().antiAlias), mode);
    },
    onCancel: () => setDraft(null),
    onClick: () => mode === "new" && usePhoto.getState().select(null),
  });
}

/** The Lasso: the outline the pointer draws, closed back to where it started. */
export function lasso(e: ReactPointerEvent, docPoint: DocPoint) {
  const doc = currentDoc();
  if (!doc) return;
  const mode = modeFor(e, options().mode);
  const points = [docPoint(e.clientX, e.clientY)];
  startPointerDrag(e, {
    threshold: 2,
    cursor: "crosshair",
    onMove: (ev) => {
      const samples = ev.getCoalescedEvents?.() ?? [];
      for (const s of samples.length ? samples : [ev]) points.push(docPoint(s.clientX, s.clientY));
      setDraft({ kind: "path", points: [...points], next: points[0] });
    },
    onEnd: () => {
      setDraft(null);
      finish(polygonSelection(points, doc.canvas, options().antiAlias), mode);
    },
    onCancel: () => setDraft(null),
    onClick: () => mode === "new" && usePhoto.getState().select(null),
  });
}

/** The Polygonal Lasso's outline in progress (its corners are the draft's), and the mode it began with. */
let polygon: { mode: SelectionMode; lastClick: number } | null = null;

/** How near the first corner a click closes the outline, in CSS pixels. */
const CLOSE_CSS_PX = 6;

function polygonPoints(): { x: number; y: number }[] | null {
  const draft = usePhotoUi.getState().selectionDraft;
  return polygon && draft?.kind === "path" ? draft.points : null;
}

/** Closes the Polygonal Lasso's outline into a selection. */
export function closePolygon() {
  const points = polygonPoints();
  const doc = currentDoc();
  const mode = polygon?.mode ?? "new";
  polygon = null;
  setDraft(null);
  if (points && doc && points.length >= 3) finish(polygonSelection(points, doc.canvas, options().antiAlias), mode);
}

/** Drops the Polygonal Lasso's outline. */
export function cancelPolygon() {
  polygon = null;
  setDraft(null);
}

/** Whether a Polygonal Lasso outline is being drawn (its keys are Enter, Escape and Backspace then). */
export const drawingPolygon = () => polygonPoints() !== null;

/** Backspace: the last corner taken back (the outline dropped with its first). */
export function undoPolygonPoint() {
  const points = polygonPoints();
  if (!points) return;
  if (points.length <= 1) return cancelPolygon();
  setDraft({ kind: "path", points: points.slice(0, -1), next: null });
}

/** A click of the Polygonal Lasso: a corner (the first starts it). */
export function polygonClick(e: ReactPointerEvent, docPoint: DocPoint) {
  const p = docPoint(e.clientX, e.clientY);
  const points = polygonPoints();
  const now = performance.now();
  if (!points) {
    polygon = { mode: modeFor(e, options().mode), lastClick: now };
    setDraft({ kind: "path", points: [p], next: p });
    return;
  }
  const view = usePhotoUi.getState().view;
  const near = view ? (CLOSE_CSS_PX * devicePixelRatio) / view.zoom : 0;
  // A double-click: quick, and where the last corner went.
  const previous = points.at(-1)!;
  const doubled = now - polygon!.lastClick < 350 && Math.hypot(p.x - previous.x, p.y - previous.y) <= near;
  polygon!.lastClick = now;
  if (points.length >= 3 && (doubled || Math.hypot(p.x - points[0].x, p.y - points[0].y) <= near)) return closePolygon();
  if (doubled) return;
  setDraft({ kind: "path", points: [...points, p], next: p });
}

/** The pointer over the canvas while a Polygonal Lasso outline is drawn: its next side follows it. */
export function polygonHover(at: { x: number; y: number }) {
  const points = polygonPoints();
  if (points) setDraft({ kind: "path", points, next: at });
}

/** The Magic Wand's click. */
export async function wandClick(e: ReactPointerEvent, docPoint: DocPoint) {
  const at = docPoint(e.clientX, e.clientY);
  try {
    await wandAt(at, modeFor(e, options().mode));
  } catch (error) {
    toast.error("The Magic Wand couldn't read the photo", { description: errorMessage(error) });
  }
}

/** Shows ants every `stride` pixels of a 0/1 selection at a sample's size (a fair outline at speed). */
function quickLoops(selected: Uint8Array, width: number, height: number, scale: number): number[][] {
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / 1_000_000)));
  return traceOutline({ x: 0, y: 0, width: Math.ceil(width / stride), height: Math.ceil(height / stride), scale: stride / scale, inside: (i, j) => selected[j * stride * width + i * stride] > 0 });
}

/**
 * Quick Selection: paint, and the selection grows to what's painted's edges (Alt: shrinks). A stroke in New mode
 * starts a new selection, and the mode becomes Add, as Photoshop's does.
 */
export function quickSelect(e: ReactPointerEvent, docPoint: DocPoint) {
  const doc = currentDoc();
  if (!doc) return;
  const o = options();
  // Quick Selection adds or takes away; Intersect is Add's.
  const chosen = modeFor(e, o.mode);
  const mode = chosen === "intersect" ? "add" : chosen;
  const radius = o.quickSize / 2;
  const pending: { x: number; y: number }[] = [docPoint(e.clientX, e.clientY)];
  let last: { x: number; y: number } | null = null;
  let session: QuickSession | null = null;
  let frame = 0;
  let ended = false;
  let cancelled = false;
  const ready = startQuickSelection(doc, mode, radius, o.sampleAll).then((s) => void (session = s));
  const run = () => {
    frame = 0;
    if (!session || cancelled) return;
    const { q, scale } = session;
    const points = pending.splice(0).map((p) => ({ x: p.x * scale, y: p.y * scale }));
    if (!points.length) return;
    const path = last ? [last, ...points] : points;
    last = points.at(-1)!;
    if (q.paint(dabsAlong(path, Math.max(0.75, radius * scale)))) setDraft({ kind: "loops", loops: quickLoops(q.selected, q.width, q.height, scale) });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  void ready.then(schedule, (error: unknown) => {
    cancelled = true;
    setDraft(null);
    toast.error("Quick Selection couldn't read the photo", { description: errorMessage(error) });
  });
  const commit = async () => {
    if (ended) return;
    ended = true;
    await ready.catch(() => {});
    if (frame) cancelAnimationFrame(frame);
    run();
    setDraft(null);
    if (!session || cancelled || currentDoc() !== doc) return;
    const result = quickSelectionResult(session, o.autoEnhance);
    if (result === undefined) return;
    usePhoto.getState().select(result);
    // As Photoshop's: after a first stroke the tool adds.
    if (mode === "new") useSelectOptions.getState().set({ mode: "add" });
  };
  startPointerDrag(e, {
    threshold: 0,
    cursor: "none",
    onMove: (ev) => {
      const samples = ev.getCoalescedEvents?.() ?? [];
      for (const s of samples.length ? samples : [ev]) pending.push(docPoint(s.clientX, s.clientY));
      schedule();
    },
    onEnd: () => void commit(),
    onClick: () => void commit(),
    onCancel: () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      setDraft(null);
    },
  });
}
