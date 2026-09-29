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

/** A transition dragged from the Transitions panel (its type) onto a clip edge. */
export const TRANSITION_DRAG_MIME = "application/x-editor-transition";

export function setTransitionDragData(dt: DataTransfer, type: string) {
  dt.setData(TRANSITION_DRAG_MIME, type);
  dt.effectAllowed = "copy";
}

/** Only readable on `drop`. */
export function getTransitionDragData(dt: DataTransfer): string | null {
  return dt.getData(TRANSITION_DRAG_MIME) || null;
}

/** A Library item dragged from the Library tab onto the timeline or a Library folder (its id). */
export const LIBRARY_DRAG_MIME = "application/x-editor-library-item";

export function setLibraryDragData(dt: DataTransfer, itemId: string) {
  dt.setData(LIBRARY_DRAG_MIME, itemId);
  dt.effectAllowed = "copyMove";
}

/** Only readable on `drop`. */
export function getLibraryDragData(dt: DataTransfer): string | null {
  return dt.getData(LIBRARY_DRAG_MIME) || null;
}

export type DragKind = "assets" | "library" | "transition" | "files";

/** Usable during dragover: does this drag carry assets, a Library item, a transition or OS files? */
export function dragKind(dt: DataTransfer): DragKind | null {
  if (dt.types.includes(ASSET_DRAG_MIME)) return "assets";
  if (dt.types.includes(LIBRARY_DRAG_MIME)) return "library";
  if (dt.types.includes(TRANSITION_DRAG_MIME)) return "transition";
  if (dt.types.includes("Files")) return "files";
  return null;
}

/**
 * Filter OS files to those that look like audio, video or images. Unsupported
 * image formats (e.g. HEIC) get through and are rejected by the server with a
 * reason, rather than silently skipped.
 */
export function mediaFiles(files: FileList | File[]): File[] {
  const exts = /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|ogg|oga|flac|opus|png|jpe?g|webp|gif|bmp)$/i;
  return Array.from(files).filter(
    (f) => /^(video|audio|image)\//.test(f.type) || exts.test(f.name),
  );
}
