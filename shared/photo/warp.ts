/**
 * Warp (Photoshop's Edit › Transform › Warp, docs/photo/ux.md "Warp"): a layer's pixels bent through a bicubic Bézier
 * patch before its place takes them to the document. The patch's 4 × 4 control points are in the layer's own
 * normalised coordinates (0..1 across and down; the identity has them at the thirds), row by row, top first. Warp
 * Styles (Arc, Bulge, Flag, Twist…) are functions of a bend and Photoshop's horizontal and vertical distortion, fitted
 * to the patch by least squares, so any style's points can then be dragged as a custom warp. The GPU inverts the
 * patch per pixel by Newton's method (`WARP_WGSL`), as `unwarp` does here. Pure.
 */

/** A point in the layer's normalised coordinates. */
export type WarpPoint = [number, number];

/** Photoshop's Warp Styles (its menu's order). */
export const WARP_STYLES = ["arc", "arc-lower", "arc-upper", "arch", "bulge", "shell-lower", "shell-upper", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze", "twist"] as const;
export type WarpStyle = (typeof WARP_STYLES)[number];

export const WARP_STYLE_LABELS: Record<WarpStyle, string> = {
  arc: "Arc",
  "arc-lower": "Arc Lower",
  "arc-upper": "Arc Upper",
  arch: "Arch",
  bulge: "Bulge",
  "shell-lower": "Shell Lower",
  "shell-upper": "Shell Upper",
  flag: "Flag",
  wave: "Wave",
  fish: "Fish",
  rise: "Rise",
  fisheye: "Fisheye",
  inflate: "Inflate",
  squeeze: "Squeeze",
  twist: "Twist",
};

/** A Warp Style's settings: Bend and the distortions in percent (−100..100), and which way it bends. */
export interface WarpStyleSettings {
  style: WarpStyle;
  bend: number;
  horizontal: number;
  vertical: number;
  orientation: "horizontal" | "vertical";
}

/**
 * A layer's warp: its patch's 16 control points, and the style they were made from (null once they've been dragged:
 * Photoshop's Custom).
 */
export interface LayerWarp {
  points: WarpPoint[];
  style: WarpStyleSettings | null;
}

/** The 16 points that warp nothing. */
export function identityPoints(): WarpPoint[] {
  const out: WarpPoint[] = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) out.push([i / 3, j / 3]);
  return out;
}

/** Whether a warp changes nothing (within a millionth). */
export const isIdentityWarp = (w: LayerWarp | undefined) => !w || w.points.every((p, k) => Math.abs(p[0] - (k % 4) / 3) < 1e-6 && Math.abs(p[1] - Math.floor(k / 4) / 3) < 1e-6);

/** The cubic Bernstein weights at t, and their derivatives. */
function bernstein(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [s * s * s, 3 * t * s * s, 3 * t * t * s, t * t * t];
}
function bernsteinDerivative(t: number): [number, number, number, number] {
  const s = 1 - t;
  return [-3 * s * s, 3 * s * s - 6 * t * s, 6 * t * s - 3 * t * t, 3 * t * t];
}

/** Where the patch takes normalised point (u, v). */
export function warpPoint(points: readonly WarpPoint[], u: number, v: number): WarpPoint {
  const bu = bernstein(u);
  const bv = bernstein(v);
  let x = 0;
  let y = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const w = bu[i] * bv[j];
      const p = points[j * 4 + i];
      x += w * p[0];
      y += w * p[1];
    }
  }
  return [x, y];
}

/** The patch's derivatives at (u, v): ∂/∂u and ∂/∂v. */
function warpJacobian(points: readonly WarpPoint[], u: number, v: number): [number, number, number, number] {
  const bu = bernstein(u);
  const bv = bernstein(v);
  const du = bernsteinDerivative(u);
  const dv = bernsteinDerivative(v);
  let xu = 0;
  let yu = 0;
  let xv = 0;
  let yv = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const p = points[j * 4 + i];
      xu += du[i] * bv[j] * p[0];
      yu += du[i] * bv[j] * p[1];
      xv += bu[i] * dv[j] * p[0];
      yv += bu[i] * dv[j] * p[1];
    }
  }
  return [xu, yu, xv, yv];
}

