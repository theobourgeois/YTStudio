/**
 * The layer effects (fx) of a layer's style (docs/photo/layer-style/README.md, phases L2 and L3): each one's parameters
 * as Photoshop's Layer Style pages show them, with Photoshop's factory defaults (shadows-and-glows.md, "Defaults";
 * stroke-satin-overlays.md; bevel-emboss.md), in Photoshop's units (percentages 0..100, pixels, degrees). Their order is the drawing
 * order (dialog.md, "The drawing order": bottom to top); what each draws is `reference/style.ts` (and the GPU's
 * `render/style.ts`).
 */
import { BLEND_MODES } from "../blending.ts";
import type { BlendParam, BooleanParam, ChoiceParam, ColourParam, ContourParam, GradientParam, NumberParam, ParamSpec, PatternParam } from "../effects/params.ts";
import type { EffectParamValue } from "../types.ts";
import { LINEAR_CONTOUR } from "./contours.ts";
import { DEFAULT_GRADIENT, GRADIENT_PRESETS } from "./gradients.ts";
import { BUILT_IN_PATTERNS, DEFAULT_PATTERN } from "./patterns.ts";

export type StyleType = "drop-shadow" | "outer-glow" | "pattern-overlay" | "gradient-overlay" | "color-overlay" | "satin" | "inner-glow" | "inner-shadow" | "stroke" | "bevel-emboss";

