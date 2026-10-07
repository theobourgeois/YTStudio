/**
 * Opening Hue/Saturation (docs/photo/hue-saturation.md): Photoshop's Image › Adjustments › Hue/Saturation… (⌘U) as a
 * filter on the active layer, so it stays editable (a Smart Filter's way), in its window.
 */
import { toast } from "sonner";
import { createId } from "@shared/ids";
import { findLayer } from "@shared/photo/edits";
import { hasContent } from "@shared/photo/types";
import { currentDoc } from "../store";
import { usePhotoUi } from "../ui";

export const HUE_SATURATION = "hue-saturation";

export const hueSaturationActions = {
  /**
   * ⌘U: a new Hue/Saturation filter on the active layer, in the window; the one shown in Properties, or a
   * Hue/Saturation adjustment layer, opened rather than another added. On another adjustment layer, a new
   * Hue/Saturation adjustment layer above it (it has no pixels of its own to change).
   */
  open() {
    const doc = currentDoc();
    const ui = usePhotoUi.getState();
    const layer = doc && ui.selectedLayerId ? findLayer(doc, ui.selectedLayerId) : undefined;
    if (!doc || !layer) return void toast.error("Select a layer to change its hue and saturation.");
    if (!hasContent(layer)) {
      if (layer.effect.type === HUE_SATURATION) return hueSaturationActions.edit(layer.id, null);
      return hueSaturationActions.adjustmentLayer();
    }
    const shown = ui.selectedFilterId ? layer.filters?.find((f) => f.id === ui.selectedFilterId && f.type === HUE_SATURATION) : undefined;
    if (shown) return hueSaturationActions.edit(layer.id, shown.id);
    ui.setHueSaturation({ layerId: layer.id, filterId: createId("fx"), adding: { above: null } });
  },
  /** A new Hue/Saturation adjustment layer above the selected layer, in the window. */
  adjustmentLayer() {
    usePhotoUi.getState().setHueSaturation({ layerId: createId("layer"), filterId: null, adding: { above: usePhotoUi.getState().selectedLayerId } });
  },
  /** The window on a Hue/Saturation filter (`filterId`) or adjustment layer (null) that's there. */
  edit(layerId: string, filterId: string | null) {
    const ui = usePhotoUi.getState();
    if (filterId) ui.selectFilter(layerId, filterId);
    else if (ui.selectedLayerId !== layerId) ui.select(layerId);
    ui.setHueSaturation({ layerId, filterId });
  },
};
