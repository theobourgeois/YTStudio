/**
 * The photo assistant's edits (`shared/photo/tools.ts`), pure: `(doc, input, env) => { doc, text }`, each one undo
 * step in the open photo or one save of a photo that isn't open. Errors go to the model: they say what's wrong
 * and what there is to choose from.
 */
import { createId } from "@shared/ids";
import { BLEND_IF_CHANNELS, BLEND_MODES, type BlendingPatch, compositingOf, describeBlending, isBlendMode, normalizeRange } from "@shared/photo/blending";
import { contourPreset } from "@shared/photo/style/contours";
import { STYLE_LIST, styleDefinition } from "@shared/photo/style/definitions";
import { gradientPreset } from "@shared/photo/style/gradients";
import { addStyleEffect, describeStyle, globalLightOf, newStyleEffect, removeStyleEffect, setGlobalLight, setLayerStyle, setStyleEffect, setStyleEnabled } from "@shared/photo/style/style";
import {
  addAdjustmentLayer,
  addFilter,
  addGeneratorLayer,
  addImageLayer,
  addPixelLayer,
  findLayer,
  moveFilter,
  moveLayer,
  removeFilter,
  removeLayer,
  removeMask,
  resetEffect,
  setCanvas,
  setCompositing,
  setEffectParams,
  setFilter,
  setFiltersEnabled,
  setGeneratorBlend,
  setHandle,
  setHighlights,
  setLayerBlending,
  setMask,
  setTransform,
  updateLayer,
} from "@shared/photo/edits";
import { FLARE_PRESETS } from "@shared/photo/effects/flare";
import { ADJUSTMENTS, type EffectDefinition, type EffectKind, FILTERS, GENERATORS, effectDefinition, newEffect, unavailableReason } from "@shared/photo/effects/index";
import { CURVE_CHANNELS, type ElementParamSpec, MAX_CURVE_POINTS, type ParamSpec } from "@shared/photo/effects/params";
import { bounds } from "@shared/photo/layers";
import type { MergeKind } from "@shared/photo/merge";
import { isColour } from "@shared/photo/project";
import {
  type AdjustmentLayer,
  type ContentLayer,
  type CurveSet,
  type DocPoint,
  type EffectElement,
  type EffectInstance,
  type EffectParamValue,
  type GeneratorLayer,
  type LayerTransform,
  type PhotoLayer,
  type PhotoProject,
  type PhotoSelection,
  type PlacedLayer,
  hasContent,
  isPlaced,
} from "@shared/photo/types";
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

/** A parameter's value as the model reads it. */
function paramText(spec: ParamSpec, v: EffectParamValue | undefined): string {
  switch (spec.kind) {
    case "number":
      return `${spec.key} ${round(v as number, spec.decimals)}${spec.unit ? ` ${spec.unit}` : ""}`;
    case "curves":
      return CURVE_CHANNELS.map((c) => `${c} ${pointsText((v as CurveSet)[c])}`).join(", ");
    case "point":
      return `${spec.key} ${v === null ? "(the canvas's centre)" : `(${round((v as DocPoint)[0])}, ${round((v as DocPoint)[1])})`}`;
    case "elements": {
      const list = v as EffectElement[];
      return `${spec.key}: ${list.length ? "" : "none"}\n${list
        .map((e) => {
          const type = spec.types.find((t) => t.type === e.type);
          const own = type ? type.params.map((p) => paramText(p, e[p.key])).join(", ") : "";
          return `      ${e.id} ${e.type}${e.enabled ? "" : " (hidden)"}: ${own}`;
        })
        .join("\n")}`;
    }
    default:
      return `${spec.key} ${String(v)}`;
  }
}

/** An effect's parameters as the model reads them, or why it can't be used. */
function describeEffect(effect: EffectInstance, kind: EffectKind): string {
  const def = effectDefinition(effect.type);
  const reason = unavailableReason(effect, kind);
  if (!def || reason) return `unavailable (${reason} It's kept and changes nothing.)`;
  return `${def.label}: ${def.params.map((p) => paramText(p, effect.params[p.key])).join(", ")}`;
}

