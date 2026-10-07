/**
 * What a shape layer draws (docs/photo/tools/shapes.md), pure: `shapeDrawing` turns its geometry and paint into
 * fills and strokes in document pixels (paths the 2D canvas plays: `render/shape-raster.ts`), hand-drawn through
 * `shape-rough.ts` when it's sloppy; `shapeRaster` says which of the document's tiles it touches (those wholly inside a
 * fill and touched by nothing else are constant) and the size of the surface it's shown as; `hitShape` says whether
 * a point is on what it draws. The same layer always draws the same thing (its randomness is seeded by its id).
 */
import { srgbToLinear } from "./colour.ts";
import { fromHalf, toHalf } from "./half.ts";
import { type PathCommand, type Pt, Random, type RoughOptions, hachure, roughEllipse, roughFillPolygon, roughPath } from "./shape-rough.ts";
import { type PlacedShape, type Point, placedShape, shapeSeed } from "./shapes.ts";
import type { Arrowhead, ShapeLayer, ShapePaint } from "./types.ts";

export type { PathCommand };

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FillItem {
  kind: "fill";
  path: PathCommand[];
  colour: string;
}

export interface StrokeItem {
  kind: "stroke";
  path: PathCommand[];
  colour: string;
  width: number;
  cap: ShapePaint["cap"];
  join: ShapePaint["join"];
  /** The canvas's dash pattern (empty: solid). */
  dash: number[];
  /** Drawn only inside (or outside) this outline: a stroke aligned inside or outside a closed shape. */
  clip: { path: PathCommand[]; outside: boolean } | null;
}

export type DrawItem = FillItem | StrokeItem;

export interface ShapeDrawing {
  /** In drawing order. */
  items: DrawItem[];
  /** The box around everything it draws (document pixels, strokes and miters included), or null when it draws nothing. */
  bounds: Box | null;
}

// --- outlines ---

/** A circle's quarter as a cubic: the control points' distance, as a fraction of the radius. */
const KAPPA = 0.5522847498;

/** A rectangle with rounded corners (`r`, clamped to half the shorter side), centred on 0, upright, clockwise from its top-left. */
function rectOutline(w: number, h: number, r: number): PathCommand[] {
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r < 1e-6) return [["M", x0, y0], ["L", x1, y0], ["L", x1, y1], ["L", x0, y1], ["Z"]];
  const k = r * (1 - KAPPA);
  return [
    ["M", x0 + r, y0],
    ["L", x1 - r, y0],
    ["C", x1 - k, y0, x1, y0 + k, x1, y0 + r],
    ["L", x1, y1 - r],
    ["C", x1, y1 - k, x1 - k, y1, x1 - r, y1],
    ["L", x0 + r, y1],
    ["C", x0 + k, y1, x0, y1 - k, x0, y1 - r],
    ["L", x0, y0 + r],
    ["C", x0, y0 + k, x0 + k, y0, x0 + r, y0],
    ["Z"],
  ];
}

/** An ellipse centred on 0, upright: four cubics from its top, clockwise. */
function ellipseOutline(w: number, h: number): PathCommand[] {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", 0, -ry],
    ["C", kx, -ry, rx, -ky, rx, 0],
    ["C", rx, ky, kx, ry, 0, ry],
    ["C", -kx, ry, -rx, ky, -rx, 0],
    ["C", -rx, -ky, -kx, -ry, 0, -ry],
    ["Z"],
  ];
}

/** A path's points through `f` (an affine map keeps cubics cubics). */
function mapPath(path: readonly PathCommand[], f: (p: Pt) => Pt): PathCommand[] {
  return path.map((c): PathCommand => {
    if (c[0] === "Z") return c;
    if (c[0] === "C") {
      const [a, b, d] = [f([c[1], c[2]]), f([c[3], c[4]]), f([c[5], c[6]])];
      return ["C", a[0], a[1], b[0], b[1], d[0], d[1]];
    }
    const p = f([c[1], c[2]]);
    return [c[0], p[0], p[1]];
  });
}

