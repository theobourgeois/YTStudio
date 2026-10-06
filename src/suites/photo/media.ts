/** The project's images as layers: pure, so the assistant's edits and the store share it. */
import { createId } from "@shared/ids";
import type { NewImageLayer } from "@shared/photo/edits";
import { DEFAULT_PROJECT_NAME } from "@shared/suites";
import type { MediaAsset } from "@shared/types";

/** A layer's name from its file's: no extension, separators as spaces. */
export const layerName = (fileName: string) => fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Image";

/** An image asset as what a new layer needs. */
export function imageLayerOf(asset: MediaAsset, name?: string): NewImageLayer {
  return { id: createId("layer"), mediaId: asset.id, name: name ?? layerName(asset.name), size: { width: asset.width ?? 1, height: asset.height ?? 1 } };
}

/** A name nobody chose: what a new project is called until it's named ("Untitled", "Untitled 2"). */
export const isDefaultName = (name: string) => new RegExp(`^${DEFAULT_PROJECT_NAME}( \\d+)?$`).test(name.trim());

/** A photo's name from the image it's opened from: the file's name without its extension. */
export const projectNameOf = (fileName: string) => fileName.replace(/\.[^.]+$/, "").trim() || DEFAULT_PROJECT_NAME;
