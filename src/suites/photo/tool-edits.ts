/**
 * The photo assistant's edits (`shared/photo/tools.ts`), pure: `(doc, input, env) => { doc, text }`, each one undo
 * step in the open photo or one save of a photo that isn't open. Errors go to the model: they say what's wrong
 * and what there is to choose from.
 */
import { createId } from "@shared/ids";
import { addAdjustmentLayer, addImageLayer, addPixelLayer, findLayer, moveLayer, removeLayer, removeMask, resetEffect, setCanvas, setEffectParams, setHighlights, setMask, setTransform, updateLayer } from "@shared/photo/edits";
import { ADJUSTMENTS, type EffectDefinition, effectDefinition, unavailableReason } from "@shared/photo/effects/index";
import { CURVE_CHANNELS, MAX_CURVE_POINTS } from "@shared/photo/effects/params";
import { bounds } from "@shared/photo/layers";
import type { MergeKind } from "@shared/photo/merge";
import { isColour } from "@shared/photo/project";
import { type AdjustmentLayer, type CurveSet, type LayerTransform, type PhotoLayer, type PhotoProject, type PhotoSelection, type PlacedLayer, isPlaced } from "@shared/photo/types";
import type { MediaAsset } from "@shared/types";
import { fitted } from "./canvas/handles";
import { imageLayerOf } from "./media";

type Input = Record<string, unknown>;

export interface PhotoEditEnv {
  assets: readonly MediaAsset[];
}

export interface PhotoEditResult {
  doc: PhotoProject;
  text: string;
  /** The layer it's about (the panel selects it). */
  layerId?: string;
}

