/**
 * What an effect's window (Camera Raw's, Hue/Saturation's) edits, whatever the effect: the instance an `EffectTarget`
 * names, and the edit that puts the window's parameters into the document, a filter on a layer or an adjustment
 * layer, added if it isn't there yet. Every edit is absolute (the whole parameters), so a gesture can apply it again
 * and again.
 */
import { addAdjustmentLayer, addFilter, findLayer, removeFilter, removeLayers, setEffectParams, setFilter } from "@shared/photo/edits";
import { effectDefinition } from "@shared/photo/effects/index";
import { defaultParams } from "@shared/photo/effects/params";
import { type EffectParamValue, type PhotoProject, hasContent } from "@shared/photo/types";
import type { EffectTarget } from "./ui";

/** Where a window's changes go: a drag is `begin`, `apply`…, `end` (or `cancel`); a typed value or a reset the same, at once. */
export interface ParamsSink {
  begin: () => void;
  apply: (patch: Record<string, EffectParamValue>) => void;
  end: () => void;
  cancel: () => void;
}

/** The instance of `type` a target names in `doc`, if it's there. */
export function targetEffect(doc: PhotoProject, target: EffectTarget, type: string) {
  const layer = findLayer(doc, target.layerId);
  if (!layer) return null;
  if (target.filterId === null) return layer.kind === "adjustment" && layer.effect.type === type ? layer.effect : null;
  return hasContent(layer) ? (layer.filters?.find((f) => f.id === target.filterId && f.type === type) ?? null) : null;
}

/** The parameters a target has now (a new one's are the defaults). */
export function targetParams(doc: PhotoProject, target: EffectTarget, type: string): Record<string, EffectParamValue> {
  return structuredClone(targetEffect(doc, target, type)?.params ?? defaultParams(effectDefinition(type)!.params));
}

/** The document with the target at `params` (added if it isn't there), or, with `params` null, without a new one. */
export const targetEdit = (type: string, target: EffectTarget, params: Record<string, EffectParamValue> | null) => (doc: PhotoProject): PhotoProject => {
  const there = targetEffect(doc, target, type) !== null;
  if (target.filterId !== null) {
    if (params === null) return there && target.adding ? removeFilter(doc, target.layerId, target.filterId) : doc;
    return there ? setFilter(doc, target.layerId, target.filterId, { params }) : addFilter(doc, target.layerId, { id: target.filterId, type, params });
  }
  if (params === null) return there && target.adding ? removeLayers(doc, [target.layerId]) : doc;
  const added = there ? doc : addAdjustmentLayer(doc, { id: target.layerId, type }, target.adding?.above ?? null);
  return setEffectParams(added, target.layerId, params);
};
