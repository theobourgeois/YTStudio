/**
 * Gradients (docs/photo/layer-style/stroke-satin-overlays.md, "Gradient Overlay"): their stops, how they mix between
 * them, and where a Gradient Overlay or a gradient stroke puts them. Classic is measured (photoshop-measurements.md,
 * "Satin and gradients": at 100% smoothness the mix is the average of linear and smoothstep, on encoded values);
 * Linear mixes linear light and Perceptual OKLab, as Adobe says.
 */
import { linearToSrgb, srgbToLinear } from "../colour.ts";
import type { Gradient, GradientColourStop, GradientOpacityStop } from "../types.ts";

const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

const stops = (colours: [number, string][], opacities: [number, number][] = [
  [0, 1],
  [1, 1],
]): Pick<Gradient, "colours" | "opacities"> => ({ colours: colours.map(([at, colour]) => ({ at, colour })), opacities: opacities.map(([at, opacity]) => ({ at, opacity })) });

/** The gradient picker's presets. */
export const GRADIENT_PRESETS: readonly Gradient[] = [
  { name: "Black, White", method: "classic", ...stops([[0, "#000000"], [1, "#ffffff"]]) },
  { name: "White, Transparent", method: "classic", ...stops([[0, "#ffffff"], [1, "#ffffff"]], [[0, 1], [1, 0]]) },
  { name: "Black, Transparent", method: "classic", ...stops([[0, "#000000"], [1, "#000000"]], [[0, 1], [1, 0]]) },
  { name: "Violet, Orange", method: "classic", ...stops([[0, "#290a59"], [1, "#ff7c00"]]) },
  { name: "Blue, Red, Yellow", method: "classic", ...stops([[0, "#0a00b2"], [0.5, "#ff0000"], [1, "#fffc00"]]) },
  { name: "Copper", method: "classic", ...stops([[0, "#97461a"], [0.3, "#fbd8c5"], [0.83, "#6c2e16"], [1, "#efdbcd"]]) },
  { name: "Chrome", method: "classic", ...stops([[0, "#292a2e"], [0.4, "#f7f7f7"], [0.5, "#1a1b1f"], [0.6, "#7e8287"], [1, "#ffffff"]]) },
  {
    name: "Spectrum",
    method: "classic",
    ...stops([
      [0, "#ff0000"],
      [0.17, "#ffff00"],
      [0.33, "#00ff00"],
      [0.5, "#00ffff"],
      [0.67, "#0000ff"],
      [0.83, "#ff00ff"],
      [1, "#ff0000"],
    ]),
  },
];

export const DEFAULT_GRADIENT = GRADIENT_PRESETS[0];
export const gradientPreset = (name: string): Gradient | undefined => GRADIENT_PRESETS.find((g) => g.name.toLowerCase() === name.toLowerCase());

const unit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);

/** A gradient checked: stops on 0..1 in order (at least one of each kind), colours "#rrggbb"; a bad one is Black, White. */
export function sanitizeGradient(value: unknown): { value: Gradient; repaired: boolean } {
  if (!value || typeof value !== "object") return { value: DEFAULT_GRADIENT, repaired: true };
  const v = value as Record<string, unknown>;
  let repaired = false;
  const colours: GradientColourStop[] = [];
  for (const s of Array.isArray(v.colours) ? v.colours : []) {
    const q = s as Record<string, unknown>;
    if (!q || !isColour(q.colour)) {
      repaired = true;
      continue;
    }
    colours.push({ at: unit(q.at, 0), colour: (q.colour as string).toLowerCase(), ...(q.mid !== undefined && unit(q.mid, 0.5) !== 0.5 ? { mid: Math.max(0.05, Math.min(0.95, unit(q.mid, 0.5))) } : {}) });
  }
  const opacities: GradientOpacityStop[] = [];
  for (const s of Array.isArray(v.opacities) ? v.opacities : []) {
    const q = s as Record<string, unknown>;
    if (!q || typeof q.opacity !== "number") {
      repaired = true;
      continue;
    }
    opacities.push({ at: unit(q.at, 0), opacity: unit(q.opacity, 1), ...(q.mid !== undefined && unit(q.mid, 0.5) !== 0.5 ? { mid: Math.max(0.05, Math.min(0.95, unit(q.mid, 0.5))) } : {}) });
  }
  if (!colours.length) return { value: DEFAULT_GRADIENT, repaired: true };
  if (!opacities.length) {
    opacities.push({ at: 0, opacity: 1 }, { at: 1, opacity: 1 });
    repaired = true;
  }
  colours.sort((a, b) => a.at - b.at);
  opacities.sort((a, b) => a.at - b.at);
  const method = v.method === "linear" || v.method === "perceptual" || v.method === "classic" || v.method === "smooth" || v.method === "stripes" ? v.method : "classic";
  if (method !== v.method) repaired = true;
  const name = typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 64) : "Custom";
  return { value: { name, colours, opacities, method }, repaired };
}

const hex = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Classic's ease between two stops (measured): halfway between a straight line and smoothstep. */
const classicEase = (t: number) => 0.5 * t + 0.5 * t * t * (3 - 2 * t);

/** Where `t` falls between stops `a` and `b`, as a fraction, with the midpoint making half at `mid`. */
function between(t: number, a: number, b: number, mid = 0.5): number {
  if (b <= a) return t >= b ? 1 : 0;
  const f = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return f < mid ? (0.5 * f) / mid : 0.5 + (0.5 * (f - mid)) / (1 - mid);
}

