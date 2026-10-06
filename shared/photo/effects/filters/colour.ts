/**
 * Colour filters (docs/photo/effects/stylized-filters.md, "Colour"): looks made of the picture's own tones. Their
 * references are `../../reference/filters/colour.ts`, their WGSL `src/suites/photo/render/filters/colour.ts`.
 */
import type { Gradient } from "../../types.ts";
import type { EffectDefinition } from "../index.ts";
import { boolean, colour, degrees, gradient, kernelFilter, look, n, num, percent } from "../kernel.ts";

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

const COLOR_GRADE = kernelFilter({
  type: "color-grade",
  label: "Color Grade",
  description:
    "A film-style grade, as Camera Raw's: white balance warmer or cooler, saturation, an S-curve of contrast, split toning (one colour soft-lit into the shadows, another into the highlights) and a matte fade that lifts the blacks. Teal and orange, faded film, pastel and cross-processed looks.",
  category: "Colour",
  params: [
    num("temperature", "Temperature", "", -100, 100, 0, "Warmer (positive: more red, less blue) or cooler (negative)."),
    percent("saturation", "Saturation", 0, "More (positive) or less colour, around each pixel's brightness: −100 is black and white.", -100, 100),
    num("contrast", "Contrast", "", -100, 100, 0, "Positive: an S-curve (deeper shadows, brighter highlights). Negative: flatter, towards grey."),
    colour("shadows", "Shadows", "#2a5a78", "The colour soft-lit into the shadows (split toning)."),
    colour("highlights", "Highlights", "#ffb070", "The colour soft-lit into the highlights (split toning)."),
    num("balance", "Balance", "", -100, 100, 0, "Where shadows end and highlights begin: positive gives the highlights' colour more of the picture."),
    percent("toning", "Tint Amount", 0, "How strongly the shadows and highlights take their colours."),
    percent("fade", "Fade", 0, "A matte film look: blacks lifted and whites lowered a little."),
  ],
  reach: () => 0,
  isIdentity: (p) => n(p, "temperature") === 0 && n(p, "saturation") === 0 && n(p, "contrast") === 0 && n(p, "toning") === 0 && n(p, "fade") === 0,
  summary: (p) => {
    const parts: string[] = [];
    const t = n(p, "temperature");
    if (t !== 0) parts.push(`${t > 0 ? "warm" : "cool"} ${Math.abs(t)}`);
    if (n(p, "saturation") !== 0) parts.push(`saturation ${n(p, "saturation")}%`);
    if (n(p, "contrast") !== 0) parts.push(`contrast ${n(p, "contrast")}`);
    if (n(p, "toning") !== 0) parts.push(`split toned ${p.shadows} / ${p.highlights} ${n(p, "toning")}%`);
    if (n(p, "fade") !== 0) parts.push(`fade ${n(p, "fade")}%`);
    return parts.length ? parts.join(", ") : "neutral";
  },
  presets: [
    look("faded-film", "Faded Film", "Lifted, milky blacks, muted colour and warm highlights: an old print.", { temperature: 12, saturation: -25, contrast: 15, shadows: "#2e5468", highlights: "#ffd09a", balance: 0, toning: 40, fade: 65 }),
    look("teal-orange", "Teal & Orange", "The blockbuster grade: teal shadows, orange skin and highlights, punchy.", { temperature: 6, saturation: 15, contrast: 35, shadows: "#007f8c", highlights: "#ff8a30", balance: 10, toning: 75, fade: 0 }),
    look("pink-dream", "Pink Dream", "Hazy soft magenta highlights over lifted lilac blacks.", { temperature: 10, saturation: 10, contrast: -15, shadows: "#b0509c", highlights: "#ff5cc0", balance: 50, toning: 100, fade: 55 }),
    look("cold-night", "Cold Night", "Cool blue, desaturated and dark: moonlight.", { temperature: -65, saturation: -25, contrast: 25, shadows: "#0c2a6e", highlights: "#a8c4ff", balance: -10, toning: 55, fade: 15 }),
    look("cross-process", "Cross Process", "Slide film in the wrong chemicals: blue shadows, green-yellow highlights, hard contrast.", { temperature: -8, saturation: 30, contrast: 65, shadows: "#1a36b0", highlights: "#d6ff4a", balance: 0, toning: 80, fade: 0 }),
    look("bleach-bypass", "Bleach Bypass", "Silver left in: desaturated, harsh, metallic.", { temperature: 0, saturation: -65, contrast: 85, shadows: "#203440", highlights: "#f0efe4", balance: 0, toning: 20, fade: 8 }),
    look("golden-hour", "Golden Hour", "Warm low sun: amber highlights, brown shadows.", { temperature: 55, saturation: 10, contrast: 15, shadows: "#7a5a10", highlights: "#ffd840", balance: 40, toning: 85, fade: 8 }),
    look("vaporwave", "Vaporwave", "Pink highlights, cyan shadows, a soft fade: 80s retro-futurism.", { temperature: 0, saturation: 40, contrast: 15, shadows: "#00d0e8", highlights: "#ff30b8", balance: 60, toning: 100, fade: 25 }),
  ],
});

