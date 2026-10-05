/**
 * The canvas (ux.md, "Workspace" and "Transform and view"): the document drawn by the WebGPU renderer, the
 * pasteboard around it, the selected layer's transform handles, and the tools' pointer handling. The renderer
 * draws in device pixels; the overlay and the pointer are in CSS pixels; `geometry.ts` converts.
 */
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { PiImage, PiWarningCircle } from "react-icons/pi";
import { setTransform } from "@shared/photo/edits";
import { srgbToLinear } from "@shared/photo/colour";
import { fitView, panBy, viewToDoc, zoomAbout } from "@shared/photo/geometry";
import { contains } from "@shared/photo/layers";
import { CANVAS_PRESETS, type PhotoLayer, type PhotoProject } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { startPointerDrag } from "@/lib/pointer-drag";
import { liveRenderer } from "../live";
import { GpuUnavailableError } from "../render/gpu";
import type { PhotoRenderer } from "../render/renderer";
import { photoGesture, useLayerSize, usePhoto, usePhotoDoc } from "../store";
import { sizeOf } from "../tool-edits";
import { useActiveTool, usePhotoUi } from "../ui";
import { CanvasDriver } from "./driver";
import { HANDLES, type Handle, handlePoint, moved, outline, rotated, scaled } from "./handles";

/** The driver of the canvas on screen (the bench and the keys reach it here). */
let driver: CanvasDriver | null = null;
export const canvasDriver = () => driver;

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
  const doc = usePhoto.getState().history?.doc;
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
  const empty = usePhotoDoc((d) => d.layers.length === 0);
  const tool = useActiveTool();

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
    const resize = () => {
      const r = holder.getBoundingClientRect();
      const width = Math.max(1, Math.round(r.width * devicePixelRatio));
      const height = Math.max(1, Math.round(r.height * devicePixelRatio));
      const { view, setView } = usePhotoUi.getState();
      const doc = usePhoto.getState().history?.doc;
      if (!doc) return;
      if (!view) setView(fitView(doc.canvas, width, height, 24 * devicePixelRatio));
      else if (view.width !== width || view.height !== height) setView({ ...view, width, height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(holder);
    resize();
    return () => observer.disconnect();
  }, []);

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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { view } = usePhotoUi.getState();
    const doc = usePhoto.getState().history?.doc;
    if (!view || !doc) return;
    if (tool === "hand" || e.button === 1) return pan(e);
    if (tool === "zoom") {
      const r = holderRef.current!.getBoundingClientRect();
      usePhotoUi.getState().setView(zoomAbout(view, (e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio, e.altKey ? 0.5 : 2));
      return;
    }
    // Move: with Auto-select, the layer under the pointer is picked first; the drag moves the selected one.
    const at = docPoint(e.clientX, e.clientY);
    if (usePhotoUi.getState().autoSelect) usePhotoUi.getState().select(layerAt(doc, at.x, at.y)?.id ?? null);
    const id = usePhotoUi.getState().selectedLayerId;
    const layer = id ? doc.layers.find((l) => l.id === id) : undefined;
    if (!layer) return;
    const base = layer.transform;
    const gesture = photoGesture();
    startPointerDrag(e, {
      threshold: 2,
      cursor: "move",
      onStart: () => gesture.begin(),
      onMove: (ev, travel) => {
        const z = usePhotoUi.getState().view!.zoom;
        const t = moved(base, (travel.x * devicePixelRatio) / z, (travel.y * devicePixelRatio) / z, ev.shiftKey);
        gesture.apply((d) => setTransform(d, layer.id, t));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
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
    <div ref={panelRef} className="relative flex min-h-0 flex-1 flex-col bg-stage" data-photo-canvas>
      <div
        ref={holderRef}
        className={cn("relative min-h-0 flex-1 overflow-hidden touch-none", tool === "hand" ? "cursor-grab" : tool === "zoom" ? "cursor-zoom-in" : "cursor-default")}
        onPointerDown={onPointerDown}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label="Photo canvas" />
        {renderer && tool === "move" && <TransformOverlay docPoint={docPoint} />}
        {failure && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">
            <div className="flex max-w-sm flex-col items-center gap-2">
              <PiWarningCircle className="size-6" />
              <p>{failure}</p>
            </div>
          </div>
        )}
        {empty && !failure && <StartCard />}
      </div>
      <StatusBar renderer={renderer} />
    </div>
  );
}

/** The topmost visible layer whose pixels are under document point (x, y). */
function layerAt(doc: PhotoProject, x: number, y: number): PhotoLayer | undefined {
  const { assets } = usePhoto.getState();
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    const size = sizeOf(l, assets);
    if (l.visible && size && contains(l.transform, size, x, y)) return l;
  }
  return undefined;
}

/** The selected layer's box and handles: corners and edges scale, the stalk above rotates (ux.md). */
function TransformOverlay({ docPoint }: { docPoint: (x: number, y: number) => { x: number; y: number } }) {
  const view = usePhotoUi((s) => s.view);
  const selected = usePhotoUi((s) => s.selectedLayerId);
  const layer = usePhotoDoc((d) => d.layers.find((l) => l.id === selected));
  const size = useLayerSize(layer?.mediaId);
  if (!view || !layer || !size) return null;
  const dpr = devicePixelRatio;
  const css = (p: { x: number; y: number }) => ({ x: ((p.x - view.x) * view.zoom) / dpr, y: ((p.y - view.y) * view.zoom) / dpr });
  const box = outline(layer.transform, size).map(css);
  const top = css(handlePoint(layer.transform, size, { u: 0.5, v: 0 }));
  const centre = css({ x: layer.transform.x, y: layer.transform.y });
  const up = { x: top.x - centre.x, y: top.y - centre.y };
  const length = Math.hypot(up.x, up.y) || 1;
  const knob = { x: top.x + (up.x / length) * 24, y: top.y + (up.y / length) * 24 };

  const drag = (e: ReactPointerEvent<SVGElement>, transform: (p: { x: number; y: number }, ev: PointerEvent) => ReturnType<typeof moved>, cursor: string) => {
    e.stopPropagation();
    const gesture = photoGesture();
    startPointerDrag(e, {
      threshold: 0,
      cursor,
      onStart: () => gesture.begin(),
      onMove: (ev) => {
        const t = transform(docPoint(ev.clientX, ev.clientY), ev);
        gesture.apply((d) => setTransform(d, layer.id, t));
      },
      onEnd: () => gesture.end(),
      onCancel: () => gesture.cancel(),
    });
  };
  const base = layer.transform;
  const scaleFrom = (h: Handle) => (e: ReactPointerEvent<SVGElement>) =>
    drag(e, (p, ev) => scaled(base, size, h, p, { free: ev.shiftKey, fromCentre: ev.altKey }), "nwse-resize");
  const rotate = (e: ReactPointerEvent<SVGElement>) => {
    const from = docPoint(e.clientX, e.clientY);
    drag(e, (p, ev) => rotated(base, from, p, ev.shiftKey), "grabbing");
  };

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-transform-overlay>
      <polygon points={box.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--brand)" strokeWidth={1} />
      <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} stroke="var(--brand)" strokeWidth={1} />
      <circle cx={knob.x} cy={knob.y} r={5} fill="white" stroke="var(--brand)" className="pointer-events-auto cursor-grab" onPointerDown={rotate} data-handle="rotate" />
      {HANDLES.map((h) => {
        const p = css(handlePoint(base, size, h));
        return (
          <rect
            key={`${h.u},${h.v}`}
            x={p.x - 4}
            y={p.y - 4}
            width={8}
            height={8}
            fill="white"
            stroke="var(--brand)"
            className="pointer-events-auto cursor-crosshair"
            onPointerDown={scaleFrom(h)}
            data-handle={`${h.u},${h.v}`}
          />
        );
      })}
    </svg>
  );
}

