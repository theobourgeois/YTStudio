/**
 * The Camera Raw window (docs/photo/camera-raw.md, "The Camera Raw window"): Photoshop's Camera Raw Filter, a tall
 * window beside the canvas, which is its preview. It edits a Camera Raw filter on a layer or a Camera Raw adjustment
 * layer, new (Filter › Camera Raw Filter…, ⇧⌘A; Layers › New Adjustment Layer › Camera Raw…) or there.
 *
 * As the Layer Style window, it's one gesture: every change shows on the canvas at once and none is an undo step;
 * OK makes them one ("Camera Raw"), Cancel or Escape puts things back (a new one is gone), ⌥ turns Cancel into
 * Reset. Preview off (P) shows the picture without it; a section's eye, held, without that section. An edit made
 * elsewhere ends the gesture (keeping what was shown), and the window closes with it.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { findLayer } from "@shared/photo/edits";
import { neutralWhiteBalance } from "@shared/photo/effects/camera-raw/develop";
import { type CameraRawSection, sectionParams } from "@shared/photo/effects/camera-raw/index";
import { type EffectParamValue, type PhotoProject, hasContent } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { FloatingWindow } from "@/components/windows/floating-window";
import { liveRenderer } from "../live";
import { photoGesture, usePhoto } from "../store";
import { type CameraRawTarget, usePhotoUi } from "../ui";
import { cameraRawEdit, cameraRawOf, cameraRawParams } from "./actions";
import { useCanvasPick } from "./canvas-pick";
import { CameraRawSections, type CameraRawSink } from "./sections";

/** Where it opens: along the photo desktop's right edge, as tall as there's room for. */
function besideTheCanvas() {
  const desk = document.querySelector('[data-desktop="photo"]')?.getBoundingClientRect();
  const width = 340;
  if (!desk) return { x: 200, y: 40, width, height: 640 };
  return { x: Math.max(0, Math.round(desk.width - width - 16)), y: 12, width, height: Math.max(360, Math.round(desk.height - 24)) };
}

/** The parameters with a section's own back at their defaults (what its eye shows). */
function withoutSection(params: Record<string, EffectParamValue>, section: CameraRawSection): Record<string, EffectParamValue> {
  const out = { ...params };
  for (const spec of sectionParams(section)) out[spec.key] = structuredClone(spec.default) as EffectParamValue;
  return out;
}

/**
 * The picture at a document point as it is before this Camera Raw (straight linear sRGB, a 5 × 5 average): for a
 * filter, its layer alone with its filters before it; for an adjustment layer, everything below it.
 */
async function beforeAt(doc: PhotoProject, target: CameraRawTarget, x: number, y: number): Promise<[number, number, number] | null> {
  const renderer = liveRenderer();
  const layer = findLayer(doc, target.layerId);
  if (!renderer || !layer) return null;
  let source: PhotoProject;
  if (target.filterId !== null && hasContent(layer)) {
    const filters = layer.filters ?? [];
    const index = filters.findIndex((f) => f.id === target.filterId);
    source = { ...doc, canvas: { ...doc.canvas, background: null }, layers: [{ ...layer, opacity: 1, visible: true, filters: index < 0 ? filters : filters.slice(0, index) }] };
  } else {
    source = { ...doc, layers: doc.layers.slice(0, doc.layers.indexOf(layer)) };
  }
  const r = await renderer;
  const size = 5;
  const view = { zoom: 1, x: Math.round(x) - 2, y: Math.round(y) - 2, width: size, height: size };
  const { texture } = await r.renderView(source, view);
  const data = await r.readFloat(texture, size, size);
  texture.destroy();
  let [sr, sg, sb, sa] = [0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) {
    sr += data[i * 4];
    sg += data[i * 4 + 1];
    sb += data[i * 4 + 2];
    sa += data[i * 4 + 3];
  }
  return sa > 0 ? [sr / sa, sg / sa, sb / sa] : null;
}

