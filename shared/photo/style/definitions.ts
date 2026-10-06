/**
 * The layer effects (fx) of a layer's style (docs/photo/layer-style/README.md, phase L2): each one's parameters as
 * Photoshop's Layer Style pages show them, with Photoshop's factory defaults (shadows-and-glows.md, "Defaults";
 * stroke-satin-overlays.md), in Photoshop's units (percentages 0..100, pixels, degrees). Their order is the drawing
 * order (dialog.md, "The drawing order": bottom to top); what each draws is `reference/style.ts` (and the GPU's
 * `render/style.ts`).
 */
import { BLEND_MODES } from "../blending.ts";
import type { BlendParam, BooleanParam, ChoiceParam, ColourParam, ContourParam, GradientParam, NumberParam, ParamSpec } from "../effects/params.ts";
import type { EffectParamValue } from "../types.ts";
import { LINEAR_CONTOUR } from "./contours.ts";
import { DEFAULT_GRADIENT, GRADIENT_PRESETS } from "./gradients.ts";

export type StyleType = "drop-shadow" | "outer-glow" | "gradient-overlay" | "color-overlay" | "inner-glow" | "inner-shadow" | "stroke";

export interface StyleDefinition {
  type: StyleType;
  /** Bumped when what its parameters mean changes. */
  version: number;
  label: string;
  /** For the assistant. */
  description: string;
  /** How many a layer can have (Photoshop's + button: 10 of five of them). */
  max: number;
  /** Outside the layer's shape (drawn under it), inside it (over its pixels), or the stroke (over everything). */
  side: "outside" | "inside" | "stroke";
  params: readonly ParamSpec[];
  /** How far past the layer's pixels it reaches, in document pixels (what its fields need around the layer). */
  reach: (p: Record<string, EffectParamValue>) => number;
  /** Its settings in a few words. */
  summary: (p: Record<string, EffectParamValue>) => string;
}

const num = (key: string, label: string, unit: string, min: number, max: number, def: number, description: string, group?: string): NumberParam => ({
  kind: "number",
  key,
  label,
  unit,
  min,
  max,
  step: 1,
  decimals: 0,
  default: def,
  description,
  group,
});
const blend = (def: BlendParam["default"], group = "Structure"): BlendParam => ({ kind: "blend", key: "mode", label: "Blend Mode", default: def, description: `How it mixes (${BLEND_MODES.map((m) => m.id).join(", ")}).`, group });
const colour = (def: string, description = "Its colour.", group = "Structure", showIf?: ColourParam["showIf"]): ColourParam => ({ kind: "colour", key: "colour", label: "Colour", default: def, description, group, showIf });
const opacity = (def: number, group = "Structure") => num("opacity", "Opacity", "%", 0, 100, def, "How strong it is.", group);
const bool = (key: string, label: string, def: boolean, description: string, group?: string, showIf?: BooleanParam["showIf"]): BooleanParam => ({ kind: "boolean", key, label, default: def, description, group, showIf });
const choice = (key: string, label: string, options: [string, string][], def: string, description: string, group?: string, radio = false, showIf?: ChoiceParam["showIf"]): ChoiceParam => ({
  kind: "choice",
  key,
  label,
  options: options.map(([value, label]) => ({ value, label })),
  default: def,
  description,
  group,
  radio,
  showIf,
});
const contour = (group = "Quality"): ContourParam => ({
  kind: "contour",
  key: "contour",
  label: "Contour",
  default: LINEAR_CONTOUR,
  description: 'How the falloff is shaped: a preset name ("Linear", "Cone", "Cone - Inverted", "Cove - Deep", "Cove - Shallow", "Gaussian", "Half Round", "Ring", "Ring - Double", "Rolling Slope - Descending", "Rounded Steps", "Sawtooth 1") or points on 0..255.',
  group,
});
const gradient = (group = "Structure", showIf?: GradientParam["showIf"], def = DEFAULT_GRADIENT): GradientParam => ({
  kind: "gradient",
  key: "gradient",
  label: "Gradient",
  default: def,
  description: `Colour stops { at 0..1, colour "#rrggbb" } and opacity stops { at, opacity 0..1 }, and the method (classic, linear, perceptual); or a preset (${GRADIENT_PRESETS.map((g) => g.name).join(", ")}).`,
  group,
  showIf,
});
const antiAliased = (group = "Quality") => bool("antiAliased", "Anti-aliased", false, "Smooths the steps a steep contour makes.", group);
const noise = (group = "Quality") => num("noise", "Noise", "%", 0, 100, 0, "Grain in its opacity.", group);
const angle = (def = 120) => num("angle", "Angle", "°", -180, 180, def, "Where the light comes from: degrees anticlockwise from 3 o'clock (the shadow falls the other way).", "Structure");
const globalLight = () => bool("globalLight", "Use Global Light", true, "Follow (and set) the document's one light angle.", "Structure");
const size = (def: number, group = "Structure") => num("size", "Size", "px", 0, 250, def, "How far it reaches, in pixels.", group);

