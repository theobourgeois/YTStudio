/**
 * Cropping (docs/photo/tools/crop.md): a layer's crop (a rectangle of its own pixels, the rest hidden) and cropping
 * the canvas (its size, and everything placed in document pixels moved by the box's corner). Pure: the Crop tool,
 * the renderer's plan, the Move tool's frame and the assistant all go through these.
 */
import { type DocPoint, type LayerCrop, type LayerTransform, type MaskSelection, MAX_CANVAS_SIDE, type PhotoLayer, type PhotoProject, type PhotoSelection, type PhotoState, type PlacedLayer, type SurfaceId, isCroppable, isPlaced } from "./types.ts";
import { effectDefinition, unavailableReason } from "./effects/index.ts";
import type { Size } from "./geometry.ts";
import { type Affine, apply, invert, layerMatrix } from "./layers.ts";

/** A rectangle: x right and y down from a top-left corner, with a size. */
export type CropRect = LayerCrop;

/** The whole of something of `size`. */
export const fullRect = (size: Size): CropRect => ({ x: 0, y: 0, width: size.width, height: size.height });

export const sameRect = (a: CropRect, b: CropRect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** `r` inside [0, size], or null when nothing of it is left. */
export function clipRect(r: CropRect, size: Size): CropRect | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(size.width, r.x + r.width);
  const y1 = Math.min(size.height, r.y + r.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** What shows of a layer of `size`: its crop inside it, or the whole layer. */
export function cropOf(layer: PhotoLayer, size: Size): CropRect {
  const crop = isCroppable(layer) && layer.crop ? clipRect(layer.crop, size) : null;
  return crop ?? fullRect(size);
}

/** Whether a layer hides part of itself (its crop, inside it, is less than the whole). */
export const isCropped = (layer: PhotoLayer, size: Size) => !sameRect(cropOf(layer, size), fullRect(size));

/**
 * The cropped part of a layer as a layer of its own would be placed: the crop's size, its centre where the crop's
 * centre lands, the layer's scale and turn. The Move tool's box, the hover outline and picking use it, so a cropped
 * layer is handled by what shows of it.
 */
export function croppedPlace(t: LayerTransform, size: Size, crop: CropRect): { t: LayerTransform; size: Size } {
  const c = apply(layerMatrix(t, size), crop.x + crop.width / 2, crop.y + crop.height / 2);
  return { t: { ...t, x: c.x, y: c.y }, size: { width: crop.width, height: crop.height } };
}

/** A layer's visible place (`croppedPlace` of its crop; the layer's own when it has none). */
export function visiblePlace(layer: PlacedLayer, size: Size): { t: LayerTransform; size: Size } {
  return layer.crop ? croppedPlace(layer.transform, size, cropOf(layer, size)) : { t: layer.transform, size };
}

/**
 * The layer's transform that puts its crop at `next` (a cropped place moved, scaled or turned): the inverse of
 * `croppedPlace`, so the crop stays where it is on the layer.
 */
export function uncroppedTransform(next: LayerTransform, size: Size, crop: CropRect): LayerTransform {
  // The layer's centre in the crop's own pixels, carried by the crop's new place.
  const c = apply(layerMatrix(next, { width: crop.width, height: crop.height }), size.width / 2 - crop.x, size.height / 2 - crop.y);
  return { ...next, x: c.x, y: c.y };
}

/** Whether document point (x, y) is on what shows of the layer (inside its crop). */
export function containsCropped(layer: PlacedLayer, size: Size, x: number, y: number): boolean {
  const p = apply(invert(layerMatrix(layer.transform, size)), x, y);
  const c = cropOf(layer, size);
  return p.x >= c.x && p.y >= c.y && p.x <= c.x + c.width && p.y <= c.y + c.height;
}

/** The axis-aligned box around what shows of a layer, in document pixels. */
export function croppedBounds(matrix: Affine, crop: CropRect) {
  const pts = [apply(matrix, crop.x, crop.y), apply(matrix, crop.x + crop.width, crop.y), apply(matrix, crop.x, crop.y + crop.height), apply(matrix, crop.x + crop.width, crop.y + crop.height)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A layer's crop from an untrusted document: four finite numbers, a positive size, inside the layer when its size is
 * known (an image's isn't while normalising: the renderer clips it then). Anything else is no crop (reported).
 */
export function normalizeCrop(value: unknown, size: Size | null, report: (problem: string) => void, id: string): { crop?: LayerCrop } {
  if (value === undefined || value === null) return {};
  const c = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (!finite(c.x) || !finite(c.y) || !finite(c.width) || !finite(c.height) || c.width <= 0 || c.height <= 0 || Math.abs(c.x) > 1e6 || Math.abs(c.y) > 1e6 || c.width > 1e6 || c.height > 1e6) {
    report(`Layer ${id}: its crop isn't a rectangle (x, y, width, height); the whole layer shows.`);
    return {};
  }
  const rect = { x: c.x, y: c.y, width: c.width, height: c.height };
  if (!size) return { crop: rect };
  const clipped = clipRect(rect, size);
  if (!clipped) {
    report(`Layer ${id}: its crop is outside it; the whole layer shows.`);
    return {};
  }
  if (sameRect(clipped, fullRect(size))) return {};
  if (!sameRect(clipped, rect)) report(`Layer ${id}: its crop went past the layer; kept to it.`);
  return { crop: clipped };
}

/**
 * A layer's crop set (a rectangle of its pixels, kept inside it), or taken off (null, or the whole layer). Only image
 * and pixel layers have one. The same document when nothing changes.
 */
export function setLayerCrop(doc: PhotoProject, id: string, crop: CropRect | null, size: Size): PhotoProject {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id || !isCroppable(l)) return l;
    const clipped = crop ? clipRect(crop, size) : null;
    const next = clipped && !sameRect(clipped, fullRect(size)) ? clipped : null;
    const now = l.crop ?? null;
    if (next === null ? now === null : now !== null && sameRect(now, next)) return l;
    changed = true;
    if (next) return { ...l, crop: next };
    const { crop: _, ...rest } = l;
    return rest as typeof l;
  });
  return changed ? { ...doc, layers } : doc;
}

/**
 * The crop of a layer that shows what's inside a box of the canvas (document pixels; the assistant's): the box taken
 * into the layer's pixels (a turned layer's: the box around it there), kept inside the layer. Null when the box misses it.
 */
export function cropFromDocBox(t: LayerTransform, size: Size, box: CropRect): CropRect | null {
  const inv = invert(layerMatrix(t, size));
  const pts = [apply(inv, box.x, box.y), apply(inv, box.x + box.width, box.y), apply(inv, box.x, box.y + box.height), apply(inv, box.x + box.width, box.y + box.height)];
  const x0 = Math.min(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y));
  // Whole layer pixels, the nearest edges.
  const r = { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1) - Math.round(x0), height: Math.round(y1) - Math.round(y0) };
  return r.width > 0 && r.height > 0 ? clipRect(r, size) : null;
}

