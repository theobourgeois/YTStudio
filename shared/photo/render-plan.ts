/**
 * The render plan (docs/photo/rendering.md, "The render plan and invalidation"): `compileRender` turns a document
 * into what the renderer evaluates, bottom to top. Each node says its input region for an output region, whether it
 * commutes with reduction, and a key (its version, parameters and inputs) that caches are keyed by. Derived, never
 * saved; pure, so it's tested here and the GPU only follows it.
 *
 * Groups' groundwork: a plan is a flat scope today. A group will be a node holding a scope of its own (isolated
 * first), evaluated into a buffer of its own and composited like an image; prefix keys work per scope.
 */
import { type LayerBlending, blendSeed, blendingOf, compositingOf, isPlainBlending } from "./blending.ts";
import { srgbToLinear } from "./colour.ts";
import { cropOf, isCropped } from "./crop.ts";
import { activeFilters } from "./edits.ts";
import { effectDefinition, isKernelFilter, unavailableReason } from "./effects/index.ts";
import { GLOW_CACHED_FROM } from "./effects/glow.ts";
import { CAMERA_RAW } from "./effects/camera-raw/index.ts";
import type { CameraRawAnalysis } from "./effects/camera-raw/analysis.ts";
import { ANALYSIS_PARAM, needsAnalysis } from "./effects/camera-raw/develop.ts";
import { type Size, levelForScale, type View } from "./geometry.ts";
import { type Affine, apply, invert, layerMatrix } from "./layers.ts";
import { type CanvasRaster, canvasContentOf, canvasRaster } from "./canvas-content.ts";
import { findPattern } from "./style/patterns.ts";
import { drawnEffects, effectAltitude, effectAngle, stylePatterns, styleReach } from "./style/style.ts";
import type { Box } from "./style/gradients.ts";
import type { Compositing, EffectInstance, EffectParamValue, LayerTransform, PhotoLayer, PhotoProject, SurfaceId } from "./types.ts";

/** The composite's precision follows its sources (rendering.md, "Storage formats"): f32 once any is 16-bit. */
export type PlanFormat = "rgba16float" | "rgba32float";

