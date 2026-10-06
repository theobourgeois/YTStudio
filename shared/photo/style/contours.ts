/**
 * Contours (docs/photo/layer-style/dialog.md, "Contours"): how a shadow, glow or stroke's falloff is reshaped.
 * Measured in Photoshop 27.11 (photoshop-measurements.md, "Contours"): smooth points are joined by a natural cubic
 * spline, as Curves' are, a corner breaks the curve into runs each its own spline (a run of two points is a straight
 * line), and the result is held to 0..255. The presets are Photoshop's own, read from its Default Contours.shc.
 */
import { curveFunction } from "../effects/curve-math.ts";
import type { Contour, ContourPoint } from "../types.ts";

/** The contour picker's presets, Photoshop's 12 in its order. */
export const CONTOUR_PRESETS: readonly Contour[] = [
  { name: "Linear", points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
  { name: "Cone", points: [{ x: 0, y: 0 }, { x: 129, y: 255 }, { x: 255, y: 0 }] },
  { name: "Cone - Inverted", points: [{ x: 0, y: 255 }, { x: 127, y: 0 }, { x: 255, y: 255 }] },
  { name: "Cove - Deep", points: [{ x: 0, y: 65 }, { x: 95, y: 74, corner: true }, { x: 151, y: 115 }, { x: 178, y: 178 }, { x: 192, y: 255 }] },
  { name: "Cove - Shallow", points: [{ x: 0, y: 0 }, { x: 4, y: 126, corner: true }, { x: 80, y: 179 }, { x: 129, y: 255 }] },
  { name: "Gaussian", points: [{ x: 0, y: 0 }, { x: 32, y: 7 }, { x: 64, y: 38 }, { x: 96, y: 101 }, { x: 128, y: 166 }, { x: 159, y: 209 }, { x: 191, y: 235 }, { x: 223, y: 248 }, { x: 255, y: 255 }] },
  { name: "Half Round", points: [{ x: 0, y: 0 }, { x: 29, y: 71 }, { x: 87, y: 167 }, { x: 195, y: 240 }, { x: 255, y: 255 }] },
  { name: "Ring", points: [{ x: 0, y: 0 }, { x: 32, y: 110 }, { x: 64, y: 237 }, { x: 96, y: 239 }, { x: 128, y: 138 }, { x: 159, y: 32 }, { x: 191, y: 6 }, { x: 223, y: 99 }, { x: 255, y: 255 }] },
  { name: "Ring - Double", points: [{ x: 0, y: 0 }, { x: 32, y: 74 }, { x: 64, y: 219 }, { x: 96, y: 187 }, { x: 128, y: 0 }, { x: 159, y: 175 }, { x: 191, y: 202 }, { x: 223, y: 2 }, { x: 255, y: 255 }] },
  { name: "Rolling Slope - Descending", points: [{ x: 2, y: 255 }, { x: 53, y: 100 }, { x: 97, y: 107 }, { x: 179, y: 153 }, { x: 252, y: 0 }] },
  { name: "Rounded Steps", points: [{ x: 0, y: 0 }, { x: 15, y: 36 }, { x: 64, y: 64, corner: true }, { x: 84, y: 106 }, { x: 127, y: 126, corner: true }, { x: 146, y: 169 }, { x: 192, y: 190, corner: true }, { x: 221, y: 224 }, { x: 255, y: 195 }] },
  { name: "Sawtooth 1", points: [{ x: 0, y: 0 }, { x: 66, y: 128, corner: true }, { x: 127, y: 0, corner: true }, { x: 191, y: 126, corner: true }, { x: 255, y: 0 }] },
];

export const LINEAR_CONTOUR: Contour = CONTOUR_PRESETS[0];

export const contourPreset = (name: string): Contour | undefined => CONTOUR_PRESETS.find((c) => c.name.toLowerCase() === name.toLowerCase());

/** Photoshop's limit on a contour's points (the Contour Editor's, as Curves'). */
export const MAX_CONTOUR_POINTS = 16;

/**
 * A contour checked: points on 0..255, by input, one per input, 2 to 16 of them; a bad one is Linear. `repaired`
 * says something was changed.
 */
export function sanitizeContour(value: unknown): { value: Contour; repaired: boolean } {
  if (!value || typeof value !== "object" || !Array.isArray((value as Contour).points)) return { value: LINEAR_CONTOUR, repaired: true };
  const v = value as { name?: unknown; points: unknown[] };
  let repaired = false;
  const byX = new Map<number, ContourPoint>();
  for (const p of v.points) {
    const q = p as Record<string, unknown>;
    if (!q || typeof q.x !== "number" || typeof q.y !== "number" || !Number.isFinite(q.x) || !Number.isFinite(q.y)) {
      repaired = true;
      continue;
    }
    const x = Math.max(0, Math.min(255, q.x));
    const y = Math.max(0, Math.min(255, q.y));
    if (x !== q.x || y !== q.y || byX.has(x)) repaired = true;
    byX.set(x, q.corner === true ? { x, y, corner: true } : { x, y });
  }
  let points = [...byX.values()].sort((a, b) => a.x - b.x);
  if (points.length < 2) return { value: LINEAR_CONTOUR, repaired: true };
  if (points.length > MAX_CONTOUR_POINTS) {
    points = points.slice(0, MAX_CONTOUR_POINTS);
    repaired = true;
  }
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 64) : "Custom";
  return { value: { name, points }, repaired };
}

/** The contour as a function of a fraction in [0, 1] (its input) to a fraction (its output). */
export function contourFunction(contour: Contour): (x: number) => number {
  const pts = contour.points;
  // Runs from corner to corner (the ends count as corners): each a natural spline of its own.
  const runs: { from: number; to: number; f: (x: number) => number }[] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (i === pts.length - 1 || pts[i].corner) {
      const run = pts.slice(start, i + 1);
      runs.push({ from: run[0].x / 255, to: run.at(-1)!.x / 255, f: curveFunction(run.map((p) => [p.x, p.y])) });
      start = i;
    }
  }
  return (x) => {
    if (x <= runs[0].from) return pts[0].y / 255;
    for (const r of runs) if (x <= r.to) return r.f(x);
    return pts.at(-1)!.y / 255;
  };
}

/** Whether it changes nothing: a straight line from (0, 0) to (255, 255). */
export const isLinearContour = (c: Contour) => c.points.every((p) => p.x === p.y) && c.points[0].x === 0 && c.points.at(-1)!.x === 255;

/** The size of a contour's table on the GPU. */
export const CONTOUR_TABLE_SIZE = 1024;

/** The contour sampled at `size` points over [0, 1]: what the GPU reads (linearly between entries). */
export function contourTable(contour: Contour, size = CONTOUR_TABLE_SIZE): Float32Array {
  const f = contourFunction(contour);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = f(i / (size - 1));
  return out;
}
