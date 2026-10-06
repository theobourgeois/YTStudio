/**
 * Styles (Photoshop's Styles panel, docs/photo/layer-style/dialog.md, "Styles presets"): a style kept to apply to
 * other layers. A preset is effects (their types and parameters; ids are made when it's applied), and its Blending
 * Options when it was saved with them. Clicking one replaces a layer's style; ⇧ adds its effects to the layer's.
 * The built-in set is here; the user's own are this computer's (New Style…), each carrying the photo's patterns it
 * reads as pixels, so it brings them to any photo.
 */
import { createId } from "../../ids.ts";
import { patchBlending } from "../blending.ts";
import { CONTOUR_PRESETS } from "./contours.ts";
import { GRADIENT_PRESETS } from "./gradients.ts";
import { styleDefinition } from "./definitions.ts";
import { specShows } from "../effects/params.ts";
import { addStyleEffect, newStyleEffect, setLayerStyle } from "./style.ts";
import type { BlendIf, BlendMode, EffectParamValue, LayerStyle, PhotoProject } from "../types.ts";

export interface PresetEffect {
  type: string;
  enabled?: boolean;
  params: Record<string, EffectParamValue>;
}

/** A pattern a preset carries (a photo's, kept with the user's preset): its pixels as a PNG, straight sRGB. */
export interface PresetPattern {
  id: string;
  name: string;
  width: number;
  height: number;
  png: string;
}

export interface StylePreset {
  id: string;
  name: string;
  effects: PresetEffect[];
  /** Its Blending Options, when it was saved with them (Include Layer Blending Options). */
  blending?: { blend?: BlendMode; fill?: number; channels?: { r: boolean; g: boolean; b: boolean }; blendIf?: BlendIf };
  patterns?: PresetPattern[];
}

const contour = (name: string) => CONTOUR_PRESETS.find((c) => c.name === name)!;
const gradient = (name: string) => GRADIENT_PRESETS.find((g) => g.name === name)!;

/** The built-in styles. */
export const BUILT_IN_STYLES: readonly StylePreset[] = [
  { id: "builtin:soft-shadow", name: "Soft Shadow", effects: [{ type: "drop-shadow", params: { opacity: 45, distance: 6, size: 14, globalLight: true } }] },
  { id: "builtin:outline", name: "Outline", effects: [{ type: "stroke", params: { size: 3, colour: "#111111" } }] },
  {
    id: "builtin:sticker",
    name: "Sticker",
    effects: [
      { type: "drop-shadow", params: { opacity: 35, distance: 4, size: 8 } },
      { type: "stroke", params: { size: 8, colour: "#ffffff" } },
    ],
  },
  {
    id: "builtin:neon",
    name: "Neon",
    effects: [
      { type: "outer-glow", params: { mode: "screen", colour: "#2ff3ff", opacity: 90, size: 22, spread: 8 } },
      { type: "color-overlay", params: { colour: "#b6fbff" } },
      { type: "inner-glow", params: { mode: "screen", colour: "#ffffff", opacity: 80, size: 5 } },
    ],
  },
  {
    id: "builtin:embossed",
    name: "Embossed",
    effects: [
      { type: "drop-shadow", params: { opacity: 30, distance: 3, size: 5 } },
      { type: "bevel-emboss", params: { size: 6, depth: 120, highlightOpacity: 70, shadowOpacity: 60 } },
    ],
  },
  {
    id: "builtin:chrome",
    name: "Chrome",
    effects: [
      { type: "drop-shadow", params: { opacity: 40, distance: 4, size: 8 } },
      { type: "gradient-overlay", params: { gradient: gradient("Chrome"), angle: 90 } },
      { type: "stroke", params: { size: 1, colour: "#5c6066", position: "inside" } },
      { type: "bevel-emboss", params: { size: 9, depth: 150, gloss: contour("Ring"), highlightOpacity: 85, shadowOpacity: 55 } },
    ],
  },
  {
    id: "builtin:gold",
    name: "Gold",
    effects: [
      { type: "drop-shadow", params: { opacity: 45, distance: 5, size: 8 } },
      { type: "gradient-overlay", params: { gradient: gradient("Copper"), angle: 90, opacity: 70, mode: "overlay" } },
      { type: "color-overlay", params: { colour: "#c79a2c", mode: "multiply" } },
      { type: "bevel-emboss", params: { technique: "chisel-hard", size: 7, depth: 180, gloss: contour("Ring - Double"), highlightMode: "color-dodge", highlightColour: "#fff1b8", highlightOpacity: 60, shadowColour: "#5a3a00", shadowOpacity: 70 } },
    ],
  },
  {
    id: "builtin:glass",
    name: "Glass",
    blending: { fill: 0 },
    effects: [
      { type: "drop-shadow", params: { opacity: 30, distance: 5, size: 10 } },
      { type: "inner-shadow", params: { mode: "multiply", opacity: 30, distance: 3, size: 8 } },
      { type: "inner-glow", params: { mode: "screen", colour: "#ffffff", opacity: 45, size: 10 } },
      { type: "bevel-emboss", params: { size: 10, depth: 90, highlightOpacity: 90, shadowOpacity: 25, soften: 2 } },
    ],
  },
  {
    id: "builtin:inset",
    name: "Inset",
    effects: [
      { type: "inner-shadow", params: { opacity: 60, distance: 4, size: 7 } },
      { type: "bevel-emboss", params: { direction: "down", size: 4, depth: 80, highlightOpacity: 40, shadowOpacity: 30 } },
    ],
  },
  {
    id: "builtin:bricks",
    name: "Bricks",
    effects: [
      { type: "pattern-overlay", params: { pattern: "builtin:bricks" } },
      { type: "bevel-emboss", params: { size: 4, depth: 120, useTexture: true, texture: "builtin:bricks", textureDepth: -80 } },
    ],
  },
  {
    id: "builtin:canvas",
    name: "Canvas",
    effects: [{ type: "bevel-emboss", params: { size: 3, depth: 60, highlightOpacity: 55, shadowOpacity: 45, useTexture: true, texture: "builtin:canvas", textureDepth: 60 } }],
  },
  {
    id: "builtin:satin-silk",
    name: "Silk",
    effects: [
      { type: "color-overlay", params: { colour: "#7a3cd0" } },
      { type: "satin", params: { mode: "screen", colour: "#e8d4ff", opacity: 70, distance: 18, size: 24, invert: false } },
    ],
  },
];

