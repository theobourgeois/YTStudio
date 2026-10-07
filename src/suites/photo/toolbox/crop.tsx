/**
 * The Crop tool (C; docs/photo/tools/crop.md): the canvas with no layer selected (Photoshop's), the selected image or
 * pixel layer otherwise (Figma's and Canva's). The box (`crop-state.ts`) is drawn in its target's frame with eight
 * handles and the crop shield outside it; a drag inside moves it, outside draws a new one, the handles resize it
 * (Shift keeps its proportions, Alt works from its centre); Enter, ✓ or a double-click crops, Escape or ✕ puts it
 * back. The maths is `crop-geometry.ts`.
 */
import { type PointerEvent as ReactPointerEvent, useEffect } from "react";
import { cn } from "cn";
import { PiArrowsLeftRight, PiCheck, PiX } from "react-icons/pi";
import type { CropRect } from "@shared/photo/crop";
import { apply, invert } from "@shared/photo/layers";
import { type PhotoProject, isCroppable } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { isHtmlElement } from "@/lib/window-events";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contentBox, hitsContent } from "../canvas/content";
import { resizeCursor } from "../canvas/cursors";
import { type Box, snapMove, snapPoint, snapTargets } from "../canvas/snap";
import { usePhotoPreferences } from "../preferences";
import { currentDoc, usePhoto, usePhotoDoc } from "../store";
import { sizeOf } from "../tool-edits";
import { usePhotoUi } from "../ui";
import { uploadsFor } from "../uploads";
import { CROP_HANDLES, type CropHandle, type Point, drawCrop, handleAt, inside, moveCrop, resizeCrop } from "./crop-geometry";
import { CROP_RATIOS, type CropFrame, type CropRatioId, cancelCrop, chooseRatio, clearCrop, commitCrop, committedBox, croppableLayer, frameRatio, isPending, swapSides, syncCrop, useCrop } from "./crop-state";
import type { DocPointOf, ToolKit } from "./kit";

type Press = ReactPointerEvent<Element>;

/** Two clicks this close (ms) inside the box are a double-click: it crops. */
const DOUBLE_CLICK_MS = 400;
let lastClick = 0;

/** A document point in the frame's units. */
const toFrame = (frame: CropFrame, p: Point) => apply(invert(frame.matrix), p.x, p.y);
const toDoc = (frame: CropFrame, p: Point) => apply(frame.matrix, p.x, p.y);

/** How near is near enough to snap: this many CSS pixels on screen, in document pixels (as the Move tool's). */
const SNAP_CSS_PX = 6;

/** What a canvas box's edges snap to (the canvas's edges and centre, the visible layers'), or null (Snap off, Control). */
function snapping(doc: PhotoProject, e: { ctrlKey: boolean }) {
  const view = usePhotoUi.getState().view;
  if (!usePhotoPreferences.getState().snap || e.ctrlKey || !view) return null;
  const { assets, projectId } = usePhoto.getState();
  const known = (id: string) => (projectId ? uploadsFor(projectId).knownManifest(id) : null);
  const others = doc.layers.flatMap((l) => {
    const size = isCroppable(l) && l.visible ? sizeOf(l, assets) : null;
    const box = size && isCroppable(l) ? contentBox(l, size, known) : null;
    return box ? [box] : [];
  });
  return { targets: snapTargets(doc.canvas, others), threshold: (SNAP_CSS_PX * devicePixelRatio) / view.zoom };
}

const toBox = (r: CropRect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height });

/** The topmost visible image or pixel layer showing at a document point. */
function layerAt(doc: PhotoProject, p: Point) {
  const { assets, projectId } = usePhoto.getState();
  const known = (id: string) => (projectId ? uploadsFor(projectId).knownManifest(id) : null);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const size = sizeOf(l, assets);
    if (isCroppable(l) && l.visible && size && hitsContent(l, size, p.x, p.y, known)) return l;
  }
  return null;
}

/**
 * A click (no drag): a second one inside the box crops; with nothing pending, a click where no layer shows deselects
 * (the canvas is cropped), and one on another layer while a layer is cropped crops that one (ours, so the Layers panel
 * isn't needed to switch).
 */
