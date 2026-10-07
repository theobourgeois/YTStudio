/**
 * Reeded Glass and Frosted Glass: the picture seen through glass (Distort), each point read from where the glass's
 * surface bends its ray, in document pixels. Their references are `../../reference/filters/glass.ts`, their WGSL
 * `src/suites/photo/render/filters/glass.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, kernelFilter, look, n, percent, pixels, seed } from "../kernel.ts";

/** Dispersion's largest spread: red refracted this much more than green, blue this much less, at 100%. */
export const DISPERSION = 0.25;

const REEDED_GLASS = kernelFilter({
  type: "reeded-glass",
  label: "Reeded Glass",
  description:
    "The picture seen through ribbed (reeded or fluted) glass, the album-cover look: parallel ribs Width pixels across, turned by Angle (0° vertical ribs). Profile is each rib's shape: Round, a convex cylinder that shows a mirrored slice of what's behind it, smeared at its edges; Fluted, a concave groove that shows a squeezed, upright copy; Prism, a straight slope, each rib a shifted copy with hard seams (a sawtooth). Refraction is how far the reads move, as a share of the rib's width: more shows more of the picture in each rib. Dispersion refracts red, green and blue by different amounts, so every rib gets colour fringes. Frost averages a few seeded reads up to that many pixels apart, a soft, frosted glass. Highlight adds a thin sheen of light along each rib and darkens the seams between them.",
  category: "Distort",
  params: [
    pixels("width", "Width", 2, 300, 24, "How wide each rib is, in document pixels."),
    degrees("angle", "Angle", 0, "Which way the ribs run: 0° vertical ribs (the picture splits into columns), 90° horizontal ones."),
    choice("profile", "Profile", [["round", "Round"], ["fluted", "Fluted"], ["prism", "Prism"]], "round", "Round: convex ribs, each a mirrored slice. Fluted: concave grooves, each a squeezed upright copy. Prism: straight slopes, each rib a shifted copy with hard seams."),
    percent("refraction", "Refraction", 200, "How far the glass moves what's seen through it, as a share of the rib's width: past 100% a Round rib shows its slice mirrored, past 200% squeezed, the same things seen in several ribs.", 0, 250),
    percent("dispersion", "Dispersion", 0, "Red, green and blue bent by different amounts: colour fringes along every rib."),
    pixels("frost", "Frost", 0, 40, 0, "Frosts the glass: the picture averaged over seeded reads up to this many document pixels apart."),
    percent("highlight", "Highlight", 30, "A thin sheen of light along each rib, and darker seams between them."),
    seed("Which frost pattern: another number, another one."),
  ],
  reach: (p) => (n(p, "refraction") / 100) * n(p, "width") * (1 + DISPERSION * (n(p, "dispersion") / 100)) + n(p, "frost"),
  isIdentity: (p) => n(p, "refraction") === 0 && n(p, "frost") === 0 && n(p, "highlight") === 0,
  summary: (p) => `${p.profile} ribs ${n(p, "width")} px at ${n(p, "angle")}°, refraction ${n(p, "refraction")}%${n(p, "dispersion") ? `, dispersion ${n(p, "dispersion")}%` : ""}${n(p, "frost") ? `, frost ${n(p, "frost")} px` : ""}`,
  presets: [
    look("reeded", "Reeded", "Vertical convex ribs, each a mirrored slice of the picture, with a soft sheen: the reeded-glass cover.", { angle: 0, profile: "round", refraction: 220, dispersion: 0, highlight: 35 }, (c) => ({ width: diag(0.03, c, 2, 300), frost: 0 })),
    look("fluted", "Fluted", "Concave flutes, each a squeezed upright copy, bright ridges between them.", { angle: 0, profile: "fluted", refraction: 90, dispersion: 0, highlight: 40 }, (c) => ({ width: diag(0.045, c, 2, 300), frost: 0 })),
    look("shower-glass", "Shower Glass", "Narrow frosted ribs: a bathroom door, the picture broken into soft stripes.", { angle: 0, profile: "round", refraction: 200, dispersion: 0, highlight: 25, seed: 1 }, (c) => ({ width: diag(0.011, c, 2, 300), frost: diag(0.003, c, 0, 40) })),
    look("prism", "Prism", "Sawtooth prisms that shift each stripe and split its colours into fringes.", { angle: 0, profile: "prism", refraction: 70, dispersion: 100, highlight: 30 }, (c) => ({ width: diag(0.05, c, 2, 300), frost: 0 })),
    look("wide-ribs", "Wide Ribs", "A few wide convex ribs, each a big mirrored lens.", { angle: 0, profile: "round", refraction: 160, dispersion: 25, highlight: 45 }, (c) => ({ width: diag(0.11, c, 2, 300), frost: 0 })),
  ],
});

