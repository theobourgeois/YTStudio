/**
 * Distort filters (docs/photo/effects/stylized-filters.md, "Distort"): the picture read from elsewhere, moved by a
 * field of offsets in document pixels. Their references are `../../reference/filters/distort.ts`, their WGSL
 * `src/suites/photo/render/filters/distort.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, diag, kernelFilter, look, n, pixels, seed } from "../kernel.ts";

const sine = { showIf: { key: "type", is: "sine" } } as const;
const liquid = { showIf: { key: "type", is: "liquid" } } as const;

const WAVE = kernelFilter({
  type: "wave",
  label: "Wave",
  description:
    "Ripples the picture. Sine: regular waves, Amplitude pixels high and Wavelength pixels long; Horizontal slides rows side to side (vertical lines become waves), Vertical slides columns up and down, Both does both. Liquid: a smooth, seeded swirl of offsets up to Amplitude pixels, its features about Scale pixels across, as seen through water or heat. Near the canvas's edges it reads the edge rather than past it.",
  category: "Distort",
  params: [
    choice("type", "Type", [["sine", "Sine"], ["liquid", "Liquid"]], "sine", "Sine: regular waves. Liquid: a smooth random swirl."),
    pixels("amplitude", "Amplitude", 0, 300, 12, "How far the picture moves at most, in document pixels."),
    { ...pixels("wavelength", "Wavelength", 2, 4000, 120, "The length of one wave, crest to crest, in document pixels."), ...sine },
    { ...choice("direction", "Direction", [["horizontal", "Horizontal"], ["vertical", "Vertical"], ["both", "Both"]], "horizontal", "Horizontal: rows slide side to side. Vertical: columns slide up and down. Both: a wobbly grid."), ...sine },
    { ...pixels("scale", "Scale", 2, 4000, 160, "How big the swirls are, in document pixels."), ...liquid },
    { ...seed(), ...liquid },
  ],
  reach: (p) => n(p, "amplitude") + 1,
  isIdentity: (p) => n(p, "amplitude") === 0,
  summary: (p) => (p.type === "liquid" ? `liquid, ${n(p, "amplitude")} px, scale ${n(p, "scale")} px` : `sine ${p.direction}, ${n(p, "amplitude")} px every ${n(p, "wavelength")} px`),
  presets: [
    look("wavy", "Wavy", "Gentle, wide waves running down the picture.", { type: "sine", direction: "horizontal" }, (c) => ({ amplitude: diag(0.016, c), wavelength: diag(0.25, c) })),
    look("liquid", "Liquid", "A big, smooth melt, as paint swirled in water.", { type: "liquid", seed: 3 }, (c) => ({ amplitude: diag(0.035, c, 0.5, 300), scale: diag(0.22, c) })),
    look("heat-haze", "Heat Haze", "Fine shimmering, as over hot tarmac.", { type: "liquid", seed: 1 }, (c) => ({ amplitude: diag(0.004, c), scale: diag(0.025, c) })),
    look("ripple", "Ripple", "Fine, close waves sliding the rows: a reflection in rippled water.", { type: "sine", direction: "horizontal" }, (c) => ({ amplitude: diag(0.004, c), wavelength: diag(0.026, c) })),
  ],
});

export const DISTORT_FILTERS: EffectDefinition[] = [WAVE];