export type PhotoEdit = (doc: PhotoProject, input: Input, env: PhotoEditEnv) => PhotoEditResult;

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A placed layer's size in its own pixels: an image's source (null while it's missing), a pixel layer's (null for adjustments). */
export const sizeOf = (layer: PhotoLayer, assets: readonly MediaAsset[]): { width: number; height: number } | null => {
  if (layer.kind === "pixel") return layer.size;
  if (layer.kind !== "image") return null;
  const a = assets.find((x) => x.id === layer.mediaId);
  return a?.width && a.height ? { width: a.width, height: a.height } : null;
};

/** A layer by id or name; the error lists the layers there are. */
export function findLayerRef(doc: PhotoProject, ref: unknown): PhotoLayer {
  const wanted = String(ref ?? "").trim();
  const layer = findLayer(doc, wanted) ?? doc.layers.find((l) => l.name.toLowerCase() === wanted.toLowerCase());
  if (!layer) {
    const list = doc.layers.map((l) => `${l.id} ("${l.name}")`).join(", ");
    throw new Error(`No layer "${wanted}". The layers: ${list || "none: place an image with add_image_layer"}.`);
  }
  return layer;
}

/** A curve's points as the model writes them. */
const pointsText = (points: [number, number][]) => `[${points.map(([x, y]) => `[${round(x)}, ${round(y)}]`).join(", ")}]`;

/** An adjustment's settings as the model reads them: every parameter, in its own units. */
export function describeAdjustment(layer: AdjustmentLayer): string {
  const def = effectDefinition(layer.effect.type);
  const reason = unavailableReason(layer.effect);
  if (!def || reason) return `unavailable (${reason} It's kept and changes nothing.)`;
  const parts = def.params.map((p) => {
    const v = layer.effect.params[p.key];
    if (p.kind === "number") return `${p.key} ${round(v as number, p.decimals)}${p.unit ? ` ${p.unit}` : ""}`;
    const set = v as CurveSet;
    return CURVE_CHANNELS.map((c) => `${c} ${pointsText(set[c])}`).join(", ");
  });
  return `${def.label}: ${parts.join(", ")}`;
}

/** One layer as the model reads it. */
export function describeLayer(layer: PhotoLayer, assets: readonly MediaAsset[], index: number): string {
  const faded = !layer.visible || layer.opacity < 1 ? [`   ${layer.visible ? "" : "hidden, "}opacity ${round(layer.opacity)}`] : [];
  const mask = layer.mask ? [`   mask: ${layer.mask.surface ? "painted (hides parts of it)" : "reveals everything (nothing painted on it yet)"}`] : [];
  if (layer.kind === "adjustment") return [`${index}. ${layer.id} "${layer.name}": adjustment layer (changes everything below it)`, `   ${describeAdjustment(layer)}`, ...mask, ...faded].join("\n");
  const size = sizeOf(layer, assets);
  const t = layer.transform;
  const asset = layer.kind === "image" ? assets.find((a) => a.id === layer.mediaId) : undefined;
  const what =
    layer.kind === "pixel"
      ? `pixel layer ${layer.size.width}×${layer.size.height}${layer.surface ? " (painted)" : " (empty: nothing painted yet)"}`
      : `image ${layer.mediaId}${asset ? ` (${asset.name}, ${asset.width}×${asset.height})` : " (missing: the file isn't in the project)"}`;
  const parts = [
    `${index}. ${layer.id} "${layer.name}": ${what}`,
    `   centre (${round(t.x)}, ${round(t.y)}), scale ${round(t.scaleX, 4)} × ${round(t.scaleY, 4)}, rotation ${round(t.rotation)}°`,
  ];
  if (size) {
    const b = bounds(t, size);
    parts.push(`   box on the canvas: x ${round(b.x0)}..${round(b.x1)}, y ${round(b.y0)}..${round(b.y1)}`);
  }
  return [...parts, ...mask, ...faded].join("\n");
}

/** `get_photo`: the canvas and the layers, top down. */
export function describePhoto(doc: PhotoProject, assets: readonly MediaAsset[], selected: readonly string[], selection: PhotoSelection | null = null): string {
  const lines = [
    `"${doc.name}": canvas ${doc.canvas.width}×${doc.canvas.height} px, background ${doc.canvas.background ?? "transparent"}.`,
    doc.layers.length ? `Layers, top first (${doc.layers.length}):` : "No layers yet.",
    ...[...doc.layers].reverse().map((l) => describeLayer(l, assets, doc.layers.indexOf(l))),
  ];
  if (selected.length) lines.push(`Selected layers: ${selected.join(", ")}.`);
  if (selection) lines.push(`Selection (marching ants): x ${round(selection.x)}..${round(selection.x + selection.width)}, y ${round(selection.y)}..${round(selection.y + selection.height)}.`);
  return lines.join("\n");
}

/** `list_photo_media`. */
export function describeMedia(assets: readonly MediaAsset[]): string {
  const images = assets.filter((a) => a.kind === "image");
  if (!images.length) return "The project has no images yet: the user can drop or place files into the editor.";
  return images.map((a) => `${a.id} "${a.name}" ${a.width}×${a.height}${a.image ? `, ${a.image.bits}-bit${a.image.hasAlpha ? ", transparent" : ""}` : ""}`).join("\n");
}

/** What `merge_layers` merges: its kind and the layers named (checked; the error says what to give). */
export function mergeRequest(doc: PhotoProject, input: Input): { kind: MergeKind; ids: string[] } {
  const ids = (Array.isArray(input.layers) ? input.layers : []).map((ref) => findLayerRef(doc, ref).id);
  if (input.visible === true) return { kind: "visible", ids };
  if (input.down === true) {
    if (ids.length !== 1) throw new Error("down: true merges one layer into the layer right below it: give exactly one in layers.");
    return { kind: "down", ids };
  }
  if (ids.length < 2) throw new Error("Give two or more layers to merge, one with down: true to merge it into the layer below, or visible: true.");
  return { kind: "selected", ids };
}

export const addImageLayerTool: PhotoEdit = (doc, input, env) => {
  const wanted = String(input.media ?? "").trim();
  const images = env.assets.filter((a) => a.kind === "image");
  const asset = images.find((a) => a.id === wanted) ?? images.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
  if (!asset) throw new Error(`No image "${wanted}" in the project. Its images: ${images.map((a) => `${a.id} ("${a.name}")`).join(", ") || "none"}.`);
  const layer = imageLayerOf(asset, typeof input.name === "string" && input.name.trim() ? input.name : undefined);
  const next = addImageLayer(doc, layer);
  const placed = next.layers.at(-1)!;
  return { doc: next, layerId: layer.id, text: `Placed ${asset.name} as layer ${layer.id} on top.\n${describeLayer(placed, env.assets, next.layers.length - 1)}` };
};

/** An image or pixel layer by id or name: adjustments have no place to move. */
function findPlacedRef(doc: PhotoProject, ref: unknown): PlacedLayer {
  const layer = findLayerRef(doc, ref);
  if (!isPlaced(layer)) throw new Error(`"${layer.name}" is an adjustment layer: it has no place of its own (it changes everything below it). Move it in the stack with set_layer's order.`);
  return layer;
}

export const transformLayerTool: PhotoEdit = (doc, input, env) => {
  const layer = findPlacedRef(doc, input.layer);
  let t: LayerTransform = { ...layer.transform };
  const size = sizeOf(layer, env.assets);
  if (input.fit === "contain" || input.fit === "cover") {
    if (!size) throw new Error(`Layer "${layer.name}"'s image is missing, so it can't be fitted.`);
    t = fitted(t, size, doc.canvas, input.fit);
  }
  const scale = num(input.scale);
  if (scale !== undefined) t = { ...t, scaleX: Math.sign(t.scaleX || 1) * Math.abs(scale), scaleY: Math.sign(t.scaleY || 1) * Math.abs(scale) };
  t = {
    x: (num(input.x) ?? t.x) + (num(input.dx) ?? 0),
    y: (num(input.y) ?? t.y) + (num(input.dy) ?? 0),
    scaleX: num(input.scaleX) ?? t.scaleX,
    scaleY: num(input.scaleY) ?? t.scaleY,
    rotation: num(input.rotation) ?? t.rotation,
  };
  if (t.scaleX === 0 || t.scaleY === 0) throw new Error("A scale of 0 would make the layer vanish: use set_layer with visible: false to hide it.");
  const next = setTransform(doc, layer.id, t);
  const after = findLayer(next, layer.id)!;
  return { doc: next, layerId: layer.id, text: next === doc ? `Layer "${layer.name}" was already there.` : `Transformed "${layer.name}".\n${describeLayer(after, env.assets, next.layers.indexOf(after))}` };
};

export const setLayerTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  let next = updateLayer(doc, layer.id, {
    name: typeof input.name === "string" ? input.name : undefined,
    visible: typeof input.visible === "boolean" ? input.visible : undefined,
    opacity: num(input.opacity),
  });
  const order = num(input.order);
  if (order !== undefined) next = moveLayer(next, layer.id, order);
  const after = findLayer(next, layer.id)!;
  return {
    doc: next,
    layerId: layer.id,
    text: `Layer "${after.name}": ${after.visible ? "shown" : "hidden"}, opacity ${round(after.opacity)}, ${next.layers.indexOf(after)} of ${next.layers.length - 1} from the bottom.`,
  };
};

