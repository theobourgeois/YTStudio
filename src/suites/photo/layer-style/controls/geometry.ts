/**
 * The Layer Style window's controls' maths (pure, so it's tested): the angle dial's angle from a pointer, a
 * gradient's stops found, moved, added and removed along the Gradient Editor's bar, and a contour's points edited
 * as the Contour Editor's graph edits them (docs/photo/layer-style/dialog.md, "Shared controls").
 */
import { contourFunction, MAX_CONTOUR_POINTS } from "@shared/photo/style/contours";
import { gradientAt } from "@shared/photo/style/gradients";
import type { Contour, ContourPoint, Gradient } from "@shared/photo/types";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The angle dial.

/** An angle in degrees on (−180, 180], as Photoshop's field shows it (half a turn is 180, never −180). */
export function wrapAngle(degrees: number): number {
  const w = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w + 0;
}

/**
 * The dial's angle for a pointer (dx, dy) px from its centre (the screen's y, down): degrees anticlockwise from 3
 * o'clock, whole, snapped to 15° with `snap` (Shift). Null on the centre itself, which points nowhere.
 */
export function angleFromOffset(dx: number, dy: number, snap = false): number | null {
  if (Math.hypot(dx, dy) < 1e-6) return null;
  const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return wrapAngle(snap ? Math.round(degrees / 15) * 15 : Math.round(degrees));
}

/** Where the dial's line ends for `angle`, `radius` px from the centre (the screen's y, down). */
export function dialOffset(angle: number, radius: number): { x: number; y: number } {
  const a = (angle * Math.PI) / 180;
  return { x: Math.cos(a) * radius + 0, y: -Math.sin(a) * radius + 0 };
}

// A gradient's stops (colour and opacity alike: anything with an `at` on 0..1).

export interface Stop {
  at: number;
}

/** A location on the bar as Photoshop keeps it: whole percent, on 0..1. */
export const stopLocation = (fraction: number) => Math.round(clamp(fraction, 0, 1) * 100) / 100;

