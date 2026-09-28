/**
 * HTML5 drag-and-drop payload for dragging assets from the media bin onto the
 * timeline. OS file drops use `dataTransfer.files` instead.
 */
export const ASSET_DRAG_MIME = "application/x-editor-assets";

export interface AssetDragPayload {
  assetIds: string[];
}

export function setAssetDragData(dt: DataTransfer, payload: AssetDragPayload) {
  dt.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

/** Only readable on `drop` (browsers hide the data during dragover). */
export function getAssetDragData(dt: DataTransfer): AssetDragPayload | null {
  const raw = dt.getData(ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.assetIds) ? parsed : null;
  } catch {
    return null;
  }
}

/** Usable during dragover: does this drag carry assets or OS files? */
export function dragKind(dt: DataTransfer): "assets" | "files" | null {
  if (dt.types.includes(ASSET_DRAG_MIME)) return "assets";
  if (dt.types.includes("Files")) return "files";
  return null;
}

/** Filter OS files to those that look like audio/video. */
export function mediaFiles(files: FileList | File[]): File[] {
  const exts = /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;
  return Array.from(files).filter(
    (f) => f.type.startsWith("video/") || f.type.startsWith("audio/") || exts.test(f.name),
  );
}
