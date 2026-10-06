/**
 * The photo suite's document (docs/photo/architecture.md, "The document"): a canvas and its layers, bottom to
 * top. Coordinates are document pixels, x right, y down, from the top-left pixel edge. A document never holds
 * pixels: an image layer names project media, and painted pixels and masks are surfaces named by hash
 * (`shared/photo/surfaces.ts`).
 *
 * Image layers (a placed source, kept whole: transforming resamples the source, never the last result); from
 * version 2, adjustment layers (exposure, curves: they change what's below them); from version 3, pixel layers
 * (painted pixels) and every layer's mask. Other kinds arrive with their renderers, through versioned migrations
 * (`normalizePhotoProject`).
 */
import type { DocumentBase } from "../suites.ts";

/**
 * 3: pixel layers and masks (2: adjustment layers). An older document is a valid version-3 one; an older app
 * refuses a newer one.
 */
export const PHOTO_VERSION = 3;

/**
 * A surface: the SHA-256 (lowercase hex) of its manifest's canonical JSON. The server has every manifest a saved
 * document names, and every tile those list (the publication gate).
 */
export type SurfaceId = string;

/**
 * Where a layer is: its centre in document pixels, its scale (negative mirrors) and its rotation in degrees,
 * clockwise. Layer pixel (u, v) lands at centre + R(rotation) · S(scale) · ((u, v) − size / 2). Kept as these five
 * numbers rather than a matrix so that typing 100% gives exactly 100%; skew and perspective would bring a matrix,
 * by migration.
 */
export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/**
 * A layer mask (Photoshop's): coverage, 1 where the layer shows and 0 where it's hidden, in the layer's own pixels
 * (an image's source pixels, a pixel layer's; an adjustment's are the document's), so it follows the layer. An
 * `r16f` surface whose fill is 1; null is a mask that reveals everything (nothing painted yet).
 */
export interface LayerMask {
  surface: SurfaceId | null;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1. */
  opacity: number;
  /** Absent: no mask. */
  mask?: LayerMask;
}

/** A source image placed on the canvas, kept whole (Photoshop's embedded Smart Object, for this). */
export interface ImageLayer extends LayerBase {
  kind: "image";
  /** The project media it shows. */
  mediaId: string;
  transform: LayerTransform;
}

/**
 * A curve's points as Photoshop shows them: [input, output] on 0..255 (fractions allowed), strictly increasing
 * input. 2 to 16 of them (`MAX_CURVE_POINTS`).
 */
export type CurvePoints = [number, number][];

/** Curves' parameter: the composite curve and one per channel (each applied before the composite). */
export interface CurveSet {
  rgb: CurvePoints;
  red: CurvePoints;
  green: CurvePoints;
  blue: CurvePoints;
}

/** A parameter's value: what the definitions' specs allow (`shared/photo/effects/params.ts`). */
export type EffectParamValue = number | boolean | string | CurveSet;

/**
 * An effect as a document holds it (docs/photo/effects/system.md, "Definition and instance"): its type and the
 * definition's version it was made with, and its parameters, validated by that definition. One whose type or
 * version this app doesn't know is kept exactly as it was and shown as unavailable, never reinterpreted.
 */
export interface EffectInstance {
  id: string;
  type: string;
  version: number;
  enabled: boolean;
  params: Record<string, EffectParamValue>;
}

/** An adjustment layer: its effect changes what's below it (Photoshop's adjustment layers), faded by its opacity. */
export interface AdjustmentLayer extends LayerBase {
  kind: "adjustment";
  effect: EffectInstance;
}

/**
 * Painted pixels (Photoshop's pixel layer): an `rgba16f` surface of `size` pixels, transparent where nothing is
 * painted (null: nothing yet), placed by its transform like an image (a new one covers the canvas at 100%).
 */
export interface PixelLayer extends LayerBase {
  kind: "pixel";
  surface: SurfaceId | null;
  /** Its pixels: the surface's extent. */
  size: { width: number; height: number };
  transform: LayerTransform;
}

export type PhotoLayer = ImageLayer | PixelLayer | AdjustmentLayer;

/** A layer with pixels of its own and a place on the canvas: what the Move tool moves. */
export type PlacedLayer = ImageLayer | PixelLayer;

export const isPlaced = (layer: PhotoLayer): layer is PlacedLayer => layer.kind !== "adjustment";

/**
 * A selection (Photoshop's marching ants), in document pixels: what limits painting and makes masks. Session state
 * kept in history (selecting is an undo step, as in Photoshop), never saved. A rectangle's edges cover pixels
 * fractionally (`shared/photo/selection.ts`).
 */
export interface RectSelection {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhotoSelection = RectSelection;

/** What history holds: the document and the selection (only the document is saved). */
export interface PhotoState {
  doc: PhotoProject;
  selection: PhotoSelection | null;
}

export interface PhotoCanvas {
  /** Whole document pixels. */
  width: number;
  height: number;
  /** What's under every layer, as sRGB "#rrggbb", or null for transparent (Photoshop's Background contents). */
  background: string | null;
}

export interface PhotoProject extends DocumentBase {
  version: typeof PHOTO_VERSION;
  canvas: PhotoCanvas;
  /** How light above white leaves (rendering.md, "The output transform"); film rolls it off, clip clips it. */
  output: { highlights: "film" | "clip" };
  /** Bottom to top. */
  layers: PhotoLayer[];
}

/** A canvas size the New photo choices offer (ux.md, "New photo"): short-form first, like the rest of the app. */
export interface CanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: "story", label: "Story / Reel", width: 1080, height: 1920 },
  { id: "portrait", label: "Portrait post", width: 1080, height: 1350 },
  { id: "square", label: "Square", width: 1080, height: 1080 },
  { id: "thumbnail", label: "Thumbnail", width: 1280, height: 720 },
  { id: "hd", label: "HD", width: 1920, height: 1080 },
];

/** The largest canvas side: WebGPU's tiles have no limit, but exports and memory do. */
export const MAX_CANVAS_SIDE = 30_000;
