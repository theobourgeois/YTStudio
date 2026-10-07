/**
 * Chrome and Holographic Foil: the picture as a shiny surface (Stylize, Colour), its brightness taken as a height
 * whose slope bends reflections. Their references are `../../reference/filters/surface.ts`, their WGSL
 * `src/suites/photo/render/filters/surface.ts`.
 */
import type { Gradient } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, gradient, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";
import { stops } from "./colour.ts";

/** Chrome's environments, darkest first: what a band of the metal reflects. */
export const CHROME_ENVIRONMENTS = {
  silver: stops("Silver", [[0, "#020304"], [0.25, "#1e242b"], [0.46, "#5b6570"], [0.5, "#a7b2bd"], [0.66, "#dce3ea"], [0.85, "#f5f8fa"], [1, "#ffffff"]]),
  gold: stops("Gold", [[0, "#140900"], [0.3, "#4f2a05"], [0.55, "#b77a1c"], [0.75, "#f1c24e"], [0.9, "#fff1b8"], [1, "#fffdf2"]]),
  mercury: stops("Mercury", [[0, "#1a1d21"], [0.35, "#5c636b"], [0.65, "#b9c0c7"], [0.85, "#eef1f4"], [1, "#ffffff"]]),
  black: stops("Black Chrome", [[0, "#000000"], [0.6, "#040506"], [0.84, "#2a3038"], [0.96, "#b9c3cd"], [1, "#ffffff"]]),
  rainbow: stops("Rainbow Metal", [[0, "#10001f"], [0.2, "#3b1a8f"], [0.38, "#0089c7"], [0.52, "#3fe0a0"], [0.66, "#ffe14a"], [0.8, "#ff4f9a"], [0.92, "#ffd6f0"], [1, "#ffffff"]]),
};

const CHROME = kernelFilter({
  type: "chrome",
  label: "Chrome",
  description:
    "Photoshop's Sketch › Chrome taken further: the picture turned to liquid metal. Its brightness, smoothed over Smoothness pixels, is a height; the metal shows Reflections bright bands as the height rises (more: busier, rippled metal), shaded by the height's slope as if lit from Angle (Relief: how much), and each band's colour is read from Environment, the gradient it reflects (darkest on its left). Contrast hardens the bands into sharp, polished edges. The picture's colour is replaced (the gradient's opacity lets it through); its transparency is kept, and a cut-out's outline becomes a bevel.",
  category: "Stylize",
  params: [
    pixels("smoothness", "Smoothness", 1, 100, 8, "How far the brightness is smoothed before it becomes metal, in document pixels: more melts small detail into broad, liquid shapes."),
    num("reflections", "Reflections", "", 0.5, 8, 2.5, "How many bright bands the metal shows from black to white: more is busier, rippled metal.", 0.1, 1),
    percent("relief", "Relief", 60, "How much the surface's slope shades it, as a light from Angle would."),
    degrees("angle", "Angle", -135, "Where the light comes from: 0° the right, 90° below, −90° above."),
    percent("contrast", "Contrast", 40, "Hardens the bands' edges: 0 soft and satin, 100 sharp, polished chrome."),
    gradient("environment", "Environment", CHROME_ENVIRONMENTS.silver, "The colours the metal reflects: its dark bands take the gradient's left end, its bright ones its right."),
  ],
  reach: (p) => n(p, "smoothness"),
  summary: (p) => `${(p.environment as Gradient).name}, ${n(p, "reflections")} reflections, smoothness ${n(p, "smoothness")} px`,
  presets: [
    look("liquid-chrome", "Liquid Chrome", "Polished silver, the picture melted into flowing reflections.", { reflections: 3, relief: 60, angle: -135, contrast: 30, environment: CHROME_ENVIRONMENTS.silver }, (c) => ({ smoothness: diag(0.012, c, 1, 100) })),
    look("gold", "Gold", "Molten gold: warm, deep bands with bright gleams.", { reflections: 2, relief: 55, angle: -120, contrast: 45, environment: CHROME_ENVIRONMENTS.gold }, (c) => ({ smoothness: diag(0.01, c, 1, 100) })),
    look("mercury", "Mercury", "Soft, broad, bright liquid metal: few reflections, gently shaded.", { reflections: 1.2, relief: 80, angle: -135, contrast: 15, environment: CHROME_ENVIRONMENTS.mercury }, (c) => ({ smoothness: diag(0.018, c, 1, 100) })),
    look("black-chrome", "Black Chrome", "Dark, glossy metal: mostly black, with sharp silver highlights.", { reflections: 2, relief: 70, angle: -135, contrast: 60, environment: CHROME_ENVIRONMENTS.black }, (c) => ({ smoothness: diag(0.01, c, 1, 100) })),
    look("rainbow-metal", "Rainbow Metal", "Anodised, iridescent metal: bands through violet, teal, gold and pink.", { reflections: 3.5, relief: 50, angle: -135, contrast: 40, environment: CHROME_ENVIRONMENTS.rainbow }, (c) => ({ smoothness: diag(0.008, c, 1, 100) })),
  ],
});

