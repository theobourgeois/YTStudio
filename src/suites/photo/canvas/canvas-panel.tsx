/**
 * The canvas (ux.md, "Workspace", "Selecting layers" and "Transform and view"): the document drawn by the WebGPU
 * renderer, the pasteboard around it, the selected layers' transform handles (one box around several), the Move
 * tool's picking (a click on nothing selects nothing, Shift adds, a drag from nothing draws a marquee), and the
 * tools' pointer handling. The renderer
 * draws in device pixels; the overlay and the pointer are in CSS pixels; `geometry.ts` converts.
 */
import { useStyleCanvasDrag } from "../layer-style/canvas-drag";
import { useCanvasPick } from "../camera-raw/canvas-pick";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { PiWarningCircle } from "react-icons/pi";
import { createId } from "@shared/ids";
import { duplicateLayers, moveLayersBy } from "@shared/photo/edits";
import { srgbToLinear } from "@shared/photo/colour";
import { fitView, panBy, viewToDoc, zoomAbout } from "@shared/photo/geometry";
import { contains } from "@shared/photo/layers";
import { type LayerTransform, type PhotoLayer, type PhotoProject, type PlacedLayer, isPlaced } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { liveRenderer, useRenderState } from "../live";
import { usePhotoPreferences } from "../preferences";
import { GpuUnavailableError } from "../render/gpu";
import type { PhotoRenderer } from "../render/renderer";
import { toast } from "sonner";
import { setMask } from "@shared/photo/edits";
import { paintTargetOf } from "../paint-target";
import { StrokeController } from "../painting";
import { clickLayer } from "../selection";
import { currentSelection, photoGesture, useLayerSize, usePhoto, usePhotoDoc } from "../store";
import { uploadsFor } from "../uploads";
import { BrushCursor, SelectionAnts, useCanvasPointer } from "./overlays";
import { ClippingOverlay } from "../camera-raw/histogram";
import { cancelPolygon, closePolygon, drawingPolygon, lasso, polygonClick, polygonHover, quickSelect, selectBox, undoPolygonPoint, wandClick } from "./select-tools";
import { SelectionMenu } from "./selection-menu";
import { useSelectOptions } from "../selecting";
import { contentBox, hitsContent } from "./content";
import { sizeOf } from "../tool-edits";
import { isSelectionTool, useActiveTool, usePhotoUi } from "../ui";
import { CanvasDriver } from "./driver";
import { resizeCursor, rotateCursor } from "./cursors";
import { type Frame, frameOf, touches } from "./frame";
import { activeGenerator, GeneratorHandles } from "./generator-handles";
import { HANDLES, type Handle, type SnapContext, handlePoint, movedWithSnap, outline, rotated, scaledWithSnap } from "./handles";
import { type Box, type Guide, snapTargets } from "./snap";

/** The driver of the canvas on screen (the bench and the keys reach it here). */
let driver: CanvasDriver | null = null;
export const canvasDriver = () => driver;

/** The canvas's box on the page while it's shown (where things dropped on it land). */
let stage: HTMLDivElement | null = null;

/** The document point under a point of the page, or null when it isn't over the canvas. */
export function canvasPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
  const view = usePhotoUi.getState().view;
  if (!stage || !view) return null;
  const r = stage.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  return viewToDoc(view, (clientX - r.left) * devicePixelRatio, (clientY - r.top) * devicePixelRatio);
}

/**
 * An element's background as linear light: painted into a 1×1 canvas so any colour syntax a theme uses (hex,
 * oklch, color-mix) comes out as sRGB bytes.
 */
function backgroundOf(element: HTMLElement): [number, number, number] {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  c.fillStyle = getComputedStyle(element).backgroundColor;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}

/** Fits the document in the canvas element's current size. */
export function fitToCanvas() {
  const { view } = usePhotoUi.getState();
  const doc = usePhoto.getState().history?.doc.doc;
  if (!view || !doc) return;
  usePhotoUi.getState().setView(fitView(doc.canvas, view.width, view.height, 24 * devicePixelRatio));
}

/** One document pixel to one device pixel, about the canvas's middle. */
export function actualPixels() {
  const { view } = usePhotoUi.getState();
  if (view) usePhotoUi.getState().setView(zoomAbout(view, view.width / 2, view.height / 2, 1 / view.zoom));
}

