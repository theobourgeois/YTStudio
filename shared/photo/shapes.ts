/**
 * Shape layers (docs/photo/tools/shapes.md): making them, checking them, and editing them, pure. A shape's geometry
 * is in its own box (`size`), placed by its transform like an image; `placedShape` says where it is on the canvas
 * (what the drawing, the handles, the hit test and the assistant read), and `withPlacedBox` / `withPlacedLine` make
 * a layer's geometry again from canvas numbers (the box's scale baked back in: its numbers stay its pixel size).
 */
import { normalizeTransform, withoutPerspective, wrapDegrees } from "./project.ts";
import { apply, layerMatrix } from "./layers.ts";
import type { Arrowhead, DocPoint, LayerTransform, PhotoProject, ShapeGeometry, ShapeLayer, ShapePaint } from "./types.ts";

/** The shape tools' kinds: what a layer is called and what the Arrow tool adds to a line. */
export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export const SHAPE_KINDS: readonly ShapeKind[] = ["rectangle", "ellipse", "line", "arrow"];

export const SHAPE_NAMES: Record<ShapeKind, string> = { rectangle: "Rectangle", ellipse: "Ellipse", line: "Line", arrow: "Arrow" };

export const ARROWHEADS: readonly Arrowhead[] = ["none", "arrow", "triangle", "circle", "bar", "diamond"];

export const MAX_STROKE_WIDTH = 1000;
/** A shape's box side, in its own pixels: at least 1 (a line's box is never empty), at most a million. */
const MIN_SIDE = 1;
const MAX_SIDE = 1e6;

/** A new shape's paint: outlined in black, 8 px, no fill (annotations are outlines), precise. */
export const DEFAULT_PAINT: ShapePaint = {
  fill: null,
  stroke: "#000000",
  strokeWidth: 8,
  dash: "solid",
  align: "centre",
  cap: "round",
  join: "miter",
  sloppiness: 0,
  fillStyle: "solid",
};

/** What kind a layer is, for its name and the tools: a line with a head is an arrow. */
export function shapeKind(layer: ShapeLayer): ShapeKind {
  const s = layer.shape;
  if (s.type === "rect") return "rectangle";
  if (s.type === "ellipse") return "ellipse";
  return s.startHead !== "none" || s.endHead !== "none" ? "arrow" : "line";
}

// --- checking ---

