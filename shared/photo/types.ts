/**
 * The photo suite's document (docs/photo/architecture.md, "The document"): a canvas and its layers, bottom to
 * top. Coordinates are document pixels, x right, y down, from the top-left pixel edge. A document never holds
 * pixels: an image layer names project media, and painted pixels and masks are surfaces named by hash
 * (`shared/photo/surfaces.ts`).
 *
 * Image layers (a placed source, kept whole: transforming resamples the source, never the last result); from
 * version 2, adjustment layers (exposure, curves: they change what's below them); from version 3, pixel layers
 * (painted pixels) and every layer's mask; from version 4, Blending Options (a layer's blend mode, Fill, channels and
 * Blend If), the document's compositing, layer styles and Global Light; from version 5, filters and generator layers
 * (F4: light); from version 7, text layers (the Type tool). Other kinds arrive with their renderers, through versioned migrations
 * (`normalizePhotoProject`).
 */
import type { DocumentBase } from "../suites.ts";

/**
 * 7: text layers (the Type tool, docs/photo/tools/type.md: words and how they're set, laid out by the tab and drawn by
 * the browser's text engine) and a layer's crop (image, pixel and text layers' `crop`: a rectangle of their own pixels,
 * everything outside it hidden; absent: none), 6: the document's patterns (Layer Style L4: Pattern Overlay, pattern
 * strokes, Bevel's Texture), 5: light (F4:
 * filters, generator layers, the `film` highlights by default), 4: Layer Style (Blending Options and
 * compositing, then layer styles and Global Light: fields absent at their defaults), 3: pixel layers and masks, 2:
 * adjustment layers. An older document is a valid newer one (compositing in linear light and its highlights
 * clipped, as it was drawn then); an older app refuses a newer one.
 */
export const PHOTO_VERSION = 7;

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

/**
 * Photoshop's layer blend modes (docs/photo/layer-style/blend-modes.md, measured in photoshop-measurements.md), in
 * its menu's order. What each does is `shared/photo/reference/blend.ts`; their names and groups `blending.ts`.
 */
export type BlendMode =
  | "normal"
  | "dissolve"
  | "darken"
  | "multiply"
  | "color-burn"
  | "linear-burn"
  | "darker-color"
  | "lighten"
  | "screen"
  | "color-dodge"
  | "linear-dodge"
  | "lighter-color"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "vivid-light"
  | "linear-light"
  | "pin-light"
  | "hard-mix"
  | "difference"
  | "exclusion"
  | "subtract"
  | "divide"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/**
 * One Blend If range on 0..255 encoded values, Photoshop's handles: [black low, black high, white low, white high],
 * ordered. Values outside [black low, white high] are left out, ramping in across a split handle.
 */
export type BlendRange = [number, number, number, number];

/** Blend If's ranges for one of Gray, Red, Green, Blue: This Layer's (Photoshop's "Current Layer") and Underlying Layer's. */
export interface BlendIfChannel {
  layer: BlendRange;
  underlying: BlendRange;
}

/** Blend If, by the menu's entries: each entry absent passes everything, and every entry present applies at once. */
export type BlendIf = Partial<Record<"gray" | "red" | "green" | "blue", BlendIfChannel>>;

/**
 * Blending Options' advanced part (docs/photo/layer-style/advanced-blending.md). Absent fields are Photoshop's
 * defaults. Knockout, the "as Group" options and the masks hiding effects arrive with groups, clipping and layer
 * effects (README.md, decision 3).
 */
export interface BlendingOptions {
  /** Channels that blend; an excluded one keeps what's below. Absent: all three. */
  channels?: { r: boolean; g: boolean; b: boolean };
  blendIf?: BlendIf;
  /** Blend Interior Effects as Group: the overlays, inner glow and inner shadow join the layer's pixels before its mode and Fill. */
  interiorAsGroup?: boolean;
  /** Layer Mask Hides Effects: the effects are made from the layer's pixels unmasked, then the mask hides them too. */
  maskHidesEffects?: boolean;
}

/**
 * A layer's style (Photoshop's fx: docs/photo/layer-style/README.md, phase L2): its effects, each an
 * `EffectInstance` of a style definition (`shared/photo/style/definitions.ts`), kept in drawing order, bottom
 * first. `enabled` is the Layers panel's "Effects" eye (Hide All Effects).
 */
export interface LayerStyle {
  enabled: boolean;
  effects: EffectInstance[];
}

/** The document's one light (Layer › Layer Style › Global Light): what effects with Use Global Light follow. */
export interface GlobalLight {
  /** Degrees, where the light comes from: anticlockwise from 3 o'clock. */
  angle: number;
  /** Degrees above the horizon. */
  altitude: number;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1. */
  opacity: number;
  /** Absent: no mask. */
  mask?: LayerMask;
  /** Absent: normal. */
  blend?: BlendMode;
  /** 0..1, absent 1. Fades the layer's own pixels but not its effects; the same as Opacity but in eight modes. */
  fill?: number;
  /** Absent: every option at its default. */
  blending?: BlendingOptions;
  /** Layer effects (fx); absent when it has none. */
  style?: LayerStyle;
}

