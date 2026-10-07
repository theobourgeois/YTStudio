/**
 * The Type tool (T; docs/photo/tools/type.md): a click makes point text, a drag a paragraph box, a click on a text
 * layer's words edits it (Shift: new text even there), a press outside the text being typed commits it. The typing
 * itself is `type/editor.tsx`, the session `type/session.ts`, the options bar `type/options-bar.tsx`.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { apply, contains, invert, layerMatrix } from "@shared/photo/layers";
import { caretAt } from "@shared/photo/text";
import type { PhotoProject, TextLayer } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { currentDoc } from "../store";
import { layoutWithFonts, measurerFor } from "../text-measure";
import { usePhotoUi } from "../ui";
import type { DocPointOf, ToolKit } from "./kit";
import { TypeEditor } from "./type/editor";
import { TypeOptionsBar } from "./type/options-bar";
import { commitText, editTextLayer, startNewText, useTypeSession } from "./type/session";

/** A drag shorter than this (screen pixels) is a click: point text. */
const BOX_THRESHOLD = 4;

/** The topmost visible text layer whose frame is under document point (x, y). */
export function textLayerAt(doc: PhotoProject, x: number, y: number): TextLayer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.kind === "text" && l.visible && contains(l.transform, l.size, x, y)) return l;
  }
  return null;
}

/** The character a document point is nearest in a text layer (where a click puts the caret). */
function caretFor(layer: TextLayer, at: { x: number; y: number }): number {
  const p = apply(invert(layerMatrix(layer.transform, layer.size)), at.x, at.y);
  const layout = layoutWithFonts(layer);
  return caretAt(layer, layout, measurerFor(layer), p.x - layer.origin.x, p.y - layer.origin.y);
}

/** Edits a text layer's words with the caret where document point `at` is (a click with the Type tool, a double-click with the Move tool). */
export function editTextAt(layer: TextLayer, at: { x: number; y: number }) {
  editTextLayer(layer.id, { caret: caretFor(layer, at) });
}

function press(e: ReactPointerEvent<HTMLDivElement>, docPoint: DocPointOf) {
  const doc = currentDoc();
  if (!doc || e.button !== 0) return;
  // A press outside the text being typed commits it, and does nothing else (Photoshop's).
  if (useTypeSession.getState().editing) return commitText();
  const at = docPoint(e.clientX, e.clientY);
  const hit = e.shiftKey ? null : textLayerAt(doc, at.x, at.y);
  if (hit) {
    // Not the press's own default: it would take the focus from the field that's about to open.
    e.preventDefault();
    return editTextAt(hit, at);
  }
  const dpr = devicePixelRatio;
  const done = () => useTypeSession.setState({ draft: null });
  e.preventDefault();
  startPointerDrag(e, {
    threshold: BOX_THRESHOLD,
    cursor: "crosshair",
    onMove: (ev) => {
      const p = docPoint(ev.clientX, ev.clientY);
      useTypeSession.setState({ draft: { x0: Math.min(at.x, p.x), y0: Math.min(at.y, p.y), x1: Math.max(at.x, p.x), y1: Math.max(at.y, p.y) } });
    },
    onEnd: () => {
      const box = useTypeSession.getState().draft;
      done();
      const zoom = usePhotoUi.getState().view?.zoom ?? 1;
      if (!box || (box.x1 - box.x0) * zoom < BOX_THRESHOLD * dpr || (box.y1 - box.y0) * zoom < BOX_THRESHOLD * dpr) return void startNewText(at);
      startNewText({ x: Math.round(box.x0), y: Math.round(box.y0) }, { width: Math.round(box.x1 - box.x0), height: Math.round(box.y1 - box.y0) });
    },
    onCancel: done,
    onClick: () => void startNewText(at),
  });
}

/** What's drawn over the canvas: the paragraph box being dragged, and the text being typed. */
function Overlay({ docPoint }: { docPoint: DocPointOf }) {
  const draft = useTypeSession((s) => s.draft);
  const view = usePhotoUi((s) => s.view);
  const dpr = devicePixelRatio;
  return (
    <>
      {draft && view && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" data-type-draft>
          <rect
            x={((draft.x0 - view.x) * view.zoom) / dpr}
            y={((draft.y0 - view.y) * view.zoom) / dpr}
            width={((draft.x1 - draft.x0) * view.zoom) / dpr}
            height={((draft.y1 - draft.y0) * view.zoom) / dpr}
            fill="none"
            stroke="var(--brand)"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
        </svg>
      )}
      <TypeEditor docPoint={docPoint} />
    </>
  );
}

export const typeKit: ToolKit = { press, Overlay, Options: TypeOptionsBar, cursor: "cursor-text" };
