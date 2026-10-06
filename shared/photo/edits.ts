/**
 * Pure edits of a photo document, the only way it changes (the UI, keys and the assistant all use these). Each
 * returns the same document when nothing changes, so a no-op makes no undo step and no save.
 */
import { type BlendingPatch, patchBlending } from "./blending.ts";
import { type EffectDefinition, effectDefinition, newEffect, unavailableReason } from "./effects/index.ts";
import { flarePreset } from "./effects/flare.ts";
import { type ElementsParam, newElement, sameValue, sanitizeParam } from "./effects/params.ts";
import type { Size } from "./geometry.ts";
import { MIN_SCALE, isColour, wrapDegrees } from "./project.ts";
import {
  type AdjustmentLayer,
  type Compositing,
  type ContentLayer,
  type DocPoint,
  type EffectElement,
  type EffectInstance,
  type EffectParamValue,
  type BlendMode,
  type GeneratorLayer,
  type ImageLayer,
  type LayerTransform,
  MAX_CANVAS_SIDE,
  type PhotoCanvas,
  type PhotoLayer,
  type PhotoProject,
  type PixelLayer,
  type SurfaceId,
  hasContent,
  isPlaced,
} from "./types.ts";

export const findLayer = (doc: PhotoProject, id: string): PhotoLayer | undefined => doc.layers.find((l) => l.id === id);

function mapLayer(doc: PhotoProject, id: string, update: (layer: PhotoLayer) => PhotoLayer): PhotoProject {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== id) return l;
    const next = update(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

export interface NewImageLayer {
  id: string;
  mediaId: string;
  name: string;
  /** The source's upright size in its own pixels. */
  size: Size;
}

/**
 * Where a placed image goes: centred, at its own size, or scaled down to fit the canvas when it's bigger
 * (Photoshop's Place Embedded).
 */
export function placement(canvas: Size, size: Size): LayerTransform {
  const fit = Math.min(1, canvas.width / size.width, canvas.height / size.height);
  return { x: canvas.width / 2, y: canvas.height / 2, scaleX: fit, scaleY: fit, rotation: 0 };
}

/** A new image layer above `below` (an id), or at the top. */
export function addImageLayer(doc: PhotoProject, layer: NewImageLayer, options: { below?: string | null; transform?: LayerTransform } = {}): PhotoProject {
  if (findLayer(doc, layer.id)) return doc;
  const added: ImageLayer = {
    id: layer.id,
    kind: "image",
    name: layer.name.trim() || "Image",
    visible: true,
    opacity: 1,
    mediaId: layer.mediaId,
    transform: options.transform ?? placement(doc.canvas, layer.size),
  };
  const layers = [...doc.layers];
  const at = options.below ? layers.findIndex((l) => l.id === options.below) : -1;
  layers.splice(at >= 0 ? at : layers.length, 0, added);
  return { ...doc, layers };
}

/** The canvas the size of an image, with that image as its only layer, at 100%: a photo opened from a file. */
export function fromImage(doc: PhotoProject, layer: NewImageLayer): PhotoProject {
  const width = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(layer.size.width)));
  const height = Math.max(1, Math.min(MAX_CANVAS_SIDE, Math.round(layer.size.height)));
  const canvas: PhotoCanvas = { width, height, background: null };
  return addImageLayer({ ...doc, canvas, layers: [] }, layer, { transform: { x: width / 2, y: height / 2, scaleX: 1, scaleY: 1, rotation: 0 } });
}

const sameTransform = (a: LayerTransform, b: LayerTransform) =>
  a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotation === b.rotation;

/**
 * Sets part of a placed layer's transform (an image's or a pixel layer's); a scale too close to 0 is held at the
 * smallest (it has to stay invertible). Adjustments have no place of their own: nothing changes.
 */
export function setTransform(doc: PhotoProject, id: string, patch: Partial<LayerTransform>): PhotoProject {
  return mapLayer(doc, id, (l) => {
    if (!isPlaced(l)) return l;
    const t = { ...l.transform, ...patch };
    const clampScale = (s: number) => (Math.abs(s) < MIN_SCALE ? (s < 0 ? -MIN_SCALE : MIN_SCALE) : s);
    const next: LayerTransform = { x: t.x, y: t.y, scaleX: clampScale(t.scaleX), scaleY: clampScale(t.scaleY), rotation: wrapDegrees(t.rotation) };
    if (![next.x, next.y, next.scaleX, next.scaleY, next.rotation].every(Number.isFinite)) return l;
    return sameTransform(next, l.transform) ? l : { ...l, transform: next };
  });
}

