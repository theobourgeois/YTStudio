/**
 * Layers whose pixels the tab draws with a 2D canvas (docs/photo/tools/type.md, "Drawing it"): a text layer's words,
 * a shape layer's vector (docs/photo/tools/shapes.md). Each is drawn in document pixels through
 * the layer's whole transform, so it's sharp at any scale or angle, into a raster: a box of whole document pixels
 * (`CanvasRaster`). The plan makes one `CanvasNode` per such layer; the renderer keeps a drawn raster per key
 * (`render/canvas-content.ts`) and draws it as a pixel layer's pixels are drawn, texel for texel.
 *
 * A new kind of canvas content: a member of `CanvasContent` (what's drawn, in the layer's own pixels), a case in
 * `canvasContentOf` (what of a layer is drawn; null for other layers), and a case in the tab's
 * `drawCanvasContent` (`src/suites/photo/render/canvas-content.ts`).
 */
import { type Affine, apply, layerMatrix } from "./layers.ts";
import { shapeOverhang } from "./shape-drawing.ts";
import type { LayerTransform, PhotoLayer, PhotoProject, ShapeLayer, TextLayer } from "./types.ts";

/** A text layer's words and their setting (`TextLayer`'s), drawn from its origin in its layer pixels. */
export interface TextContent {
  kind: "text";
  text: string;
  font: TextLayer["font"];
  colour: string;
  align: TextLayer["align"];
  leading: number | null;
  tracking: number;
  box: TextLayer["box"];
  origin: { x: number; y: number };
}

/**
 * A shape layer's geometry, place and paint (`ShapeLayer`'s, docs/photo/tools/shapes.md), and its id (what seeds a
 * hand-drawn shape's wobble). It's drawn in document pixels (`shapeDrawing`: its strokes keep their width whatever
 * the transform), so the raster's matrix only says where its top-left is.
 */
export interface ShapeContent {
  kind: "shape";
  id: string;
  shape: ShapeLayer["shape"];
  size: ShapeLayer["size"];
  transform: LayerTransform;
  paint: ShapeLayer["paint"];
}

/** What a canvas layer draws, in its own pixels (one member per kind). */
export type CanvasContent = TextContent | ShapeContent;

/** A layer drawn by the 2D canvas, as the renderer needs it: what it draws, and where it lands on the pixel grid. */
export interface CanvasRaster {
  content: CanvasContent;
  /** Layer pixels → raster pixels (the layer's matrix, less the raster's top-left). */
  matrix: Affine;
  /** Its top-left in document pixels (whole), and its size. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** What its pixels are keyed by (content, matrix, size). */
  key: string;
}

/** A layer the 2D canvas draws: its place, its frame (layer pixels), and how far its ink may pass the frame. */
export interface CanvasLayerFacts {
  content: CanvasContent;
  transform: LayerTransform;
  size: { width: number; height: number };
  /** Layer pixels its drawing may reach past the frame (a glyph's overhang, a stroke's half). */
  overhang: number;
}

/** What of a layer the 2D canvas draws, or null for layers it doesn't. */
export function canvasContentOf(layer: PhotoLayer): CanvasLayerFacts | null {
  if (layer.kind === "text") {
    const { text, font, colour, align, leading, tracking, box, origin } = layer;
    return { content: { kind: "text", text, font, colour, align, leading, tracking, box, origin }, transform: layer.transform, size: layer.size, overhang: 0.25 * font.size };
  }
  if (layer.kind === "shape") {
    const { id, shape, size, transform, paint } = layer;
    return { content: { kind: "shape", id, shape, size, transform, paint }, transform, size, overhang: shapeOverhang(layer) };
  }
  return null;
}

/** The most pixels a side of a raster may have (past it, it's cut). */
const MAX_RASTER_SIDE = 16_384;

/**
 * A canvas layer's raster: the whole document pixels its frame covers (and its overhang, two pixels more), cut to the
 * region rendered (the canvas, or a merge's box: `region`, in document pixels) grown by `reach` (what its effects and
 * filters reach); from the document's top-left to the region's far corner when `masked` (such a layer's mask is in
 * document pixels, read at the raster's). Null when nothing of it can show. `hash` makes its key (the plan's).
 */
export function canvasRaster(
  doc: PhotoProject,
  facts: CanvasLayerFacts,
  reach: number,
  masked: boolean,
  hash: (text: string) => string,
  region: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: doc.canvas.width, y1: doc.canvas.height },
): CanvasRaster | null {
  const m = layerMatrix(facts.transform, facts.size);
  const { width: W, height: H } = facts.size;
  const pts = [apply(m, 0, 0), apply(m, W, 0), apply(m, 0, H), apply(m, W, H)];
  let [x0, y0, x1, y1] = [0, 0, Math.max(doc.canvas.width, Math.ceil(region.x1)), Math.max(doc.canvas.height, Math.ceil(region.y1))];
  if (!masked) {
    const r = Math.ceil(reach) + 2;
    const pad = 2 + Math.ceil(facts.overhang * Math.max(Math.abs(facts.transform.scaleX), Math.abs(facts.transform.scaleY)));
    x0 = Math.max(Math.floor(region.x0) - r, Math.floor(Math.min(...pts.map((p) => p.x))) - pad);
    y0 = Math.max(Math.floor(region.y0) - r, Math.floor(Math.min(...pts.map((p) => p.y))) - pad);
    x1 = Math.min(Math.ceil(region.x1) + r, Math.ceil(Math.max(...pts.map((p) => p.x))) + pad);
    y1 = Math.min(Math.ceil(region.y1) + r, Math.ceil(Math.max(...pts.map((p) => p.y))) + pad);
  }
  x1 = Math.min(x1, x0 + MAX_RASTER_SIDE);
  y1 = Math.min(y1, y0 + MAX_RASTER_SIDE);
  if (x1 <= x0 || y1 <= y0) return null;
  const matrix: Affine = [m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0];
  // Keyed by what its pixels are, not where: moved by whole pixels, a layer's raster is the one already drawn.
  const content = facts.content;
  const keyed = content.kind === "shape" ? { ...content, transform: { ...content.transform, x: content.transform.x - x0, y: content.transform.y - y0 } } : content;
  return { content, matrix, x: x0, y: y0, width: x1 - x0, height: y1 - y0, key: hash(`${JSON.stringify(keyed)}|${matrix.join(",")}|${x1 - x0}x${y1 - y0}`) };
}
