/**
 * Pure edits of a photo document, the only way it changes (the UI, keys and the assistant all use these). Each
 * returns the same document when nothing changes, so a no-op makes no undo step and no save.
 */
import type { Size } from "./geometry.ts";
import { MIN_SCALE, isColour, wrapDegrees } from "./project.ts";
import { type ImageLayer, type LayerTransform, MAX_CANVAS_SIDE, type PhotoCanvas, type PhotoLayer, type PhotoProject } from "./types.ts";

export const findLayer = (doc: PhotoProject, id: string): PhotoLayer | undefined => doc.layers.find((l) => l.id === id);

function mapLayer(doc: PhotoProject, id: string, update: (layer: PhotoLayer) => PhotoLayer): PhotoProject {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) return l;
    const next = update(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export interface NewImageLayer {
  id: string;
  mediaId: string;
  name: string;
  /** The source's upright size in its own pixels. */
  size: Size;
}

/**
 * Where a placed image goes: centred, at its own size, or scaled down to fit the canvas when it's bigger
 * (Photoshop's Place Embedded).
 */
export function placement(canvas: Size, size: Size): LayerTransform {
  const fit = Math.min(1, canvas.width / size.width, canvas.height / size.height);
  return { x: canvas.width / 2, y: canvas.height / 2, scaleX: fit, scaleY: fit, rotation: 0 };
}

/** A new image layer above `below` (an id), or at the top. */
export function addImageLayer(doc: PhotoProject, layer: NewImageLayer, options: { below?: string | null; transform?: LayerTransform } = {}): PhotoProject {
  if (findLayer(doc, layer.id)) return doc;
  const added: ImageLayer = {
    id: layer.id,
    kind: "image",
    name: layer.name.trim() || "Image",
    visible: true,
    opacity: 1,
    mediaId: layer.mediaId,
    transform: options.transform ?? placement(doc.canvas, layer.size),
  };
  const layers = [...doc.layers];
  const at = options.below ? layers.findIndex((l) => l.id === options.below) : -1;
  layers.splice(at >= 0 ? at : layers.length, 0, added);
  return { ...doc, layers };
}

/** The canvas the size of an image, with that image as its only layer, at 100%: a photo opened from a file. */
export function fromImage(doc: PhotoProject, layer: NewImageLayer): PhotoProject {
  const width = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(layer.size.width)));
  const height = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(layer.size.height)));
  const canvas: PhotoCanvas = { width, height, background: null };
  return addImageLayer({ ...doc, canvas, layers: [] }, layer, { transform: { x: width / 2, y: height / 2, scaleX: 1, scaleY: 1, rotation: 0 } });
}

const sameTransform = (a: LayerTransform, b: LayerTransform) =>
  a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotation === b.rotation;

/** Sets part of a layer's transform; a scale too close to 0 is held at the smallest (it has to stay invertible). */
export function setTransform(doc: PhotoProject, id: string, patch: Partial<LayerTransform>): PhotoProject {
  return mapLayer(doc, id, (l) => {
    const t = { ...l.transform, ...patch };
    const clampScale = (s: number) => (Math.abs(s) < MIN_SCALE ? (s < 0 ? -MIN_SCALE : MIN_SCALE) : s);
    const next: LayerTransform = { x: t.x, y: t.y, scaleX: clampScale(t.scaleX), scaleY: clampScale(t.scaleY), rotation: wrapDegrees(t.rotation) };
    if (![next.x, next.y, next.scaleX, next.scaleY, next.rotation].every(Number.isFinite)) return l;
    return sameTransform(next, l.transform) ? l : { ...l, transform: next };
  });
}

export interface LayerPatch {
  name?: string;
  visible?: boolean;
  opacity?: number;
}

export function updateLayer(doc: PhotoProject, id: string, patch: LayerPatch): PhotoProject {
  return mapLayer(doc, id, (l) => {
    const name = patch.name !== undefined && patch.name.trim() ? patch.name.trim().slice(0, 200) : l.name;
    const visible = patch.visible ?? l.visible;
    const opacity = patch.opacity !== undefined && Number.isFinite(patch.opacity) ? Math.max(0, Math.min(1, patch.opacity)) : l.opacity;
    return name === l.name && visible === l.visible && opacity === l.opacity ? l : { ...l, name, visible, opacity };
  });
}

export function removeLayer(doc: PhotoProject, id: string): PhotoProject {
  return findLayer(doc, id) ? { ...doc, layers: doc.layers.filter((l) => l.id !== id) } : doc;
}

/** Moves a layer to `index` (0 is the bottom), clamped to the stack. */
export function moveLayer(doc: PhotoProject, id: string, index: number): PhotoProject {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, Math.round(index)));
  if (to === from) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer);
  return { ...doc, layers };
}

/** A copy of a layer right above it, named "… copy". */
export function duplicateLayer(doc: PhotoProject, id: string, newId: string): PhotoProject {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0 || findLayer(doc, newId)) return doc;
  const layers = [...doc.layers];
  layers.splice(index + 1, 0, { ...doc.layers[index], id: newId, name: `${doc.layers[index].name} copy` });
  return { ...doc, layers };
}

/**
 * Changes the canvas's size or background. Layers keep their place relative to the top-left corner (Photoshop's
 * Canvas Size anchored top-left; centring is the caller's choice of `anchor`).
 */
export function setCanvas(doc: PhotoProject, patch: Partial<PhotoCanvas>, anchor: "top-left" | "centre" = "top-left"): PhotoProject {
  const width = patch.width !== undefined && Number.isInteger(patch.width) && patch.width >= 1 && patch.width <= MAX_CANVAS_SIDE ? patch.width : doc.canvas.width;
  const height = patch.height !== undefined && Number.isInteger(patch.height) && patch.height >= 1 && patch.height <= MAX_CANVAS_SIDE ? patch.height : doc.canvas.height;
  const background = patch.background === undefined ? doc.canvas.background : patch.background === null || isColour(patch.background) ? (patch.background?.toLowerCase() ?? null) : doc.canvas.background;
  if (width === doc.canvas.width && height === doc.canvas.height && background === doc.canvas.background) return doc;
  const dx = anchor === "centre" ? (width - doc.canvas.width) / 2 : 0;
  const dy = anchor === "centre" ? (height - doc.canvas.height) / 2 : 0;
  const layers = dx || dy ? doc.layers.map((l) => ({ ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } })) : doc.layers;
  return { ...doc, canvas: { width, height, background }, layers };
}
