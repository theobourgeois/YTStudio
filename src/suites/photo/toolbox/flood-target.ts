/**
 * Where the Paint Bucket's and the Magic Eraser's clicks act (docs/photo/tools/paint-bucket.md, magic-eraser.md),
 * pure so it's tested: which layer and which of its surfaces, the layer read when the photo as it shows isn't, and
 * that surface's place.
 */
import { findLayer } from "@shared/photo/edits";
import { IDENTITY, layerMatrix } from "@shared/photo/layers";
import { isBent, perspectiveRefusal } from "@shared/photo/projective";
import { type PhotoProject, type SurfaceId, isPlaced } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { type PaintTarget, type SurfacePart, paintTargetOf } from "../paint-target";
import { sizeOf } from "../tool-edits";
import type { SurfaceTarget } from "./surface-edit";

export interface FloodWhere {
  layerId: string;
  part: SurfacePart;
  /** The layer read when the photo as it shows isn't (null: an adjustment has no pixels, so the photo is). */
  own: string | null;
  /** The layer has no mask yet: the edit gives it one. */
  addsMask: boolean;
}

export type FloodWhereResult = FloodWhere | { choice: string } | { error: string };

const ownOf = (doc: PhotoProject, layerId: string) => (findLayer(doc, layerId)?.kind === "adjustment" ? null : layerId);

/**
 * The Paint Bucket: where the brush paints (its pixels, or its mask when it's targeted or an adjustment's); a placed
 * image or a generator asks first, as the brush does (never rasterised silently).
 */
export function bucketWhere(doc: PhotoProject, activeId: string | null, target: PaintTarget): FloodWhereResult {
  const t = paintTargetOf(doc, activeId, target);
  if (!("layerId" in t)) return t;
  return { layerId: t.layerId, part: t.part, own: ownOf(doc, t.layerId), addsMask: t.addMask === true };
}

/**
 * The Magic Eraser: a pixel layer's pixels, else (or when the mask is targeted) the layer's mask, given one when it
 * has none: a placed image is erased through its mask, never rasterised (magic-eraser.md, our difference).
 */
export function eraserWhere(doc: PhotoProject, activeId: string | null, target: PaintTarget): FloodWhereResult {
  const layer = activeId ? findLayer(doc, activeId) : undefined;
  if (!layer) return { error: "Select a layer to erase on." };
  if (!layer.visible) return { error: `"${layer.name}" is hidden: show it to erase on it.` };
  if (isPlaced(layer) && isBent(layer.transform)) return { error: perspectiveRefusal(layer.name) };
  if (layer.kind === "pixel" && !(target === "mask" && layer.mask)) return { layerId: layer.id, part: "content", own: layer.id, addsMask: false };
  return { layerId: layer.id, part: "mask", own: ownOf(doc, layer.id), addsMask: !layer.mask };
}

/** The surface a layer's part shows now (null: nothing painted, or no mask). */
export function shownSurface(doc: PhotoProject, layerId: string, part: SurfacePart): SurfaceId | null | undefined {
  const layer = findLayer(doc, layerId);
  if (!layer) return undefined;
  if (part === "mask") return layer.mask?.surface ?? null;
  return layer.kind === "pixel" ? layer.surface : undefined;
}

/**
 * A layer's pixels or mask as a surface to edit: what it shows, its size and its place. A pixel layer's and an
 * image's mask follow the layer (its own pixels: an image's source); an adjustment's and a generator's are the
 * document's. Null when there's nothing to edit (an image whose media isn't known yet).
 */
export function floodSurface(doc: PhotoProject, layerId: string, part: SurfacePart, assets: readonly MediaAsset[]): SurfaceTarget | null {
  const layer = findLayer(doc, layerId);
  if (!layer) return null;
  // In perspective a layer's own pixels aren't placed by an affine map: nothing here edits them yet.
  if (isPlaced(layer) && isBent(layer.transform)) return null;
  if (part === "content") {
    if (layer.kind !== "pixel") return null;
    return { surface: layer.surface, kind: "pixels", size: layer.size, matrix: layerMatrix(layer.transform, layer.size) };
  }
  const surface = layer.mask?.surface ?? null;
  if (layer.kind === "adjustment" || layer.kind === "generator") return { surface, kind: "mask", size: doc.canvas, matrix: IDENTITY };
  const size = sizeOf(layer, assets);
  if (!size) return null;
  return { surface, kind: "mask", size, matrix: layerMatrix(layer.transform, size) };
}
