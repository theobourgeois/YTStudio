/**
 * Blending Options (docs/photo/layer-style/README.md, phase L1): the blend modes' names, groups and keys as
 * Photoshop's menu has them, a layer's blending read with its defaults, and the checks `normalizePhotoProject` and
 * the edits share. What each mode does to pixels is `reference/blend.ts` (and the GPU's `render/blend.ts`).
 */
import type { BlendIf, BlendIfChannel, BlendMode, BlendRange, BlendingOptions, Compositing, PhotoLayer, PhotoProject } from "./types.ts";

export interface BlendModeInfo {
  id: BlendMode;
  label: string;
  /** The menu's group (Photoshop separates them with lines). */
  group: number;
  /** Photoshop's ⇧⌥ letter for it, if it has one. */
  key?: string;
}

/** Every mode in Photoshop's menu order (measured in 27.11's Layers panel: photoshop-measurements.md). */
export const BLEND_MODES: readonly BlendModeInfo[] = [
  { id: "normal", label: "Normal", group: 0, key: "N" },
  { id: "dissolve", label: "Dissolve", group: 0, key: "I" },
  { id: "darken", label: "Darken", group: 1, key: "K" },
  { id: "multiply", label: "Multiply", group: 1, key: "M" },
  { id: "color-burn", label: "Color Burn", group: 1, key: "B" },
  { id: "linear-burn", label: "Linear Burn", group: 1, key: "A" },
  { id: "darker-color", label: "Darker Color", group: 1 },
  { id: "lighten", label: "Lighten", group: 2, key: "G" },
  { id: "screen", label: "Screen", group: 2, key: "S" },
  { id: "color-dodge", label: "Color Dodge", group: 2, key: "D" },
  { id: "linear-dodge", label: "Linear Dodge (Add)", group: 2, key: "W" },
  { id: "lighter-color", label: "Lighter Color", group: 2 },
  { id: "overlay", label: "Overlay", group: 3, key: "O" },
  { id: "soft-light", label: "Soft Light", group: 3, key: "F" },
  { id: "hard-light", label: "Hard Light", group: 3, key: "H" },
  { id: "vivid-light", label: "Vivid Light", group: 3, key: "V" },
  { id: "linear-light", label: "Linear Light", group: 3, key: "J" },
  { id: "pin-light", label: "Pin Light", group: 3, key: "Z" },
  { id: "hard-mix", label: "Hard Mix", group: 3, key: "L" },
  { id: "difference", label: "Difference", group: 4, key: "E" },
  { id: "exclusion", label: "Exclusion", group: 4, key: "X" },
  { id: "subtract", label: "Subtract", group: 4 },
  { id: "divide", label: "Divide", group: 4 },
  { id: "hue", label: "Hue", group: 5, key: "U" },
  { id: "saturation", label: "Saturation", group: 5, key: "T" },
  { id: "color", label: "Color", group: 5, key: "C" },
  { id: "luminosity", label: "Luminosity", group: 5, key: "Y" },
];

const MODE_IDS = new Set<string>(BLEND_MODES.map((m) => m.id));
export const isBlendMode = (v: unknown): v is BlendMode => typeof v === "string" && MODE_IDS.has(v);
export const blendModeInfo = (mode: BlendMode): BlendModeInfo => BLEND_MODES.find((m) => m.id === mode)!;
/** The mode a ⇧⌥ letter picks (case-insensitive), as Photoshop's keys. */
export const blendModeForKey = (letter: string): BlendMode | null => BLEND_MODES.find((m) => m.key === letter.toUpperCase())?.id ?? null;

/**
 * The eight modes where Fill isn't Opacity: Fill pulls the layer towards the mode's neutral colour before the mode,
 * Opacity fades after it (measured: photoshop-measurements.md, "Opacity, Fill and transparency").
 */
export const SPECIAL_FILL: ReadonlySet<BlendMode> = new Set(["color-burn", "linear-burn", "color-dodge", "linear-dodge", "vivid-light", "linear-light", "hard-mix", "difference"]);

