/**
 * The Hue/Saturation window (docs/photo/hue-saturation.md): Photoshop's dialog (⌘U), over the canvas, which is its
 * preview. It edits a Hue/Saturation filter on a layer or a Hue/Saturation adjustment layer, new or there.
 *
 * As the Camera Raw window, it's one gesture: every change shows on the canvas at once and none is an undo step; OK
 * makes them one, Cancel or Escape puts things back (a new one is gone), ⌥ turns Cancel into Reset, Preview off (P)
 * shows the picture without it. An edit made elsewhere ends the gesture (keeping what was shown), and the window
 * closes with it.
 */
import { useEffect, useRef, useState } from "react";
import { findLayer } from "@shared/photo/edits";
import { Button } from "@/components/ui/button";
import { FloatingWindow } from "@/components/windows/floating-window";
import { targetEdit, targetEffect, targetParams, type ParamsSink } from "../effect-window";
import { photoGesture, usePhoto } from "../store";
import { type EffectTarget, usePhotoUi } from "../ui";
import { HUE_SATURATION } from "./actions";
import { HueSaturationControls } from "./controls";

/** Where it opens: inside the canvas's top-right corner, clear of the docked panels. */
function overTheCanvas() {
  const desk = document.querySelector('[data-desktop="photo"]')?.getBoundingClientRect();
  const canvas = document.querySelector("[data-photo-canvas]")?.getBoundingClientRect();
  const width = 320;
  const height = 400;
  if (!desk) return { x: 200, y: 40, width, height };
  const right = canvas ? canvas.right - desk.left : desk.width;
  const top = canvas ? Math.max(0, canvas.top - desk.top) : 0;
  return { x: Math.max(0, Math.round(right - width - 12)), y: Math.round(top + 12), width, height };
}

export function HueSaturationWindow({ target }: { target: EffectTarget }) {
  const [initial] = useState(overTheCanvas);
  const close = () => usePhotoUi.getState().setHueSaturation(null);
  const [session] = useState(() => {
    const doc = usePhoto.getState().history!.doc.doc;
    return { gesture: photoGesture(), base: targetParams(doc, target, HUE_SATURATION), baseDoc: doc };
  });
  const [draft, setDraft] = useState(session.base);
  const [preview, setPreview] = useState(true);
  const [alt, setAlt] = useState(false);
  const finished = useRef(false);
  const before = useRef<typeof draft | null>(null);
  const layerName = findLayer(session.baseDoc, target.layerId)?.name;
  const edit = (params: typeof draft | null) => targetEdit(HUE_SATURATION, target, params);

  // Another edit ended the gesture (or the layer went): the window goes with it.
  useEffect(
    () =>
      usePhoto.subscribe((state) => {
        if (finished.current) return;
        const doc = state.history?.doc.doc;
        if (!session.gesture.active || !doc || (!target.adding && !targetEffect(doc, target, HUE_SATURATION))) {
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
    };
  }, [session]);

  // The canvas follows the draft (or shows the picture without it, Preview off).
  useEffect(() => {
    if (session.gesture.active) session.gesture.apply(targetEdit(HUE_SATURATION, target, preview ? draft : target.adding ? null : session.base));
  }, [draft, preview, session, target]);

  // Enter is OK and P is Preview, outside its fields; ⌥ turns Cancel into Reset.
  const body = useRef<HTMLDivElement>(null);
  const keys = useRef({ ok: () => {}, preview: () => {} });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey);
      if (e.type !== "keydown") return;
      const win = body.current?.closest("[data-window]");
      const el = e.target as Element | null;
      if (!win || !el || !win.contains(el)) return;
      if (el.closest("input, select, textarea, button, [role=slider], [role=combobox], [role=option], [contenteditable]")) return;
      if (e.key === "Enter") keys.current.ok();
      else if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) keys.current.preview();
    };
    const blur = () => setAlt(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const sink: ParamsSink = {
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
    session.gesture.apply(edit(draft));
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
  keys.current = { ok, preview: () => setPreview((p) => !p) };

  return (
    <FloatingWindow
      id="hue-saturation"
      title={layerName ? `Hue/Saturation · ${layerName}` : "Hue/Saturation"}
      initial={initial}
      resizable={{ minWidth: 280, minHeight: 360 }}
      keepsKeys
      escapeCloses
      onClose={cancel}
    >
      <div ref={body} className="flex h-full min-h-0 flex-col text-sm" data-hue-saturation-window={target.filterId ? "filter" : "adjustment"}>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <HueSaturationControls params={draft} sink={sink} />
        </div>
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <label className="flex flex-1 items-center gap-1.5 text-xs" title="Show the picture with Hue/Saturation (P)">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--brand)]" />
            Preview
          </label>
          <Button size="sm" variant="outline" onClick={alt ? () => setDraft(session.base) : cancel}>
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