export function zoomBy(factor: number) {
  const { view } = usePhotoUi.getState();
  if (view) usePhotoUi.getState().setView(zoomAbout(view, view.width / 2, view.height / 2, factor));
}

export function CanvasPanel() {
  const holderRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<PhotoRenderer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const canvasWidth = usePhotoDoc((d) => d.canvas.width);
  const canvasHeight = usePhotoDoc((d) => d.canvas.height);
  const tool = useActiveTool();
  usePolygonKeys(tool === "polygonLasso");

  // The open photo's renderer, drawing on this canvas while it's shown.
  useEffect(() => {
    const pending = liveRenderer();
    if (!pending) return;
    let current: CanvasDriver | null = null;
    let themeObserver: MutationObserver | null = null;
    let cancelled = false;
    pending.then(
      (r) => {
        if (cancelled) return;
        r.attach(canvasRef.current!);
        // The pasteboard is the theme's stage, and follows the theme.
        const stage = () => {
          r.pasteboard = backgroundOf(panelRef.current!);
          current?.request("final");
        };
        stage();
        themeObserver = new MutationObserver(stage);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        current = driver = new CanvasDriver(r);
        setRenderer(r);
        current.request("final");
      },
      (error: unknown) => setFailure(error instanceof GpuUnavailableError ? error.message : `The GPU couldn't start: ${String(error)}`),
    );
    return () => {
      cancelled = true;
      themeObserver?.disconnect();
      current?.dispose();
      if (driver === current) driver = null;
    };
  }, []);

  // The canvas follows its box, in device pixels; the first size fits the document.
  useEffect(() => {
    const holder = holderRef.current!;
    stage = holder;
    const resize = () => {
      const r = holder.getBoundingClientRect();
      const width = Math.max(1, Math.round(r.width * devicePixelRatio));
      const height = Math.max(1, Math.round(r.height * devicePixelRatio));
      const { view, setView } = usePhotoUi.getState();
      const doc = usePhoto.getState().history?.doc.doc;
      if (!doc) return;
      if (!view) setView(fitView(doc.canvas, width, height, 24 * devicePixelRatio));
      else if (view.width !== width || view.height !== height) setView({ ...view, width, height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(holder);
    resize();
    return () => {
      observer.disconnect();
      if (stage === holder) stage = null;
    };
  }, []);

  // A canvas of another size (an image opened as it, a preset, undone) is fitted again.
  const sized = useRef(`${canvasWidth}x${canvasHeight}`);
  useEffect(() => {
    const key = `${canvasWidth}x${canvasHeight}`;
    if (sized.current === key) return;
    sized.current = key;
    fitToCanvas();
  }, [canvasWidth, canvasHeight]);

  // The wheel pans; with ⌘/Ctrl (a trackpad's pinch) or Alt it zooms about the pointer.
  useEffect(() => {
    const holder = holderRef.current!;
    const wheel = (e: WheelEvent) => {
      const { view, setView } = usePhotoUi.getState();
      if (!view) return;
      e.preventDefault();
      const dpr = devicePixelRatio;
      const r = holder.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.altKey ? 0.01 : 0.002));
        setView(zoomAbout(view, (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr, factor));
      } else setView(panBy(view, -e.deltaX * dpr, -e.deltaY * dpr));
    };
    holder.addEventListener("wheel", wheel, { passive: false });
    return () => holder.removeEventListener("wheel", wheel);
  }, []);

  const docPoint = (clientX: number, clientY: number) => {
    const view = usePhotoUi.getState().view!;
    const r = holderRef.current!.getBoundingClientRect();
    return viewToDoc(view, (clientX - r.left) * devicePixelRatio, (clientY - r.top) * devicePixelRatio);
  };

  const picking = useCanvasPick((s) => s.handler !== null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { view } = usePhotoUi.getState();
    const doc = usePhoto.getState().history?.doc.doc;
    if (!view || !doc) return;
    if (tool === "hand" || e.button === 1) return pan(e);
    // The right button opens the canvas's menu.
    if (e.button === 2) return;
    // A window asked for a point on the canvas (Camera Raw's white balance eyedropper): this press is it.
    const pick = useCanvasPick.getState().handler;
    if (pick && e.button === 0) {
      const p = docPoint(e.clientX, e.clientY);
      pick(p.x, p.y);
      return;
    }
    // The Layer Style window's page has a place on the canvas (a shadow, a gradient's centre): a drag moves it.
    const styleDrag = useStyleCanvasDrag.getState().handler;
    if (styleDrag && e.button === 0 && tool !== "zoom") {
      const from = docPoint(e.clientX, e.clientY);
      startPointerDrag(e, {
        threshold: 1,
        cursor: "move",
        onMove: (ev) => {
          const p = docPoint(ev.clientX, ev.clientY);
          styleDrag(p.x - from.x, p.y - from.y, false);
        },
        onEnd: () => styleDrag(0, 0, true),
      });
      return;
    }
    if (tool === "zoom") {
      const r = holderRef.current!.getBoundingClientRect();
      usePhotoUi.getState().setView(zoomAbout(view, (e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio, e.altKey ? 0.5 : 2));
      return;
    }
    if (tool === "marquee" || tool === "ellipse") return selectBox(e, docPoint, tool === "marquee" ? "rect" : "ellipse");
    if (tool === "lasso") return lasso(e, docPoint);
    if (tool === "polygonLasso") return polygonClick(e, docPoint);
    if (tool === "magicWand") return void wandClick(e, docPoint);
    if (tool === "quickSelect") return quickSelect(e, docPoint);
    if (tool === "brush" || tool === "eraser") return paint(e, tool === "eraser");
    // Move: with Auto-select (⌘ for the opposite), the layer under the pointer is picked first, as Photoshop's;
    // Shift adds it to the selection (or takes it out). A press on nothing (outside the selected layers' box)
    // selects nothing, or draws a marquee that selects the layers it touches. The drag moves the selected images.
    const at = docPoint(e.clientX, e.clientY);
    const ui = usePhotoUi.getState();
    const { assets } = usePhoto.getState();
    const sized = (l: PlacedLayer) => sizeOf(l, assets);
    const picking = autoSelects(e);
    const hit = picking ? layerAt(doc, at.x, at.y) : undefined;
    // One of several selected layers, pressed: they're all dragged, but a click selects it alone.
    let pickedOfSeveral: string | null = null;
    ui.hover(null);
    if (hit && e.shiftKey) {
      const next = clickLayer({ ids: ui.selectedLayerIds, active: ui.selectedLayerId }, doc.layers.map((l) => l.id), hit.id, { toggle: true });
      ui.setSelection(next.ids, next.active);
      if (!next.ids.includes(hit.id)) return;
    } else if (hit && !ui.selectedLayerIds.includes(hit.id)) ui.select(hit.id);
    else if (hit) pickedOfSeveral = hit.id;
    else if (!hit && activeGenerator()) {
      // A generator's content is everywhere: a drag where no layer is moves its handles together.
      return moveGenerators(e, ui.selectedLayerIds);
    } else if (!hit && picking) {
      const current = frameOf(doc.layers, ui.selectedLayerIds, sized);
      if (!current || !contains(current.t, current.size, at.x, at.y)) return marquee(e, at);
    }
    // Only images and pixel layers have a place to move (an adjustment changes everything below it).
    let frame = frameOf(doc.layers, usePhotoUi.getState().selectedLayerIds, sized);
    if (!frame) return;
    const gesture = photoGesture();
    const done = () => usePhotoUi.getState().setGuides([]);
    startPointerDrag(e, {
      threshold: 2,
      cursor: "move",
      onStart: () => {
        gesture.begin();
        // ⌥-drag moves copies, leaving the layers where they were (Photoshop's).
        if (!e.altKey || !frame) return;
        const copies = new Map(frame.ids.map((id) => [id, createId("layer")]));
        const ids = frame.ids;
        gesture.apply((d) => duplicateLayers(d, ids, (id) => copies.get(id)!));
        usePhotoUi.getState().setSelection([...copies.values()]);
        frame = frameOf(usePhoto.getState().history!.doc.doc.layers, [...copies.values()], sized) ?? frame;
      },
      onMove: (ev, travel) => {
        if (!frame) return;
        const f = frame;
        const z = usePhotoUi.getState().view!.zoom;
        const r = movedWithSnap(f.t, f.size, (travel.x * devicePixelRatio) / z, (travel.y * devicePixelRatio) / z, ev.shiftKey, snapContext(doc, f.ids, ev));
        usePhotoUi.getState().setGuides(r.guides);
        gesture.apply((d) => f.place(d, r.t));
      },
      onEnd: () => {
        done();
        gesture.end();
      },
      onCancel: () => {
        done();
        gesture.cancel();
      },
      onClick: () => {
        if (pickedOfSeveral) usePhotoUi.getState().select(pickedOfSeveral);
      },
    });
  };

  /** The Move tool on generators: their handles moved together by the drag, one undo step (Escape cancels). */
  const moveGenerators = (e: ReactPointerEvent<HTMLDivElement>, ids: readonly string[]) => {
    const base = usePhoto.getState().history!.doc.doc;
    const gesture = photoGesture();
    startPointerDrag(e, {
      threshold: 2,
      cursor: "move",
      onStart: () => gesture.begin(),
      onMove: (_ev, travel) => {
        const z = usePhotoUi.getState().view!.zoom;
        gesture.apply(() => moveLayersBy(base, ids, (travel.x * devicePixelRatio) / z, (travel.y * devicePixelRatio) / z));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };

  /**
   * A drag from where there's no layer: a marquee selecting every visible image it touches (Shift: added to the
   * selection). A click there selects nothing (Shift: keeps the selection).
   */
  const marquee = (e: ReactPointerEvent<HTMLDivElement>, start: { x: number; y: number }) => {
    const ui = usePhotoUi.getState();
    const kept = e.shiftKey ? ui.selectedLayerIds : [];
    const before = { ids: ui.selectedLayerIds, active: ui.selectedLayerId };
    const end = () => usePhotoUi.getState().setMarquee(null);
    startPointerDrag(e, {
      threshold: 3,
      onMove: (ev) => {
        const p = docPoint(ev.clientX, ev.clientY);
        const box: Box = { x0: Math.min(start.x, p.x), y0: Math.min(start.y, p.y), x1: Math.max(start.x, p.x), y1: Math.max(start.y, p.y) };
        usePhotoUi.getState().setMarquee(box);
        const doc = usePhoto.getState().history!.doc.doc;
        const { assets } = usePhoto.getState();
        const touched = doc.layers.flatMap((l) => {
          const size = isPlaced(l) && l.visible ? sizeOf(l, assets) : null;
          const content = size && isPlaced(l) ? contentBox(l, size, knownManifest) : null;
          return content && touches(box, content) ? [l.id] : [];
        });
        usePhotoUi.getState().setSelection([...kept, ...touched.filter((id) => !kept.includes(id))]);
      },
      onEnd: end,
      onCancel: () => {
        end();
        usePhotoUi.getState().setSelection(before.ids, before.active);
      },
      onClick: () => {
        if (!e.shiftKey) usePhotoUi.getState().select(null);
      },
    });
  };

  /**
   * The Brush and the Eraser (`erase`): paint the active layer's target (its pixels or its mask) along the pointer,
   * limited by the selection, as one undo step when it's let go; Escape drops it. An image asks first (a new paint
   * layer, or convert it to pixels); an adjustment paints its mask, given one.
   */
  const paint = (e: ReactPointerEvent<HTMLDivElement>, erase: boolean) => {
    const doc = usePhoto.getState().history!.doc.doc;
    const ui = usePhotoUi.getState();
    if (!renderer) return;
    const target = paintTargetOf(doc, ui.selectedLayerId, ui.target);
    if ("error" in target) return void toast.error(target.error);
    if ("choice" in target) return ui.setPaintChoice(target.choice);
    if (target.addMask) {
      usePhoto.getState().commit((d) => setMask(d, target.layerId, null));
      ui.setTarget("mask");
    }
    const stroke = new StrokeController(renderer, target.layerId, target.part, currentSelection(), erase);
    stroke.add([docPoint(e.clientX, e.clientY)]);
    startPointerDrag(e, {
      threshold: 0,
      onMove: (ev) => {
        // Every sample the pointer gave, not just the frame's last: fast strokes stay smooth.
        const samples = ev.getCoalescedEvents?.() ?? [];
        stroke.add((samples.length ? samples : [ev]).map((s) => docPoint(s.clientX, s.clientY)));
      },
      onEnd: () => void stroke.end(),
      onCancel: () => stroke.cancel(),
      onClick: () => void stroke.end(),
    });
  };

  // The layer a click would pick, outlined while the pointer is over it (Move, no button down); the brush's circle.
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const doc = usePhoto.getState().history?.doc.doc;
    if (!doc || !usePhotoUi.getState().view) return;
    const at = docPoint(e.clientX, e.clientY);
    useCanvasPointer.getState().set(at, e.altKey);
    if (tool === "polygonLasso") polygonHover(at);
    if (tool !== "move" || e.buttons !== 0) return;
    usePhotoUi.getState().hover(autoSelects(e) ? (layerAt(doc, at.x, at.y)?.id ?? null) : null);
  };

  const pan = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = usePhotoUi.getState().view!;
    startPointerDrag(e, {
      button: e.button === 1 ? 1 : 0,
      threshold: 0,
      cursor: "grabbing",
      onMove: (_ev, travel) => usePhotoUi.getState().setView(panBy(start, travel.x * devicePixelRatio, travel.y * devicePixelRatio)),
    });
  };

  return (
    <div ref={panelRef} className="relative flex min-h-0 flex-1 flex-col bg-stage" data-photo-canvas data-picking={picking || undefined}>
      <SelectionMenu tool={tool}>
      <div
        ref={holderRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden touch-none",
          picking
            ? "cursor-crosshair"
            : tool === "hand"
            ? "cursor-grab"
            : tool === "zoom"
              ? "cursor-zoom-in"
              : tool === "brush" || tool === "eraser" || tool === "quickSelect"
                ? "cursor-none"
                : isSelectionTool(tool)
                  ? "cursor-crosshair"
                  : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          usePhotoUi.getState().hover(null);
          useCanvasPointer.getState().set(null);
        }}
        data-tool={tool}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label="Photo canvas" />
        {renderer && <ClippingOverlay />}
        {renderer && tool === "move" && <HoverOutline />}
        {renderer && tool === "move" && <TransformOverlay docPoint={docPoint} />}
        {renderer && tool === "move" && <GeneratorHandles docPoint={docPoint} snap={(ev) => snapContext(usePhoto.getState().history!.doc.doc, [], ev)} />}
        {renderer && <SnapGuides />}
        {renderer && <Marquee />}
        {renderer && <SelectionAnts />}
        {renderer && (tool === "brush" || tool === "eraser") && <BrushCursor />}
        {renderer && tool === "quickSelect" && <QuickCursor />}
        {failure && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            <div className="flex max-w-sm flex-col items-center gap-2">
              <PiWarningCircle className="size-6" />
              <p>{failure}</p>
            </div>
          </div>
        )}
      </div>
      </SelectionMenu>
      <StatusBar renderer={renderer} />
    </div>
  );
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Quick Selection's brush: + while it adds, − while it takes away (Alt, or the Subtract mode). */
function QuickCursor() {
  const alt = useCanvasPointer((s) => s.alt);
  const mode = useSelectOptions((s) => s.mode);
  return <BrushCursor quick={alt || mode === "subtract" ? "subtract" : "add"} />;
}

/** The Polygonal Lasso's keys while its outline is drawn: Enter closes it, Escape drops it, Backspace takes a corner back. */
function usePolygonKeys(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      if (!drawingPolygon()) return;
      const act = e.key === "Enter" ? closePolygon : e.key === "Escape" ? cancelPolygon : e.key === "Backspace" || e.key === "Delete" ? undoPolygonPoint : null;
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    // Before the editor's own keys (Delete would delete layers).
    window.addEventListener("keydown", down, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      cancelPolygon();
    };
  }, [active]);
}

