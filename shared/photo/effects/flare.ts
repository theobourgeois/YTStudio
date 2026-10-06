/**
 * Lens Flare (docs/photo/f4-light.md, "Lens Flare"; research/light-effects.md): a generator layer of editable
 * elements (source glow, halo, ghosts, anamorphic streak), each placed on the line from the light's source through
 * the optical centre. Every element is a closed-form function of the document point (`../reference/flare.ts`, which
 * the GPU's `render/flare.ts` mirrors), so tiles agree and the handles are document points at any zoom.
 *
 * Presets are stacks of elements whose sizes are fractions of the canvas's diagonal: applying one makes pixels for
 * this canvas. "Classic" is the video editor's Lens Flare (`shared/effect-library/light.ts`) as elements.
 */
import type { EffectElement, EffectParamValue } from "../types.ts";
import type { ColourParam, ElementParamSpec, ElementType, ElementsParam, NumberParam, ParamSpec, PointParam } from "./params.ts";

const num = (key: string, label: string, unit: string, min: number, max: number, step: number, decimals: number, def: number, description: string): NumberParam => ({
  kind: "number",
  key,
  label,
  unit,
  min,
  max,
  step,
  decimals,
  default: def,
  description,
});

const colour = (key: string, label: string, def: string, description: string): ColourParam => ({ kind: "colour", key, label, default: def, description });

/** What every element has: where it is, how big and bright, its colour. */
const common = (position: number, size: number, intensity: number): ElementParamSpec[] => [
  num("position", "Position", "", -3, 3, 0.01, 2, position, "Where it sits on the line from the light (1) through the optical centre (0); negative goes past the centre."),
  num("offset", "Offset", "px", -20000, 20000, 1, 0, 0, "How far to the side of that line, in document pixels."),
  num("size", "Size", "px", 0.1, 20000, 1, 1, size, "Its size in document pixels: a glow's radius, a halo's, a ghost's, half a streak's length."),
  num("intensity", "Intensity", "stops", -10, 10, 0.01, 2, intensity, "How bright it is, in stops (0: its brightest point is white); each one doubles it."),
  colour("tint", "Tint", "#ffffff", "Its colour (multiplying the light's)."),
];

export const FLARE_ELEMENT_TYPES: readonly ElementType[] = [
  {
    type: "glow",
    label: "Source glow",
    description: "A soft glow around a point, with a hot white core: the light itself.",
    params: [
      ...common(1, 160, 0),
      num("falloff", "Falloff", "", 0.5, 4, 0.01, 2, 2, "How quickly it fades from its centre: higher is tighter."),
      num("core", "Core", "%", 0, 1000, 1, 0, 150, "How bright its white core is (about a third of its size), as a percentage of white."),
    ],
  },
  {
    type: "halo",
    label: "Halo",
    description: "A thin ring whose edges split into colours.",
    params: [
      ...common(1, 800, -3.3),
      num("thickness", "Thickness", "%", 0.1, 100, 0.1, 1, 8, "The ring's width, as a percentage of its size."),
      num("spread", "Spread", "%", 0, 100, 1, 0, 50, "How far its colours split apart across the ring."),
    ],
  },
  {
    type: "ghost",
    label: "Ghost",
    description: "A lens reflection: a soft disc or polygon with a brighter rim that splits into colours.",
    params: [
      ...common(-0.5, 80, -2.5),
      { kind: "choice", key: "shape", label: "Shape", options: [{ value: "disc", label: "Disc" }, { value: "polygon", label: "Polygon" }], default: "disc", description: "A round ghost, or the aperture's polygon." },
      num("sides", "Sides", "", 3, 12, 1, 0, 6, "A polygon's sides (the aperture's blades)."),
      num("rotation", "Rotation", "°", -180, 180, 1, 0, 0, "A polygon's angle."),
      num("softness", "Softness", "%", 0, 100, 1, 0, 35, "How far its inside fades from the edge, as a percentage of its size."),
      num("rim", "Rim", "%", 0, 100, 1, 0, 45, "How much of its light is in its rim rather than its body."),
      num("chroma", "Chroma", "%", 0, 20, 0.1, 1, 4, "How far red and blue are apart at its edge, as a percentage of its size."),
    ],
  },
  {
    type: "streak",
    label: "Anamorphic streak",
    description: "A long thin line of light through the source, as an anamorphic lens makes.",
    params: [
      ...common(1, 1200, 0),
      num("angle", "Angle", "°", -180, 180, 1, 0, 0, "Its direction: 0 is horizontal."),
      num("thickness", "Thickness", "px", 0.1, 2000, 0.1, 1, 3, "Its core's thickness, in document pixels."),
      num("haze", "Haze", "%", 0, 100, 1, 0, 25, "A wider, dimmer haze around the core."),
    ],
  },
];

export const flareElementType = (type: string) => FLARE_ELEMENT_TYPES.find((t) => t.type === type);

/** A preset's element: sizes, offsets and thicknesses in pixels (`size`, `offset`, a streak's `thickness`) are fractions of the diagonal. */
type PresetElement = Omit<EffectElement, "id">;

export interface FlarePreset {
  id: string;
  label: string;
  elements: PresetElement[];
}

