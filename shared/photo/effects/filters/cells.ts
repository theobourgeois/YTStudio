/**
 * Crystallize, Pointillize and Stained Glass: the picture as cells (Pixelate), each a jittered grid of seeded sites in
 * document pixels (Voronoi cells, or dots), so tiles, reduced views and exports draw the same cells. Their references
 * are `../../reference/filters/cells.ts`, their WGSL `src/suites/photo/render/filters/cells.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { colour, diag, kernelFilter, look, n, num, percent, pixels, seed } from "../kernel.ts";

/** The largest cell: what a cell reads stays within a modest reach (two cells and a little). */
export const MAX_CELL = 200;
/** Pointillize's largest dot, as a part of its cell: a dot never reaches past its neighbouring cells. */
export const MAX_DOT = 170;

const cell = (def: number, description: string) => pixels("cellSize", "Cell Size", 3, MAX_CELL, def, description);

const CRYSTALLIZE = kernelFilter({
  type: "crystallize",
  label: "Crystallize",
  description:
    "Photoshop's Crystallize: the picture broken into polygonal crystals (Voronoi cells around seeded points on a jittered grid), each one flat colour, the average of the picture around its point. Cell Size is how big the crystals are; Jitter how irregular (0 is a square grid, 100% fully random shapes); Facets shades each crystal as a tilted facet, lighter on one side and darker on the other, so it reads as cut glass or shards; Seed picks another arrangement. Edges are smoothed over a pixel.",
  category: "Pixelate",
  params: [
    cell(20, "How big each crystal is: the spacing of their points, in document pixels."),
    percent("jitter", "Jitter", 100, "How irregular the crystals are: 0 is a regular square grid, 100% fully random polygons."),
    percent("facets", "Facets", 0, "Shades each crystal as a tilted facet, lighter towards a random side: 0 leaves them flat."),
    seed("Which arrangement of crystals: another number, another one."),
  ],
  reach: (p) => 2.25 * n(p, "cellSize"),
  summary: (p) => `${n(p, "cellSize")} px crystals, jitter ${n(p, "jitter")}%${n(p, "facets") > 0 ? `, facets ${n(p, "facets")}%` : ""}`,
  presets: [
    look("crystallize", "Crystallize", "Photoshop's: medium irregular crystals of flat colour.", { jitter: 100, facets: 0, seed: 1 }, (c) => ({ cellSize: diag(0.022, c, 3, MAX_CELL) })),
    look("shards", "Shards", "Big shattered facets, each lit on one side: a broken mirror.", { jitter: 100, facets: 70, seed: 4 }, (c) => ({ cellSize: diag(0.07, c, 3, MAX_CELL) })),
    look("fine-crystals", "Fine Crystals", "Small crystals: the picture as frosted glass.", { jitter: 100, facets: 15, seed: 2 }, (c) => ({ cellSize: diag(0.008, c, 3, MAX_CELL) })),
    look("regular", "Regular", "Nearly square cells, a little uneven: a tiled mosaic.", { jitter: 30, facets: 0, seed: 1 }, (c) => ({ cellSize: diag(0.028, c, 3, MAX_CELL) })),
  ],
});