/** A generator layer's effect and how it blends. */
export function describeGenerator(layer: GeneratorLayer): string {
  return `${describeEffect(layer.effect, "generator")}\n   blend ${layer.blend ?? "normal"}${layer.blendSpace === "linear" ? " in linear light" : ""}`;
}

/** A layer's filters, first applied first: what the model reads under the layer. */
export function describeFilters(layer: ContentLayer): string[] {
  const filters = layer.filters ?? [];
  if (!filters.length) return [];
  const off = layer.filtersEnabled === false ? " (all bypassed)" : "";
  return [`   filters${off}, first applied first:`, ...filters.map((f) => `     ${f.id}${f.enabled ? "" : " (bypassed)"}: ${describeEffect(f, "filter")}`)];
}

/** One layer as the model reads it. */
export function describeLayer(layer: PhotoLayer, assets: readonly MediaAsset[], index: number): string {
  const faded = !layer.visible || layer.opacity < 1 ? [`   ${layer.visible ? "" : "hidden, "}opacity ${round(layer.opacity)}`] : [];
  const blending = describeBlending(layer);
  if (blending) faded.push(`   blending: ${blending}`);
  const style = describeStyle(layer);
  if (style) faded.push(`   effects (top first): ${style}`);
  const mask = layer.mask ? [`   mask: ${layer.mask.surface ? "painted (hides parts of it)" : "reveals everything (nothing painted on it yet)"}`] : [];
  if (layer.kind === "adjustment") return [`${index}. ${layer.id} "${layer.name}": adjustment layer (changes everything below it)`, `   ${describeAdjustment(layer)}`, ...mask, ...faded].join("\n");
  const filters = describeFilters(layer);
  if (layer.kind === "generator") return [`${index}. ${layer.id} "${layer.name}": generator layer`, `   ${describeGenerator(layer)}`, ...filters, ...mask, ...faded].join("\n");
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
  return [...parts, ...filters, ...mask, ...faded].join("\n");
}