const glassTextures: [string, string][] = [
  ["frosted", "Frosted"],
  ["blocks", "Blocks"],
  ["lens", "Tiny Lens"],
  ["rippled", "Rippled"],
  ["drops", "Raindrops"],
];

const GLASS = kernelFilter({
  type: "glass",
  label: "Frosted Glass",
  description:
    "Photoshop's Distort › Glass: the picture seen through a sheet of textured glass, each point read from where the texture's slope bends it, at most Distortion pixels away. Texture: Frosted, fine seeded bumps (a grainy, broken-up picture); Blocks, square glass bricks of Scale pixels, each a small lens with dark seams; Tiny Lens, a grid of round lenses Scale pixels across, each showing a turned-round copy; Rippled, smooth wavy ripples, as a bathroom window; Raindrops, seeded drops up to half a Scale cell across, each a clear lens with a dark rim and a highlight. Frost blurs the picture through seeded reads up to that many pixels apart (with Raindrops only the glass between the drops, which stay clear). Seed picks the random pattern.",
  category: "Distort",
  params: [
    choice("texture", "Texture", glassTextures, "frosted", "The glass's surface: Frosted bumps, Blocks (glass bricks), Tiny Lens (round lenses), Rippled waves or Raindrops.", false),
    pixels("distortion", "Distortion", 0, 200, 8, "How far the glass moves what's seen through it at most, in document pixels."),
    pixels("scale", "Scale", 1, 400, 4, "The texture's size, in document pixels: a bump's, a block's, a lens's or a drop's cell."),
    pixels("frost", "Frost", 0, 40, 0, "Frosts the glass: the picture averaged over seeded reads up to this many document pixels apart."),
    seed(),
  ],
  reach: (p) => n(p, "distortion") + n(p, "frost"),
  isIdentity: (p) => n(p, "distortion") === 0 && n(p, "frost") === 0 && p.texture !== "blocks" && p.texture !== "drops" && p.texture !== "lens",
  summary: (p) => `${glassTextures.find(([v]) => v === p.texture)?.[1] ?? p.texture}, ${n(p, "distortion")} px, scale ${n(p, "scale")} px${n(p, "frost") ? `, frost ${n(p, "frost")} px` : ""}`,
  presets: [
    look("frosted", "Frosted", "Photoshop's frosted glass: the picture broken into fine, grainy bumps.", { texture: "frosted", seed: 1 }, (c) => ({ distortion: diag(0.01, c, 0.5, 200), scale: diag(0.003, c, 1, 400), frost: diag(0.002, c, 0, 40) })),
    look("glass-blocks", "Glass Blocks", "A wall of glass bricks, each its own small lens.", { texture: "blocks", seed: 2 }, (c) => ({ distortion: diag(0.035, c, 0.5, 200), scale: diag(0.07, c, 1, 400), frost: diag(0.001, c, 0, 40) })),
    look("tiny-lens", "Tiny Lens", "A grid of small round lenses, each a turned-round copy of what's behind it.", { texture: "lens", seed: 1 }, (c) => ({ distortion: diag(0.06, c, 0.5, 200), scale: diag(0.035, c, 1, 400), frost: 0 })),
    look("bathroom-window", "Bathroom Window", "Wavy rippled glass: the picture swims in soft, uneven waves.", { texture: "rippled", seed: 3 }, (c) => ({ distortion: diag(0.018, c, 0.5, 200), scale: diag(0.04, c, 1, 400), frost: diag(0.002, c, 0, 40) })),
    look("rain-glass", "Rain Glass", "A fogged window with raindrops: clear drops, each a tiny upside-down lens, on frosted glass.", { texture: "drops", seed: 4 }, (c) => ({ distortion: diag(0.025, c, 0.5, 200), scale: diag(0.05, c, 1, 400), frost: diag(0.008, c, 0, 40) })),
  ],
});

export const GLASS_FILTERS: EffectDefinition[] = [REEDED_GLASS, GLASS];
