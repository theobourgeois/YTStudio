/**
 * Photoshop's Edit commands on pixels, once (the keys, the Layers menu and the assistant run these): copy, cut and
 * paste (⌘C, ⌘X, ⌘V: pasted as a new layer where it was, in this photo or another), Layer via Copy and Layer via
 * Cut (⌘J, ⇧⌘J), and filling the selection with the foreground or background colour or clearing it (⌥⌫, ⌘⌫,
 * Delete). Each change to the photo is one undo step.
 *
 * A copy is what the active layer shows inside the selection (all of it with none), rendered into pixels as
 * Convert to Pixels does: an image layer's place is baked in, its mask isn't (Photoshop's). Cutting and filling act
 * on painted pixels or a mask, never on a placed image (which asks to be converted first).
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { addPixelLayer, findLayer, setMask } from "@shared/photo/edits";
import { allSelection } from "@shared/photo/selection";
import type { LayerTransform, PhotoProject, PhotoSelection, SurfaceId } from "@shared/photo/types";
import { strokeColour } from "./brush-options";
import { useColours } from "./colours";
import { liveRenderer } from "./live";
import { commitSurface, paintTargetOf } from "./paint-target";
import type { PhotoRenderer } from "./render/renderer";
import { currentDoc, currentSelection, usePhoto } from "./store";
import { type SurfaceUploads, uploadsFor } from "./uploads";
import { usePhotoUi } from "./ui";

/** What ⌘C / ⌘X put aside: pixels of a project, with where they were. */
interface PhotoClipboard {
  uploads: SurfaceUploads;
  surface: SurfaceId;
  size: { width: number; height: number };
  transform: LayerTransform;
}

let clipboard: PhotoClipboard | null = null;

/** Whether there's something to paste (from this tab's ⌘C or ⌘X). */
export const hasPhotoClipboard = () => clipboard !== null;