/** How the patch scales area at (u, v) (its Jacobian's determinant: negative where it folds over). */
export function warpArea(points: readonly WarpPoint[], u: number, v: number): number {
  const [xu, yu, xv, yv] = warpJacobian(points, u, v);
  return xu * yv - xv * yu;
}

/**
 * The normalised point the patch takes to (x, y), or null when none does (outside it, or where Newton's method
 * doesn't settle: a fold). Starts from the bilinear patch of its corners, as the GPU does.
 */
export function unwarp(points: readonly WarpPoint[], x: number, y: number): WarpPoint | null {
  // The four corners' bilinear patch first (its own Newton steps), then the Bézier's.
  let u = 0.5;
  let v = 0.5;
  const c = [points[0], points[3], points[15], points[12]];
  for (let k = 0; k < 8; k++) {
    const bx = (1 - u) * (1 - v) * c[0][0] + u * (1 - v) * c[1][0] + u * v * c[2][0] + (1 - u) * v * c[3][0] - x;
    const by = (1 - u) * (1 - v) * c[0][1] + u * (1 - v) * c[1][1] + u * v * c[2][1] + (1 - u) * v * c[3][1] - y;
    const xu = (1 - v) * (c[1][0] - c[0][0]) + v * (c[2][0] - c[3][0]);
    const yu = (1 - v) * (c[1][1] - c[0][1]) + v * (c[2][1] - c[3][1]);
    const xv = (1 - u) * (c[3][0] - c[0][0]) + u * (c[2][0] - c[1][0]);
    const yv = (1 - u) * (c[3][1] - c[0][1]) + u * (c[2][1] - c[1][1]);
    const det = xu * yv - xv * yu;
    if (!det) break;
    u -= (yv * bx - xv * by) / det;
    v -= (-yu * bx + xu * by) / det;
  }
  for (let k = 0; k < 12; k++) {
    const p = warpPoint(points, u, v);
    const fx = p[0] - x;
    const fy = p[1] - y;
    if (Math.abs(fx) < 1e-10 && Math.abs(fy) < 1e-10) break;
    const [xu, yu, xv, yv] = warpJacobian(points, u, v);
    const det = xu * yv - xv * yu;
    if (!det) return null;
    u -= (yv * fx - xv * fy) / det;
    v -= (-yu * fx + xu * fy) / det;
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  }
  const p = warpPoint(points, u, v);
  if (Math.hypot(p[0] - x, p[1] - y) > 1e-6) return null;
  const e = 1e-9;
  return u >= -e && v >= -e && u <= 1 + e && v <= 1 + e ? [u, v] : null;
}

/** The patch's outline, `steps` points a side, clockwise from the top-left (normalised). */
export function warpOutline(points: readonly WarpPoint[], steps = 16): WarpPoint[] {
  const out: WarpPoint[] = [];
  for (let k = 0; k < steps; k++) out.push(warpPoint(points, k / steps, 0));
  for (let k = 0; k < steps; k++) out.push(warpPoint(points, 1, k / steps));
  for (let k = 0; k < steps; k++) out.push(warpPoint(points, 1 - k / steps, 1));
  for (let k = 0; k < steps; k++) out.push(warpPoint(points, 0, 1 - k / steps));
  return out;
}

