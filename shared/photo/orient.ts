/**
 * Flips and right-angle turns (Photoshop's Edit › Transform › Flip / Rotate and Image › Image Rotation): of the
 * selected layers about the box around them, or of the whole canvas. Both are exact: a layer's transform takes the
 * turn or the mirror into its own five numbers (a flipped layer's width is −100%, never a 180° turn and a flipped
 * height), and the canvas's pixels in document space (masks of adjustments, generators, text and shapes; the
 * selection) are moved pixel for pixel, never resampled. Pure.
 */
import { type CropRect, cropOf, partBounds, maskInDocument } from "./crop.ts";
import { effectDefinition, unavailableReason } from "./effects/index.ts";
import type { Size } from "./geometry.ts";
import { bounds } from "./layers.ts";
import { wrapDegrees } from "./project.ts";
import {
  type DocPoint,
  type EffectInstance,
  type LayerTransform,
  type MaskSelection,
  type PhotoLayer,
  type PhotoProject,
  type PhotoSelection,
  type PhotoState,
  type PlacedLayer,
  type SurfaceId,
  hasContent,
  isPlaced,
} from "./types.ts";

export type Orientation = "flip-horizontal" | "flip-vertical" | "rotate-90-cw" | "rotate-90-ccw" | "rotate-180";

/** In Photoshop's menu order (Rotate 180° first, then the quarter turns, then the flips). */
export const ORIENTATIONS: readonly Orientation[] = ["rotate-180", "rotate-90-cw", "rotate-90-ccw", "flip-horizontal", "flip-vertical"];

/** Their names in the menus (the canvas's say "Canvas": `canvasOrientationLabel`). */
export const ORIENTATION_LABELS: Record<Orientation, string> = {
  "rotate-180": "Rotate 180°",
  "rotate-90-cw": "Rotate 90° Clockwise",
  "rotate-90-ccw": "Rotate 90° Counter Clockwise",
  "flip-horizontal": "Flip Horizontal",
  "flip-vertical": "Flip Vertical",
};

/** Image › Image Rotation's names: "180°", "90° Clockwise", "Flip Canvas Horizontal"… */
export const canvasOrientationLabel = (o: Orientation) => (o.startsWith("flip") ? ORIENTATION_LABELS[o].replace("Flip", "Flip Canvas") : ORIENTATION_LABELS[o].replace("Rotate ", ""));

export const isOrientation = (v: unknown): v is Orientation => typeof v === "string" && (ORIENTATIONS as readonly string[]).includes(v);

/** The map as a turn (clockwise, y down) then a mirror across the axis it names: p′ = Mirror(R(turn) · p). */
interface Dihedral {
  turn: 0 | 90 | 180 | 270;
  /** "x" negates x (a horizontal flip), "y" negates y. */
  mirror: "none" | "x" | "y";
}

const DIHEDRAL: Record<Orientation, Dihedral> = {
  "flip-horizontal": { turn: 0, mirror: "x" },
  "flip-vertical": { turn: 0, mirror: "y" },
  "rotate-90-cw": { turn: 90, mirror: "none" },
  "rotate-90-ccw": { turn: 270, mirror: "none" },
  "rotate-180": { turn: 180, mirror: "none" },
};

/** Whether it swaps width and height (a quarter turn). */
export const swapsSides = (o: Orientation) => DIHEDRAL[o].turn % 180 !== 0;

/** A vector through the map (no translation). */
export function orientVector(o: Orientation, dx: number, dy: number): { x: number; y: number } {
  const { turn, mirror } = DIHEDRAL[o];
  // Clockwise in y-down coordinates, as a layer's rotation is.
  let [x, y] = turn === 90 ? [-dy, dx] : turn === 180 ? [-dx, -dy] : turn === 270 ? [dy, -dx] : [dx, dy];
  if (mirror === "x") x = -x;
  if (mirror === "y") y = -y;
  // No −0: positions are compared and printed.
  return { x: x + 0, y: y + 0 };
}

/** A point through the map about `from`, landing about `to` (the same point for a layer; a canvas's new centre). */
export function orientPoint(o: Orientation, p: { x: number; y: number }, from: { x: number; y: number }, to = from): { x: number; y: number } {
  const v = orientVector(o, p.x - from.x, p.y - from.y);
  return { x: to.x + v.x, y: to.y + v.y };
}

/**
 * A layer's transform carried by the map. Mirror · R(θ) · K(k) = R(−θ) · K(−k) · Mirror, so a flip negates the angle,
 * the skew and the scale along its axis: the numbers stay a plain place (a turned layer flipped is turned the other
 * way, mirrored). Its perspective is in its own pixels: the map doesn't change it.
 */
