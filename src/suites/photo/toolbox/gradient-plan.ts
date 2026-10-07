/**
 * What a Gradient tool drag does (docs/photo/tools/gradient.md, "The gesture"), pure so it's tested: by its mode and
 * the active layer (and what of it is targeted), a new Gradient Fill layer, the active one's line drawn again, or a
 * Classic gradient painted into a layer's pixels or mask; an image asks first, as the brush does.
 */
import { findLayer } from "@shared/photo/edits";
import { GRADIENT_FILL } from "@shared/photo/effects/gradient";
import { unavailableReason } from "@shared/photo/effects/index";
import type { PhotoLayer, PhotoProject } from "@shared/photo/types";
import { type PaintTarget, type SurfacePart, paintTargetOf } from "../paint-target";
import type { GradientToolMode } from "./gradient-options";

export type GradientPlan =
  /** A new Gradient Fill right above `above` (or on top). */
  | { kind: "new"; above: string | null }
  /** The active Gradient Fill's line drawn again. */
  | { kind: "redraw"; layerId: string }
  /** A Classic gradient into a layer's pixels or mask (`addMask`: an adjustment layer given one first). */
  | { kind: "classic"; layerId: string; part: SurfacePart; addMask?: boolean }
  /** A placed image in Classic: a new paint layer, or converting it (the paint choice). */
  | { kind: "choice"; layerId: string }
  | { kind: "error"; message: string };

/** Whether a layer is a Gradient Fill this app can draw (what the widget edits and a drag redraws). */
export const isGradientFill = (layer: PhotoLayer | undefined | null): layer is Extract<PhotoLayer, { kind: "generator" }> =>
  layer?.kind === "generator" && layer.effect.type === GRADIENT_FILL && !unavailableReason(layer.effect, "generator");

/** What a drag with the Gradient tool does to `doc` with layer `activeId` active and `target` targeted. */
export function gradientPlan(doc: PhotoProject, activeId: string | null, target: PaintTarget, mode: GradientToolMode): GradientPlan {
  const layer = activeId ? findLayer(doc, activeId) : undefined;
  // A mask targeted takes the gradient as greys, in either mode (Photoshop's fade): Classic, painted now.
  const onMask = !!layer?.mask && target === "mask";
  if (mode === "live" && !onMask) {
    if (isGradientFill(layer)) return layer.visible ? { kind: "redraw", layerId: layer.id } : { kind: "error", message: `"${layer.name}" is hidden: show it to draw its gradient again.` };
    return { kind: "new", above: layer?.id ?? null };
  }
  if (!layer) return { kind: "error", message: "Select a layer to paint the gradient on, or make one (⇧⌘N)." };
  if (layer.kind === "generator" && !onMask)
    return { kind: "error", message: `"${layer.name}" is made by its ${isGradientFill(layer) ? "gradient: draw it again in Gradient mode" : "generator"}, not pixels. Target its mask, or paint on a pixel layer.` };
  const t = paintTargetOf(doc, layer.id, target);
  if ("error" in t) return { kind: "error", message: t.error };
  if ("choice" in t) return { kind: "choice", layerId: t.choice };
  return { kind: "classic", layerId: t.layerId, part: t.part, ...(t.addMask ? { addMask: true } : {}) };
}