/** Whether a press picks the layer under it: Auto-Select (Settings › Photo), the opposite while ⌘ (Ctrl) is held. */
const autoSelects = (e: { metaKey: boolean; ctrlKey: boolean }) => usePhotoPreferences.getState().autoSelect !== (MAC ? e.metaKey : e.ctrlKey);

/** How near is near enough to snap: this many CSS pixels on screen, in document pixels. */
const SNAP_CSS_PX = 6;

/**
 * What a drag of the layers `moving` snaps to: the canvas and the other visible images' boxes. Null when Snap is
 * off (the header's magnet, ⇧⌘;) or Control is held (Photoshop's way to drag without snapping).
 */
function snapContext(doc: PhotoProject, moving: readonly string[], e: { ctrlKey: boolean }): SnapContext | null {
  const view = usePhotoUi.getState().view;
  if (!usePhotoPreferences.getState().snap || e.ctrlKey || !view) return null;
  const { assets } = usePhoto.getState();
  const others = doc.layers.flatMap((l) => {
    const size = isPlaced(l) && l.visible && !moving.includes(l.id) ? sizeOf(l, assets) : null;
    const box = size && isPlaced(l) ? contentBox(l, size, knownManifest) : null;
    return box ? [box] : [];
  });
  return { targets: snapTargets(doc.canvas, others), threshold: (SNAP_CSS_PX * devicePixelRatio) / view.zoom };
}