/** An empty photo: open an image as the canvas, or pick a size (ux.md, "New photo"). */
function StartCard() {
  const input = useRef<HTMLInputElement>(null);
  const canvas = usePhotoDoc((d) => d.canvas);
  const choose = (width: number, height: number) =>
    usePhoto.getState().commit((d) => (d.canvas.width === width && d.canvas.height === height ? d : { ...d, canvas: { ...d.canvas, width, height } }));
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="floating flex w-96 flex-col gap-3 rounded-lg bg-surface-1 p-4 text-sm" data-start-card onPointerDown={(e) => e.stopPropagation()}>
        <p className="font-medium">Start with an image, or a size</p>
        <Button size="sm" onClick={() => input.current?.click()}>
          <PiImage /> Open an image…
        </Button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-start-input
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void usePhoto.getState().placeFiles(files, { asCanvas: true }).then(() => fitToCanvas());
          }}
        />
        <div className="grid grid-cols-2 gap-1.5">
          {CANVAS_PRESETS.map((p) => (
            <Button
              key={p.id}
              size="sm"
              className="justify-between"
              variant={canvas.width === p.width && canvas.height === p.height ? "secondary" : "outline"}
              onClick={() => {
                choose(p.width, p.height);
                requestAnimationFrame(fitToCanvas);
              }}
            >
              {p.label}
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {p.width}×{p.height}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
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
  const loading = renderer ? layers.map((l) => renderer.sourceState(l.mediaId)).filter((s) => s.state === "loading") : [];
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-[11px] text-muted-foreground" data-photo-status>
      {/* 100% is one image pixel per screen pixel (ux.md, "Transform and view"). */}
      <span data-zoom>{Math.round(zoom * 1000) / 10}%</span>
      <span>
        {canvas.width} × {canvas.height} px
      </span>
      {loading.length > 0 && <span>Loading {loading.length === 1 ? "an image" : `${loading.length} images`}…</span>}
    </div>
  );
}
