/**
 * The photo suite's tools for AI agents (see `shared/tool-spec.ts`; handlers in `src/suites/photo/tools.ts`, their
 * edits in `tool-edits.ts`). Whatever the user can do, the assistant can: add a tool with each feature.
 */
import { type Schema, arr, bool, int, num, obj, oneOf, str, tool } from "../tool-spec.ts";
import { BLEND_MODES } from "./blending.ts";
import { ADJUSTMENTS, EFFECTS, type EffectKind, FILTERS, GENERATORS } from "./effects/index.ts";
import { FLARE_PRESETS } from "./effects/flare.ts";
import type { ElementParamSpec, ParamSpec } from "./effects/params.ts";
import { STYLE_DEFINITIONS } from "./style/definitions.ts";

const layer = str('A layer: its id (from get_photo) or its name ("Sky").');

/** A parameter for the model: its range, unit and default, and what it does. */
function paramLine(p: ParamSpec | ElementParamSpec, indent: string): string {
  switch (p.kind) {
    case "number":
      return `${p.key} (${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ""}, default ${p.default}): ${p.description}`;
    case "colour":
      return `${p.key} (a colour "#rrggbb", default ${p.default}): ${p.description}`;
    case "choice":
      return `${p.key} (${p.options.map((o) => o.value).join(" | ")}, default ${p.default}): ${p.description}`;
    case "boolean":
      return `${p.key} (true or false, default ${p.default}): ${p.description}`;
    case "point":
      return `${p.key} ([x, y] in canvas pixels${p.nullable ? ", or null: the canvas's centre" : ""}): ${p.description}`;
    case "elements":
      return `${p.key} (a list of up to ${p.max}): ${p.description}\n${p.types.map((t) => `${indent}  ${t.type}: ${t.description}\n${t.params.map((q) => `${indent}    ${paramLine(q, indent + "    ")}`).join("\n")}`).join("\n")}`;
    default:
      return `${p.key}: ${p.description}`;
  }
}

/** Every effect of a kind and its parameters, for the model: names, units, ranges, defaults. */
export function describeEffects(kind: EffectKind): string {
  return EFFECTS.filter((d) => d.kind === kind)
    .map((def) => `${def.type}: ${def.description}\n  ${def.params.map((p) => paramLine(p, "  ")).join("\n  ")}`)
    .join("\n");
}

/** Every adjustment and its parameters. */
export const describeAdjustments = () => describeEffects("adjustment");