/** The next (or previous) mode in the menu, wrapping: Photoshop's ⇧+ and ⇧−. */
export function stepBlendMode(mode: BlendMode, direction: 1 | -1): BlendMode {
  const i = BLEND_MODES.findIndex((m) => m.id === mode);
  return BLEND_MODES[(i + direction + BLEND_MODES.length) % BLEND_MODES.length].id;
}

/** A range that passes everything (Photoshop's untouched handles). */
export const FULL_RANGE: BlendRange = [0, 0, 255, 255];
export const BLEND_IF_CHANNELS = ["gray", "red", "green", "blue"] as const;
export type BlendIfEntry = (typeof BLEND_IF_CHANNELS)[number];

export const isFullRange = (r: BlendRange) => r[0] === 0 && r[1] === 0 && r[2] === 255 && r[3] === 255;

/** A range checked: whole numbers on 0..255, each handle at or after the one before (the handles can't cross). */
export function normalizeRange(value: unknown): BlendRange | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const r = value.map((v) => Math.round(Math.max(0, Math.min(255, v)))) as BlendRange;
  for (let i = 1; i < 4; i++) r[i] = Math.max(r[i], r[i - 1]);
  return r;
}

/** Blend If checked: entries that pass everything are left out, and so is the whole when nothing's left. */
export function normalizeBlendIf(value: unknown): BlendIf | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const out: BlendIf = {};
  for (const entry of BLEND_IF_CHANNELS) {
    const e = v[entry];
    if (!e || typeof e !== "object") continue;
    const layer = normalizeRange((e as Record<string, unknown>).layer) ?? FULL_RANGE;
    const underlying = normalizeRange((e as Record<string, unknown>).underlying) ?? FULL_RANGE;
    if (isFullRange(layer) && isFullRange(underlying)) continue;
    out[entry] = { layer, underlying };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Blending Options checked: only what differs from the defaults is kept, so a plain layer has no field. */
export function normalizeBlendingOptions(value: unknown): BlendingOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const out: BlendingOptions = {};
  if (v.channels && typeof v.channels === "object") {
    const c = v.channels as Record<string, unknown>;
    const channels = { r: c.r !== false, g: c.g !== false, b: c.b !== false };
    if (!channels.r || !channels.g || !channels.b) out.channels = channels;
  }
  const blendIf = normalizeBlendIf(v.blendIf);
  if (blendIf) out.blendIf = blendIf;
  if (v.interiorAsGroup === true) out.interiorAsGroup = true;
  if (v.maskHidesEffects === true) out.maskHidesEffects = true;
  return Object.keys(out).length ? out : undefined;
}

/** A layer's blending fields checked, to spread into it: absent at their defaults. */
export function normalizeLayerBlending(l: Record<string, unknown>): { blend?: BlendMode; fill?: number; blending?: BlendingOptions } {
  const out: { blend?: BlendMode; fill?: number; blending?: BlendingOptions } = {};
  if (isBlendMode(l.blend) && l.blend !== "normal") out.blend = l.blend;
  if (typeof l.fill === "number" && Number.isFinite(l.fill) && l.fill < 1) out.fill = Math.max(0, l.fill);
  const blending = normalizeBlendingOptions(l.blending);
  if (blending) out.blending = blending;
  return out;
}

/** What a layer's blending is, with every default filled in. */
export interface LayerBlending {
  mode: BlendMode;
  fill: number;
  channels: { r: boolean; g: boolean; b: boolean };
  blendIf: BlendIf;
}

const ALL_CHANNELS = { r: true, g: true, b: true };
const NO_BLEND_IF: BlendIf = {};

export function blendingOf(layer: PhotoLayer): LayerBlending {
  return { mode: layer.blend ?? "normal", fill: layer.fill ?? 1, channels: layer.blending?.channels ?? ALL_CHANNELS, blendIf: layer.blending?.blendIf ?? NO_BLEND_IF };
}

/**
 * Whether a layer blends as plain Normal (no mode, no Blend If, every channel; the two effect options aside): Fill
 * then just multiplies Opacity.
 */
