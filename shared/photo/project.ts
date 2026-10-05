/**
 * Making and checking photo documents: `createPhotoProject` for a new one, `withPhotoOptions` for the tab's
 * choices (a size preset), and `normalizePhotoProject`, which validates and repairs an untrusted one (from disk,
 * a request or the assistant). Repairs keep what's there: a layer whose media is missing stays (it renders as
 * missing), a bad number goes back to its default, never a silent deletion of the user's work.
 */
import { createId } from "../ids.ts";
import { CANVAS_PRESETS, type ImageLayer, type LayerTransform, MAX_CANVAS_SIDE, PHOTO_VERSION, type PhotoCanvas, type PhotoLayer, type PhotoProject } from "./types.ts";

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

function normalizeLayer(value: unknown, canvas: PhotoCanvas, seen: Set<string>): PhotoLayer | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Record<string, unknown>;
  if (l.kind !== "image" || typeof l.mediaId !== "string" || !l.mediaId) return null;
  let id = typeof l.id === "string" && /^[\w-]{1,64}$/.test(l.id) ? l.id : createId("layer");
  if (seen.has(id)) id = createId("layer");
  seen.add(id);
  const layer: ImageLayer = {
    id,
    kind: "image",
    name: typeof l.name === "string" && l.name.trim() ? l.name.trim().slice(0, 200) : "Image",
    visible: l.visible !== false,
    opacity: Math.max(0, Math.min(1, finite(l.opacity, 1))),
    mediaId: l.mediaId,
    transform: normalizeTransform(l.transform, { x: canvas.width / 2, y: canvas.height / 2 }),
  };
  return layer;
}

/**
 * Validates and repairs an untrusted document. Throws only when it isn't a photo at all, or a newer version
 * made it (opening it here would lose what this version doesn't know).
 */
export function normalizePhotoProject(value: unknown): PhotoProject {
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
  const layers = (Array.isArray(d.layers) ? d.layers : []).map((l) => normalizeLayer(l, canvas, seen)).filter((l): l is PhotoLayer => l !== null);
  return {
    version: PHOTO_VERSION,
    name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : "Untitled",
    canvas,
    output: { highlights: o.highlights === "clip" ? "clip" : "film" },
    layers,
  };
}