/** Every layer effect and its parameters, for the model. */
export function describeStyleEffects(): string {
  return STYLE_DEFINITIONS.map((def) => {
    const params = def.params.map((p) => {
      if (p.kind === "number") return `${p.key} (${p.min} to ${p.max}${p.unit ? ` ${p.unit}` : ""}, default ${p.default})`;
      if (p.kind === "choice") return `${p.key} (${p.options.map((o) => o.value).join(" | ")}, default ${p.default})`;
      if (p.kind === "boolean") return `${p.key} (true | false, default ${p.default})`;
      if (p.kind === "colour") return `${p.key} ("#rrggbb", default ${p.default})`;
      if (p.kind === "blend") return `${p.key} (a blend mode, default ${p.default})`;
      return `${p.key} (${p.kind})`;
    });
    return `${def.type}${def.max > 1 ? ` (up to ${def.max})` : ""}: ${def.description} ${params.join(", ")}`;
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
      "The photo open in the editor as text: its canvas (size in pixels, background, highlights), and its layers from the top down, each with its id, name, visibility and opacity; an image layer's image and where it is (centre, scale, rotation, and its box on the canvas); an adjustment layer's settings; a generator's (a flare's handles and elements); each layer's filters. Start here.",
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
    description: "Renames a layer, shows or hides it, sets its opacity (an adjustment's opacity fades its effect), moves it in the stack, or sets a generator's blend. Give only what changes.",
    inputSchema: obj(
      {
        layer,
        name: str("Its new name."),
        visible: bool("Shown or hidden."),
        opacity: num("0 to 1."),
        order: int("Its place in the stack: 0 is the bottom; a big number puts it on top."),
        blend: oneOf(["add", "normal"], "A generator layer's blend: add (Linear Dodge in linear light: its light adds to what's below) or normal."),
      },
      ["layer"],
    ),
  }),
  tool({
    name: "set_layer_blending",
    title: "Set a layer's blending",
    kind: "edit",
    description:
      "Photoshop's Blending Options on one or more layers: the blend mode (how the layer's colours mix with what's below: multiply darkens, screen lightens, overlay adds contrast, color/luminosity/hue/saturation take part of the colour…), Opacity, Fill (fades the layer but, in eight modes (color-burn, linear-burn, color-dodge, linear-dodge, vivid-light, linear-light, hard-mix, difference), works inside the mode and looks different from Opacity), the channels that blend, and Blend If: ranges on 0..255 that hide the layer where its own colour (layer) or the colour below it (underlying) is outside them, [black low, black high, white low, white high], a split handle (low < high) fading it in between. Give only what changes. An adjustment layer's mode blends its adjusted picture with the original (Curves in luminosity changes contrast without colour).",
    inputSchema: obj(
      {
        layers: arr(layer, "The layers (ids or names)."),
        mode: oneOf(
          BLEND_MODES.map((m) => m.id),
          "The blend mode.",
        ),
        opacity: num("0 to 1."),
        fill: num("Fill, 0 to 1."),
        channels: obj({ r: bool("Red blends."), g: bool("Green blends."), b: bool("Blue blends.") }),
        blendIf: {
          type: "object",
          description:
            'Blend If entries to set, by "gray", "red", "green" or "blue": { "layer": [0, 0, 255, 255], "underlying": [0, 40, 255, 255] } (a side left out keeps its range); null clears an entry, and blendIf: null clears all. E.g. { "gray": { "layer": [0, 0, 200, 240] } } fades out the layer\'s brightest parts.',
          additionalProperties: true,
        },
      },
      ["layers"],
    ),
  }),
  tool({
    name: "set_layer_style",
    title: "Set a layer's effects",
    kind: "edit",
    description: `Photoshop's layer effects (fx) on an image or pixel layer: add one, change it, hide it or remove it. They're drawn in a fixed order (drop shadows and the outer glow under the layer; overlays, satin, inner glow, inner shadows and strokes over it; Bevel & Emboss over everything). Sizes and distances are pixels, opacities and other shares percentages (0..100), angles degrees anticlockwise from 3 o'clock (where the light comes from: 120 throws a shadow down and right). With globalLight true (the shadows' and the bevel's default) the angle (and a bevel's altitude) is the document's Global Light (set_global_light). A contour is a preset name ("Cone", "Gaussian", "Ring"…) and a gradient { "colours": [{ "at": 0, "colour": "#ff0000" }, { "at": 1, "colour": "#0000ff" }], "opacities": [{ "at": 0, "opacity": 1 }, { "at": 1, "opacity": 1 }], "method": "classic" }. The effects:\n${describeStyleEffects()}`,
    inputSchema: obj(
      {
        layer,
        add: oneOf(
          STYLE_DEFINITIONS.map((d) => d.type),
          "Add an effect of this type (with params over its defaults).",
        ),
        effect: str('The effect to change, hide or remove: its id (from get_photo), or its type when the layer has one ("drop-shadow").'),
        params: { type: "object", description: "Parameters to set; the rest keep their value.", additionalProperties: true },
        enabled: bool("Shown (true) or hidden (false)."),
        remove: bool("Remove the effect."),
        allEffects: bool("Show (true) or hide (false) all the layer's effects at once (the Layers panel's Effects eye)."),
        clear: bool("Remove all its effects."),
      },
      ["layer"],
    ),
  }),
  tool({
    name: "set_global_light",
    title: "Set the Global Light",
    kind: "edit",
    description: "The document's one light (Layer › Layer Style › Global Light): every shadow with globalLight follows its angle (degrees anticlockwise from 3 o'clock, -180 to 180) and altitude (0 to 90).",
    inputSchema: obj({ angle: num("Degrees."), altitude: num("Degrees above the horizon.") }),
  }),
  tool({
    name: "copy_layer_style",
    title: "Copy a layer style",
    kind: "edit",
    description: "Copy Layer Style, then Paste: gives `to` layers the same effects and Blending Options as `from` (replacing theirs).",
    inputSchema: obj({ from: str("The layer to copy from."), to: arr(layer, "The layers to paste onto.") }, ["from", "to"]),
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
    title: "Change an adjustment or a generator",
    kind: "edit",
    description:
      "Sets an adjustment layer's parameters (see add_adjustment for each one's) or a generator layer's (a Lens Flare's: see add_generator), or puts them back to their defaults with reset (a flare keeps its handles and elements). A curve given replaces that curve; a flare's elements given replace its list (keep an element's id to keep it); the others stay. A layer's filters are set_filter's.",
    inputSchema: obj({ layer, params: adjustmentParams, reset: bool("Back to its defaults first.") }, ["layer"]),
  }),
  tool({
    name: "add_filter",
    title: "Add a filter",
    kind: "edit",
    description: `Adds a filter (Photoshop's Smart Filter) to an image, pixel or generator layer: it works on that layer's own pixels, in linear light, before its mask, after its other filters, and is kept editable (set_filter, remove_filter). The filters:\n${describeEffects("filter")}`,
    inputSchema: obj(
      {
        layer,
        type: oneOf(
          FILTERS.map((d) => d.type),
          "Which filter.",
        ),
        params: { type: "object", description: "Parameters other than the defaults (see above).", additionalProperties: true },
      },
      ["layer", "type"],
    ),
  }),
  tool({
    name: "set_filter",
    title: "Change a filter",
    kind: "edit",
    description:
      "Changes a filter of a layer (from get_photo: its id, or its number in the layer's list, 1 being applied first): its parameters (the rest keep their value), bypassed or on (enabled), its place in the list (order: 1 applies first), or back to its defaults (reset). all_enabled bypasses or turns on every filter of the layer at once, each keeping its own setting.",
    inputSchema: obj(
      {
        layer,
        filter: str("The filter: its id, or its number in the layer's list (1: applied first)."),
        params: { type: "object", description: "Parameters to set (see add_filter).", additionalProperties: true },
        enabled: bool("On (true) or bypassed (false), keeping its settings."),
        order: int("Its place in the layer's list: 1 is applied first."),
        reset: bool("Back to its defaults first."),
        all_enabled: bool("Every filter of the layer bypassed (false) or on (true) together."),
      },
      ["layer", "filter"],
    ),
  }),
  tool({
    name: "remove_filter",
    title: "Remove a filter",
    kind: "edit",
    description: "Removes a filter from a layer (undoable).",
    inputSchema: obj({ layer, filter: str("The filter: its id, or its number in the layer's list (1: applied first).") }, ["layer", "filter"]),
  }),
  tool({
    name: "add_generator",
    title: "Add a lens flare",
    kind: "edit",
    description: `Adds a generator layer: content it makes itself, live (move its handles with move_handle, change it with set_effect_params). A new Lens Flare adds its light to what's below in linear light (set_layer's blend: add), with the preset's elements sized for this canvas. Presets: ${FLARE_PRESETS.map((p) => p.id).join(", ")}. The generators:\n${describeEffects("generator")}`,
    inputSchema: obj({
      type: oneOf(
        GENERATORS.map((d) => d.type),
        "Which generator (default lens-flare).",
      ),
      preset: oneOf(
        FLARE_PRESETS.map((p) => p.id),
        "A flare's starting elements (default classic).",
      ),
      source: arr({ type: "number" }, "Where the light is: [x, y] in canvas pixels (default: the upper left third)."),
      params: { type: "object", description: "Other parameters (see above).", additionalProperties: true },
      above: str("The layer to put it right above (id or name); default: the top."),
      name: str("Its name (default: the generator's)."),
    }),
  }),
  tool({
    name: "move_handle",
    title: "Move a flare's handle",
    kind: "edit",
    description:
      "Moves a generator's handle (a Lens Flare's source, where its light is, or its optical centre, which its ghosts line up through) to a point of the canvas, in canvas pixels; follow_canvas: true puts the optical centre back on the canvas's centre (following it).",
    inputSchema: obj(
      {
        layer,
        handle: oneOf(["source", "centre"], "Which handle."),
        x: num("Canvas pixels from the left."),
        y: num("Canvas pixels from the top."),
        follow_canvas: bool("The optical centre on the canvas's centre (it follows the canvas)."),
      },
      ["layer", "handle"],
    ),
  }),
  tool({
    name: "select_rect",
    title: "Select a rectangle",
    kind: "edit",
    description:
      "Selects a rectangle of the canvas (Photoshop's Rectangular Marquee), in canvas pixels from the top-left corner; it's clipped to the canvas. all: true selects the whole canvas, none: true deselects. The selection limits what the user's brush paints, and add_mask can make a layer's mask from it. It belongs to the photo open in the editor (undoable, not saved).",
    inputSchema: obj({
      x: num("Left edge, canvas pixels."),
      y: num("Top edge, canvas pixels."),
      width: num("Width, pixels."),
      height: num("Height, pixels."),
      all: bool("Select the whole canvas."),
      none: bool("Deselect."),
    }),
  }),
  tool({
    name: "add_mask",
    title: "Add a layer mask",
    kind: "edit",
    description:
      "Adds a mask to a layer (Photoshop's layer mask: black hides the layer, white reveals it, painted by the user). from: selection makes it the current selection (select_rect first): the layer shows only there; from: empty (the default) reveals everything until it's painted. On an adjustment layer the mask says where it applies. remove: true deletes the layer's mask. Undoable.",
    inputSchema: obj({ layer, from: oneOf(["selection", "empty"], "What it starts as (default empty: reveals everything)."), remove: bool("Delete the layer's mask instead.") }, ["layer"]),
  }),
  tool({
    name: "layer_via_copy",
    title: "Copy the selection to a new layer",
    kind: "edit",
    description:
      "Photoshop's Layer via Copy (⌘J) and Layer via Cut (⇧⌘J, cut: true): what a layer shows inside the current selection (select_rect first) becomes a new pixel layer right above it, where it was; cutting also clears it from the layer (painted pixels only: a placed image can be copied, not cut). Undoable. The photo must be open in the editor.",
    inputSchema: obj({ layer, cut: bool("Also clear it from the layer.") }, ["layer"]),
  }),
  tool({
    name: "fill_selection",
    title: "Fill the selection",
    kind: "edit",
    description:
      "Fills the current selection (the whole layer without one) on a pixel layer, or on a layer's mask, with a colour: the foreground or background colour, a colour like #ff8800, or clear (transparent on pixels; on a mask, the background colour, as Photoshop's Delete). On a mask, a colour's grey is what's filled: black hides, white reveals. A placed image can't be filled (it's kept whole). Undoable. The photo must be open in the editor.",
    inputSchema: obj(
      {
        layer,
        with: str('"foreground", "background", "clear", or a colour "#rrggbb".'),
        target: oneOf(["content", "mask"], "The layer's pixels (default) or its mask."),
      },
      ["layer", "with"],
    ),
  }),
  tool({
    name: "add_pixel_layer",
    title: "Add a pixel layer",
    kind: "edit",
    description: "Adds an empty pixel layer (Photoshop's New Layer) the canvas's size, for the user to paint on: above `above` (a layer), or on top. You can't paint strokes yourself.",
    inputSchema: obj({ name: str("Its name (default Layer 1, Layer 2…)."), above: str("The layer to put it right above (id or name); default: the top.") }),
  }),
  tool({
    name: "merge_layers",
    title: "Merge layers",
    kind: "edit",
    description:
      "Merges layers into one image layer of what they show together (Photoshop's Merge Layers, Merge Down, Merge Visible), in the topmost one's place. Give `layers` (two or more), or one layer with down: true to merge it into the layer right below it (named after that one), or visible: true for every visible layer. Hidden layers are left as they are; an adjustment changes only the merged layers below it. What's past the canvas is kept. Undoable, but the result is pixels: the layers can't be transformed apart any more.",
    inputSchema: obj({
      layers: arr(str("A layer: id or name."), "The layers to merge (ids or names)."),
      down: bool("Merge the one layer given into the layer below it."),
      visible: bool("Merge every visible layer."),
    }),
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
      "Changes the canvas: how its layers mix (compositing), its size in pixels (layers keep their place, measured from the top-left corner, or from the centre with anchor: centre), its background (a colour like #ffffff, or none for transparent) and its highlights (film or clip). Common sizes: 1080×1920 story/reel, 1080×1350 portrait post, 1080×1080 square, 1280×720 thumbnail.",
    inputSchema: obj({
      width: int("Width in pixels."),
      height: int("Height in pixels."),
      background: str('A colour "#rrggbb", or "none" for transparent.'),
      anchor: oneOf(["top-left", "centre"], "What stays put when the size changes (default top-left)."),
      compositing: oneOf(["photoshop", "linear"], "How layers mix: photoshop (encoded values, as Photoshop: blend modes and opacity look as they do there; new photos) or linear (linear light, physically mixed)."),
      highlights: oneOf(["film", "clip"], "How light brighter than white leaves the photo: film rolls it towards white (glows and flares bloom), clip clips each channel."),
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