/**
 * What a layer with content of its own carries from version 5: filters (Photoshop's Smart Filters; the glow first),
 * applied in order to its content in linear light, before its mask (the first applies first; the Layers panel lists
 * them bottom up, as Photoshop does).
 */
interface Filtered {
  /** Absent: none (only fields that exist are written). */
  filters?: EffectInstance[];
  /** The "Filters" row's eye: false bypasses them all, keeping each one's own setting. Absent: true. */
  filtersEnabled?: false;
}

/**
 * A layer's crop (version 7, the Crop tool with a layer selected: docs/photo/tools/crop.md): a rectangle of its own
 * pixels (an image's source pixels, a pixel layer's), x right and y down from its top-left edge. Everything of the
 * layer outside it is hidden, before its filters, mask and style; its pixels are kept, so the crop can be widened
 * again. Inside the layer and never empty (`normalizeCrop`).
 */
export interface LayerCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What a layer with pixels of its own and a place carries from version 7. */
interface Croppable {
  /** Absent: the whole layer shows. */
  crop?: LayerCrop;
}

/** A source image placed on the canvas, kept whole (Photoshop's embedded Smart Object, for this). */
export interface ImageLayer extends LayerBase, Filtered, Croppable {
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

/** A point in document pixels: [x, y]. */
export type DocPoint = [number, number];

/**
 * One element of an `elements` parameter (a flare's ghosts, halos...): a stable id (editing one never renumbers the
 * others), its type, whether it's shown, and its own parameters by its type's specs.
 */
export interface EffectElement {
  id: string;
  type: string;
  enabled: boolean;
  [param: string]: number | boolean | string;
}

/** One of a contour's points on 0..255: smooth, or a corner where the curve breaks (Photoshop's Contour Editor). */
export interface ContourPoint {
  x: number;
  y: number;
  corner?: true;
}

/**
 * A contour (docs/photo/layer-style/dialog.md, "Contours"; measured: photoshop-measurements.md): how an effect's
 * falloff is reshaped, a curve on 0..255 through its points (natural cubic splines broken at corners). `name` is
 * the preset's ("Linear", "Cone"…) or "Custom".
 */
export interface Contour {
  name: string;
  points: ContourPoint[];
}

/** A gradient's colour stop: where (0..1), the colour (sRGB "#rrggbb"), and where between it and the next the mix is half (0..1, absent ½). */
export interface GradientColourStop {
  at: number;
  colour: string;
  mid?: number;
}

/** A gradient's opacity stop (0..1 each). */
export interface GradientOpacityStop {
  at: number;
  opacity: number;
  mid?: number;
}

/**
 * A gradient (Photoshop's Gradient Editor): colour stops and opacity stops, kept apart as Photoshop keeps them, and
 * how it interpolates (stroke-satin-overlays.md, "Gradient Overlay": Classic measured, Linear in linear light,
 * Perceptual in OKLab).
 */
export interface Gradient {
  name: string;
  colours: GradientColourStop[];
  opacities: GradientOpacityStop[];
  /** Also Photoshop's Smooth and Stripes (the Gradient tool's Method: docs/photo/tools/gradient.md). */
  method: "classic" | "linear" | "perceptual" | "smooth" | "stripes";
}

/** A parameter's value: what the definitions' specs allow (`shared/photo/effects/params.ts`). */
export type EffectParamValue = number | boolean | string | null | CurveSet | DocPoint | EffectElement[] | Contour | Gradient;

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
export interface PixelLayer extends LayerBase, Filtered, Croppable {
  kind: "pixel";
  surface: SurfaceId | null;
  /** Its pixels: the surface's extent. */
  size: { width: number; height: number };
  transform: LayerTransform;
}

/**
 * A generator layer (version 5): content made by its effect (a lens flare), in document pixels. It has no transform:
 * its handles are document points in its parameters (Move moves them). Its mask is in document pixels, as an
 * adjustment's is. It blends as any layer does (a new flare adds its light: `blend` "linear-dodge").
 */
export interface GeneratorLayer extends LayerBase, Filtered {
  kind: "generator";
  /** A definition of kind "generator". */
  effect: EffectInstance;
  /**
   * Where it blends: "linear" in linear light whatever the document's compositing (a flare's light adds physically,
   * a deliberate difference from Photoshop). Absent: the document's.
   */
  blendSpace?: "linear";
}

/** A text layer's font: an installed family and one of its styles (the CSS face that selects it), and its size. */
export interface TextFont {
  family: string;
  /** The style's name, as the font calls it ("Bold Italic"). */
  style: string;
  /** CSS weight, 1..1000. */
  weight: number;
  italic: boolean;
  /** CSS font-stretch keyword; absent: normal. */
  stretch?: string;
  /** Pixels (Photoshop's points at 72 ppi). */
  size: number;
}

/** How a text's lines sit: on the origin (point text) or in the box (paragraph text). Justify is paragraph text's. */
export type TextAlign = "left" | "center" | "right" | "justify";

/**
 * A text layer (version 7, Photoshop's type layer: docs/photo/tools/type.md): its words and how they're set, drawn by
 * the browser's text engine in the installed fonts. Point text (`box` null) grows from its origin, the first baseline
 * at the alignment's point; paragraph text wraps in its box, whose top-left is the origin. `size` and `origin` are its
 * frame, measured by the tab (the lines and the glyphs' ink): what the transform places, as an image's pixels. Its mask
 * is in document pixels, as an adjustment's.
 */
export interface TextLayer extends LayerBase, Filtered {
  kind: "text";
  /** Text isn't cropped (`isCroppable`): its frame is its words'. Declared so a placed layer's crop reads alike. */
  crop?: undefined;
  /** "\n" between lines. */
  text: string;
  font: TextFont;
  /** sRGB "#rrggbb". */
  colour: string;
  align: TextAlign;
  /** Pixels between baselines; null: Auto (1.2 × the size). */
  leading: number | null;
  /** Thousandths of an em, added after every character. */
  tracking: number;
  /** Paragraph text's box in layer pixels; null: point text. */
  box: { width: number; height: number } | null;
  /** Its frame in layer pixels (what the transform places). */
  size: { width: number; height: number };
  /** Where the text's origin is in its frame. */
  origin: { x: number; y: number };
  transform: LayerTransform;
}

export type PhotoLayer = ImageLayer | PixelLayer | AdjustmentLayer | GeneratorLayer | TextLayer;

/** A layer with pixels of its own and a place on the canvas: what the Move tool moves. */
export type PlacedLayer = ImageLayer | PixelLayer | TextLayer;

export const isPlaced = (layer: PhotoLayer): layer is PlacedLayer => layer.kind === "image" || layer.kind === "pixel" || layer.kind === "text";

/** A placed layer the Crop tool crops (docs/photo/tools/crop.md): an image or pixel layer. */
export type CroppableLayer = ImageLayer | PixelLayer;

export const isCroppable = (layer: PhotoLayer): layer is CroppableLayer => layer.kind === "image" || layer.kind === "pixel";

/** A layer with content of its own (pixels, or made by a generator): one that can carry filters. */
export type ContentLayer = ImageLayer | PixelLayer | GeneratorLayer | TextLayer;

export const hasContent = (layer: PhotoLayer): layer is ContentLayer => layer.kind !== "adjustment";

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

/**
 * Any other selection (docs/photo/selections.md): each pixel's coverage, 0..255 as Photoshop's 8-bit selection
 * channel, over its box (whole pixels inside the canvas; nothing is selected outside it). The lasso, an ellipse,
 * the magic wand, Quick Selection, Select Subject and every combination make one. Immutable: an edit makes another,
 * so history compares them by identity.
 */
export interface MaskSelection {
  kind: "mask";
  x: number;
  y: number;
  width: number;
  height: number;
  /** `width × height` coverages, row by row. */
  data: Uint8Array;
}

export type PhotoSelection = RectSelection | MaskSelection;

/** How a new selection meets the one there (Photoshop's options bar; Shift adds, Alt subtracts, both intersect). */
export type SelectionMode = "new" | "add" | "subtract" | "intersect";

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

/**
 * How layers mix (docs/photo/layer-style/README.md, decision 1). "photoshop" mixes encoded (sRGB) values, modes,
 * opacity and soft edges alike, as Photoshop does (measured); "linear" mixes linear light. Pixels are linear light
 * either way: only the mixing differs.
 */
export type Compositing = "photoshop" | "linear";

/**
 * A pattern the document keeps (Photoshop's patterns in a file: those its effects use, and those defined in it): its
 * pixels a surface (`rgba16f`, premultiplied linear light, `size` pixels), tiled where it's used. Built-in patterns
 * aren't kept: they're made by code (`style/patterns.ts`), named `builtin:<id>`.
 */
export interface PhotoPattern {
  id: string;
  name: string;
  surface: SurfaceId;
  size: { width: number; height: number };
}

export interface PhotoProject extends DocumentBase {
  version: typeof PHOTO_VERSION;
  canvas: PhotoCanvas;
  /** Absent: none. */
  patterns?: PhotoPattern[];
  /** Absent: "linear" (photos made before version 4). New photos are "photoshop". */
  compositing?: Compositing;
  /** Absent: 120° and 30°, Photoshop's. */
  globalLight?: GlobalLight;
  /**
   * How light above white leaves (rendering.md, "The output transform"); film rolls it off, clip clips it. Photos
   * from before version 5 clip: they were always drawn that way.
   */
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
  { id: "square-1000", label: "Square 1000", width: 1000, height: 1000 },
  { id: "thumbnail", label: "Thumbnail", width: 1280, height: 720 },
  { id: "hd", label: "HD", width: 1920, height: 1080 },
];

/** The largest canvas side: WebGPU's tiles have no limit, but exports and memory do. */
export const MAX_CANVAS_SIDE = 30_000;
