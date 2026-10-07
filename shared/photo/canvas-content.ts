/**
 * Layers whose pixels the tab draws with a 2D canvas (docs/photo/tools/type.md, "Drawing it"): a text layer's words
 * today, any other content drawn by the browser (vector shapes) the same way. Each is drawn in document pixels through
 * the layer's whole transform, so it's sharp at any scale or angle, into a raster: a box of whole document pixels
 * (`CanvasRaster`). The plan makes one `CanvasNode` per such layer; the renderer keeps a drawn raster per key
 * (`render/canvas-content.ts`) and draws it as a pixel layer's pixels are drawn, texel for texel.
 *
 * A new kind of canvas content: a member of `CanvasContent` (what's drawn, in the layer's own pixels), a case in
 * `canvasContentOf` (what of a layer is drawn; null for other layers), and a case in the tab's
 * `drawCanvasContent` (`src/suites/photo/render/canvas-content.ts`).
 */
import { type Affine, apply, layerMatrix } from "./layers.ts";
import type { LayerTransform, PhotoLayer, PhotoProject, TextLayer } from "./types.ts";

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

/** What a canvas layer draws, in its own pixels (one member per kind). */
export type CanvasContent = TextContent;

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
  return null;
}

/** The most pixels a side of a raster may have (past it, it's cut). */
const MAX_RASTER_SIDE = 16_384;

/**
 * A canvas layer's raster: the whole document pixels its frame covers (and its overhang, two pixels more), cut to the
 * canvas grown by `reach` (what its effects and filters reach); the canvas itself when `masked` (such a layer's mask is
 * in document pixels, read at the raster's). Null when nothing of it can show. `hash` makes its key (the plan's).
 */
export function canvasRaster(doc: PhotoProject, facts: CanvasLayerFacts, reach: number, masked: boolean, hash: (text: string) => string): CanvasRaster | null {
  const m = layerMatrix(facts.transform, facts.size);
  const { width: W, height: H } = facts.size;
  const pts = [apply(m, 0, 0), apply(m, W, 0), apply(m, 0, H), apply(m, W, H)];
  let [x0, y0, x1, y1] = [0, 0, doc.canvas.width, doc.canvas.height];
  if (!masked) {
    const r = Math.ceil(reach) + 2;
    const pad = 2 + Math.ceil(facts.overhang * Math.max(Math.abs(facts.transform.scaleX), Math.abs(facts.transform.scaleY)));
    x0 = Math.max(-r, Math.floor(Math.min(...pts.map((p) => p.x))) - pad);
    y0 = Math.max(-r, Math.floor(Math.min(...pts.map((p) => p.y))) - pad);
    x1 = Math.min(doc.canvas.width + r, Math.ceil(Math.max(...pts.map((p) => p.x))) + pad);
    y1 = Math.min(doc.canvas.height + r, Math.ceil(Math.max(...pts.map((p) => p.y))) + pad);
  }
  x1 = Math.min(x1, x0 + MAX_RASTER_SIDE);
  y1 = Math.min(y1, y0 + MAX_RASTER_SIDE);
  if (x1 <= x0 || y1 <= y0) return null;
  const matrix: Affine = [m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0];
  return { content: facts.content, matrix, x: x0, y: y0, width: x1 - x0, height: y1 - y0, key: hash(`${JSON.stringify(facts.content)}|${matrix.join(",")}|${x1 - x0}x${y1 - y0}`) };
}
