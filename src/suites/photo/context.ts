/** What the photo assistant is told with each message (the `<editor-context>` block) and the label under it. */
import type { PhotoProject } from "@shared/photo/types";

export function photoContext(doc: PhotoProject, selected: string | null): { context: string; label: string } {
  const layer = selected ? doc.layers.find((l) => l.id === selected) : undefined;
  const context = [
    `Photo "${doc.name}": canvas ${doc.canvas.width}×${doc.canvas.height} px, background ${doc.canvas.background ?? "transparent"}, ${doc.layers.length} layer${doc.layers.length === 1 ? "" : "s"}.`,
    layer ? `Selected layer: ${layer.id} "${layer.name}".` : "No layer is selected.",
  ].join("\n");
  return { context, label: photoLabel(doc, layer?.name ?? null) };
}

export const photoLabel = (doc: PhotoProject, layerName: string | null) => `${doc.canvas.width} × ${doc.canvas.height}${layerName ? ` · ${layerName}` : ""}`;
