/**
 * Merging layers (Photoshop's Merge Down, Merge Layers and Merge Visible, ⌘E): the layers become one image layer
 * of their composite, made by rendering them alone. Pure: what's merged, what's rendered and where the result goes.
 * The tab renders it, the server keeps it as the project's media, and `replaceWithMerged` puts it in their place
 * (one undo step; the images merged stay in the project's media, so undo brings them back as they were).
 */
import { findLayer } from "./edits.ts";
import type { Size } from "./geometry.ts";
import { cropOf, croppedBounds } from "./crop.ts";
import { bounds, layerMatrix } from "./layers.ts";
import { filtersReach } from "./render-plan.ts";
import { type ImageLayer, MAX_CANVAS_SIDE, type PhotoLayer, type PhotoProject, type PlacedLayer, hasContent, isPlaced } from "./types.ts";

/** Merge Down (one layer into the one below it), Merge Layers (those selected) or Merge Visible (every visible one). */
export type MergeKind = "down" | "selected" | "visible";

export interface MergePlan {
  /** The layers the result replaces, bottom to top. */
  ids: string[];
  /**
   * What's rendered: the merged layers alone, where they are, on a transparent canvas the size of `box`, whose
   * top-left is document point `box.x, box.y` (the render's origin: nothing moves, so masks stay put).
   */
  doc: PhotoProject;
  /** Where the result goes, in whole document pixels: the box around the merged images (within the canvas when that's too big). */
  box: { x: number; y: number; width: number; height: number };
  /** The result's name: the lower layer's for Merge Down, the topmost's otherwise (Photoshop's). */
  name: string;
}

/** What ⌘E merges: the layers selected, or with one selected, it and the layer below (Merge Down). */
export function mergeKindOf(selected: readonly string[]): MergeKind {
  return selected.length === 1 ? "down" : "selected";
}

/**
 * Plans a merge, or says why it can't be done (the message is the user's and the assistant's). Hidden layers are
 * left as they are; adjustments change only the merged layers below them, and one with no merged image below it
 * goes (it changed nothing in the result). `sizeOf` is an image layer's source size, null while it's missing.
 */
export function planMerge(doc: PhotoProject, kind: MergeKind, selected: readonly string[], sizeOf: (layer: PlacedLayer) => Size | null): MergePlan | { error: string } {
  let layers: PhotoLayer[];
  if (kind === "down") {
    const index = doc.layers.findIndex((l) => l.id === selected[0]);
    if (index < 0) return { error: "Select a layer to merge down." };
    if (index === 0) return { error: "There's no layer below it to merge into." };
    layers = [doc.layers[index - 1], doc.layers[index]];
    if (layers[0].kind === "adjustment") return { error: `The layer below ("${layers[0].name}") is an adjustment layer: it has no pixels to merge into.` };
    if (!layers[0].visible) return { error: `The layer below ("${layers[0].name}") is hidden: show it to merge into it.` };
    if (!layers[1].visible) return { error: "The layer is hidden: show it to merge it down." };
  } else {
    const wanted = new Set(kind === "visible" ? doc.layers.filter((l) => l.visible).map((l) => l.id) : selected.filter((id) => findLayer(doc, id)));
    layers = doc.layers.filter((l) => wanted.has(l.id) && l.visible);
    if (layers.length < 2) return { error: kind === "visible" ? "There's only one visible layer: nothing to merge." : "Select two or more visible layers to merge." };
  }
  const contents = layers.filter(hasContent);
  if (contents.length === 0) return { error: "Merging needs an image, pixel or generator layer: adjustments alone have no pixels to merge into." };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of contents) {
    let b = { x0: 0, y0: 0, x1: doc.canvas.width, y1: doc.canvas.height };
    if (isPlaced(l)) {
      const size = sizeOf(l);
      if (!size) return { error: `"${l.name}" has no image (it's missing or unreadable), so it can't be merged.` };
      // A glow spreads past its layer: the merged image keeps it.
      const reach = filtersReach(l);
      // What shows of it (inside its crop).
      const box = l.crop ? croppedBounds(layerMatrix(l.transform, size), cropOf(l, size)) : bounds(l.transform, size);
      b = { x0: box.x0 - reach, y0: box.y0 - reach, x1: box.x1 + reach, y1: box.y1 + reach };
    }
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  // Whole pixels, tolerating a last-digit error (a layer exactly on the canvas stays exactly on it).
  x0 = Math.floor(x0 + 1e-6);
  y0 = Math.floor(y0 + 1e-6);
  x1 = Math.ceil(x1 - 1e-6);
  y1 = Math.ceil(y1 - 1e-6);
  // What's past the canvas is kept, as Photoshop's merged layers keep it, unless that makes the image too big.
  if (x1 - x0 > MAX_CANVAS_SIDE || y1 - y0 > MAX_CANVAS_SIDE) {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(doc.canvas.width, x1);
    y1 = Math.min(doc.canvas.height, y1);
  }
  if (x1 <= x0 || y1 <= y0) return { error: "The merged layers are all off the canvas: nothing would show." };
  const drawn = layers.slice(layers.findIndex(hasContent));
  return {
    ids: layers.map((l) => l.id),
    doc: { ...doc, canvas: { width: x1 - x0, height: y1 - y0, background: null }, layers: drawn },
    box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    name: kind === "down" ? layers[0].name : layers[layers.length - 1].name,
  };
}

/** The image layer a merge makes: its render, at 100%, where the merged layers were. */
export function mergedLayer(plan: MergePlan, id: string, mediaId: string): ImageLayer {
  const { box } = plan;
  return { id, kind: "image", name: plan.name, visible: true, opacity: 1, mediaId, transform: { x: box.x + box.width / 2, y: box.y + box.height / 2, scaleX: 1, scaleY: 1, rotation: 0 } };
}

/**
 * The merged layers replaced by `layer`, in the topmost one's place. Null when they've changed since the merge was
 * planned (`planned` is the document it was planned on): the render would no longer be what they show.
 */
export function replaceWithMerged(doc: PhotoProject, planned: PhotoProject, ids: readonly string[], layer: ImageLayer): PhotoProject | null {
  const merged = new Set(ids);
  for (const id of ids) {
    const now = findLayer(doc, id);
    if (!now || now !== findLayer(planned, id)) return null;
  }
  const top = doc.layers.findLastIndex((l) => merged.has(l.id));
  const layers: PhotoLayer[] = [];
  doc.layers.forEach((l, i) => {
    if (!merged.has(l.id)) layers.push(l);
    if (i === top) layers.push(layer);
  });
  return { ...doc, layers };
}
