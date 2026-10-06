/**
 * More Stylize filters (docs/photo/effects/stylized-filters.md, "Stylize"): the ones made of the picture's edges. Their
 * references are `../../reference/filters/edges.ts`, their WGSL `src/suites/photo/render/filters/edges.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, colour, diag, kernelFilter, look, n, num, percent, pixels } from "../kernel.ts";

const DEEP_FRY = kernelFilter({
  type: "deep-fry",
  label: "Deep Fry",
  description:
    "The deep-fried meme look: the picture over-sharpened until every edge has a halo (an unsharp mask), its saturation and contrast pushed far, a red-orange cast, crushed to a few tones and sprinkled with noise. Colours clip: light above white is lost.",
  category: "Stylize",
  params: [
    num("sharpen", "Sharpen", "%", 0, 500, 250, "How hard edges are sharpened (an unsharp mask's amount): past 100% they ring with bright and dark halos."),
    pixels("radius", "Radius", 0.5, 100, 3, "How wide the sharpening's halos are, in document pixels (the unsharp mask's blur)."),
    num("saturation", "Saturation", "%", 0, 300, 200, "Colour: 100% leaves it, more pushes it towards pure hues, 0 is grey."),
    percent("contrast", "Contrast", 50, "How far tones are pushed apart from the middle: high values crush shadows to black and highlights to white."),
    percent("warmth", "Warmth", 40, "A push towards red and orange, the fried cast."),
    percent("crunch", "Crunch", 40, "Posterises towards fewer levels per channel, as a file saved too many times: 0 keeps every level."),
    percent("noise", "Noise", 20, "Coloured noise, a different value at every document pixel (always the same pattern)."),
  ],
  reach: (p) => n(p, "radius"),
  summary: (p) => `sharpen ${n(p, "sharpen")}%, saturation ${n(p, "saturation")}%, crunch ${n(p, "crunch")}%`,
  presets: [
    look("lightly-fried", "Lightly Fried", "Crisp halos, hot colours, a little grit.", { sharpen: 150, saturation: 160, contrast: 25, warmth: 20, crunch: 15, noise: 10 }, (c) => ({ radius: diag(0.002, c, 0.5, 100) })),
    look("deep-fried", "Deep Fried", "The meme: ringing edges, burnt orange, crushed tones and noise.", { sharpen: 300, saturation: 230, contrast: 50, warmth: 45, crunch: 40, noise: 25 }, (c) => ({ radius: diag(0.004, c, 0.5, 100) })),
    look("nuclear", "Nuclear", "Everything at the limit: a few flat colours, glaring halos.", { sharpen: 500, saturation: 300, contrast: 80, warmth: 75, crunch: 70, noise: 45 }, (c) => ({ radius: diag(0.006, c, 0.5, 100) })),
  ],
});

const NEON_EDGES = kernelFilter({
  type: "edges",
  label: "Neon Edges",
  description:
    "The picture's edges (a Sobel filter on its brightness, its samples Width apart) drawn as lines: lit on black as Photoshop's Glowing Edges, lit over the image, or dark on white paper as a sketch. Lines take the picture's own colour (saturated), a tint, or a rainbow by the edge's direction. On Black, Brightness above 100% makes light above white, which a Glow after it spreads.",
  category: "Stylize",
  params: [
    pixels("width", "Width", 0.5, 50, 1, "How far apart the edge's samples are, in document pixels: wider makes thicker lines and ignores fine texture less."),
    num("brightness", "Brightness", "%", 0, 400, 150, "How bright (on Paper, how dark) the lines are: faint edges show more as it rises."),
    choice("colouring", "Colour", [["own", "Own"], ["tint", "Tint"], ["rainbow", "Rainbow"]], "own", "Own: the picture's colour there, saturated. Tint: the Tint colour. Rainbow: a hue by the edge's direction."),
    colour("tint", "Tint", "#ff2bd6", "The lines' colour with Colour set to Tint."),
    choice("background", "Background", [["black", "Black"], ["image", "Image"], ["paper", "Paper"]], "black", "Black: lines lit on black. Image: lines lit over the picture. Paper: lines drawn on white, a sketch."),
  ],
  reach: (p) => n(p, "width"),
  summary: (p) => `${p.colouring} on ${p.background}, ${n(p, "width")} px`,
  presets: [
    look("glowing-edges", "Glowing Edges", "Photoshop's: the picture's edges lit in their own colours on black.", { brightness: 160, colouring: "own", background: "black" }, (c) => ({ width: diag(0.0015, c, 0.5, 50) })),
    look("neon-outline", "Neon Outline", "Hot pink neon traced over the picture.", { brightness: 220, colouring: "tint", tint: "#ff2bd6", background: "image" }, (c) => ({ width: diag(0.002, c, 0.5, 50) })),
    look("rainbow-edges", "Rainbow Edges", "Every edge lit in a hue of its direction, on black.", { brightness: 200, colouring: "rainbow", background: "black" }, (c) => ({ width: diag(0.002, c, 0.5, 50) })),
    look("sketch", "Sketch", "Pencil lines on white paper.", { brightness: 170, colouring: "tint", tint: "#26221e", background: "paper" }, (c) => ({ width: diag(0.0012, c, 0.5, 50) })),
  ],
});

export const EDGES_FILTERS: EffectDefinition[] = [DEEP_FRY, NEON_EDGES];
