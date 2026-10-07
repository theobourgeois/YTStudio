/**
 * What the Move tool moves and transforms: the selected images and pixel layers as one frame. One layer's frame is its own
 * transform; several share the box around them (Photoshop's transform box for several layers), and dragging its
 * handles carries each layer by the same map. Pure, in document pixels.
 */
import type { Size } from "@shared/photo/geometry";
import { canDistort, setTransform } from "@shared/photo/edits";
import { type Quad, composeHomography, invertHomography, isProjective, layerProjection, project, quadOf, transformFromQuad } from "@shared/photo/projective";
import { cropOf, partBounds, uncroppedTransform, visiblePlace } from "@shared/photo/crop";
import { bounds, compose, invert, layerMatrix, transformedBy } from "@shared/photo/layers";
import { type LayerTransform, type PhotoLayer, type PhotoProject, type PlacedLayer, isPlaced } from "@shared/photo/types";
import type { Box } from "./snap";

export interface Frame {
  /** The frame as a layer would be: its centre, scale and turn (several layers' starts at 100%, upright). */
  t: LayerTransform;
  size: Size;
  /** The images it carries. */
  ids: string[];
  /**
   * Whether it can stretch one way (edges, and Shift on a corner): always (several turned layers stretched one way
   * are skewed).
   */
  stretches: boolean;
  /** Whether it can be put in perspective (Distort, Perspective): only images and pixel layers can. */
  projective: boolean;
  /** The document with the frame at `next` (absolute: from where its layers were when the frame was taken). */
  place: (doc: PhotoProject, next: LayerTransform) => PhotoProject;
}

/** The frame of the selected images (`ids`, any order) among `layers`, or null when none is an image with a size. */
export function frameOf(layers: readonly PhotoLayer[], ids: readonly string[], sizeOf: (layer: PlacedLayer) => Size | null): Frame | null {
  const images = layers.flatMap((l) => {
    const size = isPlaced(l) && ids.includes(l.id) ? sizeOf(l) : null;
    return size && isPlaced(l) ? [{ layer: l, size }] : [];
  });
  if (images.length === 0) return null;
  if (images.length === 1) {
    const { layer, size } = images[0];
    // A cropped layer's frame is what shows of it; the layer moves with it, so the crop stays where it is on it.
    if (layer.crop) {
      const crop = cropOf(layer, size);
      const shown = visiblePlace(layer, size);
      return { t: shown.t, size: shown.size, ids: [layer.id], stretches: true, projective: canDistort(layer), place: (d, next) => setTransform(d, layer.id, uncroppedTransform(next, size, crop)) };
    }
    return { t: layer.transform, size, ids: [layer.id], stretches: true, projective: canDistort(layer), place: (d, next) => setTransform(d, layer.id, next) };
  }
  const box = unionBox(images.map(({ layer, size }) => (layer.crop ? partBounds(layer.transform, size, cropOf(layer, size)) : bounds(layer.transform, size))));
  const size = { width: Math.max(box.x1 - box.x0, 1e-6), height: Math.max(box.y1 - box.y0, 1e-6) };
  const t: LayerTransform = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, scaleX: 1, scaleY: 1, rotation: 0 };
  const from = invert(layerMatrix(t, size));
  return {
    t,
    size,
    ids: images.map(({ layer }) => layer.id),
    stretches: true,
    projective: images.every(({ layer }) => canDistort(layer)),
    place: (d, next) => {
      // In perspective, each layer is carried by its corners through the frame's map (one that can't be is left).
      if (isProjective(next)) {
        const h = composeHomography(layerProjection(next, size), invertHomography(layerProjection(t, size)));
        return images.reduce((acc, { layer, size: s }) => {
          const q = quadOf(layer.transform, s).map((c) => project(h, c.x, c.y));
          if (q.some((c) => !c)) return acc;
          const carried = transformFromQuad(q as unknown as Quad, s, layer.transform);
          return carried && (canDistort(layer) || !carried.perspective) ? setTransform(acc, layer.id, carried) : acc;
        }, d);
      }
      const m = compose(layerMatrix(next, size), from);
      return images.reduce((acc, { layer, size: s }) => {
        const carried = transformedBy(layer.transform, s, m);
        return carried && (canDistort(layer) || !carried.perspective) ? setTransform(acc, layer.id, carried) : acc;
      }, d);
    },
  };
}

/** The box around boxes. */
export function unionBox(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Whether two boxes overlap (a marquee touching a layer selects it, as Photoshop's does). */
export const touches = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