function clicked(at: Point, insideBox: boolean) {
  const now = performance.now();
  const double = insideBox && now - lastClick < DOUBLE_CLICK_MS;
  lastClick = insideBox ? now : 0;
  if (double && isPending()) return void commitCrop();
  if (isPending()) return;
  const doc = currentDoc();
  if (!doc) return;
  const ui = usePhotoUi.getState();
  const frame = useCrop.getState().frame;
  // On the layer being cropped (shown whole), nothing changes.
  if (frame?.target.kind === "layer" && frame.bounds && inside(frame.bounds, toFrame(frame, at))) return;
  // What's past the canvas isn't shown: the pasteboard is nothing's.
  const onCanvas = at.x >= 0 && at.y >= 0 && at.x <= doc.canvas.width && at.y <= doc.canvas.height;
  const hit = onCanvas ? layerAt(doc, at) : null;
  if (!hit) {
    if (ui.selectedLayerIds.length) ui.select(null);
    return;
  }
  // While a layer is cropped, another one clicked is cropped instead; the canvas's crop picks nothing (Photoshop's).
  if (frame?.target.kind === "layer") ui.select(hit.id);
}

/** A drag that changes the box from `start` (the box at the press) as the pointer goes; one box, no document edit. */
function dragBox(e: Press, docPoint: DocPointOf, change: (p: Point, ev: PointerEvent, travel: Point) => CropRect, cursor: string, insideBox: boolean) {
  const s = useCrop.getState();
  if (!s.frame || !s.box || s.committing) return;
  const at = docPoint(e.clientX, e.clientY);
  const before = s.box;
  const done = () => {
    useCrop.setState({ dragging: false });
    usePhotoUi.getState().setGuides([]);
  };
  startPointerDrag(e, {
    threshold: 2,
    cursor,
    onStart: () => useCrop.setState({ dragging: true }),
    onMove: (ev, travel) => useCrop.setState({ box: change(docPoint(ev.clientX, ev.clientY), ev, travel) }),
    onEnd: done,
    onCancel: () => {
      done();
      useCrop.setState({ box: before });
    },
    onClick: () => clicked(at, insideBox),
  });
}

/** The ratio a drag keeps: the chosen one, else the box's own with Shift on a corner. */
const dragRatio = (ev: { shiftKey: boolean }, start: CropRect, corner: boolean) => frameRatio() ?? (ev.shiftKey && corner ? start.width / start.height : null);

/** A handle dragged: the box resized (canvas: its edges snapping). */
function resizeFrom(e: Press, h: CropHandle, docPoint: DocPointOf, cursor: string) {
  e.stopPropagation();
  const { frame, box: start } = useCrop.getState();
  if (!frame || !start) return;
  const doc = currentDoc()!;
  const corner = h.u !== 0.5 && h.v !== 0.5;
  dragBox(
    e,
    docPoint,
    (p, ev) => {
      const ratio = dragRatio(ev, start, corner);
      let at = p;
      // The canvas's box snaps its dragged handle (when no ratio holds it).
      if (frame.target.kind === "canvas" && !ratio) {
        const snap = snapping(doc, ev);
        if (snap) {
          const s = snapPoint(p, snap.targets, snap.threshold);
          at = { x: h.u === 0.5 ? p.x : s.x, y: h.v === 0.5 ? p.y : s.y };
          usePhotoUi.getState().setGuides(s.guides.filter((g) => (g.axis === "x" ? h.u !== 0.5 : h.v !== 0.5)));
        }
      }
      return resizeCrop(start, h, toFrame(frame, at), { ratio, fromCentre: ev.altKey, bounds: frame.bounds });
    },
    cursor,
    false,
  );
}

/** A press inside the box: it moves (snapping on the canvas). */
function moveFrom(e: Press, docPoint: DocPointOf) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const { frame, box: start } = useCrop.getState();
  if (!frame || !start) return;
  const doc = currentDoc()!;
  const from = toFrame(frame, docPoint(e.clientX, e.clientY));
  dragBox(
    e,
    docPoint,
    (p, ev) => {
      const q = toFrame(frame, p);
      let dx = q.x - from.x;
      let dy = q.y - from.y;
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const moved = moveCrop(start, dx, dy, frame.bounds);
      const snap = frame.target.kind === "canvas" ? snapping(doc, ev) : null;
      if (!snap) return moved;
      const s = snapMove(toBox(moved), snap.targets, snap.threshold);
      usePhotoUi.getState().setGuides(s.guides);
      return { ...moved, x: moved.x + s.dx, y: moved.y + s.dy };
    },
    "move",
    true,
  );
}