export interface StyleDefinition {
  type: StyleType;
  /** Bumped when what its parameters mean changes. */
  version: number;
  label: string;
  /** For the assistant. */
  description: string;
  /** How many a layer can have (Photoshop's + button: 10 of five of them). */
  max: number;
  /** Outside the layer's shape (drawn under it), inside it (over its pixels), the stroke (over them), or the bevel (over everything). */
  side: "outside" | "inside" | "stroke" | "top";
  /** Pages of its own under it in the list (Bevel's Contour): its parameters in that group, turned on by `toggle`. */
  subPages?: readonly { group: string; label: string; toggle: string }[];
  /** Its parameters Scale Effects multiplies (sizes, distances, a pattern's scale). */
  scaled: readonly string[];
  /** Its patterns' placements: which parameters say where each pattern lies (the canvas drag moves its phase). */
  patterns?: readonly PatternKeys[];
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
const angle = (def = 120, group = "Structure", description = "Where the light comes from: degrees anticlockwise from 3 o'clock (the shadow falls the other way).") => num("angle", "Angle", "°", -180, 180, def, description, group);
const globalLight = (group = "Structure", description = "Follow (and set) the document's one light angle.") => bool("globalLight", "Use Global Light", true, description, group);
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

/** The parameters that place a pattern: which pattern, its Angle, Scale, Link with Layer and phase (pixels). */
export interface PatternKeys {
  pattern: string;
  angle: string;
  scale: string;
  link: string;
  phaseX: string;
  phaseY: string;
  /** While this shows it (a stroke's Pattern fill, Bevel's Texture page). */
  showIf?: ChoiceParam["showIf"];
}

const patternSpec = (key: string, group: string, showIf?: PatternParam["showIf"]): PatternParam => ({
  kind: "pattern",
  key,
  label: "Pattern",
  default: DEFAULT_PATTERN,
  description: `Which pattern: one of the document's (their ids are in get_photo) or a built-in one (${BUILT_IN_PATTERNS.map((p) => p.id).join(", ")}).`,
  group,
  showIf,
});

/** A pattern's controls, Photoshop's: the pattern, Angle, Scale, Link with Layer, and its phase (dragged on the canvas, Snap to Origin zeroes it). */
const patternParams = (k: PatternKeys, group: string): ParamSpec[] => [
  patternSpec(k.pattern, group, k.showIf),
  { ...num(k.angle, "Angle", "°", -180, 180, 0, "Turns the pattern: degrees anticlockwise.", group), showIf: k.showIf },
  { ...num(k.scale, "Scale", "%", 1, 1000, 100, "The pattern's size.", group), showIf: k.showIf },
  bool(k.link, "Link with Layer", true, "The pattern moves with the layer (off: it stays on the canvas).", group, k.showIf),
  { ...num(k.phaseX, "Offset X", "px", -30000, 30000, 0, "Where the pattern starts across, in pixels (drag it on the canvas; Snap to Origin: 0).", group), showIf: k.showIf },
  { ...num(k.phaseY, "Offset Y", "px", -30000, 30000, 0, "Where the pattern starts down, in pixels.", group), showIf: k.showIf },
];

const OVERLAY_PATTERN: PatternKeys = { pattern: "pattern", angle: "angle", scale: "scale", link: "link", phaseX: "phaseX", phaseY: "phaseY" };
const STROKE_PATTERN: PatternKeys = { pattern: "pattern", angle: "patternAngle", scale: "patternScale", link: "patternLink", phaseX: "phaseX", phaseY: "phaseY", showIf: { key: "fill", is: "pattern" } };
const TEXTURE_PATTERN: PatternKeys = { pattern: "texture", angle: "textureAngle", scale: "textureScale", link: "textureLink", phaseX: "texturePhaseX", phaseY: "texturePhaseY" };

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

const bevelStyles: [string, string][] = [
  ["outer-bevel", "Outer Bevel"],
  ["inner-bevel", "Inner Bevel"],
  ["emboss", "Emboss"],
  ["pillow-emboss", "Pillow Emboss"],
  ["stroke-emboss", "Stroke Emboss"],
];

const bevelParams: ParamSpec[] = [
  choice("style", "Style", bevelStyles, "inner-bevel", "Where the bevel is: outside the edge, inside it, both ways (Emboss), a groove along it (Pillow Emboss), or on the layer's Stroke (Stroke Emboss, which needs one).", "Structure"),
  choice("technique", "Technique", [["smooth", "Smooth"], ["chisel-hard", "Chisel Hard"], ["chisel-soft", "Chisel Soft"]], "smooth", "Smooth rounds the edge (a blur); Chisel Hard cuts a flat facet by distance (keeps corners); Chisel Soft the same, rougher.", "Structure"),
  num("depth", "Depth", "%", 1, 1000, 100, "How steep its slopes are (100%: 45° for Smooth).", "Structure"),
  choice("direction", "Direction", [["up", "Up"], ["down", "Down"]], "up", "Raised (Up) or sunk (Down): swaps the highlight and the shadow.", "Structure", true),
  size(5),
  num("soften", "Soften", "px", 0, 16, 0, "Blurs the bevel's shape, in pixels.", "Structure"),
  angle(120, "Shading", "Where the light comes from: degrees anticlockwise from 3 o'clock."),
  globalLight("Shading", "Follow (and set) the document's light: its angle and altitude."),
  num("altitude", "Altitude", "°", 0, 90, 30, "How high the light is: 0 grazes the surface, 90 is straight above.", "Shading"),
  { ...contour("Shading"), key: "gloss", label: "Gloss Contour", description: `Remaps the light for a glossy or metallic look. ${contour().description}` },
  bool("antiAliasGloss", "Anti-aliased", false, "Smooths the steps a steep gloss contour makes.", "Shading"),
  { ...blend("screen", "Shading"), key: "highlightMode", label: "Highlight Mode", description: "How the highlight mixes." },
  { ...colour("#ffffff", "The highlight's colour.", "Shading"), key: "highlightColour", label: "Highlight Colour" },
  { ...opacity(75, "Shading"), key: "highlightOpacity", label: "Highlight Opacity", description: "How strong the highlight is." },
  { ...blend("multiply", "Shading"), key: "shadowMode", label: "Shadow Mode", description: "How the shadow mixes." },
  { ...colour("#000000", "The shadow's colour.", "Shading"), key: "shadowColour", label: "Shadow Colour" },
  { ...opacity(75, "Shading"), key: "shadowOpacity", label: "Shadow Opacity", description: "How strong the shadow is." },
  bool("useContour", "Contour", false, "Shapes the bevel's profile with a contour (its sub-page).", "Contour"),
  { ...contour("Contour"), description: `The bevel's profile from the edge in: its ridges and valleys. ${contour().description}` },
  antiAliased("Contour"),
  num("range", "Range", "%", 1, 100, 50, "How much of the profile the contour spans: under 100% steepens it.", "Contour"),
  bool("useTexture", "Texture", false, "Presses a pattern into the bevel's surface (its sub-page).", "Texture"),
  ...patternParams(TEXTURE_PATTERN, "Texture").filter((s) => s.key !== "textureAngle"),
  num("textureDepth", "Depth", "%", -1000, 1000, 100, "How deep the texture is pressed: dark parts rise (negative: light ones).", "Texture"),
  bool("invertTexture", "Invert", false, "Raises the light parts instead of the dark.", "Texture"),
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
    scaled: ["distance", "size"],
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
    scaled: ["size"],
    reach: (p) => n(p, "size") + 4,
    summary: (p) => `${label(p.mode)} ${p.fill === "gradient" ? "gradient" : p.colour}, ${n(p, "opacity")}%, size ${n(p, "size")} ${p.technique}`,
  },
  {
    type: "pattern-overlay",
    version: 1,
    label: "Pattern Overlay",
    description: "Fills the layer's pixels with a pattern, tiled.",
    max: 1,
    side: "inside",
    params: [blend("normal", "Pattern"), opacity(100, "Pattern"), ...patternParams(OVERLAY_PATTERN, "Pattern")],
    scaled: ["scale"],
    patterns: [OVERLAY_PATTERN],
    reach: () => 0,
    summary: (p) => `${label(p.mode)}, ${n(p, "opacity")}%, ${p.pattern} at ${n(p, "scale")}%${n(p, "angle") ? `, ${n(p, "angle")}°` : ""}`,
  },
  {
    type: "gradient-overlay",
    version: 1,
    label: "Gradient Overlay",
    description: "Fills the layer's pixels with a gradient.",
    max: 10,
    side: "inside",
    params: [blend("normal", "Gradient"), bool("dither", "Dither", false, "Noise against banding (the export dithers already).", "Gradient"), opacity(100, "Gradient"), gradient("Gradient"), ...gradientGeometry(false)],
    scaled: [],
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
    scaled: [],
    reach: () => 0,
    summary: (p) => `${label(p.mode)} ${p.colour}, ${n(p, "opacity")}%`,
  },
  {
    type: "satin",
    version: 1,
    label: "Satin",
    description: "Silky shading inside the layer: two blurred copies of its shape, offset either way and differenced.",
    max: 1,
    side: "inside",
    params: [
      blend("multiply"),
      colour("#000000"),
      opacity(50),
      num("angle", "Angle", "°", -180, 180, 19, "Which way the two copies are offset: degrees anticlockwise from 3 o'clock.", "Structure"),
      num("distance", "Distance", "px", 0, 250, 11, "How far each copy is offset, in pixels.", "Structure"),
      size(14),
      { ...contour("Structure"), description: `Remaps the satin's strength. ${contour().description}` },
      antiAliased("Structure"),
      bool("invert", "Invert", true, "Shades where the copies agree rather than where they differ.", "Structure"),
    ],
    scaled: ["distance", "size"],
    reach: () => 0,
    summary: (p) => `${label(p.mode)} ${p.colour}, ${n(p, "opacity")}%, ${n(p, "distance")} px at ${n(p, "angle")}°, size ${n(p, "size")}${p.invert ? ", inverted" : ""}`,
  },
  {
    type: "inner-glow",
    version: 1,
    label: "Inner Glow",
    description: "Light (or colour) inside the layer's edges, or from its centre.",
    max: 1,
    side: "inside",
    params: glowParams(true),
    scaled: ["size"],
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
    scaled: ["distance", "size"],
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
      choice("fill", "Fill Type", [["colour", "Color"], ["gradient", "Gradient"], ["pattern", "Pattern"]], "colour", "A colour, a gradient or a pattern.", "Fill"),
      colour("#000000", "Its colour.", "Fill", { key: "fill", is: "colour" }),
      gradient("Fill", { key: "fill", is: "gradient" }),
      ...gradientGeometry(true, { key: "fill", is: "gradient" }),
      ...patternParams(STROKE_PATTERN, "Fill"),
    ],
    scaled: ["size", "patternScale"],
    patterns: [STROKE_PATTERN],
    reach: (p) => (p.position === "inside" ? 1 : p.position === "center" ? n(p, "size") / 2 + 2 : n(p, "size") + 2),
    summary: (p) => `${n(p, "size")} px ${p.position}, ${p.fill === "gradient" ? "gradient" : p.colour}, ${n(p, "opacity")}%`,
  },
  {
    type: "bevel-emboss",
    version: 1,
    label: "Bevel & Emboss",
    description: "Lights the layer's edges as if raised (or sunk): a highlight on the slopes facing the light, a shadow on the others. Drawn over every other effect.",
    max: 1,
    side: "top",
    params: bevelParams,
    subPages: [
      { group: "Contour", label: "Contour", toggle: "useContour" },
      { group: "Texture", label: "Texture", toggle: "useTexture" },
    ],
    scaled: ["size", "soften", "textureScale"],
    patterns: [{ ...TEXTURE_PATTERN, showIf: { key: "useTexture", is: true } }],
    // Outer Bevel, Emboss and Pillow Emboss light outside the shape; Stroke Emboss as far as a stroke goes.
    reach: (p) => (p.style === "inner-bevel" ? 1 : p.style === "emboss" || p.style === "pillow-emboss" ? n(p, "size") / 2 + n(p, "soften") + 3 : n(p, "size") + n(p, "soften") + 3),
    summary: (p) => `${bevelStyles.find(([v]) => v === p.style)?.[1] ?? p.style}, ${String(p.technique).replace("-", " ")}, ${n(p, "depth")}% ${p.direction}, size ${n(p, "size")}${n(p, "soften") ? `, soften ${n(p, "soften")}` : ""}, light ${n(p, "angle")}° / ${n(p, "altitude")}°${p.useContour ? `, contour ${(p.contour as { name: string }).name} at ${n(p, "range")}%` : ""}`,
  },
];

export const styleDefinition = (type: string): StyleDefinition | undefined => STYLE_DEFINITIONS.find((d) => d.type === type);

/** Photoshop's Layer Style list, top to bottom (the drawing order reversed). */
export const STYLE_LIST: readonly StyleType[] = ["bevel-emboss", "stroke", "inner-shadow", "inner-glow", "satin", "color-overlay", "gradient-overlay", "pattern-overlay", "outer-glow", "drop-shadow"];

/** Where a type is drawn: its place in the drawing order (bottom first). */
export const drawOrder = (type: string) => {
  const i = STYLE_DEFINITIONS.findIndex((d) => d.type === type);
  return i < 0 ? STYLE_DEFINITIONS.length : i;
};