/** `get_photo`: the canvas and the layers, top down. */
export function describePhoto(doc: PhotoProject, assets: readonly MediaAsset[], selected: readonly string[], selection: PhotoSelection | null = null): string {
  const lines = [
    `"${doc.name}": canvas ${doc.canvas.width}×${doc.canvas.height} px, background ${doc.canvas.background ?? "transparent"}, layers mix ${compositingOf(doc) === "photoshop" ? "as Photoshop's (encoded values)" : "in linear light"}, highlights ${doc.output.highlights} (light brighter than white ${doc.output.highlights === "film" ? "rolls towards white" : "is clipped"}).`,
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
  if (input.blend !== undefined) {
    if (layer.kind !== "generator") throw new Error(`blend is a generator layer's (a Lens Flare's) for now: "${layer.name}" is an ${layer.kind} layer.`);
    if (input.blend !== "add" && input.blend !== "normal") throw new Error('blend must be "add" (Linear Dodge in linear light: light adds to what\'s below) or "normal".');
    next = setGeneratorBlend(next, layer.id, input.blend === "add" ? "linear-dodge" : "normal", input.blend === "add" ? "linear" : "document");
  }
  const after = findLayer(next, layer.id)!;
  return {
    doc: next,
    layerId: layer.id,
    text: `Layer "${after.name}": ${after.visible ? "shown" : "hidden"}, opacity ${round(after.opacity)}, ${next.layers.indexOf(after)} of ${next.layers.length - 1} from the bottom.`,
  };
};

/** `set_layer_blending`: Blending Options on layers, checked strictly (an error says what's allowed). */
export const setLayerBlendingTool: PhotoEdit = (doc, input) => {
  const refs = Array.isArray(input.layers) ? input.layers : input.layer !== undefined ? [input.layer] : [];
  if (!refs.length) throw new Error("Give layers: a list of layer ids or names.");
  const ids = refs.map((r) => findLayerRef(doc, r).id);
  const patch: BlendingPatch = {};
  if (input.mode !== undefined) {
    if (!isBlendMode(input.mode)) throw new Error(`mode must be one of: ${BLEND_MODES.map((m) => m.id).join(", ")}.`);
    patch.blend = input.mode;
  }
  for (const key of ["opacity", "fill"] as const) {
    const v = num(input[key]);
    if (v === undefined) continue;
    if (v < 0 || v > 1) throw new Error(`${key} must be from 0 to 1 (${key === "fill" ? "Fill" : "Opacity"} 50% is 0.5).`);
    patch[key] = v;
  }
  if (input.channels !== undefined) {
    if (!input.channels || typeof input.channels !== "object") throw new Error('channels is { "r": true, "g": false, "b": true }.');
    const c = input.channels as Record<string, unknown>;
    patch.channels = Object.fromEntries((["r", "g", "b"] as const).filter((k) => typeof c[k] === "boolean").map((k) => [k, c[k]]));
  }
  if (input.blendIf === null) patch.blendIf = null;
  else if (input.blendIf !== undefined) {
    if (typeof input.blendIf !== "object") throw new Error('blendIf is { "gray": { "layer": [0, 0, 255, 255], "underlying": [0, 0, 255, 255] } }, or null to clear it.');
    const out: NonNullable<BlendingPatch["blendIf"]> = {};
    for (const [entry, value] of Object.entries(input.blendIf as Record<string, unknown>)) {
      if (!(BLEND_IF_CHANNELS as readonly string[]).includes(entry)) throw new Error(`blendIf's entries are ${BLEND_IF_CHANNELS.join(", ")}; "${entry}" isn't one.`);
      if (value === null) {
        out[entry as (typeof BLEND_IF_CHANNELS)[number]] = null;
        continue;
      }
      const v = (value ?? {}) as Record<string, unknown>;
      const side = (name: "layer" | "underlying") => {
        if (v[name] === undefined) return undefined;
        const r = normalizeRange(v[name]);
        if (!r) throw new Error(`blendIf.${entry}.${name} must be four numbers on 0..255: [black low, black high, white low, white high].`);
        return r;
      };
      out[entry as (typeof BLEND_IF_CHANNELS)[number]] = { layer: side("layer"), underlying: side("underlying") };
    }
    patch.blendIf = out;
  }
  const next = setLayerBlending(doc, ids, patch);
  const lines = ids.map((id) => {
    const l = findLayer(next, id)!;
    return `"${l.name}": ${describeBlending(l) ?? "Normal"}, opacity ${round(l.opacity)}`;
  });
  return { doc: next, layerId: ids[0], text: next === doc ? `Nothing changed: ${lines.join("; ")}.` : `Blending: ${lines.join("; ")}.` };
};

/** A model's effect parameters, with contours and gradients by preset name allowed. */
function effectParams(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error('params is an object of parameters, e.g. { "size": 12, "opacity": 50 }.');
  const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (typeof out.contour === "string") {
    const c = contourPreset(out.contour);
    if (!c) throw new Error(`No contour "${out.contour}": Linear, Cone, Cone - Inverted, Cove - Deep, Cove - Shallow, Gaussian, Half Round, Ring, Ring - Double, Rolling Slope - Descending, Rounded Steps, Sawtooth 1.`);
    out.contour = c;
  }
  if (typeof out.gradient === "string") {
    const g = gradientPreset(out.gradient);
    if (!g) throw new Error(`No gradient preset "${out.gradient}": give its stops instead.`);
    out.gradient = g;
  }
  return out;
}

/** `set_layer_style`: a layer's effects added, changed, hidden or removed. */
export const setLayerStyleTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  if (layer.kind === "adjustment") throw new Error(`"${layer.name}" is an adjustment layer: it has Blending Options (set_layer_blending) but no effects. Give an image or pixel layer.`);
  let next = doc;
  const said: string[] = [];
  if (input.clear === true) {
    next = setLayerStyle(next, [layer.id], null, () => createId("fx"));
    said.push("cleared its effects");
  }
  if (typeof input.add === "string") {
    const def = styleDefinition(input.add);
    if (!def) throw new Error(`No effect "${input.add}". The effects: ${STYLE_LIST.join(", ")}.`);
    const have = (findLayer(next, layer.id)!.style?.effects ?? []).filter((e) => e.type === def.type).length;
    if (have >= def.max) throw new Error(`"${layer.name}" has ${have} ${def.label} already, the most it can have: change it with effect "${def.type}" instead.`);
    const e = newStyleEffect(def.type, createId("fx"), effectParams(input.params))!;
    next = addStyleEffect(next, layer.id, e);
    said.push(`added ${def.label} ${e.id}`);
  } else if (input.effect !== undefined) {
    const effects = findLayer(next, layer.id)!.style?.effects ?? [];
    const e = effects.find((x) => x.id === input.effect) ?? [...effects].reverse().find((x) => x.type === input.effect);
    if (!e) throw new Error(`"${layer.name}" has no effect "${String(input.effect)}". Its effects: ${effects.map((x) => `${x.id} (${x.type})`).join(", ") || "none: add one with add"}.`);
    if (input.remove === true) {
      next = removeStyleEffect(next, layer.id, e.id);
      said.push(`removed ${e.id}`);
    } else {
      next = setStyleEffect(next, layer.id, e.id, { enabled: typeof input.enabled === "boolean" ? input.enabled : undefined, params: input.params !== undefined ? effectParams(input.params) : undefined });
      said.push(`changed ${e.id}`);
    }
  }
  if (typeof input.allEffects === "boolean") {
    next = setStyleEnabled(next, [layer.id], input.allEffects);
    said.push(input.allEffects ? "showed its effects" : "hid its effects");
  }
  const after = findLayer(next, layer.id)!;
  return { doc: next, layerId: layer.id, text: `"${after.name}": ${said.join(", ") || "nothing to do"}. Effects (top first): ${describeStyle(after) ?? "none"}.` };
};