/** A box's own coordinates (centred on 0, upright) on the canvas. */
function boxPlacer(p: Extract<PlacedShape, { type: "rect" | "ellipse" }>): (q: Pt) => Pt {
  const a = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return ([x, y]) => [p.cx + x * cos - y * sin, p.cy + x * sin + y * cos];
}

/** A path as polylines (each subpath; cubics in `steps` pieces). */
export function flatten(path: readonly PathCommand[], steps = 16): Pt[][] {
  const out: Pt[][] = [];
  let current: Pt[] = [];
  let at: Pt = [0, 0];
  let start: Pt = [0, 0];
  for (const c of path) {
    if (c[0] === "M") {
      if (current.length > 1) out.push(current);
      at = [c[1], c[2]];
      start = at;
      current = [at];
    } else if (c[0] === "L") {
      at = [c[1], c[2]];
      current.push(at);
    } else if (c[0] === "C") {
      const [x0, y0] = at;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        current.push([u * u * u * x0 + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * y0 + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]]);
      }
      at = [c[5], c[6]];
    } else {
      current.push(start);
      at = start;
    }
  }
  if (current.length > 1) out.push(current);
  return out;
}

// --- lines ---

/** A line's curve: straight, or a quadratic through its control point. */
interface LineCurve {
  p0: Pt;
  q: Pt | null;
  p1: Pt;
}

const curveAt = (c: LineCurve, t: number): Pt => {
  if (!c.q) return [c.p0[0] + (c.p1[0] - c.p0[0]) * t, c.p0[1] + (c.p1[1] - c.p0[1]) * t];
  const u = 1 - t;
  return [u * u * c.p0[0] + 2 * u * t * c.q[0] + t * t * c.p1[0], u * u * c.p0[1] + 2 * u * t * c.q[1] + t * t * c.p1[1]];
};

/** The curve's points at even steps of t, and the length along it at each. */
function measure(c: LineCurve, steps = 64): { pts: Pt[]; along: number[] } {
  const pts: Pt[] = [];
  const along: number[] = [];
  let total = 0;
  for (let i = 0; i <= steps; i++) {
    const p = curveAt(c, i / steps);
    if (i) total += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    pts.push(p);
    along.push(total);
  }
  return { pts, along };
}

/** The t at distance `d` along the curve (from its start). */
function tAt(m: { along: number[] }, d: number): number {
  const { along } = m;
  const steps = along.length - 1;
  if (d <= 0) return 0;
  if (d >= along[steps]) return 1;
  let i = 1;
  while (along[i] < d) i++;
  const f = (d - along[i - 1]) / (along[i] - along[i - 1] || 1);
  return (i - 1 + f) / steps;
}

/** The curve between t0 and t1 as a path (a quadratic's piece is a quadratic: its control point by blossoming). */
function curvePiece(c: LineCurve, t0: number, t1: number): PathCommand[] {
  const a = curveAt(c, t0);
  const b = curveAt(c, t1);
  if (!c.q) return [["M", a[0], a[1]], ["L", b[0], b[1]]];
  const w0 = (1 - t0) * (1 - t1);
  const w1 = (1 - t0) * t1 + t0 * (1 - t1);
  const w2 = t0 * t1;
  const q: Pt = [w0 * c.p0[0] + w1 * c.q[0] + w2 * c.p1[0], w0 * c.p0[1] + w1 * c.q[1] + w2 * c.p1[1]];
  return [["M", a[0], a[1]], ["C", a[0] + (2 / 3) * (q[0] - a[0]), a[1] + (2 / 3) * (q[1] - a[1]), b[0] + (2 / 3) * (q[0] - b[0]), b[1] + (2 / 3) * (q[1] - b[1]), b[0], b[1]]];
}

