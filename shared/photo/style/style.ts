/**
 * A layer's style (docs/photo/layer-style/README.md, phase L2): checking one, and the pure edits the Layer Style
 * window, the Layers panel and the assistant make. Effects are kept in drawing order (bottom first; instances of one
 * type in their own order), at most `max` of a type; one of a type this app doesn't know is kept as it was and
 * draws nothing.
 */
import { defaultParams, sanitizeParam, specShows } from "../effects/params.ts";
import type { EffectInstance, EffectParamValue, GlobalLight, LayerStyle, PhotoLayer, PhotoPattern, PhotoProject } from "../types.ts";
import { type StyleDefinition, type StyleType, drawOrder, styleDefinition } from "./definitions.ts";

export const DEFAULT_GLOBAL_LIGHT: GlobalLight = { angle: 120, altitude: 30 };
export const globalLightOf = (doc: PhotoProject): GlobalLight => doc.globalLight ?? DEFAULT_GLOBAL_LIGHT;

/** Effects in drawing order: by type's place, then their own order (stable). */
export const ordered = (effects: readonly EffectInstance[]) => [...effects].map((e, i) => ({ e, i })).sort((a, b) => drawOrder(a.e.type) - drawOrder(b.e.type) || a.i - b.i).map(({ e }) => e);

/** An effect's parameters checked by its definition: unknown keys dropped, bad ones at their defaults. */
export function styleParams(def: StyleDefinition, raw: unknown): { params: Record<string, EffectParamValue>; problems: string[] } {
  const given = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const params: Record<string, EffectParamValue> = {};
  const problems: string[] = [];
  for (const spec of def.params) {
    const s = sanitizeParam(spec, given[spec.key]);
    params[spec.key] = s.value;
    if (s.repaired && given[spec.key] !== undefined) problems.push(`${def.label} ${spec.label}: ${JSON.stringify(given[spec.key])} was repaired.`);
  }
  return { params, problems };
}

/** A style checked: effects in drawing order, at most `max` of a type, ids unique; none at all is no style. */
export function normalizeStyle(value: unknown, seen: Set<string>, newId: () => string, report: (problem: string) => void): LayerStyle | undefined {
  if (!value || typeof value !== "object" || !Array.isArray((value as LayerStyle).effects)) return undefined;
  const v = value as { enabled?: unknown; effects: unknown[] };
  const count = new Map<string, number>();
  const effects: EffectInstance[] = [];
  for (const raw of v.effects) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.type !== "string" || !e.type) continue;
    let id = typeof e.id === "string" && /^[\w-]{1,64}$/.test(e.id) ? e.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const def = styleDefinition(e.type);
    const version = Number.isInteger(e.version) && (e.version as number) >= 1 ? (e.version as number) : 1;
    const enabled = e.enabled !== false;
    if (!def || version > def.version) {
      report(`Layer effect ${id}: ${def ? `version ${version} is newer than this app's` : `unknown type "${e.type}"`}; kept as it was.`);
      effects.push({ id, type: e.type, version, enabled, params: (e.params && typeof e.params === "object" ? structuredClone(e.params) : {}) as Record<string, EffectParamValue> });
      continue;
    }
    const n = (count.get(def.type) ?? 0) + 1;
    count.set(def.type, n);
    if (n > def.max) {
      report(`Layer effect ${id}: more than ${def.max} ${def.label}; left out.`);
      continue;
    }
    const { params, problems } = styleParams(def, e.params);
    for (const p of problems) report(`Layer effect ${id}: ${p}`);
    effects.push({ id, type: def.type, version, enabled, params });
  }
  if (!effects.length) return undefined;
  return { enabled: v.enabled !== false, effects: ordered(effects) };
}

/** A new effect of `type` at its defaults (or `params` over them), or null when the type isn't one. */
export function newStyleEffect(type: string, id: string, params: Record<string, unknown> = {}): EffectInstance | null {
  const def = styleDefinition(type);
  if (!def) return null;
  return { id, type: def.type, version: def.version, enabled: true, params: styleParams(def, { ...defaultParams(def.params), ...params }).params };
}