const POINTILLIZE = kernelFilter({
  type: "pointillize",
  label: "Pointillize",
  description:
    "Photoshop's Pointillize, Seurat's pointillism: the picture repainted as round dots of colour on paper. Each dot sits at a seeded point on a jittered grid Cell Size apart and takes the picture's colour there; Dot Size is its diameter as a part of the cell (over 100% the dots overlap, stacked in a random order, and cover the paper); Variation varies each dot's brightness, hue and saturation at random, as a painter's dabs; Paper shows between the dots; Seed picks another arrangement.",
  category: "Pixelate",
  params: [
    cell(14, "The spacing of the dots, in document pixels."),
    num("dotSize", "Dot Size", "%", 30, MAX_DOT, 100, "Each dot's diameter, as a part of the cell: small dots show paper between them, over 100% they overlap."),
    percent("variation", "Variation", 30, "How much each dot's brightness, hue and saturation vary at random: 0 is the picture's own colours."),
    colour("paper", "Paper", "#f4efe3", "What shows between the dots."),
    seed("Which arrangement of dots: another number, another one."),
  ],
  reach: (p) => 2.3 * n(p, "cellSize"),
  summary: (p) => `${n(p, "cellSize")} px dots at ${n(p, "dotSize")}%, variation ${n(p, "variation")}%`,
  presets: [
    look("pointillism", "Pointillism", "Seurat's dabs: dense, slightly varied dots on cream.", { dotSize: 140, variation: 35, paper: "#f4efe3", seed: 1 }, (c) => ({ cellSize: diag(0.011, c, 3, MAX_CELL) })),
    look("confetti", "Confetti", "Big dots in wildly varied colours on white, as confetti.", { dotSize: 120, variation: 100, paper: "#ffffff", seed: 3 }, (c) => ({ cellSize: diag(0.03, c, 3, MAX_CELL) })),
    look("fine-dots", "Fine Dots", "Tiny dots, the picture's own colours, a little paper between them.", { dotSize: 115, variation: 12, paper: "#fbf8f1", seed: 2 }, (c) => ({ cellSize: diag(0.006, c, 3, MAX_CELL) })),
    look("dark-paper", "Dark Paper", "Glowing dots of colour on black paper.", { dotSize: 85, variation: 30, paper: "#0b0a10", seed: 5 }, (c) => ({ cellSize: diag(0.016, c, 3, MAX_CELL) })),
  ],
});

const STAINED_GLASS = kernelFilter({
  type: "stained-glass",
  label: "Stained Glass",
  description:
    "Photoshop's Stained Glass: the picture as panes of flat, slightly saturated colour (Voronoi cells around seeded points, each pane the average of the picture around its point) held in lead lines. Cell Size is how big the panes are; Border the lead's width in document pixels, in the Lead colour (with a little sheen along its middle); Light Intensity lights the panes from behind, brighter at their centres and darker at their edges (at its highest the centres glow above white); Seed picks another arrangement.",
  category: "Pixelate",
  params: [
    cell(32, "How big each pane is: the spacing of their points, in document pixels."),
    pixels("border", "Border", 0, 40, 4, "The lead lines' width, in document pixels: 0 has none."),
    colour("lead", "Lead", "#15120f", "The lead lines' colour."),
    percent("light", "Light Intensity", 35, "Light behind the glass: centres brighter, edges darker. 0 leaves the panes flat."),
    seed("Which arrangement of panes: another number, another one."),
  ],
  reach: (p) => 2.25 * n(p, "cellSize"),
  summary: (p) => `${n(p, "cellSize")} px panes, ${n(p, "border")} px lead, light ${n(p, "light")}%`,
  presets: [
    look("stained-glass", "Stained Glass", "Photoshop's: medium panes in dark lead, softly lit.", { lead: "#15120f", light: 35, seed: 1 }, (c) => ({ cellSize: diag(0.035, c, 3, MAX_CELL), border: diag(0.004, c, 0.5, 40) })),
    look("cathedral", "Cathedral", "Big panes glowing from behind, as a rose window in sunlight.", { lead: "#0d0b09", light: 100, seed: 2 }, (c) => ({ cellSize: diag(0.06, c, 3, MAX_CELL), border: diag(0.006, c, 0.5, 40) })),
    look("mosaic", "Mosaic", "Small tiles in pale grout.", { lead: "#d9d2c3", light: 15, seed: 3 }, (c) => ({ cellSize: diag(0.014, c, 3, MAX_CELL), border: diag(0.0025, c, 0.5, 40) })),
    look("leaded", "Leaded", "Thick black lead around bold panes.", { lead: "#070707", light: 45, seed: 4 }, (c) => ({ cellSize: diag(0.045, c, 3, MAX_CELL), border: diag(0.011, c, 0.5, 40) })),
  ],
});

export const CELLS_FILTERS: EffectDefinition[] = [CRYSTALLIZE, POINTILLIZE, STAINED_GLASS];
