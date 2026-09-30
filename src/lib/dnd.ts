/**
 * HTML5 drag-and-drop payload for dragging assets (a card, or the selected
 * cards) from the media bin onto the timeline. OS file drops use `dataTransfer.files` instead.
 */
export const ASSET_DRAG_MIME = "application/x-editor-assets";

export interface AssetDragPayload {
  /** Media files, and subclips (their ids too: see `addAssetsToTimeline`). */
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

/** A transition dragged from the Effects tab's Transitions (its type) onto a clip edge. */
export const TRANSITION_DRAG_MIME = "application/x-editor-transition";

export function setTransitionDragData(dt: DataTransfer, type: string) {
  dt.setData(TRANSITION_DRAG_MIME, type);
  dt.effectAllowed = "copy";
}

/** Only readable on `drop`. */
export function getTransitionDragData(dt: DataTransfer): string | null {
  return dt.getData(TRANSITION_DRAG_MIME) || null;
}

/** A video effect dragged from the Effects tab (its type) onto a clip, on the timeline or the canvas. */
export const EFFECT_DRAG_MIME = "application/x-editor-effect";

export function setEffectDragData(dt: DataTransfer, type: string) {
  dt.setData(EFFECT_DRAG_MIME, type);
  dt.effectAllowed = "copy";
}

/** Only readable on `drop`. */
export function getEffectDragData(dt: DataTransfer): string | null {
  return dt.getData(EFFECT_DRAG_MIME) || null;
}

/**
 * A preset dragged from the Effects tab's Presets (its type). A transition preset drops like a
 * transition (on the nearest cut), an effect preset like a video effect (on a clip, or on empty
 * space as an adjustment layer), so `dragKind` reports them as those.
 */
export const PRESET_DRAG_MIME = { transition: "application/x-editor-preset-transition", effect: "application/x-editor-preset-effect" } as const;

export function setPresetDragData(dt: DataTransfer, kind: "transition" | "effect", type: string) {
  dt.setData(PRESET_DRAG_MIME[kind], type);
  dt.effectAllowed = "copy";
}

/** Only readable on `drop`: the preset's type, if a preset is being dropped. */
export function getPresetDragData(dt: DataTransfer): string | null {
  return dt.getData(PRESET_DRAG_MIME.transition) || dt.getData(PRESET_DRAG_MIME.effect) || null;
}

/**
 * Library items (or a folder) dragged from the Library tab onto the timeline or
 * a Library folder: their ids, one per line.
 */
export const LIBRARY_DRAG_MIME = "application/x-editor-library-item";

export function setLibraryDragData(dt: DataTransfer, ids: string[]) {
  dt.setData(LIBRARY_DRAG_MIME, ids.join("\n"));
  dt.effectAllowed = "copyMove";
}

/** Only readable on `drop`. */
export function getLibraryDragData(dt: DataTransfer): string[] {
  return dt.getData(LIBRARY_DRAG_MIME).split("\n").filter(Boolean);
}

export type DragKind = "assets" | "library" | "transition" | "effect" | "files";

/** Usable during dragover: does this drag carry assets, a Library item, a transition, an effect or OS files? */
export function dragKind(dt: DataTransfer): DragKind | null {
  if (dt.types.includes(ASSET_DRAG_MIME)) return "assets";
  if (dt.types.includes(LIBRARY_DRAG_MIME)) return "library";
  if (dt.types.includes(TRANSITION_DRAG_MIME) || dt.types.includes(PRESET_DRAG_MIME.transition)) return "transition";
  if (dt.types.includes(EFFECT_DRAG_MIME) || dt.types.includes(PRESET_DRAG_MIME.effect)) return "effect";
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