function mapLayers(doc: PhotoProject, ids: readonly string[], update: (layer: PhotoLayer) => PhotoLayer): PhotoProject {
  const set = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (!set.has(l.id)) return l;
    const next = update(l);
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

/** The layer with this style (none: the field goes). */
function withStyle(layer: PhotoLayer, style: LayerStyle | undefined): PhotoLayer {
  if (!style || !style.effects.length) {
    if (!layer.style) return layer;
    const next = { ...layer };
    delete next.style;
    return next;
  }
  return { ...layer, style };
}

/** Adds an effect to a layer, in its place in the drawing order (refused past its type's `max`: the same document). */
export function addStyleEffect(doc: PhotoProject, layerId: string, effect: EffectInstance): PhotoProject {
  const def = styleDefinition(effect.type);
  if (!def) return doc;
  return mapLayers(doc, [layerId], (l) => {
    const effects = l.style?.effects ?? [];
    if (effects.some((e) => e.id === effect.id) || effects.filter((e) => e.type === def.type).length >= def.max) return l;
    return withStyle(l, { enabled: l.style?.enabled ?? true, effects: ordered([...effects, effect]) });
  });
}

/** Changes an effect: shown or not, and parameters (checked; the rest keep their value). */
export function setStyleEffect(doc: PhotoProject, layerId: string, effectId: string, patch: { enabled?: boolean; params?: Record<string, unknown> }): PhotoProject {
  return mapLayers(doc, [layerId], (l) => {
    const effects = l.style?.effects;
    const at = effects?.findIndex((e) => e.id === effectId) ?? -1;
    if (!effects || at < 0) return l;
    const e = effects[at];
    const def = styleDefinition(e.type);
    const enabled = patch.enabled ?? e.enabled;
    const params = def && patch.params ? styleParams(def, { ...e.params, ...patch.params }).params : e.params;
    if (enabled === e.enabled && JSON.stringify(params) === JSON.stringify(e.params)) return l;
    const next = [...effects];
    next[at] = { ...e, enabled, params };
    return withStyle(l, { ...l.style!, effects: next });
  });
}

export function removeStyleEffect(doc: PhotoProject, layerId: string, effectId: string): PhotoProject {
  return mapLayers(doc, [layerId], (l) => {
    const effects = l.style?.effects;
    if (!effects?.some((e) => e.id === effectId)) return l;
    return withStyle(l, { ...l.style!, effects: effects.filter((e) => e.id !== effectId) });
  });
}

/** An instance one place up (towards the top of the drawing) or down among the effects of its own type (Photoshop's arrows). */
export function moveStyleEffect(doc: PhotoProject, layerId: string, effectId: string, direction: 1 | -1): PhotoProject {
  return mapLayers(doc, [layerId], (l) => {
    const effects = l.style?.effects;
    const at = effects?.findIndex((e) => e.id === effectId) ?? -1;
    if (!effects || at < 0) return l;
    const to = at + direction;
    if (to < 0 || to >= effects.length || effects[to].type !== effects[at].type) return l;
    const next = [...effects];
    [next[at], next[to]] = [next[to], next[at]];
    return withStyle(l, { ...l.style!, effects: next });
  });
}

/** The layers' effects shown or hidden all at once (the Layers panel's "Effects" eye, Hide All Effects). */
export function setStyleEnabled(doc: PhotoProject, ids: readonly string[], enabled: boolean): PhotoProject {
  return mapLayers(doc, ids, (l) => (!l.style || l.style.enabled === enabled ? l : { ...l, style: { ...l.style, enabled } }));
}

/**
 * The layers' styles replaced (Paste Layer Style: every effect a copy with an id of its own from `newId`), or cleared
 * (null: Clear Layer Style).
 */
export function setLayerStyle(doc: PhotoProject, ids: readonly string[], style: LayerStyle | null, newId: () => string): PhotoProject {
  return mapLayers(doc, ids, (l) => withStyle(l, style ? { enabled: style.enabled, effects: style.effects.map((e) => ({ ...structuredClone(e), id: newId() })) } : undefined));
}

/** A layer's style as given (its effects keeping their ids, put in drawing order), or none. The same document when it's the same. */
export function replaceStyle(doc: PhotoProject, layerId: string, style: LayerStyle | undefined): PhotoProject {
  return mapLayers(doc, [layerId], (l) => {
    const next = style && style.effects.length ? { enabled: style.enabled, effects: ordered(style.effects) } : undefined;
    return JSON.stringify(next ?? null) === JSON.stringify(l.style ?? null) ? l : withStyle(l, next);
  });
}

/** The document's Global Light (every effect with Use Global Light follows it). */
export function setGlobalLight(doc: PhotoProject, patch: Partial<GlobalLight>): PhotoProject {
  const now = globalLightOf(doc);
  const wrap = (a: number) => {
    const r = ((((a + 180) % 360) + 360) % 360) - 180;
    return r === -180 ? 180 : r;
  };
  const next = { angle: patch.angle !== undefined && Number.isFinite(patch.angle) ? wrap(patch.angle) : now.angle, altitude: patch.altitude !== undefined && Number.isFinite(patch.altitude) ? Math.max(0, Math.min(90, patch.altitude)) : now.altitude };
  return next.angle === now.angle && next.altitude === now.altitude ? doc : { ...doc, globalLight: next };
}

/**
 * Scale Effects (Layer › Layer Style › Scale Effects): every size, distance and pattern scale of the layers' effects
 * multiplied by `factor` (each definition's `scaled`), held to its range; angles, opacities and the like stay. The
 * same document when nothing changes.
 */
export function scaleStyle(doc: PhotoProject, ids: readonly string[], factor: number): PhotoProject {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return doc;
  return mapLayers(doc, ids, (l) => {
    if (!l.style) return l;
    let changed = false;
    const effects = l.style.effects.map((e) => {
      const def = styleDefinition(e.type);
      if (!def || !def.scaled.length) return e;
      const patch = Object.fromEntries(def.scaled.filter((k) => typeof e.params[k] === "number").map((k) => [k, Math.round((e.params[k] as number) * factor)]));
      const params = styleParams(def, { ...e.params, ...patch }).params;
      if (JSON.stringify(params) === JSON.stringify(e.params)) return e;
      changed = true;
      return { ...e, params };
    });
    return changed ? { ...l, style: { ...l.style, effects } } : l;
  });
}

/** Every pattern id the layers' styles read (effects that are off too: they're kept with the style; a stroke's only with its Pattern fill, Texture's only when it's on). */
export function stylePatterns(layers: readonly PhotoLayer[]): string[] {
  const ids = new Set<string>();
  for (const l of layers)
    for (const e of l.style?.effects ?? []) for (const k of styleDefinition(e.type)?.patterns ?? []) if (specShows(k, e.params) && typeof e.params[k.pattern] === "string") ids.add(e.params[k.pattern] as string);
  return [...ids];
}

/**
 * Adds a pattern to the document (Define Pattern, a style that brings one). One with the same pixels is already
 * there: its id is returned and the document stays the same (patterns are content-addressed).
 */
export function addPattern(doc: PhotoProject, pattern: PhotoPattern): { doc: PhotoProject; id: string } {
  const same = doc.patterns?.find((p) => p.surface === pattern.surface && p.size.width === pattern.size.width && p.size.height === pattern.size.height);
  if (same) return { doc, id: same.id };
  return { doc: { ...doc, patterns: [...(doc.patterns ?? []), pattern] }, id: pattern.id };
}

export function renamePattern(doc: PhotoProject, id: string, name: string): PhotoProject {
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed || !doc.patterns?.some((p) => p.id === id && p.name !== trimmed)) return doc;
  return { ...doc, patterns: doc.patterns.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) };
}