/** `set_global_light`. */
export const setGlobalLightTool: PhotoEdit = (doc, input) => {
  const next = setGlobalLight(doc, { angle: num(input.angle), altitude: num(input.altitude) });
  const g = globalLightOf(next);
  return { doc: next, text: `Global Light: ${g.angle}°, altitude ${g.altitude}°.` };
};

/** `copy_layer_style`: one layer's effects and Blending Options onto others. */
export const copyLayerStyleTool: PhotoEdit = (doc, input) => {
  const from = findLayerRef(doc, input.from);
  const to = (Array.isArray(input.to) ? input.to : [input.to]).map((r) => findLayerRef(doc, r));
  let next = setLayerStyle(doc, to.filter((l) => l.kind !== "adjustment").map((l) => l.id), from.style ?? null, () => createId("fx"));
  next = setLayerBlending(next, to.map((l) => l.id), { blend: from.blend ?? "normal", fill: from.fill ?? 1, channels: from.blending?.channels ?? { r: true, g: true, b: true }, blendIf: from.blending?.blendIf ?? null, interiorAsGroup: from.blending?.interiorAsGroup ?? false, maskHidesEffects: from.blending?.maskHidesEffects ?? false });
  return { doc: next, layerId: to[0]?.id, text: `Pasted "${from.name}"'s layer style onto ${to.map((l) => `"${l.name}"`).join(", ")}.` };
};

/**
 * The model's parameters for an effect, checked strictly (an error says what's allowed, rather than a value silently
 * held): numbers within their range, colours "#rrggbb", one of a choice's values, booleans, points [x, y] (null for
 * one that can follow the canvas's centre); for Curves, curves given at the top (`rgb`, `red`...) or under
 * `curves`, each replacing that curve of `current`; an element list replaced whole, each element checked.
 */
