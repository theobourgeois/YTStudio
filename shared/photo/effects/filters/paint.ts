/**
 * Oil Paint: the picture as brush strokes (Stylize), a generalised Kuwahara filter in document pixels with relief
 * lighting and bristles. Its reference is `../../reference/filters/paint.ts`, its WGSL
 * `src/suites/photo/render/filters/paint.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { degrees, diag, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";

/** The largest stroke radius: its taps are stepped wider as it grows, so the reach and the work stay modest. */
export const MAX_PAINT_RADIUS = 40;

const OIL_PAINT = kernelFilter({
  type: "oil-paint",
  label: "Oil Paint",
  description:
    "Photoshop's Oil Paint: the picture repainted in strokes of flat colour that keep its edges crisp (a generalised Kuwahara filter: around each point, eight overlapping sectors within Radius are compared and the calmest ones' colour is used), then lit as thick paint. Radius is how big the strokes are; Sharpness how strictly the calmest sector wins (low blends them softly, high makes hard, blocky dabs); Shine lights the paint's relief, highlights on the side facing the light and shade on the other, from Angle (90° is from the top); Bristles adds the brush's streaks along the strokes (Seed picks another pattern of them).",
  category: "Stylize",
  params: [
    pixels("radius", "Radius", 1, MAX_PAINT_RADIUS, 6, "How big the brush strokes are: how far around each point the paint is gathered, in document pixels."),
    num("sharpness", "Sharpness", "", 1, 16, 8, "How strictly the calmest part around a point wins: low blends softly, high gives hard, flat dabs with crisp edges."),
    percent("shine", "Shine", 35, "How strongly the paint's relief catches the light: 0 is flat."),
    degrees("angle", "Angle", 135, "Where the light comes from: 0° from the right, 90° from the top."),
    percent("bristles", "Bristles", 35, "The brush's streaks along the strokes: 0 leaves the paint smooth."),
    seed("Which pattern of bristle streaks: another number, another one."),
  ],
  reach: (p) => n(p, "radius") + 0.5,
  summary: (p) => `${n(p, "radius")} px strokes, sharpness ${n(p, "sharpness")}, shine ${n(p, "shine")}%`,
  presets: [
    look("oil-paint", "Oil Paint", "Photoshop's: brushy strokes, lightly lit.", { sharpness: 8, shine: 35, angle: 135, bristles: 35, seed: 1 }, (c) => ({ radius: diag(0.006, c, 1, MAX_PAINT_RADIUS) })),
    look("impasto", "Impasto", "Thick, big strokes with strong relief and bristles: paint laid on with a loaded brush.", { sharpness: 10, shine: 85, angle: 135, bristles: 55, seed: 2 }, (c) => ({ radius: diag(0.011, c, 1, MAX_PAINT_RADIUS) })),
    look("soft-paint", "Soft Paint", "Blended, gentle strokes and hardly any texture: a soft gouache.", { sharpness: 3, shine: 10, angle: 135, bristles: 12, seed: 1 }, (c) => ({ radius: diag(0.008, c, 1, MAX_PAINT_RADIUS) })),
    look("palette-knife", "Palette Knife", "Big flat blocks with hard edges, as paint pressed on with a knife.", { sharpness: 16, shine: 60, angle: 60, bristles: 8, seed: 3 }, (c) => ({ radius: diag(0.014, c, 1, MAX_PAINT_RADIUS) })),
  ],
});

export const PAINT_FILTERS: EffectDefinition[] = [OIL_PAINT];