export interface LayerPatch {
  name?: string;
  visible?: boolean;
  opacity?: number;
}

export function updateLayer(doc: PhotoProject, id: string, patch: LayerPatch): PhotoProject {
  return mapLayer(doc, id, (l) => {
    const name = patch.name !== undefined && patch.name.trim() ? patch.name.trim().slice(0, 200) : l.name;
    const visible = patch.visible ?? l.visible;
    const opacity = patch.opacity !== undefined && Number.isFinite(patch.opacity) ? Math.max(0, Math.min(1, patch.opacity)) : l.opacity;
    return name === l.name && visible === l.visible && opacity === l.opacity ? l : { ...l, name, visible, opacity };
  });
}

/**
 * Blending Options on layers (one, or several selected: Photoshop's Layers panel sets them all): mode, Opacity, Fill,
 * channels, Blend If. Only what `patch` names changes.
 */
export function setLayerBlending(doc: PhotoProject, ids: readonly string[], patch: BlendingPatch): PhotoProject {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!set.has(l.id)) return l;
    const next = patchBlending(l, patch);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

/** How the document's layers mix: Photoshop's encoded values, or linear light. */
export function setCompositing(doc: PhotoProject, compositing: Compositing): PhotoProject {
  return (doc.compositing ?? "linear") === compositing ? doc : { ...doc, compositing };
}

export function removeLayer(doc: PhotoProject, id: string): PhotoProject {
  return findLayer(doc, id) ? { ...doc, layers: doc.layers.filter((l) => l.id !== id) } : doc;
}

/** Moves a layer to `index` (0 is the bottom), clamped to the stack. */
export function moveLayer(doc: PhotoProject, id: string, index: number): PhotoProject {
  const from = doc.layers.findIndex((l) => l.id === id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.layers.length - 1, Math.round(index)));
  if (to === from) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  layers.splice(to, 0, layer);
  return { ...doc, layers };
}

/** Deletes every layer of `ids` (Photoshop's Delete with several layers selected). */
export function removeLayers(doc: PhotoProject, ids: readonly string[]): PhotoProject {
  const gone = new Set(ids);
  const layers = doc.layers.filter((l) => !gone.has(l.id));
  return layers.length === doc.layers.length ? doc : { ...doc, layers };
}

/**
 * Moves the layers of `ids` together, in their order, so that `below` other layers of the stack are under them
 * (`below` counts every layer, theirs included, as a gap in the Layers panel does: 0 is the bottom). A drag of
 * several rows drops them as one block.
 */
export function moveLayersTo(doc: PhotoProject, ids: readonly string[], below: number): PhotoProject {
  const moving = new Set(ids);
  const block = doc.layers.filter((l) => moving.has(l.id));
  if (block.length === 0) return doc;
  const cut = Math.max(0, Math.min(doc.layers.length, Math.round(below)));
  const under = doc.layers.slice(0, cut).filter((l) => !moving.has(l.id));
  const over = doc.layers.slice(cut).filter((l) => !moving.has(l.id));
  const layers = [...under, ...block, ...over];
  return layers.every((l, i) => l === doc.layers[i]) ? doc : { ...doc, layers };
}

/**
 * Each layer of `ids` one place up (`1`, Photoshop's Bring Forward, ⌘]) or down (`-1`, Send Backward, ⌘[), past
 * the next layer that isn't moving; a run of them moves as one, and one already at the end stays.
 */
export function shiftLayers(doc: PhotoProject, ids: readonly string[], direction: 1 | -1): PhotoProject {
  const moving = new Set(ids);
  const layers = [...doc.layers];
  let changed = false;
  const n = layers.length;
  for (let k = 0; k < n - 1; k++) {
    // Up: from the top down, so a run carries the layer above it down past itself; down, the other way.
    const i = direction === 1 ? n - 2 - k : k + 1;
    const j = i + direction;
    if (moving.has(layers[i].id) && !moving.has(layers[j].id)) {
      [layers[i], layers[j]] = [layers[j], layers[i]];
      changed = true;
    }
  }
  return changed ? { ...doc, layers } : doc;
}

