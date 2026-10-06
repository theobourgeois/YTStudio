/**
 * What the Layers commands do, once: the keys (`keys.ts`), the Layers panel's footer and its menu all run these.
 * They act on every selected layer, as Photoshop's do.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { stepBlendMode } from "@shared/photo/blending";
import { addPixelLayer, arrangeLayers, duplicateLayers, findLayer, removeLayers, removeMask, replaceLayer, setLayerBlending, setMask, shiftLayers } from "@shared/photo/edits";
import type { BlendMode } from "@shared/photo/types";
import { liveRenderer } from "./live";
import { mergeLayers } from "./merge";
import { type LayerSelection, allLayers, edgeLayer, inStackOrder, stepLayer } from "./selection";
import { currentDoc, currentSelection, usePhoto } from "./store";
import { usePhotoUi } from "./ui";

const order = () => usePhoto.getState().history?.doc.doc.layers.map((l) => l.id) ?? [];

/** The selected layers, bottom first. */
export const selectedInOrder = () => inStackOrder(usePhotoUi.getState().selectedLayerIds, order());

const current = (): LayerSelection => ({ ids: usePhotoUi.getState().selectedLayerIds, active: usePhotoUi.getState().selectedLayerId });
const apply = (sel: LayerSelection) => usePhotoUi.getState().setSelection(sel.ids, sel.active);

export const layerActions = {
  delete() {
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => removeLayers(d, ids));
  },
  /** ⌘J: a copy of each above it, the copies selected. */
  duplicate() {
    const ids = selectedInOrder();
    if (!ids.length) return;
    const copies = new Map(ids.map((id) => [id, createId("layer")]));
    usePhoto.getState().commit((d) => duplicateLayers(d, ids, (id) => copies.get(id)!));
    const active = usePhotoUi.getState().selectedLayerId;
    usePhotoUi.getState().setSelection([...copies.values()], active ? copies.get(active) : null);
  },
  shift(direction: 1 | -1) {
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => shiftLayers(d, ids, direction));
  },
  arrange(to: "top" | "bottom") {
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => arrangeLayers(d, ids, to));
  },
  merge: () => mergeLayers("auto"),
  mergeVisible: () => mergeLayers("visible"),
  selectAll: () => apply(allLayers(current(), order())),
  deselect: () => usePhotoUi.getState().select(null),
  /** The selected layers' blend mode (one undo step). */
  setBlendMode: (blend: BlendMode) => {
    const ids = usePhotoUi.getState().selectedLayerIds;
    if (ids.length) usePhoto.getState().commit((d) => setLayerBlending(d, ids, { blend }));
  },
  /** The active layer's next or previous mode, on every selected layer (Photoshop's ⇧+ / ⇧−). */
  stepBlendMode: (direction: 1 | -1) => {
    const { selectedLayerId } = usePhotoUi.getState();
    const layer = selectedLayerId ? findLayer(usePhoto.getState().history!.doc.doc, selectedLayerId) : undefined;
    if (layer) layerActions.setBlendMode(stepBlendMode(layer.blend ?? "normal", direction));
  },
  /** The Layer Style window on Blending Options, for `layerId` (default: the active layer), which it selects. */
  blendingOptions: (layerId?: string) => {
    const ui = usePhotoUi.getState();
    const id = layerId ?? ui.selectedLayerId;
    if (!id) return;
    if (ui.selectedLayerId !== id) ui.select(id);
    ui.setLayerStyle(id);
  },
  step: (direction: 1 | -1, add: boolean) => apply(stepLayer(current(), order(), direction, add)),
  edge: (to: "top" | "bottom", add: boolean) => apply(edgeLayer(current(), order(), to, add)),

  /** ⇧⌘N: an empty pixel layer above the active one (or on top), selected. */
  newLayer(above: string | null = usePhotoUi.getState().selectedLayerId) {
    const id = createId("layer");
    usePhoto.getState().commit((d) => addPixelLayer(d, { id }, above));
    usePhotoUi.getState().select(id);
    return id;
  },

  /**
   * Adds a mask to the active layer (Photoshop's Add Layer Mask button): from the selection when there is one
   * (Reveal Selection), else revealing everything. The mask is then what the brush paints.
   */
  async addMask(layerId: string | null = usePhotoUi.getState().selectedLayerId, { replace = false } = {}) {
    const doc = currentDoc();
    const layer = doc && layerId ? findLayer(doc, layerId) : undefined;
    if (!doc || !layer) return void toast.error("Select a layer to add a mask to.");
    if (layer.mask && !replace) return void toast.message(`"${layer.name}" has a mask already.`);
    const selection = currentSelection();
    let surface = null;
    if (selection) {
      try {
        const renderer = await liveRenderer();
        surface = renderer ? await renderer.maskFromSelection(doc, layer.id, selection) : null;
      } catch (error) {
        return void toast.error("Couldn't make the mask", { description: errorMessage(error) });
      }
    }
    usePhoto.getState().commit((d) => (findLayer(d, layer.id) ? setMask(d, layer.id, surface) : d));
    if (usePhotoUi.getState().selectedLayerId === layer.id) usePhotoUi.getState().setTarget("mask");
  },

  deleteMask(layerId: string | null = usePhotoUi.getState().selectedLayerId) {
    if (!layerId) return;
    usePhoto.getState().commit((d) => removeMask(d, layerId));
    usePhotoUi.getState().setTarget("content");
  },

  /** An image layer as pixels (Photoshop's Rasterize): its transform and mask baked in, in its place. */
  async convertToPixels(layerId: string) {
    const doc = currentDoc();
    const layer = doc ? findLayer(doc, layerId) : undefined;
    if (!doc || layer?.kind !== "image") return;
    try {
      const renderer = await liveRenderer();
      if (!renderer) return;
      const pixels = await renderer.rasterize(doc, layerId);
      usePhoto.getState().commit((d) => {
        const now = findLayer(d, layerId);
        if (!now) return d;
        // Its blending stays the layer's (the pixels are drawn plain).
        const blending = { ...(now.blend ? { blend: now.blend } : {}), ...(now.fill !== undefined ? { fill: now.fill } : {}), ...(now.blending ? { blending: now.blending } : {}) };
        return replaceLayer(d, layerId, { id: layerId, kind: "pixel", name: now.name, visible: now.visible, opacity: now.opacity, ...blending, ...pixels });
      });
      usePhotoUi.getState().setTarget("content");
      toast.success(`"${layer.name}" is pixels now`, { description: "Its place and mask are part of them: scaling it now resamples these pixels." });
    } catch (error) {
      toast.error("Couldn't convert it to pixels", { description: errorMessage(error) });
    }
  },
};