export function effectPatch(def: EffectDefinition, raw: unknown, current: Record<string, unknown>): Record<string, unknown> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`params must be an object of ${def.label}'s parameters: ${def.params.map((p) => p.key).join(", ")}.`);
  const given = { ...(raw as Record<string, unknown>) };
  const patch: Record<string, unknown> = {};
  for (const spec of def.params) {
    if (spec.kind === "curves") {
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
      continue;
    }
    if (!(spec.key in given)) continue;
    const v = given[spec.key];
    delete given[spec.key];
    if (spec.kind === "elements") {
      if (!Array.isArray(v)) throw new Error(`${spec.key} must be a list of elements: { type, ...its parameters } each (keep an element's id to keep it).`);
      patch[spec.key] = v.map((e, i) => {
        const type = e && typeof e === "object" ? spec.types.find((t) => t.type === (e as Record<string, unknown>).type) : undefined;
        if (!type) throw new Error(`${spec.key}[${i}] needs a type: ${spec.types.map((t) => t.type).join(", ")}.`);
        const { id, type: _, enabled, ...values } = e as Record<string, unknown>;
        const checked = elementPatch(type.params, values, `${spec.key}[${i}] (${type.type})`);
        return { ...(typeof id === "string" ? { id } : {}), type: type.type, enabled: enabled !== false, ...checked };
      });
      continue;
    }
    patch[spec.key] = checkValue(spec, v, spec.key);
  }
  const unknown = Object.keys(given);
  if (unknown.length) throw new Error(`${def.label} has no parameter ${unknown.map((k) => `"${k}"`).join(", ")}. Its parameters: ${def.params.map((p) => (p.kind === "curves" ? CURVE_CHANNELS.join(", ") : p.key)).join(", ")}.`);
  return patch;
}

/** The old name, for adjustments. */
export const adjustmentPatch = effectPatch;

/** One parameter's value, checked strictly against its spec. */
function checkValue(spec: Exclude<ParamSpec, { kind: "curves" | "elements" }>, v: unknown, name: string): unknown {
  switch (spec.kind) {
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v) || v < spec.min || v > spec.max) throw new Error(`${name} must be a number from ${spec.min} to ${spec.max}${spec.unit ? ` (${spec.unit})` : ""}; got ${JSON.stringify(v)}.`);
      return v;
    case "colour":
      if (!isColour(v)) throw new Error(`${name} must be a colour like "#ffb070"; got ${JSON.stringify(v)}.`);
      return (v as string).toLowerCase();
    case "choice":
      if (!spec.options.some((o) => o.value === v)) throw new Error(`${name} must be one of ${spec.options.map((o) => o.value).join(", ")}; got ${JSON.stringify(v)}.`);
      return v;
    case "boolean":
      if (typeof v !== "boolean") throw new Error(`${name} must be true or false.`);
      return v;
    case "point":
      if (v === null && spec.nullable) return null;
      if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error(`${name} must be [x, y] in canvas pixels${spec.nullable ? " (or null: the canvas's centre)" : ""}; got ${JSON.stringify(v)}.`);
      return [v[0], v[1]];
  }
}

/** An element's own parameters, checked strictly. */
function elementPatch(specs: readonly ElementParamSpec[], values: Record<string, unknown>, name: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(values)) {
    const spec = specs.find((p) => p.key === key);
    if (!spec) throw new Error(`${name} has no parameter "${key}". Its parameters: ${specs.map((p) => p.key).join(", ")}.`);
    out[key] = checkValue(spec, v, `${name} ${key}`);
  }
  return out;
}

export const addAdjustmentTool: PhotoEdit = (doc, input) => {
  const def = effectDefinition(String(input.type ?? ""));
  if (def?.kind !== "adjustment") throw new Error(`No adjustment "${String(input.type)}". The adjustments: ${ADJUSTMENTS.map((d) => d.type).join(", ")}.${def ? ` (${def.label} is a ${def.kind}: ${def.kind === "filter" ? "add it with add_filter" : "add it with add_generator"}.)` : ""}`);
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
  if (layer.kind !== "adjustment" && layer.kind !== "generator")
    throw new Error(
      `"${layer.name}" is an ${layer.kind} layer: only adjustment and generator layers have parameters of their own (a layer's filters: set_filter). The ones there are: ${doc.layers.filter((l) => l.kind === "adjustment" || l.kind === "generator").map((l) => `${l.id} ("${l.name}")`).join(", ") || "none"}.`,
    );
  const reason = unavailableReason(layer.effect, layer.kind);
  if (reason) throw new Error(`${reason} It can't be changed here.`);
  const def = effectDefinition(layer.effect.type)!;
  let next = input.reset === true ? (layer.kind === "adjustment" ? resetEffect(doc, layer.id) : setEffectParams(doc, layer.id, Object.fromEntries(def.params.filter((p) => p.kind !== "point" && p.kind !== "elements").map((p) => [p.key, p.default])))) : doc;
  const current = (findLayer(next, layer.id) as AdjustmentLayer | GeneratorLayer).effect.params;
  next = setEffectParams(next, layer.id, effectPatch(def, input.params, current));
  const after = findLayer(next, layer.id) as AdjustmentLayer | GeneratorLayer;
  const text = after.kind === "adjustment" ? describeAdjustment(after) : describeGenerator(after);
  return { doc: next, layerId: layer.id, text: next === doc ? `"${layer.name}" already had those settings.` : `"${after.name}": ${text}` };
};