export const isPlainBlending = (layer: PhotoLayer) => (layer.blend ?? "normal") === "normal" && !layer.blending?.channels && !layer.blending?.blendIf;

/** A document's compositing: "linear" for photos made before it was a choice. */
export const compositingOf = (doc: PhotoProject): Compositing => doc.compositing ?? "linear";

/** The patch an edit applies to a layer's blending (only what's given changes). */
export interface BlendingPatch {
  blend?: BlendMode;
  opacity?: number;
  fill?: number;
  channels?: Partial<{ r: boolean; g: boolean; b: boolean }>;
  /** Entries to set (a full range on both sides clears it); null clears every entry. */
  blendIf?: Partial<Record<BlendIfEntry, Partial<BlendIfChannel> | null>> | null;
  interiorAsGroup?: boolean;
  maskHidesEffects?: boolean;
}

/** A layer with `patch` applied, its fields at their defaults left out; the same layer when nothing changes. */
export function patchBlending<L extends PhotoLayer>(layer: L, patch: BlendingPatch): L {
  const before = blendingOf(layer);
  const blend = patch.blend !== undefined && isBlendMode(patch.blend) ? patch.blend : before.mode;
  const clamp01 = (v: number | undefined, was: number) => (v !== undefined && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : was);
  const fill = clamp01(patch.fill, before.fill);
  const opacity = clamp01(patch.opacity, layer.opacity);
  const channels = { ...before.channels, ...(patch.channels ?? {}) };
  let blendIf: BlendIf = before.blendIf;
  if (patch.blendIf === null) blendIf = {};
  else if (patch.blendIf) {
    blendIf = { ...blendIf };
    for (const entry of BLEND_IF_CHANNELS) {
      if (!(entry in patch.blendIf)) continue;
      const p = patch.blendIf[entry];
      if (p === null || p === undefined) delete blendIf[entry];
      else blendIf[entry] = { layer: p.layer ?? blendIf[entry]?.layer ?? FULL_RANGE, underlying: p.underlying ?? blendIf[entry]?.underlying ?? FULL_RANGE };
    }
  }
  const interiorAsGroup = patch.interiorAsGroup ?? layer.blending?.interiorAsGroup;
  const maskHidesEffects = patch.maskHidesEffects ?? layer.blending?.maskHidesEffects;
  const fields = normalizeLayerBlending({ blend, fill, blending: { channels, blendIf, interiorAsGroup, maskHidesEffects } });
  const next = { ...layer, opacity } as L & { blend?: BlendMode; fill?: number; blending?: BlendingOptions };
  delete next.blend;
  delete next.fill;
  delete next.blending;
  Object.assign(next, fields);
  const same =
    next.opacity === layer.opacity &&
    next.blend === layer.blend &&
    next.fill === layer.fill &&
    JSON.stringify(next.blending ?? null) === JSON.stringify(layer.blending ?? null);
  return same ? layer : next;
}

/** A layer's Dissolve seed: its id hashed (FNV-1a), so each layer's speckle is its own and stays put. */
export function blendSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** A short description of a layer's blending for people and the assistant: "Multiply, Fill 50%, Blend If". */
export function describeBlending(layer: PhotoLayer): string | null {
  const b = blendingOf(layer);
  const parts: string[] = [];
  if (b.mode !== "normal") parts.push(blendModeInfo(b.mode).label);
  if (b.fill < 1) parts.push(`Fill ${Math.round(b.fill * 100)}%`);
  const off = (["r", "g", "b"] as const).filter((c) => !b.channels[c]);
  if (off.length) parts.push(`channels ${(["r", "g", "b"] as const).filter((c) => b.channels[c]).map((c) => c.toUpperCase()).join("") || "none"}`);
  const entries = BLEND_IF_CHANNELS.filter((e) => b.blendIf[e]);
  if (entries.length) parts.push(`Blend If ${entries.map((e) => `${e} (this layer ${b.blendIf[e]!.layer.join("/")}, underlying ${b.blendIf[e]!.underlying.join("/")})`).join(", ")}`);
  return parts.length ? parts.join(", ") : null;
}