/** A surface's manifest if the tab knows it already (picking never waits for the server). */
function knownManifest(id: string) {
  const projectId = usePhoto.getState().projectId;
  return projectId ? uploadsFor(projectId).knownManifest(id) : null;
}

/** The topmost visible image or painted pixel layer under document point (x, y). */
function layerAt(doc: PhotoProject, x: number, y: number): PhotoLayer | undefined {
  const { assets } = usePhoto.getState();
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const size = sizeOf(l, assets);
    if (isPlaced(l) && l.visible && size && hitsContent(l, size, x, y, knownManifest)) return l;
  }
  return undefined;
}

/**
 * The selected images' box and handles: corners and edges scale, the stalk above rotates (ux.md). Several share one
 * box around them (each also outlined), carried together; edges show only when each is at a right angle.
 */
function TransformOverlay({ docPoint }: { docPoint: (x: number, y: number) => { x: number; y: number } }) {
  const view = usePhotoUi((s) => s.view);
  const ids = usePhotoUi((s) => s.selectedLayerIds);
  const layers = usePhotoDoc((d) => d.layers);
  const assets = usePhoto((s) => s.assets);
  const frame = useMemo(() => frameOf(layers, ids, (l) => sizeOf(l, assets)), [layers, ids, assets]);
  // While a handle is dragged, the box drawn is the dragged one (a turned box stays turned until it's let go).
  const [dragged, setDragged] = useState<{ t: LayerTransform; size: Frame["size"] } | null>(null);
  if (!view || !frame) return null;
  const dpr = devicePixelRatio;
  const css = (p: { x: number; y: number }) => ({ x: ((p.x - view.x) * view.zoom) / dpr, y: ((p.y - view.y) * view.zoom) / dpr });
  const shown = dragged ?? frame;
  const box = outline(shown.t, shown.size).map(css);
  const top = css(handlePoint(shown.t, shown.size, { u: 0.5, v: 0 }));
  const centre = css({ x: shown.t.x, y: shown.t.y });
  const up = { x: top.x - centre.x, y: top.y - centre.y };
  const length = Math.hypot(up.x, up.y) || 1;
  const knob = { x: top.x + (up.x / length) * 24, y: top.y + (up.y / length) * 24 };
  const several = frame.ids.length > 1;

  const drag = (e: ReactPointerEvent<SVGElement>, transform: (p: { x: number; y: number }, ev: PointerEvent) => { t: LayerTransform; guides: Guide[] }, cursor: string) => {
    e.stopPropagation();
    const gesture = photoGesture();
    const f = frame;
    const done = () => {
      usePhotoUi.getState().setGuides([]);
      setDragged(null);
    };
    startPointerDrag(e, {
      threshold: 0,
      cursor,
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const r = transform(docPoint(ev.clientX, ev.clientY), ev);
        usePhotoUi.getState().setGuides(r.guides);
        if (several) setDragged({ t: r.t, size: f.size });
        gesture.apply((d) => f.place(d, r.t));
      },
      onEnd: () => {
        done();
        gesture.end();
      },
      onCancel: () => {
        done();
        gesture.cancel();
      },
    });
  };
  const base = frame.t;
  const size = frame.size;
  /** Where a point is from the frame's centre on screen (degrees: 0 is right, 90 is down). */
  const angleOf = (p: { x: number; y: number }) => (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI;
  /** The way a handle pulls on screen: from the frame's centre out to it (turned and mirrored with the layer). */
  const cursorOf = (h: Handle) => resizeCursor(angleOf(css(handlePoint(shown.t, shown.size, h))));
  /** The rotate pointer bowed around a corner, as it's turned now (so it turns with the layer while dragged). */
  const rotateCursorOf = (h: Handle) => rotateCursor(angleOf(css(handlePoint(shown.t, shown.size, h))));
  const knobCursor = rotateCursor(angleOf(knob));
  const scaleFrom = (h: Handle) => (e: ReactPointerEvent<SVGElement>) =>
    drag(
      e,
      (p, ev) => {
        const doc = usePhoto.getState().history!.doc.doc;
        return scaledWithSnap(base, size, h, p, { free: ev.shiftKey && frame.stretches, fromCentre: ev.altKey }, snapContext(doc, frame.ids, ev));
      },
      cursorOf(h),
    );
  const rotate = (cursor: string) => (e: ReactPointerEvent<SVGElement>) => {
    const from = docPoint(e.clientX, e.clientY);
    drag(e, (p, ev) => ({ t: rotated(base, from, p, ev.shiftKey), guides: [] }), cursor);
  };
  const corners = HANDLES.filter((h) => h.u !== 0.5 && h.v !== 0.5);
  const handles = frame.stretches ? HANDLES : corners;

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-transform-overlay data-layers={frame.ids.length}>
      {several && <SelectedOutlines ids={frame.ids} />}
      <polygon points={box.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth={1} />
      {/* Just outside each corner a drag rotates, as Photoshop's (under the handles, so they win where they meet). */}
      {corners.map((h) => {
        const p = css(handlePoint(shown.t, shown.size, h));
        const cursor = rotateCursorOf(h);
        return <circle key={`r${h.u},${h.v}`} cx={p.x} cy={p.y} r={18} fill="transparent" className="pointer-events-auto" style={{ cursor }} onPointerDown={rotate(cursor)} data-rotate-zone={`${h.u},${h.v}`} />;
      })}
      <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} stroke="var(--brand)" strokeWidth={1} />
      <circle cx={knob.x} cy={knob.y} r={5} fill="white" stroke="var(--brand)" className="pointer-events-auto" style={{ cursor: knobCursor }} onPointerDown={rotate(knobCursor)} data-handle="rotate" />
      {handles.map((h) => {
        const p = css(handlePoint(shown.t, shown.size, h));
        return (
          <rect
            key={`${h.u},${h.v}`}
            x={p.x - 4}
            y={p.y - 4}
            width={8}
            height={8}
            fill="white"
            stroke="var(--brand)"
            className="pointer-events-auto"
            style={{ cursor: cursorOf(h) }}
            onPointerDown={scaleFrom(h)}
            data-handle={`${h.u},${h.v}`}
            data-cursor={cursorOf(h)}
          />
        );
      })}
    </svg>
  );
}