const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const colourOr = (v: unknown, fallback: string | null): string | null => (v === null ? null : typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const point = (v: unknown, fallback: DocPoint): DocPoint =>
  Array.isArray(v) && v.length === 2 ? [clamp(finite(v[0], fallback[0]), -MAX_SIDE, MAX_SIDE), clamp(finite(v[1], fallback[1]), -MAX_SIDE, MAX_SIDE)] : fallback;

/** A paint checked: every field kept when it's valid, else its default. */
export function normalizePaint(value: unknown): ShapePaint {
  const p = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_PAINT;
  return {
    fill: colourOr(p.fill, d.fill),
    stroke: colourOr(p.stroke, d.stroke),
    strokeWidth: clamp(finite(p.strokeWidth, d.strokeWidth), 0, MAX_STROKE_WIDTH),
    dash: oneOf(p.dash, ["solid", "dashed", "dotted"] as const, d.dash),
    align: oneOf(p.align, ["inside", "centre", "outside"] as const, d.align),
    cap: oneOf(p.cap, ["butt", "round", "square"] as const, d.cap),
    join: oneOf(p.join, ["miter", "round", "bevel"] as const, d.join),
    sloppiness: oneOf(p.sloppiness, [0, 1, 2] as const, d.sloppiness),
    fillStyle: oneOf(p.fillStyle, ["solid", "hachure", "cross-hatch"] as const, d.fillStyle),
  };
}

/** A geometry checked, or null when it isn't one (its layer is then left out). */
export function normalizeGeometry(value: unknown, size: { width: number; height: number }): ShapeGeometry | null {
  if (!value || typeof value !== "object") return null;
  const g = value as Record<string, unknown>;
  if (g.type === "rect") return { type: "rect", radius: clamp(finite(g.radius, 0), 0, MAX_SIDE) };
  if (g.type === "ellipse") return { type: "ellipse" };
  if (g.type === "line") {
    return {
      type: "line",
      from: point(g.from, [0, size.height / 2]),
      to: point(g.to, [size.width, size.height / 2]),
      bend: clamp(finite(g.bend, 0), -MAX_SIDE, MAX_SIDE),
      startHead: oneOf(g.startHead, ARROWHEADS, "none"),
      endHead: oneOf(g.endHead, ARROWHEADS, "none"),
    };
  }
  return null;
}

/**
 * A shape layer's own fields checked (`l` is the untrusted layer): its geometry, box, transform and paint. Null when
 * it has no geometry this app knows (the caller reports it and leaves it out).
 */
export function normalizeShapeFields(l: Record<string, unknown>): Pick<ShapeLayer, "shape" | "size" | "transform" | "paint"> | null {
  const s = (l.size && typeof l.size === "object" ? l.size : {}) as Record<string, unknown>;
  const size = { width: clamp(finite(s.width, 100), MIN_SIDE, MAX_SIDE), height: clamp(finite(s.height, 100), MIN_SIDE, MAX_SIDE) };
  const shape = normalizeGeometry(l.shape, size);
  if (!shape) return null;
  return { shape, size, transform: withoutPerspective(normalizeTransform(l.transform, { x: size.width / 2, y: size.height / 2 })), paint: normalizePaint(l.paint) };
}

// --- where it is ---

export interface Point {
  x: number;
  y: number;
}

/** A shape as it is on the canvas (document pixels): a box (centre, size, turn) or a line (ends, and its curve's control point). */
export type PlacedShape =
  | { type: "rect" | "ellipse"; cx: number; cy: number; width: number; height: number; rotation: number; radius: number }
  | { type: "line"; from: Point; to: Point; control: Point | null; bend: number; startHead: Arrowhead; endHead: Arrowhead };

/** Where a line's curve is pulled to (its own pixels): the quadratic's control point, twice the bend from the chord's middle. */
function ownControl(from: DocPoint, to: DocPoint, bend: number): Point | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (!bend || !length) return null;
  // To the left going from `from` to `to` (y down: the left of (1, 0) is (0, −1)).
  return { x: (from[0] + to[0]) / 2 + (dy / length) * 2 * bend, y: (from[1] + to[1]) / 2 - (dx / length) * 2 * bend };
}

export function placedShape(layer: Pick<ShapeLayer, "shape" | "size" | "transform">): PlacedShape {
  const t = layer.transform;
  const s = layer.shape;
  if (s.type !== "line") {
    return { type: s.type, cx: t.x, cy: t.y, width: layer.size.width * Math.abs(t.scaleX), height: layer.size.height * Math.abs(t.scaleY), rotation: t.rotation, radius: s.type === "rect" ? s.radius : 0 };
  }
  const m = layerMatrix(t, layer.size);
  const control = ownControl(s.from, s.to, s.bend);
  const from = apply(m, s.from[0], s.from[1]);
  const to = apply(m, s.to[0], s.to[1]);
  const c = control ? apply(m, control.x, control.y) : null;
  // The bend as it shows: the curve's middle from the chord's, to the left.
  let bend = 0;
  if (c) {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    bend = (((to.y - from.y) / length) * (c.x - (from.x + to.x) / 2) - ((to.x - from.x) / length) * (c.y - (from.y + to.y) / 2)) / 2;
  }
  return { type: "line", from, to, control: c, bend, startHead: s.startHead, endHead: s.endHead };
}

/** The layer's box (rect, ellipse) at these canvas numbers, its scale baked into its size (mirroring kept). */
export function withPlacedBox(layer: ShapeLayer, box: { cx: number; cy: number; width: number; height: number; rotation?: number }): ShapeLayer {
  const t = layer.transform;
  const transform: LayerTransform = { x: box.cx, y: box.cy, scaleX: Math.sign(t.scaleX) || 1, scaleY: Math.sign(t.scaleY) || 1, rotation: wrapDegrees(box.rotation ?? t.rotation) };
  const size = { width: clamp(Math.abs(box.width), MIN_SIDE, MAX_SIDE), height: clamp(Math.abs(box.height), MIN_SIDE, MAX_SIDE) };
  return { ...layer, size, transform };
}

