/**
 * Extrude: the picture cut into blocks or pyramids raised towards the viewer (Stylize), in document pixels so tiles, reduced views and exports draw the same thing. Its references are
 * `../../reference/filters/extrude.ts`, its WGSL `src/suites/photo/render/filters/extrude.ts`.
 */
import type { EffectDefinition } from "../index.ts";
import { choice, degrees, diag, kernelFilter, look, n, num, seed } from "../kernel.ts";

/** Extrude's depth is at most this many blocks, so the blocks that can cover a point are bounded. */
export const EXTRUDE_MAX_BLOCKS = 12;

const EXTRUDE = kernelFilter({
  type: "extrude",
  label: "Extrude",
  description:
    "Photoshop's Extrude, seen at an angle: the picture cut into square blocks (Size, in document pixels), each raised towards the viewer as a block (or a pyramid) by up to Depth document pixels, by its brightness (Level: bright blocks stand tallest) or at random (seeded). The raised faces move along Angle (−90° straight up the canvas) by their height, their sides filling the gap, shaded darker by which way they face; taller blocks hide lower ones. Front faces are Solid (each block's average colour) or the Image inside them, moved up with the block. Depth is at most twelve blocks.",
  category: "Stylize",
  params: [
    choice("shape", "Type", [["blocks", "Blocks"], ["pyramids", "Pyramids"]], "blocks", "Square blocks with flat fronts, or four-sided pyramids."),
    num("size", "Size", "px", 2, 128, 30, "Each block's width, in document pixels."),
    num("depth", "Depth", "px", 0, 400, 40, "How far the tallest block rises, in document pixels (at most twelve blocks)."),
    choice("height", "Height", [["level", "Level"], ["random", "Random"]], "level", "Level: bright blocks rise highest, dark ones stay flat. Random: each its own height (seeded)."),
    degrees("angle", "Angle", -60, "Which way the raised faces move on the canvas: −90° straight up, 0° right."),
    choice("front", "Front Faces", [["solid", "Solid"], ["image", "Image"]], "solid", "Solid: each block's average colour. Image: the picture inside it, raised with it."),
    seed("Which random heights: another number, another wall."),
  ],
  reach: (p) => {
    const s = n(p, "size");
    return Math.max(Math.min(n(p, "depth"), EXTRUDE_MAX_BLOCKS * s) + 0.25 * s, 1.42 * s) + 1.32 * s;
  },
  summary: (p) => `${p.shape === "pyramids" ? "pyramids" : "blocks"}, ${n(p, "size")} px, depth ${n(p, "depth")} px by ${p.height === "random" ? "chance" : "level"}`,
  presets: [
    look("blocks", "Blocks", "Bright blocks standing out of the picture, the image on their fronts.", { shape: "blocks", height: "level", angle: -60, front: "image", seed: 1 }, (c) => ({ size: diag(0.03, c, 2, 128), depth: diag(0.06, c, 0, 400) })),
    look("pyramids", "Pyramids", "Studs of pyramids, lit from the top left.", { shape: "pyramids", height: "level", angle: -60, front: "solid", seed: 1 }, (c) => ({ size: diag(0.035, c, 2, 128), depth: diag(0.03, c, 0, 400) })),
    look("city", "City", "Tall towers by brightness: the picture as a skyline seen from above.", { shape: "blocks", height: "level", angle: -75, front: "solid", seed: 1 }, (c) => ({ size: diag(0.022, c, 2, 128), depth: diag(0.14, c, 0, 400) })),
    look("random-bricks", "Random Bricks", "Small blocks at random heights, as a wall of bricks.", { shape: "blocks", height: "random", angle: -40, front: "solid", seed: 3 }, (c) => ({ size: diag(0.018, c, 2, 128), depth: diag(0.025, c, 0, 400) })),
  ],
});


export const EXTRUDE_FILTERS: EffectDefinition[] = [EXTRUDE];