/** A press outside the box (the canvas's own handler): a new box drawn from it. */
function press(e: Press, docPoint: DocPointOf) {
  syncCrop();
  const { frame } = useCrop.getState();
  if (!frame) return;
  const a = toFrame(frame, docPoint(e.clientX, e.clientY));
  const doc = currentDoc()!;
  dragBox(
    e,
    docPoint,
    (p, ev) => {
      let at = p;
      const ratio = frameRatio() ?? (ev.shiftKey ? 1 : null);
      if (frame.target.kind === "canvas" && !ratio) {
        const snap = snapping(doc, ev);
        if (snap) {
          const s = snapPoint(p, snap.targets, snap.threshold);
          at = s;
          usePhotoUi.getState().setGuides(s.guides);
        }
      }
      return drawCrop(a, toFrame(frame, at), { ratio, fromCentre: ev.altKey, bounds: frame.bounds });
    },
    "crosshair",
    false,
  );
}

/** Enter crops, Escape puts the box back (or, with nothing pending, deselects the layers), X swaps the ratio's sides. */
function useCropKeys() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || useCrop.getState().dragging || isTextField(e.target)) return;
      if (e.key === "Enter") {
        if (!isPending()) return;
        void commitCrop();
      } else if (e.key === "Escape") {
        if (!cancelCrop()) return;
      } else if ((e.key === "x" || e.key === "X") && !e.shiftKey && frameRatio() !== null) swapSides();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Before the editor's own keys (X swaps the colours, Escape and Enter mean other things).
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, []);
}

