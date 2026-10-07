/**
 * The assistant's shape tools (`add_shape`, `set_shape`: docs/photo/tools/shapes.md), pure edits as `tool-edits.ts`'s
 * are. Everything is in canvas pixels: a rectangle's or an ellipse's box (x, y its top-left), a line's or an arrow's
 * ends, so boxing something or pointing an arrow at it is one call. Errors say what's wrong and what's allowed.
 */
import { createId } from "@shared/ids";
import { describeShapeLines } from "@shared/photo/shape-describe";
import {
  ARROWHEADS,
  MAX_STROKE_WIDTH,
  type NewShape,
  SHAPE_KINDS,
  addShapeLayer,
  makeShapeLayer,
  normalizePaint,
  placedShape,
  setShapeLayer,
  shapeKind,
  withPlacedBox,
  withPlacedLine,
} from "@shared/photo/shapes";
import type { Arrowhead, PhotoProject, ShapeLayer, ShapePaint } from "@shared/photo/types";
import { type PhotoEdit, type PhotoEditEnv, findLayerRef } from "./tool-edits";

type Input = Record<string, unknown>;

/** What the shape tools know besides the document: the user's foreground colour (a new shape's stroke by default). */
export interface ShapeEditEnv extends PhotoEditEnv {
  foreground?: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function point(v: unknown, key: string): { x: number; y: number } | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n))) return { x: v[0], y: v[1] };
  if (v && typeof v === "object" && num((v as Input).x) !== undefined && num((v as Input).y) !== undefined) return { x: (v as Input).x as number, y: (v as Input).y as number };
  throw new Error(`${key} must be a point [x, y] in canvas pixels, like [120, 340].`);
}

function choice<T extends string | number>(v: unknown, options: readonly T[], key: string): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (options.includes(v as T)) return v as T;
  throw new Error(`${key} must be one of ${options.join(", ")}.`);
}

/** A colour, or "none" (null), or undefined when not given. */
function colour(v: unknown, key: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "none" || v === "transparent") return null;
  if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v)) return `#${v.replace("#", "").toLowerCase()}`;
  throw new Error(`${key} must be a colour "#rrggbb" or "none".`);
}

const SLOPPINESS: Record<string, 0 | 1 | 2> = { precise: 0, artist: 1, cartoonist: 2, "0": 0, "1": 1, "2": 2 };

/** The paint fields given (checked), as a patch. */
function paintPatch(input: Input): Partial<ShapePaint> {
  const patch: Partial<ShapePaint> = {};
  const fill = colour(input.fill, "fill");
  if (fill !== undefined) patch.fill = fill;
  const stroke = colour(input.stroke, "stroke");
  if (stroke !== undefined) patch.stroke = stroke;
  const width = num(input.stroke_width);
  if (input.stroke_width !== undefined) {
    if (width === undefined || width < 0 || width > MAX_STROKE_WIDTH) throw new Error(`stroke_width must be 0 to ${MAX_STROKE_WIDTH} canvas pixels.`);
    patch.strokeWidth = width;
  }
  const dash = choice(input.dash, ["solid", "dashed", "dotted"] as const, "dash");
  if (dash) patch.dash = dash;
  const align = choice(input.stroke_align, ["inside", "centre", "outside"] as const, "stroke_align");
  if (align) patch.align = align;
  const cap = choice(input.cap, ["butt", "round", "square"] as const, "cap");
  if (cap) patch.cap = cap;
  const join = choice(input.join, ["miter", "round", "bevel"] as const, "join");
  if (join) patch.join = join;
  if (input.sloppiness !== undefined) {
    const s = SLOPPINESS[String(input.sloppiness)];
    if (s === undefined) throw new Error("sloppiness must be precise (0), artist (1) or cartoonist (2).");
    patch.sloppiness = s;
  }
  const fillStyle = choice(input.fill_style, ["solid", "hachure", "cross-hatch"] as const, "fill_style");
  if (fillStyle) patch.fillStyle = fillStyle;
  return patch;
}

/** A box given as x, y (top-left), width and height; undefined when none of them is. */
function boxOf(input: Input, current?: { x: number; y: number; width: number; height: number }) {
  const given = ["x", "y", "width", "height"].filter((k) => input[k] !== undefined);
  if (!given.length) return undefined;
  for (const k of given) if (num(input[k]) === undefined) throw new Error(`${k} must be a number of canvas pixels.`);
  const x = num(input.x) ?? current?.x;
  const y = num(input.y) ?? current?.y;
  const width = num(input.width) ?? current?.width;
  const height = num(input.height) ?? current?.height;
  if (x === undefined || y === undefined || width === undefined || height === undefined) throw new Error("A rectangle or an ellipse needs its box: x, y (its top-left corner), width and height, in canvas pixels.");
  if (width <= 0 || height <= 0) throw new Error("width and height must be more than 0.");
  return { x, y, width, height };
}

/** A stroke that reads at this canvas's size: a 150th of its shorter side, at least 4 px. */
export const defaultStrokeWidth = (canvas: { width: number; height: number }) => Math.max(4, Math.round(Math.min(canvas.width, canvas.height) / 150));

