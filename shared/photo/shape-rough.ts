/**
 * Shapes drawn by hand (Excalidraw's sloppiness, docs/photo/tools/shapes.md): rough.js's algorithm (Preet Shihn, MIT),
 * ported to the paths `shape-drawing.ts` plays. Every line is two passes of a cubic whose ends and control points are
 * offset at random and bowed off the chord; ellipses are points around the curve, jittered and joined by a
 * Catmull-Rom spline that overlaps where it starts; hachure fills are parallel rough lines. The random numbers come
 * from rough.js's own generator seeded by the layer's id, so a shape looks the same in every render and export.
 */

/** A path, as the 2D canvas plays it: moves, lines, cubics and closes, in document pixels. */
export type PathCommand = ["M", number, number] | ["L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export type Pt = [number, number];

/** rough.js's options that matter here (its defaults, as Excalidraw sets them). */
export interface RoughOptions {
  /** 0 precise, 1 Artist, 2 Cartoonist (Excalidraw's sloppiness). */
  roughness: number;
  /** How far a point may wander, in document pixels (rough.js's 2, scaled with the stroke). */
  maxRandomnessOffset: number;
  bowing: number;
  /** One pass instead of two (dashed and dotted strokes: the passes' dashes would overlap). */
  disableMultiStroke: boolean;
  /** Ends stay where they are (Excalidraw: below Cartoonist). */
  preserveVertices: boolean;
  curveStepCount: number;
  random: Random;
}

/** rough.js's seeded generator (a Lehmer generator, `math.ts`). */
export class Random {
  constructor(private seed: number) {}
  next(): number {
    return ((2 ** 31 - 1) & (this.seed = Math.imul(48271, this.seed))) / 2 ** 31;
  }
}

const offset = (min: number, max: number, o: RoughOptions, gain = 1) => o.roughness * gain * (o.random.next() * (max - min) + min);
const offsetOpt = (x: number, o: RoughOptions, gain = 1) => offset(-x, x, o, gain);

/** One rough pass of a line (rough.js's `_line`): a cubic bowed off the chord, its points offset at random. */
function line(x1: number, y1: number, x2: number, y2: number, o: RoughOptions, move: boolean, overlay: boolean): PathCommand[] {
  const lengthSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
  const length = Math.sqrt(lengthSq);
  // Long lines wander less (in rough.js's pixels: scaled with the offset here).
  const scaled = length / Math.max(1, o.maxRandomnessOffset / 2);
  const gain = scaled < 200 ? 1 : scaled > 500 ? 0.4 : -0.0016668 * scaled + 1.233334;
  let off = o.maxRandomnessOffset;
  if (off * off * 100 > lengthSq) off = length / 10;
  const half = off / 2;
  const diverge = 0.2 + o.random.next() * 0.2;
  let midX = (o.bowing * o.maxRandomnessOffset * (y2 - y1)) / 200;
  let midY = (o.bowing * o.maxRandomnessOffset * (x1 - x2)) / 200;
  midX = offsetOpt(midX, o, gain);
  midY = offsetOpt(midY, o, gain);
  const r = () => offsetOpt(overlay ? half : off, o, gain);
  const keep = o.preserveVertices;
  const ops: PathCommand[] = [];
  if (move) ops.push(["M", x1 + (keep ? 0 : r()), y1 + (keep ? 0 : r())]);
  ops.push([
    "C",
    midX + x1 + (x2 - x1) * diverge + r(),
    midY + y1 + (y2 - y1) * diverge + r(),
    midX + x1 + 2 * (x2 - x1) * diverge + r(),
    midY + y1 + 2 * (y2 - y1) * diverge + r(),
    x2 + (keep ? 0 : r()),
    y2 + (keep ? 0 : r()),
  ]);
  return ops;
}

/** A rough line: two passes (one when `disableMultiStroke`). */
export function roughLine(x1: number, y1: number, x2: number, y2: number, o: RoughOptions): PathCommand[] {
  const first = line(x1, y1, x2, y2, o, true, false);
  return o.disableMultiStroke ? first : [...first, ...line(x1, y1, x2, y2, o, true, true)];
}

/** A rough cubic from `current` (rough.js's `_bezierTo`): its control points and end wander. */
function bezierTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number, current: Pt, o: RoughOptions): PathCommand[] {
  const ops: PathCommand[] = [];
  const ros = [o.maxRandomnessOffset || 1, (o.maxRandomnessOffset || 1) + 0.3];
  const passes = o.disableMultiStroke ? 1 : 2;
  for (let i = 0; i < passes; i++) {
    if (i === 0) ops.push(["M", current[0], current[1]]);
    else ops.push(["M", current[0] + (o.preserveVertices ? 0 : offsetOpt(ros[0], o)), current[1] + (o.preserveVertices ? 0 : offsetOpt(ros[0], o))]);
    const end: Pt = o.preserveVertices ? [x, y] : [x + offsetOpt(ros[i], o), y + offsetOpt(ros[i], o)];
    ops.push(["C", x1 + offsetOpt(ros[i], o), y1 + offsetOpt(ros[i], o), x2 + offsetOpt(ros[i], o), y2 + offsetOpt(ros[i], o), end[0], end[1]]);
  }
  return ops;
}

