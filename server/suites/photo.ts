import { createPhotoProject, normalizePhotoProject, withPhotoOptions } from "../../shared/photo/project.ts";
import type { SuiteBackend } from "./suite.ts";

/**
 * The photo suite (docs/photo/): `PhotoProject` documents, whose image layers show the project's media. Its Home
 * thumbnail is a cover the tab renders (the composite needs the GPU), not a media poster.
 */
export const photoSuite: SuiteBackend<"photo"> = {
  suite: "photo",
  create: (name) => createPhotoProject(name),
  withOptions: (doc, options) => withPhotoOptions(doc, options),
  // A layer whose media is gone stays (it shows as missing): the user's arrangement isn't thrown away.
  normalize: (doc) => normalizePhotoProject(doc),
  stats: (doc) => ({ name: doc.name, duration: 0, width: doc.canvas.width, height: doc.canvas.height, layerCount: doc.layers.length, coverAssetId: null }),
  remapMedia: (doc, ids) => ({ ...doc, layers: doc.layers.map((l) => (l.kind === "image" && ids.has(l.mediaId) ? { ...l, mediaId: ids.get(l.mediaId)! } : l)) }),
  assistant: {
    context: "the photo's canvas and which layer is selected when they sent it",
    background: "no layer is selected",
    instructions: `\
Tools for a local photo editor that works like Photoshop. They act on the photo open in the editor tab (unless \
you're told otherwise), live: the user sees every change as it happens, and can undo it.

A photo is a canvas (a size in pixels and a background colour, or transparent) and layers, bottom to top. An \
image layer is a picture placed whole: moving, scaling and rotating it resamples the original file, so making it \
smaller and bigger again never loses quality. Coordinates are canvas pixels from the top-left corner; a layer's \
position is its centre, its scale a factor of its own size (1 = 100%), its rotation degrees clockwise. An \
adjustment layer (Exposure, Curves) changes everything below it without changing any image: hide it, fade it with \
its opacity, or change its settings at any time.

Start with get_photo, and look with view_photo before and after you change how it looks: you can't see the \
canvas otherwise. list_photo_media lists the project's images; add_image_layer places one; transform_layer \
moves, scales (fit: contain or cover) and rotates; set_layer renames, hides, fades and reorders; remove_layer \
deletes; set_canvas resizes the canvas or changes its background (thumbnails are often 1280×720, stories \
1080×1920). add_adjustment adds an Exposure or Curves layer (above a given layer, so it only changes what's under \
it) and set_effect_params changes one: Exposure is in stops of light; Curves' points are [input, output] on 0..255 \
as in Photoshop (a gentle S, [[0, 0], [64, 52], [192, 205], [255, 255]], adds contrast). export_photo writes a PNG \
(8 or 16 bits) or JPEG.`,
  },
};