/** An arrowhead's length for a stroke this wide (Excalidraw's 25 px at its widths, growing with the stroke), at most `cap`. */
export const headLength = (width: number, cap: number) => Math.min(3 * width + 14, cap);

/** How far back from its tip a head's line stops (so its cap doesn't poke through a filled head). */
function headTrim(head: Arrowhead, length: number): number {
  if (head === "triangle") return length * 0.8;
  if (head === "diamond") return length * 0.7;
  return 0;
}

/** A head at `tip`, pointing along `d` (unit), `length` long, for a stroke `width` wide. */
function headItems(head: Arrowhead, tip: Pt, d: Pt, length: number, paint: ShapePaint, colour: string, width: number, rough: RoughOptions | null): DrawItem[] {
  const n: Pt = [-d[1], d[0]];
  const at = (back: number, side: number): Pt => [tip[0] - d[0] * back + n[0] * side, tip[1] - d[1] * back + n[1] * side];
  // Heads are solid even on a dashed line (Excalidraw's).
  const stroke = (path: PathCommand[], join: ShapePaint["join"] = paint.join): StrokeItem => ({ kind: "stroke", path, colour, width, cap: rough ? "round" : paint.cap, join: rough ? "round" : join, dash: [], clip: null });
  const polygon = (pts: Pt[]): PathCommand[] => [["M", pts[0][0], pts[0][1]], ...pts.slice(1).map((p): PathCommand => ["L", p[0], p[1]]), ["Z"]];
  const roughly = (path: PathCommand[]) => (rough ? roughPath(path, { ...rough, roughness: Math.min(1, rough.roughness) }) : path);
  switch (head) {
    case "arrow": {
      const a = (25 * Math.PI) / 180;
      const back = Math.cos(a) * length;
      const side = Math.sin(a) * length;
      const [l, r] = [at(back, side), at(back, -side)];
      if (rough) return [stroke(roughly([["M", l[0], l[1]], ["L", tip[0], tip[1]], ["M", r[0], r[1]], ["L", tip[0], tip[1]]]), "round")];
      return [stroke([["M", l[0], l[1]], ["L", tip[0], tip[1]], ["L", r[0], r[1]]])];
    }
    case "triangle":
    case "diamond": {
      const pts = head === "triangle" ? [tip, at(length, length * 0.5), at(length, -length * 0.5)] : [tip, at(length * 0.5, length * 0.3), at(length, 0), at(length * 0.5, -length * 0.3)];
      const outline = polygon(pts);
      return [{ kind: "fill", path: rough ? roughFillPolygon(pts, { ...rough, roughness: Math.min(1, rough.roughness) }) : outline, colour }, stroke(roughly(outline), "miter")];
    }
    case "circle": {
      const r = Math.max(width * 1.4 + 3, length * 0.3);
      const k = r * KAPPA;
      const [cx, cy] = tip;
      const circle: PathCommand[] = [
        ["M", cx, cy - r],
        ["C", cx + k, cy - r, cx + r, cy - k, cx + r, cy],
        ["C", cx + r, cy + k, cx + k, cy + r, cx, cy + r],
        ["C", cx - k, cy + r, cx - r, cy + k, cx - r, cy],
        ["C", cx - r, cy - k, cx - k, cy - r, cx, cy - r],
        ["Z"],
      ];
      return [{ kind: "fill", path: circle, colour }];
    }
    case "bar": {
      const half = Math.max(length * 0.45, width * 2);
      const [l, r] = [at(0, half), at(0, -half)];
      return [stroke(roughly([["M", l[0], l[1]], ["L", r[0], r[1]]]))];
    }
    default:
      return [];
  }
}

