/** What the photo assistant is told with each message (the `<editor-context>` block) and the label under it. */
import type { PhotoProject } from "@shared/photo/types";

export function photoContext(doc: PhotoProject, selected: readonly string[]): { context: string; label: string } {
  const layers = doc.layers.filter((l) => selected.includes(l.id)).reverse();
  const named = layers.map((l) => `${l.id} "${l.name}"`).join(", ");
  const context = [
    `Photo "${doc.name}": canvas ${doc.canvas.width}×${doc.canvas.height} px, background ${doc.canvas.background ?? "transparent"}, ${doc.layers.length} layer${doc.layers.length === 1 ? "" : "s"}.`,
    layers.length > 1 ? `Selected layers (top first): ${named}.` : layers.length ? `Selected layer: ${named}.` : "No layer is selected.",
  ].join("\n");
  return { context, label: photoLabel(doc, layers.length > 1 ? `${layers.length} layers` : (layers[0]?.name ?? null)) };
}

export const photoLabel = (doc: PhotoProject, layerName: string | null) => `${doc.canvas.width} × ${doc.canvas.height}${layerName ? ` · ${layerName}` : ""}`;
