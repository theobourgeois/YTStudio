/**
 * The shape tools' options (docs/photo/tools/shapes.md, "The options bar"), kept in this browser as Photoshop keeps a
 * tool's: what a new shape is painted with. Fill and stroke are none, the foreground colour (following the tool
 * strip's swatch) or a colour of their own. Pure helpers say what a new shape gets, and what an option's change does
 * to shapes that are selected.
 */
import { create } from "zustand";
import { ARROWHEADS, DEFAULT_PAINT, MAX_STROKE_WIDTH } from "@shared/photo/shapes";
import type { Arrowhead, ShapePaint } from "@shared/photo/types";

const storage: Pick<Storage, "getItem" | "setItem"> = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
const KEY = "photo-shape-options";

/** A fill's or a stroke's colour: none, the foreground colour, or "#rrggbb". */
export type PaintChoice = "none" | "foreground" | string;

export interface ShapeOptions extends Omit<ShapePaint, "fill" | "stroke"> {
  fill: PaintChoice;
  stroke: PaintChoice;
  /** A new rectangle's corner radius. */
  radius: number;
  /** A new arrow's heads (the Line tool draws none). */
  startHead: Arrowhead;
  endHead: Arrowhead;
}

export const DEFAULT_OPTIONS: ShapeOptions = { ...DEFAULT_PAINT, fill: "none", stroke: "foreground", radius: 0, startHead: "none", endHead: "arrow" };

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const choice = (v: unknown, fallback: PaintChoice): PaintChoice => (v === "none" || v === "foreground" ? v : isHex(v) ? v.toLowerCase() : fallback);
const pick = <T>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const number = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

export function sanitizeOptions(o: Partial<Record<keyof ShapeOptions, unknown>>): ShapeOptions {
  const d = DEFAULT_OPTIONS;
  return {
    fill: choice(o.fill, d.fill),
    stroke: choice(o.stroke, d.stroke),
    strokeWidth: number(o.strokeWidth, 0, MAX_STROKE_WIDTH, d.strokeWidth),
    dash: pick(o.dash, ["solid", "dashed", "dotted"] as const, d.dash),
    align: pick(o.align, ["inside", "centre", "outside"] as const, d.align),
    cap: pick(o.cap, ["butt", "round", "square"] as const, d.cap),
    join: pick(o.join, ["miter", "round", "bevel"] as const, d.join),
    sloppiness: pick(o.sloppiness, [0, 1, 2] as const, d.sloppiness),
    fillStyle: pick(o.fillStyle, ["solid", "hachure", "cross-hatch"] as const, d.fillStyle),
    radius: number(o.radius, 0, 100_000, d.radius),
    startHead: pick(o.startHead, ARROWHEADS, d.startHead),
    endHead: pick(o.endHead, ARROWHEADS, d.endHead),
  };
}

/** A choice as the document holds it: a colour, or null for none. */
export const resolveChoice = (c: PaintChoice, foreground: string): string | null => (c === "none" ? null : c === "foreground" ? foreground : c);

/** The paint a new shape gets from the options. */
export function paintOf(o: ShapeOptions, foreground: string): ShapePaint {
  const { fill, stroke, strokeWidth, dash, align, cap, join, sloppiness, fillStyle } = o;
  return { fill: resolveChoice(fill, foreground), stroke: resolveChoice(stroke, foreground), strokeWidth, dash, align, cap, join, sloppiness, fillStyle };
}

/** What an options change does to selected shapes: the paint fields and geometry it sets (colours resolved). */
export function patchOf(patch: Partial<ShapeOptions>, foreground: string): { paint: Partial<ShapePaint>; geometry: { radius?: number; startHead?: Arrowhead; endHead?: Arrowhead } } {
  const { fill, stroke, radius, startHead, endHead, ...rest } = patch;
  const paint: Partial<ShapePaint> = { ...rest };
  if (fill !== undefined) paint.fill = resolveChoice(fill, foreground);
  if (stroke !== undefined) paint.stroke = resolveChoice(stroke, foreground);
  const geometry: { radius?: number; startHead?: Arrowhead; endHead?: Arrowhead } = {};
  if (radius !== undefined) geometry.radius = radius;
  if (startHead !== undefined) geometry.startHead = startHead;
  if (endHead !== undefined) geometry.endHead = endHead;
  return { paint, geometry };
}

function load(): ShapeOptions {
  try {
    return sanitizeOptions(JSON.parse(storage.getItem(KEY) ?? "{}") as Partial<ShapeOptions>);
  } catch {
    return DEFAULT_OPTIONS;
  }
}

interface ShapeOptionsStore extends ShapeOptions {
  set: (patch: Partial<ShapeOptions>) => void;
}

export const useShapeOptions = create<ShapeOptionsStore>((set, get) => ({
  ...load(),
  set: (patch) => {
    const { set: _set, ...now } = get();
    const next = sanitizeOptions({ ...now, ...patch });
    storage.setItem(KEY, JSON.stringify(next));
    set(next);
  },
}));