/** The layers of `ids` to the top of the stack (Bring to Front) or the bottom (Send to Back), in their order. */
export function arrangeLayers(doc: PhotoProject, ids: readonly string[], to: "top" | "bottom"): PhotoProject {
  return moveLayersTo(doc, ids, to === "top" ? doc.layers.length : 0);
}

/**
 * A copy of a layer right above it, named "… copy" (an adjustment's or a generator's effect gets an id of its own,
 * `${newId}_fx`, and its filters `${newId}_f1`…).
 */
export function duplicateLayer(doc: PhotoProject, id: string, newId: string): PhotoProject {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0 || findLayer(doc, newId)) return doc;
  const layers = [...doc.layers];
  const from = doc.layers[index];
  let copy: PhotoLayer =
    from.kind === "adjustment" || from.kind === "generator"
      ? { ...from, id: newId, name: `${from.name} copy`, effect: { ...structuredClone(from.effect), id: `${newId}_fx` } }
      : { ...from, id: newId, name: `${from.name} copy` };
  if (hasContent(copy) && copy.filters) copy = { ...copy, filters: copy.filters.map((f, i) => ({ ...structuredClone(f), id: `${newId}_f${i + 1}` })) };
  // Its layer effects are copies, with ids of their own.
  if (from.style) copy = { ...copy, style: { ...from.style, effects: from.style.effects.map((e, i) => ({ ...structuredClone(e), id: `${newId}_fx${i + 1}` })) } };
  layers.splice(index + 1, 0, copy);
  return { ...doc, layers };
}

/** Copies of the layers of `ids`, each right above its original; `newIdOf` names each copy. */
export function duplicateLayers(doc: PhotoProject, ids: readonly string[], newIdOf: (id: string) => string): PhotoProject {
  return ids.reduce((d, id) => duplicateLayer(d, id, newIdOf(id)), doc);
}

/**
 * Moves placed layers by (dx, dy) document pixels together (the Move tool with several layers selected). A
 * generator moves its handles (a flare's source, and its optical centre once it has one of its own).
 */
export function moveLayersBy(doc: PhotoProject, ids: readonly string[], dx: number, dy: number): PhotoProject {
  const moving = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!moving.has(l.id) || (!dx && !dy)) return l;
    if (l.kind === "generator") {
      const moved = movedHandles(l, dx, dy);
      if (moved !== l) changed = true;
      return moved;
    }
    if (!isPlaced(l)) return l;
    changed = true;
    return { ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } };
  });
  return changed ? { ...doc, layers } : doc;
}

/** A generator with every handle that has a place moved by (dx, dy). */
function movedHandles(l: GeneratorLayer, dx: number, dy: number): GeneratorLayer {
  const def = effectDefinition(l.effect.type);
  if (!def || unavailableReason(l.effect, "generator")) return l;
  let params = l.effect.params;
  for (const spec of def.params) {
    const v = params[spec.key];
    if (spec.kind !== "point" || !spec.handle || !Array.isArray(v)) continue;
    const [x, y] = v as DocPoint;
    if (params === l.effect.params) params = { ...params };
    params[spec.key] = [x + dx, y + dy] as DocPoint;
  }
  return params === l.effect.params ? l : { ...l, effect: { ...l.effect, params } };
}

/** Where a generator's handle is: its point, or the canvas's centre for one that follows it (null). */
export function handlePoint(doc: PhotoProject, layer: GeneratorLayer, key: string): DocPoint | null {
  const v = layer.effect.params[key];
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") return v as DocPoint;
  return v === null ? [doc.canvas.width / 2, doc.canvas.height / 2] : null;
}

/** Puts a generator's handle (a point parameter) at a document point, or back on the canvas's centre (null, if it can be). */
export function setHandle(doc: PhotoProject, layerId: string, key: string, value: DocPoint | null): PhotoProject {
  const layer = findLayer(doc, layerId);
  if (layer?.kind !== "generator") return doc;
  const spec = effectDefinition(layer.effect.type)?.params.find((p) => p.key === key);
  if (spec?.kind !== "point" || (value === null && !spec.nullable)) return doc;
  return setEffectParams(doc, layerId, { [key]: value });
}