/** The stop nearest `at` (a fraction along the bar) within `tolerance` (a fraction too), or −1. */
export function nearestStop(stops: readonly Stop[], at: number, tolerance: number): number {
  let best = -1;
  let distance = tolerance;
  stops.forEach((s, i) => {
    const d = Math.abs(s.at - at);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/** The stops with `stop` put in its place by location (after any at the same place), and its index. */
export function addStop<S extends Stop>(stops: readonly S[], stop: S): { stops: S[]; index: number } {
  const placed = { ...stop, at: stopLocation(stop.at) };
  const after = stops.findIndex((s) => s.at > placed.at);
  const index = after < 0 ? stops.length : after;
  return { stops: [...stops.slice(0, index), placed, ...stops.slice(index)], index };
}

/** Stop `index` moved to `at` (clamped to the bar, whole percent), the list kept in order, and where it is now. */
export function moveStop<S extends Stop>(stops: readonly S[], index: number, at: number): { stops: S[]; index: number } {
  return addStop(
    stops.filter((_, i) => i !== index),
    { ...stops[index], at },
  );
}

/** Without stop `index`; a gradient keeps at least one of each kind, so the last one stays. */
export function removeStop<S extends Stop>(stops: readonly S[], index: number): readonly S[] {
  return stops.length <= 1 || index < 0 || index >= stops.length ? stops : stops.filter((_, i) => i !== index);
}

/** How far (px) a stop is dragged away from the bar before it's removed. */
export const STOP_PULL_OFF = 36;

/** Whether a stop dragged `distance` px away from the bar (either way) comes off it. */
export const pulledOff = (distance: number) => Math.abs(distance) > STOP_PULL_OFF;

const hex2 = (v: number) =>
  Math.round(clamp(v, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");

/** The gradient's colour at `at` as "#rrggbb": what a colour stop added there takes. */
export function gradientHexAt(g: Gradient, at: number): string {
  const [r, gr, b] = gradientAt(g, at);
  return `#${hex2(r)}${hex2(gr)}${hex2(b)}`;
}

/** The gradient's opacity at `at`, in whole percent (as a fraction): what an opacity stop added there takes. */
export const gradientOpacityAt = (g: Gradient, at: number) => Math.round(gradientAt(g, at)[3] * 100) / 100;

/** A gradient's two kinds of stop: colour stops under the bar, opacity stops over it. */
export type GradientStopKind = "colour" | "opacity";

export const gradientStops = (g: Gradient, kind: GradientStopKind): readonly Stop[] => (kind === "colour" ? g.colours : g.opacities);

/** An edited gradient is the user's own: "Custom". */
const custom = (g: Gradient, kind: GradientStopKind, stops: readonly Stop[]): Gradient =>
  kind === "colour" ? { ...g, name: "Custom", colours: stops as Gradient["colours"] } : { ...g, name: "Custom", opacities: stops as Gradient["opacities"] };

/** A stop added at `at` taking the gradient's colour (or opacity) there, and its index. */
export function addGradientStop(g: Gradient, kind: GradientStopKind, at: number): { gradient: Gradient; index: number } {
  const where = stopLocation(at);
  const r = kind === "colour" ? addStop(g.colours, { at: where, colour: gradientHexAt(g, where) }) : addStop(g.opacities, { at: where, opacity: gradientOpacityAt(g, where) });
  return { gradient: custom(g, kind, r.stops), index: r.index };
}

/** Stop `index` of a kind moved to `at`, and where it is now among its kind. */
export function moveGradientStop(g: Gradient, kind: GradientStopKind, index: number, at: number): { gradient: Gradient; index: number } {
  const r = kind === "colour" ? moveStop(g.colours, index, at) : moveStop(g.opacities, index, at);
  return { gradient: custom(g, kind, r.stops), index: r.index };
}

/** Without stop `index` of a kind; the same gradient when it's the last of its kind. */
export function removeGradientStop(g: Gradient, kind: GradientStopKind, index: number): Gradient {
  const list = gradientStops(g, kind);
  const next = removeStop(list, index);
  return next === list ? g : custom(g, kind, next);
}

/** A colour stop given a colour, or an opacity stop an opacity (0..1). */
export function setGradientStop(g: Gradient, kind: GradientStopKind, index: number, value: string | number): Gradient {
  if (kind === "colour" && typeof value === "string") return custom(g, kind, g.colours.map((s, i) => (i === index ? { ...s, colour: value.toLowerCase() } : s)));
  if (kind === "opacity" && typeof value === "number") return custom(g, kind, g.opacities.map((s, i) => (i === index ? { ...s, opacity: clamp(value, 0, 1) } : s)));
  return g;
}

// A contour's points (levels on 0..255; the first stays at input 0 and the last at 255).

/** How far past the graph (in levels) a dragged point goes before it's removed: Curves' distance. */
export const CONTOUR_OFF = 24;

/** Whether a point dragged to (x, y) levels is off the graph, so it comes off the contour. */
export const offGraph = (x: number, y: number) => x < -CONTOUR_OFF || x > 255 + CONTOUR_OFF || y < -CONTOUR_OFF || y > 255 + CONTOUR_OFF;

/** The point nearest (x, y) in levels within `tolerance` levels, or −1. */
export function nearestContourPoint(points: readonly ContourPoint[], x: number, y: number, tolerance = 8): number {
  let best = -1;
  let distance = tolerance;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/**
 * Point `i` moved to (x, y), levels rounded and on 0..255: an end moves only up and down (the first at input 0, the
 * last at 255), any other stays strictly between its neighbours. Its corner goes with it.
 */
export function moveContourPoint(points: readonly ContourPoint[], i: number, x: number, y: number): ContourPoint[] {
  const last = points.length - 1;
  let nx: number;
  if (i === 0) nx = 0;
  else if (i === last) nx = 255;
  else {
    const lo = points[i - 1].x + 1;
    const hi = points[i + 1].x - 1;
    nx = lo > hi ? points[i].x : clamp(Math.round(x), lo, hi);
  }
  const ny = clamp(Math.round(y), 0, 255);
  return points.map((p, j) => (j === i ? { ...p, x: nx, y: ny } : p));
}

/**
 * A smooth point added at (x, y) (levels rounded) and its index; null when the contour has its 16 points already,
 * there's one at that input, or it's not between the ends.
 */
export function addContourPoint(points: readonly ContourPoint[], x: number, y: number): { points: ContourPoint[]; index: number } | null {
  const nx = clamp(Math.round(x), 0, 255);
  if (points.length >= MAX_CONTOUR_POINTS || nx <= points[0].x || nx >= points[points.length - 1].x || points.some((p) => p.x === nx)) return null;
  const index = points.findIndex((p) => p.x > nx);
  const point: ContourPoint = { x: nx, y: clamp(Math.round(y), 0, 255) };
  return { points: [...points.slice(0, index), point, ...points.slice(index)], index };
}

/** Without point `i`: the ends stay (and the same list comes back when nothing's removed). */
export function removeContourPoint(points: readonly ContourPoint[], i: number): readonly ContourPoint[] {
  return i <= 0 || i >= points.length - 1 ? points : points.filter((_, j) => j !== i);
}

/** Point `i` made a corner or smooth. */
export function setContourCorner(points: readonly ContourPoint[], i: number, corner: boolean): ContourPoint[] {
  return points.map((p, j) => (j !== i ? p : corner ? { x: p.x, y: p.y, corner: true } : { x: p.x, y: p.y }));
}

/**
 * The contour sampled for drawing: `steps` even inputs plus each point's own (so corners stay sharp), as
 * [input, output] in levels.
 */
export function contourSamples(contour: Contour, steps = 128): [number, number][] {
  const f = contourFunction(contour);
  const xs = new Set<number>();
  for (let i = 0; i <= steps; i++) xs.add((i / steps) * 255);
  for (const p of contour.points) xs.add(p.x);
  return [...xs].sort((a, b) => a - b).map((x) => [x, f(x / 255) * 255]);
}

/** The curve as an SVG path in a 255 × 255 box (the screen's y, down). */
export function contourPath(contour: Contour, steps = 128): string {
  return contourSamples(contour, steps)
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${(255 - y).toFixed(2)}`)
    .join("");
}

/** The area under the curve as a closed SVG path in a 255 × 255 box: what a contour's thumbnail fills. */
export function contourArea(contour: Contour, steps = 64): string {
  return `M0,255L${contourPath(contour, steps).slice(1)}L255,255Z`;
}