const n = (p: Record<string, EffectParamValue>, k: string) => p[k] as number;
const label = (mode: unknown) => BLEND_MODES.find((m) => m.id === mode)?.label ?? String(mode);

const shadowParams = (inner: boolean): ParamSpec[] => [
  blend("multiply"),
  colour("#000000"),
  opacity(35),
  angle(),
  globalLight(),
  num("distance", "Distance", "px", 0, 30000, 3, "How far it's offset, in pixels.", "Structure"),
  inner ? num("choke", "Choke", "%", 0, 100, 0, "The share of Size that shrinks the edge before it softens.", "Structure") : num("spread", "Spread", "%", 0, 100, 0, "The share of Size that grows the edge before it softens.", "Structure"),
  size(7),
  contour(),
  antiAliased(),
  noise(),
  ...(inner ? [] : [bool("knocksOut", "Layer Knocks Out Drop Shadow", true, "Hides the shadow under the layer's own shape, even when its Fill is low.")]),
];

const glowParams = (inner: boolean): ParamSpec[] => [
  blend("screen"),
  opacity(35),
  noise("Structure"),
  choice("fill", "Fill", [["colour", "Colour"], ["gradient", "Gradient"]], "colour", "A colour, or a gradient across the glow (its start at the edge).", "Structure", true),
  colour("#ffffff", "Its colour.", "Structure", { key: "fill", is: "colour" }),
  gradient("Structure", { key: "fill", is: "gradient" }, GRADIENT_PRESETS[1]),
  choice("technique", "Technique", [["softer", "Softer"], ["precise", "Precise"]], "softer", "Softer blurs the edge; Precise measures distance from it (keeps corners).", "Elements"),
  ...(inner ? [choice("source", "Source", [["center", "Center"], ["edge", "Edge"]], "edge", "From the inside edges, or from the centre out.", "Elements", true)] : []),
  inner ? num("choke", "Choke", "%", 0, 100, 0, "The share of Size that shrinks the edge before it softens.", "Elements") : num("spread", "Spread", "%", 0, 100, 0, "The share of Size that grows the edge before it softens.", "Elements"),
  size(7, "Elements"),
  contour(),
  antiAliased(),
  num("range", "Range", "%", 1, 100, 50, "Which part of the falloff the contour spans.", "Quality"),
  num("jitter", "Jitter", "%", 0, 100, 0, "Scatters the gradient's colours.", "Quality"),
];

const gradientGeometry = (shapeBurst: boolean, showIf?: ChoiceParam["showIf"]): ParamSpec[] => [
  bool("reverse", "Reverse", false, "Flips the gradient.", "Gradient", showIf),
  choice(
    "style",
    "Style",
    [["linear", "Linear"], ["radial", "Radial"], ["angle", "Angle"], ["reflected", "Reflected"], ["diamond", "Diamond"], ...(shapeBurst ? ([["shape-burst", "Shape Burst"]] as [string, string][]) : [])],
    "linear",
    "The gradient's shape.",
    "Gradient",
    false,
    showIf,
  ),
  bool("align", "Align with Layer", true, "Laid out on the layer's bounds (off: the canvas).", "Gradient", showIf),
  { ...num("angle", "Angle", "°", -180, 180, 90, "Its direction: degrees anticlockwise from 3 o'clock.", "Gradient"), showIf },
  { ...num("scale", "Scale", "%", 10, 150, 100, "Its length.", "Gradient"), showIf },
  { ...num("offsetX", "Offset X", "%", -100, 100, 0, "Its centre moved across, in % of the box (drag on the canvas).", "Gradient"), showIf },
  { ...num("offsetY", "Offset Y", "%", -100, 100, 0, "Its centre moved down, in % of the box.", "Gradient"), showIf },
];