/** The box around the patch (its control points': a Bézier patch is inside their hull), normalised. */
export function warpBox(points: readonly WarpPoint[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// --- Warp Styles ---

/** A style as a map of the unit square, centred (x, y in −½..½), y down; `b` the bend (−1..1). */
function styleMap(style: WarpStyle, b: number): (x: number, y: number) => WarpPoint {
  const half = Math.PI / 2;
  switch (style) {
    case "arc":
    case "arc-lower":
    case "arc-upper": {
      // Around a circle below (a positive bend: a rainbow), the middle line keeping its length; Lower and Upper bend
      // from one edge, the other staying straight.
      if (Math.abs(b) < 1e-6) return (x, y) => [x, y];
      const angle = b * Math.PI * 0.75;
      const radius = 1 / angle;
      const arc = (x: number, y: number): WarpPoint => {
        const a = x * angle;
        const r = radius - y;
        return [r * Math.sin(a), radius - r * Math.cos(a)];
      };
      if (style === "arc") return arc;
      return (x, y) => {
        const t = style === "arc-lower" ? y + 0.5 : 0.5 - y;
        const [ax, ay] = arc(x, y);
        return [x + (ax - x) * t, y + (ay - y) * t];
      };
    }
    case "shell-lower":
      // The bottom edge arcs and the top narrows (a shell's).
      return (x, y) => [x * (1 - b * 0.4 * (0.5 - y)), y - b * 0.5 * (1 - 4 * x * x) * (y + 0.5)];
    case "shell-upper":
      return (x, y) => [x * (1 - b * 0.4 * (0.5 + y)), y - b * 0.5 * (1 - 4 * x * x) * (0.5 - y)];
    case "arch":
      // The top and bottom edges arch, the sides stay upright.
      return (x, y) => [x, y - b * 0.5 * (1 - 4 * x * x)];
    case "bulge":
      return (x, y) => [x, y + b * (1 - 4 * x * x) * y];
    case "flag":
      return (x, y) => [x, y - b * 0.2 * Math.sin(2 * Math.PI * (x + 0.5))];
    case "wave":
      return (x, y) => [x, y - b * 0.2 * Math.sin(2 * Math.PI * (x + 0.5) + Math.PI * (y + 0.5) * 0.5)];
    case "fish":
      // Swollen in the middle, pinched at the right like a tail.
      return (x, y) => [x, y + b * 0.8 * y * Math.sin(Math.PI * (x + 0.5)) * (0.75 - x * 0.5)];
    case "rise":
      return (x, y) => [x, y - b * 0.3 * Math.sin(Math.PI * x)];
    case "fisheye":
      return (x, y) => {
        const r = Math.min(1, 2 * Math.hypot(x, y));
        const k = 1 + b * 0.5 * (1 - r * r);
        return [x * k, y * k];
      };
    case "inflate":
      return (x, y) => {
        const k = 1 + b * 0.5 * (1 - 4 * x * x) * (1 - 4 * y * y);
        return [x * k, y * k];
      };
    case "squeeze":
      return (x, y) => [x * (1 - b * 0.5 * (1 - 4 * y * y)), y * (1 + b * 0.25 * (1 - 4 * x * x))];
    case "twist":
      return (x, y) => {
        const r = Math.min(1, 2 * Math.hypot(x, y));
        const a = b * half * (1 - r) * (1 - r);
        const [c, s] = [Math.cos(a), Math.sin(a)];
        return [x * c - y * s, x * s + y * c];
      };
  }
}

/** A style's map of the unit square (0..1), with its distortions and orientation. */
export function styleFunction(settings: WarpStyleSettings): (u: number, v: number) => WarpPoint {
  const b = Math.max(-1, Math.min(1, settings.bend / 100));
  const h = Math.max(-1, Math.min(1, settings.horizontal / 100)) * 0.5;
  const vd = Math.max(-1, Math.min(1, settings.vertical / 100)) * 0.5;
  const map = styleMap(settings.style, b);
  const vertical = settings.orientation === "vertical";
  return (u, v) => {
    // Centred, turned for a vertical style (it bends the other way round), then the style, then turned back.
    let [x, y] = vertical ? [v - 0.5, -(u - 0.5)] : [u - 0.5, v - 0.5];
    [x, y] = map(x, y);
    if (vertical) [x, y] = [-y, x];
    // Photoshop's distortions: a keystone across (the right side taller for positive) and down.
    const kx = 1 + h * 2 * x;
    const ky = 1 + vd * 2 * y;
    return [x * ky + 0.5, y * kx + 0.5];
  };
}

/** The least-squares fit of the 16 control points to a map of the unit square, sampled on a grid. */
let fitMatrix: number[][] | null = null;
const FIT_SAMPLES = 13;

/** (AᵀA)⁻¹Aᵀ for the Bernstein basis on the sample grid: fitting is then a product. */
function fitter(): number[][] {
  if (fitMatrix) return fitMatrix;
  const rows: number[][] = [];
  for (let j = 0; j < FIT_SAMPLES; j++) {
    for (let i = 0; i < FIT_SAMPLES; i++) {
      const bu = bernstein(i / (FIT_SAMPLES - 1));
      const bv = bernstein(j / (FIT_SAMPLES - 1));
      const row: number[] = [];
      for (let q = 0; q < 4; q++) for (let p = 0; p < 4; p++) row.push(bu[p] * bv[q]);
      rows.push(row);
    }
  }
  // AᵀA (16 × 16), inverted by Gauss–Jordan.
  const n = 16;
  const ata = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => rows.reduce((s, row) => s + row[r] * row[c], 0)));
  const inv = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)));
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(ata[r][c]) > Math.abs(ata[pivot][c])) pivot = r;
    [ata[c], ata[pivot]] = [ata[pivot], ata[c]];
    [inv[c], inv[pivot]] = [inv[pivot], inv[c]];
    const d = ata[c][c];
    for (let k = 0; k < n; k++) {
      ata[c][k] /= d;
      inv[c][k] /= d;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = ata[r][c];
      if (!f) continue;
      for (let k = 0; k < n; k++) {
        ata[r][k] -= f * ata[c][k];
        inv[r][k] -= f * inv[c][k];
      }
    }
  }
  fitMatrix = inv.map((r) => rows.map((row) => row.reduce((s, a, k) => s + r[k] * a, 0)));
  return fitMatrix;
}