/** The dash pattern for a stroke this wide: dashes and gaps as they show, whatever the cap adds. */
function dashFor(paint: ShapePaint, width: number): { dash: number[]; cap: ShapePaint["cap"] } {
  if (paint.dash === "dotted") return { dash: [0, 2 * width + 4], cap: "round" };
  if (paint.dash === "dashed") {
    const capped = paint.cap === "butt" ? 0 : width;
    return { dash: [Math.max(0.5, 3 * width + 6 - capped), 2 * width + 6 + capped], cap: paint.cap };
  }
  return { dash: [], cap: paint.cap };
}

// --- the drawing ---

/** rough.js's options for this layer (Excalidraw's): its offsets scaled with the stroke, so a thick shape wobbles as much. */
function roughOptionsOf(layer: ShapeLayer, placed: PlacedShape): RoughOptions | null {
  const p = layer.paint;
  if (!p.sloppiness) return null;
  const scale = Math.max(1, p.strokeWidth / 3);
  // Excalidraw's adjustRoughness: small shapes wobble less.
  const [w, h] = placed.type === "line" ? [Math.abs(placed.to.x - placed.from.x), Math.abs(placed.to.y - placed.from.y)] : [placed.width, placed.height];
  const min = Math.min(w, h) / scale;
  const max = Math.max(w, h) / scale;
  const keep = (min >= 20 && max >= 50) || (placed.type === "line" && max >= 50) || (placed.type === "rect" && placed.radius > 0 && min >= 15);
  const roughness = keep ? p.sloppiness : Math.min(p.sloppiness / (max < 10 ? 3 : 2), 2.5);
  return {
    roughness,
    maxRandomnessOffset: 2 * scale,
    bowing: 1,
    disableMultiStroke: p.dash !== "solid",
    preserveVertices: p.sloppiness < 2,
    curveStepCount: 9,
    random: new Random(shapeSeed(layer.id)),
  };
}

const drawings = new WeakMap<ShapeLayer, ShapeDrawing>();

/** What a shape layer draws (kept per layer object: a layer is immutable). */
export function shapeDrawing(layer: ShapeLayer): ShapeDrawing {
  let drawing = drawings.get(layer);
  if (!drawing) {
    drawing = makeDrawing(layer);
    drawings.set(layer, drawing);
  }
  return drawing;
}

function makeDrawing(layer: ShapeLayer): ShapeDrawing {
  const paint = layer.paint;
  const placed = placedShape(layer);
  const rough = roughOptionsOf(layer, placed);
  const width = paint.stroke ? paint.strokeWidth : 0;
  const items: DrawItem[] = [];
  const { dash, cap } = dashFor(paint, width);
  const strokeItem = (path: PathCommand[], w: number, clip: StrokeItem["clip"] = null): StrokeItem => ({
    kind: "stroke",
    path,
    colour: paint.stroke!,
    width: w,
    cap: rough ? "round" : cap,
    join: rough ? "round" : paint.join,
    dash,
    clip,
  });
  if (placed.type === "line") {
    if (width > 0) items.push(...lineItems(placed, paint, width, rough, strokeItem));
  } else {
    const toDoc = boxPlacer(placed);
    const local = placed.type === "rect" ? rectOutline(placed.width, placed.height, placed.radius) : ellipseOutline(placed.width, placed.height);
    const outline = mapPath(local, toDoc);
    if (paint.fill) {
      if (!rough) {
        // Outside, the fill goes over the stroke's inner half: no seam where the two meet.
        if (!(width > 0 && paint.align === "outside")) items.push({ kind: "fill", path: outline, colour: paint.fill });
      } else {
        const polygon = flatten(outline, 8).flat();
        if (paint.fillStyle === "solid") items.push({ kind: "fill", path: roughFillPolygon(polygon, rough), colour: paint.fill });
        else {
          const fillWeight = Math.max(1, paint.strokeWidth / 2);
          const gap = Math.max(4, paint.strokeWidth * 4);
          const fillRough = { ...rough, roughness: rough.roughness * 0.8, disableMultiStroke: false };
          const lines = [...hachure(polygon, gap, -41 + 90, fillRough), ...(paint.fillStyle === "cross-hatch" ? hachure(polygon, gap, -41 + 180, fillRough) : [])];
          items.push({ kind: "stroke", path: lines, colour: paint.fill, width: fillWeight, cap: "round", join: "round", dash: [], clip: null });
        }
      }
    }
    if (width > 0) {
      if (rough) items.push(strokeItem(placed.type === "rect" ? roughPath(outline, rough) : roughEllipse(placed.width, placed.height, rough, toDoc), width));
      else if (paint.align === "centre") items.push(strokeItem(outline, width));
      else if (paint.align === "inside") items.push(strokeItem(outline, width * 2, { path: outline, outside: false }));
      else if (paint.fill) items.push(strokeItem(outline, width * 2), { kind: "fill", path: outline, colour: paint.fill });
      else items.push(strokeItem(outline, width * 2, { path: outline, outside: true }));
    }
  }
  return { items, bounds: boundsOf(items) };
}