export function CameraRawWindow({ target }: { target: CameraRawTarget }) {
  const [initial] = useState(besideTheCanvas);
  const close = () => usePhotoUi.getState().setCameraRaw(null);
  const [session] = useState(() => {
    const doc = usePhoto.getState().history!.doc.doc;
    return { gesture: photoGesture(), base: cameraRawParams(doc, target), baseDoc: doc };
  });
  const [draft, setDraft] = useState(session.base);
  const [preview, setPreview] = useState(true);
  const [hidden, setHidden] = useState<CameraRawSection | null>(null);
  const [alt, setAlt] = useState(false);
  const [picking, setPicking] = useState(false);
  const finished = useRef(false);
  const before = useRef<Record<string, EffectParamValue> | null>(null);
  const layerName = findLayer(session.baseDoc, target.layerId)?.name;

  // Another edit ended the gesture (or the layer went): the window goes with it.
  useEffect(
    () =>
      usePhoto.subscribe((state) => {
        if (finished.current) return;
        const doc = state.history?.doc.doc;
        if (!session.gesture.active || !doc || (!target.adding && !cameraRawOf(doc, target))) {
          finished.current = true;
          close();
        }
      }),
    [session, target],
  );

  // The gesture lasts while the window's open; closed any other way than OK, it's cancelled.
  useEffect(() => {
    session.gesture.begin();
    return () => {
      if (session.gesture.active) session.gesture.cancel();
      useCanvasPick.getState().set(null);
    };
  }, [session]);

  // What the canvas shows follows the draft (without a held section, or without it all with Preview off).
  useEffect(() => {
    if (!session.gesture.active) return;
    const shown = !preview ? (target.adding ? null : session.base) : hidden ? withoutSection(draft, hidden) : draft;
    session.gesture.apply(cameraRawEdit(target, shown));
  }, [draft, preview, hidden, session, target]);

  // ⌥ turns Cancel into Reset, as Photoshop's.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => setAlt(e.altKey);
    const blur = () => setAlt(false);
    window.addEventListener("keydown", keys);
    window.addEventListener("keyup", keys);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keyup", keys);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // The eyedropper: the next click on the canvas sets the white balance that makes it neutral.
  useEffect(() => {
    if (!picking) return;
    useCanvasPick.getState().set((x, y) => {
      setPicking(false);
      void beforeAt(session.baseDoc, target, x, y).then((rgb) => {
        if (rgb) setDraft((d) => ({ ...d, ...neutralWhiteBalance(rgb) }));
      });
    });
    return () => useCanvasPick.getState().set(null);
  }, [picking, session, target]);

  const sink: CameraRawSink = {
    begin: () => {
      before.current = draft;
    },
    apply: (patch) => setDraft((d) => ({ ...d, ...patch })),
    end: () => {
      before.current = null;
    },
    cancel: () => {
      if (before.current) setDraft(before.current);
      before.current = null;
    },
  };

  const ok = () => {
    finished.current = true;
    session.gesture.apply(cameraRawEdit(target, draft));
    session.gesture.end();
    const ui = usePhotoUi.getState();
    if (target.filterId) ui.selectFilter(target.layerId, target.filterId);
    else ui.select(target.layerId);
    close();
  };
  const cancel = () => {
    finished.current = true;
    session.gesture.cancel();
    close();
  };
  const reset = () => setDraft(session.base);

  return (
    <FloatingWindow
      id="camera-raw"
      title={layerName ? `Camera Raw · ${layerName}` : "Camera Raw"}
      initial={initial}
      resizable={{ minWidth: 300, minHeight: 360 }}
      keepsKeys
      escapeCloses
      onClose={cancel}
    >
      <div
        className="flex h-full min-h-0 flex-col text-sm"
        data-camera-raw-window={target.filterId ? "filter" : "adjustment"}
        onKeyDown={(e) => {
          const typing = (e.target as Element).closest("input, select, textarea, [role=slider], [role=menuitem], [contenteditable]");
          if (e.key === "Enter" && !typing) ok();
          if ((e.key === "p" || e.key === "P") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) setPreview((p) => !p);
        }}
      >
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <span className="flex-1 text-[13px] font-semibold">Edit</span>
          <Button
            size="sm"
            variant={draft.treatment === "bw" ? "secondary" : "outline"}
            className="h-6 px-2 text-xs"
            aria-pressed={draft.treatment === "bw"}
            onClick={() => setDraft((d) => ({ ...d, treatment: d.treatment === "bw" ? "color" : "bw" }))}
          >
            B&amp;W
          </Button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-3", !preview && "opacity-60")}>
          <CameraRawSections params={draft} sink={sink} onHide={setHidden} picking={picking} onPick={() => setPicking((p) => !p)} />
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <label className="flex flex-1 items-center gap-1.5 text-xs" title="Show the picture with Camera Raw (P)">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--brand)]" />
            Preview
          </label>
          <Button size="sm" variant="outline" onClick={alt ? reset : cancel}>
            {alt ? "Reset" : "Cancel"}
          </Button>
          <Button size="sm" onClick={ok} data-autofocus>
            OK
          </Button>
        </div>
      </div>
    </FloatingWindow>
  );
}
