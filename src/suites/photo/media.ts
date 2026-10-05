/** The project's images as layers: pure, so the assistant's edits and the store share it. */
import { createId } from "@shared/ids";
import type { NewImageLayer } from "@shared/photo/edits";
import type { MediaAsset } from "@shared/types";

/** A layer's name from its file's: no extension, separators as spaces. */
export const layerName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Image";

/** An image asset as what a new layer needs. */
export function imageLayerOf(asset: MediaAsset, name?: string): NewImageLayer {
  return { id: createId("layer"), mediaId: asset.id, name: name ?? layerName(asset.name), size: { width: asset.width ?? 1, height: asset.height ?? 1 } };
}