// --- filters (Photoshop's Smart Filters) ---

/** A layer's filters, first applied first (none: an empty list). */
export const filtersOf = (layer: PhotoLayer): EffectInstance[] => (hasContent(layer) ? (layer.filters ?? []) : []);

function mapFilters(doc: PhotoProject, layerId: string, update: (filters: EffectInstance[], layer: ContentLayer) => EffectInstance[]): PhotoProject {
  return mapLayer(doc, layerId, (l) => {
    if (!hasContent(l)) return l;
    const before = l.filters ?? [];
    const after = update(before, l);
    if (after === before) return l;
    if (after.length) return { ...l, filters: after };
    const { filters: _, filtersEnabled: __, ...rest } = l;
    return rest as ContentLayer;
  });
}

export interface NewFilter {
  id: string;
  /** A definition of kind "filter" ("glow"). */
  type: string;
  /** Parameters other than the defaults (checked by the definition). */
  params?: Record<string, unknown>;
}

/** A filter on a layer with content, applied after its others (the top of its list). A wrong type changes nothing. */
export function addFilter(doc: PhotoProject, layerId: string, filter: NewFilter): PhotoProject {
  const def = effectDefinition(filter.type);
  if (def?.kind !== "filter" || doc.layers.some((l) => filtersOf(l).some((f) => f.id === filter.id))) return doc;
  let effect = newEffect(def, filter.id);
  if (filter.params) effect = { ...effect, params: patchParams(def, effect.params, filter.params) };
  return mapFilters(doc, layerId, (filters) => [...filters, effect]);
}

export function removeFilter(doc: PhotoProject, layerId: string, filterId: string): PhotoProject {
  return mapFilters(doc, layerId, (filters) => (filters.some((f) => f.id === filterId) ? filters.filter((f) => f.id !== filterId) : filters));
}