/** A line's geometry and place for these canvas ends and bend: upright at 100%, its box the one around its ends. */
export function lineGeometry(from: Point, to: Point, bend: number, heads: { startHead: Arrowhead; endHead: Arrowhead }): Pick<ShapeLayer, "shape" | "size" | "transform"> {
  let x0 = Math.min(from.x, to.x);
  let y0 = Math.min(from.y, to.y);
  let width = Math.abs(to.x - from.x);
  let height = Math.abs(to.y - from.y);
  // A level or upright line still has a box a pixel across, its ends in its middle.
  if (width < MIN_SIDE) {
    x0 -= (MIN_SIDE - width) / 2;
    width = MIN_SIDE;
  }
  if (height < MIN_SIDE) {
    y0 -= (MIN_SIDE - height) / 2;
    height = MIN_SIDE;
  }
  return {
    shape: { type: "line", from: [from.x - x0, from.y - y0], to: [to.x - x0, to.y - y0], bend, startHead: heads.startHead, endHead: heads.endHead },
    size: { width, height },
    transform: { x: x0 + width / 2, y: y0 + height / 2, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

/** A line layer with its ends (and bend) here on the canvas. */
export function withPlacedLine(layer: ShapeLayer, from: Point, to: Point, bend?: number): ShapeLayer {
  if (layer.shape.type !== "line") return layer;
  const placed = placedShape(layer) as Extract<PlacedShape, { type: "line" }>;
  return { ...layer, ...lineGeometry(from, to, bend ?? placed.bend, { startHead: layer.shape.startHead, endHead: layer.shape.endHead }) };
}

// --- making ---

export interface NewShape {
  id: string;
  kind: ShapeKind;
  /** A rectangle's or an ellipse's box on the canvas (x0, y0 its top-left). */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** A line's or an arrow's ends on the canvas. */
  from?: Point;
  to?: Point;
  bend?: number;
  startHead?: Arrowhead;
  endHead?: Arrowhead;
  radius?: number;
  paint?: Partial<ShapePaint>;
  name?: string;
}

/** The next free name for a kind: "Rectangle", then "Rectangle 2"… (Photoshop's "Rectangle 1" without the 1). */
export function nextShapeName(doc: PhotoProject, kind: ShapeKind): string {
  const base = SHAPE_NAMES[kind];
  const taken = new Set(doc.layers.map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A shape layer from canvas numbers (a drag's, the assistant's). */
export function makeShapeLayer(doc: PhotoProject, shape: NewShape): ShapeLayer {
  const paint = normalizePaint({ ...DEFAULT_PAINT, ...shape.paint });
  const common = { id: shape.id, kind: "shape" as const, name: shape.name?.trim() || nextShapeName(doc, shape.kind), visible: true, opacity: 1, paint };
  if (shape.kind === "line" || shape.kind === "arrow") {
    const from = shape.from ?? { x: 0, y: 0 };
    const to = shape.to ?? { x: from.x + 100, y: from.y };
    const heads = { startHead: shape.startHead ?? "none", endHead: shape.endHead ?? (shape.kind === "arrow" ? "arrow" : "none") };
    return { ...common, ...lineGeometry(from, to, shape.bend ?? 0, heads) };
  }
  const b = shape.box ?? { x0: 0, y0: 0, x1: 100, y1: 100 };
  const width = clamp(Math.abs(b.x1 - b.x0), MIN_SIDE, MAX_SIDE);
  const height = clamp(Math.abs(b.y1 - b.y0), MIN_SIDE, MAX_SIDE);
  return {
    ...common,
    shape: shape.kind === "rectangle" ? { type: "rect", radius: Math.max(0, shape.radius ?? 0) } : { type: "ellipse" },
    size: { width, height },
    transform: { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, scaleX: 1, scaleY: 1, rotation: 0 },
  };
}

/** Adds a shape layer above `above` (the active layer), or on top. */
export function addShapeLayer(doc: PhotoProject, layer: ShapeLayer, above?: string | null): PhotoProject {
  if (doc.layers.some((l) => l.id === layer.id)) return doc;
  const layers = [...doc.layers];
  const at = above ? layers.findIndex((l) => l.id === above) : -1;
  layers.splice(at >= 0 ? at + 1 : layers.length, 0, layer);
  return { ...doc, layers };
}

// --- editing ---

const samePaint = (a: ShapePaint, b: ShapePaint) => (Object.keys(a) as (keyof ShapePaint)[]).every((k) => a[k] === b[k]);

/**
 * The paint of every shape layer among `ids` patched (others untouched). `heads` and `radius` apply to the lines
 * and rectangles among them. The same document when nothing changes.
 */
export function restyleShapes(
  doc: PhotoProject,
  ids: readonly string[],
  patch: Partial<ShapePaint>,
  geometry: { radius?: number; startHead?: Arrowhead; endHead?: Arrowhead } = {},
): PhotoProject {
  const wanted = new Set(ids);
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.kind !== "shape" || !wanted.has(l.id)) return l;
    const paint = normalizePaint({ ...l.paint, ...patch });
    let shape = l.shape;
    if (shape.type === "rect" && geometry.radius !== undefined && Number.isFinite(geometry.radius) && Math.max(0, geometry.radius) !== shape.radius) shape = { ...shape, radius: Math.max(0, geometry.radius) };
    if (shape.type === "line") {
      const startHead = geometry.startHead ?? shape.startHead;
      const endHead = geometry.endHead ?? shape.endHead;
      if (startHead !== shape.startHead || endHead !== shape.endHead) shape = { ...shape, startHead, endHead };
    }
    if (samePaint(paint, l.paint) && shape === l.shape) return l;
    changed = true;
    return { ...l, paint, shape };
  });
  return changed ? { ...doc, layers } : doc;
}

/** A shape layer replaced by `next` (its geometry or place edited); the same document when it's the same. */
export function setShapeLayer(doc: PhotoProject, next: ShapeLayer): PhotoProject {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.id !== next.id || l.kind !== "shape" || l === next) return l;
    changed = true;
    return next;
  });
  return changed ? { ...doc, layers } : doc;
}