/**
 * Patterns brought into the document (a style pasted from another photo, a style preset): each added unless the
 * same pixels are there already; an id another pattern has gets a new one (`newId`). Returns how ids map.
 */
export function withPatterns(doc: PhotoProject, patterns: readonly PhotoPattern[], newId: () => string): { doc: PhotoProject; ids: Map<string, string> } {
  const ids = new Map<string, string>();
  let next = doc;
  for (const p of patterns) {
    const taken = next.patterns?.some((q) => q.id === p.id && q.surface !== p.surface);
    const added = addPattern(next, taken ? { ...p, id: newId() } : p);
    next = added.doc;
    ids.set(p.id, added.id);
  }
  return { doc: next, ids };
}

/** A style with its pattern ids mapped (`withPatterns`'s), the others as they were. */
export function remapStylePatterns(style: LayerStyle, ids: ReadonlyMap<string, string>): LayerStyle {
  return {
    ...style,
    effects: style.effects.map((e) => {
      const keys = styleDefinition(e.type)?.patterns ?? [];
      const patch = Object.fromEntries(keys.filter((k) => ids.has(e.params[k.pattern] as string)).map((k) => [k.pattern, ids.get(e.params[k.pattern] as string)!]));
      return Object.keys(patch).length ? { ...e, params: { ...e.params, ...patch } } : e;
    }),
  };
}

/** Deletes a pattern no effect names (one in use stays: the same document). */
export function removePattern(doc: PhotoProject, id: string): PhotoProject {
  if (!doc.patterns?.some((p) => p.id === id) || stylePatterns(doc.layers).includes(id)) return doc;
  const patterns = doc.patterns.filter((p) => p.id !== id);
  const { patterns: _, ...rest } = doc;
  return patterns.length ? { ...rest, patterns } : rest;
}

/** The effects that draw: the style on, the effect on, its type known. */
export const drawnEffects = (layer: PhotoLayer): EffectInstance[] => (layer.style?.enabled ? layer.style.effects.filter((e) => e.enabled && styleDefinition(e.type) && e.version <= styleDefinition(e.type)!.version) : []);

/** An effect's angle: the document's with Use Global Light, else its own. */
export const effectAngle = (doc: PhotoProject, e: EffectInstance) => (e.params.globalLight === true ? globalLightOf(doc).angle : (e.params.angle as number));

/** A bevel's light altitude: the document's with Use Global Light, else its own. */
export const effectAltitude = (doc: PhotoProject, e: EffectInstance) => (e.params.globalLight === true ? globalLightOf(doc).altitude : ((e.params.altitude as number | undefined) ?? DEFAULT_GLOBAL_LIGHT.altitude));

/** How far a layer's drawn effects reach past its pixels, in document pixels. */
export const styleReach = (layer: PhotoLayer) => Math.max(0, ...drawnEffects(layer).map((e) => styleDefinition(e.type)!.reach(e.params)));

/** A style in words, top of the drawing first, for people and the assistant. */
export function describeStyle(layer: PhotoLayer): string | null {
  if (!layer.style) return null;
  const parts = [...layer.style.effects].reverse().map((e) => {
    const def = styleDefinition(e.type);
    if (!def) return `${e.id} ${e.type} (unavailable)`;
    return `${e.id} ${def.label}${e.enabled ? "" : " (off)"}: ${def.summary(e.params)}`;
  });
  return `${layer.style.enabled ? "" : "all hidden: "}${parts.join("; ")}`;
}

export type { StyleType };
