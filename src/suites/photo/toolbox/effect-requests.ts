/**
 * The assistant's Dodge, Burn, Sponge and Background Eraser (`tone_area`, `remove_colour`: shared/photo/tools.ts):
 * what a call asks for, read and checked here, pure, so a model's mistakes come back as messages that say what to
 * do. The handlers (`tools.ts`) run them on the GPU.
 */
import { type BackgroundEraserOptions, type Colour8, type EraseLimits, hexColour8 } from "@shared/photo/background-eraser";
import type { Size } from "@shared/photo/geometry";
import type { ToneEffect, ToneRange } from "@shared/photo/reference/toning";
import { rectSelection } from "@shared/photo/selection";
import { featherSelection } from "@shared/photo/selection-shapes";
import type { PhotoLayer, PhotoSelection } from "@shared/photo/types";
import type { SurfacePart } from "../paint-target";

type Input = Record<string, unknown>;

/** A whole-number percentage 1..100 (or 0..100), else a message. */
function percent(v: unknown, key: string, fallback: number, min = 1): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > 100) throw new Error(`${key} must be a number from ${min} to 100 (percent).`);
  return v;
}

function bool(v: unknown, key: string, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "boolean") throw new Error(`${key} must be true or false.`);
  return v;
}

function oneOf<T extends string>(v: unknown, key: string, options: readonly T[], fallback: T): T {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "string" && (options as readonly string[]).includes(v)) return v as T;
  throw new Error(`${key} must be one of ${options.join(", ")}.`);
}

function colour(v: unknown, key: string): Colour8 {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v.trim())) throw new Error(`${key} must be a colour like "#ffffff".`);
  return hexColour8(v.trim().toLowerCase());
}

/** `tone_area`'s effect and amount: Dodge and Burn by their Exposure, Sponge by its Flow. */
export function toningRequest(input: Input): { effect: ToneEffect; amount: number; part: SurfacePart } {
  const tool = oneOf(input.tool, "tool", ["dodge", "burn", "sponge"] as const, "dodge");
  if (input.tool === undefined) throw new Error("tool is required: dodge (lighten), burn (darken) or sponge (saturation).");
  const part = oneOf(input.target, "target", ["content", "mask"] as const, "content");
  if (tool === "sponge") {
    const mode = oneOf(input.mode, "mode", ["desaturate", "saturate"] as const, "desaturate");
    return { effect: { tool, mode, vibrance: bool(input.vibrance, "vibrance", true) }, amount: percent(input.flow, "flow", 50) / 100, part };
  }
  const range = oneOf<ToneRange>(input.range, "range", ["shadows", "midtones", "highlights"], "midtones");
  return { effect: { tool, range, protect: bool(input.protect_tones, "protect_tones", true) }, amount: percent(input.exposure, "exposure", 50) / 100, part };
}

const LIMITS: Record<string, EraseLimits> = { contiguous: "contiguous", discontiguous: "discontiguous", find_edges: "edges" };

/** A canvas point [x, y]. */
function point(v: unknown, key: string): { x: number; y: number } {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error(`${key} must be [x, y] in canvas pixels.`);
  return { x: v[0] as number, y: v[1] as number };
}

/** `remove_colour`'s colour (or the point it's sampled at), tolerance, limits and protected colour. */
export function eraseRequest(input: Input): { sample: Colour8 | null; point: { x: number; y: number } | null; options: BackgroundEraserOptions; protect: Colour8 | null } {
  const sample = input.colour === undefined || input.colour === null ? null : colour(input.colour, "colour");
  const at = input.point === undefined || input.point === null ? null : point(input.point, "point");
  if (!sample && !at) throw new Error('Give the colour to remove ("colour": "#ffffff"), or a point on it to sample ("point": [x, y]): e.g. a corner of the background.');
  const limits = LIMITS[oneOf(input.limits, "limits", ["contiguous", "discontiguous", "find_edges"] as const, at ? "contiguous" : "discontiguous")];
  if (limits !== "discontiguous" && !at) throw new Error(`limits ${input.limits} floods from a point: give "point": [x, y] on the background, or use limits "discontiguous".`);
  const options: BackgroundEraserOptions = { sampling: "once", limits, tolerance: percent(input.tolerance, "tolerance", 50, 0), protectForeground: input.protect !== undefined && input.protect !== null };
  return { sample, point: at, options, protect: options.protectForeground ? colour(input.protect, "protect") : null };
}

/**
 * Where a call acts: a box (canvas pixels, feathered), or the selection there, or (null) the whole layer. A box off
 * the canvas is a mistake worth saying.
 */
export function regionOf(input: Input, selection: PhotoSelection | null, canvas: Size): PhotoSelection | null {
  const box = input.box;
  if (box === undefined || box === null) return selection;
  const b = box as Record<string, unknown>;
  const nums = ["x", "y", "width", "height"].map((k) => b[k]);
  if (typeof box !== "object" || !nums.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("box must be { x, y, width, height } in canvas pixels.");
  const [x, y, width, height] = nums as number[];
  const shape = rectSelection({ x, y }, { x: x + width, y: y + height }, canvas);
  if (!shape) throw new Error(`That box is off the canvas (${canvas.width}×${canvas.height} px).`);
  const feather = input.feather;
  if (feather === undefined || feather === null || feather === 0) return shape;
  if (typeof feather !== "number" || !(feather > 0) || feather > 250) throw new Error("feather must be 0..250 pixels.");
  return featherSelection(shape, feather, canvas);
}

/** Why a layer can't take the call (null: it can). */
export function effectLayerError(layer: PhotoLayer, part: SurfacePart, verb: "tone" | "erase"): string | null {
  if (!layer.visible) return `"${layer.name}" is hidden: show it first (set_layer visible: true).`;
  if (part === "mask") {
    if (verb === "erase") return "remove_colour erases a layer's pixels, not its mask.";
    return layer.mask ? null : `"${layer.name}" has no mask: add one with add_mask, or tone its pixels (target: content).`;
  }
  if (layer.kind === "pixel") return null;
  if (layer.kind === "adjustment") return `"${layer.name}" is an adjustment layer: it has no pixels to ${verb}${verb === "tone" ? " (tone its mask: target: mask)" : ""}.`;
  return `"${layer.name}" is a ${layer.kind === "image" ? "placed image" : "generated layer"}, kept whole: pass convert: true to make it pixels first (it can't be scaled losslessly after; say so to the user)${verb === "tone" ? ", or use an adjustment layer (add_adjustment) for a non-destructive change" : ""}.`;
}
