/**
 * Stylize filters (docs/photo/effects/stylized-filters.md, "Stylize"): the picture redrawn as print and pixel
 * patterns (halftone screens, dithering, mosaics), each anchored to document pixels so tiles, reduced views and
 * exports draw the same pattern. Their references are `../../reference/filters/stylize.ts`, their WGSL
 * `src/suites/photo/render/filters/stylize.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, colour, degrees, diag, kernelFilter, look, n, num, percent, pixels } from "../kernel.ts";

/** The process inks CMYK halftones print in (cyan, magenta, yellow; K is the Ink colour), sRGB: a print's, not ideal ones. */
export const PROCESS_INKS = { cyan: "#00aeef", magenta: "#ec008c", yellow: "#fff200" } as const;

/** A size in whole document pixels, as a fraction of the canvas's diagonal: patterns of whole pixels don't beat. */
const whole = (fraction: number, canvas: { width: number; height: number }, min: number, max: number) => Math.min(max, Math.max(min, Math.round(diag(fraction, canvas))));

const HALFTONE = kernelFilter({
  type: "halftone",
  label: "Halftone",
  description:
    "A printer's screen: the picture redrawn as a grid of dots (or lines, or squares) whose size follows the ink at each cell, on paper. Mono prints one ink; CMYK prints four screens (cyan, magenta, yellow and the key) at the printers' angles, so they make rosettes; Colour prints each cell's own colour, bigger where it differs more from the paper (at most touching, so the dots stay dots). Cells are in document pixels: newsprint, comics, pop art, engravings.",
  category: "Stylize",
  params: [
    pixels("cellSize", "Cell Size", 2, 200, 12, "The screen's pitch: the distance between dot centres, in document pixels."),
    degrees("angle", "Angle", 45, "The screen's angle (CMYK: the key's; cyan is 30° less, magenta 30° more, yellow 45° less)."),
    choice("mode", "Mode", [["mono", "Mono"], ["cmyk", "CMYK"], ["colour", "Colour"]], "mono", "Mono: one ink, dots as big as the picture is dark. CMYK: four process inks multiplied over the paper. Colour: dots of each cell's colour, as big as it differs from the paper, never merging."),
    choice("shape", "Shape", [["dot", "Dot"], ["line", "Line"], ["square", "Square"]], "dot", "Round dots, lines that thicken with the ink (an engraving's), or squares."),
    colour("ink", "Ink", "#000000", "Mono's ink, and CMYK's key (K)."),
    colour("paper", "Paper", "#ffffff", "What's under the dots, in every mode."),
    percent("softness", "Softness", 0, "Blurs the dots' edges: 0 is crisp print."),
  ],
  reach: (p) => n(p, "cellSize") * Math.SQRT2,
  summary: (p) => `${p.mode === "cmyk" ? "CMYK" : p.mode === "colour" ? "colour" : "mono"} ${p.shape}s, ${n(p, "cellSize")} px at ${n(p, "angle")}°`,
  presets: [
    look("newsprint", "Newsprint", "Fine black dots at 45° on off-white newsprint.", { mode: "mono", shape: "dot", angle: 45, ink: "#1c1a18", paper: "#efe9dc", softness: 0 }, (c) => ({ cellSize: diag(0.007, c, 2, 200) })),
    look("comic-dots", "Comic Dots", "Four-colour comic printing: cyan, magenta, yellow and black rosettes.", { mode: "cmyk", shape: "dot", angle: 45, ink: "#000000", paper: "#fbf6e9", softness: 0 }, (c) => ({ cellSize: diag(0.011, c, 2, 200) })),
    look("pop-art", "Pop Art", "Big, bold CMYK dots on white, Lichtenstein's.", { mode: "cmyk", shape: "dot", angle: 45, ink: "#000000", paper: "#ffffff", softness: 0 }, (c) => ({ cellSize: diag(0.018, c, 2, 200) })),
    look("engraving", "Engraving", "Fine lines that swell in the shadows, as a banknote's portrait.", { mode: "mono", shape: "line", angle: -30, ink: "#1d1712", paper: "#f3ead6", softness: 0 }, (c) => ({ cellSize: diag(0.008, c, 2, 200) })),
    look("bold-dots", "Bold Dots", "Each cell's own colour as a dot on black: an LED poster.", { mode: "colour", shape: "dot", angle: 45, ink: "#000000", paper: "#000000", softness: 0 }, (c) => ({ cellSize: diag(0.016, c, 2, 200) })),
  ],
});

