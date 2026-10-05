/**
 * The photo assistant's edits (`shared/photo/tools.ts`), pure: `(doc, input, env) => { doc, text }`, each one undo
 * step in the open photo or one save of a photo that isn't open. Errors go to the model: they say what's wrong
 * and what there is to choose from.
 */
import { addImageLayer, findLayer, moveLayer, removeLayer, setCanvas, setTransform, updateLayer } from "@shared/photo/edits";
import { bounds } from "@shared/photo/layers";
import { isColour } from "@shared/photo/project";
import type { LayerTransform, PhotoLayer, PhotoProject } from "@shared/photo/types";
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

export const sizeOf = (layer: PhotoLayer, assets: readonly MediaAsset[]): { width: number; height: number } | null => {
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

/** One layer as the model reads it. */
export function describeLayer(layer: PhotoLayer, assets: readonly MediaAsset[], index: number): string {
  const size = sizeOf(layer, assets);
  const t = layer.transform;
  const asset = assets.find((a) => a.id === layer.mediaId);
  const parts = [
    `${index}. ${layer.id} "${layer.name}": image ${layer.mediaId}${asset ? ` (${asset.name}, ${asset.width}×${asset.height})` : " (missing: the file isn't in the project)"}`,
    `   centre (${round(t.x)}, ${round(t.y)}), scale ${round(t.scaleX, 4)} × ${round(t.scaleY, 4)}, rotation ${round(t.rotation)}°`,
  ];
  if (size) {
    const b = bounds(t, size);
    parts.push(`   box on the canvas: x ${round(b.x0)}..${round(b.x1)}, y ${round(b.y0)}..${round(b.y1)}`);
  }
  if (!layer.visible || layer.opacity < 1) parts.push(`   ${layer.visible ? "" : "hidden, "}opacity ${round(layer.opacity)}`);
  return parts.join("\n");
}

/** `get_photo`: the canvas and the layers, top down. */
export function describePhoto(doc: PhotoProject, assets: readonly MediaAsset[], selected: string | null): string {
  const lines = [
    `"${doc.name}": canvas ${doc.canvas.width}×${doc.canvas.height} px, background ${doc.canvas.background ?? "transparent"}.`,
    doc.layers.length ? `Layers, top first (${doc.layers.length}):` : "No layers yet.",
    ...[...doc.layers].reverse().map((l) => describeLayer(l, assets, doc.layers.indexOf(l))),
  ];
  if (selected) lines.push(`Selected: ${selected}.`);
  return lines.join("\n");
}

/** `list_photo_media`. */
export function describeMedia(assets: readonly MediaAsset[]): string {
  const images = assets.filter((a) => a.kind === "image");
  if (!images.length) return "The project has no images yet: the user can drop or place files into the editor.";
  return images.map((a) => `${a.id} "${a.name}" ${a.width}×${a.height}${a.image ? `, ${a.image.bits}-bit${a.image.hasAlpha ? ", transparent" : ""}` : ""}`).join("\n");
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

export const transformLayerTool: PhotoEdit = (doc, input, env) => {
  const layer = findLayerRef(doc, input.layer);
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
  if (t.scaleX === 0 || t.scaleY === 0) throw new Error("A scale of 0 would make the layer vanish: use update_layer with visible: false to hide it.");
  const next = setTransform(doc, layer.id, t);
  const after = findLayer(next, layer.id)!;
  return { doc: next, layerId: layer.id, text: next === doc ? `Layer "${layer.name}" was already there.` : `Transformed "${layer.name}".\n${describeLayer(after, env.assets, next.layers.indexOf(after))}` };
};

export const updateLayerTool: PhotoEdit = (doc, input) => {
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
  const next = setCanvas(doc, { width, height, background: background as string | null | undefined }, input.anchor === "centre" ? "centre" : "top-left");
  return { doc: next, text: `Canvas: ${next.canvas.width}×${next.canvas.height} px, background ${next.canvas.background ?? "transparent"}.` };
};
