/**
 * Risograph and ASCII: the picture printed or typed (Stylize), in document pixels so tiles, reduced views and exports draw the same thing. Its references are
 * `../../reference/filters/print.ts`, its WGSL `src/suites/photo/render/filters/print.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { boolean, choice, colour, diag, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";

const RISOGRAPH = kernelFilter({
  type: "risograph",
  label: "Risograph",
  description:
    "A risograph print: the picture separated into two or three spot inks, each printed through its own drum as a grainy stochastic screen and a little out of register, multiplied over the paper. Inks picks two or three; Ink 1–3 are their colours (fluorescent pink, blue and yellow to start; dark parts of the picture print every ink, so pick inks that make a dark together). Density prints heavier or lighter ink; Grain Size is the size of the ink's grain in document pixels and Grain how much the ink breaks up into it (0 prints smooth tones), with blotches where the drum laid less ink; Misregistration is how far each ink can slip (each its own way, by Seed); Paper Texture a faint fibre in the Paper colour.",
  category: "Stylize",
  params: [
    choice("inks", "Inks", [["2", "Two"], ["3", "Three"]], "2", "How many inks print: two (Ink 1 and 2) or three."),
    colour("ink1", "Ink 1", "#ff48b0", "The first ink's colour (Fluorescent Pink to start)."),
    colour("ink2", "Ink 2", "#0078bf", "The second ink's colour (Riso Blue to start)."),
    colour("ink3", "Ink 3", "#ffe800", "The third ink's colour (Yellow to start), with Inks: Three."),
    colour("paper", "Paper", "#f3eee4", "The paper the inks print on: what shows where there's no ink."),
    percent("density", "Density", 100, "How heavily the inks print: less is pale and washed out, more fills the shadows.", 20, 150),
    pixels("grainSize", "Grain Size", 0.5, 20, 1.5, "The size of the ink's grain, in document pixels."),
    percent("grain", "Grain", 70, "How much the ink breaks up into grain and blotches: 0 prints smooth tones."),
    pixels("misregistration", "Misregistration", 0, 60, 4, "How far each ink can slip out of register, in document pixels (each ink its own way)."),
    percent("texture", "Paper Texture", 40, "A faint fibre and mottle in the paper."),
    seed("Which grain and which way each ink slips: another number, another print."),
  ],
  reach: (p) => n(p, "misregistration"),
  summary: (p) => `${p.inks === "3" ? "three" : "two"} inks, grain ${n(p, "grainSize")} px, misregistration ${n(p, "misregistration")} px`,
  presets: [
    look("pink-blue", "Pink & Blue", "Fluorescent pink and blue, the classic riso zine.", { inks: "2", ink1: "#ff48b0", ink2: "#0078bf", ink3: "#ffe800", paper: "#f3eee4", density: 100, grain: 70, texture: 40, seed: 1 }, (c) => ({ grainSize: diag(0.0016, c, 0.5, 20), misregistration: diag(0.004, c, 0, 60) })),
    look("fluoro", "Fluoro", "Fluorescent pink and yellow: a loud gig poster.", { inks: "2", ink1: "#ff48b0", ink2: "#ffe800", ink3: "#0078bf", paper: "#f6f2ea", density: 115, grain: 65, texture: 35, seed: 3 }, (c) => ({ grainSize: diag(0.0016, c, 0.5, 20), misregistration: diag(0.005, c, 0, 60) })),
    look("teal-orange", "Teal & Orange", "Teal and orange inks on warm paper.", { inks: "2", ink1: "#ff6c2f", ink2: "#00838a", ink3: "#ffe800", paper: "#f1e9da", density: 105, grain: 70, texture: 45, seed: 5 }, (c) => ({ grainSize: diag(0.0018, c, 0.5, 20), misregistration: diag(0.004, c, 0, 60) })),
    look("three-colour", "Three Colour", "Pink, blue and yellow: nearly full colour, but riso's.", { inks: "3", ink1: "#ff48b0", ink2: "#0078bf", ink3: "#ffe800", paper: "#f4f0e8", density: 100, grain: 60, texture: 35, seed: 7 }, (c) => ({ grainSize: diag(0.0014, c, 0.5, 20), misregistration: diag(0.003, c, 0, 60) })),
    look("faded", "Faded", "Thin, grainy ink slipping out of register on yellowed paper.", { inks: "2", ink1: "#f15060", ink2: "#3255a4", ink3: "#ffe800", paper: "#ece2cc", density: 82, grain: 90, texture: 80, seed: 11 }, (c) => ({ grainSize: diag(0.0024, c, 0.5, 20), misregistration: diag(0.009, c, 0, 60) })),
  ],
});


/**
 * ASCII's font: 5 × 7 bitmaps ("#" lit), its ramp in order of ink, from a space to "@". Both implementations read the
 * packed bits (`ASCII_GLYPHS`).
 */