/** Moves a filter to `index` in its layer's list (0 applies first), clamped. */
export function moveFilter(doc: PhotoProject, layerId: string, filterId: string, index: number): PhotoProject {
  return mapFilters(doc, layerId, (filters) => {
    const from = filters.findIndex((f) => f.id === filterId);
    const to = Math.max(0, Math.min(filters.length - 1, Math.round(index)));
    if (from < 0 || from === to) return filters;
    const next = [...filters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}

/** Turns a filter on or off (its settings kept) and sets some of its parameters (each checked by its spec). */
export function setFilter(doc: PhotoProject, layerId: string, filterId: string, patch: { enabled?: boolean; params?: Record<string, unknown> }): PhotoProject {
  return mapFilters(doc, layerId, (filters) => {
    const i = filters.findIndex((f) => f.id === filterId);
    if (i < 0) return filters;
    const f = filters[i];
    const def = effectDefinition(f.type);
    const params = patch.params && def && !unavailableReason(f, "filter") ? patchParams(def, f.params, patch.params) : f.params;
    const enabled = patch.enabled ?? f.enabled;
    if (params === f.params && enabled === f.enabled) return filters;
    const next = [...filters];
    next[i] = { ...f, enabled, params };
    return next;
  });
}

/** The "Filters" row's eye: every filter of a layer off or on together, each keeping its own setting. */
export function setFiltersEnabled(doc: PhotoProject, layerId: string, enabled: boolean): PhotoProject {
  return mapLayer(doc, layerId, (l) => {
    if (!hasContent(l) || (l.filtersEnabled !== false) === enabled) return l;
    if (enabled) {
      const { filtersEnabled: _, ...rest } = l;
      return rest as ContentLayer;
    }
    return { ...l, filtersEnabled: false };
  });
}

/** The filters that act on a layer now: its own that are on and usable, none while its "Filters" eye is off. */
export const activeFilters = (layer: PhotoLayer): EffectInstance[] =>
  !hasContent(layer) || layer.filtersEnabled === false ? [] : filtersOf(layer).filter((f) => f.enabled && !unavailableReason(f, "filter"));

// --- generators ---

export interface NewGeneratorLayer {
  id: string;
  /** A definition of kind "generator" ("lens-flare"). */
  type: string;
  name?: string;
  /** A flare's preset ("classic"…), its sizes made for this canvas. */
  preset?: string;
  /** Parameters other than the defaults and the preset's (checked by the definition). */
  params?: Record<string, unknown>;
}

/**
 * A new generator layer right above `above` (an id), or at the top; its effect's id is `${id}_fx`. A new flare's
 * source starts at the canvas's upper left third (where the video editor's sample sun is), its elements are the
 * preset's for this canvas, and it adds its light in linear light (Linear Dodge, `blendSpace: "linear"`). A wrong
 * type changes nothing.
 */
export function addGeneratorLayer(doc: PhotoProject, layer: NewGeneratorLayer, above?: string | null): PhotoProject {
  const def = effectDefinition(layer.type);
  if (def?.kind !== "generator" || findLayer(doc, layer.id)) return doc;
  let effect = newEffect(def, `${layer.id}_fx`);
  const { width, height } = doc.canvas;
  const start: Record<string, unknown> = def.type === "lens-flare" ? { source: [Math.round(width * 0.3), Math.round(height * 0.34)], elements: flarePreset(layer.preset ?? "classic", width, height) } : {};
  effect = { ...effect, params: patchParams(def, effect.params, { ...start, ...layer.params }) };
  const added: GeneratorLayer = { id: layer.id, kind: "generator", name: layer.name?.trim() || def.label, visible: true, opacity: 1, effect, blend: "linear-dodge", blendSpace: "linear" };
  const layers = [...doc.layers];
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, added);
  return { ...doc, layers };
}

// --- elements (a flare's): an `elements` parameter of a generator's own effect ---

/** A generator's elements under `key`, or null when it has none there (or can't be changed). */
function elementsOf(doc: PhotoProject, layerId: string, key: string): { layer: GeneratorLayer; spec: ElementsParam; list: EffectElement[] } | null {
  const layer = findLayer(doc, layerId);
  if (layer?.kind !== "generator" || unavailableReason(layer.effect, "generator")) return null;
  const spec = effectDefinition(layer.effect.type)?.params.find((p) => p.key === key);
  const list = layer.effect.params[key];
  return spec?.kind === "elements" && Array.isArray(list) ? { layer, spec, list: list as EffectElement[] } : null;
}

/** The list replaced, checked by its spec (ids kept), as one edit. */
const withElements = (doc: PhotoProject, layerId: string, key: string, list: EffectElement[]) => setEffectParams(doc, layerId, { [key]: list });

/** A new element of `type` (at its defaults, `values` over them) on top of the list. */
export function addElement(doc: PhotoProject, layerId: string, key: string, type: string, id: string, values: Record<string, unknown> = {}): PhotoProject {
  const found = elementsOf(doc, layerId, key);
  const t = found?.spec.types.find((x) => x.type === type);
  if (!found || !t || found.list.some((e) => e.id === id) || found.list.length >= found.spec.max) return doc;
  return withElements(doc, layerId, key, [...found.list, { ...newElement(t, id), ...values, id, type } as EffectElement]);
}

/** Some of an element's own parameters (and whether it's shown), each checked by its type's spec. */
export function setElement(doc: PhotoProject, layerId: string, key: string, elementId: string, patch: Record<string, unknown>): PhotoProject {
  const found = elementsOf(doc, layerId, key);
  const i = found ? found.list.findIndex((e) => e.id === elementId) : -1;
  if (!found || i < 0) return doc;
  const list = [...found.list];
  const { id: _, type: __, ...rest } = patch;
  list[i] = { ...list[i], ...rest } as EffectElement;
  return withElements(doc, layerId, key, list);
}

export function removeElement(doc: PhotoProject, layerId: string, key: string, elementId: string): PhotoProject {
  const found = elementsOf(doc, layerId, key);
  if (!found || !found.list.some((e) => e.id === elementId)) return doc;
  return withElements(doc, layerId, key, found.list.filter((e) => e.id !== elementId));
}

/** Moves an element to `index` (0 is the first drawn), clamped. */
export function moveElement(doc: PhotoProject, layerId: string, key: string, elementId: string, index: number): PhotoProject {
  const found = elementsOf(doc, layerId, key);
  const from = found ? found.list.findIndex((e) => e.id === elementId) : -1;
  if (!found || from < 0) return doc;
  const to = Math.max(0, Math.min(found.list.length - 1, Math.round(index)));
  if (to === from) return doc;
  const list = [...found.list];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return withElements(doc, layerId, key, list);
}

/** A generator's blend: how its content mixes with what's below (Normal, or Linear Dodge's Add). */
export function setGeneratorBlend(doc: PhotoProject, layerId: string, blend: BlendMode, space?: "linear" | "document"): PhotoProject {
  return mapLayer(doc, layerId, (l) => {
    if (l.kind !== "generator") return l;
    const linear = space === undefined ? l.blendSpace === "linear" : space === "linear";
    if ((l.blend ?? "normal") === blend && (l.blendSpace === "linear") === linear) return l;
    const { blend: _, blendSpace: __, ...rest } = l;
    return { ...rest, ...(blend !== "normal" ? { blend } : {}), ...(linear ? { blendSpace: "linear" as const } : {}) };
  });
}

export interface NewAdjustmentLayer {
  id: string;
  /** A definition's type ("exposure", "curves"). */
  type: string;
  name?: string;
  /** Parameters other than the defaults (checked by the definition). */
  params?: Record<string, unknown>;
}

/**
 * A new adjustment layer right above `above` (an id: Photoshop adds one over the selected layer), or at the top.
 * Its effect's id is `${id}_fx`. An unknown type changes nothing.
 */
export function addAdjustmentLayer(doc: PhotoProject, layer: NewAdjustmentLayer, above?: string | null): PhotoProject {
  const def = effectDefinition(layer.type);
  if (def?.kind !== "adjustment" || findLayer(doc, layer.id)) return doc;
  let effect = newEffect(def, `${layer.id}_fx`);
  if (layer.params) effect = { ...effect, params: patchParams(def, effect.params, layer.params) };
  const added: AdjustmentLayer = { id: layer.id, kind: "adjustment", name: layer.name?.trim() || def.label, visible: true, opacity: 1, effect };
  const layers = [...doc.layers];
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, added);
  return { ...doc, layers };
}

/** Parameters with `patch` applied, each value checked by its spec; unknown keys are ignored. */
function patchParams(def: EffectDefinition, params: Record<string, EffectParamValue>, patch: Record<string, unknown>): Record<string, EffectParamValue> {
  let next = params;
  for (const spec of def.params) {
    if (!(spec.key in patch)) continue;
    const { value } = sanitizeParam(spec, patch[spec.key]);
    if (sameValue(value, next[spec.key])) continue;
    if (next === params) next = { ...params };
    next[spec.key] = value;
  }
  return next;
}

/**
 * Sets some of an adjustment's or a generator layer's own parameters (each checked: held to its range, a bad one
 * ignored). An effect this app can't use is never changed.
 */
export function setEffectParams(doc: PhotoProject, layerId: string, patch: Record<string, unknown>): PhotoProject {
  return mapLayer(doc, layerId, (l) => {
    if ((l.kind !== "adjustment" && l.kind !== "generator") || unavailableReason(l.effect, l.kind)) return l;
    const def = effectDefinition(l.effect.type)!;
    const valid = Object.fromEntries(Object.entries(patch).filter(([key, value]) => {
      const spec = def.params.find((s) => s.key === key);
      return spec && (spec.kind !== "number" || (typeof value === "number" && Number.isFinite(value)));
    }));
    const params = patchParams(def, l.effect.params, valid);
    return params === l.effect.params ? l : { ...l, effect: { ...l.effect, params } };
  });
}

/** Puts an adjustment back to its defaults. */
export function resetEffect(doc: PhotoProject, layerId: string): PhotoProject {
  const layer = findLayer(doc, layerId);
  if (layer?.kind !== "adjustment") return doc;
  const def = effectDefinition(layer.effect.type);
  if (!def || unavailableReason(layer.effect)) return doc;
  return setEffectParams(doc, layerId, newEffect(def, layer.effect.id).params);
}

/**
 * Changes the canvas's size or background. Layers keep their place relative to the top-left corner (Photoshop's
 * Canvas Size anchored top-left; centring is the caller's choice of `anchor`).
 */
export function setCanvas(doc: PhotoProject, patch: Partial<PhotoCanvas>, anchor: "top-left" | "centre" = "top-left"): PhotoProject {
  const width = patch.width !== undefined && Number.isInteger(patch.width) && patch.width >= 1 && patch.width <= MAX_CANVAS_SIDE ? patch.width : doc.canvas.width;
  const height = patch.height !== undefined && Number.isInteger(patch.height) && patch.height >= 1 && patch.height <= MAX_CANVAS_SIDE ? patch.height : doc.canvas.height;
  const background = patch.background === undefined ? doc.canvas.background : patch.background === null || isColour(patch.background) ? (patch.background?.toLowerCase() ?? null) : doc.canvas.background;
  if (width === doc.canvas.width && height === doc.canvas.height && background === doc.canvas.background) return doc;
  const dx = anchor === "centre" ? (width - doc.canvas.width) / 2 : 0;
  const dy = anchor === "centre" ? (height - doc.canvas.height) / 2 : 0;
  const layers = dx || dy ? doc.layers.map((l) => (isPlaced(l) ? { ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } } : l)) : doc.layers;
  return { ...doc, canvas: { width, height, background }, layers };
}