// --- the canvas ---

/** A canvas crop: whole document pixels, possibly past the canvas (growing it), at most `MAX_CANVAS_SIDE` a side. */
export function canvasCropRect(r: CropRect): CropRect | null {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const width = Math.round(r.x + r.width) - x;
  const height = Math.round(r.y + r.height) - y;
  return width >= 1 && height >= 1 && width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE ? { x, y, width, height } : null;
}

/** Whether a layer's mask is in document pixels: an adjustment's, a generator's, and a 2D-canvas layer's (text, shapes). */
export const maskInDocument = (l: PhotoLayer) => !isPlaced(l) || l.kind === "text" || l.kind === "shape";

/** The masks a canvas crop must move (those in document pixels: `maskInDocument`), once each. */
export function documentMasks(doc: PhotoProject): SurfaceId[] {
  const ids = new Set<SurfaceId>();
  for (const l of doc.layers) if (maskInDocument(l) && l.mask?.surface) ids.add(l.mask.surface);
  return [...ids];
}

/** A generator with each handle that has a place moved by (dx, dy) (one that follows the canvas follows the new one). */
function shiftedHandles(l: PhotoLayer, dx: number, dy: number): PhotoLayer {
  if (l.kind !== "generator") return l;
  const def = effectDefinition(l.effect.type);
  if (!def || unavailableReason(l.effect, "generator")) return l;
  let params = l.effect.params;
  for (const spec of def.params) {
    const v = params[spec.key];
    if (spec.kind !== "point" || !Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number") continue;
    if (params === l.effect.params) params = { ...params };
    params[spec.key] = [(v as DocPoint)[0] + dx, (v as DocPoint)[1] + dy] as DocPoint;
  }
  return params === l.effect.params ? l : { ...l, effect: { ...l.effect, params } };
}

/** A selection moved by (dx, dy) and kept to a canvas of `canvas` (nothing selected outside it); null when nothing's left. */
export function shiftSelection(s: PhotoSelection, dx: number, dy: number, canvas: Size): PhotoSelection | null {
  if (s.kind === "rect") {
    const r = clipRect({ x: s.x + dx, y: s.y + dy, width: s.width, height: s.height }, canvas);
    return r ? { kind: "rect", ...r } : null;
  }
  const x = s.x + dx;
  const y = s.y + dy;
  // A mask's box is whole pixels; whole-pixel shifts keep it so.
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(canvas.width, x + s.width);
  const y1 = Math.min(canvas.height, y + s.height);
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === x && y0 === y && x1 === x + s.width && y1 === y + s.height) return { ...s, x, y };
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const from = (row + y0 - y) * s.width + (x0 - x);
    data.set(s.data.subarray(from, from + width), row * width);
  }
  const out: MaskSelection = { kind: "mask", x: x0, y: y0, width, height, data };
  return data.some((v) => v > 0) ? out : null;
}