const isTextField = (target: EventTarget | null) => isHtmlElement(target) && (target.tagName === "TEXTAREA" || target.tagName === "SELECT" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox") || target.isContentEditable);

/** The box over the canvas: the crop shield outside it, its outline, the thirds while it's dragged, its handles. */
function CropOverlay({ docPoint }: { docPoint: DocPointOf }) {
  useCropKeys();
  const view = usePhotoUi((s) => s.view);
  const box = useCrop((s) => s.box);
  const frame = useCrop((s) => s.frame);
  const dragging = useCrop((s) => s.dragging);
  const committing = useCrop((s) => s.committing);
  // The box is for the photo as it is now.
  useEffect(() => syncCrop(), []);
  if (!view || !box || !frame) return null;
  const dpr = devicePixelRatio;
  const css = (p: Point) => ({ x: ((p.x - view.x) * view.zoom) / dpr, y: ((p.y - view.y) * view.zoom) / dpr });
  const screen = (p: Point) => css(toDoc(frame, p));
  const quad = (r: CropRect) => [screen({ x: r.x, y: r.y }), screen({ x: r.x + r.width, y: r.y }), screen({ x: r.x + r.width, y: r.y + r.height }), screen({ x: r.x, y: r.y + r.height })];
  const path = (pts: Point[]) => `M${pts.map((p) => `${p.x},${p.y}`).join("L")}Z`;
  const corners = quad(box);
  // The shield: everything outside the box (a layer's: its parts outside it, the rest of the canvas as it is).
  const outer = frame.target.kind === "canvas" ? [{ x: -1e5, y: -1e5 }, { x: 1e5, y: -1e5 }, { x: 1e5, y: 1e5 }, { x: -1e5, y: 1e5 }] : quad(frame.bounds!);
  const centre = screen({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const angleOf = (p: Point) => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  const thirds = [1 / 3, 2 / 3].flatMap((f) => [
    [screen({ x: box.x + f * box.width, y: box.y }), screen({ x: box.x + f * box.width, y: box.y + box.height })],
    [screen({ x: box.x, y: box.y + f * box.height }), screen({ x: box.x + box.width, y: box.y + f * box.height })],
  ]);
  const size = committedBox(box, frame);
  // A handle's marks: a corner's two arms along its edges, an edge's bar along it (Photoshop's).
  const marks = (h: CropHandle) => {
    const at = screen(handleAt(box, h));
    const along = (to: CropHandle, length: number) => {
      const q = screen(handleAt(box, to));
      const d = Math.hypot(q.x - at.x, q.y - at.y) || 1;
      const l = Math.min(length, d / 3);
      return { x: at.x + ((q.x - at.x) / d) * l, y: at.y + ((q.y - at.y) / d) * l };
    };
    if (h.u !== 0.5 && h.v !== 0.5) {
      const a = along({ u: (1 - h.u) as CropHandle["u"], v: h.v }, 14);
      const b = along({ u: h.u, v: (1 - h.v) as CropHandle["v"] }, 14);
      return `M${a.x},${a.y}L${at.x},${at.y}L${b.x},${b.y}`;
    }
    const a = along(h.u === 0.5 ? { u: 0, v: h.v } : { u: h.u, v: 0 }, 9);
    const b = along(h.u === 0.5 ? { u: 1, v: h.v } : { u: h.u, v: 1 }, 9);
    return `M${a.x},${a.y}L${b.x},${b.y}`;
  };
  // The size while dragged, by the box's lowest right corner on screen (Photoshop's readout).
  const label = { x: Math.max(...corners.map((p) => p.x)) + 8, y: Math.max(...corners.map((p) => p.y)) + 8 };
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-crop-overlay={frame.target.kind} data-crop-box={size ? `${size.x},${size.y},${size.width},${size.height}` : ""} data-crop-pending={isPending() || undefined}>
        <path d={`${path(outer)}${path(corners)}`} fillRule="evenodd" fill="var(--stage)" fillOpacity={0.75} data-crop-shield />
        {frame.target.kind === "layer" && <path d={path(quad(frame.bounds!))} fill="none" stroke="white" strokeOpacity={0.5} strokeDasharray="4 3" strokeWidth={1} />}
        {/* The box's inside: a drag there moves it. */}
        <path d={path(corners)} fill="transparent" className="pointer-events-auto" style={{ cursor: committing ? "progress" : "move" }} onPointerDown={(e) => moveFrom(e, docPoint)} data-crop-inside />
        {dragging && thirds.map(([a, b], i) => <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.6} strokeWidth={1} data-crop-grid />)}
        <path d={path(corners)} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={3} />
        <path d={path(corners)} fill="none" stroke="white" strokeWidth={1} />
        {CROP_HANDLES.map((h) => {
          const at = screen(handleAt(box, h));
          const cursor = resizeCursor(angleOf(at));
          return (
            <g key={`${h.u},${h.v}`}>
              <path d={marks(h)} fill="none" stroke="black" strokeOpacity={0.35} strokeWidth={5} strokeLinecap="square" />
              <path d={marks(h)} fill="none" stroke="white" strokeWidth={3} strokeLinecap="square" />
              <circle cx={at.x} cy={at.y} r={9} fill="transparent" className="pointer-events-auto" style={{ cursor }} onPointerDown={(e) => resizeFrom(e, h, docPoint, cursor)} data-crop-handle={`${h.u},${h.v}`} />
            </g>
          );
        })}
      </svg>
      {dragging && size && (
        <div className="floating pointer-events-none absolute rounded-sm bg-popover px-1.5 py-0.5 text-[11px] text-popover-foreground tabular-nums" style={{ left: label.x, top: label.y }} data-crop-size>
          W {Math.round(size.width)} px · H {Math.round(size.height)} px
        </div>
      )}
    </>
  );
}

/** A number of the ratio's fields (W, H): empty is no ratio. */
function RatioField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      placeholder={label}
      value={value ?? ""}
      onChange={(e) => {
        const v = Number(e.target.value);
        onChange(e.target.value.trim() && Number.isFinite(v) && v > 0 ? v : null);
      }}
      className="h-6 w-12 rounded-sm border border-line bg-sunken px-1.5 text-center text-xs tabular-nums outline-none focus-visible:border-brand"
      data-crop-ratio-field={label}
    />
  );
}

