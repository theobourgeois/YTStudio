/**
 * What the Layers commands do, once: the keys (`keys.ts`), the Layers panel's footer and its menu all run these.
 * They act on every selected layer, as Photoshop's do.
 */
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { createId } from "@shared/ids";
import { addFilter, addGeneratorLayer, addPixelLayer, arrangeLayers, duplicateLayers, findLayer, removeFilter, removeLayers, removeMask, replaceLayer, setMask, shiftLayers } from "@shared/photo/edits";
import { effectDefinition } from "@shared/photo/effects/index";
import { hasContent } from "@shared/photo/types";
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
  /** Delete: the filter shown in Properties, when one is; else the selected layers. */
  delete() {
    const { selectedFilterId, selectedLayerId } = usePhotoUi.getState();
    if (selectedFilterId && selectedLayerId) {
      usePhoto.getState().commit((d) => removeFilter(d, selectedLayerId, selectedFilterId));
      usePhotoUi.getState().selectFilter(selectedLayerId, null);
      return;
    }
    const ids = selectedInOrder();
    if (ids.length) usePhoto.getState().commit((d) => removeLayers(d, ids));
  },

  /**
   * A filter (Photoshop's Smart Filter: the glow) on the active layer, applied after its others, shown in Properties.
   * An adjustment has no pixels of its own: it says so.
   */
  addFilter(type: string, layerId: string | null = usePhotoUi.getState().selectedLayerId) {
    const doc = currentDoc();
    const layer = doc && layerId ? findLayer(doc, layerId) : undefined;
    const def = effectDefinition(type);
    if (!doc || !layer || !def) return void toast.error(`Select a layer to add ${def?.label ?? "a filter"} to.`);
    if (!hasContent(layer)) return void toast.error(`"${layer.name}" is an adjustment layer: ${def.label} works on a layer's own pixels.`);
    const id = createId("fx");
    usePhoto.getState().commit((d) => addFilter(d, layer.id, { id, type }));
    usePhotoUi.getState().selectFilter(layer.id, id);
    return id;
  },

  /** A new Lens Flare above the active layer (or on top), selected, its handles on the canvas. */
  addFlare(preset = "classic") {
    const id = createId("layer");
    usePhoto.getState().commit((d) => addGeneratorLayer(d, { id, type: "lens-flare", preset }, usePhotoUi.getState().selectedLayerId));
    usePhotoUi.getState().select(id);
    usePhotoUi.getState().setTool("move");
    return id;
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

  /**
   * An image or generator layer as pixels (Photoshop's Rasterize): its transform, filters and mask baked in, in its
   * place (a generator's over the canvas).
   */
  async convertToPixels(layerId: string) {
    const doc = currentDoc();
    const layer = doc ? findLayer(doc, layerId) : undefined;
    if (!doc || (layer?.kind !== "image" && layer?.kind !== "generator")) return;
    try {
      const renderer = await liveRenderer();
      if (!renderer) return;
      const pixels = await renderer.rasterize(doc, layerId);
      usePhoto.getState().commit((d) => {
        const now = findLayer(d, layerId);
        if (!now) return d;
        return replaceLayer(d, layerId, { id: layerId, kind: "pixel", name: now.name, visible: now.visible, opacity: now.opacity, ...pixels });
      });
      usePhotoUi.getState().setTarget("content");
      toast.success(`"${layer.name}" is pixels now`, { description: "Its place, filters and mask are part of them: scaling it now resamples these pixels." });
    } catch (error) {
      toast.error("Couldn't convert it to pixels", { description: errorMessage(error) });
    }
  },
};
