/**
 * Shape layers (After Effects'): a clip without media that draws vector shapes. Its
 * contents are effects, in the order they apply: shapes (each with its own fill and
 * stroke), and operators that change every shape before them (Trim Paths, Repeater,
 * Offset Paths, Wiggle Paths, Zig Zag, Merge Paths, Round Corners). How they're drawn is
 * in `shared/shapes.ts`; the geometry is `shared/path.ts` and `shared/shape-ops.ts`.
 *
 * Sizes and distances are px of the canvas at 1080p (like text sizes); a shape's
 * position and a drawn path's points are fractions of the layer's frame, which is the
 * canvas at 100%.
 */
import type { EffectDefinition } from "../effects.ts";
import { PERCENT, PIXELS, type ParamSpec } from "../params.ts";
import { polygonPath } from "../path.ts";
import type { ParamValues } from "../types.ts";

const isShape: EffectDefinition["appliesTo"] = (c) => c.kind === "shape";

const kindIs = (...kinds: string[]) => (v: ParamValues) => !kinds.includes(v.kind as string);
const off = (key: string) => (v: ParamValues) => !((v[key] as number) > 0);

const POINTS: ParamSpec = {
  kind: "choice",
  key: "points",
  label: "Points",
  default: "corner",
  options: [
    { value: "corner", label: "Corner" },
    { value: "smooth", label: "Smooth" },
  ],
};

const LINE_JOIN: ParamSpec = {
  kind: "choice",
  key: "lineJoin",
  label: "Line Join",
  default: "miter",
  options: [
    { value: "miter", label: "Miter" },
    { value: "round", label: "Round" },
    { value: "bevel", label: "Bevel" },
  ],
};

/** One shape of a shape layer: what it is, where, and how it's painted. */
export const SHAPE: EffectDefinition = {
  type: "vector-shape",
  label: "Shape",
  builtIn: false,
  // The layer is its shapes: there's nothing to bypass them to.
  alwaysOn: true,
  stackable: "shape",
  appliesTo: isShape,
  params: [
    {
      kind: "choice",
      key: "kind",
      label: "Shape",
      default: "rectangle",
      options: [
        { value: "rectangle", label: "Rectangle" },
        { value: "ellipse", label: "Ellipse" },
        { value: "polygon", label: "Polygon" },
        { value: "star", label: "Star" },
        { value: "path", label: "Path" },
      ],
    },
    // Drawn with the pen tool, in fractions of the layer's frame.
    {
      kind: "path",
      key: "path",
      label: "Path",
      default: polygonPath([[0.35, 0.4], [0.65, 0.4], [0.65, 0.6], [0.35, 0.6]], true),
      hiddenFor: kindIs("path"),
    },
    { kind: "vec2", key: "position", label: "Position", default: [0.5, 0.5], space: "media", min: -10, max: 10, step: 1, decimals: 1, hiddenFor: kindIs("rectangle", "ellipse", "polygon", "star") },
    { kind: "vec2", key: "size", label: "Size", default: [400, 400], space: "px", min: 0, max: 20_000, step: 1, decimals: 0, hiddenFor: kindIs("rectangle", "ellipse", "polygon", "star") },
    { kind: "number", key: "rotation", label: "Rotation", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1, hiddenFor: kindIs("rectangle", "ellipse", "polygon", "star") },
    { kind: "number", key: "points", label: "Points", default: 5, min: 3, max: 64, step: 1, decimals: 0, hiddenFor: kindIs("polygon", "star") },
    { kind: "number", key: "innerRadius", label: "Inner Radius", default: 0.5, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0, hiddenFor: kindIs("star") },
    { kind: "number", key: "roundness", label: "Roundness", default: 0, min: 0, max: 5000, ...PIXELS, hiddenFor: kindIs("rectangle", "polygon", "star", "path") },
    { kind: "boolean", key: "fill", label: "Fill", default: true },
    { kind: "color", key: "fillColor", label: "Fill Color", default: "#ffffff", disabledFor: (v) => v.fill !== true },
    { kind: "number", key: "fillOpacity", label: "Fill Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0, disabledFor: (v) => v.fill !== true },
    {
      kind: "choice",
      key: "gradient",
      label: "Gradient",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "linear", label: "Linear" },
        { value: "radial", label: "Radial" },
      ],
      disabledFor: (v) => v.fill !== true,
    },
    // The fill colour runs into this one: along the angle, or from the middle outwards.
    { kind: "color", key: "gradientColor", label: "Gradient End", default: "#61afef", hiddenFor: (v) => v.gradient === "none" },
    { kind: "number", key: "gradientAngle", label: "Gradient Angle", default: 90, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1, hiddenFor: (v) => v.gradient !== "linear" },
    { kind: "number", key: "strokeWidth", label: "Stroke", default: 0, min: 0, max: 2000, ...PIXELS, step: 0.5, decimals: 1 },
    { kind: "color", key: "strokeColor", label: "Stroke Color", default: "#000000", disabledFor: off("strokeWidth") },
    { kind: "number", key: "strokeOpacity", label: "Stroke Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0, disabledFor: off("strokeWidth") },
    { ...LINE_JOIN, disabledFor: off("strokeWidth") },
    {
      kind: "choice",
      key: "lineCap",
      label: "Line Cap",
      default: "butt",
      options: [
        { value: "butt", label: "Butt" },
        { value: "round", label: "Round" },
        { value: "square", label: "Square" },
      ],
      disabledFor: off("strokeWidth"),
    },
    // 0 is a solid line.
    { kind: "number", key: "dash", label: "Dash", default: 0, min: 0, max: 5000, ...PIXELS, disabledFor: off("strokeWidth") },
    { kind: "number", key: "gap", label: "Gap", default: 0, min: 0, max: 5000, ...PIXELS, disabledFor: (v) => off("strokeWidth")(v) || off("dash")(v) },
    { kind: "number", key: "dashOffset", label: "Dash Offset", default: 0, min: -100_000, max: 100_000, ...PIXELS, disabledFor: (v) => off("strokeWidth")(v) || off("dash")(v) },
  ],
};