/** The options bar: what's cropped (Canvas | Layer), the ratio and its fields, ⇄, Clear, the box's size, ✕ and ✓. */
function CropOptions() {
  const frame = useCrop((s) => s.frame);
  const box = useCrop((s) => s.box);
  const ratio = useCrop((s) => s.ratio);
  const custom = useCrop((s) => s.custom);
  const committing = useCrop((s) => s.committing);
  // The layer that can be cropped: follows the selected layers, the photo and its images' sizes.
  usePhotoUi((s) => s.selectedLayerIds);
  usePhotoDoc((d) => d.layers);
  usePhoto((s) => s.assets);
  const doc = currentDoc();
  const layer = doc ? croppableLayer(doc) : null;
  const pending = useCrop((s) => isPending(s));
  const fields = ratio === "custom" ? custom : (() => {
    const entry = CROP_RATIOS.find((r) => r.id === ratio);
    return entry && "w" in entry ? { w: entry.w, h: entry.h } : { w: null, h: null };
  })();
  const setField = (patch: Partial<typeof custom>) => {
    const next = { ...fields, ...patch };
    chooseRatio(next.w || next.h ? "custom" : "free", next);
  };
  const size = box && frame ? committedBox(box, frame) : null;
  const target = frame?.target.kind ?? "canvas";
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="crop">
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={target}
        onValueChange={(v) => v && useCrop.setState({ canvasChosen: v === "canvas" })}
        aria-label="What to crop"
        data-crop-target={target}
      >
        <ToggleGroupItem value="canvas" data-crop-choice="canvas" className="px-2.5 text-xs" title="Crop the canvas (Photoshop's Crop)">
          Canvas
        </ToggleGroupItem>
        <ToggleGroupItem value="layer" data-crop-choice="layer" disabled={!layer} className="max-w-48 px-2.5 text-xs" title={layer ? `Crop “${layer.name}” alone` : "Select an image or pixel layer to crop it alone"}>
          <span className="truncate">{layer ? layer.name : "Layer"}</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <Select value={ratio} onValueChange={(v) => chooseRatio(v as CropRatioId)}>
        <SelectTrigger size="sm" className="h-6 w-40 text-xs" aria-label="Ratio" data-crop-ratio>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CROP_RATIOS.map((r) => (
            <SelectItem key={r.id} value={r.id} disabled={r.id === "custom"}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="flex items-center gap-1">
        <RatioField label="W" value={fields.w} onChange={(w) => setField({ w })} />
        <Button variant="ghost" size="icon-sm" aria-label="Swap width and height (X)" title="Swap width and height (X)" onClick={swapSides} data-crop-swap>
          <PiArrowsLeftRight className="size-4" />
        </Button>
        <RatioField label="H" value={fields.h} onChange={(h) => setField({ h })} />
      </span>
      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={clearCrop} title="No ratio, and the box over the whole" data-crop-clear>
        Clear
      </Button>
      {size && (
        <span className="tabular-nums text-muted-foreground" data-crop-size-label>
          {Math.round(size.width)} × {Math.round(size.height)} px
        </span>
      )}
      <span className="flex items-center">
        <Button variant="ghost" size="icon-sm" aria-label="Cancel the crop (Escape)" title="Cancel the crop (Escape)" disabled={!pending || committing} onClick={() => cancelCrop()} data-crop-cancel>
          <PiX className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Crop (Enter)" title="Crop (Enter)" disabled={!pending || committing} onClick={() => void commitCrop()} className={cn(pending && "text-brand")} data-crop-commit>
          <PiCheck className="size-4" />
        </Button>
      </span>
    </div>
  );
}

export const cropKit: ToolKit = {
  Options: CropOptions,
  Overlay: CropOverlay,
  press: (e, docPoint) => {
    if (e.button !== 0) return;
    const { frame, box } = useCrop.getState();
    // A press inside the box (the overlay's inside takes most) moves it; anywhere else draws a new one.
    if (frame && box && inside(box, toFrame(frame, docPoint(e.clientX, e.clientY)))) return moveFrom(e, docPoint);
    press(e, docPoint);
  },
  cursor: "cursor-crosshair",
};