/**
 * The model's parameters for an adjustment, checked strictly (an error says what's allowed, rather than a value
 * silently held): numbers within their range; for Curves, curves given at the top (`rgb`, `red`...) or under
 * `curves`, each replacing that curve of `current`.
 */
export function adjustmentPatch(def: EffectDefinition, raw: unknown, current: Record<string, unknown>): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`params must be an object of ${def.label}'s parameters: ${def.params.map((p) => p.key).join(", ")}.`);
  const given = { ...(raw as Record<string, unknown>) };
  const patch: Record<string, unknown> = {};
  for (const spec of def.params) {
    if (spec.kind === "number") {
      if (!(spec.key in given)) continue;
      const v = given[spec.key];
      delete given[spec.key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < spec.min || v > spec.max) throw new Error(`${spec.key} must be a number from ${spec.min} to ${spec.max}${spec.unit ? ` (${spec.unit})` : ""}; got ${JSON.stringify(v)}.`);
      patch[spec.key] = v;
      continue;
    }
    // Curves: { curves: { rgb, ... } } or { rgb, red, ... } at the top.
    const nested = given[spec.key];
    delete given[spec.key];
    const source = (nested && typeof nested === "object" && !Array.isArray(nested) ? nested : given) as Record<string, unknown>;
    const set = { ...(current[spec.key] as CurveSet) };
    let touched = false;
    for (const channel of CURVE_CHANNELS) {
      if (!(channel in source)) continue;
      const points = source[channel];
      if (source === given) delete given[channel];
      const ok =
        Array.isArray(points) &&
        points.length >= 2 &&
        points.length <= MAX_CURVE_POINTS &&
        points.every((p, i) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && n >= 0 && n <= 255) && (i === 0 || p[0] > (points[i - 1] as number[])[0]));
      if (!ok) throw new Error(`${channel} must be 2 to ${MAX_CURVE_POINTS} points [input, output], each 0..255, inputs increasing; got ${JSON.stringify(points)}.`);
      set[channel] = (points as [number, number][]).map(([x, y]) => [x, y]);
      touched = true;
    }
    if (touched) patch[spec.key] = set;
  }
  const unknown = Object.keys(given);
  if (unknown.length) throw new Error(`${def.label} has no parameter ${unknown.map((k) => `"${k}"`).join(", ")}. Its parameters: ${def.params.map((p) => (p.kind === "curves" ? CURVE_CHANNELS.join(", ") : p.key)).join(", ")}.`);
  return patch;
}