/**
 * The canvas cropped to `box` (whole document pixels, from `canvasCropRect`; past the canvas grows it): one edit of
 * the document and the selection. The canvas takes the box's size and everything placed in document pixels moves by
 * its corner: image and pixel layers' transforms, generators' handles, the selection (kept to the new canvas), and
 * adjustment and generator layers' masks, whose moved surfaces are `masks` (old id → new: made by the tab,
 * `shiftSurface`). Nothing is resampled or deleted: layers keep their pixels past the canvas. Throws when a mask
 * that had to move isn't in `masks` (it would no longer line up).
 */
export function cropCanvas(state: PhotoState, box: CropRect, masks: ReadonlyMap<SurfaceId, SurfaceId | null> = new Map()): PhotoState {
  const r = canvasCropRect(box);
  if (!r) return state;
  const { doc } = state;
  const dx = -r.x;
  const dy = -r.y;
  if (!dx && !dy && r.width === doc.canvas.width && r.height === doc.canvas.height) return state;
  const canvas = { ...doc.canvas, width: r.width, height: r.height };
  const layers = dx || dy
    ? doc.layers.map((l) => {
        let next = isPlaced(l) ? { ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } } : shiftedHandles(l, dx, dy);
        if (maskInDocument(next) && next.mask?.surface) {
          if (!masks.has(next.mask.surface)) throw new Error(`The mask of "${l.name}" wasn't moved with the canvas.`);
          next = { ...next, mask: { surface: masks.get(next.mask.surface)! } };
        }
        return next;
      })
    : doc.layers;
  const selection = state.selection ? shiftSelection(state.selection, dx, dy, canvas) : null;
  return { doc: { ...doc, canvas, layers }, selection };
}

/** "4:5", "16:9", "1.5": a ratio of width to height, or null. */
export function parseRatio(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:[:x×/]\s*(\d+(?:\.\d+)?))?\s*$/i.exec(text);
  if (!m) return null;
  const r = Number(m[1]) / (m[2] === undefined ? 1 : Number(m[2]));
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** The largest box of `ratio` (width / height) inside `within`, centred on it. */
export function ratioBox(within: CropRect, ratio: number): CropRect {
  const width = Math.min(within.width, within.height * ratio);
  const height = width / ratio;
  return { x: within.x + (within.width - width) / 2, y: within.y + (within.height - height) / 2, width, height };
}