const DITHER = kernelFilter({
  type: "dither",
  label: "Dither",
  description:
    "Old screens' and printers' dithering: the picture in blocky pixels of a few tones, the steps between them made of a pattern (an ordered Bayer matrix, or noise). Mono shades between the Ink and Paper colours (Ink the darkest, Paper the lightest: a Game Boy's greens, 1-bit black and white); Colour quantises red, green and blue each to the levels (Ink and Paper aren't used).",
  category: "Stylize",
  params: [
    num("pixelSize", "Pixel Size", "px", 1, 64, 2, "How big each dithered pixel is, in document pixels: each is the average of the picture inside it."),
    num("levels", "Levels", "", 2, 16, 2, "Tones per channel: 2 is on or off."),
    choice("mode", "Mode", [["mono", "Mono"], ["colour", "Colour"]], "mono", "Mono: shades of Ink to Paper by brightness. Colour: each channel on its own."),
    choice("pattern", "Pattern", [["bayer4", "Bayer 4×4"], ["bayer8", "Bayer 8×8"], ["noise", "Noise"]], "bayer8", "The pattern between tones: Bayer's crosshatch (4×4 coarse, 8×8 finer steps) or random grit."),
    colour("ink", "Ink", "#000000", "Mono: the darkest tone."),
    colour("paper", "Paper", "#ffffff", "Mono: the lightest tone."),
  ],
  reach: (p) => n(p, "pixelSize"),
  summary: (p) => `${p.mode === "colour" ? "colour" : "mono"}, ${n(p, "levels")} levels, ${p.pattern === "noise" ? "noise" : p.pattern === "bayer4" ? "Bayer 4×4" : "Bayer 8×8"}, ${n(p, "pixelSize")} px`,
  presets: [
    look("one-bit", "1-Bit", "Black and white only, Bayer's crosshatch: a Macintosh screen.", { mode: "mono", levels: 2, pattern: "bayer8", ink: "#000000", paper: "#ffffff" }, (c) => ({ pixelSize: whole(0.002, c, 1, 64) })),
    look("game-boy", "Game Boy", "Four shades of the Game Boy's green.", { mode: "mono", levels: 4, pattern: "bayer4", ink: "#0f380f", paper: "#9bbc0f" }, (c) => ({ pixelSize: whole(0.003, c, 1, 64) })),
    look("retro-pc", "Retro PC", "Eight colours, chunky pixels: an early PC's palette.", { mode: "colour", levels: 2, pattern: "bayer4", ink: "#000000", paper: "#ffffff" }, (c) => ({ pixelSize: whole(0.004, c, 1, 64) })),
    look("grit", "Grit", "Noisy black ink on cream: a photocopy's grain.", { mode: "mono", levels: 2, pattern: "noise", ink: "#141210", paper: "#ece4d2" }, (c) => ({ pixelSize: whole(0.0012, c, 1, 64) })),
  ],
});

const PIXELATE = kernelFilter({
  type: "pixelate",
  label: "Pixelate",
  description:
    "Mosaic: the picture in square cells of one colour each, the average of what's inside them (in document pixels, anchored to the canvas's corner). Gap shrinks each cell to a tile on black; Circle makes the cells round, as an LED wall's lights.",
  category: "Stylize",
  params: [
    num("cellSize", "Cell Size", "px", 2, 300, 24, "Each cell's width, in document pixels."),
    choice("shape", "Shape", [["square", "Square"], ["circle", "Circle"]], "square", "Square cells, or round lights."),
    percent("gap", "Gap", 0, "Black between the cells, as a part of each cell's width.", 0, 90),
  ],
  reach: (p) => n(p, "cellSize"),
  summary: (p) => `${p.shape === "circle" ? "circles" : "squares"}, ${n(p, "cellSize")} px${n(p, "gap") > 0 ? `, gap ${n(p, "gap")}%` : ""}`,
  presets: [
    look("mosaic", "Mosaic", "Medium square tiles with a thin dark grout.", { shape: "square", gap: 5 }, (c) => ({ cellSize: whole(0.02, c, 2, 300) })),
    look("big-pixels", "Big Pixels", "Huge, flat pixels: an 8-bit close-up.", { shape: "square", gap: 0 }, (c) => ({ cellSize: whole(0.045, c, 2, 300) })),
    look("led-wall", "LED Wall", "Round lights on black, as a stadium's screen.", { shape: "circle", gap: 28 }, (c) => ({ cellSize: whole(0.014, c, 2, 300) })),
  ],
});

export const STYLIZE_FILTERS: EffectDefinition[] = [HALFTONE, DITHER, PIXELATE];
