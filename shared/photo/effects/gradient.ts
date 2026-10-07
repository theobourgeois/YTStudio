/**
 * The Gradient Fill (docs/photo/tools/gradient.md): a generator layer, the Gradient tool's live gradient (Photoshop's
 * since 24.x, a Gradient Fill layer made by a drag and edited on the canvas afterwards). Its gradient (the Layer
 * Style's `Gradient`: colour and opacity stops, midpoints, a method) is laid along the line from `start` to `end`, in
 * document pixels, in one of Photoshop's five types; Reverse runs it the other way and Dither adds a little noise so
 * no 8-bit result bands.
 *
 * Every pixel is a closed-form function of its document point (`gradientFillAt`, the CPU reference in
 * `../reference/gradient.ts`, which the GPU's `render/gradient.ts` mirrors), so tiles, regions and exports agree,
 * and the same numbers paint a Classic gradient into a layer's pixels or its mask.
 */
import { hash2 } from "../output.ts";
import { type GradientStyle, GRADIENT_PRESETS, gradientLayout, gradientPosition, gradientPreset, sanitizeGradient } from "../style/gradients.ts";
import type { DocPoint, EffectParamValue, Gradient } from "../types.ts";
import type { EffectPreset, ParamSpec } from "./params.ts";

/** The generator's type. */
export const GRADIENT_FILL = "gradient-fill";

/** Photoshop's five gradient types, in its options bar's order. */
export const GRADIENT_TYPES = ["linear", "radial", "angle", "reflected", "diamond"] as const;
export type GradientType = (typeof GRADIENT_TYPES)[number];

export const GRADIENT_TYPE_LABELS: Record<GradientType, string> = { linear: "Linear", radial: "Radial", angle: "Angle", reflected: "Reflected", diamond: "Diamond" };

export const isGradientType = (v: unknown): v is GradientType => typeof v === "string" && (GRADIENT_TYPES as readonly string[]).includes(v);

/** What each type does with the line, for the assistant and the tool's tips. */
export const GRADIENT_TYPE_DESCRIPTIONS: Record<GradientType, string> = {
  linear: "from the start to the end in a straight line",
  radial: "from the start outwards in a circle whose radius is the line",
  angle: "anticlockwise around the start, from the line's direction",
  reflected: "the linear gradient mirrored on both sides of the start",
  diamond: "from the start out to a diamond whose corner is the end",
};

const point = (key: string, label: string, at: DocPoint, description: string): ParamSpec => ({ kind: "point", key, label, default: at, nullable: false, handle: true, description });

export const GRADIENT_FILL_PARAMS: readonly ParamSpec[] = [
  {
    kind: "gradient",
    key: "gradient",
    label: "Gradient",
    default: GRADIENT_PRESETS[0],
    description:
      'The gradient: { name, colours: [{ at, colour, mid? }], opacities: [{ at, opacity, mid? }], method }. Stops at 0..1 along the line (colour "#rrggbb", opacity 0..1); mid is where between a stop and the next the mix is half (0.05..0.95, absent 0.5); method "perceptual" (Photoshop\'s default: even to the eye), "linear" (in linear light, as light mixes), "classic" (Photoshop\'s older, on encoded values, eased), "smooth" (eased through every stop) or "stripes" (each stop\'s colour up to the next, no mixing).',
  },
  {
    kind: "choice",
    key: "style",
    label: "Type",
    options: GRADIENT_TYPES.map((value) => ({ value, label: GRADIENT_TYPE_LABELS[value] })),
    default: "linear",
    description: `Photoshop's gradient types: ${GRADIENT_TYPES.map((t) => `${t} (${GRADIENT_TYPE_DESCRIPTIONS[t]})`).join("; ")}.`,
  },
  point("start", "Start", [0, 960], "Where the gradient starts (its first stop), in document pixels: a handle on the canvas."),
  point("end", "End", [1080, 960], "Where it ends (its last stop), in document pixels: a handle on the canvas. Past the ends it keeps the ends' colours."),
  { kind: "boolean", key: "reverse", label: "Reverse", default: false, description: "Runs the gradient from its last stop to its first." },
  { kind: "boolean", key: "dither", label: "Dither", default: true, description: "Adds noise of under one 8-bit level, so a smooth gradient never shows bands once it's 8 bits." },
];

/** The gradient across a canvas, left to right through its middle (where a new one starts). */
export const acrossCanvas = (canvas: { width: number; height: number }): { start: DocPoint; end: DocPoint } => ({ start: [0, canvas.height / 2], end: [canvas.width, canvas.height / 2] });

