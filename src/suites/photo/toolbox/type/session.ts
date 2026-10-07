/**
 * Typing a text layer (docs/photo/tools/type.md, "The tool"): one session at a time, one undo step. Starting one
 * opens a gesture (a new layer is added in it); every keystroke and option changed while it lasts is an edit of that
 * gesture, drawn at once; committing ends it (an empty new layer is dropped: nothing happened; an edited one emptied
 * is deleted in the same step), cancelling puts everything back. Another tool, another layer selected or the photo
 * closing commits it.
 */
import { create } from "zustand";
import { createId } from "@shared/ids";
import { findLayer, removeLayer } from "@shared/photo/edits";
import { type TextPatch, addTextLayer, makeTextLayer, resizeTextBox, setText, setTexts } from "@shared/photo/text";
import type { TextLayer } from "@shared/photo/types";
import { useColours } from "../../colours";
import { type PhotoGesture, currentDoc, photoGesture, usePhoto } from "../../store";
import { frameText } from "../../text-measure";
import { usePhotoUi } from "../../ui";
import { useTypeOptions } from "./options";

/** Where the caret goes when editing starts: an offset in the words, or every word selected. */
export type CaretStart = number | "all" | "end";

interface TypeSession {
  /** The text layer being typed, or null. */
  editing: { layerId: string; isNew: boolean; caret: CaretStart } | null;
  /** A paragraph box being dragged out (document pixels), before it's made. */
  draft: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const useTypeSession = create<TypeSession>(() => ({ editing: null, draft: null }));

let gesture: PhotoGesture | null = null;

/** The gesture the session edits through, begun again if something else ended it (an edit from elsewhere). */
function live(): PhotoGesture {
  if (!gesture || !gesture.active) {
    gesture = photoGesture();
    gesture.begin();
  }
  return gesture;
}

/** The layer being typed, as the document has it now. */
export function editedLayer(): TextLayer | null {
  const id = useTypeSession.getState().editing?.layerId;
  const layer = id ? currentDoc()?.layers.find((l) => l.id === id) : undefined;
  return layer?.kind === "text" ? layer : null;
}

/**
 * New text where the Type tool was pressed: point text with its first baseline on `at`, or paragraph text in `box`
 * (document pixels), above the active layer, set as the options bar says, in the foreground colour.
 */
export function startNewText(at: { x: number; y: number }, box: { width: number; height: number } | null = null) {
  commitText();
  const o = useTypeOptions.getState();
  const layer = makeTextLayer({ id: createId("layer"), font: o.font, align: box || o.align !== "justify" ? o.align : "left", leading: o.leading, tracking: o.tracking, colour: useColours.getState().foreground, box, at }, frameText);
  const above = usePhotoUi.getState().selectedLayerId;
  gesture = photoGesture();
  gesture.begin();
  gesture.apply((d) => addTextLayer(d, layer, above));
  // Selected first: the session follows the selection, and this one is it.
  useTypeSession.setState({ editing: { layerId: layer.id, isNew: true, caret: 0 } });
  usePhotoUi.getState().select(layer.id);
  return layer.id;
}

/** Edits a text layer's words (the Type tool's click on them, a double-click on its T), with the Type tool. */
export function editTextLayer(layerId: string, { caret = "end" as CaretStart, selectAll = false } = {}) {
  const doc = currentDoc();
  const layer = doc ? findLayer(doc, layerId) : undefined;
  if (layer?.kind !== "text") return;
  if (useTypeSession.getState().editing?.layerId === layerId) return;
  commitText();
  const ui = usePhotoUi.getState();
  useTypeSession.setState({ editing: { layerId, isNew: false, caret: selectAll ? "all" : caret } });
  if (ui.tool !== "type") ui.setTool("type");
  if (ui.selectedLayerId !== layerId || ui.selectedLayerIds.length !== 1) ui.select(layerId);
  gesture = photoGesture();
  gesture.begin();
}

/** The words typed so far. */
export function typeText(text: string) {
  const id = useTypeSession.getState().editing?.layerId;
  if (id) live().apply((d) => setText(d, id, { text }, frameText));
}

/**
 * The options bar's (or Properties') setting: while typing, the layer typed; else every selected text layer (one undo
 * step), and with none of them what new text is made with.
 */
export function styleText(patch: TextPatch, layerIds: readonly string[] = selectedTextLayers()) {
  const { text: _, colour, box: __, ...defaults } = patch;
  const editing = useTypeSession.getState().editing;
  if (editing) live().apply((d) => setText(d, editing.layerId, patch, frameText));
  else if (layerIds.length && styling?.active) styling.apply((d) => setTexts(d, layerIds, patch, frameText));
  else if (layerIds.length) usePhoto.getState().commit((d) => setTexts(d, layerIds, patch, frameText));
  // With no text, the colour is the foreground colour (what new text takes).
  else if (colour) useColours.getState().set({ foreground: colour });
  // What's made next starts as this, as Photoshop's options bar keeps its last setting.
  useTypeOptions.getState().set(defaults);
}

let styling: PhotoGesture | null = null;

/**
 * A drag of an option (the size scrubbed, a colour picked) restyling selected text layers: one undo step from here
 * to `endStyling` (while typing, the session's own step already is).
 */
export function beginStyling() {
  if (useTypeSession.getState().editing) return;
  styling = photoGesture();
  styling.begin();
}

export function endStyling() {
  styling?.end();
  styling = null;
}

/** A paragraph box's handles, dragged while typing: `rect` in `from`'s frame (the layer when the drag began). */
export function resizeBox(from: TextLayer, rect: { x0: number; y0: number; x1: number; y1: number }) {
  live().apply((d) => resizeTextBox(d, from, rect, frameText));
}

/** The selected text layers (what the options bar restyles when nothing is being typed). */
export function selectedTextLayers(): string[] {
  const doc = currentDoc();
  if (!doc) return [];
  const ids = new Set(usePhotoUi.getState().selectedLayerIds);
  return doc.layers.filter((l) => l.kind === "text" && ids.has(l.id)).map((l) => l.id);
}

/** Ends the session, keeping what was typed (one undo step); an empty layer goes. */
export function commitText() {
  const editing = useTypeSession.getState().editing;
  if (!editing) return;
  const g = gesture;
  gesture = null;
  useTypeSession.setState({ editing: null });
  const layer = currentDoc()?.layers.find((l) => l.id === editing.layerId);
  if (!g) return;
  if (layer?.kind === "text" && layer.text === "") {
    if (editing.isNew) return g.cancel();
    if (!g.active) g.begin();
    g.apply((d) => removeLayer(d, layer.id));
  }
  g.end();
}

/** Ends the session, putting back what was there before it (the options bar's ✕). */
export function cancelText() {
  const g = gesture;
  gesture = null;
  useTypeSession.setState({ editing: null });
  g?.cancel();
}

// The session ends when the tool changes, another layer is selected, or the photo closes; it's forgotten when its
// layer is gone (undone elsewhere).
usePhotoUi.subscribe((state, prev) => {
  const editing = useTypeSession.getState().editing;
  if (!editing) return;
  const toolLeft = state.tool !== prev.tool && state.tool !== "type";
  const elsewhere = state.selectedLayerId !== prev.selectedLayerId && state.selectedLayerId !== editing.layerId;
  if (toolLeft || elsewhere) commitText();
});
usePhoto.subscribe((state, prev) => {
  const editing = useTypeSession.getState().editing;
  if (!editing) return;
  if (state.projectId !== prev.projectId) return void commitText();
  if (state.history && !state.history.doc.doc.layers.some((l) => l.id === editing.layerId)) {
    gesture = null;
    useTypeSession.setState({ editing: null });
  }
});
