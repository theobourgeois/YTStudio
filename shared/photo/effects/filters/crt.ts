/**
 * CRT: the picture on a cathode-ray tube up close, its phosphors, scanlines and curve (Glitch), in document pixels so tiles, reduced views and exports draw the same thing. Its references are
 * `../../reference/filters/crt.ts`, its WGSL `src/suites/photo/render/filters/crt.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, diag, kernelFilter, look, n, percent, pixels } from "../kernel.ts";

const CRT = kernelFilter({
  type: "crt",
  label: "CRT",
  description:
    "A cathode-ray tube seen up close: the picture sampled into cells (Cell Size, the width of one red-green-blue triad, in document pixels), each lit through the screen's phosphor Mask: Aperture Grille (a Trinitron's vertical stripes), Shadow Mask (dots in triangles) or Slot Mask (staggered slots). Mask Strength is how dark the gaps between phosphors are; Scanlines darkens between the rows (bright rows' beams are wider); Brightness makes up for the light the mask takes (100% keeps the picture's average, more burns the highlights); Glow blooms the phosphors' light around them. Curvature bends the picture as a curved tube, pulling the corners in by that many document pixels (the tube's corners black and rounded), and Vignette darkens towards them.",
  category: "Glitch",
  params: [
    pixels("cellSize", "Cell Size", 2, 64, 6, "The width of one red-green-blue triad, in document pixels: also the picture's cells and the scanlines' period."),
    choice("mask", "Mask", [["aperture", "Aperture Grille"], ["shadow", "Shadow Mask"], ["slot", "Slot Mask"]], "aperture", "The phosphors' layout: vertical stripes (Trinitron), dots in triangles (old TVs, arcade monitors) or staggered slots (most TVs)."),
    percent("strength", "Mask Strength", 80, "How dark the gaps between phosphors are: 0 has no mask."),
    percent("scanlines", "Scanlines", 50, "How dark the gaps between the picture's rows are."),
    percent("brightness", "Brightness", 100, "How much of the light the mask and scanlines take is made up: 100% keeps the picture's average, more burns the highlights.", 0, 200),
    percent("glow", "Glow", 35, "The phosphors' light blooming around them, added as light."),
    pixels("curvature", "Curvature", 0, 400, 0, "How far a curved tube pulls the canvas's corners in, in document pixels: 0 is a flat screen."),
    percent("vignette", "Vignette", 20, "Darkens the tube towards its edges."),
  ],
  reach: (p) => n(p, "curvature") + 2.5 * n(p, "cellSize"),
  summary: (p) => `${p.mask === "shadow" ? "shadow mask" : p.mask === "slot" ? "slot mask" : "aperture grille"}, ${n(p, "cellSize")} px${n(p, "curvature") > 0 ? `, curved ${n(p, "curvature")} px` : ""}`,
  presets: [
    look("trinitron", "Trinitron", "Fine vertical phosphor stripes and scanlines on a flat screen.", { mask: "aperture", strength: 80, scanlines: 55, brightness: 110, glow: 35, vignette: 15 }, (c) => ({ cellSize: diag(0.007, c, 2, 64), curvature: 0 })),
    look("arcade", "Arcade", "A curved arcade tube: shadow-mask dots, deep scanlines, bloom.", { mask: "shadow", strength: 85, scanlines: 65, brightness: 125, glow: 55, vignette: 45 }, (c) => ({ cellSize: diag(0.012, c, 2, 64), curvature: diag(0.04, c, 0, 400) })),
    look("monitor", "Monitor", "An office monitor's slot mask, slightly curved.", { mask: "slot", strength: 75, scanlines: 40, brightness: 105, glow: 25, vignette: 25 }, (c) => ({ cellSize: diag(0.008, c, 2, 64), curvature: diag(0.015, c, 0, 400) })),
    look("giant-pixels", "Giant Pixels", "Huge triads and rows: a screen seen through a magnifier.", { mask: "aperture", strength: 90, scanlines: 75, brightness: 135, glow: 45, vignette: 10 }, (c) => ({ cellSize: diag(0.02, c, 2, 64), curvature: 0 })),
  ],
});


export const CRT_FILTERS: EffectDefinition[] = [CRT];