const HOLOGRAPHIC = kernelFilter({
  type: "holographic",
  label: "Holographic Foil",
  description:
    "Iridescent holographic foil: a thin-film rainbow whose hue follows a sheen across the picture (Bands rainbow cycles across the canvas, along Angle), the picture's brightness (Tone) and its relief (the slope of its brightness smoothed over Radius pixels: Relief bends the sheen with the picture's shapes). Palette is the foil's colours: Rainbow, Pastel (pearl) or Oil (deep oil-slick). Over lays the foil on the picture (overlaid and screened); Foil makes the picture a holo sticker, its lightness in the foil's colours. Amount is how much foil. Sparkle adds seeded glitter, flakes Size pixels across flashing as light.",
  category: "Colour",
  params: [
    choice("mode", "Mode", [["over", "Over"], ["foil", "Foil"]], "over", "Over: the foil laid over the picture. Foil: the picture's lightness in the foil's colours, a holo sticker."),
    choice("palette", "Palette", [["rainbow", "Rainbow"], ["pastel", "Pastel"], ["oil", "Oil"]], "rainbow", "The foil's colours: a full Rainbow, a soft pearly Pastel, or a deep Oil slick."),
    percent("amount", "Amount", 70, "How much foil: 0 leaves the picture, 100 is all foil."),
    degrees("angle", "Angle", 35, "The direction the rainbow sweeps across the picture."),
    num("bands", "Bands", "", 0, 12, 2, "How many times the rainbow cycles across the canvas.", 0.1, 1),
    percent("tone", "Tone", 60, "How much the picture's brightness shifts the hue: bright and dark areas in different colours."),
    percent("relief", "Relief", 50, "How much the picture's shapes bend the sheen, as light on embossed foil."),
    pixels("radius", "Radius", 1, 100, 6, "How far the brightness is smoothed for the relief, in document pixels: more follows broader shapes."),
    percent("sparkle", "Sparkle", 0, "Glitter: seeded flakes flashing bright, more of them and brighter as it rises."),
    pixels("size", "Size", 1, 40, 3, "How big the glitter's flakes are, in document pixels."),
    seed("Which glitter: another number, another one."),
  ],
  reach: (p) => (n(p, "relief") > 0 ? n(p, "radius") : 0),
  isIdentity: (p) => n(p, "amount") === 0 && n(p, "sparkle") === 0,
  summary: (p) => `${p.palette} ${p.mode}, ${n(p, "amount")}%, ${n(p, "bands")} bands${n(p, "sparkle") ? `, sparkle ${n(p, "sparkle")}%` : ""}`,
  presets: [
    look("holo-foil", "Holo Foil", "A rainbow foil sheen sweeping over the picture, bending with its shapes.", { mode: "over", palette: "rainbow", amount: 70, angle: 35, bands: 2, tone: 60, relief: 50, sparkle: 0, seed: 1 }, (c) => ({ radius: diag(0.006, c, 1, 100), size: diag(0.003, c, 1, 40) })),
    look("oil-slick", "Oil Slick", "Deep petrol colours: purple, teal and gold banding through the picture.", { mode: "over", palette: "oil", amount: 85, angle: -20, bands: 3, tone: 60, relief: 70, sparkle: 0, seed: 1 }, (c) => ({ radius: diag(0.01, c, 1, 100), size: diag(0.003, c, 1, 40) })),
    look("pearl", "Pearl", "A soft, pearly pastel shimmer: pink, mint and lilac.", { mode: "over", palette: "pastel", amount: 100, angle: 60, bands: 1.5, tone: 50, relief: 50, sparkle: 0, seed: 1 }, (c) => ({ radius: diag(0.008, c, 1, 100), size: diag(0.003, c, 1, 40) })),
    look("glitter", "Glitter", "Rainbow foil with flashing glitter flakes.", { mode: "over", palette: "rainbow", amount: 55, angle: 35, bands: 2.5, tone: 50, relief: 40, sparkle: 70, seed: 7 }, (c) => ({ radius: diag(0.006, c, 1, 100), size: diag(0.006, c, 1, 40) })),
    look("holo-sticker", "Holo Sticker", "The picture as a holographic sticker: its lightness in rainbow foil, a little glitter.", { mode: "foil", palette: "rainbow", amount: 100, angle: 45, bands: 2, tone: 80, relief: 60, sparkle: 30, seed: 3 }, (c) => ({ radius: diag(0.006, c, 1, 100), size: diag(0.004, c, 1, 40) })),
  ],
});

export const SURFACE_FILTERS: EffectDefinition[] = [CHROME, HOLOGRAPHIC];