export const addAdjustmentTool: PhotoEdit = (doc, input) => {
  const def = effectDefinition(String(input.type ?? ""));
  if (!def) throw new Error(`No adjustment "${String(input.type)}". The adjustments: ${ADJUSTMENTS.map((d) => d.type).join(", ")}.`);
  const above = input.above === undefined ? null : findLayerRef(doc, input.above).id;
  const id = createId("layer");
  const fresh = addAdjustmentLayer(doc, { id, type: def.type, name: typeof input.name === "string" ? input.name : undefined }, above);
  const layer = findLayer(fresh, id) as AdjustmentLayer;
  const next = setEffectParams(fresh, id, adjustmentPatch(def, input.params, layer.effect.params));
  const after = findLayer(next, id) as AdjustmentLayer;
  return { doc: next, layerId: id, text: `Added ${def.label} layer ${id} "${after.name}", ${next.layers.indexOf(after)} of ${next.layers.length - 1} from the bottom.\n   ${describeAdjustment(after)}` };
};

export const setEffectParamsTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  if (layer.kind !== "adjustment") throw new Error(`"${layer.name}" is an ${layer.kind} layer: only adjustment layers have parameters. The adjustment layers: ${doc.layers.filter((l) => l.kind === "adjustment").map((l) => `${l.id} ("${l.name}")`).join(", ") || "none: add one with add_adjustment"}.`);
  const reason = unavailableReason(layer.effect);
  if (reason) throw new Error(`${reason} It can't be changed here.`);
  const def = effectDefinition(layer.effect.type)!;
  let next = input.reset === true ? resetEffect(doc, layer.id) : doc;
  const current = (findLayer(next, layer.id) as AdjustmentLayer).effect.params;
  next = setEffectParams(next, layer.id, adjustmentPatch(def, input.params, current));
  const after = findLayer(next, layer.id) as AdjustmentLayer;
  return { doc: next, layerId: layer.id, text: next === doc ? `"${layer.name}" already had those settings.` : `"${after.name}": ${describeAdjustment(after)}` };
};

export const addPixelLayerTool: PhotoEdit = (doc, input, env) => {
  const above = input.above === undefined ? null : findLayerRef(doc, input.above).id;
  const id = createId("layer");
  const next = addPixelLayer(doc, { id, name: typeof input.name === "string" ? input.name : undefined }, above);
  const layer = findLayer(next, id)!;
  return { doc: next, layerId: id, text: `Added an empty pixel layer ${id} "${layer.name}" the canvas's size, ${next.layers.indexOf(layer)} of ${next.layers.length - 1} from the bottom.\n${describeLayer(layer, env.assets, next.layers.indexOf(layer))}` };
};

/** An empty mask (reveals everything until it's painted), or none for `remove`. A mask from the selection is the tab's (it renders it). */
export const maskTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  if (input.remove === true) {
    if (!layer.mask) throw new Error(`"${layer.name}" has no mask.`);
    return { doc: removeMask(doc, layer.id), layerId: layer.id, text: `Removed "${layer.name}"'s mask: it shows whole again.` };
  }
  if (layer.mask) return { doc, layerId: layer.id, text: `"${layer.name}" has a mask already${layer.mask.surface ? " (painted)" : ""}.` };
  return { doc: setMask(doc, layer.id, null), layerId: layer.id, text: `Added a mask to "${layer.name}": it reveals everything until the user paints on it (black hides, white reveals).` };
};

export const removeLayerTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  return { doc: removeLayer(doc, layer.id), text: `Deleted layer "${layer.name}" (undoable).` };
};

export const setCanvasTool: PhotoEdit = (doc, input) => {
  const background = input.background === "none" ? null : input.background;
  if (background !== undefined && background !== null && !isColour(background)) throw new Error('background must be a colour like "#ffffff", or "none".');
  const width = num(input.width);
  const height = num(input.height);
  for (const [name, v] of [["width", width], ["height", height]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 30000)) throw new Error(`${name} must be a whole number of pixels from 1 to 30000.`);
  }
  if (input.highlights !== undefined && input.highlights !== "film" && input.highlights !== "clip") throw new Error('highlights must be "film" or "clip".');
  let next = setCanvas(doc, { width, height, background: background as string | null | undefined }, input.anchor === "centre" ? "centre" : "top-left");
  if (input.highlights !== undefined) next = setHighlights(next, input.highlights);
  return { doc: next, text: `Canvas: ${next.canvas.width}×${next.canvas.height} px, background ${next.canvas.background ?? "transparent"}, highlights ${next.output.highlights}.` };
};