export const STYLE_DEFINITIONS: readonly StyleDefinition[] = [
  {
    type: "drop-shadow",
    version: 1,
    label: "Drop Shadow",
    description: "A shadow under the layer, offset away from the light.",
    max: 10,
    side: "outside",
    params: shadowParams(false),
    reach: (p) => n(p, "size") + n(p, "distance") + 4,
    summary: (p) => `${label(p.mode)} ${p.colour}, ${n(p, "opacity")}%, ${n(p, "distance")} px at ${n(p, "angle")}°, size ${n(p, "size")}`,
  },
  {
    type: "outer-glow",
    version: 1,
    label: "Outer Glow",
    description: "Light (or colour) around the layer's edges, outside it.",
    max: 1,
    side: "outside",
    params: glowParams(false),
    reach: (p) => n(p, "size") + 4,
    summary: (p) => `${label(p.mode)} ${p.fill === "gradient" ? "gradient" : p.colour}, ${n(p, "opacity")}%, size ${n(p, "size")} ${p.technique}`,
  },
  {
    type: "gradient-overlay",
    version: 1,
    label: "Gradient Overlay",
    description: "Fills the layer's pixels with a gradient.",
    max: 10,
    side: "inside",
    params: [blend("normal", "Gradient"), bool("dither", "Dither", false, "Noise against banding (the export dithers already).", "Gradient"), opacity(100, "Gradient"), gradient("Gradient"), ...gradientGeometry(false)],
    reach: () => 0,
    summary: (p) => `${label(p.mode)}, ${n(p, "opacity")}%, ${p.style} at ${n(p, "angle")}°`,
  },
  {
    type: "color-overlay",
    version: 1,
    label: "Color Overlay",
    description: "Fills the layer's pixels with a colour.",
    max: 10,
    side: "inside",
    params: [blend("normal", "Color"), colour("#ff0000", "Its colour.", "Color"), opacity(100, "Color")],
    reach: () => 0,
    summary: (p) => `${label(p.mode)} ${p.colour}, ${n(p, "opacity")}%`,
  },
  {
    type: "inner-glow",
    version: 1,
    label: "Inner Glow",
    description: "Light (or colour) inside the layer's edges, or from its centre.",
    max: 1,
    side: "inside",
    params: glowParams(true),
    reach: (p) => n(p, "size") + 4,
    summary: (p) => `${label(p.mode)} ${p.fill === "gradient" ? "gradient" : p.colour}, ${n(p, "opacity")}%, size ${n(p, "size")} from the ${p.source}`,
  },
  {
    type: "inner-shadow",
    version: 1,
    label: "Inner Shadow",
    description: "A shadow inside the layer's edges, as if it were cut out.",
    max: 10,
    side: "inside",
    params: shadowParams(true),
    reach: (p) => n(p, "size") + n(p, "distance") + 4,
    summary: (p) => `${label(p.mode)} ${p.colour}, ${n(p, "opacity")}%, ${n(p, "distance")} px at ${n(p, "angle")}°, size ${n(p, "size")}`,
  },
  {
    type: "stroke",
    version: 1,
    label: "Stroke",
    description: "An outline along the layer's edges.",
    max: 10,
    side: "stroke",
    params: [
      num("size", "Size", "px", 1, 250, 3, "Its width, in pixels.", "Structure"),
      choice("position", "Position", [["outside", "Outside"], ["inside", "Inside"], ["center", "Center"]], "outside", "Outside the edge, inside it, or across it.", "Structure"),
      blend("normal"),
      opacity(100),
      bool("overprint", "Overprint", false, "Blends with the layer's pixels rather than covering them.", "Structure"),
      choice("fill", "Fill Type", [["colour", "Color"], ["gradient", "Gradient"]], "colour", "A colour, or a gradient.", "Fill"),
      colour("#000000", "Its colour.", "Fill", { key: "fill", is: "colour" }),
      gradient("Fill", { key: "fill", is: "gradient" }),
      ...gradientGeometry(true, { key: "fill", is: "gradient" }),
    ],
    reach: (p) => (p.position === "inside" ? 1 : p.position === "center" ? n(p, "size") / 2 + 2 : n(p, "size") + 2),
    summary: (p) => `${n(p, "size")} px ${p.position}, ${p.fill === "gradient" ? "gradient" : p.colour}, ${n(p, "opacity")}%`,
  },
];

export const styleDefinition = (type: string): StyleDefinition | undefined => STYLE_DEFINITIONS.find((d) => d.type === type);

/** Photoshop's Layer Style list, top to bottom (the drawing order reversed). */
export const STYLE_LIST: readonly StyleType[] = ["stroke", "inner-shadow", "inner-glow", "color-overlay", "gradient-overlay", "outer-glow", "drop-shadow"];

/** Where a type is drawn: its place in the drawing order (bottom first). */
export const drawOrder = (type: string) => {
  const i = STYLE_DEFINITIONS.findIndex((d) => d.type === type);
  return i < 0 ? STYLE_DEFINITIONS.length : i;
};
