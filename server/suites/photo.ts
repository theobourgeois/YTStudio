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
  remapMedia: (doc, ids) => ({ ...doc, layers: doc.layers.map((l) => (ids.has(l.mediaId) ? { ...l, mediaId: ids.get(l.mediaId)! } : l)) }),
  assistant: {
    context: "the photo's canvas and which layer is selected when they sent it",
    background: "no layer is selected",
    instructions: `\
Tools for a local photo editor that works like Photoshop. They act on the photo open in the editor tab (unless \
you're told otherwise), live: the user sees every change as it happens, and can undo it.

A photo is a canvas (a size in pixels and a background colour, or transparent) and layers, bottom to top. So far \
every layer is an image, placed whole: moving, scaling and rotating it resamples the original file, so making it \
smaller and bigger again never loses quality. Coordinates are canvas pixels from the top-left corner; a layer's \
position is its centre, its scale a factor of its own size (1 = 100%), its rotation degrees clockwise.

Start with get_photo, and look with view_photo before and after you change how it looks: you can't see the \
canvas otherwise. list_photo_media lists the project's images; add_image_layer places one; transform_layer \
moves, scales (fit: contain or cover) and rotates; update_layer renames, hides, fades and reorders; remove_layer \
deletes; set_canvas resizes the canvas or changes its background (thumbnails are often 1280×720, stories \
1080×1920). export_photo writes a PNG or JPEG.`,
  },
};
