/**
 * What the Layers commands do, once: the keys (`keys.ts`), the Layers panel's footer and its menu all run these.
 * They act on every selected layer, as Photoshop's do.
 */
import { createId } from "@shared/ids";
import { arrangeLayers, duplicateLayers, removeLayers, shiftLayers } from "@shared/photo/edits";
import { mergeLayers } from "./merge";
import { type LayerSelection, allLayers, edgeLayer, inStackOrder, stepLayer } from "./selection";
import { usePhoto } from "./store";
import { usePhotoUi } from "./ui";

const order = () => usePhoto.getState().history?.doc.layers.map((l) => l.id) ?? [];

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
  step: (direction: 1 | -1, add: boolean) => apply(stepLayer(current(), order(), direction, add)),
  edge: (to: "top" | "bottom", add: boolean) => apply(edgeLayer(current(), order(), to, add)),
};