/** A shape operator: changes every shape before it on a shape layer. */
function operator(type: string, label: string, params: ParamSpec[]): EffectDefinition {
  return { type, label, builtIn: false, stackable: "shape", appliesTo: isShape, params };
}

export const TRIM_PATHS = operator("trim-paths", "Trim Paths", [
  { kind: "number", key: "start", label: "Start", default: 0, min: 0, max: 1, slider: true, ...PERCENT },
  { kind: "number", key: "end", label: "End", default: 1, min: 0, max: 1, slider: true, ...PERCENT },
  { kind: "number", key: "offset", label: "Offset", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
  {
    kind: "choice",
    key: "mode",
    label: "Trim Multiple Shapes",
    default: "simultaneously",
    options: [
      { value: "simultaneously", label: "Simultaneously" },
      { value: "individually", label: "Individually" },
    ],
  },
]);

export const REPEATER = operator("repeater", "Repeater", [
  { kind: "number", key: "copies", label: "Copies", default: 3, min: 0, max: 500, step: 1, decimals: 0 },
  { kind: "number", key: "offset", label: "Offset", default: 0, min: -500, max: 500, step: 0.1, decimals: 1 },
  // Each copy is moved, scaled and turned this much more than the one before it.
  { kind: "vec2", key: "position", label: "Position", default: [150, 0], space: "px", min: -20_000, max: 20_000, step: 1, decimals: 1 },
  { kind: "number", key: "scale", label: "Scale", default: 1, min: 0, max: 10, ...PERCENT },
  { kind: "number", key: "rotation", label: "Rotation", default: 0, min: -36_000, max: 36_000, unit: "°", step: 1, decimals: 1 },
  { kind: "number", key: "startOpacity", label: "Start Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
  { kind: "number", key: "endOpacity", label: "End Opacity", default: 1, min: 0, max: 1, slider: true, ...PERCENT, decimals: 0 },
  {
    kind: "choice",
    key: "composite",
    label: "Composite",
    default: "below",
    options: [
      { value: "below", label: "Below" },
      { value: "above", label: "Above" },
    ],
  },
]);

export const OFFSET_PATHS = operator("offset-paths", "Offset Paths", [
  { kind: "number", key: "amount", label: "Amount", default: 10, min: -2000, max: 2000, ...PIXELS, decimals: 1 },
  LINE_JOIN,
  { kind: "number", key: "miterLimit", label: "Miter Limit", default: 4, min: 1, max: 100, step: 0.1, decimals: 1, disabledFor: (v) => v.lineJoin !== "miter" },
]);

export const WIGGLE_PATHS = operator("wiggle-paths", "Wiggle Paths", [
  { kind: "number", key: "size", label: "Size", default: 10, min: 0, max: 2000, ...PIXELS, decimals: 1 },
  // Segments per 100 px of path.
  { kind: "number", key: "detail", label: "Detail", default: 10, min: 1, max: 100, step: 1, decimals: 0 },
  POINTS,
  { kind: "number", key: "speed", label: "Wiggles/Second", default: 2, min: 0, max: 60, step: 0.1, decimals: 1 },
  { kind: "number", key: "seed", label: "Random Seed", default: 0, min: 0, max: 9999, step: 1, decimals: 0 },
]);

export const ZIG_ZAG = operator("zig-zag", "Zig Zag", [
  { kind: "number", key: "size", label: "Size", default: 10, min: -2000, max: 2000, ...PIXELS, decimals: 1 },
  { kind: "number", key: "ridges", label: "Ridges per Segment", default: 5, min: 0, max: 100, step: 1, decimals: 0 },
  POINTS,
]);

export const MERGE_PATHS = operator("merge-paths", "Merge Paths", [
  {
    kind: "choice",
    key: "mode",
    label: "Mode",
    default: "add",
    options: [
      { value: "merge", label: "Merge" },
      { value: "add", label: "Add" },
      { value: "subtract", label: "Subtract" },
      { value: "intersect", label: "Intersect" },
      { value: "exclude", label: "Exclude Intersections" },
    ],
  },
]);

export const ROUND_CORNERS = operator("round-corners", "Round Corners", [
  { kind: "number", key: "radius", label: "Radius", default: 20, min: 0, max: 5000, ...PIXELS, decimals: 1 },
]);

/** The shape operators, in the order menus list them. */
export const SHAPE_OPERATORS: readonly EffectDefinition[] = [TRIM_PATHS, REPEATER, OFFSET_PATHS, ROUND_CORNERS, WIGGLE_PATHS, ZIG_ZAG, MERGE_PATHS];

export const SHAPE_EFFECTS: readonly EffectDefinition[] = [SHAPE, ...SHAPE_OPERATORS];