const open = () => {
  const { projectId } = usePhoto.getState();
  const doc = currentDoc();
  return projectId && doc ? { projectId, doc } : null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The live renderer, or a message for the user. */
async function rendererOrSay(): Promise<PhotoRenderer | null> {
  const pending = liveRenderer();
  if (!pending) return null;
  return pending;
}

/** The active layer's pixels inside `selection` (all of them with none), as pixels; null when it has none to give. */
async function copied(doc: PhotoProject, layerId: string, selection: PhotoSelection | null): Promise<Omit<PhotoClipboard, "uploads"> | { error: string }> {
  const layer = findLayer(doc, layerId);
  if (!layer) return { error: "Select a layer to copy from." };
  if (layer.kind === "adjustment") return { error: `"${layer.name}" is an adjustment layer: it has no pixels to copy.` };
  const renderer = await rendererOrSay();
  if (!renderer) return { error: "The photo isn't on the GPU yet." };
  const pixels = await renderer.rasterize(doc, layerId, { selection });
  if (!pixels.surface) return { error: "There's nothing there to copy: the selection is empty on that layer." };
  return { surface: pixels.surface, size: pixels.size, transform: pixels.transform };
}

/**
 * The painted pixels inside the selection cleared (or the whole surface with none), as a surface of the layer's
 * to commit: a cut's or Delete's. A placed image or an adjustment's content says why it can't.
 */
async function cleared(doc: PhotoProject, layerId: string, selection: PhotoSelection | null): Promise<{ id: SurfaceId } | { error: string }> {
  const layer = findLayer(doc, layerId);
  if (layer?.kind !== "pixel") return { error: layer?.kind === "image" ? `"${layer.name}" is a placed image: convert it to pixels first (right-click it in Layers › Convert to Pixels).` : "Only painted pixels can be cut." };
  const renderer = await rendererOrSay();
  if (!renderer) return { error: "The photo isn't on the GPU yet." };
  const id = await renderer.fillSelection(layerId, "content", [0, 0, 0, 0], selection ?? allSelection(doc.canvas));
  return id ? { id } : { error: "There's nothing there to cut." };
}

/** Puts system clipboard images behind ours: a paste after ⌘C here pastes this, not an image copied before. */
function claimSystemClipboard() {
  void navigator.clipboard?.writeText("").catch(() => {});
}

export const editActions = {
  /** ⌘C: what the active layer shows inside the selection, put aside to paste. */
  async copy(layerId: string | null = usePhotoUi.getState().selectedLayerId): Promise<boolean> {
    const o = open();
    if (!o || !layerId) return void toast.error("Select a layer to copy from."), false;
    const result = await copied(o.doc, layerId, currentSelection());
    if ("error" in result) return void toast.error(result.error), false;
    clipboard = { ...result, uploads: uploadsFor(o.projectId) };
    claimSystemClipboard();
    return true;
  },

  /** ⌘X: copied, then cleared from the layer's painted pixels (one undo step). */
  async cut(layerId: string | null = usePhotoUi.getState().selectedLayerId) {
    const o = open();
    if (!o || !layerId) return void toast.error("Select a layer to cut from.");
    const selection = currentSelection();
    const result = await copied(o.doc, layerId, selection);
    if ("error" in result) return void toast.error(result.error);
    const clear = await cleared(o.doc, layerId, selection);
    if ("error" in clear) return void toast.error(clear.error);
    clipboard = { ...result, uploads: uploadsFor(o.projectId) };
    claimSystemClipboard();
    usePhoto.getState().commit(commitSurface(layerId, "content", clear.id));
  },

  /** ⌘V: what was copied as a new layer above the active one, where it was (from another photo too). */
  async paste(): Promise<string | null> {
    const o = open();
    if (!o || !clipboard) return null;
    const here = uploadsFor(o.projectId);
    try {
      await here.importFrom(clipboard.uploads, clipboard.surface);
    } catch (error) {
      toast.error("Couldn't paste", { description: errorMessage(error) });
      return null;
    }
    const id = createId("layer");
    const { surface, size, transform } = clipboard;
    usePhoto.getState().commit((d) => addPixelLayer(d, { id, surface, size, transform }, usePhotoUi.getState().selectedLayerId));
    usePhotoUi.getState().select(id);
    return id;
  },

  /**
   * ⌘J with a selection: what it covers of the active layer as a new layer right above it (Photoshop's Layer via
   * Copy); `cut` (⇧⌘J) also clears it from the layer's painted pixels. One undo step. Returns the new layer's id.
   */
  async layerVia(cut: boolean, layerId: string | null = usePhotoUi.getState().selectedLayerId): Promise<string | null> {
    const o = open();
    if (!o || !layerId) return void toast.error("Select a layer first."), null;
    const selection = currentSelection();
    const result = await copied(o.doc, layerId, selection);
    if ("error" in result) return void toast.error(result.error), null;
    let clearedId: SurfaceId | null = null;
    if (cut) {
      const clear = await cleared(o.doc, layerId, selection);
      if ("error" in clear) return void toast.error(clear.error), null;
      clearedId = clear.id;
    }
    const id = createId("layer");
    usePhoto.getState().commit((d) => {
      const withCut = clearedId ? commitSurface(layerId, "content", clearedId)(d) : d;
      return addPixelLayer(withCut, { id, surface: result.surface, size: result.size, transform: result.transform }, layerId);
    });
    usePhotoUi.getState().select(id);
    return id;
  },

  /**
   * Fills the selection (all of the layer with none) on the active layer's target with `colour` ("#rrggbb"), or
   * clears it (null: painted pixels go transparent; a mask takes the background colour, as Photoshop's Delete
   * does). An image asks first; an adjustment fills its mask (given one). One undo step.
   */
  async fill(colour: string | null, layerId: string | null = usePhotoUi.getState().selectedLayerId) {
    const o = open();
    if (!o) return;
    const ui = usePhotoUi.getState();
    const target = paintTargetOf(o.doc, layerId, layerId === ui.selectedLayerId ? ui.target : "content");
    if ("error" in target) return void toast.error(target.error);
    if ("choice" in target) return ui.setPaintChoice(target.choice);
    if (target.addMask) usePhoto.getState().commit((d) => setMask(d, target.layerId, null));
    const renderer = await rendererOrSay();
    if (!renderer) return;
    const value = colour ?? (target.part === "mask" ? useColours.getState().background : null);
    const premultiplied = value ? strokeColour(value, target.part === "mask" ? "mask" : "pixels") : [0, 0, 0, 0];
    const selection = currentSelection() ?? allSelection(o.doc.canvas);
    // A mask made a moment ago reaches the GPU a moment later.
    let id: SurfaceId | null = null;
    for (let i = 0; i < 100 && id === null; i++) {
      id = await renderer.fillSelection(target.layerId, target.part, premultiplied, selection);
      if (id === null) await sleep(20);
    }
    if (id) usePhoto.getState().commit(commitSurface(target.layerId, target.part, id));
  },
};
