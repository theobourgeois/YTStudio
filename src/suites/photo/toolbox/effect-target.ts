/**
 * What a brush that reads its pixels changes on the active layer (docs/photo/tools/toning.md, background-eraser.md),
 * pure so it's tested: as the Brush's `paintTargetOf`, but a placed image or a generated layer is converted to
 * pixels first (asked, never silently): a new, empty paint layer has nothing to tone or erase.
 */
import type { PhotoProject } from "@shared/photo/types";
import type { PaintTarget, SurfacePart } from "../paint-target";

export type EffectTargetResult =
  | { layerId: string; part: SurfacePart; addMask?: boolean }
  /** A placed image or a generated layer: the user is asked to convert it to pixels. */
  | { convert: string }
  | { error: string };

/** Which tool asks: Dodge, Burn and Sponge tone a mask's grey too; the Background Eraser erases pixels only. */
export type EffectTool = "toning" | "eraser";

const NAMES: Record<EffectTool, string> = { toning: "tone", eraser: "erase" };

export function effectTargetOf(doc: PhotoProject, activeId: string | null, target: PaintTarget, tool: EffectTool): EffectTargetResult {
  const layer = activeId ? doc.layers.find((l) => l.id === activeId) : undefined;
  if (!layer) return { error: `Select a layer to ${NAMES[tool]}.` };
  if (!layer.visible) return { error: `"${layer.name}" is hidden: show it to ${NAMES[tool]} it.` };
  if (tool === "eraser") {
    if (layer.kind === "adjustment") return { error: `"${layer.name}" is an adjustment layer: it has no pixels to erase.` };
    if (target === "mask" && layer.mask) return { error: `The Background Eraser erases a layer's pixels, not its mask: click "${layer.name}"'s thumbnail to target its pixels.` };
    return layer.kind === "pixel" ? { layerId: layer.id, part: "content" } : { convert: layer.id };
  }
  if (layer.mask && (target === "mask" || layer.kind === "adjustment")) return { layerId: layer.id, part: "mask" };
  if (layer.kind === "pixel") return { layerId: layer.id, part: "content" };
  if (layer.kind === "adjustment") return { layerId: layer.id, part: "mask", addMask: true };
  return { convert: layer.id };
}