/** What the plan needs to know of an image layer's media. */
export interface SourceFacts {
  width: number;
  height: number;
  bits: 8 | 16;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A layer's mask as the plan draws it: coverage in the layer's own pixels (an adjustment's: the document's),
 * multiplying what the layer adds. A mask that reveals everything (no surface yet) isn't one.
 */
export interface MaskRef {
  surface: SurfaceId;
  /** Its pixels: the layer's (an adjustment's: the canvas). */
  size: Size;
}

/**
 * How a node meets what's below when it isn't plain Normal (Blending Options: a mode, Blend If, channels): the
 * blend pass reads both (`reference/blend.ts`). Null for plain Normal, which composites source-over with Fill folded
 * into its opacity.
 */
export interface NodeBlend extends LayerBlending {
  /** Dissolve's speckle: the layer's own, fixed in document pixels. */
  seed: number;
}

/**
 * A layer's style as the plan draws it (docs/photo/layer-style/README.md, phase L2): its drawn effects in order,
 * each one's light angle resolved (Global Light's or its own), the boxes its gradients are laid out on, and how far
 * it reaches past the layer's pixels (document pixels).
 */
/** A pattern as the renderer finds its pixels: made by code, or a surface of the document's. */
export type PatternRef = { builtin: string } | { surface: SurfaceId; width: number; height: number };

export interface NodeStyle {
  effects: EffectInstance[];
  /** By effect id: the angle its shadow falls from (or its light comes from). */
  angles: Record<string, number>;
  /** By effect id: a bevel's light altitude. */
  altitudes: Record<string, number>;
  /** By pattern id: the patterns its effects read (a built-in one's, or the document's surface); missing ones aren't here. */
  patterns: Record<string, PatternRef>;
  /** The layer's bounds on the canvas (Align with Layer), and the canvas. */
  layerBox: Box;
  canvasBox: Box;
  reach: number;
  interiorAsGroup: boolean;
  maskHidesEffects: boolean;
}

/** A filter as the plan runs it on its layer's content (in linear light, before the layer's mask). */
export interface FilterNode {
  id: string;
  type: string;
  version: number;
  params: Record<string, EffectParamValue>;
  /** How far past its input it reaches, in document pixels. */
  reach: number;
  /** The document's canvas (where a kernel filter's centre is, as a vignette's). */
  canvas: Size;
  /** Its own key (type, version, parameters; a kernel filter's canvas too). */
  key: string;
}

/**
 * What every node with content of its own has: its filters (on: none while the layer's "Filters" eye is off), the
 * key of its content before its filters (what a filter's caches are keyed by: never its opacity or mask), and from
 * which view level it commutes with reduction (0: always; a glow from its cached levels; Infinity: never).
 */
interface ContentFields {
  filters: FilterNode[];
  contentKey: string;
  commutesFrom: number;
}

/** A placed image: its source resampled through its transform (then its filters), composited at its opacity by its blending. */
export interface ImageNode extends ContentFields {
  kind: "image";
  layerId: string;
  mediaId: string;
  transform: LayerTransform;
  size: Size;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  /** Its opacity, and its Fill too when it blends as plain Normal. */
  opacity: number;
  mask: MaskRef | null;
  blend: NodeBlend | null;
  /** Its layer effects; null when it has none drawn. */
  style: NodeStyle | null;
  /** Resampling and Normal compositing commute with reduction (within tolerance at transparent overlaps); modes and filters may not. */
  commutes: boolean;
  key: string;
  /** Its crop (docs/photo/tools/crop.md): what shows of its own pixels, the rest hidden before its filters; null: all. */
  crop: Rect | null;
}

/** Painted pixels (a pixel layer's surface), placed and composited as an image is. Empty (null) draws nothing. */
export interface PixelNode extends ContentFields {
  kind: "pixel";
  layerId: string;
  surface: SurfaceId | null;
  transform: LayerTransform;
  size: Size;
  matrix: Affine;
  opacity: number;
  mask: MaskRef | null;
  blend: NodeBlend | null;
  style: NodeStyle | null;
  commutes: boolean;
  key: string;
  crop: Rect | null;
}

/**
 * A layer whose pixels the tab draws with a 2D canvas (`canvas-content.ts`: a text's words), in document pixels through
 * its whole transform: its raster, placed by a whole-pixel offset, then drawn as a pixel layer's pixels are.
 */
export interface CanvasNode extends ContentFields {
  kind: "canvas";
  layerId: string;
  /** Text isn't cropped (`isCroppable`): always null, so every drawn node reads a crop alike. */
  crop: null;
  raster: CanvasRaster;
  /** The raster's place: a whole-pixel translation. */
  transform: LayerTransform;
  size: Size;
  matrix: Affine;
  opacity: number;
  mask: MaskRef | null;
  blend: NodeBlend | null;
  style: NodeStyle | null;
  commutes: boolean;
  key: string;
}

/**
 * A generator layer: content made by its effect at every document point (a lens flare), then its filters, then
 * blended at its opacity through its mask (in document pixels), in linear light when `space` says so (light that
 * adds physically).
 */
export interface GeneratorNode extends ContentFields {
  kind: "generator";
  layerId: string;
  type: string;
  version: number;
  params: Record<string, EffectParamValue>;
  /** Where its handles that follow the canvas are (the canvas's centre). */
  canvas: Size;
  opacity: number;
  mask: MaskRef | null;
  /** Its mode, Blend If and channels; null for plain Normal (a new flare is Linear Dodge). */
  blend: NodeBlend | null;
  /** "linear": it blends in linear light whatever the document's compositing (`blendSpace`); "document": as the plan does. */
  space: "linear" | "document";
  commutes: boolean;
  key: string;
}

/** An adjustment of everything below it, faded by its layer's opacity. Pointwise. */
export interface AdjustmentNode {
  kind: "adjustment";
  layerId: string;
  type: string;
  version: number;
  params: Record<string, EffectParamValue>;
  opacity: number;
  /** Where it applies: coverage in document pixels. */
  mask: MaskRef | null;
  /** Its mode, Blend If and channels between the adjusted picture and the original; null for plain Normal. */
  blend: NodeBlend | null;
  commutes: boolean;
  key: string;
}

export type PlanNode = ImageNode | PixelNode | GeneratorNode | AdjustmentNode | CanvasNode;

/** A node that draws pixels of its own (an image's, a pixel layer's or a text's), as the compositor's layer pass does. */
export type DrawNode = ImageNode | PixelNode | CanvasNode;

export const isDrawNode = (node: PlanNode): node is DrawNode => node.kind === "image" || node.kind === "pixel" || node.kind === "canvas";

/** A node with content of its own: one that can have filters. */
export type ContentNode = ImageNode | PixelNode | GeneratorNode | CanvasNode;

export const isContentNode = (node: PlanNode): node is ContentNode => node.kind !== "adjustment";

/**
 * Whether a node is evaluated alone before it joins the stack (effects/system.md: filters see the layer before its
 * mask): one with filters, or a generator. Others draw straight into the composite.
 */
/** Whether a blending is Linear Dodge (Add) and nothing else: light added, as the GPU's own blending can. */
export const addsLight = (b: NodeBlend | null) => !!b && b.mode === "linear-dodge" && b.fill === 1 && b.channels.r && b.channels.g && b.channels.b && !Object.values(b.blendIf).some(Boolean);

/** A layer evaluated alone first: a generator, or a layer with filters. */
export type IsolatedNode = GeneratorNode | ((ImageNode | PixelNode | CanvasNode) & { filters: [FilterNode, ...FilterNode[]] });

/**
 * Whether an isolated layer blends in linear light whatever the document's compositing: a generator told so
 * (`blendSpace`), and a layer with filters (its light adds physically, ledger A27) unless it has layer effects, whose
 * pass works in the document's values.
 */
export const blendsInLinear = (node: IsolatedNode) => (node.kind === "generator" ? node.space === "linear" : !node.style);

export const isIsolated = (node: PlanNode): node is IsolatedNode => node.kind === "generator" || (isDrawNode(node) && node.filters.length > 0);

export interface RenderPlan {
  canvas: Size;
  /**
   * How layers mix (the document's): "photoshop" composites encoded values, so the evaluator's buffers hold them
   * (premultiplied) and it decodes once at the end; "linear" composites linear light throughout.
   */
  compositing: Compositing;
  /** What's under every layer, premultiplied, in the compositing's values (linear light, or encoded), or transparent. */
  background: [number, number, number, number];
  /** Bottom to top: only what changes the picture (hidden, fully transparent and identity layers are left out). */
  nodes: PlanNode[];
  /** The key of the background alone. */
  baseKey: string;
  /** `prefixKeys[i]`: the key of the result after node i (everything up to it). */
  prefixKeys: string[];
  /** The whole plan's key (the last prefix key, or the base's). */
  key: string;
  /** Whether every node commutes with reduction: then a reduced view can be evaluated at its own level. */
  commutes: boolean;
  /** The view level from which the whole plan does (0: any; a glow's cached levels; Infinity: none below 100%). */
  commutesFrom: number;
  format: PlanFormat;
  /** Layers that would draw but can't: their media is missing, or their effect is unavailable here. */
  skipped: { layerId: string; reason: "missing" | "unavailable" }[];
}

/** cyrb53: a fast 53-bit string hash, as a base-36 key. Collisions only cost a wrong cache hit, and are ~2⁻⁵³. */
export function hashKey(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** sRGB "#rrggbb" as premultiplied linear light, or transparent. */
export function backgroundLight(hex: string | null): [number, number, number, number] {
  if (!hex) return [0, 0, 0, 0];
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1];
}

export interface CompileOptions {
  /** Whether f32 composites can be used (the GPU blends f32): otherwise f16, said by the plan's format. */
  float32?: boolean;
  /** Camera Raw's analyses (docs/photo/camera-raw.md, CR2): the renderer's, by what each one develops. */
  cameraRaw?: CameraRawResolver;
  /**
   * The document pixels rendered, when they aren't the canvas's (a merge renders the box around its layers, where
   * they are): what the canvas layers' rasters cover.
   */
  region?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * What a Camera Raw needs analysed: the picture it develops, by its key (`inputKey`: the composite below an
 * adjustment layer, or a layer's content and the filters before it), and where it is.
 */
export interface CameraRawNeed {
  inputKey: string;
  layerId: string;
  /** The filter's id, or null for an adjustment layer. */
  filterId: string | null;
}

/** A Camera Raw's analysis, or null while it isn't there yet (the plan then draws without its local sliders). */
export type CameraRawResolver = (need: CameraRawNeed) => CameraRawAnalysis | null;

/**
 * A Camera Raw instance's parameters as drawn (its analysis handed in, when it reads one) and the key part saying
 * which analysis: a plan drawn without it ("pending") is never taken for one drawn with it.
 */
function cameraRawParams(params: Record<string, EffectParamValue>, need: CameraRawNeed, resolve: CameraRawResolver | undefined): { params: Record<string, EffectParamValue>; key: string } {
  if (!needsAnalysis(params)) return { params, key: "" };
  const analysis = resolve?.(need) ?? null;
  return analysis ? { params: { ...params, [ANALYSIS_PARAM]: analysis as unknown as EffectParamValue }, key: `|cr:${analysis.id}` } : { params, key: "|cr:pending" };
}

/** A layer's mask for the plan (`size`: the layer's own pixels), or null when it has none, or one that hides nothing. */
function maskOf(layer: PhotoLayer, size: Size): MaskRef | null {
  return layer.mask?.surface ? { surface: layer.mask.surface, size } : null;
}

const maskKey = (mask: MaskRef | null) => (mask ? `|mask:${mask.surface}` : "");

/** A placed layer's crop for the plan (inside its pixels), or null when it shows whole. */
function cropRectOf(layer: PhotoLayer, size: Size): Rect | null {
  if (!isCropped(layer, size)) return null;
  const c = cropOf(layer, size);
  return { x0: c.x, y0: c.y, x1: c.x + c.width, y1: c.y + c.height };
}

/** A crop's part of a node's keys (none when it shows whole, so uncropped layers keep the keys they had). */
const cropKey = (crop: Rect | null) => (crop ? `|crop:${crop.x0},${crop.y0},${crop.x1},${crop.y1}` : "");

/**
 * A layer's blending for the plan, and the opacity it composites at (Fill folded in when it's plain Normal). A layer
 * with drawn effects always gets its blending (its pass composites it with them).
 */
function blendOf(layer: PhotoLayer): { blend: NodeBlend | null; opacity: number; key: string } {
  const b = blendingOf(layer);
  if (isPlainBlending(layer) && !drawnEffects(layer).length) return { blend: null, opacity: layer.opacity * b.fill, key: "" };
  return { blend: { ...b, seed: blendSeed(layer.id) }, opacity: layer.opacity, key: `|blend:${b.mode},${b.fill},${JSON.stringify(layer.blending ?? null)}${b.mode === "dissolve" ? `,${layer.id}` : ""}` };
}

/** The axis-aligned box a placed layer covers on the canvas (of `part` of its pixels: its crop's, by default all of them). */
function boundsOf(matrix: Affine, size: Size, part: Rect = { x0: 0, y0: 0, x1: size.width, y1: size.height }): Box {
  const pts = [apply(matrix, part.x0, part.y0), apply(matrix, part.x1, part.y0), apply(matrix, part.x0, part.y1), apply(matrix, part.x1, part.y1)];
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}

/** A placed layer's style for the plan, or null when it draws no effects; and its part of the node's key. */
function styleOf(doc: PhotoProject, layer: PhotoLayer, matrix: Affine, size: Size): { style: NodeStyle | null; key: string } {
  const effects = drawnEffects(layer);
  if (!effects.length) return { style: null, key: "" };
  const angles = Object.fromEntries(effects.map((e) => [e.id, effectAngle(doc, e)]));
  const altitudes = Object.fromEntries(effects.filter((e) => e.type === "bevel-emboss").map((e) => [e.id, effectAltitude(doc, e)]));
  const patterns: Record<string, PatternRef> = {};
  for (const id of stylePatterns([{ ...layer, style: { enabled: true, effects } }])) {
    const p = findPattern(doc, id);
    if (p) patterns[id] = "surface" in p ? { surface: p.surface, width: p.size.width, height: p.size.height } : { builtin: p.id };
  }
  const style: NodeStyle = {
    effects,
    angles,
    altitudes,
    patterns,
    // What shows of it: a cropped layer's box is its crop's (Align with Layer lays out on what's seen).
    layerBox: boundsOf(matrix, size, cropRectOf(layer, size) ?? undefined),
    canvasBox: { x0: 0, y0: 0, x1: doc.canvas.width, y1: doc.canvas.height },
    reach: styleReach(layer),
    interiorAsGroup: layer.blending?.interiorAsGroup === true,
    maskHidesEffects: layer.blending?.maskHidesEffects === true,
  };
  return { style, key: `|style:${JSON.stringify(effects)}|${JSON.stringify(angles)}|${JSON.stringify(altitudes)}|${JSON.stringify(patterns)}|${style.interiorAsGroup},${style.maskHidesEffects}` };
}

/** The canvas's background in the compositing's values: encoded for "photoshop", linear light otherwise. */
export function backgroundIn(hex: string | null, compositing: Compositing): [number, number, number, number] {
  if (!hex || compositing === "linear") return backgroundLight(hex);
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

/** A filter's version of `commutesFrom`: a glow from its cached levels, anything else that doesn't commute never. */
const filterCommutesFrom = (f: FilterNode) => (f.type === "glow" ? GLOW_CACHED_FROM : effectDefinition(f.type)!.commutesWithReduction(f.params) ? 0 : Infinity);

/** A layer's filters as the plan runs them: those on and usable, none while its "Filters" eye is off. */
function filterNodes(layer: PhotoLayer, canvas: Size = { width: 0, height: 0 }, contentKey = "", resolve?: CameraRawResolver): FilterNode[] {
  const before: string[] = [];
  return activeFilters(layer).flatMap((f) => {
    const def = effectDefinition(f.type)!;
    if (def.isIdentity(f.params)) return [];
    const where = isKernelFilter(def.type) ? `|${canvas.width}x${canvas.height}` : "";
    const drawn = def.type === CAMERA_RAW.type ? cameraRawParams(f.params, { inputKey: `${contentKey}|${before.join(",")}`, layerId: layer.id, filterId: f.id }, resolve) : { params: f.params, key: "" };
    const key = hashKey(`${def.type}@${def.version}|${JSON.stringify(f.params)}${where}${drawn.key}`);
    before.push(key);
    return [{ id: f.id, type: def.type, version: def.version, params: drawn.params, reach: def.reach(f.params), canvas, key }];
  });
}

/** How far a layer's filters reach past its pixels, in document pixels (each filter's reach adds to the last's). */
export const filtersReach = (layer: PhotoLayer): number => filterNodes(layer).reduce((sum, f) => sum + f.reach, 0);

/** Its content's fields: filters, the content key they're keyed by, and from which level it commutes. */
function contentFields(layer: PhotoLayer, canvas: Size, contentKey: string, contentCommutesFrom = 0, resolve?: CameraRawResolver): ContentFields & { filtersKey: string } {
  const filters = filterNodes(layer, canvas, contentKey, resolve);
  return {
    filters,
    contentKey,
    commutesFrom: Math.max(contentCommutesFrom, ...filters.map(filterCommutesFrom)),
    filtersKey: filters.length ? `|filters:${filters.map((f) => f.key).join(",")}` : "",
  };
}

export function compileRender(doc: PhotoProject, sources: ReadonlyMap<string, SourceFacts>, options: CompileOptions = {}): RenderPlan {
  const compositing = compositingOf(doc);
  const background = backgroundIn(doc.canvas.background, compositing);
  const baseKey = hashKey(`base|${compositing}|${background.join(",")}`);
  const nodes: PlanNode[] = [];
  const skipped: RenderPlan["skipped"] = [];
  let sixteen = false;
  // Light (filters' and generators' content, far above white) mixed in encoded values doesn't commute with reduction;
  // a layer with filters blends in linear light (`blendsInLinear`), unless effects make it the document's.
  const encodedLight = compositing === "photoshop";
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const blending = blendOf(layer);
    if (layer.kind === "image") {
      const source = sources.get(layer.mediaId);
      if (!source) {
        skipped.push({ layerId: layer.id, reason: "missing" });
        continue;
      }
      if (source.bits === 16) sixteen = true;
      const size = { width: source.width, height: source.height };
      const t = layer.transform;
      const mask = maskOf(layer, size);
      const crop = cropRectOf(layer, size);
      const { filtersKey, ...content } = contentFields(layer, doc.canvas, hashKey(`image|${layer.mediaId}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}${cropKey(crop)}`), 0, options.cameraRaw);
      const matrix = layerMatrix(t, size);
      const styled = styleOf(doc, layer, matrix, size);
      nodes.push({
        kind: "image",
        layerId: layer.id,
        mediaId: layer.mediaId,
        transform: t,
        size,
        matrix,
        opacity: blending.opacity,
        mask,
        blend: blending.blend,
        style: styled.style,
        ...content,
        commutesFrom: blending.blend || (encodedLight && content.filters.length && styled.style) ? Infinity : content.commutesFrom,
        commutes: !blending.blend && !(encodedLight && content.filters.length && styled.style) && content.commutesFrom === 0,
        key: hashKey(`image|${layer.mediaId}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}|${blending.opacity}${maskKey(mask)}${blending.key}${styled.key}${filtersKey}${cropKey(crop)}`),
        crop,
      });
      continue;
    }
    if (layer.kind === "pixel") {
      // An empty one is still drawn: the stroke that paints its first pixels shows through it.
      const { size, transform: t } = layer;
      const mask = maskOf(layer, size);
      const crop = cropRectOf(layer, size);
      const { filtersKey, ...content } = contentFields(layer, doc.canvas, hashKey(`pixel|${layer.surface}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}${cropKey(crop)}`), 0, options.cameraRaw);
      const matrix = layerMatrix(t, size);
      const styled = styleOf(doc, layer, matrix, size);
      nodes.push({
        kind: "pixel",
        layerId: layer.id,
        surface: layer.surface,
        transform: t,
        size,
        matrix,
        opacity: blending.opacity,
        mask,
        blend: blending.blend,
        style: styled.style,
        ...content,
        commutesFrom: blending.blend || (encodedLight && content.filters.length && styled.style) ? Infinity : content.commutesFrom,
        commutes: !blending.blend && !(encodedLight && content.filters.length && styled.style) && content.commutesFrom === 0,
        key: hashKey(`pixel|${layer.surface}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}|${blending.opacity}${maskKey(mask)}${blending.key}${styled.key}${filtersKey}${cropKey(crop)}`),
        crop,
      });
      continue;
    }
    const painted = canvasContentOf(layer);
    if (painted) {
      const raster = canvasRaster(doc, painted, styleReach(layer) + filtersReach(layer), !!layer.mask?.surface, hashKey, options.region);
      if (!raster) continue;
      const size = { width: raster.width, height: raster.height };
      const mask = maskOf(layer, { width: doc.canvas.width, height: doc.canvas.height });
      const { filtersKey, ...content } = contentFields(layer, doc.canvas, hashKey(`canvas|${raster.key}`), 0, options.cameraRaw);
      // Its style's Align with Layer is the layer's frame, not the raster's box.
      const styled = styleOf(doc, layer, layerMatrix(painted.transform, painted.size), painted.size);
      nodes.push({
        kind: "canvas",
        crop: null,
        layerId: layer.id,
        raster,
        transform: { x: raster.x + size.width / 2, y: raster.y + size.height / 2, scaleX: 1, scaleY: 1, rotation: 0 },
        size,
        matrix: [1, 0, 0, 1, raster.x, raster.y],
        opacity: blending.opacity,
        mask,
        blend: blending.blend,
        style: styled.style,
        ...content,
        commutesFrom: blending.blend || (encodedLight && content.filters.length && styled.style) ? Infinity : content.commutesFrom,
        commutes: !blending.blend && !(encodedLight && content.filters.length && styled.style) && content.commutesFrom === 0,
        key: hashKey(`canvas|${raster.key}|${raster.x},${raster.y}|${blending.opacity}${maskKey(mask)}${blending.key}${styled.key}${filtersKey}`),
      });
      continue;
    }
    if (layer.kind === "text" || layer.kind === "shape") continue;
    const effect = layer.effect;
    if (!effect.enabled) continue;
    const def = effectDefinition(effect.type);
    if (!def || unavailableReason(effect, layer.kind)) {
      skipped.push({ layerId: layer.id, reason: "unavailable" });
      continue;
    }
    if (layer.kind === "generator") {
      const canvas = { width: doc.canvas.width, height: doc.canvas.height };
      const mask = maskOf(layer, canvas);
      const own = `${def.type}@${def.version}|${JSON.stringify(effect.params)}|${canvas.width}x${canvas.height}`;
      const { filtersKey, ...content } = contentFields(layer, doc.canvas, hashKey(own), def.commutesWithReduction(effect.params) ? 0 : Infinity, options.cameraRaw);
      const space = layer.blendSpace === "linear" ? "linear" : "document";
      // Linear Dodge (Add) in linear light adds light, which commutes with reduction; other modes don't.
      const b = blending.blend;
      const blendCommutes = (!b || addsLight(b)) && (space === "linear" || !encodedLight);
      nodes.push({
        kind: "generator",
        layerId: layer.id,
        type: def.type,
        version: def.version,
        params: effect.params,
        canvas,
        opacity: blending.opacity,
        mask,
        blend: b,
        space,
        ...content,
        commutesFrom: blendCommutes ? content.commutesFrom : Infinity,
        commutes: blendCommutes && content.commutesFrom === 0,
        key: hashKey(`generator|${own}|${space}|${blending.opacity}${maskKey(mask)}${blending.key}${filtersKey}`),
      });
      continue;
    }
    if (def.isIdentity(effect.params)) continue;
    const mask = maskOf(layer, { width: doc.canvas.width, height: doc.canvas.height });
    // A Camera Raw adjustment's analysis is of everything below it: the plan's key so far.
    const below = nodes.reduce((key, node) => hashKey(`${key}>${node.key}`), baseKey);
    const drawn = def.type === CAMERA_RAW.type ? cameraRawParams(effect.params, { inputKey: below, layerId: layer.id, filterId: null }, options.cameraRaw) : { params: effect.params, key: "" };
    nodes.push({
      kind: "adjustment",
      layerId: layer.id,
      type: def.type,
      version: def.version,
      params: drawn.params,
      opacity: blending.opacity,
      mask,
      blend: blending.blend,
      commutes: def.commutesWithReduction(effect.params) && !blending.blend,
      key: hashKey(`${def.type}@${def.version}|${JSON.stringify(effect.params)}|${blending.opacity}${maskKey(mask)}${blending.key}|${doc.canvas.width}x${doc.canvas.height}${drawn.key}`),
    });
  }
  const prefixKeys: string[] = [];
  let key = baseKey;
  for (const node of nodes) {
    key = hashKey(`${key}>${node.key}`);
    prefixKeys.push(key);
  }
  return {
    canvas: { width: doc.canvas.width, height: doc.canvas.height },
    compositing,
    background,
    nodes,
    baseKey,
    prefixKeys,
    key,
    commutes: nodes.every((n) => n.commutes),
    commutesFrom: Math.max(0, ...nodes.map((n) => (n.kind === "adjustment" ? (n.commutes ? 0 : Infinity) : n.commutesFrom))),
    // Encoded composites are f32 too: an 8-bit sample's trip through f16 linear tiles and then f16 encoded
    // composites could leave its 8-bit level (rendering.md, "Storage formats"); f32 keeps unedited exports exact.
    format: (sixteen || compositing === "photoshop") && options.float32 !== false ? "rgba32float" : "rgba16float",
    skipped,
  };
}

/** The key of what's below node `index` (the background's key below the first). */
export const keyBelow = (plan: RenderPlan, index: number) => (index <= 0 ? plan.baseKey : plan.prefixKeys[index - 1]);

/**
 * A node's input region for an output region (document pixels). Pointwise nodes need the same pixels; an image
 * needs the source pixels under the region, in its own pixel space (clipped to the source), or nothing.
 */
export function inputRegion(node: PlanNode, rect: Rect): Rect | null {
  if (node.kind === "adjustment") return rect;
  // Filters need their reach around the region; a generator's content is everywhere, in document pixels.
  const reach = node.filters.reduce((sum, f) => sum + f.reach, 0);
  if (reach) rect = { x0: rect.x0 - reach, y0: rect.y0 - reach, x1: rect.x1 + reach, y1: rect.y1 + reach };
  if (node.kind === "generator") return rect;
  const inv = invert(node.matrix);
  const pts = [apply(inv, rect.x0, rect.y0), apply(inv, rect.x1, rect.y0), apply(inv, rect.x0, rect.y1), apply(inv, rect.x1, rect.y1)];
  // Only what shows of it: inside its crop (and the few pixels past its edge that resampling reads).
  const c = node.crop;
  const limit = c ? { x0: Math.max(0, c.x0 - 4), y0: Math.max(0, c.y0 - 4), x1: Math.min(node.size.width, c.x1 + 4), y1: Math.min(node.size.height, c.y1 + 4) } : { x0: 0, y0: 0, x1: node.size.width, y1: node.size.height };
  const x1 = Math.min(limit.x1, Math.max(...pts.map((p) => p.x)));
  const y1 = Math.min(limit.y1, Math.max(...pts.map((p) => p.y)));
  const x0 = Math.max(limit.x0, Math.min(...pts.map((p) => p.x)));
  const y0 = Math.max(limit.y0, Math.min(...pts.map((p) => p.y)));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/**
 * Whether a view needs refining (rendering.md: "the settled view is the full-resolution render, reduced"): below
 * 100%, when some node doesn't commute with reduction at the view's level, that level is only a preview. A glow
 * commutes from its cached levels on (f4-light.md, "Levels").
 */
export const needsRefinement = (plan: RenderPlan, zoom: number) => zoom < 1 && levelForScale(zoom, 32) < plan.commutesFrom;

/** Mitchell's reach in pixels of the level a refinement samples (its scale is 1 to 2: ±4 pixels, and one more). */
export const REFINE_HALO = 5;

/** A piece of a refinement: the view's pixels it fills, and the level-k and level-0 regions it renders for them. */
export interface RefineTile {
  /** Device pixels of the view, [x0, x1) × [y0, y1). */
  view: Rect;
  /** Pixels of level k (document pixels / 2^k), halo included. */
  level: Rect;
  /** The same in document pixels (level × 2^k): what's rendered at full resolution. */
  doc: Rect;
}

export interface RefinePlan {
  /** The level the view's pixels are sampled from (as a source's would be). */
  level: number;
  /** Mitchell's stretch at that level: 2^-level / zoom, at least 1. */
  stretch: number;
  tiles: RefineTile[];
}

/**
 * How to refine a reduced view: the level its pixels are sampled from (the one a source of this size would be
 * read at), and tiles whose level-0 regions stay within `maxRegion` document pixels a side, clipped to the canvas
 * with a halo (outside it the view shows the pasteboard). Their level-k regions are aligned to 2^k document pixels,
 * so every tile's reduction has the same phase as a source's pyramid.
 */
export function refinePlan(view: View, canvas: Size, maxRegion = 2048): RefinePlan {
  const level = levelForScale(view.zoom, 32);
  const s = 2 ** level;
  const stretch = Math.max(1, 1 / s / view.zoom);
  const halo = Math.ceil(2 * stretch) + 1;
  // The canvas, plus the halo, in level-k pixels: nothing outside it is ever shown.
  const limit: Rect = { x0: -halo, y0: -halo, x1: Math.ceil(canvas.width / s) + halo, y1: Math.ceil(canvas.height / s) + halo };
  // View pixels per level-k pixel is zoom · 2^k, in (0.5, 1]: a tile of `side` level pixels fills about that many view pixels.
  const side = Math.max(8, Math.floor(maxRegion / s) - 2 * halo);
  const viewSide = Math.max(1, Math.floor(side * view.zoom * s));
  // Only the part of the view that shows the canvas (and its halo) is refined.
  const shown = {
    x0: Math.max(0, Math.floor((-view.x) * view.zoom) - 1),
    y0: Math.max(0, Math.floor((-view.y) * view.zoom) - 1),
    x1: Math.min(Math.round(view.width), Math.ceil((canvas.width - view.x) * view.zoom) + 1),
    y1: Math.min(Math.round(view.height), Math.ceil((canvas.height - view.y) * view.zoom) + 1),
  };
  const tiles: RefineTile[] = [];
  for (let y = shown.y0; y < shown.y1; y += viewSide) {
    for (let x = shown.x0; x < shown.x1; x += viewSide) {
      const v: Rect = { x0: x, y0: y, x1: Math.min(shown.x1, x + viewSide), y1: Math.min(shown.y1, y + viewSide) };
      // The level-k pixels these view pixels' centres land on, and Mitchell's reach around them.
      const lx0 = Math.floor(((view.x + (v.x0 + 0.5) / view.zoom) / s) - 0.5) - halo;
      const ly0 = Math.floor(((view.y + (v.y0 + 0.5) / view.zoom) / s) - 0.5) - halo;
      const lx1 = Math.ceil(((view.x + (v.x1 - 0.5) / view.zoom) / s) - 0.5) + halo + 1;
      const ly1 = Math.ceil(((view.y + (v.y1 - 0.5) / view.zoom) / s) - 0.5) + halo + 1;
      const l: Rect = { x0: Math.max(limit.x0, lx0), y0: Math.max(limit.y0, ly0), x1: Math.min(limit.x1, lx1), y1: Math.min(limit.y1, ly1) };
      if (l.x1 <= l.x0 || l.y1 <= l.y0) continue;
      tiles.push({ view: v, level: l, doc: { x0: l.x0 * s, y0: l.y0 * s, x1: l.x1 * s, y1: l.y1 * s } });
    }
  }
  return { level, stretch, tiles };
}