/** A Warp Style's control points. */
export function stylePoints(settings: WarpStyleSettings): WarpPoint[] {
  const f = styleFunction(settings);
  const samples: WarpPoint[] = [];
  for (let j = 0; j < FIT_SAMPLES; j++) for (let i = 0; i < FIT_SAMPLES; i++) samples.push(f(i / (FIT_SAMPLES - 1), j / (FIT_SAMPLES - 1)));
  return fitter().map((row) => {
    let x = 0;
    let y = 0;
    row.forEach((w, k) => {
      x += w * samples[k][0];
      y += w * samples[k][1];
    });
    return [clean(x), clean(y)] as WarpPoint;
  });
}

const clean = (v: number) => {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};

/** A warp from a style. */
export const styleWarp = (settings: WarpStyleSettings): LayerWarp => ({ points: stylePoints(settings), style: { ...settings } });

/** The farthest a control point may be from the layer (in its own sizes). */
export const WARP_REACH = 4;

/**
 * A warp from an untrusted value (a document, the assistant): 16 finite points within `WARP_REACH`, and a style when
 * it's a known one (then the points are its own). Null when it isn't one, or warps nothing.
 */
export function normalizeWarp(value: unknown): LayerWarp | null {
  if (!value || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  const s = w.style as Record<string, unknown> | null | undefined;
  const style = s && typeof s === "object" && (WARP_STYLES as readonly string[]).includes(s.style as string) ? normalizeStyle(s) : null;
  if (style) return isIdentityWarp(styleWarp(style)) ? null : styleWarp(style);
  if (!Array.isArray(w.points) || w.points.length !== 16) return null;
  const points: WarpPoint[] = [];
  for (const p of w.points) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((c) => typeof c === "number" && Number.isFinite(c) && Math.abs(c) <= WARP_REACH)) return null;
    points.push([p[0], p[1]]);
  }
  const warp: LayerWarp = { points, style: null };
  return isIdentityWarp(warp) ? null : warp;
}

function normalizeStyle(s: Record<string, unknown>): WarpStyleSettings {
  const pct = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : fallback);
  return { style: s.style as WarpStyle, bend: pct(s.bend, 50), horizontal: pct(s.horizontal, 0), vertical: pct(s.vertical, 0), orientation: s.orientation === "vertical" ? "vertical" : "horizontal" };
}