/** Each of several selected images' own outline, faint, inside their shared box. */
function SelectedOutlines({ ids }: { ids: readonly string[] }) {
  const view = usePhotoUi((s) => s.view);
  const layers = usePhotoDoc((d) => d.layers);
  const assets = usePhoto((s) => s.assets);
  if (!view) return null;
  const dpr = devicePixelRatio;
  return (
    <>
      {layers.map((l) => {
        const size = ids.includes(l.id) ? sizeOf(l, assets) : null;
        if (!size || !isPlaced(l)) return null;
        const points = outline(l.transform, size).map((p) => `${((p.x - view.x) * view.zoom) / dpr},${((p.y - view.y) * view.zoom) / dpr}`);
        return <polygon key={l.id} points={points.join(" ")} fill="none" stroke="var(--brand)" strokeOpacity={0.6} strokeDasharray="3 3" strokeWidth={1} data-selected-outline={l.id} />;
      })}
    </>
  );
}

/** The outline of the layer a click would pick (Photoshop's hover box), unless it's selected. */
function HoverOutline() {
  const view = usePhotoUi((s) => s.view);
  const hovered = usePhotoUi((s) => s.hoveredLayerId);
  const selected = usePhotoUi((s) => (hovered ? s.selectedLayerIds.includes(hovered) : false));
  const found = usePhotoDoc((d) => d.layers.find((l) => l.id === hovered));
  const layer = found && isPlaced(found) && !selected ? found : undefined;
  const imageSize = useLayerSize(layer?.kind === "image" ? layer.mediaId : undefined);
  const size = layer?.kind === "pixel" ? layer.size : imageSize;
  if (!view || !layer || !size) return null;
  const dpr = devicePixelRatio;
  const points = outline(layer.transform, size).map((p) => `${((p.x - view.x) * view.zoom) / dpr},${((p.y - view.y) * view.zoom) / dpr}`);
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-hover-outline={layer.id}>
      <polygon points={points.join(" ")} fill="none" stroke="var(--brand)" strokeWidth={1.5} />
    </svg>
  );
}

