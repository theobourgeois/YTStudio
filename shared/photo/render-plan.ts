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
import { effectDefinition, unavailableReason } from "./effects/index.ts";
import { type Size, levelForScale, type View } from "./geometry.ts";
import { type Affine, apply, invert, layerMatrix } from "./layers.ts";
import type { EffectParamValue, LayerTransform, PhotoProject } from "./types.ts";

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

/** A placed image: its source resampled through its transform, composited source-over at its opacity. */
export interface ImageNode {
  kind: "image";
  layerId: string;
  mediaId: string;
  transform: LayerTransform;
  size: Size;
  /** Layer pixels → document pixels. */
  matrix: Affine;
  opacity: number;
  /** Resampling and normal compositing commute with reduction (within tolerance at transparent overlaps). */
  commutes: true;
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
  commutes: boolean;
  key: string;
}

export type PlanNode = ImageNode | AdjustmentNode;

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

/** The plan for `doc`, given what's known of its media (a layer whose media isn't known is skipped as missing). */
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
      nodes.push({
        kind: "image",
        layerId: layer.id,
        mediaId: layer.mediaId,
        transform: t,
        size,
        matrix: layerMatrix(t, size),
        opacity: layer.opacity,
        commutes: true,
        key: hashKey(`image|${layer.mediaId}|${size.width}x${size.height}|${t.x},${t.y},${t.scaleX},${t.scaleY},${t.rotation}|${layer.opacity}`),
      });
      continue;
    }
    const effect = layer.effect;
    if (!effect.enabled) continue;
    const def = effectDefinition(effect.type);
    if (!def || unavailableReason(effect)) {
      skipped.push({ layerId: layer.id, reason: "unavailable" });
      continue;
    }
    if (def.isIdentity(effect.params)) continue;
    nodes.push({
      kind: "adjustment",
      layerId: layer.id,
      type: def.type,
      version: def.version,
      params: effect.params,
      opacity: layer.opacity,
      commutes: def.commutesWithReduction(effect.params),
      key: hashKey(`${def.type}@${def.version}|${JSON.stringify(effect.params)}|${layer.opacity}`),
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
 * 100%, when some node doesn't commute with reduction, the view's own level is only a preview.
 */
export const needsRefinement = (plan: RenderPlan, zoom: number) => zoom < 1 && !plan.commutes;

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