/** A line's stroke (trimmed where a filled head takes over) and its heads. */
function lineItems(
  placed: Extract<PlacedShape, { type: "line" }>,
  paint: ShapePaint,
  width: number,
  rough: RoughOptions | null,
  strokeItem: (path: PathCommand[], w: number) => StrokeItem,
): DrawItem[] {
  const curve: LineCurve = { p0: [placed.from.x, placed.from.y], q: placed.control ? [placed.control.x, placed.control.y] : null, p1: [placed.to.x, placed.to.y] };
  const m = measure(curve);
  const total = m.along[m.along.length - 1];
  const items: DrawItem[] = [];
  // Two heads share the line: each at most 40% of it.
  const length = headLength(width, total * (placed.startHead !== "none" && placed.endHead !== "none" ? 0.4 : 0.6));
  const t0 = tAt(m, placed.startHead === "none" ? 0 : headTrim(placed.startHead, length));
  const t1 = tAt(m, total - (placed.endHead === "none" ? 0 : headTrim(placed.endHead, length)));
  const body = total > 0 ? curvePiece(curve, t0, Math.max(t0, t1)) : [["M", curve.p0[0], curve.p0[1]] as PathCommand, ["L", curve.p1[0] + 1e-3, curve.p1[1]] as PathCommand];
  items.push(strokeItem(rough ? roughPath(body, rough) : body, width));
  // Each head points along the curve as it arrives: from the point a head's length back to the tip.
  const direction = (tip: Pt, from: Pt): Pt => {
    const dx = tip[0] - from[0];
    const dy = tip[1] - from[1];
    const d = Math.hypot(dx, dy);
    return d > 1e-9 ? [dx / d, dy / d] : [1, 0];
  };
  if (total > 0) {
    if (placed.endHead !== "none") items.push(...headItems(placed.endHead, curve.p1, direction(curve.p1, curveAt(curve, tAt(m, total - length * 0.7))), length, paint, paint.stroke!, width, rough));
    if (placed.startHead !== "none") items.push(...headItems(placed.startHead, curve.p0, direction(curve.p0, curveAt(curve, tAt(m, length * 0.7))), length, paint, paint.stroke!, width, rough));
  }
  return items;
}

/** The box around every item: its points, and as far as a stroke reaches past them (a miter's corner further). */
function boundsOf(items: readonly DrawItem[]): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const item of items) {
    const pad = item.kind === "stroke" ? reachOf(item) : 1;
    for (const c of item.path) {
      for (let i = 1; i + 1 < c.length; i += 2) {
        const x = c[i] as number;
        const y = c[i + 1] as number;
        x0 = Math.min(x0, x - pad);
        y0 = Math.min(y0, y - pad);
        x1 = Math.max(x1, x + pad);
        y1 = Math.max(y1, y + pad);
      }
    }
  }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** How far past its path a stroke may paint: half its width, a miter's point further, and a pixel of antialiasing. */