export function orientTransform(t: LayerTransform, o: Orientation, from: { x: number; y: number }, to = from): LayerTransform {
  const { turn, mirror } = DIHEDRAL[o];
  const c = orientPoint(o, t, from, to);
  const angle = t.rotation + turn;
  const next: LayerTransform =
    mirror === "none"
      ? { x: c.x, y: c.y, scaleX: t.scaleX, scaleY: t.scaleY, rotation: wrapDegrees(angle) }
      : { x: c.x, y: c.y, scaleX: mirror === "x" ? -t.scaleX : t.scaleX, scaleY: mirror === "y" ? -t.scaleY : t.scaleY, rotation: wrapDegrees(-angle + 0) };
  if (t.skew) next.skew = mirror === "none" ? t.skew : -t.skew;
  if (t.perspective) next.perspective = [t.perspective[0], t.perspective[1]];
  // A warp is in the layer's own pixels, as its perspective is.
  if (t.warp) next.warp = t.warp;
  return next;
}

/** A generator's or filter's document points through `f`, those of each `point` parameter (`handles`: only the ones drawn on the canvas). */
function mapPoints(effect: EffectInstance, kind: Parameters<typeof unavailableReason>[1], f: (p: DocPoint) => DocPoint, handles: boolean): EffectInstance {
  const def = effectDefinition(effect.type);
  if (!def || unavailableReason(effect, kind)) return effect;
  let params = effect.params;
  for (const spec of def.params) {
    const v = params[spec.key];
    if (spec.kind !== "point" || (handles && !spec.handle) || !Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number") continue;
    if (params === effect.params) params = { ...params };
    params[spec.key] = f(v as DocPoint);
  }
  return params === effect.params ? effect : { ...effect, params };
}

const pointMap = (o: Orientation, from: { x: number; y: number }, to = from) => (p: DocPoint): DocPoint => {
  const q = orientPoint(o, { x: p[0], y: p[1] }, from, to);
  return [q.x, q.y];
};

/** What a placed layer shows, in document pixels: its crop's box, or the layer's. */
function shownBounds(layer: PlacedLayer, size: Size) {
  return layer.crop ? partBounds(layer.transform, size, cropOf(layer, size)) : bounds(layer.transform, size);
}

/**
 * The selected layers flipped or turned together about the centre of the box around them (Photoshop's transform
 * box: what shows of each, a generator's handles), as one edit. A placed layer whose size isn't known yet (its image
 * missing) counts by its centre. Adjustments have no place: they're left as they are. Masks in document pixels
 * (text's, shapes', generators') stay where they are, as they do when such a layer moves.
 */
export function orientLayers(doc: PhotoProject, ids: readonly string[], o: Orientation, sizeOf: (layer: PlacedLayer) => Size | null): PhotoProject {
  const chosen = new Set(ids);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of doc.layers) {
    if (!chosen.has(l.id)) continue;
    if (isPlaced(l)) {
      const size = sizeOf(l);
      const b = size ? shownBounds(l, size) : { x0: l.transform.x, y0: l.transform.y, x1: l.transform.x, y1: l.transform.y };
      xs.push(b.x0, b.x1);
      ys.push(b.y0, b.y1);
    } else if (l.kind === "generator") {
      mapPoints(l.effect, "generator", (p) => (xs.push(p[0]), ys.push(p[1]), p), true);
    }
  }
  if (!xs.length) return doc;
  const pivot = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  let changed = false;
  const layers = doc.layers.map((l): PhotoLayer => {
    if (!chosen.has(l.id)) return l;
    if (isPlaced(l)) {
      changed = true;
      return { ...l, transform: orientTransform(l.transform, o, pivot) };
    }
    if (l.kind !== "generator") return l;
    const effect = mapPoints(l.effect, "generator", pointMap(o, pivot), true);
    if (effect === l.effect) return l;
    changed = true;
    return { ...l, effect };
  });
  return changed ? { ...doc, layers } : doc;
}

// --- the canvas ---

/** The canvas's size after the map. */
export const orientedSize = (size: Size, o: Orientation): Size => (swapsSides(o) ? { width: size.height, height: size.width } : { width: size.width, height: size.height });

/**
 * Where each pixel of the oriented canvas comes from: old (x, y) = (ax·x′ + bx·y′ + cx, ay·x′ + by·y′ + cy), whole
 * pixels (pixel centres map to pixel centres: the map is a symmetry of the pixel grid).
 */
