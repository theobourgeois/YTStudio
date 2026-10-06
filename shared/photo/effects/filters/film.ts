/**
 * Film filters (docs/photo/effects/stylized-filters.md, "Film"): what a photograph on film looks like besides its
 * colours, its grain, dust and darkened corners. Anything random is seeded and in document pixels. Their references
 * are `../../reference/filters/film.ts`, their WGSL `src/suites/photo/render/filters/film.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { colour, diag, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";

const GRAIN = kernelFilter({
  type: "grain",
  label: "Film Grain",
  description:
    "Film grain: soft, clumped noise in document pixels, strongest in the midtones and fading in deep shadows and bright highlights as film's does. Mono by default; Colour gives each channel its own grain, as colour negative film. Dust adds sparse specks and fine scratches, as an old scan. The same Seed always gives the same grain.",
  category: "Film",
  params: [
    percent("amount", "Amount", 35, "How strong the grain is."),
    pixels("size", "Size", 0.5, 50, 1, "How big a grain is, in document pixels: larger looks like faster film or a smaller format."),
    percent("chroma", "Colour", 0, "How much of the grain is coloured (each channel its own) rather than grey."),
    percent("response", "Response", 70, "How much the grain follows the tones, as film's: strongest in the midtones, less in shadows and highlights. 0 is even everywhere."),
    percent("dust", "Dust", 0, "Sparse dust specks and fine vertical scratches, as on an old scan. Their size follows the grain's."),
    seed(),
  ],
  reach: () => 0,
  isIdentity: (p) => n(p, "amount") === 0 && n(p, "dust") === 0,
  summary: (p) => `${n(p, "amount")}%, ${n(p, "size")} px${n(p, "chroma") > 0 ? `, ${n(p, "chroma")}% colour` : ""}${n(p, "dust") > 0 ? `, ${n(p, "dust")}% dust` : ""}`,
  presets: [
    look("fine-35mm", "Fine 35mm", "Fine, even mono grain: a slow 35mm film.", { amount: 35, chroma: 0, response: 70, dust: 0, seed: 1 }, (c) => ({ size: diag(0.0012, c) })),
    look("heavy", "Heavy Grain", "Coarse, strong grain: pushed black-and-white film.", { amount: 75, chroma: 0, response: 55, dust: 0, seed: 1 }, (c) => ({ size: diag(0.0025, c) })),
    look("16mm-colour", "16mm Colour", "Big, coloured grain: a small colour negative blown up.", { amount: 55, chroma: 70, response: 75, dust: 0, seed: 1 }, (c) => ({ size: diag(0.003, c) })),
    look("dusty", "Dusty", "Grain with dust specks and scratches: an old print, scanned.", { amount: 40, chroma: 15, response: 70, dust: 60, seed: 2 }, (c) => ({ size: diag(0.0018, c) })),
  ],
});

const VIGNETTE = kernelFilter({
  type: "vignette",
  label: "Vignette",
  description:
    "Darkens (negative Amount) or lightens (positive) the picture towards its edges, as a lens does, centred on the canvas. Darkened edges go towards Colour (black: a plain vignette; another colour fades the edges into it); lightened ones go towards white. Size is how far out the clear middle reaches, Roundness goes from the canvas's own shape (−100) through an ellipse (0) to a circle (100), Feather how soft the falloff is.",
  category: "Film",
  params: [
    num("amount", "Amount", "", -100, 100, -40, "Negative darkens the edges (towards Colour), positive lightens them (towards white)."),
    percent("size", "Size", 50, "How far out the clear middle reaches: small closes in on the centre."),
    num("roundness", "Roundness", "", -100, 100, 0, "The vignette's shape: −100 follows the canvas's rectangle, 0 an ellipse filling it, 100 a circle."),
    percent("feather", "Feather", 50, "How soft the falloff is: 0 is a hard edge."),
    colour("colour", "Colour", "#000000", "The colour darkened edges go towards: black for a plain vignette."),
  ],
  reach: () => 0,
  isIdentity: (p) => n(p, "amount") === 0,
  summary: (p) => `${n(p, "amount") < 0 ? "darken" : "lighten"} ${Math.abs(n(p, "amount"))}, size ${n(p, "size")}%${n(p, "amount") < 0 && p.colour !== "#000000" ? `, ${p.colour}` : ""}`,
  presets: [
    look("classic", "Classic", "Gently darkened corners, as an old lens.", { amount: -45, size: 55, roundness: 0, feather: 60, colour: "#000000" }),
    look("heavy", "Heavy", "Deep, close vignetting: a spotlight on the middle.", { amount: -90, size: 32, roundness: 40, feather: 50, colour: "#000000" }),
    look("soft-white", "Soft White", "Edges fading to white, as a dreamy old portrait.", { amount: 55, size: 48, roundness: 20, feather: 80, colour: "#000000" }),
    look("purple-edge", "Purple Edge", "Edges falling into a deep purple.", { amount: -80, size: 36, roundness: 0, feather: 60, colour: "#4a0f78" }),
  ],
});

export const FILM_FILTERS: EffectDefinition[] = [GRAIN, VIGNETTE];
