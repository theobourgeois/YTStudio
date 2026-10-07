/**
 * The assistant's Dodge, Burn, Sponge (`tone_area`) and Background Eraser (`remove_colour`): what the user's
 * strokes do, applied at once over a box, the selection or the whole layer, as one undo step. Their requests are read
 * by `effect-requests.ts` (pure, tested); here they run on the open photo's renderer.
 */
import { findLayer } from "@shared/photo/edits";
import { type Affine, apply } from "@shared/photo/layers";
import type { PhotoLayer, PhotoProject, PhotoSelection, SurfaceId } from "@shared/photo/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { ToolRunContext } from "../../types";
import { layerActions } from "../layer-actions";
import { liveRenderer } from "../live";
import { type SurfacePart, commitSurface } from "../paint-target";
import type { BrushEffect } from "../render/brush-effects";
import { eraseRegion } from "../render/colour-erase";
import type { SurfaceImage } from "../render/surface";
import { currentDoc, currentSelection, usePhoto } from "../store";
import { describeSelection, findLayerRef } from "../tool-edits";
import { effectLayerError, eraseRequest, regionOf, toningRequest } from "./effect-requests";

type Input = Record<string, unknown>;

/** The layer and region a call acts on, in the open photo (converted to pixels first when asked to). */
async function effectCall(input: Input, ctx: ToolRunContext, verb: "tone" | "erase"): Promise<{ doc: PhotoProject; layer: PhotoLayer; part: SurfacePart; region: PhotoSelection | null }> {
  const open = usePhoto.getState();
  if (!open.projectId || !open.history || (ctx.chat && ctx.chat !== open.projectId)) throw new Error("Open the photo in the editor first: this changes pixels on the GPU.");
  let doc = currentDoc()!;
  let layer = findLayerRef(doc, input.layer);
  const part: SurfacePart = input.target === "mask" ? "mask" : "content";
  if (input.convert === true && part === "content" && (layer.kind === "image" || layer.kind === "generator")) {
    await layerActions.convertToPixels(layer.id);
    doc = currentDoc()!;
    layer = findLayer(doc, layer.id) ?? layer;
    if (layer.kind !== "pixel") throw new Error(`"${layer.name}" couldn't be converted to pixels.`);
  }
  const error = effectLayerError(layer, part, verb);
  if (error) throw new Error(error);
  return { doc, layer, part, region: regionOf(input, currentSelection(), doc.canvas) };
}

/** Runs an effect on a layer's surface (waiting a moment for it to reach the GPU) and commits it: one undo step. */
async function runEffect(
  layerId: string,
  part: SurfacePart,
  effect: BrushEffect,
  region: PhotoSelection | null,
  accumulate?: (surface: SurfaceImage, toSurface: Affine, tiles: { tx: number; ty: number }[]) => Promise<void>,
): Promise<SurfaceId | null> {
  const renderer = await liveRenderer();
  if (!renderer) throw new Error("No photo is open in the editor.");
  // A layer converted a moment ago (or a mask just added) reaches the GPU shortly.
  const started = performance.now();
  let id: SurfaceId | null | undefined;
  while ((id = await renderer.applyEffect(layerId, part, effect, region, accumulate)) === undefined) {
    if (performance.now() - started > 10_000) throw new Error("That layer's pixels haven't reached the GPU: try again in a moment.");
    await new Promise((r) => setTimeout(r, 25));
  }
  if (id) usePhoto.getState().commit(commitSurface(layerId, part, id));
  return id;
}

const where = (region: PhotoSelection | null, doc: PhotoProject) => (region ? describeSelection(region, doc.canvas) : "the whole layer");

export async function toneAreaTool(input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const request = toningRequest(input);
  const { doc, layer, part, region } = await effectCall(input, ctx, "tone");
  const id = await runEffect(layer.id, part, { kind: "tone", effect: request.effect, cap: request.amount, mask: part === "mask" }, region);
  if (!id) throw new Error(`Nothing changed: ${region ? "the selection or box misses" : "there are no pixels on"} "${layer.name}"${part === "mask" ? "'s mask" : ""}.`);
  const e = request.effect;
  const percent = Math.round(request.amount * 100);
  const how = e.tool === "sponge" ? `${e.mode === "saturate" ? "Saturated" : "Desaturated"} at ${percent}% flow` : `${e.tool === "dodge" ? "Dodged" : "Burnt"} the ${e.range} at ${percent}% exposure${e.protect ? "" : " (without Protect Tones)"}`;
  return textResult(`${how} on "${layer.name}"${part === "mask" ? "'s mask" : ""}, over ${where(region, doc)}. view_photo shows it.`, { added: [], changed: [layer.id], removed: 0 });
}

export async function removeColourTool(input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const request = eraseRequest(input);
  const { doc, layer, region } = await effectCall(input, ctx, "erase");
  let erased = 0;
  const id = await runEffect(layer.id, "content", { kind: "erase" }, region, async (surface, toSurface, tiles) => {
    const seed = request.point ? apply(toSurface, request.point.x, request.point.y) : null;
    erased = await eraseRegion(surface, tiles, { sample: request.sample, seed, options: request.options, protect: request.protect });
  });
  const limits = request.options.limits === "edges" ? "find edges" : request.options.limits;
  if (!id || !erased) {
    throw new Error(`Nothing was erased on "${layer.name}": no pixels there are within ${request.options.tolerance}% of that colour${limits === "discontiguous" ? "" : " and joined to the point"}. Raise tolerance, or check the colour with view_photo.`);
  }
  return textResult(`Erased ${erased.toLocaleString("en")} pixels of that colour from "${layer.name}" (${limits}, tolerance ${request.options.tolerance}%), over ${where(region, doc)}. view_photo shows it.`, { added: [], changed: [layer.id], removed: 0 });
}