/** A filter of a layer by its id or its number in the layer's list (1: the first applied), or an error listing them. */
function findFilterRef(layer: ContentLayer, ref: unknown): EffectInstance {
  const filters = layer.filters ?? [];
  const found = typeof ref === "number" ? filters[ref - 1] : filters.find((f) => f.id === ref) ?? (typeof ref === "string" && /^\d+$/.test(ref) ? filters[Number(ref) - 1] : undefined);
  if (found) return found;
  throw new Error(`"${layer.name}" has no filter ${JSON.stringify(ref)}. Its filters, first applied first: ${filters.map((f, i) => `${i + 1}. ${f.id} (${f.type})`).join(", ") || "none: add one with add_filter"}.`);
}

/** A layer that can have filters, or an error. */
function contentLayerRef(doc: PhotoProject, ref: unknown): ContentLayer {
  const layer = findLayerRef(doc, ref);
  if (!hasContent(layer)) throw new Error(`"${layer.name}" is an adjustment layer: filters work on a layer's own pixels (an image, pixel or generator layer).`);
  return layer;
}

export const addFilterTool: PhotoEdit = (doc, input) => {
  const layer = contentLayerRef(doc, input.layer);
  const def = effectDefinition(String(input.type ?? ""));
  if (def?.kind !== "filter") throw new Error(`No filter "${String(input.type)}". The filters: ${FILTERS.map((d) => d.type).join(", ")}.`);
  const id = createId("fx");
  const fresh = addFilter(doc, layer.id, { id, type: def.type });
  const next = setFilter(fresh, layer.id, id, { params: effectPatch(def, input.params, newEffect(def, id).params) });
  const after = findLayer(next, layer.id) as ContentLayer;
  return { doc: next, layerId: layer.id, text: `Added ${def.label} ${id} to "${layer.name}", applied after its other filters.\n${describeFilters(after).join("\n")}` };
};

export const setFilterTool: PhotoEdit = (doc, input) => {
  const layer = contentLayerRef(doc, input.layer);
  const filter = findFilterRef(layer, input.filter);
  const def = effectDefinition(filter.type);
  const reason = unavailableReason(filter, "filter");
  let next = doc;
  if (input.params !== undefined || input.reset === true) {
    if (!def || reason) throw new Error(`${reason} It can't be changed here.`);
    if (input.reset === true) next = setFilter(next, layer.id, filter.id, { params: newEffect(def, filter.id).params });
    const current = (findLayer(next, layer.id) as ContentLayer).filters!.find((f) => f.id === filter.id)!.params;
    next = setFilter(next, layer.id, filter.id, { params: effectPatch(def, input.params, current) });
  }
  if (typeof input.enabled === "boolean") next = setFilter(next, layer.id, filter.id, { enabled: input.enabled });
  if (input.order !== undefined) {
    if (typeof input.order !== "number" || !Number.isInteger(input.order) || input.order < 1) throw new Error("order must be a whole number from 1 (applied first).");
    next = moveFilter(next, layer.id, filter.id, input.order - 1);
  }
  if (typeof input.all_enabled === "boolean") next = setFiltersEnabled(next, layer.id, input.all_enabled);
  const after = findLayer(next, layer.id) as ContentLayer;
  return { doc: next, layerId: layer.id, text: next === doc ? `"${layer.name}"'s filters already were that way.` : `"${after.name}":\n${describeFilters(after).join("\n")}` };
};