const FONT: readonly [string, readonly string[]][] = [
  [" ", [".....", ".....", ".....", ".....", ".....", ".....", "....."]],
  [".", [".....", ".....", ".....", ".....", ".....", "..#..", "....."]],
  [":", [".....", "..#..", ".....", ".....", "..#..", ".....", "....."]],
  ["-", [".....", ".....", ".....", ".###.", ".....", ".....", "....."]],
  ["~", [".....", ".....", ".#...", "#.#.#", "...#.", ".....", "....."]],
  ["+", [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."]],
  ["=", [".....", ".....", "#####", ".....", "#####", ".....", "....."]],
  ["*", [".....", "..#..", "#.#.#", ".###.", "#.#.#", "..#..", "....."]],
  ["o", [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."]],
  ["%", ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"]],
  ["&", [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"]],
  ["O", [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]],
  ["8", [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]],
  ["$", ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."]],
  ["#", [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."]],
  ["@", [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".####"]],
];

/** The ramp's characters, from the least ink to the most. */
export const ASCII_RAMP = FONT.map(([ch]) => ch).join("");

/**
 * Each glyph's bits: bit `row * 5 + column` (row 0 at the top, column 0 at the left) of 35, as two u32s (bits 0–31,
 * then 32–34), and how many are lit.
 */
export const ASCII_GLYPHS: readonly { lo: number; hi: number; count: number }[] = FONT.map(([, rows]) => {
  let lo = 0;
  let hi = 0;
  let count = 0;
  rows.forEach((row, r) =>
    [...row].forEach((ch, col) => {
      if (ch !== "#") return;
      const bit = r * 5 + col;
      if (bit < 32) lo = (lo | (1 << bit)) >>> 0;
      else hi = (hi | (1 << (bit - 32))) >>> 0;
      count++;
    }),
  );
  return { lo, hi, count };
});

/** A text cell's width as a share of its height (square cells are 1). */
export const ASCII_TEXT_ASPECT = 0.6;

const ASCII = kernelFilter({
  type: "ascii",
  label: "ASCII",
  description:
    `The picture as text: cut into character cells (Cell Size is a character's height in document pixels; Text cells are 0.6 as wide, Square ones as wide as tall), each drawn as a character from a ramp by how bright the cell is ("${ASCII_RAMP}", from no ink to the most), in a 5 × 7 pixel font. Colour: Mono draws every character in the Ink colour on the Background (a terminal); Own draws each in its cell's own colour, brightened, on the Background; Paper types dark Ink on a light Background, darker parts of the picture getting denser characters, each struck a little unevenly as a typewriter's. Brightness lifts the cells before characters are picked and Contrast pushes them apart; Invert reverses the ramp. Rain fades each column in streaks with a bright head, as falling code (seeded).`,
  category: "Stylize",
  params: [
    num("cellSize", "Cell Size", "px", 4, 200, 12, "A character's height, in document pixels."),
    choice("cells", "Cells", [["text", "Text"], ["square", "Square"]], "text", "Text: characters 0.6 as wide as tall, as a terminal's. Square: square cells, each character centred."),
    choice("mode", "Colour", [["mono", "Mono"], ["own", "Own"], ["paper", "Paper"]], "mono", "Mono: Ink on the Background. Own: each character in its cell's colour. Paper: dark Ink typed on a light Background, denser where the picture is dark."),
    colour("ink", "Ink", "#41ff6a", "The characters' colour (Mono, Paper)."),
    colour("background", "Background", "#050805", "Behind the characters: the screen, or the paper."),
    percent("brightness", "Brightness", 0, "Lifts (or lowers) the cells' brightness before characters are picked: lift a dark picture so its shadows still get characters.", -100, 100),
    percent("contrast", "Contrast", 30, "Pushes the cells' brightness apart before characters are picked, so more of them are blank or full."),
    boolean("invert", "Invert", false, "Reverses the ramp: bright cells get the lightest characters."),
    percent("rain", "Rain", 0, "Fades each column in streaks with a bright head, as falling code: 0 has none."),
    seed("Which streaks and which uneven strikes: another number, another page."),
  ],
  reach: (p) => 1.2 * n(p, "cellSize"),
  summary: (p) => `${p.mode === "own" ? "own colour" : p.mode === "paper" ? "paper" : "mono"}, ${n(p, "cellSize")} px ${p.cells === "square" ? "square" : "text"} cells`,
  presets: [
    look("terminal", "Terminal", "Green phosphor characters on a black terminal.", { cells: "text", mode: "mono", ink: "#41ff6a", background: "#040a05", brightness: 20, contrast: 25, invert: false, rain: 0, seed: 1 }, (c) => ({ cellSize: diag(0.013, c, 4, 200) })),
    look("matrix", "Matrix-ish", "Falling streams of green code, the picture showing through.", { cells: "text", mode: "mono", ink: "#00ff41", background: "#000000", brightness: 30, contrast: 30, invert: false, rain: 85, seed: 3 }, (c) => ({ cellSize: diag(0.011, c, 4, 200) })),
    look("colour-text", "Colour Text", "Each character in its own colour on black.", { cells: "square", mode: "own", ink: "#ffffff", background: "#000000", brightness: 25, contrast: 20, invert: false, rain: 0, seed: 1 }, (c) => ({ cellSize: diag(0.011, c, 4, 200) })),
    look("typewriter", "Typewriter", "Dark ink struck unevenly on cream paper.", { cells: "text", mode: "paper", ink: "#1e1b18", background: "#efe7d6", brightness: 25, contrast: 30, invert: false, rain: 0, seed: 5 }, (c) => ({ cellSize: diag(0.011, c, 4, 200) })),
    look("big-type", "Big Type", "Huge white characters on black: a poster.", { cells: "square", mode: "mono", ink: "#f2f2f2", background: "#0b0b0b", brightness: 15, contrast: 35, invert: false, rain: 0, seed: 1 }, (c) => ({ cellSize: diag(0.032, c, 4, 200) })),
  ],
});


export const PRINT_FILTERS: EffectDefinition[] = [RISOGRAPH, ASCII];
