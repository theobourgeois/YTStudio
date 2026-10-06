/**
 * The Filter Gallery's preview (ux.md: "Previewing a preset doesn't touch history; applying it is one step"): the
 * photo as the canvas shows it while a look is picked, its filter on the active layer (or its generator a new layer
 * above it) with the settings picked. Pure: the live renderer shows it, the document never holds it.
 */
import { addFilter, addGeneratorLayer, findLayer } from "@shared/photo/edits";
import { type FilterEntry, entryParams, filterEntry } from "@shared/photo/effects/catalog";
import { validateParams } from "@shared/photo/effects/index";
import { type EffectParamValue, type PhotoProject, hasContent } from "@shared/photo/types";

/** Fixed ids for what a preview adds: never the document's (theirs are random). */
export const PREVIEW_FILTER = "fx_000000000000";
export const PREVIEW_LAYER = "layer_000000000000";

/** A look picked in the gallery and the settings it would be applied with. */
export interface FilterPreview {
  key: string;
  params: Record<string, EffectParamValue>;
}

/** Whether `entry` can go on the photo now: a generator always can (a new layer), a filter needs a layer with content. */
export function canApply(doc: PhotoProject, entry: FilterEntry, layerId: string | null): boolean {
  if (entry.def.kind === "generator") return true;
  const layer = layerId ? findLayer(doc, layerId) : undefined;
  return !!layer && hasContent(layer);
}

/** A look's starting settings for this photo: every parameter, its preset's sized to the canvas, the rest their defaults. */
export const startingPreview = (entry: FilterEntry, doc: PhotoProject): FilterPreview => ({ key: entry.key, params: validateParams(entry.def, entryParams(entry, doc.canvas)).params });

/** The photo with `preview` applied as Apply would, with `ids` (the preview's fixed ones by default); null when it can't be. */
export function withLook(doc: PhotoProject, preview: FilterPreview, layerId: string | null, ids = { filter: PREVIEW_FILTER, layer: PREVIEW_LAYER }): PhotoProject | null {
  const entry = filterEntry(preview.key);
  if (!entry || !canApply(doc, entry, layerId)) return null;
  if (entry.def.kind === "generator") return addGeneratorLayer(doc, { id: ids.layer, type: entry.def.type, params: preview.params }, layerId);
  return addFilter(doc, layerId!, { id: ids.filter, type: entry.def.type, params: preview.params });
}

/** What the canvas shows: the photo, with the gallery's look when one is picked and can go on it. */
export const shownDoc = (doc: PhotoProject, preview: FilterPreview | null, layerId: string | null): PhotoProject => (preview ? (withLook(doc, preview, layerId) ?? doc) : doc);