// --- drawing with the tools ---

/**
 * The box a drag draws from `start` to `end` (Photoshop's): Shift makes it a square (the longer side), Alt draws it
 * from `start` as its centre.
 */
export function dragBox(start: Point, end: Point, { square = false, fromCentre = false } = {}) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (Math.sign(dx) || 1) * side;
    dy = (Math.sign(dy) || 1) * side;
  }
  if (fromCentre) return { x0: start.x - Math.abs(dx), y0: start.y - Math.abs(dy), x1: start.x + Math.abs(dx), y1: start.y + Math.abs(dy) };
  return { x0: Math.min(start.x, start.x + dx), y0: Math.min(start.y, start.y + dy), x1: Math.max(start.x, start.x + dx), y1: Math.max(start.y, start.y + dy) };
}

/** A line's end as a drag puts it: with Shift, on the nearest multiple of 45° (the pointer's distance along it). */
export function dragLineEnd(start: Point, end: Point, snap45 = false): Point {
  if (!snap45) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  return { x: start.x + Math.cos(angle) * along, y: start.y + Math.sin(angle) * along };
}

/** A click's shape (Figma's way: a click is a shape of a default size, not a dialog): a fifth of the canvas's shorter side. */
export function clickedShape(kind: ShapeKind, at: Point, canvas: { width: number; height: number }): Pick<NewShape, "box" | "from" | "to"> {
  const side = Math.max(16, Math.round(Math.min(canvas.width, canvas.height) / 5));
  if (kind === "line" || kind === "arrow") return { from: at, to: { x: at.x + side * 1.25, y: at.y } };
  return { box: { x0: at.x - side / 2, y0: at.y - side / 2, x1: at.x + side / 2, y1: at.y + side / 2 } };
}

/** A drag shorter than this many screen pixels is a click. */
export const CLICK_TRAVEL = 3;

/** A 31-bit seed from a layer's id (never 0: rough.js's random would fall back to Math.random). */
export function shapeSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 1) % 2147483646 || 1;
}
