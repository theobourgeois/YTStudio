/**
 * Light filters (docs/photo/effects/stylized-filters.md, "Light"): light added to the picture, in linear light (Glow
 * and Lens Flare, beside them, are their own effects). Their references are `../../reference/filters/light.ts`, their
 * WGSL `src/suites/photo/render/filters/light.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { boolean, colour, degrees, kernelFilter, look, n, num, percent, seed } from "../kernel.ts";

const LIGHT_LEAK = kernelFilter({
  type: "light-leak",
  label: "Light Leak",
  description:
    "Light bleeding in from one edge of the frame, as on expired or badly loaded film: a hot core at the edge (Colour) fading through an outer colour (Colour 2) into the picture. Angle picks the edge (0° the right, 90° the bottom, 180° the left, −90° the top), Spread how far in it reaches (as a share of the canvas's diagonal), Intensity its brightness in stops; the light is added, so its core can burn out to white. Wobble breaks its shape into uneven lobes, seeded. Double adds a second, weaker leak from the opposite edge.",
  category: "Light",
  params: [
    degrees("angle", "Angle", 180, "Which edge it comes from: 0° the right, 90° the bottom, 180° the left, −90° the top; between them, a corner."),
    percent("spread", "Spread", 40, "How far into the picture it reaches, as a share of the canvas's diagonal.", 5, 100),
    num("intensity", "Intensity", "stops", -3, 4, 0.5, "How bright the light is, in stops: each one doubles it.", 0.1, 1),
    colour("colour", "Colour", "#ffc46b", "The core's colour, at the edge it comes from."),
    colour("colour2", "Colour 2", "#ff3b1f", "The colour it fades through as it reaches in."),
    percent("wobble", "Wobble", 50, "How uneven its shape is: 0 is a smooth glow along the edge, more breaks it into lobes and wisps."),
    boolean("double", "Double", false, "A second, weaker leak from the opposite edge."),
    seed(),
  ],
  reach: () => 0,
  summary: (p) => `${n(p, "angle")}°, ${n(p, "spread")}%, ${n(p, "intensity") >= 0 ? "+" : ""}${n(p, "intensity")} stops${p.double ? ", double" : ""}`,
  presets: [
    look("warm", "Warm Leak", "Amber light pouring in from the left.", { angle: 180, spread: 40, intensity: 0.5, colour: "#ffc46b", colour2: "#ff4a1c", wobble: 50, double: false, seed: 1 }),
    look("red-burn", "Red Burn", "A deep red burn from the top corner, its core blown out.", { angle: -60, spread: 60, intensity: 1, colour: "#ff6a2a", colour2: "#b5001a", wobble: 70, double: false, seed: 4 }),
    look("sunset", "Sunset", "Pink into gold from the right: a soft, warm haze.", { angle: 10, spread: 60, intensity: 0.3, colour: "#ffd27a", colour2: "#ff3d8b", wobble: 35, double: false, seed: 7 }),
    look("cool", "Cool Leak", "Cyan light bleeding in from below.", { angle: 90, spread: 26, intensity: 0, colour: "#b8f4ff", colour2: "#1f5cff", wobble: 55, double: false, seed: 2 }),
    look("double", "Double", "Orange leaks from both sides, as a roll's first frames.", { angle: 180, spread: 32, intensity: 0.6, colour: "#ffb35c", colour2: "#ff2f1f", wobble: 60, double: true, seed: 5 }),
  ],
});

export const LIGHT_FILTERS: EffectDefinition[] = [LIGHT_LEAK];
