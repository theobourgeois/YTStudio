/**
 * The photo suite's document (docs/photo/architecture.md, "The document"): a canvas and its layers, bottom to
 * top. Coordinates are document pixels, x right, y down, from the top-left pixel edge. A document never holds
 * pixels: an image layer names project media, and later layers will name surfaces by hash.
 *
 * Image layers (a placed source, kept whole: transforming resamples the source, never the last result) and, from
 * version 2, adjustment layers (exposure, curves: they change what's below them). Other kinds arrive with their
 * renderers, through versioned migrations (`normalizePhotoProject`).
 */
import type { DocumentBase } from "../suites.ts";

/** 2: adjustment layers. A version-1 document is a valid version-2 one; an older app refuses a version-2 one. */
export const PHOTO_VERSION = 2;

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

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1. */
  opacity: number;
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

export type PhotoLayer = ImageLayer | AdjustmentLayer;

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
