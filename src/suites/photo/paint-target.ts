/** What a brush press paints (`painting.ts`), pure so it's tested. */
import { setMask, setSurface } from "@shared/photo/edits";
import { isBent, perspectiveRefusal } from "@shared/photo/projective";
import { type PhotoProject, type SurfaceId, isPlaced } from "@shared/photo/types";

/** Which of a layer's surfaces: a pixel layer's pixels, or any layer's mask. */
export type SurfacePart = "content" | "mask";

/** What the brush paints on the active layer: its pixels, or its mask. */
export type PaintTarget = "content" | "mask";

export type PaintTargetResult =
  | { layerId: string; part: SurfacePart; addMask?: boolean }
  /** An image layer: the user chooses a new paint layer or converting it to pixels. */
  | { choice: string }
  | { error: string };

/** What a brush press on layer `activeId` paints, given what's targeted. */
export function paintTargetOf(doc: PhotoProject, activeId: string | null, target: PaintTarget): PaintTargetResult {
  const layer = activeId ? doc.layers.find((l) => l.id === activeId) : undefined;
  if (!layer) return { error: "Select a layer to paint on, or make one (⇧⌘N)." };
  if (!layer.visible) return { error: `"${layer.name}" is hidden: show it to paint on it.` };
  // Its own pixels or mask, in perspective: an image's pixels still offer a new paint layer above it.
  const own = layer.kind === "pixel" || (layer.mask && target === "mask");
  if (own && isPlaced(layer) && isBent(layer.transform)) return { error: perspectiveRefusal(layer.name) };
  if (layer.mask && (target === "mask" || layer.kind === "adjustment")) return { layerId: layer.id, part: "mask" };
  if (layer.kind === "pixel") return { layerId: layer.id, part: "content" };
  if (layer.kind === "adjustment") return { layerId: layer.id, part: "mask", addMask: true };
  return { choice: layer.id };
}

/** The edit that puts a stroke's surface in the document. */
export const commitSurface = (layerId: string, part: SurfacePart, id: SurfaceId) => (doc: PhotoProject) =>
  part === "mask" ? setMask(doc, layerId, id) : setSurface(doc, layerId, id);

