/**
 * The pictures the Camera Raw window reads (docs/photo/camera-raw.md, "CR3"): what a Camera Raw develops (its input:
 * Auto reads it, the presets' thumbnails develop it) and what it makes (the histogram's), as small renders.
 */
import type { PhotoProject } from "@shared/photo/types";
import { analysisInput } from "../render/camera-raw-analysis";
import { liveRenderer } from "../live";
import type { CameraRawTarget } from "../ui";

/** The document a target develops (its layer before it, or what's below it), or, `through`, with it applied. */
export function targetDoc(doc: PhotoProject, target: CameraRawTarget, through = false): PhotoProject | null {
  const input = analysisInput(doc, { layerId: target.layerId, filterId: target.filterId, inputKey: "" });
  if (!input || !through) return input;
  if (target.filterId === null) {
    const index = doc.layers.findIndex((l) => l.id === target.layerId);
    return index < 0 ? null : { ...doc, layers: doc.layers.slice(0, index + 1) };
  }
  const [layer] = input.layers;
  const all = doc.layers.find((l) => l.id === target.layerId);
  if (!all || all.kind === "adjustment" || layer.kind === "adjustment") return input;
  const filters = all.filters ?? [];
  const index = filters.findIndex((f) => f.id === target.filterId);
  return { ...input, layers: [{ ...layer, filters: index < 0 ? filters : filters.slice(0, index + 1) }] };
}

/** A document fitted into `size` pixels on its long side, as premultiplied linear floats (null without a renderer). */
export async function smallRender(doc: PhotoProject, size: number): Promise<{ data: Float32Array; width: number; height: number } | null> {
  const renderer = liveRenderer();
  if (!renderer) return null;
  const r = await renderer;
  const zoom = Math.min(1, size / Math.max(doc.canvas.width, doc.canvas.height));
  const width = Math.max(1, Math.round(doc.canvas.width * zoom));
  const height = Math.max(1, Math.round(doc.canvas.height * zoom));
  const { texture } = await r.renderView(doc, { zoom, x: 0, y: 0, width, height }, { quick: true });
  try {
    return { data: await r.readFloat(texture, width, height), width, height };
  } finally {
    texture.destroy();
  }
}

/** A document as a JPEG `width` wide (a preset's thumbnail), or null without a renderer. */
export async function thumbnail(doc: PhotoProject, width: number): Promise<Blob | null> {
  const renderer = liveRenderer();
  return renderer ? (await renderer).picture(doc, width, "image/jpeg") : null;
}