/** Any path drawn rough (rough.js's `svgPath`): its lines as rough lines, its cubics as rough cubics. */
export function roughPath(path: readonly PathCommand[], o: RoughOptions): PathCommand[] {
  const ops: PathCommand[] = [];
  let first: Pt = [0, 0];
  let current: Pt = [0, 0];
  for (const c of path) {
    if (c[0] === "M") {
      current = [c[1], c[2]];
      first = [c[1], c[2]];
    } else if (c[0] === "L") {
      ops.push(...roughLine(current[0], current[1], c[1], c[2], o));
      current = [c[1], c[2]];
    } else if (c[0] === "C") {
      ops.push(...bezierTo(c[1], c[2], c[3], c[4], c[5], c[6], current, o));
      current = [c[5], c[6]];
    } else {
      if (current[0] !== first[0] || current[1] !== first[1]) ops.push(...roughLine(current[0], current[1], first[0], first[1], o));
      current = first;
    }
  }
  return ops;
}

/** A Catmull-Rom spline through points as cubics (rough.js's `_curve`, tightness 0). */
function curve(points: Pt[]): PathCommand[] {
  const ops: PathCommand[] = [];
  if (points.length > 3) {
    ops.push(["M", points[1][0], points[1][1]]);
    for (let i = 1; i + 2 < points.length; i++) {
      const p = points[i];
      ops.push([
        "C",
        p[0] + (points[i + 1][0] - points[i - 1][0]) / 6,
        p[1] + (points[i + 1][1] - points[i - 1][1]) / 6,
        points[i + 1][0] + (p[0] - points[i + 2][0]) / 6,
        points[i + 1][1] + (p[1] - points[i + 2][1]) / 6,
        points[i + 1][0],
        points[i + 1][1],
      ]);
    }
  } else if (points.length >= 2) ops.push(["M", points[0][0], points[0][1]], ["L", points[points.length - 1][0], points[points.length - 1][1]]);
  return ops;
}

/** The ellipse's points, jittered, starting at a random angle and overlapping past it (rough.js's `_computeEllipsePoints`). */
function ellipsePoints(increment: number, cx: number, cy: number, rx: number, ry: number, off: number, overlap: number, o: RoughOptions, toDoc: (p: Pt) => Pt): Pt[] {
  const points: Pt[] = [];
  const at = (k: number, angle: number): Pt => toDoc([offsetOpt(off, o) + cx + k * rx * Math.cos(angle), offsetOpt(off, o) + cy + k * ry * Math.sin(angle)]);
  const start = offsetOpt(0.5, o) - Math.PI / 2;
  points.push(at(0.9, start - increment));
  const end = Math.PI * 2 + start - 0.01;
  for (let angle = start; angle < end; angle += increment) points.push(at(1, angle));
  points.push(at(1, start + Math.PI * 2 + overlap * 0.5));
  points.push(at(0.98, start + overlap));
  points.push(at(0.9, start + overlap * 0.5));
  return points;
}

/**
 * A rough ellipse (rough.js's `ellipse`, Excalidraw's curve fitting of 1): two overlapping passes around it. `toDoc`
 * turns and places its own coordinates (centred on 0, upright) on the canvas.
 */
export function roughEllipse(width: number, height: number, o: RoughOptions, toDoc: (p: Pt) => Pt): PathCommand[] {
  // rough.js counts steps in its pixels: in the offset's scale here, so a shape has as many as it would there.
  const k = Math.max(1, o.maxRandomnessOffset / 2);
  const psq = Math.sqrt(Math.PI * 2 * Math.sqrt(((width / 2 / k) ** 2 + (height / 2 / k) ** 2) / 2));
  const steps = Math.ceil(Math.max(o.curveStepCount, (o.curveStepCount / Math.sqrt(200)) * psq));
  const increment = (Math.PI * 2) / steps;
  const rx = Math.abs(width / 2);
  const ry = Math.abs(height / 2);
  const ops = curve(ellipsePoints(increment, 0, 0, rx, ry, 1 * k, increment * offset(0.1, offset(0.4, 1, o), o), o, toDoc));
  if (!o.disableMultiStroke && o.roughness) ops.push(...curve(ellipsePoints(increment, 0, 0, rx, ry, 1.5 * k, 0, o, toDoc)));
  return ops;
}

/** A polygon filled by hand (rough.js's `solidFillPolygon`): its corners wander a little. */
export function roughFillPolygon(points: readonly Pt[], o: RoughOptions): PathCommand[] {
  if (points.length < 3) return [];
  const off = o.maxRandomnessOffset;
  return [["M", points[0][0] + offsetOpt(off, o), points[0][1] + offsetOpt(off, o)], ...points.slice(1).map((p): PathCommand => ["L", p[0] + offsetOpt(off, o), p[1] + offsetOpt(off, o)]), ["Z"]];
}

/**
 * Hachure (rough.js's scan-line filler): parallel lines `gap` apart at `angle` degrees across the polygon (even-odd),
 * each drawn as a rough line.
 */
export function hachure(points: readonly Pt[], gap: number, angle: number, o: RoughOptions): PathCommand[] {
  if (points.length < 3 || gap <= 0) return [];
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Turned so the lines are level: scan rows `gap` apart, pair the crossings.
  const turned = points.map(([x, y]): Pt => [x * cos + y * sin, -x * sin + y * cos]);
  const ys = turned.map((p) => p[1]);
  const ops: PathCommand[] = [];
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  // rough.js sometimes starts a gap down (skipOffset), so neighbouring shapes don't line up.
  const start = top + (o.roughness >= 1 && o.random.next() > 0.7 ? gap : gap / 2);
  for (let y = start; y < bottom; y += gap) {
    const xs: number[] = [];
    for (let i = 0; i < turned.length; i++) {
      const [x1, y1] = turned[i];
      const [x2, y2] = turned[(i + 1) % turned.length];
      if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const back = (x: number): Pt => [x * cos - y * sin, x * sin + y * cos];
      const [p, q] = [back(xs[i]), back(xs[i + 1])];
      ops.push(...roughLine(p[0], p[1], q[0], q[1], o));
    }
  }
  return ops;
}
