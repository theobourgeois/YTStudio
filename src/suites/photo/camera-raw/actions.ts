/**
 * Opening Camera Raw (docs/photo/camera-raw.md, "The Camera Raw window"), and the edit that puts what the window
 * shows into the document: a Camera Raw filter on a layer, or a Camera Raw adjustment layer, added if it isn't there
 * yet. Every edit here is absolute (the whole parameters), so a gesture can apply it again and again.
 */
import { toast } from "sonner";
import { createId } from "@shared/ids";
import { addAdjustmentLayer, addFilter, findLayer, removeFilter, removeLayers, setEffectParams, setFilter } from "@shared/photo/edits";
import { effectDefinition } from "@shared/photo/effects/index";
import { defaultParams } from "@shared/photo/effects/params";
import { type EffectParamValue, type PhotoProject, hasContent } from "@shared/photo/types";
import { currentDoc } from "../store";
import { type CameraRawTarget, usePhotoUi } from "../ui";

export const CAMERA_RAW = "camera-raw";

/** The Camera Raw instance a target names in `doc`, if it's there. */
export function cameraRawOf(doc: PhotoProject, target: CameraRawTarget) {
  const layer = findLayer(doc, target.layerId);
  if (!layer) return null;
  if (target.filterId === null) return layer.kind === "adjustment" && layer.effect.type === CAMERA_RAW ? layer.effect : null;
  return hasContent(layer) ? (layer.filters?.find((f) => f.id === target.filterId && f.type === CAMERA_RAW) ?? null) : null;
}

/** The parameters a target has now (a new one's are the defaults). */
export function cameraRawParams(doc: PhotoProject, target: CameraRawTarget): Record<string, EffectParamValue> {
  return structuredClone(cameraRawOf(doc, target)?.params ?? defaultParams(effectDefinition(CAMERA_RAW)!.params));
}

/** The document with the target at `params` (added if it isn't there), or, with `params` null, without a new one. */
export const cameraRawEdit = (target: CameraRawTarget, params: Record<string, EffectParamValue> | null) => (doc: PhotoProject): PhotoProject => {
  const there = cameraRawOf(doc, target) !== null;
  if (target.filterId !== null) {
    if (params === null) return there && target.adding ? removeFilter(doc, target.layerId, target.filterId) : doc;
    return there ? setFilter(doc, target.layerId, target.filterId, { params }) : addFilter(doc, target.layerId, { id: target.filterId, type: CAMERA_RAW, params });
  }
  if (params === null) return there && target.adding ? removeLayers(doc, [target.layerId]) : doc;
  const added = there ? doc : addAdjustmentLayer(doc, { id: target.layerId, type: CAMERA_RAW }, target.adding?.above ?? null);
  return setEffectParams(added, target.layerId, params);
};

export const cameraRawActions = {
  /**
   * Filter › Camera Raw Filter… (⇧⌘A): a new Camera Raw filter on the active layer, in the window. On a Camera Raw
   * adjustment layer, that one.
   */
  filter() {
    const doc = currentDoc();
    const { selectedLayerId, selectedFilterId } = usePhotoUi.getState();
    const layer = doc && selectedLayerId ? findLayer(doc, selectedLayerId) : undefined;
    if (!doc || !layer) return void toast.error("Select a layer to develop it in Camera Raw.");
    if (!hasContent(layer)) {
      if (layer.effect.type === CAMERA_RAW) return cameraRawActions.edit(layer.id, null);
      return void toast.error(`"${layer.name}" is an adjustment layer: a Camera Raw filter works on a layer's own pixels. Layers › New Adjustment Layer › Camera Raw develops everything below.`);
    }
    // The Camera Raw filter shown in Properties is opened rather than another added.
    const shown = selectedFilterId ? layer.filters?.find((f) => f.id === selectedFilterId && f.type === CAMERA_RAW) : undefined;
    if (shown) return cameraRawActions.edit(layer.id, shown.id);
    usePhotoUi.getState().setCameraRaw({ layerId: layer.id, filterId: createId("fx"), adding: { above: null } });
  },
  /** Layers › New Adjustment Layer › Camera Raw…: a new one above the selected layer, in the window. */
  adjustmentLayer() {
    usePhotoUi.getState().setCameraRaw({ layerId: createId("layer"), filterId: null, adding: { above: usePhotoUi.getState().selectedLayerId } });
  },
  /** The window on a Camera Raw filter (`filterId`) or adjustment layer (null) that's there. */
  edit(layerId: string, filterId: string | null) {
    const ui = usePhotoUi.getState();
    if (filterId) ui.selectFilter(layerId, filterId);
    else if (ui.selectedLayerId !== layerId) ui.select(layerId);
    ui.setCameraRaw({ layerId, filterId });
  },
};
