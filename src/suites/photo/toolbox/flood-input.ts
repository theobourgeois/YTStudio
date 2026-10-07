/**
 * The assistant's Paint Bucket and Magic Eraser (`bucket_fill`, `magic_erase` in `shared/photo/tools.ts`): the
 * model's input read and checked, and what a click did told back. Pure, so it's tested: errors say what's wrong and
 * what's allowed. `flood-tools.ts` runs the clicks.
 */
import { findLayer } from "@shared/photo/edits";
import { isFillMode } from "@shared/photo/fill-compose";
import type { PhotoProject } from "@shared/photo/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { PaintTarget } from "../paint-target";
import { findLayerRef, patternRef } from "../tool-edits";
import type { BucketOptions, MagicEraserOptions } from "./fill-options";
import type { FloodOutcome } from "./flood-actions";

type Input = Record<string, unknown>;

interface Common {
  at: { x: number; y: number };
  layerId: string;
  target: PaintTarget;
}

const finite = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Give ${name} as a number.`);
  return v;
};

function common(doc: PhotoProject, input: Input, selected: string | null): Common {
  const at = { x: finite(input.x, "x (canvas pixels)"), y: finite(input.y, "y (canvas pixels)") };
  if (at.x < 0 || at.y < 0 || at.x >= doc.canvas.width || at.y >= doc.canvas.height) throw new Error(`(${at.x}, ${at.y}) is off the canvas (${doc.canvas.width}×${doc.canvas.height} px).`);
  const layer = input.layer === undefined ? (selected ? findLayer(doc, selected) : undefined) : findLayerRef(doc, input.layer);
  if (!layer) throw new Error(`Say which layer (layer: an id or name): none is selected. The layers: ${doc.layers.map((l) => `${l.id} ("${l.name}")`).join(", ") || "none"}.`);
  if (input.target !== undefined && input.target !== "content" && input.target !== "mask") throw new Error('target must be "content" or "mask".');
  if (input.target === "mask" && !layer.mask && layer.kind !== "adjustment") throw new Error(`"${layer.name}" has no mask: add one with add_mask, or leave target out.`);
  return { at, layerId: layer.id, target: input.target === "mask" ? "mask" : "content" };
}

const unit = (v: unknown, name: string) => {
  if (v === undefined) return undefined;
  const n = finite(v, name);
  if (n <= 0 || n > 1) throw new Error(`${name} must be more than 0 and at most 1.`);
  return n;
};

const tolerance = (v: unknown) => {
  if (v === undefined) return 32;
  const n = finite(v, "tolerance");
  if (n < 0 || n > 255) throw new Error("tolerance must be 0..255.");
  return Math.round(n);
};

/** `bucket_fill`'s input: where, on what, with what. */
export function bucketInput(doc: PhotoProject, input: Input, selected: string | null, colours: { foreground: string; background: string }): Common & { options: BucketOptions; colour: string } {
  const where = common(doc, input, selected);
  const layer = findLayer(doc, where.layerId)!;
  if ((layer.kind === "image" || layer.kind === "generator") && where.target === "content")
    throw new Error(`"${layer.name}" is ${layer.kind === "image" ? "a placed image" : "a generator layer"}, kept whole: add a pixel layer above it (add_pixel_layer) and fill that with all_layers: true, or fill its mask (target: mask).`);
  const spec = String(input.with ?? "foreground").trim().toLowerCase();
  const pattern = spec === "pattern";
  const colour = spec === "foreground" || pattern ? colours.foreground : spec === "background" ? colours.background : /^#[0-9a-f]{6}$/.test(spec) ? spec : null;
  if (!colour) throw new Error('with must be "foreground", "background", "pattern" or a colour like "#ff8800".');
  if (input.mode !== undefined && !isFillMode(input.mode)) throw new Error('mode must be a blend mode ("normal", "multiply", "screen", "overlay"…), "behind" or "clear".');
  if (input.pattern !== undefined && !pattern) throw new Error('pattern is for with: "pattern".');
  return {
    ...where,
    colour,
    options: {
      source: pattern ? "pattern" : "foreground",
      pattern: pattern ? patternRef(doc, input.pattern ?? "") : "",
      mode: isFillMode(input.mode) ? input.mode : "normal",
      opacity: unit(input.opacity, "opacity") ?? 1,
      tolerance: tolerance(input.tolerance),
      contiguous: input.contiguous !== false,
      antiAlias: input.anti_alias !== false,
      allLayers: input.all_layers === true,
    },
  };
}

/** `magic_erase`'s input. */
export function eraseInput(doc: PhotoProject, input: Input, selected: string | null): Common & { options: MagicEraserOptions } {
  const where = common(doc, input, selected);
  return {
    ...where,
    options: {
      tolerance: tolerance(input.tolerance),
      contiguous: input.contiguous !== false,
      antiAlias: input.anti_alias !== false,
      sampleAll: input.sample_all_layers === true,
      opacity: unit(input.opacity, "opacity") ?? 1,
      defringe: input.defringe !== false,
    },
  };
}

/** What a click did, for the model; an error throws (its message is for the model too). */
export function floodResult(outcome: FloodOutcome, doc: PhotoProject, verb: "Filled" | "Erased", at: { x: number; y: number }): ToolResult {
  if (outcome.kind === "error") throw new Error(outcome.message);
  if (outcome.kind === "choice") throw new Error(`"${findLayer(doc, outcome.layerId)?.name ?? outcome.layerId}" is a placed image, kept whole: add a pixel layer above it (add_pixel_layer) and fill that with all_layers: true.`);
  const name = findLayer(doc, outcome.layerId)?.name ?? outcome.layerId;
  if (!outcome.changed) return textResult(`Nothing changed at (${Math.round(at.x)}, ${Math.round(at.y)}) on "${name}": the area there is outside the selection, misses the layer, or is already that way.`);
  const where = outcome.part === "mask" ? `"${name}"'s mask${outcome.addedMask ? " (added: the layer is kept whole; remove the mask to undo it all)" : ""}` : `"${name}"`;
  return textResult(`${verb} the area around (${Math.round(at.x)}, ${Math.round(at.y)}) on ${where}. view_photo shows it.`, { added: [], changed: [outcome.layerId], removed: 0 });
}