/** The marquee a drag from where there's no layer draws (the layers it touches are selected as it goes). */
function Marquee() {
  const view = usePhotoUi((s) => s.view);
  const box = usePhotoUi((s) => s.marquee);
  if (!view || !box) return null;
  const dpr = devicePixelRatio;
  const x = ((box.x0 - view.x) * view.zoom) / dpr;
  const y = ((box.y0 - view.y) * view.zoom) / dpr;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-marquee>
      <rect x={x} y={y} width={((box.x1 - box.x0) * view.zoom) / dpr} height={((box.y1 - box.y0) * view.zoom) / dpr} fill="var(--brand)" fillOpacity={0.08} stroke="var(--brand)" strokeWidth={1} />
    </svg>
  );
}

/** Smart guides: a magenta line for each alignment the moved or resized layer snapped to. */
function SnapGuides() {
  const view = usePhotoUi((s) => s.view);
  const guides = usePhotoUi((s) => s.guides);
  if (!view || guides.length === 0) return null;
  const dpr = devicePixelRatio;
  const x = (v: number) => ((v - view.x) * view.zoom) / dpr;
  const y = (v: number) => ((v - view.y) * view.zoom) / dpr;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-snap-guides={guides.length}>
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <line key={i} x1={x(g.at)} x2={x(g.at)} y1={y(g.from)} y2={y(g.to)} stroke="var(--snap-guide)" strokeWidth={1} data-guide={`x:${g.at}`} />
        ) : (
          <line key={i} x1={x(g.from)} x2={x(g.to)} y1={y(g.at)} y2={y(g.at)} stroke="var(--snap-guide)" strokeWidth={1} data-guide={`y:${g.at}`} />
        ),
      )}
    </svg>
  );
}