/** The defaults of a type, with these values. */
function element(type: string, values: Record<string, number | string | boolean>): PresetElement {
  const t = flareElementType(type)!;
  return { type, enabled: true, ...Object.fromEntries(t.params.map((p) => [p.key, p.default])), ...values };
}

/** A ghost from the video editor's list (position on the axis, size in frame heights, tint, amplitude, hexagon). */
const ghost = (position: number, heights: number, tint: string, amplitude: number, polygon: boolean): PresetElement =>
  element("ghost", { position, size: heights / 2.04, tint, intensity: Math.log2(amplitude), shape: polygon ? "polygon" : "disc", sides: 6 });

export const FLARE_PRESETS: readonly FlarePreset[] = [
  {
    id: "classic",
    label: "Classic",
    elements: [
      element("glow", { size: 0.0775 / 2.04, tint: "#ffd8a8", intensity: -0.15, core: 150 }),
      element("halo", { size: 0.38 / 2.04, thickness: 9, spread: 60, intensity: -3.3, tint: "#ffffff" }),
      ghost(0.55, 0.035, "#97cbff", 0.18, false),
      ghost(0.25, 0.07, "#bcffc2", 0.1, true),
      ghost(-0.2, 0.02, "#ffe7aa", 0.3, false),
      ghost(-0.45, 0.11, "#f3a0e6", 0.08, true),
      ghost(-0.7, 0.05, "#ffc387", 0.14, false),
      ghost(-1.1, 0.16, "#a0e1ff", 0.06, false),
      ghost(-1.35, 0.03, "#cbffd8", 0.2, true),
    ],
  },
  {
    id: "anamorphic",
    label: "Anamorphic",
    elements: [
      element("glow", { size: 0.03, tint: "#cfe2ff", intensity: 0, core: 200 }),
      element("streak", { size: 0.7, thickness: 0.0012, tint: "#73a6ff", intensity: 0, haze: 30 }),
      ghost(-0.3, 0.05, "#7fb2ff", 0.12, false),
      ghost(-0.8, 0.09, "#6f8dff", 0.07, false),
      ghost(0.4, 0.03, "#9fd0ff", 0.15, true),
    ],
  },
  {
    id: "subtle",
    label: "Subtle",
    elements: [
      element("glow", { size: 0.05, tint: "#ffe2c0", intensity: -1, core: 60 }),
      ghost(-0.4, 0.06, "#ffd9a0", 0.06, false),
      ghost(-0.9, 0.1, "#c0dcff", 0.04, false),
    ],
  },
];

/** Keys of an element measured in pixels, which presets keep as fractions of the diagonal. */
const PIXEL_KEYS = ["size", "offset"] as const;

/** A preset's elements for a canvas of `width × height`, with ids e1, e2… (unique within the list). */
export function flarePreset(id: string, width: number, height: number): EffectElement[] {
  const preset = FLARE_PRESETS.find((p) => p.id === id) ?? FLARE_PRESETS[0];
  const diagonal = Math.hypot(width, height);
  return preset.elements.map((e, i) => {
    const out: EffectElement = { ...e, id: `e${i + 1}` } as EffectElement;
    for (const key of PIXEL_KEYS) out[key] = round((e[key] as number) * diagonal);
    if (e.type === "streak") out.thickness = Math.max(0.1, round((e.thickness as number) * diagonal));
    return out;
  });
}

const round = (v: number) => Math.round(v * 10) / 10;

const point = (key: string, label: string, nullable: boolean, description: string): PointParam => ({ kind: "point", key, label, default: nullable ? null : [0, 0], nullable, handle: true, description });

const ELEMENTS: ElementsParam = {
  kind: "elements",
  key: "elements",
  label: "Elements",
  types: FLARE_ELEMENT_TYPES,
  default: flarePreset("classic", 1080, 1920),
  max: 32,
  description:
    "The flare's elements, drawn added together: each { id, type, enabled, ...its parameters }. Types: glow (source glow), halo, ghost, streak. Position is on the line from the source (1) through the optical centre (0); sizes are document pixels.",
};

export const FLARE_PARAMS: readonly ParamSpec[] = [
  point("source", "Source", false, "Where the light is, in document pixels: the flare's handle on the canvas."),
  point("centre", "Optical centre", true, "The lens's centre, in document pixels, which the ghosts line up through; null follows the canvas's centre."),
  num("intensity", "Intensity", "stops", -6, 6, 0.01, 2, 0, "How bright the whole flare is, in stops."),
  colour("colour", "Colour", "#ffffff", "The whole flare's colour (multiplying every element's)."),
  ELEMENTS,
];

/** The flare's numbers, for the GPU and the reference. */
export interface FlareShape {
  source: [number, number];
  centre: [number, number];
  /** Linear, × 2^intensity. */
  gain: [number, number, number];
  elements: EffectElement[];
}

export function flareShape(params: Record<string, EffectParamValue>, canvas: { width: number; height: number }, linear: (hex: string) => [number, number, number]): FlareShape {
  const source = params.source as [number, number];
  const centre = (params.centre as [number, number] | null) ?? [canvas.width / 2, canvas.height / 2];
  const k = 2 ** (params.intensity as number);
  const c = linear(params.colour as string);
  return { source, centre, gain: [c[0] * k, c[1] * k, c[2] * k], elements: (params.elements as EffectElement[]).filter((e) => e.enabled) };
}