/** The catalogue's looks (the Filter menu and gallery, `add_generator`'s `preset`): each stock gradient, across the canvas. */
export const GRADIENT_FILL_PRESETS: readonly EffectPreset[] = GRADIENT_PRESETS.map((g) => ({
  id: g.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  label: g.name,
  description: `${g.name}, left to right across the canvas.`,
  params: (canvas) => ({ gradient: structuredClone(g), ...acrossCanvas(canvas) }),
}));

const percent = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** A gradient as the model reads it: its name, method, colour stops (and midpoints) and opacity stops. */
export function describeGradient(g: Gradient): string {
  const colours = g.colours.map((s) => `${s.colour} at ${percent(s.at)}${s.mid !== undefined ? ` (midpoint ${percent(s.mid)})` : ""}`).join(", ");
  const opaque = g.opacities.every((s) => s.opacity === 1);
  const opacities = opaque ? "opaque" : `opacity ${g.opacities.map((s) => `${percent(s.opacity)} at ${percent(s.at)}${s.mid !== undefined ? ` (midpoint ${percent(s.mid)})` : ""}`).join(", ")}`;
  return `"${g.name}" (${g.method}): ${colours}; ${opacities}`;
}

/**
 * A gradient the model gave: a stock one by name or id ("Copper", "black-white"), or its stops, checked. Throws a
 * message saying what's wanted.
 */
export function gradientInput(v: unknown, name = "gradient"): Gradient {
  if (typeof v === "string") {
    const g = gradientPreset(v) ?? GRADIENT_PRESETS.find((p) => GRADIENT_FILL_PRESETS.find((f) => f.label === p.name)?.id === v.toLowerCase());
    if (!g) throw new Error(`No gradient "${v}". The stock ones: ${GRADIENT_PRESETS.map((p) => `"${p.name}"`).join(", ")}; or give its stops.`);
    return structuredClone(g);
  }
  if (!v || typeof v !== "object" || !Array.isArray((v as { colours?: unknown }).colours) || !(v as { colours: unknown[] }).colours.length)
    throw new Error(`${name} must be a stock gradient's name or { "colours": [{ "at": 0, "colour": "#rrggbb" }, …], "opacities": [{ "at": 0, "opacity": 1 }, …], "method": "perceptual" }; got ${JSON.stringify(v)}.`);
  return sanitizeGradient({ name: "Custom", method: "perceptual", ...(v as object) }).value;
}

/** A Gradient Fill's numbers, for the GPU and the reference. */
export interface GradientFillShape {
  style: GradientType;
  start: DocPoint;
  end: DocPoint;
  gradient: Gradient;
  reverse: boolean;
  dither: boolean;
}

export function gradientFillShape(params: Record<string, EffectParamValue>): GradientFillShape {
  return {
    style: isGradientType(params.style) ? params.style : "linear",
    start: params.start as DocPoint,
    end: params.end as DocPoint,
    gradient: params.gradient as Gradient,
    reverse: params.reverse === true,
    dither: params.dither !== false,
  };
}

/**
 * Where a tool's line puts the Gradient Overlay's layout (`gradientLayout`'s centre and vector), so the overlay's
 * `gradientPosition` reads it: Linear's centre is the line's middle and its vector half the line (it runs from
 * centre − r to centre + r); the others start at the start, their vector the whole line.
 */
export function lineLayout(style: GradientType, start: DocPoint, end: DocPoint): ReturnType<typeof gradientLayout> {
  const [sx, sy] = start;
  const [ex, ey] = end;
  if (style === "linear") return { cx: (sx + ex) / 2, cy: (sy + ey) / 2, rx: (ex - sx) / 2, ry: (ey - sy) / 2 };
  return { cx: sx, cy: sy, rx: ex - sx, ry: ey - sy };
}

/**
 * The gradient's position at document point (x, y): 0 at its start, 1 at its end, held at the ends, before Reverse.
 * A line of no length is all its last stop (Photoshop draws nothing for a click; a layer that has one shows its end).
 */
export function gradientT(style: GradientType, start: DocPoint, end: DocPoint, x: number, y: number): number {
  if (start[0] === end[0] && start[1] === end[1]) return 1;
  return gradientPosition(style as GradientStyle, lineLayout(style, start, end), x, y);
}

/**
 * Dither's offset at a document pixel, in 8-bit levels: triangular on (−1, 1) (two of the output's hashes, seeded
 * apart from its own dither), so its mean is 0 and a smooth ramp quantises without bands.
 */
export function gradientDither(px: number, py: number): number {
  const a = (hash2(px, (py ^ 0x9e3779b9) >>> 0) >>> 8) / 16777216;
  const b = (hash2(px, (py ^ 0x85ebca6b) >>> 0) >>> 8) / 16777216;
  return a + b - 1;
}
