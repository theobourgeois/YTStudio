/**
 * A layer's Develop in Properties: its Camera Raw filter (the first, when it has several), worked on in place with
 * no menu first. The first touch adds it, first in the layer's filters (a develop works on the source, before any
 * look made from it), so what the section shows is all the document holds.
 */
import { addFilter, findLayer, moveFilter, setFilter } from "@shared/photo/edits";
import { unavailableReason } from "@shared/photo/effects/index";
import { type EffectInstance, type EffectParamValue, type PhotoLayer, type PhotoProject, hasContent } from "@shared/photo/types";

export const DEVELOP = "camera-raw";

/** The Camera Raw filter a layer's Develop shows, if it has one this version can run. */
export const developOf = (layer: PhotoLayer | undefined): EffectInstance | null =>
  layer && hasContent(layer) ? (layer.filters?.find((f) => f.type === DEVELOP && !unavailableReason(f, "filter")) ?? null) : null;

/** The layer's filter `filterId` at `params`: set when it's there, else added (first in its list). */
export const developEdit = (layerId: string, filterId: string, params: Record<string, EffectParamValue>) => (doc: PhotoProject): PhotoProject => {
  const layer = findLayer(doc, layerId);
  if (!layer || !hasContent(layer)) return doc;
  if (layer.filters?.some((f) => f.id === filterId)) return setFilter(doc, layerId, filterId, { params });
  return moveFilter(addFilter(doc, layerId, { id: filterId, type: DEVELOP, params }), layerId, filterId, 0);
};