/** How light above white leaves the photo (rendering.md, "The output transform"). */
export function setHighlights(doc: PhotoProject, highlights: PhotoProject["output"]["highlights"]): PhotoProject {
  return doc.output.highlights === highlights ? doc : { ...doc, output: { ...doc.output, highlights } };
}

export interface NewPixelLayer {
  id: string;
  name?: string;
  /** Its pixels (a paste's, a Layer via Copy's); a new layer has none. */
  surface?: SurfaceId | null;
  size?: { width: number; height: number };
  transform?: LayerTransform;
}

/**
 * A new pixel layer right above `above` (an id), or on top: empty, the canvas's size at 100% over it (Photoshop's
 * New Layer, ⇧⌘N), or with pixels of its own where they're given (a paste).
 */
export function addPixelLayer(doc: PhotoProject, layer: NewPixelLayer, above?: string | null): PhotoProject {
  if (findLayer(doc, layer.id)) return doc;
  const { width, height } = layer.size ?? doc.canvas;
  const added: PixelLayer = {
    id: layer.id,
    kind: "pixel",
    name: layer.name?.trim() || nextLayerName(doc),
    visible: true,
    opacity: 1,
    surface: layer.surface ?? null,
    size: { width, height },
    transform: layer.transform ?? { x: width / 2, y: height / 2, scaleX: 1, scaleY: 1, rotation: 0 },
  };
  const layers = [...doc.layers];
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, added);
  return { ...doc, layers };
}