export const addShapeTool = (doc: PhotoProject, input: Input, env: ShapeEditEnv) => {
  const kind = choice(input.kind, SHAPE_KINDS, "kind");
  if (!kind) throw new Error(`kind is required: ${SHAPE_KINDS.join(", ")}.`);
  const line = kind === "line" || kind === "arrow";
  const shape: NewShape = { id: createId("layer"), kind, name: typeof input.name === "string" ? input.name : undefined };
  if (line) {
    const from = point(input.from, "from");
    const to = point(input.to, "to");
    if (!from || !to) throw new Error(`A ${kind} needs from and to: its ends [x, y] in canvas pixels (an arrow points at to).`);
    shape.from = from;
    shape.to = to;
    shape.bend = num(input.bend) ?? 0;
    shape.startHead = choice(input.start_head, ARROWHEADS, "start_head") ?? "none";
    shape.endHead = choice(input.end_head, ARROWHEADS, "end_head") ?? (kind === "arrow" ? "arrow" : "none");
  } else {
    const box = boxOf(input);
    if (!box) throw new Error(`A ${kind} needs its box: x, y (its top-left corner), width and height, in canvas pixels.`);
    shape.box = { x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height };
    if (input.radius !== undefined && num(input.radius) === undefined) throw new Error("radius must be a number of canvas pixels.");
    shape.radius = num(input.radius) ?? 0;
  }
  shape.paint = { stroke: env.foreground ?? "#000000", strokeWidth: defaultStrokeWidth(doc.canvas), ...paintPatch(input) };
  let layer = makeShapeLayer(doc, shape);
  const rotation = num(input.rotation);
  if (rotation !== undefined && !line) layer = { ...layer, transform: { ...layer.transform, rotation } };
  const opacity = num(input.opacity);
  if (opacity !== undefined) layer = { ...layer, opacity: Math.max(0, Math.min(1, opacity)) };
  const above = input.above === undefined ? null : findLayerRef(doc, input.above).id;
  const next = addShapeLayer(doc, layer, above);
  return { doc: next, layerId: layer.id, text: `Added ${kind} layer ${layer.id} "${layer.name}"${above ? ` above "${findLayerRef(doc, above).name}"` : " on top"}.\n${describeShapeLines(layer).join("\n")}` };
};

export const setShapeTool: PhotoEdit = (doc, input) => {
  const found = findLayerRef(doc, input.layer);
  if (found.kind !== "shape") throw new Error(`"${found.name}" is a ${found.kind} layer, not a shape: set_shape changes shape layers (add_shape makes one).`);
  let layer: ShapeLayer = found;
  const p = placedShape(layer);
  // A rectangle becomes an ellipse and back; a line an arrow and back (its heads).
  const kind = choice(input.kind, SHAPE_KINDS, "kind");
  if (kind && (kind === "line" || kind === "arrow") !== (p.type === "line")) throw new Error(`A ${shapeKind(layer)} can't become a ${kind}: make a new one with add_shape (and remove this one).`);
  if (kind === "rectangle" && layer.shape.type !== "rect") layer = { ...layer, shape: { type: "rect", radius: 0 } };
  if (kind === "ellipse" && layer.shape.type !== "ellipse") layer = { ...layer, shape: { type: "ellipse" } };
  if (p.type === "line") {
    for (const k of ["x", "y", "width", "height", "radius", "rotation"]) if (input[k] !== undefined) throw new Error(`A ${shapeKind(layer)} has no ${k}: give from, to and bend (canvas pixels).`);
    const from = point(input.from, "from") ?? p.from;
    const to = point(input.to, "to") ?? p.to;
    const bend = num(input.bend) ?? p.bend;
    if (input.from !== undefined || input.to !== undefined || input.bend !== undefined) layer = withPlacedLine(layer, from, to, bend);
    if (layer.shape.type === "line") {
      let startHead: Arrowhead = choice(input.start_head, ARROWHEADS, "start_head") ?? layer.shape.startHead;
      let endHead: Arrowhead = choice(input.end_head, ARROWHEADS, "end_head") ?? layer.shape.endHead;
      if (kind === "line") [startHead, endHead] = ["none", "none"];
      if (kind === "arrow" && startHead === "none" && endHead === "none") endHead = "arrow";
      if (startHead !== layer.shape.startHead || endHead !== layer.shape.endHead) layer = { ...layer, shape: { ...layer.shape, startHead, endHead } };
    }
  } else {
    for (const k of ["from", "to", "bend", "start_head", "end_head"]) if (input[k] !== undefined) throw new Error(`A ${shapeKind(layer)} has no ${k}: give x, y, width, height (its box), radius or rotation.`);
    const box = boxOf(input, { x: p.cx - p.width / 2, y: p.cy - p.height / 2, width: p.width, height: p.height });
    const rotation = num(input.rotation);
    if (box || rotation !== undefined) layer = withPlacedBox(layer, box ? { cx: box.x + box.width / 2, cy: box.y + box.height / 2, width: box.width, height: box.height, rotation } : { cx: p.cx, cy: p.cy, width: p.width, height: p.height, rotation });
    if (input.radius !== undefined) {
      if (layer.shape.type !== "rect") throw new Error("Only a rectangle has a corner radius.");
      const radius = num(input.radius);
      if (radius === undefined || radius < 0) throw new Error("radius must be 0 or more canvas pixels.");
      layer = { ...layer, shape: { type: "rect", radius } };
    }
  }
  const patch = paintPatch(input);
  if (Object.keys(patch).length) layer = { ...layer, paint: normalizePaint({ ...layer.paint, ...patch }) };
  const opacity = num(input.opacity);
  if (opacity !== undefined) layer = { ...layer, opacity: Math.max(0, Math.min(1, opacity)) };
  if (typeof input.name === "string" && input.name.trim()) layer = { ...layer, name: input.name.trim().slice(0, 200) };
  const next = setShapeLayer(doc, layer);
  const text = next === doc ? `"${layer.name}" is already like that.` : `Changed "${layer.name}".`;
  return { doc: next, layerId: layer.id, text: `${text}\n${describeShapeLines(layer).join("\n")}` };
};
