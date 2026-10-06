/**
 * Glitch filters (docs/photo/effects/stylized-filters.md, "Glitch"): the picture's channels and rows pushed out of
 * place, as a damaged signal does. All of it repeatable: anything random is seeded and in document pixels. Their
 * references are `../../reference/filters/glitch.ts`, their WGSL `src/suites/photo/render/filters/glitch.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, kernelFilter, look, n, percent, pixels, seed } from "../kernel.ts";

const RGB_SPLIT = kernelFilter({
  type: "rgb-split",
  label: "RGB Split",
  description:
    "Chromatic aberration: the red channel pushed one way and the blue the other (or red against cyan, an anaglyph), across the picture or outwards from its centre as a cheap lens does.",
  category: "Glitch",
  params: [
    pixels("distance", "Distance", 0, 500, 12, "How far each channel moves, in document pixels (Radial: at the canvas's corners)."),
    degrees("angle", "Angle", 0, "Which way red moves (blue goes the other way). Linear only."),
    choice("mode", "Mode", [["linear", "Linear"], ["radial", "Radial"]], "linear", "Linear: the same shift everywhere. Radial: none at the centre, growing towards the corners, as a lens's fringes."),
    choice("pair", "Channels", [["rgb", "Red / Blue"], ["anaglyph", "Red / Cyan"]], "rgb", "Red against blue (green stays), or red against green and blue together, as 3D glasses."),
  ],
  reach: (p) => n(p, "distance"),
  isIdentity: (p) => n(p, "distance") === 0,
  summary: (p) => `${p.mode === "radial" ? "radial" : `${n(p, "angle")}°`}, ${n(p, "distance")} px${p.pair === "anaglyph" ? ", red / cyan" : ""}`,
  presets: [
    look("fringe", "Fringe", "A thin colour fringe on every edge.", { mode: "linear", angle: 0, pair: "rgb" }, (c) => ({ distance: diag(0.002, c) })),
    look("wide-split", "Wide Split", "Channels pulled well apart: loud and graphic.", { mode: "linear", angle: 0, pair: "rgb" }, (c) => ({ distance: diag(0.01, c) })),
    look("anaglyph", "Anaglyph 3D", "Red and cyan, as a 3D poster without the glasses.", { mode: "linear", angle: 0, pair: "anaglyph" }, (c) => ({ distance: diag(0.006, c) })),
    look("lens-fringe", "Lens Fringe", "Clean at the centre, fringed at the corners.", { mode: "radial", pair: "rgb" }, (c) => ({ distance: diag(0.006, c) })),
  ],
});

const GLITCH = kernelFilter({
  type: "glitch",
  label: "Glitch",
  description:
    "Digital corruption: horizontal slices of the picture shoved sideways, blocks copied from elsewhere or dragged into streaks (data moshing), the colour channels split apart (more in what moved), and a few blocks posterised or with their channels swapped. Random but seeded: the same Seed always breaks it the same way.",
  category: "Glitch",
  params: [
    pixels("sliceHeight", "Slice Height", 1, 400, 24, "How tall the shoved slices are, in document pixels (thinner ones come with them); blocks are twice as big."),
    pixels("shift", "Shift", 0, 500, 60, "How far slices are shoved and blocks copied from, at most, in document pixels."),
    percent("density", "Density", 40, "The chance of each slice being shoved."),
    percent("blocks", "Blocks", 20, "How many blocks are copied, dragged into streaks or corrupted."),
    pixels("split", "Split", 0, 100, 6, "How far the red and blue channels are pulled apart, in document pixels (about a third as far where nothing moved)."),
    seed("Which glitch: another number breaks it another way."),
  ],
  reach: (p) => n(p, "shift") + n(p, "split"),
  isIdentity: (p) => n(p, "density") === 0 && n(p, "blocks") === 0 && n(p, "split") === 0,
  summary: (p) => `${n(p, "density")}% slices, ${n(p, "blocks")}% blocks, shift ${n(p, "shift")} px`,
  presets: [
    look("slice", "Slice", "Slices shoved sideways with a colour split.", { density: 45, blocks: 0 }, (c) => ({ sliceHeight: diag(0.025, c, 1, 400), shift: diag(0.06, c, 0, 500), split: diag(0.004, c, 0, 100) })),
    look("data-mosh", "Data Mosh", "Blocks torn out, copied and smeared into stripes of one line.", { density: 12, blocks: 75 }, (c) => ({ sliceHeight: diag(0.018, c, 1, 400), shift: diag(0.08, c, 0, 500), split: diag(0.005, c, 0, 100) })),
    look("light-glitch", "Light Glitch", "A few thin slices and a slight split.", { density: 18, blocks: 8 }, (c) => ({ sliceHeight: diag(0.012, c, 1, 400), shift: diag(0.02, c, 0, 500), split: diag(0.0025, c, 0, 100) })),
    look("wrecked", "Wrecked", "Everything at once: barely holding together.", { density: 70, blocks: 60 }, (c) => ({ sliceHeight: diag(0.03, c, 1, 400), shift: diag(0.15, c, 0, 500), split: diag(0.012, c, 0, 100) })),
  ],
});

const VHS = kernelFilter({
  type: "vhs",
  label: "VHS",
  description:
    "A still from a worn videotape: colour bleeding to the right of the picture's brightness, lines jittering sideways, a tracking band (its lines shoved further, streaked and noisy), scanlines, snow, and a washed-out warm picture with lifted blacks. Seeded: the same Seed always gives the same tape.",
  category: "Glitch",
  params: [
    pixels("bleed", "Bleed", 0, 200, 8, "How far colour smears to the right of the brightness, in document pixels."),
    pixels("jitter", "Jitter", 0, 80, 2, "How far lines wobble sideways, in document pixels (several times that in the tracking band)."),
    pixels("lineHeight", "Line Height", 1, 50, 3, "The height of the picture's lines, in document pixels: what jitters together, and the scanlines' period."),
    percent("tracking", "Tracking", 50, "How bad the tracking band is: 0 has none."),
    percent("band", "Band", 80, "Where the tracking band is, down the canvas's height."),
    percent("scanlines", "Scanlines", 25, "How dark the gaps between lines are."),
    percent("noise", "Noise", 15, "Snow: a different value at every document pixel."),
    percent("wash", "Wash", 40, "Faded tape: less saturated, warmer, the blacks lifted."),
    seed("Which tape: another number jitters it another way."),
  ],
  reach: (p) => n(p, "bleed") + n(p, "jitter") * (1.35 + 4.65 * (n(p, "tracking") / 100)),
  summary: (p) => `bleed ${n(p, "bleed")} px, tracking ${n(p, "tracking")}%, scanlines ${n(p, "scanlines")}%`,
  presets: [
    look("vhs-tape", "VHS Tape", "A home video: soft colour, a little jitter, a tracking band low down.", { tracking: 50, band: 82, scanlines: 25, noise: 15, wash: 40 }, (c) => ({ bleed: diag(0.008, c, 0, 200), jitter: diag(0.0012, c, 0, 80), lineHeight: diag(0.003, c, 1, 50) })),
    look("worn-tape", "Worn Tape", "Played a thousand times: smeared, faded, the tracking gone.", { tracking: 100, band: 62, scanlines: 30, noise: 35, wash: 75 }, (c) => ({ bleed: diag(0.014, c, 0, 200), jitter: diag(0.003, c, 0, 80), lineHeight: diag(0.003, c, 1, 50) })),
    look("crt", "CRT", "An old television: strong scanlines, a slight bleed, no tracking band.", { tracking: 0, band: 50, scanlines: 75, noise: 8, wash: 15 }, (c) => ({ bleed: diag(0.003, c, 0, 200), jitter: diag(0.0004, c, 0, 80), lineHeight: diag(0.005, c, 1, 50) })),
  ],
});

export const GLITCH_FILTERS: EffectDefinition[] = [RGB_SPLIT, GLITCH, VHS];
