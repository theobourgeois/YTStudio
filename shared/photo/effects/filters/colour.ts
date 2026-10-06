/**
 * Colour filters (docs/photo/effects/stylized-filters.md, "Colour"): looks made of the picture's own tones. Their
 * references are `../../reference/filters/colour.ts`, their WGSL `src/suites/photo/render/filters/colour.ts`.
 */
import type { Gradient } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { boolean, gradient, kernelFilter, look } from "../kernel.ts";

/** A gradient of colour stops (evenly opaque), as the Gradient Editor holds them. */
export const stops = (name: string, colours: [number, string][], method: Gradient["method"] = "perceptual"): Gradient => ({
  name,
  method,
  colours: colours.map(([at, colour]) => ({ at, colour })),
  opacities: [
    { at: 0, opacity: 1 },
    { at: 1, opacity: 1 },
  ],
});

/** Gradient Map's presets' gradients, darkest first. */
export const GRADIENT_MAPS = {
  purpleHaze: stops("Purple Haze", [[0, "#0d0221"], [0.35, "#4a0d77"], [0.7, "#c03fe0"], [1, "#ffe8ff"]]),
  cyberNight: stops("Cyber Night", [[0, "#020814"], [0.4, "#0a5d7a"], [0.72, "#ff2bd6"], [1, "#fff0fb"]]),
  infrared: stops("Infrared", [[0, "#000000"], [0.25, "#2a0a8c"], [0.5, "#d4005a"], [0.75, "#ff8a00"], [1, "#fff6a8"]]),
  toxic: stops("Toxic", [[0, "#000a00"], [0.5, "#1f8a12"], [0.8, "#9dff2e"], [1, "#f6ffd0"]]),
  bloodMoon: stops("Blood Moon", [[0, "#080000"], [0.45, "#7d0012"], [0.8, "#ff3b2f"], [1, "#ffe2d4"]]),
  gold: stops("Gold", [[0, "#120900"], [0.4, "#7a4b00"], [0.75, "#f2b632"], [1, "#fffbe8"]]),
  sepia: stops("Sepia", [[0, "#1c120a"], [0.5, "#8c6239"], [1, "#f7ecd6"]], "classic"),
  noir: stops("Noir", [[0, "#000000"], [0.3, "#000000"], [0.7, "#ffffff"], [1, "#ffffff"]], "classic"),
};

const GRADIENT_MAP = kernelFilter({
  type: "gradient-map",
  label: "Gradient Map",
  description:
    "Photoshop's Gradient Map as a filter: each pixel's brightness (its luminance, sRGB-encoded) picks a colour along the gradient, darkest at its left end. The gradient's opacity lets the photo through. Duotones, tritones, thermal looks.",
  category: "Colour",
  params: [
    gradient("gradient", "Gradient", GRADIENT_MAPS.purpleHaze, "The colours brightness is mapped to: shadows take its left end, highlights its right."),
    boolean("reverse", "Reverse", false, "Shadows take the gradient's right end instead."),
  ],
  reach: () => 0,
  summary: (p) => `${(p.gradient as Gradient).name}${p.reverse ? ", reversed" : ""}`,
  presets: [
    look("purple-haze", "Purple Haze", "Deep violet shadows to lilac highlights.", { gradient: GRADIENT_MAPS.purpleHaze }),
    look("cyber-night", "Cyber Night", "Midnight teal into hot magenta.", { gradient: GRADIENT_MAPS.cyberNight }),
    look("infrared", "Infrared", "A thermal camera: blue through red to yellow.", { gradient: GRADIENT_MAPS.infrared }),
    look("toxic", "Toxic", "Acid green out of black.", { gradient: GRADIENT_MAPS.toxic }),
    look("blood-moon", "Blood Moon", "Black into blood red and pale peach.", { gradient: GRADIENT_MAPS.bloodMoon }),
    look("gold", "Gold", "Bronze shadows to bright gold.", { gradient: GRADIENT_MAPS.gold }),
    look("sepia", "Sepia", "An old print's warm browns.", { gradient: GRADIENT_MAPS.sepia }),
    look("noir", "Noir", "Hard black and white: the midtones pushed apart.", { gradient: GRADIENT_MAPS.noir }),
  ],
});

export const COLOUR_FILTERS: EffectDefinition[] = [GRADIENT_MAP];