const POSTERIZE = kernelFilter({
  type: "posterize",
  label: "Posterize",
  description:
    "Photoshop's Posterize: each channel (sRGB-encoded) held to a few levels, so the picture becomes flat areas of colour, as a screenprint or a pop-art poster. Smooth softens the steps between them.",
  category: "Colour",
  params: [
    num("levels", "Levels", "", 2, 32, 5, "How many tones each of red, green and blue keeps: fewer is flatter and bolder."),
    percent("smooth", "Smooth", 0, "Softens each step over this much of the way to the next: 0 is hard edges between the areas."),
  ],
  reach: () => 0,
  summary: (p) => `${n(p, "levels")} levels${n(p, "smooth") ? `, smooth ${n(p, "smooth")}%` : ""}`,
  presets: [
    look("screenprint", "Screenprint", "Four tones a channel: flat inks.", { levels: 4, smooth: 0 }),
    look("pop", "Pop", "Three tones a channel: bold primaries, pop art.", { levels: 3, smooth: 0 }),
    look("retro", "Retro", "Eight soft-edged tones: a banded old print.", { levels: 8, smooth: 50 }),
    look("comic", "Comic", "Six tones a channel: comic-book colour.", { levels: 6, smooth: 0 }),
  ],
});

const PSYCHEDELIC = kernelFilter({
  type: "psychedelic",
  label: "Psychedelic",
  description:
    "Turns hues around the colour wheel: by Shift everywhere, plus Cycles turns from black to white, so brightness becomes a rainbow. Rainbow first colours grey areas so they join in; Saturation and Solarize (the brights turned dark, as a print exposed to light) push it further. Acid, oil-slick and thermal looks.",
  category: "Colour",
  params: [
    degrees("shift", "Shift", 0, "Turns every hue by this much (180°: each colour becomes its opposite)."),
    num("cycles", "Cycles", "", 0, 6, 1, "How many times the hues go round the wheel from black to white: brightness as a rainbow.", 0.05, 2),
    percent("rainbow", "Rainbow", 50, "Colour given to grey and dull midtones before the hues turn, so they take part."),
    percent("saturation", "Saturation", 130, "Colour after the turn: 100 leaves it, 0 is grey, 200 doubles it.", 0, 200),
    percent("solarize", "Solarize", 0, "Mixes in a solarised picture: brights turned dark, as a print exposed to light while developing."),
  ],
  reach: () => 0,
  isIdentity: (p) => n(p, "shift") % 360 === 0 && n(p, "cycles") === 0 && n(p, "rainbow") === 0 && n(p, "saturation") === 100 && n(p, "solarize") === 0,
  summary: (p) => [`${n(p, "shift")}°`, `${n(p, "cycles")} cycles`, `rainbow ${n(p, "rainbow")}%`, `saturation ${n(p, "saturation")}%`, ...(n(p, "solarize") ? [`solarize ${n(p, "solarize")}%`] : [])].join(", "),
  presets: [
    look("acid-trip", "Acid Trip", "Every brightness its own hue, loud and saturated.", { shift: 0, cycles: 2, rainbow: 60, saturation: 160, solarize: 0 }),
    look("oil-slick", "Oil Slick", "Fine iridescent bands, as oil on water.", { shift: -150, cycles: 4, rainbow: 45, saturation: 140, solarize: 20 }),
    look("invert-hues", "Invert Hues", "Each colour its opposite, brightness kept.", { shift: 180, cycles: 0, rainbow: 0, saturation: 120, solarize: 0 }),
    look("solarized", "Solarized", "Brights turned dark: Man Ray's darkroom accident, in colour.", { shift: 0, cycles: 0, rainbow: 0, saturation: 130, solarize: 100 }),
    look("thermal-dream", "Thermal Dream", "Blue shadows through magenta to yellow brights: a heat camera.", { shift: -120, cycles: 0.5, rainbow: 100, saturation: 160, solarize: 0 }),
  ],
});

export const COLOUR_FILTERS: EffectDefinition[] = [GRADIENT_MAP, COLOR_GRADE, POSTERIZE, PSYCHEDELIC];