function bracket<S extends { at: number; mid?: number }>(list: readonly S[], t: number): { a: S; b: S; f: number } {
  if (t <= list[0].at) return { a: list[0], b: list[0], f: 0 };
  for (let i = 1; i < list.length; i++) if (t <= list[i].at) return { a: list[i - 1], b: list[i], f: between(t, list[i - 1].at, list[i].at, list[i - 1].mid) };
  const last = list[list.length - 1];
  return { a: last, b: last, f: 0 };
}

// OKLab (Björn Ottosson), from and to linear sRGB.
function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const mix3 = (a: [number, number, number], b: [number, number, number], f: number): [number, number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** Smooth's ease (the Gradient tool's Method, ours: docs/photo/tools/gradient.md): smoothstep, level at every stop. */
const smoothEase = (t: number) => t * t * (3 - 2 * t);

/**
 * The gradient at `t` in [0, 1]: its straight colour, sRGB-encoded, and its opacity. Smooth mixes as Perceptual
 * does, eased so nothing turns a corner at a stop; Stripes doesn't mix: each stretch is the colour (and opacity) of
 * the stop it ends at, the first stop's before it (Photoshop's, as seen: a two-stop one is all its second colour).
 */
export function gradientAt(g: Gradient, t: number): [number, number, number, number] {
  const c = bracket(g.colours, t);
  const o = bracket(g.opacities, t);
  if (g.method === "stripes") return [...hex(c.b.colour), o.b.opacity];
  const ease = g.method === "classic" ? classicEase : g.method === "smooth" ? smoothEase : (f: number) => f;
  let rgb: [number, number, number];
  const ca = hex(c.a.colour);
  const cb = hex(c.b.colour);
  const f = ease(c.f);
  if (g.method === "classic") rgb = mix3(ca, cb, f);
  else if (g.method === "linear") rgb = mix3(ca.map(srgbToLinear) as [number, number, number], cb.map(srgbToLinear) as [number, number, number], f).map(linearToSrgb) as [number, number, number];
  else rgb = fromOklab(mix3(toOklab(ca.map(srgbToLinear) as [number, number, number]), toOklab(cb.map(srgbToLinear) as [number, number, number]), f)).map((v) => linearToSrgb(Math.max(0, Math.min(1, v)))) as [number, number, number];
  const opacity = o.a.opacity + (o.b.opacity - o.a.opacity) * ease(o.f);
  return [rgb[0], rgb[1], rgb[2], opacity];
}

/** The size of a gradient's table on the GPU. */
export const GRADIENT_TABLE_SIZE = 1024;

/** The gradient sampled at `size` points over [0, 1] (reversed with `reverse`): straight encoded RGB and opacity, RGBA. */
export function gradientTable(g: Gradient, reverse = false, size = GRADIENT_TABLE_SIZE): Float32Array {
  const out = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) out.set(gradientAt(g, reverse ? 1 - i / (size - 1) : i / (size - 1)), i * 4);
  return out;
}

export type GradientStyle = "linear" | "radial" | "angle" | "reflected" | "diamond" | "shape-burst";

/** A box in document pixels: what a gradient is laid out on (the layer's bounds, or the canvas). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where a Gradient Overlay's gradient lies (libpsd's construction, as Krita's, without its rounding): the box's
 * centre moved by the offset (percentages of the box), and the vector from it to where the line at `angle` leaves
 * the box scaled by `scale` (%). Angles are anticlockwise from 3 o'clock, y down.
 */
export function gradientLayout(box: Box, angle: number, scale: number, offset: { x: number; y: number }) {
  const W = box.x1 - box.x0;
  const H = box.y1 - box.y0;
  const cx = (box.x0 + box.x1) / 2 + (W * offset.x) / 100;
  const cy = (box.y0 + box.y1) / 2 + (H * offset.y) / 100;
  const w = (W * scale) / 200;
  const h = (H * scale) / 200;
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  // Where the ray from the centre leaves the scaled box.
  const tx = Math.abs(dx) > 1e-9 ? w / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(dy) > 1e-9 ? h / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const k = Math.min(tx, ty);
  return { cx, cy, rx: dx * k, ry: dy * k };
}

/**
 * The gradient's position at document point (x, y) for a style (0 at the gradient's start, 1 at its end), before
 * Reverse. Linear runs from centre − r to centre + r; Radial out to |r|; Angle anticlockwise from r; Reflected
 * from the centre out both ways; Diamond out to |r| along r's square. Shape Burst is a stroke's and comes from
 * distance, not this.
 */
export function gradientPosition(style: GradientStyle, layout: ReturnType<typeof gradientLayout>, x: number, y: number): number {
  const px = x - layout.cx;
  const py = y - layout.cy;
  const rr = layout.rx * layout.rx + layout.ry * layout.ry || 1;
  const along = (px * layout.rx + py * layout.ry) / rr;
  switch (style) {
    case "radial":
      return Math.min(1, Math.hypot(px, py) / Math.sqrt(rr));
    case "angle": {
      // Anticlockwise on screen (y down), from r.
      const a0 = Math.atan2(-layout.ry, layout.rx);
      const a = Math.atan2(-py, px);
      const d = (a - a0) / (2 * Math.PI);
      return d - Math.floor(d);
    }
    case "reflected":
      return Math.min(1, Math.abs(along));
    case "diamond": {
      const across = (px * -layout.ry + py * layout.rx) / rr;
      return Math.min(1, Math.abs(along) + Math.abs(across));
    }
    default:
      return Math.max(0, Math.min(1, 0.5 + along / 2));
  }
}