export interface PixelSource {
  ax: number;
  bx: number;
  cx: number;
  ay: number;
  by: number;
  cy: number;
}

/** `PixelSource` for a canvas of `size` (the old one). */
export function pixelSource(o: Orientation, size: Size): PixelSource {
  const next = orientedSize(size, o);
  // The map's matrix, by where it takes the axes, then its inverse (a symmetry: its determinant is ±1).
  const e1 = orientVector(o, 1, 0);
  const e2 = orientVector(o, 0, 1);
  const det = e1.x * e2.y - e2.x * e1.y;
  const [p, q, r, s] = [e2.y / det, -e2.x / det, -e1.y / det, e1.x / det];
  // old centre = from + L⁻¹(new centre − to), with pixel (i, j)'s centre at (i + ½, j + ½).
  const ux = 0.5 - next.width / 2;
  const uy = 0.5 - next.height / 2;
  return { ax: p, bx: q, cx: size.width / 2 - 0.5 + p * ux + q * uy, ay: r, by: s, cy: size.height / 2 - 0.5 + r * ux + s * uy };
}

/** A rectangle in document pixels carried with the canvas. */
export function orientRect(r: CropRect, o: Orientation, canvas: Size): CropRect {
  const next = orientedSize(canvas, o);
  const from = { x: canvas.width / 2, y: canvas.height / 2 };
  const to = { x: next.width / 2, y: next.height / 2 };
  const a = orientPoint(o, r, from, to);
  const b = orientPoint(o, { x: r.x + r.width, y: r.y + r.height }, from, to);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** The selection carried with the canvas (a rectangle stays one; a mask's coverage moves pixel for pixel). */
export function orientSelection(s: PhotoSelection, o: Orientation, canvas: Size): PhotoSelection {
  const box = orientRect(s, o, canvas);
  if (s.kind === "rect") return { kind: "rect", ...box };
  const src = pixelSource(o, canvas);
  const data = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const nx = box.x + x;
      const ny = box.y + y;
      const ox = src.ax * nx + src.bx * ny + src.cx - s.x;
      const oy = src.ay * nx + src.by * ny + src.cy - s.y;
      data[y * box.width + x] = s.data[oy * s.width + ox];
    }
  }
  const out: MaskSelection = { kind: "mask", ...box, data };
  return out;
}

/**
 * The whole canvas flipped or turned (Image › Image Rotation), one edit of the document and the selection: the
 * canvas's sides swap on a quarter turn, every placed layer is carried about its centre, every point in document
 * pixels (generators' handles, filters' and adjustments' points) goes with it, and the masks in document pixels are
 * `masks` (old id → new, for each of `documentMasks`: made by the tab, `orientSurface`). Throws when a mask that had to move isn't in `masks`.
 * Angles in effects' settings (a motion blur's, a glow's) are left as they are, as Photoshop leaves them.
 */
export function orientCanvas(state: PhotoState, o: Orientation, masks: ReadonlyMap<SurfaceId, SurfaceId | null> = new Map()): PhotoState {
  const { doc } = state;
  const size = orientedSize(doc.canvas, o);
  const from = { x: doc.canvas.width / 2, y: doc.canvas.height / 2 };
  const to = { x: size.width / 2, y: size.height / 2 };
  const f = pointMap(o, from, to);
  const layers = doc.layers.map((l): PhotoLayer => {
    let next: PhotoLayer = l;
    if (isPlaced(next)) next = { ...next, transform: orientTransform(next.transform, o, from, to) };
    if (next.kind === "generator") {
      const effect = mapPoints(next.effect, "generator", f, false);
      if (effect !== next.effect) next = { ...next, effect };
    }
    if (next.kind === "adjustment") {
      const effect = mapPoints(next.effect, "adjustment", f, false);
      if (effect !== next.effect) next = { ...next, effect };
    }
    if (hasContent(next) && next.filters?.length) {
      const before = next.filters;
      const filters = before.map((fx) => mapPoints(fx, "filter", f, false));
      if (filters.some((fx, i) => fx !== before[i])) next = { ...next, filters };
    }
    if (maskInDocument(next) && next.mask?.surface) {
      if (!masks.has(next.mask.surface)) throw new Error(`The mask of "${l.name}" wasn't moved with the canvas.`);
      next = { ...next, mask: { surface: masks.get(next.mask.surface)! } };
    }
    return next;
  });
  const selection = state.selection ? orientSelection(state.selection, o, doc.canvas) : null;
  return { doc: { ...doc, canvas: { ...doc.canvas, width: size.width, height: size.height }, layers }, selection };
}
