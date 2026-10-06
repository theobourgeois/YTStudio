/**
 * Making and checking photo documents: `createPhotoProject` for a new one, `withPhotoOptions` for the tab's
 * choices (a size preset), and `normalizePhotoProject`, which validates and repairs an untrusted one (from disk,
 * a request or the assistant). Repairs keep what's there: a layer whose media is missing stays (it renders as
 * missing), a bad number goes back to its default, never a silent deletion of the user's work.
 */
import { createId } from "../ids.ts";
import { effectDefinition, validateParams } from "./effects/index.ts";
import { isHash } from "./surfaces.ts";
import {
  type AdjustmentLayer,
  CANVAS_PRESETS,
  type EffectInstance,
  type EffectParamValue,
  type ImageLayer,
  type LayerMask,
  type LayerTransform,
  MAX_CANVAS_SIDE,
  PHOTO_VERSION,
  type PhotoCanvas,
  type PhotoLayer,
  type PhotoProject,
  type PixelLayer,
  type SurfaceId,
} from "./types.ts";

const DEFAULT_PRESET = CANVAS_PRESETS[0];

export function createPhotoProject(name: string, canvas: Partial<PhotoCanvas> = {}): PhotoProject {
  return {
    version: PHOTO_VERSION,
    name,
    canvas: { width: canvas.width ?? DEFAULT_PRESET.width, height: canvas.height ?? DEFAULT_PRESET.height, background: canvas.background === undefined ? "#ffffff" : canvas.background },
    output: { highlights: "film" },
    layers: [],
  };
}

/** New-project choices kept in the tab (`ClientSuite.newProjectOptions`): `{ width, height, background }`. */
export interface PhotoOptions {
  width?: number;
  height?: number;
  background?: string | null;
}

/** The document with the tab's choices for new photos (untrusted: what isn't valid is ignored). */
export function withPhotoOptions(doc: PhotoProject, options: unknown): PhotoProject {
  if (!options || typeof options !== "object") return doc;
  const o = options as Record<string, unknown>;
  const canvas = { ...doc.canvas };
  if (isSide(o.width)) canvas.width = o.width;
  if (isSide(o.height)) canvas.height = o.height;
  if (o.background === null || isColour(o.background)) canvas.background = o.background;
  return doc.layers.length ? doc : { ...doc, canvas };
}

const isSide = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_CANVAS_SIDE;
export const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** The smallest scale a layer can have (a zero scale has no inverse: nothing could be resampled). */
export const MIN_SCALE = 1e-4;

function normalizeScale(v: unknown): number {
  const s = finite(v, 1);
  if (Math.abs(s) < MIN_SCALE) return s < 0 ? -MIN_SCALE : MIN_SCALE;
  return Math.max(-1e4, Math.min(1e4, s));
}

export function normalizeTransform(value: unknown, fallback: { x: number; y: number }): LayerTransform {
  const t = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    x: Math.max(-1e6, Math.min(1e6, finite(t.x, fallback.x))),
    y: Math.max(-1e6, Math.min(1e6, finite(t.y, fallback.y))),
    scaleX: normalizeScale(t.scaleX),
    scaleY: normalizeScale(t.scaleY),
    // Kept in (-180, 180].
    rotation: wrapDegrees(finite(t.rotation, 0)),
  };
}

export function wrapDegrees(d: number): number {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

const ID = /^[\w-]{1,64}$/;

/** A unique id: the one given when it's well formed and not taken, else a new one. */
function uniqueId(value: unknown, prefix: string, seen: Set<string>): string {
  let id = typeof value === "string" && ID.test(value) ? value : createId(prefix);
  if (seen.has(id)) id = createId(prefix);
  seen.add(id);
  return id;
}

/** What a problem found while normalising is reported to (the server logs them; tests read them). */
export type Report = (problem: string) => void;

/**
 * An effect instance checked. A known type at a version this app knows has its parameters validated (repairs
 * reported); an unknown type or a newer version is kept exactly as it was, to be shown as unavailable.
 */
export function normalizeEffect(value: unknown, seen: Set<string>, report: Report): EffectInstance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.type !== "string" || !e.type) return null;
  const id = uniqueId(e.id, "fx", seen);
  const def = effectDefinition(e.type);
  const version = Number.isInteger(e.version) && (e.version as number) >= 1 ? (e.version as number) : 1;
  const enabled = e.enabled !== false;
  if (!def || version > def.version) {
    report(`Effect ${id}: ${def ? `version ${version} is newer than this app's ${def.version}` : `unknown type "${e.type}"`}; kept as it was.`);
    const params = e.params && typeof e.params === "object" && !Array.isArray(e.params) ? (structuredClone(e.params) as Record<string, EffectParamValue>) : {};
    return { id, type: e.type, version, enabled, params };
  }
  const { params, problems } = validateParams(def, e.params);
  for (const p of problems) report(`Effect ${id}: ${p}`);
  return { id, type: def.type, version, enabled, params };
}