export const builtInStyle = (id: string) => BUILT_IN_STYLES.find((p) => p.id === id);

/** A preset's effects as a style (fresh ids from `newId`); unknown types are left out. */
export function presetStyle(preset: StylePreset, newId: () => string = () => createId("fx")): LayerStyle {
  return {
    enabled: true,
    effects: preset.effects.flatMap((e) => {
      const made = newStyleEffect(e.type, newId(), e.params);
      return made ? [e.enabled === false ? { ...made, enabled: false } : made] : [];
    }),
  };
}

/**
 * A preset applied to layers (one edit): their style replaced by the preset's, or with `add` (⇧) its effects added
 * to theirs (past a type's limit, not). Its Blending Options too when it has them. Adjustment layers get only those.
 */
export function applyStylePreset(doc: PhotoProject, ids: readonly string[], preset: StylePreset, add: boolean, newId: () => string = () => createId("fx")): PhotoProject {
  const styled = ids.filter((id) => doc.layers.find((l) => l.id === id && (l.kind === "image" || l.kind === "pixel")));
  let next = doc;
  if (add) {
    for (const id of styled) for (const e of presetStyle(preset, newId).effects) next = addStyleEffect(next, id, e);
  } else next = setLayerStyle(next, styled, presetStyle(preset, newId), newId);
  if (preset.blending) {
    const b = preset.blending;
    next = { ...next, layers: next.layers.map((l) => (ids.includes(l.id) ? patchBlending(l, { blend: b.blend, fill: b.fill, channels: b.channels, blendIf: b.blendIf }) : l)) };
  }
  return next;
}

/** A preset with its patterns' ids mapped (the ids its patterns got in a photo: `withPatterns`). */
export function remapPresetPatterns(preset: StylePreset, ids: ReadonlyMap<string, string>): StylePreset {
  return {
    ...preset,
    effects: preset.effects.map((e) => {
      const keys = styleDefinition(e.type)?.patterns ?? [];
      const patch = Object.fromEntries(keys.filter((k) => ids.has(e.params[k.pattern] as string)).map((k) => [k.pattern, ids.get(e.params[k.pattern] as string)!]));
      return Object.keys(patch).length ? { ...e, params: { ...e.params, ...patch } } : e;
    }),
  };
}

/** The pattern ids a preset's effects read that aren't built in (the photo's: a saved preset carries them). */
export function presetOwnPatterns(preset: StylePreset): string[] {
  const ids = new Set<string>();
  for (const e of preset.effects) for (const k of styleDefinition(e.type)?.patterns ?? []) if (specShows(k, e.params) && typeof e.params[k.pattern] === "string" && !(e.params[k.pattern] as string).startsWith("builtin:")) ids.add(e.params[k.pattern] as string);
  return [...ids];
}

/** A layer's style (and, with `blending`, its Blending Options) as a preset named `name`. */
export function presetFrom(id: string, name: string, layer: { style?: LayerStyle; blend?: BlendMode; fill?: number; blending?: { channels?: { r: boolean; g: boolean; b: boolean }; blendIf?: BlendIf } }, blending: boolean, effects = true): StylePreset {
  return {
    id,
    name: name.trim() || "Style",
    effects: effects ? (layer.style?.effects ?? []).map((e) => ({ type: e.type, ...(e.enabled ? {} : { enabled: false }), params: structuredClone(e.params) })) : [],
    ...(blending ? { blending: { blend: layer.blend ?? "normal", fill: layer.fill ?? 1, ...(layer.blending?.channels ? { channels: layer.blending.channels } : {}), ...(layer.blending?.blendIf ? { blendIf: layer.blending.blendIf } : {}) } } : {}),
  };
}