const reachOf = (s: StrokeItem) => (s.width / 2) * (s.join === "miter" ? 2.6 : s.cap === "square" ? 1.5 : 1) + 2;

// --- tiles ---

/** The largest a shape's surface gets, each way (a shape further out is cut there). */
export const MAX_RASTER_SIDE = 65_536;

export interface ShapeRaster {
  /** What it draws, hashed: its tiles' and its surface's name. */
  key: string;
  /** The surface: the document's pixels from its top-left corner, as far as the shape reaches (whole tiles). */
  size: { width: number; height: number };
  bounds: Box | null;
  /** The tiles it touches, sorted by y then x: drawn, or (wholly inside a fill, touched by nothing else) a constant colour. */
  tiles: { tx: number; ty: number; constant: [number, number, number, number] | null }[];
}

/** cyrb53: a short hash of a string, base 36. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What makes a layer's pixels: its id (its seed), geometry, place and paint. */
export const shapeKey = (layer: ShapeLayer) => hash(JSON.stringify([layer.id, layer.shape, layer.size, layer.transform, layer.paint]));

/** Distance from a point to a segment. */
function pointSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

/** Whether segment ab comes within `reach` of the box. */
function segmentNearBox(a: Pt, b: Pt, box: Box, reach: number): boolean {
  const inside = (p: Pt) => p[0] >= box.x0 - reach && p[0] <= box.x1 + reach && p[1] >= box.y0 - reach && p[1] <= box.y1 + reach;
  if (inside(a) || inside(b)) return true;
  // Liang–Barsky against the box grown by the reach (a little more than needed at its corners: conservative).
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - (box.x0 - reach)],
    [dx, box.x1 + reach - a[0]],
    [-dy, a[1] - (box.y0 - reach)],
    [dy, box.y1 + reach - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Whether a point is inside polylines by the nonzero rule. */
function inside(polys: readonly Pt[][], x: number, y: number): boolean {
  let winding = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] <= y) {
        if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) winding++;
      } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) winding--;
    }
  }
  return winding !== 0;
}

/** sRGB "#rrggbb" opaque, premultiplied linear light, as half floats store it (a drawn pixel of it is the same). */
function opaqueLinear(hex: string): [number, number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => fromHalf(toHalf(srgbToLinear(v / 255)));
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255), 1];
}

const rasters = new WeakMap<ShapeLayer, ShapeRaster>();

/** The shape's surface and the tiles of it that aren't empty (kept per layer object). */
export function shapeRaster(layer: ShapeLayer, tile = 256): ShapeRaster {
  const kept = rasters.get(layer);
  if (kept && tile === 256) return kept;
  const drawing = shapeDrawing(layer);
  const b = drawing.bounds;
  // Whole tiles, a power of two of them: a shape drawn or dragged larger changes its surface's size a few times only.
  const side = (v: number) => Math.min(MAX_RASTER_SIDE, 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(Math.max(v, 1) / tile)))) * tile);
  const size = { width: side(b?.x1 ?? 0), height: side(b?.y1 ?? 0) };
  const raster: ShapeRaster = { key: shapeKey(layer), size, bounds: b, tiles: b ? touchedTiles(drawing, b, size, tile) : [] };
  if (tile === 256) rasters.set(layer, raster);
  return raster;
}