/** "Layer 1", "Layer 2"…: the first number no layer is called yet (Photoshop's names for new layers). */
export function nextLayerName(doc: PhotoProject): string {
  const taken = new Set(doc.layers.map((l) => l.name));
  for (let n = 1; ; n++) if (!taken.has(`Layer ${n}`)) return `Layer ${n}`;
}

/** A pixel layer's painted pixels (a stroke's result: one undo step). */
export function setSurface(doc: PhotoProject, id: string, surface: SurfaceId | null): PhotoProject {
  return mapLayer(doc, id, (l) => (l.kind !== "pixel" || l.surface === surface ? l : { ...l, surface }));
}

/**
 * A layer's mask: its coverage surface (null reveals everything), added when the layer has none. A mask painted
 * or made from a selection is one undo step.
 */
export function setMask(doc: PhotoProject, id: string, surface: SurfaceId | null): PhotoProject {
  return mapLayer(doc, id, (l) => (l.mask && l.mask.surface === surface ? l : { ...l, mask: { surface } }));
}

/** Deletes a layer's mask (the layer shows whole again). */
export function removeMask(doc: PhotoProject, id: string): PhotoProject {
  return mapLayer(doc, id, (l) => {
    if (!l.mask) return l;
    const { mask: _, ...rest } = l;
    return rest as PhotoLayer;
  });
}

/**
 * An image layer replaced by a pixel layer of what it showed (Photoshop's Rasterize / Convert to pixels): `layer`
 * is the render, made by the tab (its transform and mask baked into its pixels), in the image's place.
 */
export function replaceLayer(doc: PhotoProject, id: string, layer: PhotoLayer): PhotoProject {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0 || (layer.id !== id && findLayer(doc, layer.id))) return doc;
  const layers = [...doc.layers];
  layers[index] = layer;
  return { ...doc, layers };
}
