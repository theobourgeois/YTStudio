/**
 * The render plan (docs/photo/rendering.md, "The render plan and invalidation"): `compileRender` turns a document
 * into what the renderer evaluates, bottom to top. Each node says its input region for an output region, whether it
 * commutes with reduction, and a key (its version, parameters and inputs) that caches are keyed by. Derived, never
 * saved; pure, so it's tested here and the GPU only follows it.
 *
 * Groups' groundwork: a plan is a flat scope today. A group will be a node holding a scope of its own (isolated
 * first), evaluated into a buffer of its own and composited like an image; prefix keys work per scope.
 */
import { srgbToLinear } from "./colour.ts";
import { activeFilters } from "./edits.ts";
import { effectDefinition, unavailableReason } from "./effects/index.ts";
import { GLOW_CACHED_FROM } from "./effects/glow.ts";
import { type Size, levelForScale, type View } from "./geometry.ts";
import { type Affine, apply, invert, layerMatrix } from "./layers.ts";
import type { EffectParamValue, GeneratorBlend, LayerTransform, PhotoLayer, PhotoProject, SurfaceId } from "./types.ts";

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

/** A filter as the plan runs it on its layer's content (in linear light, before the layer's mask). */
export interface FilterNode {
  id: string;
  type: string;
  version: number;
  params: Record<string, EffectParamValue>;
  /** How far past its input it reaches, in document pixels. */
  reach: number;
  /** Its own key (type, version, parameters). */
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

/** A placed image: its source resampled through its transform, composited source-over at its opacity. */
export interface ImageNode extends ContentFields {
  kind: "image";
  layerId: string;
  mediaId: string;
  transform: LayerTransform;
  size: Size;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  opacity: number;
  mask: MaskRef | null;
  /** Resampling and normal compositing commute with reduction (within tolerance at transparent overlaps); filters may not. */
  commutes: boolean;
  key: string;
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
  commutes: boolean;
  key: string;
}

/**
 * A generator layer: content made by its effect at every document point (a lens flare), then its filters, then
 * blended at its opacity through its mask (in document pixels) in `space`: "linear" (light that adds physically).
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
  blend: GeneratorBlend;
  space: "linear";
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
  commutes: boolean;
  key: string;
}

export type PlanNode = ImageNode | PixelNode | GeneratorNode | AdjustmentNode;

/** A node that draws pixels of its own (an image's or a pixel layer's), as the compositor's layer pass does. */
export type DrawNode = ImageNode | PixelNode;

export const isDrawNode = (node: PlanNode): node is DrawNode => node.kind === "image" || node.kind === "pixel";

/** A node with content of its own: one that can have filters. */
export type ContentNode = ImageNode | PixelNode | GeneratorNode;

export const isContentNode = (node: PlanNode): node is ContentNode => node.kind !== "adjustment";

/**
 * Whether a node is evaluated alone before it joins the stack (effects/system.md: filters see the layer before its
 * mask): one with filters, or a generator. Others draw straight into the composite.
 */
export const isIsolated = (node: PlanNode): node is ContentNode => node.kind === "generator" || (isDrawNode(node) && node.filters.length > 0);

export interface RenderPlan {
  canvas: Size;
  /** What's under every layer: premultiplied linear light, or transparent. */
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
}

/** A layer's mask for the plan (`size`: the layer's own pixels), or null when it has none, or one that hides nothing. */
function maskOf(layer: PhotoLayer, size: Size): MaskRef | null {
  return layer.mask?.surface ? { surface: layer.mask.surface, size } : null;
}

const maskKey = (mask: MaskRef | null) => (mask ? `|mask:${mask.surface}` : "");

/** A filter's version of `commutesFrom`: a glow from its cached levels, anything else that doesn't commute never. */
const filterCommutesFrom = (f: FilterNode) => (f.type === "glow" ? GLOW_CACHED_FROM : effectDefinition(f.type)!.commutesWithReduction(f.params) ? 0 : Infinity);

/** A layer's filters as the plan runs them: those on and usable, none while its "Filters" eye is off. */
function filterNodes(layer: PhotoLayer): FilterNode[] {
  return activeFilters(layer).flatMap((f) => {
    const def = effectDefinition(f.type)!;
    if (def.isIdentity(f.params)) return [];
    return [{ id: f.id, type: def.type, version: def.version, params: f.params, reach: def.reach(f.params), key: hashKey(`${def.type}@${def.version}|${JSON.stringify(f.params)}`) }];
  });
}

/** How far a layer's filters reach past its pixels, in document pixels (each filter's reach adds to the last's). */
export const filtersReach = (layer: PhotoLayer): number => filterNodes(layer).reduce((sum, f) => sum + f.reach, 0);

/** Its content's fields: filters, the content key they're keyed by, and from which level it commutes. */
function contentFields(layer: PhotoLayer, contentKey: string, contentCommutesFrom = 0): ContentFields & { filtersKey: string } {
  const filters = filterNodes(layer);
  return {
    filters,
    contentKey,
    commutesFrom: Math.max(contentCommutesFrom, ...filters.map(filterCommutesFrom)),
    filtersKey: filters.length ? `|filters:${filters.map((f) => f.key).join(",")}` : "",
  };
}

export function compileRender(doc: PhotoProject, sources: ReadonlyMap<string, SourceFacts>, options: CompileOptions = {}): RenderPlan {
  const background = backgroundLight(doc.canvas.background);
  const baseKey = hashKey(`base|${background.join(",")}`);
  const nodes: PlanNode[] = [];
  const skipped: RenderPlan["skipped"] = [];
  let sixteen = false;
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
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
      const { filtersKey, ...content } = contentFields(layer, hashKey(`image|${layer.mediaId}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}`));
      nodes.push({
        kind: "image",
        layerId: layer.id,
        mediaId: layer.mediaId,
        transform: t,
        size,
        matrix: layerMatrix(t, size),
        opacity: layer.opacity,
        mask,
        ...content,
        commutes: content.commutesFrom === 0,
        key: hashKey(`image|${layer.mediaId}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}|${layer.opacity}${maskKey(mask)}${filtersKey}`),
      });
      continue;
    }
    if (layer.kind === "pixel") {
      // An empty one is still drawn: the stroke that paints its first pixels shows through it.
      const { size, transform: t } = layer;
      const mask = maskOf(layer, size);
      const { filtersKey, ...content } = contentFields(layer, hashKey(`pixel|${layer.surface}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}`));
      nodes.push({
        kind: "pixel",
        layerId: layer.id,
        surface: layer.surface,
        transform: t,
        size,
        matrix: layerMatrix(t, size),
        opacity: layer.opacity,
        mask,
        ...content,
        commutes: content.commutesFrom === 0,
        key: hashKey(`pixel|${layer.surface}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}|${layer.opacity}${maskKey(mask)}${filtersKey}`),
      });
      continue;
    }
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
      const { filtersKey, ...content } = contentFields(layer, hashKey(own), def.commutesWithReduction(effect.params) ? 0 : Infinity);
      const blend = layer.blend ?? "normal";
      nodes.push({
        kind: "generator",
        layerId: layer.id,
        type: def.type,
        version: def.version,
        params: effect.params,
        canvas,
        opacity: layer.opacity,
        mask,
        blend,
        // Layer Style's L1 brings the document's compositing; until then every layer blends in linear light.
        space: "linear",
        ...content,
        commutes: content.commutesFrom === 0,
        key: hashKey(`generator|${own}|${blend}|linear|${layer.opacity}${maskKey(mask)}${filtersKey}`),
      });
      continue;
    }
    if (def.isIdentity(effect.params)) continue;
    const mask = maskOf(layer, { width: doc.canvas.width, height: doc.canvas.height });
    nodes.push({
      kind: "adjustment",
      layerId: layer.id,
      type: def.type,
      version: def.version,
      params: effect.params,
      opacity: layer.opacity,
      mask,
      commutes: def.commutesWithReduction(effect.params),
      key: hashKey(`${def.type}@${def.version}|${JSON.stringify(effect.params)}|${layer.opacity}${maskKey(mask)}|${doc.canvas.width}x${doc.canvas.height}`),
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
    background,
    nodes,
    baseKey,
    prefixKeys,
    key,
    commutes: nodes.every((n) => n.commutes),
    commutesFrom: Math.max(0, ...nodes.map((n) => (n.kind === "adjustment" ? (n.commutes ? 0 : Infinity) : n.commutesFrom))),
    format: sixteen && options.float32 !== false ? "rgba32float" : "rgba16float",
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
  const x0 = Math.max(0, Math.min(...pts.map((p) => p.x)));
  const y0 = Math.max(0, Math.min(...pts.map((p) => p.y)));
  const x1 = Math.min(node.size.width, Math.max(...pts.map((p) => p.x)));
  const y1 = Math.min(node.size.height, Math.max(...pts.map((p) => p.y)));
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