function touchedTiles(drawing: ShapeDrawing, b: Box, size: { width: number; height: number }, tile: number): ShapeRaster["tiles"] {
  const tx0 = Math.max(0, Math.floor(b.x0 / tile));
  const ty0 = Math.max(0, Math.floor(b.y0 / tile));
  const tx1 = Math.min(size.width / tile - 1, Math.floor(b.x1 / tile));
  const ty1 = Math.min(size.height / tile - 1, Math.floor(b.y1 / tile));
  if (tx1 < tx0 || ty1 < ty0) return [];
  const cols = tx1 - tx0 + 1;
  const touched = new Uint8Array(cols * (ty1 - ty0 + 1));
  const fills: { polys: Pt[][]; colour: string }[] = [];
  for (const item of drawing.items) {
    const polys = flatten(item.path, 8);
    // A fill's edge is antialiased over a pixel; a stroke reaches half its width (and a miter's point) past its path.
    const reach = item.kind === "stroke" ? reachOf(item) : 1.5;
    if (item.kind === "fill") fills.push({ polys, colour: item.colour });
    for (const poly of polys) {
      for (let i = 0; i + 1 < poly.length + (item.kind === "fill" ? 1 : 0); i++) {
        const a = poly[i];
        const c = poly[(i + 1) % poly.length];
        const x0 = Math.max(tx0, Math.floor((Math.min(a[0], c[0]) - reach) / tile));
        const x1 = Math.min(tx1, Math.floor((Math.max(a[0], c[0]) + reach) / tile));
        const y0 = Math.max(ty0, Math.floor((Math.min(a[1], c[1]) - reach) / tile));
        const y1 = Math.min(ty1, Math.floor((Math.max(a[1], c[1]) + reach) / tile));
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            const k = (ty - ty0) * cols + (tx - tx0);
            if (touched[k]) continue;
            if (segmentNearBox(a, c, { x0: tx * tile, y0: ty * tile, x1: (tx + 1) * tile, y1: (ty + 1) * tile }, reach)) touched[k] = 1;
          }
        }
      }
    }
  }
  const out: ShapeRaster["tiles"] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (touched[(ty - ty0) * cols + (tx - tx0)]) {
        out.push({ tx, ty, constant: null });
        continue;
      }
      // Untouched: wholly inside a fill (the last one drawn there), or empty.
      const cx = (tx + 0.5) * tile;
      const cy = (ty + 0.5) * tile;
      const fill = fills.findLast((f) => inside(f.polys, cx, cy));
      if (fill) out.push({ tx, ty, constant: opaqueLinear(fill.colour) });
    }
  }
  return out;
}

// --- hit testing ---

/**
 * Whether document point (x, y) is on what the layer draws, within `tolerance` document pixels (its fill, or its
 * stroke's band): what the Move tool and the shape tools pick by.
 */
export function hitShape(layer: ShapeLayer, x: number, y: number, tolerance = 0): boolean {
  const drawing = shapeDrawing(layer);
  const b = drawing.bounds;
  if (!b || x < b.x0 - tolerance || x > b.x1 + tolerance || y < b.y0 - tolerance || y > b.y1 + tolerance) return false;
  for (const item of drawing.items) {
    const polys = flatten(item.path, 12);
    if (item.kind === "fill") {
      if (inside(polys, x, y)) return true;
      continue;
    }
    // (A stroke aligned inside or outside paints one half of its doubled band: either half counts, near enough.)
    if (nearAny(polys, x, y, item.width / 2 + tolerance)) return true;
  }
  return false;
}

function nearAny(polys: readonly Pt[][], x: number, y: number, reach: number): boolean {
  for (const poly of polys) for (let i = 0; i + 1 < poly.length; i++) if (pointSegment(x, y, poly[i], poly[i + 1]) <= reach) return true;
  return false;
}

/** The box a layer's shape occupies on the canvas (for picking, snapping, merges), or null when it draws nothing. */
export const shapeBounds = (layer: ShapeLayer): Box | null => shapeDrawing(layer).bounds;

/** A point the canvas's overlays use: the document point of a placed shape's line control. */
export type { Point };

/** A path as SVG's `d` (the canvas's overlays and the Layers panel's thumbnails draw shapes as SVG). */
export function pathData(path: readonly PathCommand[]): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  return path.map((c) => (c[0] === "Z" ? "Z" : `${c[0]}${c.slice(1).map((v) => n(v as number)).join(" ")}`)).join("");
}
