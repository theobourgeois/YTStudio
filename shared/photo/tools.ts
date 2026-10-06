/**
 * The photo suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in `src/suites/photo/tools.ts`, their
 * edits in `tool-edits.ts`). Whatever the user can do, the assistant can: add a tool with each feature.
 */
import { type Schema, bool, int, num, obj, oneOf, str, tool } from "../tool-spec.ts";
import { ADJUSTMENTS } from "./effects/index.ts";

const layer = str('A layer: its id (from get_photo) or its name ("Sky").');

/** Every adjustment and its parameters, for the model: names, units, ranges, defaults. */
export function describeAdjustments(): string {
  return ADJUSTMENTS.map((def) => {
    const params = def.params.map((p) =>
      p.kind === "number" ? `${p.key} (${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ""}, default ${p.default}): ${p.description}` : `${p.key}: ${p.description}`,
    );
    return `${def.type}: ${def.description}\n  ${params.join("\n  ")}`;
  }).join("\n");
}

/** An adjustment's parameters: any of its definition's (see describeAdjustments). */
const adjustmentParams: Schema = {
  type: "object",
  description:
    'Parameters to set; the rest keep their value (a new layer\'s start at their defaults). Exposure: { "exposure": 1, "offset": 0, "gamma": 1 }. Curves: points [input, output] on 0..255 per curve, e.g. { "rgb": [[0, 0], [64, 50], [192, 210], [255, 255]], "red": [[0, 10], [255, 255]] } (or the same under "curves").',
  additionalProperties: true,
};

export const PHOTO_TOOLS = [
  tool({
    name: "get_photo",
    title: "Read the photo",
    kind: "look",
    description:
      "The photo open in the editor as text: its canvas (size in pixels, background), and its layers from the top down, each with its id, name, visibility and opacity; an image layer's image and where it is (centre, scale, rotation, and its box on the canvas); an adjustment layer's settings. Start here.",
    inputSchema: obj({}),
  }),
  tool({
    name: "list_photo_media",
    title: "List images",
    kind: "look",
    description: "The images in this project (its media): ids, names and sizes. add_image_layer places one on the canvas.",
    inputSchema: obj({}),
  }),
  tool({
    name: "view_photo",
    title: "Look at the photo",
    kind: "look",
    description:
      "A picture of the photo as it would export (every visible layer on the canvas), as a JPEG. Look before and after you change how it looks. Transparent parts show over a checkerboard.",
    inputSchema: obj({ width: int("Width of the picture in pixels, 64 to 1600 (default 768). Its height follows the canvas.") }),
  }),
  tool({
    name: "add_image_layer",
    title: "Place an image",
    kind: "edit",
    description:
      "Places one of the project's images (from list_photo_media) on the canvas as a new layer on top: centred, at its own size, or scaled down to fit when it's bigger than the canvas. The source is kept whole, so transforming it later never loses quality.",
    inputSchema: obj({ media: str("The image: its media id or its name."), name: str("The layer's name (default: the file's).") }, ["media"]),
  }),
  tool({
    name: "transform_layer",
    title: "Move, scale or rotate a layer",
    kind: "edit",
    description:
      "Moves, scales or rotates a layer. Positions are the layer's centre in canvas pixels (0, 0 is the top-left corner). Scale is a factor of the image's own size (1 = 100%; negative mirrors); rotation is in degrees, clockwise. Give only what changes. `fit` scales and centres it to fit inside the canvas (contain) or to cover it (cover), keeping its proportions.",
    inputSchema: obj(
      {
        layer,
        x: num("Centre's x, in canvas pixels."),
        y: num("Centre's y, in canvas pixels."),
        dx: num("Move right by this many pixels (negative: left)."),
        dy: num("Move down by this many pixels (negative: up)."),
        scale: num("Scale both ways (1 = 100%)."),
        scaleX: num("Horizontal scale (negative mirrors)."),
        scaleY: num("Vertical scale (negative flips)."),
        rotation: num("Rotation in degrees, clockwise (absolute)."),
        fit: oneOf(["contain", "cover"], "Fit inside the canvas, or cover it."),
      },
      ["layer"],
    ),
  }),
  tool({
    name: "set_layer",
    title: "Change a layer",
    kind: "edit",
    description: "Renames a layer, shows or hides it, sets its opacity (an adjustment's opacity fades its effect), or moves it in the stack. Give only what changes.",
    inputSchema: obj(
      {
        layer,
        name: str("Its new name."),
        visible: bool("Shown or hidden."),
        opacity: num("0 to 1."),
        order: int("Its place in the stack: 0 is the bottom; a big number puts it on top."),
      },
      ["layer"],
    ),
  }),
  tool({
    name: "add_adjustment",
    title: "Add an adjustment layer",
    kind: "edit",
    description: `Adds an adjustment layer (Photoshop's): it changes everything below it, and nothing is lost (hide it, fade it with set_layer's opacity, or change it with set_effect_params). It goes above \`above\` (a layer), or on top. The adjustments:\n${describeAdjustments()}`,
    inputSchema: obj(
      {
        type: oneOf(
          ADJUSTMENTS.map((d) => d.type),
          "Which adjustment.",
        ),
        params: adjustmentParams,
        above: str("The layer to put it right above (id or name); default: the top."),
        name: str("Its name (default: the adjustment's)."),
      },
      ["type"],
    ),
  }),
  tool({
    name: "set_effect_params",
    title: "Change an adjustment",
    kind: "edit",
    description: "Sets an adjustment layer's parameters (see add_adjustment for each one's), or puts them back to their defaults with reset. A curve given replaces that curve; the others stay.",
    inputSchema: obj({ layer, params: adjustmentParams, reset: bool("Back to its defaults first.") }, ["layer"]),
  }),
  tool({
    name: "remove_layer",
    title: "Delete a layer",
    kind: "edit",
    description: "Deletes a layer (undoable; the image stays in the project's media).",
    inputSchema: obj({ layer }, ["layer"]),
  }),
  tool({
    name: "set_canvas",
    title: "Resize the canvas",
    kind: "edit",
    description:
      "Changes the canvas: its size in pixels (layers keep their place, measured from the top-left corner, or from the centre with anchor: centre) and its background (a colour like #ffffff, or none for transparent). Common sizes: 1080×1920 story/reel, 1080×1350 portrait post, 1080×1080 square, 1280×720 thumbnail.",
    inputSchema: obj({
      width: int("Width in pixels."),
      height: int("Height in pixels."),
      background: str('A colour "#rrggbb", or "none" for transparent.'),
      anchor: oneOf(["top-left", "centre"], "What stays put when the size changes (default top-left)."),
    }),
  }),
  tool({
    name: "export_photo",
    title: "Export the photo",
    kind: "action",
    description:
      "Exports the photo as a PNG (keeps transparency; 8 or 16 bits a channel) or a JPEG (over the background, or white), at its canvas size. 16 bits keeps a 16-bit source's precision. The file goes to the app's exports; the result says where.",
    inputSchema: obj({ format: oneOf(["png", "jpeg"], "png (default) or jpeg."), bits: oneOf(["8", "16"], "PNG's bits a channel (default 8)."), quality: int("JPEG quality, 1 to 100 (default 92).") }),
  }),
] as const;

export type PhotoToolName = (typeof PHOTO_TOOLS)[number]["name"];