/** Two warps the same (points within a billionth, the same style). */
export function sameWarp(a: LayerWarp | undefined, b: LayerWarp | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.points.every((p, k) => p[0] === b.points[k][0] && p[1] === b.points[k][1]) && JSON.stringify(a.style) === JSON.stringify(b.style);
}

/**
 * WGSL: a layer's warp as its passes read it (`warp: array<vec4f, 8>`, two points a vec4, row by row), and
 * `unwarp(p)`: the normalised point the patch takes to `p`, with .z 1 where there is one (0 outside or on a fold).
 * The same steps as `unwarp` here: the corners' bilinear patch, then the Bézier's.
 */
export const WARP_WGSL = /* wgsl */ `
fn warp_point_at(w: array<vec4f, 8>, k: u32) -> vec2f {
  let v = w[k / 2u];
  return select(v.xy, v.zw, (k & 1u) == 1u);
}
fn bern(t: f32) -> vec4f {
  let s = 1.0 - t;
  return vec4f(s * s * s, 3.0 * t * s * s, 3.0 * t * t * s, t * t * t);
}
fn bern_d(t: f32) -> vec4f {
  let s = 1.0 - t;
  return vec4f(-3.0 * s * s, 3.0 * s * s - 6.0 * t * s, 6.0 * t * s - 3.0 * t * t, 3.0 * t * t);
}
// The patch at (u, v) (.xy) and its derivatives (∂u in .zw of the second, ∂v in its .xy... see below).
struct WarpEval { p: vec2f, du: vec2f, dv: vec2f }
fn warp_eval(w: array<vec4f, 8>, u: f32, v: f32) -> WarpEval {
  let bu = bern(u);
  let bv = bern(v);
  let du = bern_d(u);
  let dv = bern_d(v);
  var out = WarpEval(vec2f(0.0), vec2f(0.0), vec2f(0.0));
  for (var j = 0u; j < 4u; j++) {
    for (var i = 0u; i < 4u; i++) {
      let p = warp_point_at(w, j * 4u + i);
      out.p += bu[i] * bv[j] * p;
      out.du += du[i] * bv[j] * p;
      out.dv += bu[i] * dv[j] * p;
    }
  }
  return out;
}
// The normalised point the patch takes to p (.xy), .z 1 when it's found inside the patch, and .w the patch's area
// there (its Jacobian's determinant).
fn unwarp(w: array<vec4f, 8>, p: vec2f) -> vec4f {
  let c0 = warp_point_at(w, 0u);
  let c1 = warp_point_at(w, 3u);
  let c2 = warp_point_at(w, 15u);
  let c3 = warp_point_at(w, 12u);
  var uv = vec2f(0.5);
  for (var k = 0; k < 8; k++) {
    let f = (1.0 - uv.x) * (1.0 - uv.y) * c0 + uv.x * (1.0 - uv.y) * c1 + uv.x * uv.y * c2 + (1.0 - uv.x) * uv.y * c3 - p;
    let du = (1.0 - uv.y) * (c1 - c0) + uv.y * (c2 - c3);
    let dv = (1.0 - uv.x) * (c3 - c0) + uv.x * (c2 - c1);
    let det = du.x * dv.y - dv.x * du.y;
    if (det == 0.0) { break; }
    uv -= vec2f(dv.y * f.x - dv.x * f.y, -du.y * f.x + du.x * f.y) / det;
  }
  var e = warp_eval(w, uv.x, uv.y);
  for (var k = 0; k < 12; k++) {
    let f = e.p - p;
    let det = e.du.x * e.dv.y - e.dv.x * e.du.y;
    if (det == 0.0) { return vec4f(0.0); }
    uv -= vec2f(e.dv.y * f.x - e.dv.x * f.y, -e.du.y * f.x + e.du.x * f.y) / det;
    e = warp_eval(w, uv.x, uv.y);
  }
  let found = length(e.p - p) < 1e-3 && all(uv >= vec2f(-1e-4)) && all(uv <= vec2f(1.0 + 1e-4));
  return vec4f(uv, select(0.0, 1.0, found), e.du.x * e.dv.y - e.dv.x * e.du.y);
}
`;