function StatusBar({ renderer }: { renderer: PhotoRenderer | null }) {
  const zoom = usePhotoUi((s) => s.view?.zoom ?? 1);
  const canvas = usePhotoDoc((d) => d.canvas);
  const layers = usePhotoDoc((d) => d.layers);
  const [, setTick] = useState(0);
  // The images' loading progress (the renderer says when it changes).
  useEffect(() => {
    if (!renderer) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [renderer]);
  const refining = useRenderState((s) => s.refine === "refining");
  const loading = renderer ? layers.flatMap((l) => (l.kind === "image" ? [renderer.sourceState(l.mediaId)] : [])).filter((s) => s.state === "loading") : [];
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-[11px] text-muted-foreground" data-photo-status>
      {/* 100% is one image pixel per screen pixel (ux.md, "Transform and view"). */}
      <span data-zoom>{Math.round(zoom * 1000) / 10}%</span>
      <span>
        {canvas.width} × {canvas.height} px
      </span>
      {loading.length > 0 && <span>Loading {loading.length === 1 ? "an image" : `${loading.length} images`}…</span>}
      {/* Below 100%, curves and the like show at the view's level first; the full-resolution result follows. */}
      <span className={cn("transition-opacity", refining ? "opacity-100" : "opacity-0")} data-refine={refining ? "refining" : "settled"} aria-live="polite">
        {refining ? "Refining…" : ""}
      </span>
    </div>
  );
}
