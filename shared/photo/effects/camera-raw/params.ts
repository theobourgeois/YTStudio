/**
 * Camera Raw's parameters (docs/photo/camera-raw.md, "The document"): Camera Raw's settings by Adobe's names and
 * ranges, each in its section (`group`, as the window shows them). A section that isn't built yet has no parameters:
 * adding one later at its default changes no saved photo.
 */
import type { ChoiceParam, CurvesParam, NumberParam, ParamSpec } from "../params.ts";
import { identityCurveSet } from "../params.ts";

/** The window's sections, in Camera Raw's order (CR0: Light, Color, Effects, then the rest). */
export const CAMERA_RAW_SECTIONS = [
  { id: "light", label: "Light" },
  { id: "color", label: "Color" },
  { id: "effects", label: "Effects" },
  { id: "curve", label: "Curve" },
] as const;
export type CameraRawSection = (typeof CAMERA_RAW_SECTIONS)[number]["id"];

const slider = (group: CameraRawSection, key: string, label: string, description: string, min = -100, max = 100, def = 0): NumberParam => ({
  kind: "number",
  key,
  label,
  unit: "",
  min,
  max,
  step: 1,
  decimals: 0,
  default: def,
  description,
  group,
});

const choice = (group: CameraRawSection, key: string, label: string, options: [string, string][], def: string, description: string): ChoiceParam => ({
  kind: "choice",
  key,
  label,
  options: options.map(([value, label]) => ({ value, label })),
  default: def,
  description,
  group,
});

const POINT_CURVE: CurvesParam = {
  kind: "curves",
  key: "pointCurve",
  label: "Point Curve",
  default: identityCurveSet(),
  description:
    "Camera Raw's point curves, as points [input, output] on 0..255 of the picture's encoded values: the composite (rgb, applied keeping each colour's hue) and one per channel (red, green, blue). 2 to 16 points a curve, inputs increasing; a smooth spline through them.",
  group: "curve",
};

export const CAMERA_RAW_PARAMS: readonly ParamSpec[] = [
  {
    kind: "number",
    key: "exposure",
    label: "Exposure",
    unit: "",
    min: -5,
    max: 5,
    step: 0.01,
    decimals: 2,
    default: 0,
    description: "Brightness in stops, as Camera Raw's: the midtones move most, white stays white when brightening (a shoulder), and each colour keeps its hue.",
    group: "light",
  },
  slider("light", "contrast", "Contrast", "Darker darks and brighter lights (negative: flatter), around the picture's middle tones, keeping hues."),
  slider("light", "whites", "Whites", "Moves the white end: positive brightens the light tones towards (and past) white, negative pulls them down."),
  slider("light", "blacks", "Blacks", "Moves the black end: negative deepens the shadows to black, positive lifts them."),
  slider("color", "temperature", "Temperature", "White balance: positive warmer (towards yellow), negative cooler (towards blue)."),
  slider("color", "tint", "Tint", "White balance: positive towards magenta, negative towards green."),
  slider("color", "vibrance", "Vibrance", "Saturation that holds back on colours already saturated: positive livelier muted colours, negative quieter."),
  slider("color", "saturation", "Saturation", "Every colour's saturation: −100 is black and white."),
  choice("color", "treatment", "Treatment", [["color", "Color"], ["bw", "Black & White"]], "color", "Color, or Black & White (Camera Raw's B&W button): every colour to its grey."),
  slider("effects", "vignette", "Vignette", "Post-crop vignetting: negative darkens the corners, positive lightens them."),
  slider("effects", "vignetteMidpoint", "Midpoint", "How far from the corners the vignette reaches: small reaches further in.", 0, 100, 50),
  slider("effects", "vignetteRoundness", "Roundness", "Its shape: negative follows the picture's rectangle, 0 an ellipse, positive towards a circle."),
  slider("effects", "vignetteFeather", "Feather", "How soft its edge is: 0 is hard.", 0, 100, 50),
  slider("effects", "vignetteHighlights", "Highlights", "With Highlight Priority, how much bright parts in the corners keep their light.", 0, 100, 0),
  choice(
    "effects",
    "vignetteStyle",
    "Style",
    [
      ["highlight", "Highlight Priority"],
      ["color", "Color Priority"],
      ["paint", "Paint Overlay"],
    ],
    "highlight",
    "How the vignette darkens: Highlight Priority keeps highlights, Color Priority keeps hues, Paint Overlay mixes in black or white.",
  ),
  slider("effects", "grain", "Grain", "Film grain's strength.", 0, 100, 0),
  slider("effects", "grainSize", "Size", "How big the grains are (a fraction of the picture's size, so the same on any size).", 0, 100, 25),
  slider("effects", "grainRoughness", "Roughness", "How irregular the grain is: 0 even, 100 clumped.", 0, 100, 50),
  slider("curve", "curveHighlights", "Highlights", "The parametric curve's highlights region."),
  slider("curve", "curveLights", "Lights", "The parametric curve's lights region."),
  slider("curve", "curveDarks", "Darks", "The parametric curve's darks region."),
  slider("curve", "curveShadows", "Shadows", "The parametric curve's shadows region."),
  slider("curve", "curveShadowSplit", "Shadow Split", "Where the shadows region ends and the darks begin (percent of the tones).", 5, 90, 25),
  slider("curve", "curveMidtoneSplit", "Midtone Split", "Where the darks end and the lights begin.", 10, 90, 50),
  slider("curve", "curveHighlightSplit", "Highlight Split", "Where the lights end and the highlights begin.", 10, 95, 75),
  POINT_CURVE,
];

/** The parameters shown in a section, in order. */
export const sectionParams = (section: CameraRawSection) => CAMERA_RAW_PARAMS.filter((p) => p.group === section);
