/**
 * Glitch filters (docs/photo/effects/stylized-filters.md, "Glitch"): the picture's channels and rows pushed out of
 * place, as a damaged signal does. All of it repeatable: anything random is seeded and in document pixels. Their
 * references are `../../reference/filters/glitch.ts`, their WGSL `src/suites/photo/render/filters/glitch.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, kernelFilter, look, n, pixels } from "../kernel.ts";

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

export const GLITCH_FILTERS: EffectDefinition[] = [RGB_SPLIT];