export const removeFilterTool: PhotoEdit = (doc, input) => {
  const layer = contentLayerRef(doc, input.layer);
  const filter = findFilterRef(layer, input.filter);
  return { doc: removeFilter(doc, layer.id, filter.id), layerId: layer.id, text: `Removed ${filter.type} ${filter.id} from "${layer.name}" (undoable).` };
};

export const addGeneratorTool: PhotoEdit = (doc, input) => {
  const def = effectDefinition(String(input.type ?? "lens-flare"));
  if (def?.kind !== "generator") throw new Error(`No generator "${String(input.type)}". The generators: ${GENERATORS.map((d) => d.type).join(", ")}.`);
  const preset = input.preset === undefined ? undefined : String(input.preset);
  if (preset !== undefined && !FLARE_PRESETS.some((p) => p.id === preset)) throw new Error(`No preset "${preset}". The presets: ${FLARE_PRESETS.map((p) => p.id).join(", ")}.`);
  const above = input.above === undefined ? null : findLayerRef(doc, input.above).id;
  const id = createId("layer");
  const fresh = addGeneratorLayer(doc, { id, type: def.type, preset, name: typeof input.name === "string" ? input.name : undefined }, above);
  const params = effectPatch(def, { ...(input.source !== undefined ? { source: input.source } : {}), ...((input.params as object | undefined) ?? {}) }, (findLayer(fresh, id) as GeneratorLayer).effect.params);
  const next = setEffectParams(fresh, id, params);
  const layer = findLayer(next, id) as GeneratorLayer;
  return { doc: next, layerId: id, text: `Added ${def.label} layer ${id} "${layer.name}", ${next.layers.indexOf(layer)} of ${next.layers.length - 1} from the bottom.\n   ${describeGenerator(layer)}` };
};

export const moveHandleTool: PhotoEdit = (doc, input) => {
  const layer = findLayerRef(doc, input.layer);
  if (layer.kind !== "generator") throw new Error(`"${layer.name}" is an ${layer.kind} layer: only generator layers (a Lens Flare) have handles. Move a layer with transform_layer.`);
  const def = effectDefinition(layer.effect.type);
  const handles = def?.params.filter((p) => p.kind === "point" && p.handle) ?? [];
  const spec = handles.find((p) => p.key === input.handle);
  if (!spec || spec.kind !== "point") throw new Error(`handle must be one of ${handles.map((h) => h.key).join(", ")}.`);
  let value: DocPoint | null;
  if (input.follow_canvas === true) {
    if (!spec.nullable) throw new Error(`The ${spec.key} handle can't follow the canvas's centre.`);
    value = null;
  } else {
    const n = (v: unknown, name: string) => {
      if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Give ${name} in canvas pixels${spec.nullable ? " (or follow_canvas: true)" : ""}.`);
      return v;
    };
    value = [n(input.x, "x"), n(input.y, "y")];
  }
  const next = setHandle(doc, layer.id, spec.key, value);
  return { doc: next, layerId: layer.id, text: `"${layer.name}": ${describeGenerator(findLayer(next, layer.id) as GeneratorLayer)}` };
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
  if (input.compositing !== undefined && input.compositing !== "photoshop" && input.compositing !== "linear") throw new Error('compositing is "photoshop" or "linear".');
  if (input.highlights !== undefined && input.highlights !== "film" && input.highlights !== "clip") throw new Error('highlights must be "film" or "clip".');
  let next = setCanvas(doc, { width, height, background: background as string | null | undefined }, input.anchor === "centre" ? "centre" : "top-left");
  if (input.compositing) next = setCompositing(next, input.compositing as "photoshop" | "linear");
  if (input.highlights !== undefined) next = setHighlights(next, input.highlights);
  return { doc: next, text: `Canvas: ${next.canvas.width}×${next.canvas.height} px, background ${next.canvas.background ?? "transparent"}, layers mix ${compositingOf(next) === "photoshop" ? "as Photoshop's" : "in linear light"}, highlights ${next.output.highlights}.` };
};