/** A surface reference: a SHA-256, or null (an empty surface). Anything else is reported and treated as null. */
function surfaceRef(value: unknown, what: string, report: Report): SurfaceId | null {
  if (value === null || value === undefined) return null;
  if (isHash(value)) return value;
  report(`${what}: "${String(value)}" isn't a surface id; left empty.`);
  return null;
}

/** A layer's mask, checked: absent stays absent (no field written for a layer without one). */
function normalizeMask(value: unknown, id: string, report: Report): { mask?: LayerMask } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    report(`Layer ${id}: its mask isn't one; left out.`);
    return {};
  }
  return { mask: { surface: surfaceRef((value as Record<string, unknown>).surface, `Layer ${id}'s mask`, report) } };
}

const LAYER_NAMES: Record<string, string> = { image: "Image", pixel: "Layer", adjustment: "Adjustment" };

function normalizeLayer(value: unknown, canvas: PhotoCanvas, seen: Set<string>, report: Report): PhotoLayer | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Record<string, unknown>;
  const common = (id: string) => ({
    name: typeof l.name === "string" && l.name.trim() ? l.name.trim().slice(0, 200) : (LAYER_NAMES[String(l.kind)] ?? "Layer"),
    visible: l.visible !== false,
    opacity: Math.max(0, Math.min(1, finite(l.opacity, 1))),
    ...normalizeMask(l.mask, id, report),
  });
  if (l.kind === "image") {
    if (typeof l.mediaId !== "string" || !l.mediaId) return null;
    const id = uniqueId(l.id, "layer", seen);
    const layer: ImageLayer = {
      id,
      kind: "image",
      ...common(id),
      mediaId: l.mediaId,
      transform: normalizeTransform(l.transform, { x: canvas.width / 2, y: canvas.height / 2 }),
    };
    return layer;
  }
  if (l.kind === "adjustment") {
    const id = uniqueId(l.id, "layer", seen);
    const effect = normalizeEffect(l.effect, seen, report);
    if (!effect) {
      report(`Layer ${id}: an adjustment layer without an effect was left out.`);
      return null;
    }
    const layer: AdjustmentLayer = { id, kind: "adjustment", ...common(id), effect };
    return layer;
  }
  if (l.kind === "pixel") {
    const id = uniqueId(l.id, "layer", seen);
    const s = (l.size && typeof l.size === "object" ? l.size : {}) as Record<string, unknown>;
    const size = { width: isSide(s.width) ? s.width : canvas.width, height: isSide(s.height) ? s.height : canvas.height };
    const layer: PixelLayer = {
      id,
      kind: "pixel",
      ...common(id),
      surface: surfaceRef(l.surface, `Layer ${id}`, report),
      size,
      transform: normalizeTransform(l.transform, { x: size.width / 2, y: size.height / 2 }),
    };
    return layer;
  }
  return null;
}

/**
 * Validates and repairs an untrusted document, and brings an older version up to this one (version 1 had image
 * layers only, version 2 added adjustments, version 3 pixel layers and masks: each is a valid version 5, its highlights
 * clipped as they were drawn). Throws only when it isn't a photo at all, or a newer version made
 * it (opening it here would lose what this version doesn't know). What it repairs is told to `report`.
 */
export function normalizePhotoProject(value: unknown, report: Report = () => {}): PhotoProject {
  if (!value || typeof value !== "object") throw new Error("Not a photo.");
  const d = value as Record<string, unknown>;
  if (typeof d.version === "number" && d.version > PHOTO_VERSION) throw new Error(`This photo was made by a newer version of the app (version ${d.version}).`);
  const c = (d.canvas && typeof d.canvas === "object" ? d.canvas : {}) as Record<string, unknown>;
  const canvas: PhotoCanvas = {
    width: isSide(c.width) ? c.width : DEFAULT_PRESET.width,
    height: isSide(c.height) ? c.height : DEFAULT_PRESET.height,
    background: c.background === null ? null : isColour(c.background) ? c.background.toLowerCase() : "#ffffff",
  };
  const o = (d.output && typeof d.output === "object" ? d.output : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const layers = (Array.isArray(d.layers) ? d.layers : []).map((l) => normalizeLayer(l, canvas, seen, report)).filter((l): l is PhotoLayer => l !== null);
  return {
    version: PHOTO_VERSION,
    name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : "Untitled",
    canvas,
    // Before version 5 every photo was drawn clipped, whatever it said: it keeps that look (f4-light.md, D2).
    output: { highlights: o.highlights === "clip" || !(typeof d.version === "number" && d.version >= 5) ? "clip" : "film" },
    layers,
  };
}
